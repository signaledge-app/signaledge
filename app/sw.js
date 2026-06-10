// sw.js v5 — SignalEdge
const CACHE_NAME = 'signaledge-v5';
const STATIC = ['/app/', '/app/index.html', '/app/manifest.json', '../supabase-sync.js', '../icon-192.png', '../icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('SW: eliminant caché antiga', k);
        return caches.delete(k);
      })))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // No cachear APIs externes
  if (url.hostname.includes('supabase') ||
      url.hostname.includes('binance') ||
      url.hostname.includes('alternative.me') ||
      url.hostname.includes('coingecko') ||
      url.hostname.includes('web3forms') ||
      url.hostname.includes('googletagmanager')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
