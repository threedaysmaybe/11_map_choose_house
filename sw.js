// 成都选房地图 Service Worker
const CACHE = 'xuanfang-v4';
const CORE = [
  './',
  './index.html',
  './xiaoqu.html',
  './amap3d.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 跳过非 GET 请求（POST 接口等）
  if (e.request.method !== 'GET') return;
  // 页面导航 + 数据文件走「网络优先，失败回退缓存」（保证每次打开都是最新）
  if (e.request.mode === 'navigate' || /\.(json|geojson|pbf|png|jpg|jpeg|webp)$/.test(url.pathname) || url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // 其它资源走「缓存优先，后台更新」
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
