// Service Worker for To Do List PWA
const CACHE_NAME = 'todo-pwa-v4';
const PRECACHE_URLS = [
  './',
  './index.html',
  './todo.css',
  './todo.js',
  './manifest.json',
  '../favicon.png'
];

// 安装：预缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(() => {
        // 部分资源缓存失败不阻塞安装
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// 请求拦截：网络优先，离线回退缓存
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API 请求不缓存
  if (url.hostname.includes('supabase')) {
    return;
  }

  // CDN 资源（supabase-js）：缓存优先
  if (url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // 本地资源：网络优先，离线用缓存
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          return cached || new Response('离线模式，请连接网络后重试', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
  );
});
