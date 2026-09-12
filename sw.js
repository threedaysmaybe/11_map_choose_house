// 成都选房地图 Service Worker
const CACHE = 'xuanfang-v7';
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
  // 照片：缓存优先（访问过的照片下次直接读本地缓存，快；缓存没有才请求网络）
  if (/\.(png|jpg|jpeg|webp)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }
  // 页面导航 + 数据文件走「缓存优先 + 后台更新」：先返回缓存（秒开不白屏），后台静默拉最新
  if (e.request.mode === 'navigate' || /\.(json|geojson|pbf)$/.test(url.pathname) || url.pathname.includes('/data/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetched = fetch(e.request).then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
          return res;
        }).catch(() => cached);
        return cached || fetched;
      })
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
