// Service worker : l'application reste ouvrable sans réseau.
//
// Stratégie « réseau d'abord, cache en secours ». L'inverse — le cache d'abord —
// servirait une version périmée après chaque mise en ligne, ce qui est pire que
// pas de cache du tout pour une application qu'on corrige souvent.

const VERSION = "repere-v4";
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

/* ═════════ Notifications poussées ═════════
   Le contenu arrive chiffré et déjà déchiffré par le navigateur : on ne fait
   qu'afficher. `userVisibleOnly` nous oblige à montrer quelque chose à chaque
   poussée — c'est la contrepartie du droit de réveiller un téléphone, et une
   poussée silencieuse coûterait l'autorisation elle-même. */

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corps: e.data && e.data.text() }; }
  const titre = d.titre || "Repère";
  e.waitUntil(self.registration.showNotification(titre, {
    body: d.corps || "",
    icon: "/icones/repere-192.png",
    badge: "/icones/repere-192.png",
    lang: "fr",
    // Une seule notification de Repère à la fois : on remplace, on n'empile pas.
    tag: "repere",
    renotify: true,
    data: { lien: d.lien || "#/nouveautes" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const lien = (e.notification.data && e.notification.data.lien) || "#/nouveautes";
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Si l'application est déjà ouverte, on la ramène au premier plan au lieu
    // d'en ouvrir une deuxième copie.
    for (const c of fenetres) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ("navigate" in c) { try { await c.navigate("/" + lien); } catch {} }
        return;
      }
    }
    await self.clients.openWindow("/" + lien);
  })());
});
