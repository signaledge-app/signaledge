// SignalEdge Service Worker v3
const CACHE_NAME = 'signaledge-v3';
self.addEventListener('install', e => {
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.url.includes('binance.com')) return;
  if (e.request.url.includes('ws://') || e.request.url.includes('wss://')) return;
  e.respondWith(
    fetch(e.request).catch(() => {
      return new Response('Sin conexión', {status: 503});
    })
  );
});
