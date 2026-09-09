// Service worker : l'application reste ouvrable sans réseau.
//
// Stratégie « réseau d'abord, cache en secours ». L'inverse — le cache d'abord —
// servirait une version périmée après chaque mise en ligne, ce qui est pire que
// pas de cache du tout pour une application qu'on corrige souvent.

const VERSION = "repere-v3";
const SOCLE = [
  "/", "/index.html", "/app.js", "/supa.js", "/planificateur.js",
  "/planning.js", "/modeles.js", "/photos.js", "/polices.css", "/manifest.webmanifest",
  "/icones/repere-192.png", "/icones/repere-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(SOCLE).catch(() => {}))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((l) => Promise.all(l.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  // On ne touche jamais aux appels à la base : ses réponses ne se mettent pas
  // en cache, et une réponse périmée serait un mensonge sur l'état du planning.
  if (e.request.method !== "GET" || u.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r && r.status === 200) {
          const copie = r.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copie)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((c) => c || caches.match("/index.html")))
  );
});
