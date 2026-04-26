// ==================== ГЛОБАЛЬНІ ЗМІННІ ====================
let songsDatabase = [];
let playlistsDatabase = [];
let currentLrcLines = [];
let lrcSyncInterval = null;
let isUserInteracting = false;
let currentPlaylist = null;

let currentQueue = [];
let currentQueueIndex = -1;
let playlistEndedHandler = null;
let isPlaylistLoopEnabled = false;

let audioContext = null;
let sourceNode = null;
let bassFilter = null;
let midFilter = null;
let trebleFilter = null;
let isEqInitialized = false;

// Keep-alive
let wakeLock = null;
let keepAliveInterval = null;
let audioKeepAliveInterval = null;
// silentOscillator/silentGain замінені на silentBufferSource/silentGainNode (оголошені в секції фонового відтворення)

let playPauseBtn, nextBtn, prevBtn, loopBtn, seekBar, currentTimeLabel, durationTimeLabel;

let currentLanguage = window.location.pathname.includes('_en.html') ? 'en' : 'uk';

const translations = {
    uk: {
        errorLoadingDB: 'Помилка завантаження бази пісень.',
        noLyrics: 'Текст відсутній.',
        invalidLrc: 'Неправильний формат LRC.',
        lrcNotAvailable: 'LRC файл недоступний.',
        noResults: '❌ Пісні не знайдені',
        nowPlayingLabel: 'Програється:',
        playBtn: 'Програвати',
        downloadBtn: 'Скачати',
        viewBtn: 'Переглянути',
        backBtn: 'Назад',
        playAllBtn: 'Програвати всі',
        lyricsTabText: '📝 Текст',
        lrcTabText: '🎵 LRC',
        eqBass: '🔊 Низькі',
        eqMid: '🎵 Середні',
        eqTreble: '🎶 Високі',
        resetEq: '⟳ Скинути'
    },
    en: {
        errorLoadingDB: 'Error loading song database.',
        noLyrics: 'No lyrics available.',
        invalidLrc: 'Invalid LRC format.',
        lrcNotAvailable: 'LRC file not available.',
        noResults: '❌ No songs found',
        nowPlayingLabel: 'Now playing:',
        playBtn: 'Play',
        downloadBtn: 'Download',
        viewBtn: 'View',
        backBtn: 'Back',
        playAllBtn: 'Play all',
        lyricsTabText: '📝 Lyrics',
        lrcTabText: '🎵 LRC',
        eqBass: '🔊 Bass',
        eqMid: '🎵 Mid',
        eqTreble: '🎶 Treble',
        resetEq: '⟳ Reset'
    }
};

function t(key) { return translations[currentLanguage][key] || key; }

// ==================== ФОНОВЕ ВІДТВОРЕННЯ ====================

// 1. Wake Lock — не дає екрану засипати
async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
        if (wakeLock) return;
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
            wakeLock = null;
            const a = document.getElementById('audioPlayer');
            if (a && !a.paused) setTimeout(() => requestWakeLock(), 500);
        });
    } catch(e) {}
}

function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch(e) {} wakeLock = null; }
}

// 2. Silent Audio Buffer — реальний тихий звук (не осцилятор)
// Це ключовий трюк: браузер не заморожує AudioContext якщо є активний BufferSource
let silentBufferSource = null;
let silentGainNode = null;

function startSilentAudio() {
    if (!audioContext) return;
    stopSilentAudio();
    try {
        // 1 секунда тиші
        const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
        silentGainNode = audioContext.createGain();
        silentGainNode.gain.value = 0.001; // майже нуль але не 0 — браузер не вбиває
        silentGainNode.connect(audioContext.destination);

        function playChunk() {
            if (!audioContext || !silentGainNode) return;
            silentBufferSource = audioContext.createBufferSource();
            silentBufferSource.buffer = buffer;
            silentBufferSource.connect(silentGainNode);
            silentBufferSource.onended = () => playChunk(); // нескінченний loop
            silentBufferSource.start();
        }
        playChunk();
        console.log('✅ Silent audio started');
    } catch(e) { console.warn('Silent audio failed:', e); }
}

function stopSilentAudio() {
    try { if (silentBufferSource) silentBufferSource.stop(); } catch(e) {}
    silentBufferSource = null;
    if (silentGainNode) { try { silentGainNode.disconnect(); } catch(e) {} silentGainNode = null; }
}

// Аліаси для сумісності зі старими викликами
function startSilentOscillator() { startSilentAudio(); }
function stopSilentOscillator()  { stopSilentAudio(); }

// 3. Keep-alive: відновлення AudioContext + silent audio кожні 10 сек
function startKeepAlive() {
    stopKeepAlive();
    keepAliveInterval = setInterval(async () => {
        if (!audioContext) return;
        if (audioContext.state === 'suspended') {
            try { await audioContext.resume(); } catch(e) {}
        }
        if (!silentBufferSource) startSilentAudio();
    }, 10000);
}

function stopKeepAlive() {
    if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
}

// 4. Audio element ping — підтримує активність потоку
function startAudioKeepAlive(audio) {
    stopAudioKeepAlive();
    audioKeepAliveInterval = setInterval(() => {
        if (!audio || audio.paused) return;
        const _ = audio.currentTime; // читання = підтримка активності
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(() => {});
        }
    }, 10000);
}

function stopAudioKeepAlive() {
    if (audioKeepAliveInterval) { clearInterval(audioKeepAliveInterval); audioKeepAliveInterval = null; }
}

let lastSrc = '';
let lastTime = 0;

// 5. Повернення на вкладку — відновлюємо все
document.addEventListener('visibilitychange', async () => {
    const audio = document.getElementById('audioPlayer');
    if (audioContext && audioContext.state === 'suspended') {
        try { await audioContext.resume(); } catch(e) {}
    }
    if (document.visibilityState === 'visible') {
        if (audio && !audio.paused) {
            requestWakeLock();
            if (!silentBufferSource) startSilentAudio();
        }
    }
});

// 6. Розблокування AudioContext при будь-якому жесті користувача
function setupAudioUnlock() {
    const unlock = async () => {
        if (!audioContext) return;
        if (audioContext.state === 'suspended') {
            try { await audioContext.resume(); } catch(e) {}
        }
        if (!silentBufferSource) startSilentAudio();
    };
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('touchend',   unlock, { passive: true });
    document.addEventListener('click',      unlock);
}

// ==================== ЕКВАЛАЙЗЕР ====================
function initEqualizer() {
    const audio = document.getElementById('audioPlayer');
    if (!audio) return;
    if (localStorage.getItem('grab_music_eq') === 'false') return;
    if (isEqInitialized && audioContext && audioContext.state !== 'closed') {
        if (audioContext.state === 'suspended') audioContext.resume();
        return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    try {
        audioContext = new AudioCtx();
        sourceNode = audioContext.createMediaElementSource(audio);
        bassFilter = audioContext.createBiquadFilter();
        bassFilter.type = 'lowshelf';
        bassFilter.frequency.value = 200;
        bassFilter.gain.value = 0;
        midFilter = audioContext.createBiquadFilter();
        midFilter.type = 'peaking';
        midFilter.frequency.value = 1000;
        midFilter.Q.value = 1;
        midFilter.gain.value = 0;
        trebleFilter = audioContext.createBiquadFilter();
        trebleFilter.type = 'highshelf';
        trebleFilter.frequency.value = 4000;
        trebleFilter.gain.value = 0;
        sourceNode.connect(bassFilter);
        bassFilter.connect(midFilter);
        midFilter.connect(trebleFilter);
        trebleFilter.connect(audioContext.destination);
        isEqInitialized = true;
        audioContext.resume();
        startSilentOscillator();
        startKeepAlive();
        updateEqualizerLabels();
        initBassAnalyser();
        console.log('✅ EQ initialized');
    } catch(e) {
        console.warn('EQ init failed:', e);
        isEqInitialized = false;
        const eqDiv = document.getElementById('eqControls');
        if (eqDiv) eqDiv.style.display = 'none';
        const eqCheck = document.getElementById('eqToggleCheck');
        if (eqCheck) eqCheck.checked = false;
        localStorage.setItem('grab_music_eq', 'false');
    }
}

function updateEqualizerLabels() {
    const eqDiv = document.getElementById('eqControls');
    if (!eqDiv) return;
    const bassVal   = document.getElementById('bassSlider')?.value   || 0;
    const midVal    = document.getElementById('midSlider')?.value    || 0;
    const trebleVal = document.getElementById('trebleSlider')?.value || 0;
    eqDiv.innerHTML = `
        <label>${t('eqBass')} <input type="range" id="bassSlider" min="-20" max="20" value="${bassVal}" step="1"></label>
        <label>${t('eqMid')} <input type="range" id="midSlider" min="-20" max="20" value="${midVal}" step="1"></label>
        <label>${t('eqTreble')} <input type="range" id="trebleSlider" min="-20" max="20" value="${trebleVal}" step="1"></label>
        <button id="resetEqBtn" class="reset-eq-btn">${t('resetEq')}</button>
    `;
    const bs = document.getElementById('bassSlider');
    const ms = document.getElementById('midSlider');
    const ts = document.getElementById('trebleSlider');
    const rs = document.getElementById('resetEqBtn');
    if (bs) bs.oninput = e => { if (bassFilter)   bassFilter.gain.value   = e.target.value; };
    if (ms) ms.oninput = e => { if (midFilter)    midFilter.gain.value    = e.target.value; };
    if (ts) ts.oninput = e => { if (trebleFilter) trebleFilter.gain.value = e.target.value; };
    if (rs) rs.onclick = () => {
        [bs, ms, ts].forEach(s => { if (s) s.value = 0; });
        if (bassFilter)   bassFilter.gain.value   = 0;
        if (midFilter)    midFilter.gain.value    = 0;
        if (trebleFilter) trebleFilter.gain.value = 0;
    };
}

function loadEqPreference() {
    const enabled = localStorage.getItem('grab_music_eq') !== 'false';
    const eqDiv = document.getElementById('eqControls');
    if (eqDiv) eqDiv.style.display = enabled ? 'flex' : 'none';
    const eqCheck = document.getElementById('eqToggleCheck');
    if (eqCheck) eqCheck.checked = enabled;
}

function toggleEq(checked) {
    const enabled = checked !== undefined ? checked : !(localStorage.getItem('grab_music_eq') !== 'false');
    localStorage.setItem('grab_music_eq', enabled ? 'true' : 'false');
    const eqDiv = document.getElementById('eqControls');
    if (eqDiv) eqDiv.style.display = enabled ? 'flex' : 'none';
    if (enabled) {
        if (!isEqInitialized) initEqualizer();
        else {
            const bs = document.getElementById('bassSlider');
            const ms = document.getElementById('midSlider');
            const ts = document.getElementById('trebleSlider');
            if (bassFilter   && bs) bassFilter.gain.value   = bs.value;
            if (midFilter    && ms) midFilter.gain.value    = ms.value;
            if (trebleFilter && ts) trebleFilter.gain.value = ts.value;
        }
    } else {
        if (bassFilter)   bassFilter.gain.value   = 0;
        if (midFilter)    midFilter.gain.value    = 0;
        if (trebleFilter) trebleFilter.gain.value = 0;
    }
}

// ==================== BASS SHAKE ====================
let analyser = null;
let shakeAnimFrame = null;

function initBassAnalyser() {
    if (!audioContext || analyser) return;
    try {
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.7;
        trebleFilter.connect(analyser);
        startBassShake();
        console.log('✅ Bass analyser initialized');
    } catch(e) { console.warn('Bass analyser failed:', e); }
}

function startBassShake() {
    if (shakeAnimFrame) cancelAnimationFrame(shakeAnimFrame);
    if (localStorage.getItem('grab_music_shake') === 'false') return;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let lastShake = 0;
    function tick() {
        shakeAnimFrame = requestAnimationFrame(tick);
        if (localStorage.getItem('grab_music_shake') === 'false') {
            document.body.style.transform = ''; return;
        }
        if (document.querySelector('.modal.open')) {
            document.body.style.transform = ''; return;
        }
        analyser.getByteFrequencyData(data);
        const bass = (data[0] + data[1] + data[2] + data[3]) / 4;
        const now = Date.now();
        if (bass > 185 && now - lastShake > 110) {
            lastShake = now;
            const sliderVal = parseInt(localStorage.getItem('grab_music_shake_intensity') ?? '25');
            const intensity = Math.min((bass - 185) / 70, 1);
            const px = Math.round(intensity * (sliderVal / 5));
            if (px >= 1) {
                const dir = Math.random() > 0.5 ? 1 : -1;
                document.body.style.transform = `translateX(${dir * px}px)`;
                setTimeout(() => { document.body.style.transform = ''; }, 65);
            }
        }
    }
    tick();
}

function stopBassShake() {
    if (shakeAnimFrame) { cancelAnimationFrame(shakeAnimFrame); shakeAnimFrame = null; }
    document.body.style.transform = '';
}

function loadShakePreference() {
    const enabled = localStorage.getItem('grab_music_shake') !== 'false';
    const check = document.getElementById('shakeToggle');
    if (check) check.checked = enabled;
    const slider = document.getElementById('shakeIntensity');
    if (slider) slider.value = localStorage.getItem('grab_music_shake_intensity') ?? '25';
    updateShakeIntensityLabel();
}

function updateShakeIntensityLabel() {
    const slider = document.getElementById('shakeIntensity');
    const label  = document.getElementById('shakeIntensityLabel');
    if (slider && label) label.textContent = slider.value;
}

function setShakeIntensity(val) {
    localStorage.setItem('grab_music_shake_intensity', val);
    updateShakeIntensityLabel();
}

function toggleShake(checked) {
    const enabled = checked !== undefined ? checked : !(localStorage.getItem('grab_music_shake') !== 'false');
    localStorage.setItem('grab_music_shake', enabled ? 'true' : 'false');
    if (!enabled) { document.body.style.transform = ''; }
    else if (analyser) startBassShake();
}

// ==================== ТЕМА ====================
function loadThemePreference() {
    const isDark = localStorage.getItem('grab_music_theme') === 'dark';
    document.body.classList.toggle('dark-theme', isDark);
    const darkCheck = document.getElementById('darkThemeToggle');
    if (darkCheck) darkCheck.checked = isDark;
}

function toggleTheme(checked) {
    const isDark = checked !== undefined ? checked : !document.body.classList.contains('dark-theme');
    document.body.classList.toggle('dark-theme', isDark);
    localStorage.setItem('grab_music_theme', isDark ? 'dark' : 'light');
}

// ==================== РЕЖИМИ ====================
function loadModePreferences() {
    const simpleCheck = document.getElementById('simpleModeToggle');
    const ultraCheck  = document.getElementById('ultraSimpleModeToggle');
    const isSimple = localStorage.getItem('grab_music_simple') === 'true';
    const isUltra  = localStorage.getItem('grab_music_ultra')  === 'true';
    if (isSimple) { document.body.classList.add('simple-mode'); if (simpleCheck) simpleCheck.checked = true; }
    if (isUltra)  { document.body.classList.add('ultra-simple-mode'); if (ultraCheck) ultraCheck.checked = true; }
}

function toggleSimpleMode(checked) {
    const enabled = checked !== undefined ? checked : !document.body.classList.contains('simple-mode');
    document.body.classList.toggle('simple-mode', enabled);
    localStorage.setItem('grab_music_simple', enabled ? 'true' : 'false');
    if (enabled) {
        document.body.classList.remove('ultra-simple-mode');
        localStorage.setItem('grab_music_ultra', 'false');
        const ultraCheck = document.getElementById('ultraSimpleModeToggle');
        if (ultraCheck) ultraCheck.checked = false;
    }
}

function toggleUltraSimpleMode(checked) {
    const enabled = checked !== undefined ? checked : !document.body.classList.contains('ultra-simple-mode');
    document.body.classList.toggle('ultra-simple-mode', enabled);
    localStorage.setItem('grab_music_ultra', enabled ? 'true' : 'false');
    if (enabled) {
        document.body.classList.remove('simple-mode');
        localStorage.setItem('grab_music_simple', 'false');
        const simpleCheck = document.getElementById('simpleModeToggle');
        if (simpleCheck) simpleCheck.checked = false;
        closeSettings();
    }
}

function disableUltraSimpleMode() {
    document.body.classList.remove('ultra-simple-mode');
    localStorage.setItem('grab_music_ultra', 'false');
    const ultraCheck = document.getElementById('ultraSimpleModeToggle');
    if (ultraCheck) ultraCheck.checked = false;
}

// ==================== MEDIA SESSION ====================
function updateMediaSession(song) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name, artist: song.artist, album: 'Grab Music',
        artwork: [
            { src: song.image, sizes: '512x512', type: 'image/jpeg' },
            { src: song.image, sizes: '256x256', type: 'image/jpeg' }
        ]
    });
    const audio = document.getElementById('audioPlayer');
    navigator.mediaSession.setActionHandler('play',         () => audio && audio.play());
    navigator.mediaSession.setActionHandler('pause',        () => audio && audio.pause());
    navigator.mediaSession.setActionHandler('stop',         () => { if(audio){ audio.pause(); audio.currentTime=0; }});
    navigator.mediaSession.setActionHandler('seekbackward', d => { if(audio) audio.currentTime = Math.max(0, audio.currentTime-(d.seekOffset||10)); });
    navigator.mediaSession.setActionHandler('seekforward',  d => { if(audio) audio.currentTime = Math.min(audio.duration, audio.currentTime+(d.seekOffset||10)); });
    navigator.mediaSession.setActionHandler('seekto',       d => { if(audio && d.seekTime!==undefined) audio.currentTime=d.seekTime; });
    if (isRandomMode) {
        navigator.mediaSession.setActionHandler('nexttrack', () => playNextRandom());
        navigator.mediaSession.setActionHandler('previoustrack', null);
    } else {
        updateMediaSessionNavHandlers();
    }
}

function updateMediaSessionNavHandlers() {
    if (!('mediaSession' in navigator)) return;
    if (currentQueue.length > 1) {
        const canPrev = isPlaylistLoopEnabled || currentQueueIndex > 0;
        const canNext = isPlaylistLoopEnabled || currentQueueIndex < currentQueue.length - 1;
        navigator.mediaSession.setActionHandler('previoustrack', canPrev ? () => playPrev() : null);
        navigator.mediaSession.setActionHandler('nexttrack',     canNext ? () => playNext() : null);
    } else {
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack',     null);
    }
}

function updateMediaSessionState(audio) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    if (!isNaN(audio.duration) && audio.duration > 0) {
        try {
            navigator.mediaSession.setPositionState({
                duration: audio.duration,
                playbackRate: audio.playbackRate || 1,
                position: audio.currentTime
            });
        } catch(e) {}
    }
}

// ==================== LOCALSTORAGE ====================
const STORAGE_KEY = 'grab_music_playlists';
function savePlaylists() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(playlistsDatabase)); } catch(e) {} }
function loadPlaylistsFromStorage() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) { playlistsDatabase = parsed; return true; }
        } catch(e) {}
    }
    return false;
}

// ==================== ЗАВАНТАЖЕННЯ ДАНИХ ====================
const SONGS_CACHE_KEY = 'grab_music_songs_cache';
const PLAYLISTS_CACHE_KEY = 'grab_music_playlists_cache'; // окремо від STORAGE_KEY (favorites)

// Fetch з таймаутом (10 секунд)
async function fetchWithTimeout(url, timeout = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch(e) {
        clearTimeout(timer);
        throw e;
    }
}

function _showNoInternetScreen() {
    // Якщо вже показано — не дублюємо
    if (document.getElementById('noInternetScreen')) return;
    const el = document.createElement('div');
    el.id = 'noInternetScreen';
    el.style.cssText = `
        position:fixed;inset:0;z-index:99999;
        background:var(--bg-gradient-end,#1a2a3a);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-family:'Comfortaa',cursive;color:var(--text-primary,#f0f0f0);
        text-align:center;padding:30px;
    `;
    el.innerHTML = `
        <div style="font-size:64px;margin-bottom:16px;">📡</div>
        <h2 style="font-size:28px;margin:0 0 12px;color:#e67e22;">Немає інтернету :(</h2>
        <p style="font-size:15px;opacity:0.7;margin:0 0 28px;max-width:300px;line-height:1.6;">
            Не вдалося завантажити дані. Перевір підключення та спробуй ще раз.
        </p>
        <button onclick="location.reload()" style="
            background:linear-gradient(135deg,#e67e22,#d35400);
            color:#fff;border:none;padding:14px 32px;border-radius:30px;
            font-size:16px;font-family:'Comfortaa',cursive;font-weight:700;
            cursor:pointer;box-shadow:0 4px 14px rgba(230,126,34,0.4);
        ">🔄 Спробувати знову</button>
    `;
    document.body.appendChild(el);
}

async function loadDatabase() {
    // ── 1. SONGS ──────────────────────────────────────────────────────
    const cachedSongs = localStorage.getItem(SONGS_CACHE_KEY);

    try {
        const res = await fetchWithTimeout('./database.json', 10000);
        if (!res.ok) throw new Error('not ok');
        const fresh = await res.json();
        songsDatabase = fresh;
        try { localStorage.setItem(SONGS_CACHE_KEY, JSON.stringify(fresh)); } catch(e) {}
        console.log('✅ songs loaded from network:', songsDatabase.length);
    } catch(e) {
        if (cachedSongs) {
            try {
                songsDatabase = JSON.parse(cachedSongs);
                console.log('📦 songs loaded from cache:', songsDatabase.length);
                _showOfflineBanner();
            } catch(err) {
                songsDatabase = [];
                _showNoInternetScreen();
                return;
            }
        } else {
            // Немає ні мережі ні кешу
            songsDatabase = [];
            _showNoInternetScreen();
            return;
        }
    }

    // ── 2. PLAYLISTS ──────────────────────────────────────────────────
    const storedFavorites = (() => {
        try {
            const s = localStorage.getItem(STORAGE_KEY);
            if (!s) return null;
            const arr = JSON.parse(s);
            return arr.find(p => p.id === 'favorites') || null;
        } catch(e) { return null; }
    })();

    const cachedPlaylists = localStorage.getItem(PLAYLISTS_CACHE_KEY);

    const mergePlaylists = (filePlaylists) => {
        let result = filePlaylists.map(pl => {
            if (pl.id === 'favorites' && storedFavorites) return storedFavorites;
            return pl;
        });
        if (!result.find(p => p.id === 'favorites') && storedFavorites) {
            result.unshift(storedFavorites);
        }
        return result;
    };

    try {
        const res = await fetchWithTimeout('./playlists.json', 10000);
        if (!res.ok) throw new Error('not ok');
        const filePlaylists = await res.json();
        playlistsDatabase = mergePlaylists(filePlaylists);
        try { localStorage.setItem(PLAYLISTS_CACHE_KEY, JSON.stringify(filePlaylists)); } catch(e) {}
        console.log('✅ playlists loaded from network');
    } catch(e) {
        if (cachedPlaylists) {
            try {
                const cached = JSON.parse(cachedPlaylists);
                playlistsDatabase = mergePlaylists(cached);
                console.log('📦 playlists loaded from cache');
            } catch(err) {
                playlistsDatabase = storedFavorites ? [storedFavorites] : [];
            }
        } else {
            try {
                const s = localStorage.getItem(STORAGE_KEY);
                playlistsDatabase = s ? JSON.parse(s) : [];
            } catch(err) { playlistsDatabase = []; }
        }
    }

    if (!playlistsDatabase.find(p => p.id === 'favorites')) {
        playlistsDatabase.unshift({
            id: 'favorites', name: 'Улюблене', name_en: 'Favorites',
            description: 'Твої улюблені пісні', description_en: 'Your favorite songs', songs: []
        });
    }

    savePlaylists();
    displayPlaylists();
    _loadWeights();
    initWeights();

    // Відновлюємо останню пісню (авто-відновлення)
    _restoreLastPosition();

    const si = document.getElementById('searchInput');
    if (si && si.value.trim()) searchSongs();
}

function _showOfflineBanner() {
    if (document.getElementById('offlineBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;background:#e67e22;color:#fff;text-align:center;padding:8px 16px;font-size:13px;font-family:Segoe UI,sans-serif;';
    banner.textContent = '📡 Офлайн — завантажено з кешу. Деякі функції недоступні.';
    document.body.prepend(banner);
    setTimeout(() => banner.remove(), 5000);
}

// ==================== ФУНКЦІЯ 1: АВТОЗБЕРЕЖЕННЯ ПОЗИЦІЇ ====================
// Коли закриваєш сайт — зберігається яка пісня грала і на якій секунді.
// При наступному відкритті — пропонує продовжити з того ж місця.
const LAST_POS_KEY = 'grab_music_last_position';

function _saveLastPosition() {
    const audio = document.getElementById('audioPlayer');
    if (!audio || audio.paused || !audio.src || audio.src === window.location.href) return;
    const song = songsDatabase.find(s => audio.src.includes(encodeURIComponent(s.file)) || audio.src.includes(s.file));
    if (!song || audio.currentTime < 5) return; // не зберігаємо якщо менше 5 сек
    try {
        localStorage.setItem(LAST_POS_KEY, JSON.stringify({
            file: song.file,
            time: Math.floor(audio.currentTime),
            name: song.name,
            artist: song.artist
        }));
    } catch(e) {}
}

function _restoreLastPosition() {
    const raw = localStorage.getItem(LAST_POS_KEY);
    if (!raw) return;
    let saved;
    try { saved = JSON.parse(raw); } catch(e) { return; }
    const song = songsDatabase.find(s => s.file === saved.file);
    if (!song || saved.time < 5) return;

    // Показуємо тост з пропозицією продовжити
    const msg = currentLanguage === 'uk'
        ? `▶ Продовжити "${saved.name}"? (${formatTime(saved.time)})`
        : `▶ Continue "${saved.name}"? (${formatTime(saved.time)})`;

    const toast = document.createElement('div');
    toast.style.cssText = `
        position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
        background:var(--card-bg,#1e2f3e);color:var(--text-primary,#f0f0f0);
        padding:14px 20px;border-radius:14px;font-size:14px;z-index:99999;
        box-shadow:0 4px 20px rgba(0,0,0,0.4);border:1px solid var(--accent-color);
        display:flex;align-items:center;gap:12px;max-width:90vw;font-family:'Segoe UI',sans-serif;
    `;
    toast.innerHTML = `
        <span>${msg}</span>
        <button onclick="
            playSong('${song.file}', false);
            setTimeout(() => {
                const a = document.getElementById('audioPlayer');
                if (a) a.currentTime = ${saved.time};
            }, 800);
            this.closest('div').remove();
        " style="
            background:var(--accent-color);color:#1a2a3a;border:none;
            padding:8px 16px;border-radius:8px;cursor:pointer;
            font-weight:bold;font-size:13px;white-space:nowrap;
        ">${currentLanguage === 'uk' ? 'Так' : 'Yes'}</button>
        <button onclick="
            localStorage.removeItem('${LAST_POS_KEY}');
            this.closest('div').remove();
        " style="
            background:transparent;color:var(--text-muted);border:none;
            padding:8px;cursor:pointer;font-size:18px;
        ">✕</button>
    `;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 12000);
}

// Зберігаємо позицію перед закриттям
window.addEventListener('beforeunload', _saveLastPosition);
// Також зберігаємо кожні 10 сек під час відтворення
setInterval(_saveLastPosition, 10000);


// ==================== ФУНКЦІЯ 2: ЖИВИЙ ПРОГРЕС-БАР ====================
// Seek bar плавно змінює колір від синього (початок) → зеленого (середина) → помаранчевого (кінець)
// Виглядає як "температура" треку — відразу видно де ти в пісні.
function _updateSeekBarColor() {
    const seekBar = document.getElementById('seekBar');
    if (!seekBar) return;
    const val = parseFloat(seekBar.value) || 0; // 0..100
    // Інтерполяція кольорів: 0%=синій, 50%=зелений, 100%=помаранчевий
    let r, g, b;
    if (val <= 50) {
        const t = val / 50;
        r = Math.round(93  + (30  - 93)  * t);  // 93→30  (синій→зелений R)
        g = Math.round(156 + (201 - 156) * t);  // 156→201 (синій→зелений G)
        b = Math.round(236 + (50  - 236) * t);  // 236→50  (синій→зелений B)
    } else {
        const t = (val - 50) / 50;
        r = Math.round(30  + (243 - 30)  * t);  // 30→243  (зелений→помаранчевий R)
        g = Math.round(201 + (156 - 201) * t);  // 201→156 (зелений→помаранчевий G)
        b = Math.round(50  + (18  - 50)  * t);  // 50→18   (зелений→помаранчевий B)
    }
    const color = `rgb(${r},${g},${b})`;
    const pct = val + '%';
    seekBar.style.background = `linear-gradient(to right, ${color} 0%, ${color} ${pct}, rgba(164,194,244,0.25) ${pct})`;
}

// Підключаємо до timeupdate і seek
(function _initSeekBarColor() {
    const check = setInterval(() => {
        const audio = document.getElementById('audioPlayer');
        const seekBar = document.getElementById('seekBar');
        if (!audio || !seekBar) return;
        clearInterval(check);
        audio.addEventListener('timeupdate', _updateSeekBarColor);
        seekBar.addEventListener('input', _updateSeekBarColor);
        _updateSeekBarColor();
    }, 300);
})();
function parseLRC(text) {
    const lines = [];
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    text.split('\n').forEach(line => {
        const m = line.match(regex);
        if (m) {
            const time = parseInt(m[1])*60 + parseInt(m[2]) + parseInt(m[3].padEnd(3,'0'))/1000;
            const txt = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();
            if (txt) lines.push({ time, text: txt });
        }
    });
    return lines;
}

function syncLRC() {
    const audio = document.getElementById('audioPlayer');
    if (!audio || !currentLrcLines.length || isUserInteracting) return;
    // Не робимо scrollIntoView якщо відкрита модалка — це блокує UI
    const modalOpen = !!document.querySelector('.modal.open');
    const ct = audio.currentTime;
    let idx = -1;
    for (let i = 0; i < currentLrcLines.length; i++) {
        if (currentLrcLines[i].time <= ct) idx = i; else break;
    }
    if (idx === -1) return;
    const lines = document.querySelectorAll('.lrc-line');
    const cur = document.querySelector('.lrc-line.active');
    const target = lines[idx];
    if (target && cur !== target) {
        if (cur) cur.classList.remove('active');
        target.classList.add('active');
        if (!modalOpen) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// ==================== ПЕРЕКЛАД ====================
let originalLrcLines = [];
let originalTextContent = '';
let isShowingTranslated = false;
let currentTranslateMode = 'text';

async function showLyricsTab(filename, type) {
    const song = songsDatabase.find(s => s.file === filename);
    if (!song) return;
    const content = document.getElementById('lyricsContent');
    document.querySelectorAll('.lyrics-tab-btn').forEach(b => b.classList.remove('active'));

    isShowingTranslated = false;
    originalLrcLines = [];
    originalTextContent = '';
    currentTranslateMode = type === 'lrc' ? 'lrc' : 'text';
    resetTranslateUI();

    if (type === 'text') {
        if (lrcSyncInterval) { clearInterval(lrcSyncInterval); lrcSyncInterval = null; }
        currentLrcLines = [];
        originalTextContent = song.lyrics || t('noLyrics');
        content.textContent = originalTextContent;
        document.querySelector('.lyrics-tab-btn:first-child')?.classList.add('active');
    } else if (type === 'lrc' && song.lrc) {
        try {
            const resp = await fetch('./' + song.lrc);
            if (!resp.ok) throw new Error();
            const lrcText = await resp.text();
            currentLrcLines = parseLRC(lrcText);
            originalLrcLines = [...currentLrcLines];
            if (currentLrcLines.length) {
                renderLrcLines(currentLrcLines);
                if (lrcSyncInterval) clearInterval(lrcSyncInterval);
                lrcSyncInterval = setInterval(syncLRC, 100);
                syncLRC();
                document.querySelector('.lyrics-tab-btn:last-child')?.classList.add('active');
            } else {
                content.textContent = t('invalidLrc');
                currentTranslateMode = 'text';
            }
        } catch(e) {
            content.textContent = t('lrcNotAvailable');
            currentTranslateMode = 'text';
        }
    } else {
        content.textContent = t('lrcNotAvailable');
        currentTranslateMode = 'text';
    }
}

function renderLrcLines(lines) {
    const content = document.getElementById('lyricsContent');
    // Кожен рядок — клікабельний, перемотує на потрібну секунду
    content.innerHTML = lines.map((l, i) =>
        `<div class="lrc-line" data-index="${i}" onclick="seekToLrcLine(${i})">${escapeHtml(l.text)}</div>`
    ).join('');
}

function seekToLrcLine(index) {
    const audio = document.getElementById('audioPlayer');
    const line = currentLrcLines[index];
    if (!audio || !line) return;
    audio.currentTime = line.time;
    // Якщо на паузі — запускаємо
    if (audio.paused) audio.play().catch(() => {});
    // Підсвічуємо одразу
    document.querySelectorAll('.lrc-line').forEach((el, i) => {
        el.classList.toggle('active', i === index);
    });
}

function resetTranslateUI() {
    const btn = document.getElementById('translateButton');
    const origBtn = document.getElementById('showOriginalBtn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = currentLanguage === 'uk' ? '🌐 Перекласти' : '🌐 Translate';
    }
    if (origBtn) origBtn.style.display = 'none';
}

async function _translateText(text, targetLang) {
    // Спочатку пробуємо MyMemory — безкоштовний людський переклад
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=auto|${targetLang}`;
        const res = await fetchWithTimeout(url, 5000);
        if (res.ok) {
            const data = await res.json();
            if (data.responseStatus === 200 && data.responseData?.translatedText) {
                const result = data.responseData.translatedText;
                // MyMemory іноді повертає "PLEASE SELECT TWO DISTINCT LANGUAGES" — тоді fallback
                if (!result.toUpperCase().includes('PLEASE SELECT') && result.length > 3) {
                    return result;
                }
            }
        }
    } catch(e) {}

    // Fallback: Google Translate (gtx)
    const res = await fetchWithTimeout(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`,
        8000
    );
    if (!res.ok) throw new Error('translate failed');
    const data = await res.json();
    return Array.isArray(data?.[0]) ? data[0].map(p => p[0]).join('') : '';
}

async function translateLyrics() {
    const content = document.getElementById('lyricsContent');
    const button = document.getElementById('translateButton');
    if (!content || !button) return;

    const languageSelect = document.getElementById('translateLanguageSelect');
    const targetLang = languageSelect ? languageSelect.value : (currentLanguage === 'uk' ? 'en' : 'uk');

    button.disabled = true;
    button.textContent = currentLanguage === 'uk' ? '⏳ Перекладаю...' : '⏳ Translating...';

    try {
        if (currentTranslateMode === 'lrc' && originalLrcLines.length) {
            const texts = originalLrcLines.map(l => l.text).join('\n');
            const translatedText = await _translateText(texts, targetLang);
            if (!translatedText) throw new Error('Empty');

            const translatedLines = translatedText.split('\n');
            currentLrcLines = originalLrcLines.map((l, i) => ({
                time: l.time,
                text: translatedLines[i]?.trim() || l.text
            }));
            renderLrcLines(currentLrcLines);
            isShowingTranslated = true;
            showOriginalButton();

        } else {
            const srcText = isShowingTranslated ? originalTextContent : content.textContent.trim();
            if (!srcText || srcText === t('noLyrics') || srcText === t('lrcNotAvailable')) throw new Error('No text');

            const translatedText = await _translateText(srcText, targetLang);
            if (!translatedText) throw new Error('Empty');

            if (!isShowingTranslated) originalTextContent = srcText;
            content.textContent = translatedText;
            isShowingTranslated = true;
            showOriginalButton();
        }
    } catch(e) {
        showToast(currentLanguage === 'uk'
            ? '❌ Не вдалося перекласти. Перевір інтернет.'
            : '❌ Translation failed. Check your internet.');
    } finally {
        button.disabled = false;
        button.textContent = currentLanguage === 'uk' ? '🌐 Перекласти' : '🌐 Translate';
    }
}

// ==================== ТРАНСКРИПЦІЯ ====================
// Конвертує ієрогліфи (японська/китайська/корейська) в латинське читання
async function showTranscription() {
    const content = document.getElementById('lyricsContent');
    const btn = document.getElementById('transcriptionBtn');
    if (!content || !btn) return;

    const srcText = isShowingTranslated ? originalTextContent : content.textContent.trim();
    if (!srcText || srcText === t('noLyrics')) return;

    const hasKanji = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(srcText);
    if (!hasKanji) {
        showToast(currentLanguage === 'uk' ? '⚠️ Транскрипція тільки для японської/китайської/корейської' : '⚠️ Transcription only for Japanese/Chinese/Korean');
        return;
    }

    // Якщо вже показана — прибираємо
    if (btn.dataset.active === '1') {
        _hideTranscription();
        btn.dataset.active = '0';
        btn.textContent = '🔤 ' + (currentLanguage === 'uk' ? 'Транскрипція' : 'Transcription');
        return;
    }

    btn.disabled = true;
    btn.textContent = '⏳...';

    try {
        const lines = srcText.split('\n');
        const results = [];

        // Перекладаємо кожен рядок окремо щоб отримати точну транслітерацію
        for (const line of lines) {
            if (!line.trim()) { results.push({ orig: line, rom: '' }); continue; }

            // Перевіряємо чи є ієрогліфи в цьому рядку
            const lineHasKanji = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(line);
            if (!lineHasKanji) { results.push({ orig: line, rom: null }); continue; }

            try {
                const res = await fetchWithTimeout(
                    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=rm&q=${encodeURIComponent(line)}`,
                    6000
                );
                if (!res.ok) throw new Error();
                const data = await res.json();

                // data[2] — транслітерація
                let rom = '';
                if (Array.isArray(data[2])) {
                    rom = data[2].map(c => Array.isArray(c) ? (c[3] || c[0] || '') : '').filter(Boolean).join('');
                }
                // Fallback на data[0] (переклад)
                if (!rom && Array.isArray(data[0])) {
                    rom = data[0].map(p => p[0]).join('');
                }
                results.push({ orig: line, rom: rom.trim() || null });
            } catch(e) {
                results.push({ orig: line, rom: null });
            }
        }

        _renderTranscriptionInline(results);
        btn.dataset.active = '1';
        btn.textContent = '✕ ' + (currentLanguage === 'uk' ? 'Прибрати' : 'Hide');

    } catch(e) {
        showToast(currentLanguage === 'uk' ? '❌ Не вдалося отримати транскрипцію' : '❌ Could not get transcription');
    } finally {
        btn.disabled = false;
    }
}

function _renderTranscriptionInline(results) {
    const content = document.getElementById('lyricsContent');
    if (!content) return;
    // Зберігаємо оригінальний innerHTML для відновлення
    content.dataset.origHtml = content.innerHTML;

    const html = results.map(({ orig, rom }) => {
        if (!orig && !rom) return `<div class="lrc-transcription-empty"></div>`;
        if (!rom) {
            // Рядок без ієрогліфів — просто текст
            return `<div class="transcription-row"><div class="transcription-orig">${escapeHtml(orig)}</div></div>`;
        }
        return `
            <div class="transcription-row">
                <div class="transcription-rom">${escapeHtml(rom)}</div>
                <div class="transcription-orig">${escapeHtml(orig)}</div>
            </div>`;
    }).join('');

    content.innerHTML = html;
}

function _hideTranscription() {
    const content = document.getElementById('lyricsContent');
    if (!content) return;
    if (content.dataset.origHtml) {
        content.innerHTML = content.dataset.origHtml;
        delete content.dataset.origHtml;
    }
}

function _showTranscriptionModal(r, o) {} // лишаємо для сумісності

function _showTranscriptionModal(romanized, original) {
    const existing = document.getElementById('transcriptionModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal open';
    modal.id = 'transcriptionModal';
    modal.innerHTML = `
        <div class="modal-content" style="text-align:left;max-width:520px;">
            <span class="close" onclick="this.closest('.modal').remove();_checkNoModals();">&times;</span>
            <h2 style="text-align:center;">🔤 ${currentLanguage === 'uk' ? 'Транскрипція' : 'Transcription'}</h2>
            <p style="font-size:12px;color:var(--text-muted);text-align:center;margin-top:-8px;">
                ${currentLanguage === 'uk' ? 'Латинське читання оригіналу' : 'Latin reading of the original'}
            </p>
            <div style="
                background:rgba(164,194,244,0.08);
                border-radius:10px;padding:16px;
                font-size:14px;line-height:2;
                max-height:55vh;overflow-y:auto;
                white-space:pre-wrap;
                border:1px solid var(--border-light);
                font-family:'Segoe UI',Roboto,sans-serif;
                color:var(--text-primary);
                -webkit-overflow-scrolling:touch;
            ">${escapeHtml(romanized)}</div>
            <button onclick="navigator.clipboard.writeText(${JSON.stringify(romanized)}).then(()=>showToast('📋 Скопійовано!'))" style="
                width:100%;margin-top:14px;
                background:var(--accent-color);color:#1a2a3a;
                border:none;padding:11px;border-radius:10px;
                font-weight:bold;font-size:14px;cursor:pointer;
            ">📋 ${currentLanguage === 'uk' ? 'Скопіювати' : 'Copy'}</button>
        </div>
    `;
    modal.onclick = e => { if (e.target === modal) { modal.remove(); _checkNoModals(); } };
    document.body.appendChild(modal);
    _lockScroll();
}

function showOriginalButton() {
    let origBtn = document.getElementById('showOriginalBtn');
    if (!origBtn) {
        const controls = document.querySelector('.translate-controls');
        if (!controls) return;
        origBtn = document.createElement('button');
        origBtn.id = 'showOriginalBtn';
        origBtn.className = 'show-original-btn';
        controls.appendChild(origBtn);
    }
    origBtn.textContent = currentLanguage === 'uk' ? '📄 Оригінал' : '📄 Original';
    origBtn.style.display = 'inline-flex';
    origBtn.onclick = showOriginalLyrics;
}

function showOriginalLyrics() {
    const content = document.getElementById('lyricsContent');
    const origBtn = document.getElementById('showOriginalBtn');

    if (currentTranslateMode === 'lrc' && originalLrcLines.length) {
        currentLrcLines = [...originalLrcLines];
        renderLrcLines(currentLrcLines);
    } else if (originalTextContent) {
        if (content) content.textContent = originalTextContent;
    }

    isShowingTranslated = false;
    if (origBtn) origBtn.style.display = 'none';
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function showLyrics(song) {
    const section = document.getElementById('lyricsSection');
    const content = document.getElementById('lyricsContent');
    if (!section || !content) return;
    const old = section.querySelector('.lyrics-buttons');
    if (old) old.remove();
    const div = document.createElement('div');
    div.className = 'lyrics-buttons';
    div.innerHTML = `
        <button class="lyrics-tab-btn active" onclick="showLyricsTab('${song.file}', 'text')">${t('lyricsTabText')}</button>
        ${song.lrc ? `<button class="lyrics-tab-btn" onclick="showLyricsTab('${song.file}', 'lrc')">${t('lrcTabText')}</button>` : ''}
    `;
    const title = section.querySelector('h2');
    title.parentNode.insertBefore(div, title.nextSibling);
    originalTextContent = song.lyrics || t('noLyrics');
    content.textContent = originalTextContent;
    currentLrcLines = [];
    originalLrcLines = [];
    isShowingTranslated = false;
    currentTranslateMode = 'text';
    resetTranslateUI();
    const origBtn = document.getElementById('showOriginalBtn');
    if (origBtn) origBtn.style.display = 'none';
    // Додаємо кнопку транскрипції якщо є ієрогліфи
    _updateTranscriptionBtn(song);
    if (lrcSyncInterval) { clearInterval(lrcSyncInterval); lrcSyncInterval = null; }
}

function _updateTranscriptionBtn(song) {
    const controls = document.querySelector('.translate-controls');
    if (!controls) return;
    let btn = document.getElementById('transcriptionBtn');
    const lyrics = song ? (song.lyrics || '') : '';
    const hasKanji = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(lyrics);
    if (hasKanji) {
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'transcriptionBtn';
            btn.className = 'transcription-btn';
            btn.onclick = showTranscription;
            controls.appendChild(btn);
        }
        btn.textContent = '🔤 ' + (currentLanguage === 'uk' ? 'Транскрипція' : 'Transcription');
        btn.style.display = 'inline-flex';
    } else {
        if (btn) btn.style.display = 'none';
    }
}

// ==================== ІКОНКА PLAY/PAUSE ====================
function setPlayPauseIcon(isPlaying) {
    if (!playPauseBtn) return;
    if (isPlaying) {
        playPauseBtn.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;gap:4px;pointer-events:none;"><span style="display:inline-block;width:4px;height:18px;background:currentColor;border-radius:2px;pointer-events:none;"></span><span style="display:inline-block;width:4px;height:18px;background:currentColor;border-radius:2px;pointer-events:none;"></span></span>';
    } else {
        playPauseBtn.innerHTML = '<span style="display:inline-block;width:0;height:0;border-style:solid;border-width:10px 0 10px 18px;border-color:transparent transparent transparent currentColor;margin-left:4px;pointer-events:none;"></span>';
    }
}

let isRandomMode = false;

// ==================== НАВІГАЦІЯ ====================
function updateNavButtons() {
    if (!prevBtn || !nextBtn || !loopBtn) return;
    const randomBtn = document.getElementById('randomModeBtn');
    if (randomBtn) {
        randomBtn.style.display = songsDatabase.length ? 'inline-flex' : 'none';
        randomBtn.classList.toggle('active', isRandomMode);
    }
    if (isRandomMode) {
        prevBtn.style.display = 'none';
        loopBtn.style.display = 'none';
        nextBtn.style.display = 'inline-flex';
        nextBtn.title = currentLanguage === 'uk' ? 'Наступна випадкова' : 'Next random';
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('nexttrack', () => playNextRandom());
            navigator.mediaSession.setActionHandler('previoustrack', null);
        }
        return;
    }
    nextBtn.title = currentLanguage === 'uk' ? 'Далі' : 'Next';
    if (currentQueue.length <= 1) {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        loopBtn.style.display = 'none';
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('nexttrack', null);
            navigator.mediaSession.setActionHandler('previoustrack', null);
        }
        return;
    }
    loopBtn.style.display = 'inline-flex';
    if (isPlaylistLoopEnabled) {
        prevBtn.style.display = 'inline-flex';
        nextBtn.style.display = 'inline-flex';
    } else {
        prevBtn.style.display = currentQueueIndex === 0 ? 'none' : 'inline-flex';
        nextBtn.style.display = currentQueueIndex === currentQueue.length - 1 ? 'none' : 'inline-flex';
    }
    updateMediaSessionNavHandlers();
}

function toggleRandomMode() {
    isRandomMode = !isRandomMode;
    const audio = document.getElementById('audioPlayer');
    if (isRandomMode) {
        isPlaylistLoopEnabled = false;
        if (loopBtn) loopBtn.classList.remove('active');
        if (audio) {
            if (playlistEndedHandler) audio.removeEventListener('ended', playlistEndedHandler);
            playlistEndedHandler = () => playNextRandom();
            audio.addEventListener('ended', playlistEndedHandler);
        }
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('nexttrack', () => playNextRandom());
            navigator.mediaSession.setActionHandler('previoustrack', null);
        }
    } else {
        if (audio && playlistEndedHandler) {
            audio.removeEventListener('ended', playlistEndedHandler);
            playlistEndedHandler = null;
        }
        updateMediaSessionNavHandlers();
    }
    updateNavButtons();
}

// ==================== НЕ РЕКОМЕНДУВАТИ ====================
const DISLIKED_KEY = 'grab_music_disliked';

function getDisliked() {
    try { return JSON.parse(localStorage.getItem(DISLIKED_KEY) || '[]'); } catch(e) { return []; }
}

function isDisliked(filename) {
    return getDisliked().includes(filename);
}

function toggleDislike(filename) {
    const list = getDisliked();
    const idx = list.indexOf(filename);
    if (idx > -1) list.splice(idx, 1);
    else list.push(filename);
    localStorage.setItem(DISLIKED_KEY, JSON.stringify(list));
    // Оновлюємо всі меню на сторінці
    _updateThreeDotMenus(filename);
}

function _updateThreeDotMenus(filename) {
    document.querySelectorAll(`.three-dot-menu[data-file="${CSS.escape(filename)}"]`).forEach(menu => {
        const btn = menu.querySelector('.dislike-btn');
        if (btn) btn.textContent = isDisliked(filename)
            ? (currentLanguage === 'uk' ? '✅ Рекомендувати' : '✅ Recommend')
            : (currentLanguage === 'uk' ? '🚫 Не рекомендувати' : '🚫 Not interested');
    });
}

// Закриваємо всі відкриті меню при кліку поза ними
document.addEventListener('click', e => {
    if (!e.target.closest('.three-dot-wrap')) {
        document.querySelectorAll('.three-dot-menu.open').forEach(m => m.classList.remove('open'));
    }
});

function toggleThreeDotMenu(btn, filename) {
    const menu = btn.nextElementSibling;
    const wasOpen = menu.classList.contains('open');
    // Закриваємо всі
    document.querySelectorAll('.three-dot-menu.open').forEach(m => m.classList.remove('open'));
    if (!wasOpen) menu.classList.add('open');
}

// HTML для кнопки ⋯ і меню
function threeDotHtml(filename) {
    const dislikedLabel = isDisliked(filename)
        ? (currentLanguage === 'uk' ? '✅ Рекомендувати' : '✅ Recommend')
        : (currentLanguage === 'uk' ? '🚫 Не рекомендувати' : '🚫 Not interested');
    return `<div class="three-dot-wrap">
        <button class="three-dot-btn" onclick="toggleThreeDotMenu(this,'${escapeHtml(filename)}')" title="Більше">⋯</button>
        <div class="three-dot-menu" data-file="${escapeHtml(filename)}">
            <button class="dislike-btn" onclick="toggleDislike('${escapeHtml(filename)}');closeThreeDot(this)">${dislikedLabel}</button>
        </div>
    </div>`;
}

function closeThreeDot(el) {
    el.closest('.three-dot-menu')?.classList.remove('open');
}
// Кожній пісні присвоюється "вага" — чим більше % тим більша ймовірність вибору
// Стартова вага: 45. Після програвання: 0. Потім повільно відновлюється (1-4 за цикл).
const WEIGHT_DEFAULT  = 100;
const WEIGHT_PLAYED   = 0;
const WEIGHT_RECOVER_MIN = 1;
const WEIGHT_RECOVER_MAX = 4;

let songWeights = {}; // { filename: weight }

function initWeights() {
    if (!songsDatabase.length) return;
    songsDatabase.forEach(s => {
        if (!(s.file in songWeights)) {
            songWeights[s.file] = WEIGHT_DEFAULT;
        }
    });
    _saveWeights();
}

function _saveWeights() {
    try { localStorage.setItem('grab_music_weights', JSON.stringify(songWeights)); } catch(e) {}
}

function _loadWeights() {
    try {
        const stored = localStorage.getItem('grab_music_weights');
        if (stored) songWeights = JSON.parse(stored);
    } catch(e) {}
}

// Вибираємо пісню зважено: більший % = більша ймовірність
function _weightedPick(excludeFile) {
    const disliked = getDisliked();
    const songs = songsDatabase.filter(s => s.file !== excludeFile && !disliked.includes(s.file));
    // Якщо всі пісні в disliked — беремо всі (щоб не зависнути)
    const pool = songs.length ? songs : songsDatabase.filter(s => s.file !== excludeFile);
    if (!pool.length) return songsDatabase[0];

    const total = pool.reduce((sum, s) => sum + (songWeights[s.file] || WEIGHT_DEFAULT), 0);
    if (total === 0) return pool[Math.floor(Math.random() * pool.length)];

    let rand = Math.random() * total;
    for (const s of pool) {
        rand -= (songWeights[s.file] || WEIGHT_DEFAULT);
        if (rand <= 0) return s;
    }
    return pool[pool.length - 1];
}

// Викликається коли пісня ПОЧИНАЄ грати
function onSongStarted(filename) {
    // Обнуляємо поточну пісню
    songWeights[filename] = WEIGHT_PLAYED;
    _saveWeights();
}

// Викликається коли пісня ЗАКІНЧИЛА грати (або пропущена)
function onSongEnded(filename) {
    // Усім пісням додаємо 1-4% (крім тієї що щойно грала — вона ще 0)
    songsDatabase.forEach(s => {
        if (s.file === filename) return;
        const current = songWeights[s.file] ?? WEIGHT_DEFAULT;
        const bonus = Math.floor(Math.random() * (WEIGHT_RECOVER_MAX - WEIGHT_RECOVER_MIN + 1)) + WEIGHT_RECOVER_MIN;
        songWeights[s.file] = Math.min(current + bonus, WEIGHT_DEFAULT);
    });
    _saveWeights();
}

function playNextRandom() {
    if (!songsDatabase.length) return;
    const audio = document.getElementById('audioPlayer');
    const currentFile = audio ? songsDatabase.find(s => audio.src.endsWith(encodeURIComponent(s.file)) || audio.src.endsWith(s.file))?.file : null;

    // Нараховуємо бонус за завершення попередньої
    if (currentFile) onSongEnded(currentFile);

    const next = _weightedPick(currentFile);
    playSong(next.file, true);
}

// ==================== ВІДТВОРЕННЯ ====================
function playSong(filename, fromQueue = false) {
    if (!fromQueue) clearQueue();
    const audio = document.getElementById('audioPlayer');
    const nowDiv = document.getElementById('nowPlaying');
    const song = songsDatabase.find(s => s.file === filename);
    if (!song) return;

    if (lrcSyncInterval) { clearInterval(lrcSyncInterval); lrcSyncInterval = null; }

    audio.src = './music/' + filename;
    lastSrc = audio.src;
    lastTime = 0;
    nowDiv.innerHTML = `<img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="player-image" onerror="this.src='./fotomusic/no-photo.jpg'"> ${t('nowPlayingLabel')} <strong>${escapeHtml(song.name)}</strong> - ${escapeHtml(song.artist)} ${threeDotHtml(song.file)}`;
    showLyrics(song);
    if (seekBar) seekBar.value = 0;
    if (currentTimeLabel)  currentTimeLabel.textContent  = '0:00';
    if (durationTimeLabel) durationTimeLabel.textContent = '0:00';
    if (playPauseBtn) { playPauseBtn.classList.remove('disabled'); setPlayPauseIcon(true); }

    updateMediaSession(song);

    audio.play().then(() => {
        // Обнуляємо відсоток поточної пісні
        onSongStarted(filename);
        // Застосовуємо збережену швидкість
        const savedSpeed = parseFloat(localStorage.getItem('grab_music_speed') || '1');
        audio.playbackRate = savedSpeed;
        if (currentLrcLines.length && !lrcSyncInterval) lrcSyncInterval = setInterval(syncLRC, 100);
        if (localStorage.getItem('grab_music_eq') !== 'false' && !isEqInitialized) {
            initEqualizer();
        } else if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
        if (isRandomMode && !playlistEndedHandler) {
            playlistEndedHandler = () => playNextRandom();
            audio.addEventListener('ended', playlistEndedHandler);
        }
        if (isEqInitialized && !analyser) initBassAnalyser();
        if (!isEqInitialized && !analyser && audioContext) {
            try {
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.7;
                if (sourceNode) sourceNode.connect(analyser);
                startBassShake();
            } catch(e) {}
        }
        if (analyser) startBassShake();
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
        requestWakeLock();
        startAudioKeepAlive(audio);
        startKeepAlive();
        startSwPing();
    }).catch(e => console.log('play blocked:', e));

    updateNavButtons();
}

function clearQueue() {
    const audio = document.getElementById('audioPlayer');
    if (playlistEndedHandler && audio) {
        audio.removeEventListener('ended', playlistEndedHandler);
        playlistEndedHandler = null;
    }
    currentQueue = [];
    currentQueueIndex = -1;
    isPlaylistLoopEnabled = false;
    if (loopBtn) loopBtn.classList.remove('active');
    updateNavButtons();
}

function playNext() {
    if (isRandomMode) { playNextRandom(); return; }
    if (currentQueue.length <= 1) return;
    let next = currentQueueIndex + 1;
    if (next >= currentQueue.length) {
        if (isPlaylistLoopEnabled) next = 0; else return;
    }
    currentQueueIndex = next;
    playSong(currentQueue[currentQueueIndex], true);
}

function playPrev() {
    if (currentQueue.length <= 1) return;
    let prev = currentQueueIndex - 1;
    if (prev < 0) {
        if (isPlaylistLoopEnabled) prev = currentQueue.length - 1; else return;
    }
    currentQueueIndex = prev;
    playSong(currentQueue[currentQueueIndex], true);
}

function playPlaylist(songFiles) {
    if (!songFiles || !songFiles.length) return;
    clearQueue();
    currentQueue = [...songFiles];
    currentQueueIndex = 0;
    // ended handler не потрібен — onended в setupAudioListeners вже викликає playNext()
    playSong(currentQueue[0], true);
    updateNavButtons();
}

function toggleLoop() {
    if (currentQueue.length <= 1) return;
    isPlaylistLoopEnabled = !isPlaylistLoopEnabled;
    if (loopBtn) loopBtn.classList.toggle('active', isPlaylistLoopEnabled);
    updateNavButtons();
}

// ==================== ЗАВАНТАЖЕННЯ ФАЙЛУ ====================
function downloadSong(filename) {
    const a = document.createElement('a');
    a.href = './music/' + filename;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// ==================== ПОШУК ====================
function searchSongs() {
    const input = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');
    const raw = input.value.trim();
    const q = raw.toLowerCase();
    if (!q) { results.innerHTML = ''; return; }

    // Секретна команда #ALL# — показує всі пісні
    const isAll = raw.toUpperCase() === '#ALL#';
    const found = isAll
        ? [...songsDatabase]
        : songsDatabase.filter(s =>
            s.name.toLowerCase().includes(q) ||
            s.artist.toLowerCase().includes(q) ||
            (s.lyrics && s.lyrics.toLowerCase().includes(q))
          );

    if (!found.length) { results.innerHTML = `<p class="no-results">${t('noResults')}</p>`; return; }

    if (isAll) {
        results.innerHTML = `<p style="text-align:center;font-size:13px;color:var(--text-muted);margin:0 0 12px;">🎵 ${currentLanguage === 'uk' ? 'Всі пісні' : 'All songs'} — ${found.length}</p>` +
        found.map(song => `
        <div class="result-item">
            <img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="song-image" onerror="this.src='./fotomusic/no-photo.jpg'">
            <div class="result-info">
                <h3>${escapeHtml(song.name)}</h3>
                <p>${escapeHtml(song.artist)}</p>
            </div>
            <div class="result-buttons">
                <button class="play-btn" onclick="playSong('${escapeHtml(song.file)}', false)">▶${t('playBtn')}</button>
                <button class="download-btn" onclick="downloadSong('${escapeHtml(song.file)}')">⬇${t('downloadBtn')}</button>
                <button class="like-btn ${isFavorite(song.file) ? 'liked' : ''}" data-filename="${escapeHtml(song.file)}" onclick="toggleFavorite('${escapeHtml(song.file)}')">❤️</button>
                <button class="share-btn" onclick="shareSong('${escapeHtml(song.file)}')">🔗</button>
            </div>
        </div>`).join('');
        return;
    }

    results.innerHTML = found.map(song => {
        let lyricsHint = '';
        if (song.lyrics && song.lyrics.toLowerCase().includes(q) &&
            !song.name.toLowerCase().includes(q) && !song.artist.toLowerCase().includes(q)) {
            const idx = song.lyrics.toLowerCase().indexOf(q);
            const start = Math.max(0, idx - 30);
            const end = Math.min(song.lyrics.length, idx + q.length + 30);
            let snippet = song.lyrics.slice(start, end).replace(/\n/g, ' ');
            if (start > 0) snippet = '...' + snippet;
            if (end < song.lyrics.length) snippet += '...';
            const highlighted = snippet.replace(
                new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
                m => `<mark style="background:var(--accent-color);color:#1a2a3a;border-radius:3px;padding:0 2px;">${escapeHtml(m)}</mark>`
            );
            lyricsHint = `<small style="display:block;color:var(--text-muted);font-size:11px;margin-top:4px;font-style:italic;">📝 ${highlighted}</small>`;
        }
        return `
        <div class="result-item">
            <img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="song-image" onerror="this.src='./fotomusic/no-photo.jpg'">
            <div class="result-info">
                <h3>${escapeHtml(song.name)}</h3>
                <p>${escapeHtml(song.artist)}</p>
                ${lyricsHint}
            </div>
            <div class="result-buttons">
                <button class="play-btn" onclick="playSong('${escapeHtml(song.file)}', false)">▶${t('playBtn')}</button>
                <button class="download-btn" onclick="downloadSong('${escapeHtml(song.file)}')">⬇${t('downloadBtn')}</button>
                <button class="like-btn ${isFavorite(song.file) ? 'liked' : ''}" data-filename="${escapeHtml(song.file)}" onclick="toggleFavorite('${escapeHtml(song.file)}')">❤️</button>
                <button class="share-btn" onclick="shareSong('${escapeHtml(song.file)}')">🔗</button>
            </div>
        </div>
    `}).join('');
}

function randomSong() {
    if (!songsDatabase.length) return;
    const audio = document.getElementById('audioPlayer');
    const currentFile = audio ? songsDatabase.find(s => audio.src.endsWith(encodeURIComponent(s.file)) || audio.src.endsWith(s.file))?.file : null;
    const song = _weightedPick(currentFile);
    const results = document.getElementById('searchResults');
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    results.innerHTML = `
        <div class="result-item random-highlight">
            <img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="song-image" onerror="this.src='./fotomusic/no-photo.jpg'">
            <div class="result-info">
                <h3>${escapeHtml(song.name)}</h3>
                <p>${escapeHtml(song.artist)}</p>
                <small style="color:var(--accent-dark);font-size:11px;">🎲 ${currentLanguage === 'uk' ? 'Випадкова пісня' : 'Random song'}</small>
            </div>
            <div class="result-buttons">
                <button class="play-btn" onclick="playSong('${escapeHtml(song.file)}', false)">▶${t('playBtn')}</button>
                <button class="download-btn" onclick="downloadSong('${escapeHtml(song.file)}')">⬇${t('downloadBtn')}</button>
                <button class="like-btn ${isFavorite(song.file) ? 'liked' : ''}" data-filename="${escapeHtml(song.file)}" onclick="toggleFavorite('${escapeHtml(song.file)}')">❤️</button>
                <button class="share-btn" onclick="shareSong('${escapeHtml(song.file)}')">🔗</button>
            </div>
        </div>
    `;
    playSong(song.file, false);
}

// ==================== НОВИНИ ====================
let newsDatabase = [];

async function loadNews() {
    try {
        const res = await fetch('./news.json');
        if (!res.ok) throw new Error();
        newsDatabase = await res.json();
        updateNewsBadge();
    } catch(e) { newsDatabase = []; }
}

function updateNewsBadge() {
    const badge = document.getElementById('newsBadge');
    if (!badge) return;
    const lastSeen = parseInt(localStorage.getItem('grab_music_news_seen') || '0');
    const unseen = newsDatabase.filter(n => n.id > lastSeen).length;
    badge.textContent = unseen;
    badge.style.display = unseen > 0 ? 'inline-flex' : 'none';
}

function openNews() {
    const modal = document.getElementById('news-modal');
    const list  = document.getElementById('newsList');
    if (!modal || !list) return;
    if (!newsDatabase.length) {
        list.innerHTML = `<p class="news-empty">📭 ${currentLanguage === 'uk' ? 'Новин поки немає' : 'No news yet'}</p>`;
    } else {
        list.innerHTML = newsDatabase.slice().reverse().map(n => {
            const title = currentLanguage === 'uk' ? n.title_uk : n.title_en;
            const text  = currentLanguage === 'uk' ? n.text_uk  : n.text_en;
            const tag   = currentLanguage === 'uk' ? n.tag_uk   : n.tag_en;
            const date  = new Date(n.date).toLocaleDateString(
                currentLanguage === 'uk' ? 'uk-UA' : 'en-US',
                { year: 'numeric', month: 'long', day: 'numeric' }
            );
            return `<div class="news-card">
                <div class="news-card-header"><span class="news-tag">${tag}</span><span class="news-date">${date}</span></div>
                <h3>${title}</h3><p>${text}</p>
            </div>`;
        }).join('');
    }
    if (newsDatabase.length) {
        const maxId = Math.max(...newsDatabase.map(n => n.id));
        localStorage.setItem('grab_music_news_seen', maxId);
        updateNewsBadge();
    }
    _lockScroll();
    modal.classList.add('open');
}

function closeNews() {
    const modal = document.getElementById('news-modal');
    if (modal) modal.classList.remove('open');
    _checkNoModals();
}

// ==================== ПОШИРЕННЯ ====================
function shareSong(filename) {
    const song = songsDatabase.find(s => s.file === filename);
    if (!song) return;
    const slug = encodeURIComponent(song.name + ' - ' + song.artist);
    const url = window.location.origin + window.location.pathname + '?song=' + slug;
    if (navigator.share) {
        navigator.share({ title: song.name + ' — ' + song.artist, text: 'Слухай: ' + song.name, url });
    } else {
        navigator.clipboard.writeText(url).then(() => {
            showToast(currentLanguage === 'uk' ? '🔗 Посилання скопійовано!' : '🔗 Link copied!');
        }).catch(() => { prompt('Скопіюй посилання:', url); });
    }
}

function showToast(msg) {
    let toast = document.getElementById('shareToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'shareToast';
        toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;z-index:99999;transition:opacity 0.3s;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._hide);
    toast._hide = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

function checkShareUrl() {
    const params = new URLSearchParams(window.location.search);
    const songParam = params.get('song');
    if (!songParam) return;
    const decoded = decodeURIComponent(songParam).toLowerCase();
    const song = songsDatabase.find(s => (s.name + ' - ' + s.artist).toLowerCase() === decoded);
    if (song) {
        const results = document.getElementById('searchResults');
        if (results) {
            results.innerHTML = `
                <div class="result-item random-highlight">
                    <img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="song-image" onerror="this.src='./fotomusic/no-photo.jpg'">
                    <div class="result-info">
                        <h3>${escapeHtml(song.name)}</h3>
                        <p>${escapeHtml(song.artist)}</p>
                        <small style="color:var(--accent-dark);font-size:11px;">🔗 ${currentLanguage === 'uk' ? 'Поширена пісня' : 'Shared song'}</small>
                    </div>
                    <div class="result-buttons">
                        <button class="play-btn" onclick="playSong('${escapeHtml(song.file)}',false)">▶${t('playBtn')}</button>
                        <button class="download-btn" onclick="downloadSong('${escapeHtml(song.file)}')">⬇${t('downloadBtn')}</button>
                        <button class="like-btn ${isFavorite(song.file)?'liked':''}" data-filename="${escapeHtml(song.file)}" onclick="toggleFavorite('${escapeHtml(song.file)}')">❤️</button>
                        <button class="share-btn" onclick="shareSong('${escapeHtml(song.file)}')">🔗</button>
                    </div>
                </div>`;
        }
        setTimeout(() => playSong(song.file, false), 500);
    }
}

// ==================== SERVICE WORKER ====================
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('✅ SW registered'))
        .catch(e => console.warn('SW failed:', e));
}

function precacheMusicFiles() {
    if (!('serviceWorker' in navigator) || !songsDatabase.length) return;
    const files = songsDatabase.map(s => './music/' + s.file);
    const send = () => {
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'PRECACHE_MUSIC', files });
            console.log('📦 Precaching', files.length, 'tracks...');
        } else {
            navigator.serviceWorker.ready.then(() => setTimeout(() => precacheMusicFiles(), 1000));
        }
    };
    send();
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'PRECACHE_DONE') {
            console.log('✅ All', e.data.count, 'tracks cached');
        }
    });
}

let swPingInterval = null;
function startSwPing() {
    stopSwPing();
    if (!('serviceWorker' in navigator)) return;
    swPingInterval = setInterval(() => {
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage('keepalive');
        }
    }, 20000);
}
function stopSwPing() {
    if (swPingInterval) { clearInterval(swPingInterval); swPingInterval = null; }
}

// ==================== ШВИДКІСТЬ ВІДТВОРЕННЯ ====================
function setPlaybackSpeed(val) {
    const speed = parseFloat(val);
    const audio = document.getElementById('audioPlayer');
    if (audio) audio.playbackRate = speed;
    localStorage.setItem('grab_music_speed', String(speed));
    const label = document.getElementById('speedLabel');
    if (label) label.textContent = speed + '×';
    const slider = document.getElementById('speedSlider');
    if (slider && parseFloat(slider.value) !== speed) slider.value = speed;
}

function loadSpeedPreference() {
    const saved = parseFloat(localStorage.getItem('grab_music_speed') || '1');
    const slider = document.getElementById('speedSlider');
    const label  = document.getElementById('speedLabel');
    if (slider) {
        slider.value = saved;
        // Підключаємо обробник один раз
        if (!slider.dataset.bound) {
            slider.dataset.bound = '1';
            slider.addEventListener('input', e => setPlaybackSpeed(e.target.value));
        }
    }
    if (label) label.textContent = saved + '×';
}
// ==================== ІНТЕРАКТИВНИЙ ТУТОРІАЛ ====================
const TOUR_STEPS = [
    { selector: '.top-buttons',        uk: '⚙️ Зверху — кнопки налаштувань, преміум і підтримки автора', en: '⚙️ Top buttons: settings, premium and support' },
    { selector: '.lang-buttons-row',   uk: '🌐 Перемикач мови — УК або EN', en: '🌐 Language switcher — UK or EN' },
    { selector: '#playlistsContainer', uk: '📋 Плейлисти — твої улюблені, українські та іноземні пісні. Клікай щоб відкрити!', en: '📋 Playlists — favorites, Ukrainian and foreign songs. Click to open!' },
    { selector: '.search-section',     uk: '🔍 Пошук — пиши назву або частину тексту пісні. Спробуй #ALL# щоб побачити всі пісні!', en: '🔍 Search by name or lyrics. Try #ALL# to see all songs!' },
    { selector: '.player-section',     uk: '🎵 Плеєр — тут керуєш музикою. Є кнопки prev/next, loop і рандом', en: '🎵 Player — control music here. Has prev/next, loop and random' },
    { selector: '#seekBar',            uk: '🌈 Прогрес-бар — тягни для перемотки. Колір змінюється від синього до помаранчевого!', en: '🌈 Progress bar — drag to seek. Color changes blue → orange!' },
    { selector: '#randomModeBtn',      uk: '🔀 Рандомний режим — пісні не повторюватимуться, система сама слідкує за цим', en: '🔀 Random mode — no repeats, system tracks what was played' },
    { selector: '#lyricsSection',      uk: '📝 Текст пісні — підтримує текст і LRC. Натисни на рядок LRC щоб перемотати до нього!', en: '📝 Lyrics — text and LRC supported. Click an LRC line to seek!' },
    { selector: '.translate-controls', uk: '🌐 Переклад — обери мову і натисни кнопку. Переклад заміняє оригінал, є кнопка повернення', en: '🌐 Translation — pick language, translate replaces original' },
    { selector: '.contact-footer',     uk: '📬 Контакти внизу — пиши нам щоб додати пісню або повідомити про помилку!', en: '📬 Footer contacts — write us to add songs or report bugs!' },
];

let _tourStep = 0;
let _tourOverlay = null;

function startTour() {
    closeModal();
    _tourStep = 0;
    _tourOverlay = document.createElement('div');
    _tourOverlay.id = 'tourOverlay';
    _tourOverlay.style.cssText = 'position:fixed;inset:0;z-index:50000;pointer-events:none;';
    _tourOverlay.innerHTML = `
        <div id="tourHighlight" style="position:fixed;border-radius:12px;box-shadow:0 0 0 5px #a4c2f4,0 0 0 9999px rgba(0,0,0,0.7);transition:all 0.4s ease;pointer-events:none;"></div>
        <div id="tourTooltip" style="
            position:fixed;z-index:50001;opacity:0;
            background:var(--modal-bg,#fff);color:var(--text-primary,#333);
            border-radius:16px;padding:18px 20px;max-width:300px;width:300px;
            box-shadow:0 8px 30px rgba(0,0,0,0.5);border:2px solid var(--accent-color);
            font-family:'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;
            transition:opacity 0.3s ease,top 0.4s ease,left 0.4s ease;pointer-events:auto;
        ">
            <div id="tourText" style="margin-bottom:12px;"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                <span id="tourCounter" style="font-size:12px;color:var(--text-muted);white-space:nowrap;"></span>
                <div style="display:flex;gap:8px;">
                    <button onclick="stopTour()" style="background:transparent;border:1px solid var(--border-light);color:var(--text-muted);padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px;pointer-events:auto;">✕</button>
                    <button onclick="nextTourStep()" id="tourNextBtn" style="background:var(--accent-color);color:#1a2a3a;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;pointer-events:auto;">Далі →</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(_tourOverlay);
    _showTourStep(0);
}

function _showTourStep(idx) {
    if (idx >= TOUR_STEPS.length) { stopTour(); return; }
    const step = TOUR_STEPS[idx];
    const el = document.querySelector(step.selector);
    const tooltip   = document.getElementById('tourTooltip');
    const highlight = document.getElementById('tourHighlight');
    const counter   = document.getElementById('tourCounter');
    const nextBtn   = document.getElementById('tourNextBtn');
    if (!tooltip || !highlight) return;

    document.getElementById('tourText').textContent = currentLanguage === 'uk' ? step.uk : step.en;
    counter.textContent = `${idx + 1} / ${TOUR_STEPS.length}`;
    nextBtn.textContent = idx === TOUR_STEPS.length - 1
        ? (currentLanguage === 'uk' ? '🎉 Готово!' : '🎉 Done!')
        : (currentLanguage === 'uk' ? 'Далі →' : 'Next →');

    // Ховаємо highlight поки скролимо
    highlight.style.opacity = '0';
    tooltip.style.opacity   = '0';

    if (!el) return;

    // Скролимо до елементу
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Чекаємо завершення скролу (500мс достатньо для smooth)
    setTimeout(() => {
        const r   = el.getBoundingClientRect();
        const pad = 10;
        const TW  = 300;
        const TH  = 160;

        // Highlight — точно по BoundingClientRect після скролу
        highlight.style.cssText = `
            position:fixed;border-radius:12px;pointer-events:none;opacity:1;
            box-shadow:0 0 0 5px #a4c2f4,0 0 0 9999px rgba(0,0,0,0.72);
            transition:opacity 0.3s ease;
            left:${Math.round(r.left - pad)}px;
            top:${Math.round(r.top  - pad)}px;
            width:${Math.round(r.width  + pad * 2)}px;
            height:${Math.round(r.height + pad * 2)}px;
        `;

        // Тултіп — під елементом або над, в залежності від місця
        let tipTop  = r.bottom + 16;
        let tipLeft = r.left;

        // Якщо не влазить знизу — ставимо зверху
        if (tipTop + TH > window.innerHeight - 10) tipTop = r.top - TH - 12;
        // Якщо не влазить зверху — по центру екрану
        if (tipTop < 10) tipTop = Math.max(10, (window.innerHeight - TH) / 2);
        // Не виходимо за правий і лівий краї
        if (tipLeft + TW > window.innerWidth - 10) tipLeft = window.innerWidth - TW - 10;
        if (tipLeft < 10) tipLeft = 10;

        tooltip.style.cssText += `opacity:1;left:${tipLeft}px;top:${tipTop}px;`;
    }, 550);
}

function nextTourStep() {
    _tourStep++;
    _showTourStep(_tourStep);
}

function stopTour() {
    if (_tourOverlay) { _tourOverlay.remove(); _tourOverlay = null; }
}

// ==================== ДОНАТ ====================
function openDonate() {
    closeSettings();
    const modal = document.createElement('div');
    modal.className = 'modal open';
    modal.id = 'donate-modal';
    modal.innerHTML = `
        <div class="modal-content" style="text-align:center;">
            <span class="close" onclick="this.closest('.modal').remove();_checkNoModals();">&times;</span>
            <h2>💵 Донат</h2>
            <p style="font-size:14px;color:var(--text-muted);margin:0 0 20px;">Дякуємо за підтримку! Це допомагає розвивати сайт 🙏</p>
            <!-- ВСТАВТЕ СВОЇ РЕКВІЗИТИ НИЖЧЕ -->
            <div style="
                background:rgba(164,194,244,0.1);
                border:2px dashed var(--accent-color);
                border-radius:14px;padding:20px;margin-bottom:16px;
                font-family:'Comfortaa',cursive;
            ">
                <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">💳 Карта (Monobank / PrivatBank)</div>
                <div id="donateCardNumber" style="font-size:20px;font-weight:700;letter-spacing:3px;color:var(--text-primary);cursor:pointer;" onclick="copyDonateCard()" title="Натисни щоб скопіювати">
                    #### #### #### ####
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">← вставте номер картки тут у java.js</div>
            </div>
            <button onclick="copyDonateCard()" style="
                background:linear-gradient(135deg,#a4c2f4,#5d9cec);
                color:#1a2a3a;border:none;padding:12px 28px;
                border-radius:30px;font-weight:bold;font-size:14px;cursor:pointer;
                font-family:'Comfortaa',cursive;
            ">📋 Скопіювати номер</button>
            <p style="font-size:11px;color:var(--text-muted);margin-top:14px;">
                Будь-яка сума буде дуже приємна ❤️
            </p>
        </div>
    `;
    modal.onclick = e => { if (e.target === modal) { modal.remove(); _checkNoModals(); } };
    document.body.appendChild(modal);
    _lockScroll();
}

function copyDonateCard() {
    // ВСТАВТЕ НОМЕР КАРТКИ ТУТ:
    const cardNumber = '#### #### #### ####';
    // ^^^^ ЗАМІНІТЬ НА СВІЙ НОМЕР КАРТКИ ^^^^
    navigator.clipboard.writeText(cardNumber.replace(/\s/g, '')).then(() => {
        showToast('📋 Номер картки скопійовано!');
    }).catch(() => {
        prompt('Скопіюй номер картки:', cardNumber);
    });
}

// ==================== МОВА ====================
function switchLanguage(lang) {
    window.location.href = lang === 'uk' ? './index.html' : './index_en.html';
}

// ==================== МОДАЛЬНІ ВІКНА ====================
function openModal()         { _lockScroll(); document.getElementById('tutorial-modal').classList.add('open'); }
function closeModal()        { document.getElementById('tutorial-modal').classList.remove('open'); _checkNoModals(); }
function openPremiumModal()  { _lockScroll(); document.getElementById('premium-modal').classList.add('open'); }
function closePremiumModal() { document.getElementById('premium-modal').classList.remove('open'); _checkNoModals(); }
function openSettings()      { _lockScroll(); document.getElementById('settings-modal').classList.add('open'); loadShakePreference(); loadSpeedPreference(); }
function closeSettings()     { document.getElementById('settings-modal').classList.remove('open'); _checkNoModals(); }
function _checkNoModals()    { if (!document.querySelector('.modal.open')) _unlockScroll(); }

let _scrollY = 0;
function _lockScroll() {
    if (document.body.classList.contains('modal-open')) return;
    _scrollY = window.scrollY || window.pageYOffset;
    document.body.classList.add('modal-open');
}
function _unlockScroll() {
    document.body.classList.remove('modal-open');
    window.scrollTo(0, _scrollY);
}

window.onclick = function(e) {
    if (e.target === document.getElementById('tutorial-modal'))  closeModal();
    if (e.target === document.getElementById('premium-modal'))   closePremiumModal();
    if (e.target === document.getElementById('settings-modal'))  closeSettings();
    if (e.target === document.getElementById('news-modal'))      closeNews();
};

// ==================== КАСТОМНИЙ ПЛЕЄР ====================
function setupAudioListeners() {
    const audio = document.getElementById('audioPlayer');
    if (!audio || audio.hasAttribute('data-listener')) return;
    audio.setAttribute('data-listener', 'true');
    playPauseBtn      = document.getElementById('playPauseBtn');
    nextBtn           = document.getElementById('nextBtn');
    prevBtn           = document.getElementById('prevBtn');
    loopBtn           = document.getElementById('loopBtn');
    seekBar           = document.getElementById('seekBar');
    currentTimeLabel  = document.getElementById('currentTime');
    durationTimeLabel = document.getElementById('durationTime');

    function hasTrack() { return audio.src && audio.src !== '' && audio.src !== window.location.href; }
    function updatePlayBtn() {
        if (!playPauseBtn) return;
        playPauseBtn.classList.toggle('disabled', !hasTrack());
        setPlayPauseIcon(hasTrack() && !audio.paused);
    }

    if (playPauseBtn) playPauseBtn.onclick = () => {
        if (!hasTrack()) return;
        if (audio.paused) audio.play(); else audio.pause();
    };
    if (nextBtn) nextBtn.onclick = playNext;
    if (prevBtn) prevBtn.onclick = playPrev;
    if (loopBtn) loopBtn.onclick = toggleLoop;
    if (seekBar) seekBar.oninput = () => {
        if (!hasTrack() || isNaN(audio.duration)) return;
        audio.currentTime = audio.duration * (seekBar.value / 100);
    };

    audio.ontimeupdate = () => {
        if (!hasTrack() || isNaN(audio.duration) || audio.duration <= 0) return;
        seekBar.value = (audio.currentTime / audio.duration) * 100;
        currentTimeLabel.textContent  = formatTime(audio.currentTime);
        durationTimeLabel.textContent = formatTime(audio.duration);
        lastTime = audio.currentTime;
        updateMediaSessionState(audio);
        updatePlayBtn();
    };

    audio.onplay = () => {
        updatePlayBtn();
        updateMediaSessionState(audio);
        if (audioContext && audioContext.state === 'suspended') audioContext.resume();
        requestWakeLock();
        startAudioKeepAlive(audio);
        startKeepAlive();
        startSwPing();
        if (analyser) startBassShake();
        if (currentLrcLines.length && !lrcSyncInterval) {
            lrcSyncInterval = setInterval(syncLRC, 100);
            syncLRC();
        }
    };

    audio.onpause = () => {
        updatePlayBtn();
        updateMediaSessionState(audio);
        releaseWakeLock();
        stopAudioKeepAlive();
        stopKeepAlive();
        stopSwPing();
        stopBassShake();
        if (lrcSyncInterval) { clearInterval(lrcSyncInterval); lrcSyncInterval = null; }
    };

    audio.onended = () => {
        updateMediaSessionState(audio);
        // Авто-перехід у плейлисті (якщо не рандомний режим — там є свій handler)
        if (!isRandomMode && currentQueue.length > 1) {
            playNext();
        }
    };

    // Застосовуємо швидкість після завантаження нового треку
    audio.oncanplay = () => {
        const speed = parseFloat(localStorage.getItem('grab_music_speed') || '1');
        if (audio.playbackRate !== speed) audio.playbackRate = speed;
    };

    let _errorCount = 0;
    let _errorTimer = null;
    audio.onerror = () => {
        // Захист від нескінченного циклу помилок (офлайн режим)
        _errorCount++;
        clearTimeout(_errorTimer);
        _errorTimer = setTimeout(() => { _errorCount = 0; }, 3000);
        if (_errorCount > 3) {
            console.warn('Too many errors, stopping');
            _errorCount = 0;
            return;
        }
        console.warn('Audio error, skipping');
        if (currentQueue.length > 1) playNext();
        else if (isRandomMode) playNextRandom();
    };

    setPlayPauseIcon(false);

    ['scroll', 'wheel', 'touchmove'].forEach(ev => {
        document.addEventListener(ev, () => {
            isUserInteracting = true;
            setTimeout(() => isUserInteracting = false, 500);
        }, { passive: true });
    });
}

function formatTime(sec) {
    if (isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' + s : s}`;
}

// ==================== ПЛЕЙЛИСТИ ====================
function renderPlaylistSongs(songs) {
    return songs.length ? songs.map(song => `
        <div class="result-item">
            <img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="song-image" onerror="this.src='./fotomusic/no-photo.jpg'">
            <div class="result-info">
                <h3>${escapeHtml(song.name)}</h3>
                <p>${escapeHtml(song.artist)}</p>
            </div>
            <div class="result-buttons">
                <button class="play-btn" onclick="playSong('${escapeHtml(song.file)}',false)">▶${t('playBtn')}</button>
                <button class="download-btn" onclick="downloadSong('${escapeHtml(song.file)}')">⬇${t('downloadBtn')}</button>
                <button class="like-btn ${isFavorite(song.file)?'liked':''}" data-filename="${escapeHtml(song.file)}" onclick="toggleFavorite('${escapeHtml(song.file)}')">❤️</button>
                <button class="share-btn" onclick="shareSong('${escapeHtml(song.file)}')">🔗</button>
            </div>
        </div>
    `).join('') : `<p style="text-align:center;color:rgba(255,255,255,0.7);padding:16px;">${currentLanguage === 'en' ? 'No songs yet' : 'Пісень ще немає'}</p>`;
}

function buildPlaylistCard(pl, options = {}) {
    const name = currentLanguage === 'en' ? (pl.name_en || pl.name) : pl.name;
    const desc = currentLanguage === 'en' ? (pl.description_en || pl.description) : pl.description;
    const songs = pl.songs.map(fn => songsDatabase.find(s => s.file === fn)).filter(Boolean);
    const songCountText = `${pl.songs.length} ${currentLanguage === 'en' ? 'songs' : 'пісень'}`;

    // ФІКС: екрануємо JSON для onclick
    const songsJson = JSON.stringify(pl.songs).replace(/"/g, '&quot;');
    const playAllBtn = songs.length
        ? `<button class="play-all-btn" onclick="event.stopPropagation();playPlaylist(${songsJson})">▶ ${t('playAllBtn')}</button>`
        : '';

    const classes = [
        'playlist-item',
        options.compact ? 'playlist-item-compact' : '',
        options.pinned ? 'playlist-item-pinned' : '',
        options.otherList ? 'playlist-item-other-list' : ''
    ].filter(Boolean).join(' ');

    if (options.compact || options.collapsible) {
        const isOpen = options.defaultOpen === true;
        return `
            <div class="${classes}" id="playlist-${pl.id}">
                <div class="playlist-header" onclick="togglePlaylist('${pl.id}')">
                    <div class="playlist-info">
                        <h3>📋 ${escapeHtml(name)}</h3>
                        <p>${escapeHtml(desc)}</p>
                        <small>${songCountText}</small>
                    </div>
                    <div class="playlist-header-btns">
                        ${playAllBtn}
                        <button class="view-btn playlist-toggle-btn${isOpen ? ' active' : ''}" onclick="event.stopPropagation();togglePlaylist('${pl.id}')">
                            ${t('viewBtn')} <span class="toggle-arrow">${isOpen ? '▲' : '▼'}</span>
                        </button>
                    </div>
                </div>
                <div class="playlist-dropdown" id="dropdown-${pl.id}" style="display:${isOpen ? 'block' : 'none'};">
                    ${renderPlaylistSongs(songs)}
                </div>
            </div>`;
    }

    return `
        <div class="${classes}" id="playlist-${pl.id}">
            <div class="playlist-header">
                <div class="playlist-info">
                    <h3>📋 ${escapeHtml(name)}</h3>
                    <p>${escapeHtml(desc)}</p>
                    <small>${songCountText}</small>
                </div>
                <div class="playlist-header-btns">${playAllBtn}</div>
            </div>
            <div class="playlist-dropdown" id="dropdown-${pl.id}" style="display:block;">
                ${renderPlaylistSongs(songs)}
            </div>
        </div>`;
}

function displayPlaylists() {
    const container = document.getElementById('playlistsContainer');
    if (!container) return;
    if (!playlistsDatabase.length) {
        container.innerHTML = '<p style="text-align:center;color:gray;">⚠️ Немає плейлистів</p>';
        return;
    }

    const pinnedIds = ['favorites', 'ukrainian', 'foreign'];
    const pinnedPlaylists = [];
    const otherPlaylists = [];

    playlistsDatabase.forEach(pl => {
        if (pinnedIds.includes(pl.id)) pinnedPlaylists.push(pl);
        else otherPlaylists.push(pl);
    });

    const pinnedMarkup = pinnedPlaylists.map(pl => buildPlaylistCard(pl, {
        pinned: true, collapsible: true, defaultOpen: false
    })).join('');

    let otherMarkup = '';
    if (otherPlaylists.length) {
        otherMarkup = `
            <div class="playlist-item other-playlists-group playlist-item-other-list" id="playlist-other-group">
                <div class="playlist-header other-playlists-header" onclick="togglePlaylist('other-group')">
                    <div class="playlist-info">
                        <h3>📚 ${currentLanguage === 'en' ? 'Other playlists' : 'Інші списки відтворення'}</h3>
                        <p>${currentLanguage === 'en' ? 'Open to view all additional playlists' : 'Відкрий, щоб побачити всі додаткові списки'}</p>
                        <small>${otherPlaylists.length} ${currentLanguage === 'en' ? 'playlists' : 'плейлистів'}</small>
                    </div>
                    <div class="playlist-header-btns">
                        <button class="view-btn playlist-toggle-btn" onclick="event.stopPropagation();togglePlaylist('other-group')">
                            ${t('viewBtn')} <span class="toggle-arrow">▼</span>
                        </button>
                    </div>
                </div>
                <div class="playlist-dropdown other-playlists-dropdown" id="dropdown-other-group" style="display:none;">
                    ${otherPlaylists.map(pl => buildPlaylistCard(pl, { compact: true, otherList: true })).join('')}
                </div>
            </div>`;
    }

    container.innerHTML = pinnedMarkup + otherMarkup;
}

function togglePlaylist(id) {
    const dropdown = document.getElementById('dropdown-' + id);
    const arrow = document.querySelector(`#playlist-${id} > .playlist-header .toggle-arrow`);
    const btn   = document.querySelector(`#playlist-${id} > .playlist-header .playlist-toggle-btn`);
    if (!dropdown) return;
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : 'block';
    if (arrow) arrow.textContent = isOpen ? '▼' : '▲';
    if (btn) btn.classList.toggle('active', !isOpen);
}

function isFavorite(filename) {
    const fav = playlistsDatabase.find(p => p.id === 'favorites');
    return fav ? fav.songs.includes(filename) : false;
}

function toggleFavorite(filename) {
    const fav = playlistsDatabase.find(p => p.id === 'favorites');
    if (!fav) return;
    const idx = fav.songs.indexOf(filename);
    if (idx > -1) fav.songs.splice(idx, 1); else fav.songs.push(filename);
    savePlaylists();
    const isNowLiked = fav.songs.includes(filename);
    document.querySelectorAll(`.like-btn[data-filename="${filename}"]`).forEach(btn => {
        btn.classList.toggle('liked', isNowLiked);
    });
    // Запам'ятовуємо відкриті dropdown
    const openDropdowns = [];
    document.querySelectorAll('.playlist-dropdown').forEach(d => {
        if (d.style.display !== 'none') openDropdowns.push(d.id);
    });
    displayPlaylists();
    // Відновлюємо відкриті
    openDropdowns.forEach(id => {
        const dropdown = document.getElementById(id);
        const plId = id.replace('dropdown-', '');
        const arrow = document.querySelector(`#playlist-${plId} > .playlist-header .toggle-arrow`);
        const btn   = document.querySelector(`#playlist-${plId} > .playlist-header .playlist-toggle-btn`);
        if (dropdown) {
            dropdown.style.display = 'block';
            if (arrow) arrow.textContent = '▲';
            if (btn) btn.classList.add('active');
        }
    });
}

// ==================== СТАРТ ====================
window.addEventListener('DOMContentLoaded', async () => {
    registerServiceWorker();
    await loadDatabase();
    await loadNews();
    setupAudioListeners();
    loadThemePreference();
    loadEqPreference();
    loadShakePreference();
    loadSpeedPreference();
    loadModePreferences();
    updateNavButtons();
    setupAudioUnlock();
    checkShareUrl();
    setTimeout(() => precacheMusicFiles(), 2000);
});