// SignalEdge Service Worker v1
const CACHE_NAME = 'signaledge-v1';
const ASSETS = [
  '/signaledge/',
  '/signaledge/index.html',
  '/signaledge/manifest.json'
];

// Instal·lació — guarda els fitxers a la caché
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activació — elimina caches antigues
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — serveix des de caché, actualitza en segon pla
self.addEventListener('fetch', e => {
  // Només gestionar requests del nostre domini
  if (!e.request.url.startsWith(self.location.origin)) return;
  
  // Per les dades de Binance (WebSocket/API) no fem caché
  if (e.request.url.includes('binance.com')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(response => {
        // Actualitza la caché amb la versió nova
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached); // Si no hi ha xarxa, usa la caché

      // Retorna caché immediatament si existeix, actualitza en segon pla
      return cached || fetchPromise;
    })
  );
});

// Missatge per forçar actualització
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
