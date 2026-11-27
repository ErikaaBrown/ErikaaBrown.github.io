/* PsicoLab, service worker: permite instalar o site e usar páginas já
   visitadas sem ligação. Estratégia simples: o casco do site (CSS/JS/
   ícones) fica em cache desde a instalação; as páginas HTML ficam em
   cache à medida que são visitadas (cache actualizado a cada visita
   com ligação); sem ligação, mostra a versão em cache ou, se a página
   nunca foi visitada, offline.html. */

const CACHE_NAME = "psicolab-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [
  "/",
  OFFLINE_URL,
  "/css/style.css?v=21",
  "/js/app.js?v=12",
  "/js/sync.js?v=12",
  "/img/favicon.png",
  "/img/logo-tree.png",
  "/img/icon-192.png",
  "/img/icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // deixa passar fontes, beacon, API do Worker

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (cached) { return cached || caches.match(OFFLINE_URL); });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      });
    })
  );
});
