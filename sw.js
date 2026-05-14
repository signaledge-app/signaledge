// SignalEdge Service Worker v2
const CACHE_NAME = 'signaledge-v2';

// En instal·lar, neteja tot i no guarda res a la caché
self.addEventListener('install', e => {
  self.skipWaiting();
});

// En activar, elimina totes les caches antigues
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — sempre de la xarxa, mai de caché
self.addEventListener('fetch', e => {
  // No interceptar WebSockets ni Binance
  if (e.request.url.includes('binance.com')) return;
  if (e.request.url.includes('ws://') || e.request.url.includes('wss://')) return;
  
  // Sempre agafar de la xarxa
  e.respondWith(
    fetch(e.request).catch(() => {
      // Si no hi ha xarxa, retornar error
      return new Response('Sin conexión', {status: 503});
    })
  );
});
