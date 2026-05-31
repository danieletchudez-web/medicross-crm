const CACHE_NAME = "medicross-crm-shell-v2";
const STATIC_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/app-icon-192.png",
  "/app-icon-512.png",
  "/app-icon-maskable-512.png",
  "/apple-touch-icon.png"
];

const isSafeStaticRequest = (request) => {
  if (request.method !== "GET") return false;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.includes("/auth/")) return false;
  if (url.pathname.includes("/rest/")) return false;
  if (url.pathname.includes("/storage/")) return false;

  return true;
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isSafeStaticRequest(request)) return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });

        return cached || fresh;
      })
    );
  }
});
