// sw.js — Service Worker для Grab Music
// Не дає Chrome вбивати вкладку у фоні

const CACHE_NAME = 'grab-music-v1';

self.addEventListener('install', e => {
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(self.clients.claim());
});

// Кешуємо статичні файли для офлайн-роботи
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Музику не кешуємо — вона велика
    if (url.pathname.startsWith('/music/')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // Статичні файли — кеш з мережею як fallback
    e.respondWith(
        caches.open(CACHE_NAME).then(cache =>
            cache.match(e.request).then(cached => {
                const network = fetch(e.request).then(response => {
                    if (response.ok) cache.put(e.request, response.clone());
                    return response;
                }).catch(() => cached);
                return cached || network;
            })
        )
    );
});

// Keep-alive ping від сторінки
self.addEventListener('message', e => {
    if (e.data === 'keepalive') {
        e.source.postMessage('alive');
    }
});