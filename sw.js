// sw.js — Service Worker для Grab Music
// Кешує музику щоб Chrome міг грати у фоні без мережі

const CACHE_NAME = 'grab-music-v2';
const MUSIC_CACHE = 'grab-music-files-v2';

// Режим фону: true коли сторінка невидима
let isBackgroundMode = false;

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
    // Запускаємо keep-alive для фонового відтворення
    startSwKeepAlive();
});

// ==================== KEEP-ALIVE ====================
let swKeepAliveInterval = null;

function startSwKeepAlive() {
    if (swKeepAliveInterval) clearInterval(swKeepAliveInterval);
    swKeepAliveInterval = setInterval(async () => {
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
            client.postMessage({ type: 'SW_KEEP_ALIVE' });
        });
    }, 30000); // кожні 30 секунд
}

function stopSwKeepAlive() {
    if (swKeepAliveInterval) {
        clearInterval(swKeepAliveInterval);
        swKeepAliveInterval = null;
    }
}

// ==================== FETCH ====================
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Музичні файли — кеш спочатку, потім мережа
    if (url.pathname.includes('/music/') || url.pathname.match(/\.(mp3|ogg|wav|flac|m4a|aac)$/i)) {
        const range = e.request.headers.get('range');

        const parseRange = (rangeHeader, size) => {
            const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
            if (!match) return null;
            let start = match[1] === '' ? size - parseInt(match[2], 10) : parseInt(match[1], 10);
            let end = match[2] === '' ? size - 1 : parseInt(match[2], 10);
            if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= size) return null;
            return { start, end: Math.min(end, size - 1) };
        };

        const createPartialResponse = async (response, rangeHeader) => {
            const buffer = await response.arrayBuffer();
            const segment = parseRange(rangeHeader, buffer.byteLength);
            if (!segment) return response;
            const sliced = buffer.slice(segment.start, segment.end + 1);
            return new Response(sliced, {
                status: 206,
                statusText: 'Partial Content',
                headers: {
                    'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
                    'Content-Range': `bytes ${segment.start}-${segment.end}/${buffer.byteLength}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': String(sliced.byteLength)
                }
            });
        };

        e.respondWith(
            caches.open(MUSIC_CACHE).then(cache =>
                cache.match(e.request).then(cached => {
                    if (range && cached) {
                        return createPartialResponse(cached, range);
                    }
                    if (cached) return cached;
                    // У фоновому режимі — тільки з кешу, без мережі
                    if (isBackgroundMode) {
                        return cached || new Response('', { status: 503 });
                    }
                    return fetch(e.request).then(response => {
                        if (response.ok && response.status === 200) {
                            cache.put(e.request, response.clone());
                        }
                        return response;
                    }).catch(() => {
                        if (range && cached) {
                            return createPartialResponse(cached, range);
                        }
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

    // Команда: очистити кеш музики
    if (e.data && e.data.type === 'CLEAR_MUSIC_CACHE') {
        caches.delete(MUSIC_CACHE).then(() => {
            e.source && e.source.postMessage({ type: 'CACHE_CLEARED' });
        });
    }

    // Команди для режиму фону
    if (e.data && e.data.type === 'SET_BACKGROUND_MODE') {
        isBackgroundMode = true;
        console.log('🔇 Background mode enabled - music only from cache');
    }
    if (e.data && e.data.type === 'SET_FOREGROUND_MODE') {
        isBackgroundMode = false;
        console.log('🔊 Foreground mode enabled - music from cache or network');
    }
});