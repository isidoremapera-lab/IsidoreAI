const CACHE_NAME = "isidoreai-cache-v1";

const APP_FILES = [
"/",
"/index.html",
"/manifest.json",
"/icon.svg"
];

// Installation du service worker
self.addEventListener("install", (event) => {
event.waitUntil(
caches.open(CACHE_NAME).then((cache) => {
return cache.addAll(APP_FILES);
})
);

self.skipWaiting();
});

// Activation et nettoyage des anciens caches
self.addEventListener("activate", (event) => {
event.waitUntil(
caches.keys().then((cacheNames) => {
return Promise.all(
cacheNames
.filter((name) => name.startsWith("isidoreai-cache-") && name !== CACHE_NAME)
.map((name) => caches.delete(name))
);
})
);

self.clients.claim();
});

// Gestion des requêtes
self.addEventListener("fetch", (event) => {
const request = event.request;
const url = new URL(request.url);

// Ne pas intercepter les requêtes non-GET
if (request.method !== "GET") {
return;
}

// Ne pas mettre en cache les requêtes vers des serveurs externes
if (url.origin !== self.location.origin) {
return;
}

// Pour les pages, essayer le réseau puis utiliser le cache
if (request.mode === "navigate") {
event.respondWith(
fetch(request)
.then((response) => {
if (response.ok) {
const copy = response.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put("/index.html", copy);
        });
      }

      return response;
    })
    .catch(async () => {
      return (
        await caches.match(request) ||
        await caches.match("/index.html") ||
        new Response("IsidoreAI : connexion Internet indisponible.", {
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        })
      );
    })
);

return;

}

// Pour les ressources locales, utiliser le cache si disponible
event.respondWith(
caches.match(request).then((cachedResponse) => {
if (cachedResponse) {
return cachedResponse;
}

  return fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();

      caches.open(CACHE_NAME).then((cache) => {
        cache.put(request, copy);
      });
    }

    return response;
  });
})

);
});
