# FileDeck

> **Gestione file diretta: sposta i tuoi file dove vuoi o eliminali dal disco.**
> PWA offline, privacy-first, 100% client-side. Derivata da [TriageHub](https://github.com/pezzaliapp/TriageHub).

## Cosa fa

A differenza della modalità "report" di TriageHub — che si limita a indicare *cosa fare* — FileDeck **agisce direttamente sul disco**:

- 📁 **Apri una cartella** (Desktop, Download, un progetto…) con un permesso esplicito
- 🗂️ **Vista “scrivania”**: vedi sia i file sciolti sia le cartelle presenti, **raggruppati per tipologia** (Cartelle, Immagini, Video, Documenti, Audio, Archivi, Altro)
- ✅ **Seleziona** ciò che vuoi: un elemento, un intero gruppo (con la casella del titolo) o tutto
- 🚚 **Sposta in…** una cartella di destinazione **che scegli tu** — anche cartelle intere, con tutto il loro contenuto
- 🗑️ **Cancella** file e cartelle direttamente dal disco
- 🔍 Cerca per nome, filtra per tipo, ordina per nome/dimensione/data
- 📂 Opzione **includi sottocartelle**: scansione ricorsiva che appiattisce e mostra tutti i file (struttura preservata allo spostamento)

Tutto avviene nel tuo browser: **nessun file viene caricato online**, niente account, niente server. Funziona offline dopo il primo caricamento ed è installabile come app.

## Come è possibile (la differenza con TriageHub)

Il TriageHub pubblicato dichiara: *"non sposta i file, non cestina i file, un'app web non può modificare i file"*. Questo era vero per la modalità report. FileDeck usa invece la **File System Access API**: con il tuo consenso esplicito, l'app ottiene un handle in lettura/scrittura sulla cartella e può eseguire operazioni reali.

- ✅ **Chrome, Edge, Opera su desktop** → spostamento e cancellazione reali
- ⚠️ **Safari, Firefox, iPhone/Android** → l'API non esiste: l'app lo segnala chiaramente e non finge di funzionare

> ⚠️ **Le operazioni sono reali e NON passano dal Cestino.** Lo spostamento è una copia nella destinazione seguita dalla rimozione dell'originale. Controlla sempre la selezione prima di confermare.

## Pubblicare su GitHub Pages

1. Crea un nuovo repo (es. `FileDeck`) e carica tutti questi file mantenendo la struttura:
   ```
   index.html
   manifest.json
   sw.js
   og-image.png
   icons/
     icon-192.png
     icon-512.png
     icon-maskable-512.png
     apple-touch-icon.png
   ```
2. Settings → Pages → Source: branch `main`, cartella `/root`.
3. Apri `https://<utente>.github.io/FileDeck/` da Chrome/Edge/Opera desktop.

Serve **HTTPS** (GitHub Pages lo fornisce): la File System Access API non funziona su `http://` non sicuro.

## Tecnologie

Vanilla HTML/CSS/JavaScript, zero dipendenze. File System Access API per le operazioni su disco, Service Worker per l'offline, Web App Manifest per l'installazione. Font *Bricolage Grotesque*, *Inter* e *IBM Plex Mono* via Google Fonts (cache offline).

## Licenza

MIT — come TriageHub.
