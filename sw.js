// sw.js — Service Worker для Grab Music
// Кешує музику щоб Chrome міг грати у фоні без мережі

const CACHE_NAME = 'grab-music-v2';
const MUSIC_CACHE = 'grab-music-files-v2';

// ==================== INSTALL ====================
self.addEventListener('install', e => {
    self.skipWaiting();
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME && k !== MUSIC_CACHE)
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ==================== FETCH ====================
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Музичні файли — кеш спочатку, потім мережа
    if (url.pathname.includes('/music/') || url.pathname.match(/\.(mp3|ogg|wav|flac|m4a|aac)$/i)) {
        e.respondWith(
            caches.open(MUSIC_CACHE).then(cache =>
                cache.match(e.request).then(cached => {
                    if (cached) return cached;
                    // Не в кеші — завантажуємо і кешуємо
                    return fetch(e.request).then(response => {
                        if (response.ok && response.status === 200) {
                            cache.put(e.request, response.clone());
                        }
                        return response;
                    }).catch(() => {
                        // Мережі немає — повертаємо з кешу якщо є
                        return cached || new Response('', { status: 503 });
                    });
                })
            )
        );
        return;
    }

    // Статичні файли (CSS, JS, HTML, JSON, зображення)
    if (
        url.pathname.match(/\.(css|js|html|json|png|jpg|jpeg|webp|svg|ico|lrc)$/i) ||
        url.pathname === '/' ||
        url.pathname.endsWith('/index.html') ||
        url.pathname.endsWith('/index_en.html')
    ) {
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
        return;
    }

    // Решта — просто мережа
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
});

// ==================== MESSAGES ====================
self.addEventListener('message', e => {
    // Keep-alive ping
    if (e.data === 'keepalive') {
        e.source && e.source.postMessage('alive');
        return;
    }

    // Команда: прекешувати список музики
    if (e.data && e.data.type === 'PRECACHE_MUSIC') {
        const files = e.data.files || [];
        caches.open(MUSIC_CACHE).then(cache => {
            // Кешуємо по одному щоб не перевантажувати
            let i = 0;
            function next() {
                if (i >= files.length) {
                    e.source && e.source.postMessage({ type: 'PRECACHE_DONE', count: files.length });
                    return;
                }
                const url = files[i++];
                cache.match(url).then(cached => {
                    if (cached) { next(); return; } // вже є
                    fetch(url).then(response => {
                        if (response.ok) cache.put(url, response);
                        next();
                    }).catch(() => next());
                });
            }
            next();
        });
        return;
    }

    // Команда: очистити кеш музики
    if (e.data && e.data.type === 'CLEAR_MUSIC_CACHE') {
        caches.delete(MUSIC_CACHE).then(() => {
            e.source && e.source.postMessage({ type: 'CACHE_CLEARED' });
        });
    }
});