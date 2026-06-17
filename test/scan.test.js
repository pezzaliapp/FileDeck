/* ====================================================================
 * Test Node per scan.js — la File System Access API non esiste in
 * ambiente headless, quindi qui usiamo HANDLE MOCK che replicano il
 * comportamento dei FileSystemHandle reali, inclusi i casi-limite che
 * hanno causato il bug "si vedono solo le cartelle":
 *   - file normali (getFile ok)
 *   - file iCloud non scaricati (getFile lancia)  -> devono comparire
 *   - segnaposto iCloud ".Nome.ext.icloud"        -> nome reale + in cloud
 *   - una cartella la cui values() lancia          -> non azzera il resto
 *   - una cartella che si interrompe a metà        -> tiene il già letto
 *   - sottocartelle annidate                       -> file profondi elencati
 *
 * Avvio:  node test/scan.test.js
 * ==================================================================== */
"use strict";

const assert = require("assert");
const { scanDirectory, kindOf, realNameFromICloud } = require("../scan.js");

// ---------- Costruttori di handle mock ----------
function fileH(name, fileData /* {size,type,lastModified} oppure null = getFile lancia */) {
  return {
    kind: "file",
    name,
    async getFile() {
      if (fileData === null) {
        const e = new Error("file non scaricato (iCloud)");
        e.name = "NotFoundError";
        throw e;
      }
      return fileData;
    }
  };
}

function dirH(name, children) {
  return {
    kind: "directory",
    name,
    values() {
      return (async function* () { for (const c of children) yield c; })();
    }
  };
}

// Cartella la cui values() lancia subito (permesso negato / illeggibile).
function brokenDirH(name, errName) {
  return {
    kind: "directory",
    name,
    values() {
      const e = new Error("accesso negato");
      e.name = errName || "NotAllowedError";
      throw e;
    }
  };
}

// Cartella che restituisce alcune voci e poi si interrompe a metà.
function partialDirH(name, goodChildren, errName) {
  return {
    kind: "directory",
    name,
    values() {
      return (async function* () {
        for (const c of goodChildren) yield c;
        const e = new Error("iterazione interrotta");
        e.name = errName || "NotReadableError";
        throw e;
      })();
    }
  };
}

// ---------- Mini runner ----------
let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); console.log("  ✓ " + label); passed++; }
  catch (e) { console.error("  ✗ " + label + "\n      " + (e && e.message)); failed++; }
}

(async function run() {
  console.log("FileDeck — test scansione\n");

  // Albero che riproduce una Scrivania sincronizzata con iCloud.
  const tree = dirH("Scrivania", [
    fileH("photo.jpg", { size: 1234, type: "image/jpeg", lastModified: 100 }),
    fileH("broken.pdf", null),                                  // iCloud: getFile lancia
    fileH(".report.key.icloud", { size: 0, type: "" }),         // segnaposto iCloud
    fileH(".DS_Store", { size: 6, type: "" }),                  // da ignorare
    brokenDirH("Locked", "NotAllowedError"),                    // cartella illeggibile
    dirH("Sub", [
      fileH("clip.mp4", { size: 50, type: "video/mp4", lastModified: 200 }),
      dirH("Deep", [
        fileH("song.mp3", { size: 80, type: "audio/mpeg", lastModified: 300 })
      ])
    ]),
    partialDirH("PartialDir", [
      fileH("survivor.txt", { size: 10, type: "text/plain", lastModified: 400 })
    ], "NotReadableError")
  ]);

  const { items, stats } = await scanDirectory(tree, { deep: true });
  const files = items.filter(i => !i.isDir);
  const folders = items.filter(i => i.isDir);
  const names = files.map(f => f.name).sort();

  console.log("Funzioni pure:");
  await test("realNameFromICloud riconosce i segnaposto", () => {
    assert.strictEqual(realNameFromICloud(".report.key.icloud"), "report.key");
    assert.strictEqual(realNameFromICloud("normale.pdf"), null);
  });
  await test("kindOf classifica per estensione", () => {
    assert.strictEqual(kindOf("a.JPG", ""), "image");
    assert.strictEqual(kindOf("a.mp4", ""), "video");
    assert.strictEqual(kindOf("a.pdf", ""), "doc");
    assert.strictEqual(kindOf("a.zip", ""), "archive");
    assert.strictEqual(kindOf("a.xyz", ""), "other");
  });

  console.log("\nScansione (caso Scrivania iCloud):");

  await test("elenca TUTTI i file leggibili e non leggibili", () => {
    // 4 leggibili (photo, clip, song, survivor) + 2 in cloud (broken, report.key)
    assert.deepStrictEqual(names, [
      "broken.pdf", "clip.mp4", "photo.jpg", "report.key", "song.mp3", "survivor.txt"
    ]);
  });

  await test("il file iCloud illeggibile compare ed è marcato in cloud", () => {
    const broken = files.find(f => f.name === "broken.pdf");
    assert.ok(broken, "broken.pdf deve essere elencato");
    assert.strictEqual(broken.unread, true);
    assert.strictEqual(broken.kind, "doc", "tipo ricavato dall'estensione");
  });

  await test("il segnaposto .icloud mostra il nome reale ed è in cloud", () => {
    const rep = files.find(f => f.name === "report.key");
    assert.ok(rep, "report.key deve comparire col nome reale");
    assert.strictEqual(rep.unread, true);
    assert.strictEqual(rep.entryName, ".report.key.icloud", "entryName = nome su disco");
    assert.strictEqual(rep.kind, "doc");
  });

  await test("i file di sistema (.DS_Store) sono ignorati", () => {
    assert.ok(!names.includes(".DS_Store"));
  });

  await test("una cartella illeggibile NON azzera i risultati", () => {
    assert.ok(files.length >= 6, "i file devono restare anche con Locked illeggibile");
    assert.ok(stats.errors.some(e => e.entry.includes("Locked")), "errore di Locked registrato");
  });

  await test("una cartella interrotta a metà tiene ciò che ha già letto", () => {
    assert.ok(names.includes("survivor.txt"));
    assert.ok(stats.errors.some(e => e.phase === "iterate"), "errore 'iterate' registrato");
  });

  await test("i file annidati in profondità vengono elencati", () => {
    const song = files.find(f => f.name === "song.mp3");
    assert.ok(song);
    assert.strictEqual(song.relPath, "Sub/Deep/song.mp3");
  });

  await test("le cartelle di primo livello compaiono come elementi", () => {
    const fnames = folders.map(f => f.name).sort();
    assert.deepStrictEqual(fnames, ["Locked", "PartialDir", "Sub"]);
  });

  await test("le statistiche di debug sono coerenti", () => {
    assert.strictEqual(stats.filesRead, 4, "4 file letti");
    assert.strictEqual(stats.filesCloud, 2, "2 file in cloud");
    assert.ok(stats.dirs >= 4, "almeno 4 cartelle viste (incl. Deep annidata)");
    assert.ok(stats.errors.length >= 2, "errori catturati e non propagati");
  });

  await test("senza ricorsione si fermano i file profondi", async () => {
    const flat = await scanDirectory(tree, { deep: false });
    const flatFiles = flat.items.filter(i => !i.isDir).map(f => f.name);
    assert.ok(!flatFiles.includes("song.mp3"), "song.mp3 è profondo, non deve comparire");
    assert.ok(flatFiles.includes("photo.jpg"), "i file di primo livello restano");
  });

  console.log("\nRegressione bug \"si vedono solo le cartelle\":");

  await test("una directory che yield-a SIA file SIA cartelle restituisce gli item file", async () => {
    // Riproduce il caso reale: stesso livello con file handle e directory handle.
    const mixed = dirH("Root", [
      fileH("a.txt", { size: 1, type: "text/plain", lastModified: 1 }),
      dirH("Cartella", []),
      fileH("b.png", { size: 2, type: "image/png", lastModified: 2 }),
      dirH("Altra", [])
    ]);
    const { items } = await scanDirectory(mixed, { deep: true });
    const f = items.filter(i => !i.isDir).map(i => i.name).sort();
    const d = items.filter(i => i.isDir).map(i => i.name).sort();
    assert.deepStrictEqual(f, ["a.txt", "b.png"], "i FILE devono essere presenti, non solo le cartelle");
    assert.deepStrictEqual(d, ["Altra", "Cartella"]);
  });

  await test("cartella di SOLI file normali (nessun iCloud): tutti elencati e leggibili", async () => {
    const normal = dirH("Documenti", [
      fileH("relazione.pdf", { size: 10, type: "application/pdf", lastModified: 1 }),
      fileH("foto.JPG",      { size: 20, type: "image/jpeg",      lastModified: 2 }),
      fileH("note.txt",      { size: 30, type: "text/plain",      lastModified: 3 }),
      fileH("archivio.zip",  { size: 40, type: "application/zip", lastModified: 4 })
    ]);
    const { items, stats } = await scanDirectory(normal, { deep: true });
    const files = items.filter(i => !i.isDir);
    assert.strictEqual(files.length, 4, "tutti i 4 file normali elencati");
    assert.strictEqual(stats.filesCloud, 0, "nessun file marcato in cloud");
    assert.strictEqual(stats.filesRead, 4);
    // i nomi normali NON devono essere alterati da realNameFromICloud
    assert.deepStrictEqual(files.map(f => f.name).sort(),
      ["archivio.zip", "foto.JPG", "note.txt", "relazione.pdf"]);
    // ogni file ricade in un gruppo renderizzabile
    const KNOWN = new Set(["image", "video", "audio", "doc", "archive", "other"]);
    assert.ok(files.every(f => KNOWN.has(f.kind)), "ogni file ha un kind valido");
  });

  console.log("\n" + (failed ? "✗" : "✓") + " " + passed + " test superati, " + failed + " falliti\n");
  process.exit(failed ? 1 : 0);
})();
