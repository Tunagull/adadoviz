/*
  AdaDöviz service worker — elle yazıldı (build aracı yok).

  Strateji:
  - Uygulama kabuğu (index.html + statik ikonlar): install'da ön-önbellek,
    gezinme isteklerinde "network-first, offline'da kabuğa düş".
  - Hash'li derleme çıktıları (/assets/*): cache-first (isimleri değişmez).
  - /api/kurlar: network-first + 10 sn timeout, başarılıysa kopyala,
    çevrimdışıysa son bilinen kuru döndür (bayat ama boş ekrandan iyi).
  - Diğer /api/*: elleme — her zaman ağdan (oturum, admin, analitik).

  Sürüm yükseltince CACHE adlarını değiştir: eski cache activate'te silinir.
*/

const SHELL_CACHE = "adadoviz-shell-v1";
const RUNTIME_CACHE = "adadoviz-runtime-v1";

const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/adadoviz-mark.svg",
  "/adadoviz-maskable.svg",
  "/favicon.svg",
];

const RATES_TIMEOUT_MS = 10000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function timeoutFetch(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Kur uç noktası: network-first, çevrimdışında bayat kopya.
  if (url.pathname === "/api/kurlar") {
    event.respondWith(
      timeoutFetch(request, RATES_TIMEOUT_MS)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Diğer API çağrıları: dokunma.
  if (url.pathname.startsWith("/api/")) return;

  // Hash'li derleme çıktıları: cache-first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  // Gezinme (SPA): network-first, çevrimdışında kabuğa düş.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () => caches.match(request).then((c) => c || caches.match("/index.html"))
      )
    );
    return;
  }

  // Kalan aynı-origin GET: cache-first, yoksa ağ.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
