// FileDeck Service Worker
// Cache-first per gli asset statici, network-first per index.html (così gli
// aggiornamenti arrivano appena sei online).

const CACHE = "filedeck-v1.1.0";
const CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./og-image.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Google Fonts: cache-first con fallback di rete
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(
      caches.match(request).then(cached =>
        cached || fetch(request).then(r => {
          if (r && r.status === 200) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(request, copy)); }
          return r;
        }).catch(() => cached)
      )
    );
    return;
  }

  // index.html / navigazioni: network-first
  if (request.mode === "navigate" || url.pathname.endsWith("index.html") || url.pathname.endsWith("/")) {
    e.respondWith(
      fetch(request).then(r => {
        if (r && r.status === 200) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(request, copy)); }
        return r;
      }).catch(() => caches.match(request).then(c => c || caches.match("./index.html")))
    );
    return;
  }

  // Resto: cache-first
  e.respondWith(
    caches.match(request).then(cached =>
      cached || fetch(request).then(r => {
        if (r && r.status === 200 && r.type !== "opaque") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(request, copy)); }
        return r;
      })
    )
  );
});
