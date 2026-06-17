/* ====================================================================
 * FileDeck — scan.js
 * Logica di scansione e classificazione dei file, SENZA dipendenze dal
 * DOM. È la sorgente unica usata sia dall'app (index.html) sia dai test
 * Node (test/scan.test.mjs), così ciò che testiamo è esattamente ciò che
 * gira in produzione.
 *
 * Principi di robustezza (le tre cause diagnosticate):
 *  1. iCloud "non scaricati": getFile() su questi file fallisce o restituisce
 *     un segnaposto. Un file va SEMPRE elencato, anche se getFile() lancia:
 *     in quel caso il tipo si ricava dall'estensione del nome e il file è
 *     marcato come "in cloud" (unread:true).
 *  2. macOS espone i file iCloud non scaricati come segnaposto nascosti
 *     ".<nome reale>.icloud": li riconosciamo, mostriamo il nome reale e li
 *     marchiamo come "in cloud".
 *  3. Scansione resiliente: ogni cartella e ogni voce sono protette da
 *     try/catch; una sottocartella illeggibile NON azzera i risultati già
 *     raccolti. Gli errori catturati finiscono in stats.errors per il debug.
 * ==================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; // Node / test
  else root.FileDeckScan = api;                                           // browser
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // File "di sistema" da non elencare mai.
  const SKIP_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".localized"]);
  // Cartella di lavoro creata da versioni precedenti: la ignoriamo.
  const SKIP_DIRS = new Set(["_FileDeck_Spostati"]);

  const DEFAULTS = { deep: true, maxFiles: 50000, maxDepth: 10 };

  // Estrae il nome reale da un segnaposto iCloud ".Nome.ext.icloud".
  // Restituisce null se non è un segnaposto.
  function realNameFromICloud(name) {
    if (name.length > 8 && name.charAt(0) === "." && name.slice(-7) === ".icloud") {
      return name.slice(1, -7);
    }
    return null;
  }

  // Classifica un file in un gruppo a partire da nome (estensione) e MIME type.
  function kindOf(name, type) {
    type = type || "";
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (/^image\//.test(type) || /^(jpe?g|png|gif|webp|heic|heif|bmp|svg|tiff?)$/.test(ext)) return "image";
    if (/^video\//.test(type) || /^(mp4|mov|m4v|avi|mkv|webm|wmv)$/.test(ext)) return "video";
    if (/^audio\//.test(type) || /^(mp3|wav|aac|flac|ogg|m4a)$/.test(ext)) return "audio";
    if (/^(pdf|docx?|pages|txt|rtf|md|odt|xlsx?|csv|pptx?|key|numbers)$/.test(ext)) return "doc";
    if (/^(zip|rar|7z|tar|gz|tgz|bz2|dmg|iso)$/.test(ext)) return "archive";
    return "other";
  }

  // Nome leggibile di un errore catturato (per console e pannello debug).
  function errName(e) {
    if (!e) return "Errore sconosciuto";
    return e.name || e.message || String(e);
  }

  // Scansiona un livello della gerarchia. Tutto è protetto: un fallimento di
  // values() o di una singola voce non interrompe la raccolta.
  async function scanLevel(dirHandle, prefix, out, depth, ctx) {
    let iterator;
    try {
      iterator = dirHandle.values();
    } catch (e) {
      ctx.stats.errors.push({ entry: prefix || "(radice)", phase: "values", error: errName(e) });
      return;
    }

    try {
      for await (const entry of iterator) {
        if (out.length >= ctx.maxFiles) return;
        ctx.stats.entries++;
        try {
          if (entry.kind === "file") {
            if (SKIP_NAMES.has(entry.name)) continue;

            const cloudReal = realNameFromICloud(entry.name);
            const displayName = cloudReal || entry.name;
            let size = 0, type = "", mtime = 0, unread = false;

            if (cloudReal) {
              // Segnaposto iCloud: il contenuto non è scaricato. Lo elenchiamo
              // comunque, ricavando il tipo dal nome reale e marcandolo in cloud.
              unread = true;
              try { const f = await entry.getFile(); size = f.size || 0; } catch (_) { /* placeholder: dimensione ignota */ }
            } else {
              // File normale: provo a leggerne dimensione/tipo/data. Se fallisce
              // (tipico dei file iCloud/di rete non scaricati) NON lo scarto:
              // lo elenco comunque come "in cloud".
              try {
                const f = await entry.getFile();
                size = f.size || 0; type = f.type || ""; mtime = f.lastModified || 0;
              } catch (e) {
                unread = true;
                ctx.stats.errors.push({ entry: prefix + entry.name, phase: "getFile", error: errName(e) });
              }
            }

            if (unread) ctx.stats.filesCloud++; else ctx.stats.filesRead++;

            out.push({
              id: prefix + entry.name + "·" + size + "·" + mtime,
              name: displayName,        // nome mostrato (reale, senza .icloud)
              entryName: entry.name,    // nome reale su disco (per removeEntry)
              relPath: prefix + displayName,
              size: size,
              type: type,
              mtime: mtime,
              kind: kindOf(displayName, type),
              isDir: false,
              unread: unread,
              handle: entry,
              parent: dirHandle,
              selected: false
            });
          } else if (entry.kind === "directory") {
            if (SKIP_DIRS.has(entry.name)) continue;
            ctx.stats.dirs++;

            // Le cartelle di PRIMO livello compaiono come blocco spostabile/cancellabile.
            if (depth === 0) {
              let childCount = 0;
              try {
                for await (const _ of entry.values()) { childCount++; if (childCount >= 999) break; }
              } catch (e) {
                ctx.stats.errors.push({ entry: prefix + entry.name, phase: "childCount", error: errName(e) });
              }
              out.push({
                id: prefix + entry.name + "·dir",
                name: entry.name,
                entryName: entry.name,
                relPath: prefix + entry.name,
                size: 0, type: "", mtime: 0,
                kind: "folder", isDir: true, childCount: childCount,
                unread: false,
                handle: entry, parent: dirHandle, selected: false
              });
            }

            // Se richiesto, scendo a elencare ANCHE i file contenuti. La
            // ricorsione è protetta: una sottocartella illeggibile viene
            // saltata senza fermare il resto.
            if (ctx.deep && depth < ctx.maxDepth) {
              await scanLevel(entry, prefix + entry.name + "/", out, depth + 1, ctx);
            }
          }
        } catch (e) {
          ctx.stats.errors.push({ entry: prefix + (entry && entry.name), phase: "entry", error: errName(e) });
          // continuo con la voce successiva
        }
      }
    } catch (e) {
      // L'iterazione si è interrotta a metà: tengo comunque tutto il raccolto.
      ctx.stats.errors.push({ entry: prefix || "(radice)", phase: "iterate", error: errName(e) });
    }
  }

  // API pubblica: scansiona rootHandle e restituisce { items, stats }.
  async function scanDirectory(rootHandle, opts) {
    opts = opts || {};
    const ctx = {
      deep: opts.deep !== undefined ? !!opts.deep : DEFAULTS.deep,
      maxFiles: opts.maxFiles || DEFAULTS.maxFiles,
      maxDepth: opts.maxDepth !== undefined ? opts.maxDepth : DEFAULTS.maxDepth,
      stats: { entries: 0, filesRead: 0, filesCloud: 0, dirs: 0, errors: [] }
    };
    const out = [];
    if (rootHandle) await scanLevel(rootHandle, "", out, 0, ctx);
    return { items: out, stats: ctx.stats };
  }

  return { scanDirectory, kindOf, realNameFromICloud, errName, SKIP_NAMES, SKIP_DIRS };
});
