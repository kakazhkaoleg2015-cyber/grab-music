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
let silentOscillator = null;
let silentGain = null;
let audioKeepAliveInterval = null;

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

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
        if (wakeLock) return;
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch(e) {}
}

function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch(e) {} wakeLock = null; }
}

function startSilentOscillator() {
    if (!audioContext || silentOscillator) return;
    try {
        silentGain = audioContext.createGain();
        silentGain.gain.value = 0.00001;
        silentOscillator = audioContext.createOscillator();
        silentOscillator.frequency.value = 1;
        silentOscillator.connect(silentGain);
        silentGain.connect(audioContext.destination);
        silentOscillator.start();
    } catch(e) {}
}

function stopSilentOscillator() {
    if (silentOscillator) {
        try { silentOscillator.stop(); } catch(e) {}
        silentOscillator = null;
        silentGain = null;
    }
}

function startKeepAlive() {
    stopKeepAlive();
    keepAliveInterval = setInterval(() => {
        if (audioContext && audioContext.state === 'suspended') audioContext.resume();
    }, 15000);
}

function stopKeepAlive() {
    if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
}

function startAudioKeepAlive(audio) {
    stopAudioKeepAlive();
    audioKeepAliveInterval = setInterval(() => {
        if (!audio.paused && !isNaN(audio.currentTime)) { const _ = audio.currentTime; }
    }, 25000);
}

function stopAudioKeepAlive() {
    if (audioKeepAliveInterval) { clearInterval(audioKeepAliveInterval); audioKeepAliveInterval = null; }
}

let lastSrc = '';
let lastTime = 0;

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const audio = document.getElementById('audioPlayer');
    if (audioContext && audioContext.state === 'suspended') {
        try { await audioContext.resume(); } catch(e) {}
    }
    if (!audio) return;
    if (!audio.paused) requestWakeLock();
});

function setupAudioUnlock() {
    const unlock = async () => {
        if (audioContext && audioContext.state === 'suspended') {
            try { await audioContext.resume(); } catch(e) {}
        }
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
async function loadDatabase() {
    try {
        const res = await fetch('./database.json');
        if (!res.ok) throw new Error();
        songsDatabase = await res.json();
        console.log('✅ songs loaded:', songsDatabase.length);
    } catch(e) {
        songsDatabase = [];
        const lc = document.getElementById('lyricsContent');
        if (lc) lc.textContent = t('errorLoadingDB');
    }

    // Завжди завантажуємо playlists.json і мержимо з localStorage
    // (зберігаємо улюблені з localStorage, але оновлюємо решту з файлу)
    let storedPlaylists = null;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try { storedPlaylists = JSON.parse(stored); } catch(e) {}
    }

    try {
        const res = await fetch('./playlists.json');
        if (res.ok) {
            const filePlaylists = await res.json();
            if (storedPlaylists) {
                // Зберігаємо улюблені зі збереженого стану
                const favorites = storedPlaylists.find(p => p.id === 'favorites');
                playlistsDatabase = filePlaylists.map(pl => {
                    if (pl.id === 'favorites' && favorites) return favorites;
                    return pl;
                });
                // Якщо favorites немає у файлі — додаємо
                if (!playlistsDatabase.find(p => p.id === 'favorites') && favorites) {
                    playlistsDatabase.unshift(favorites);
                }
            } else {
                playlistsDatabase = filePlaylists;
            }
        } else {
            playlistsDatabase = storedPlaylists || [];
        }
    } catch(e) {
        playlistsDatabase = storedPlaylists || [];
    }

    if (!playlistsDatabase.find(p => p.id === 'favorites')) {
        playlistsDatabase.unshift({
            id: 'favorites', name: 'Улюблене', name_en: 'Favorites',
            description: 'Твої улюблені пісні', description_en: 'Your favorite songs', songs: []
        });
    }
    savePlaylists();
    displayPlaylists();
    const si = document.getElementById('searchInput');
    if (si && si.value.trim()) searchSongs();
}

// ==================== LRC ====================
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
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

async function translateLyrics() {
    const content = document.getElementById('lyricsContent');
    const button = document.getElementById('translateButton');
    if (!content || !button) return;

    // Отримуємо мову з select або показуємо вибір
    const languageSelect = document.getElementById('translateLanguageSelect');
    const targetLang = languageSelect ? languageSelect.value : (currentLanguage === 'uk' ? 'en' : 'uk');

    button.disabled = true;
    button.textContent = currentLanguage === 'uk' ? '⏳ Переклад...' : '⏳ Translating...';

    try {
        if (currentTranslateMode === 'lrc' && originalLrcLines.length) {
            // LRC — перекладаємо і замінюємо рядки
            const texts = originalLrcLines.map(l => l.text).join('\n');
            const res = await fetch(
                `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(texts)}`
            );
            if (!res.ok) throw new Error();
            const data = await res.json();
            const translatedText = Array.isArray(data?.[0]) ? data[0].map(p => p[0]).join('') : '';
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
            // Звичайний текст — замінюємо вміст
            const srcText = isShowingTranslated ? originalTextContent : content.textContent.trim();
            if (!srcText || srcText === t('noLyrics') || srcText === t('lrcNotAvailable')) throw new Error('No text');

            const res = await fetch(
                `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(srcText)}`
            );
            if (!res.ok) throw new Error();
            const data = await res.json();
            const translatedText = Array.isArray(data?.[0]) ? data[0].map(p => p[0]).join('') : '';
            if (!translatedText) throw new Error('Empty');

            // Зберігаємо оригінал якщо ще не збережено
            if (!isShowingTranslated) originalTextContent = srcText;

            // Замінюємо текст перекладом
            content.textContent = translatedText;
            isShowingTranslated = true;
            showOriginalButton();
        }
    } catch(e) {
        content.textContent = (currentLanguage === 'uk'
            ? '❌ Не вдалося перекласти. Спробуй пізніше.'
            : '❌ Translation failed. Try again later.');
    } finally {
        button.disabled = false;
        button.textContent = currentLanguage === 'uk' ? '🌐 Перекласти' : '🌐 Translate';
    }
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
    if (lrcSyncInterval) { clearInterval(lrcSyncInterval); lrcSyncInterval = null; }
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

function playNextRandom() {
    if (!songsDatabase.length) return;
    const song = songsDatabase[Math.floor(Math.random() * songsDatabase.length)];
    playSong(song.file, true);
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
    nowDiv.innerHTML = `<img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="player-image" onerror="this.src='./fotomusic/no-photo.jpg'"> ${t('nowPlayingLabel')} <strong>${escapeHtml(song.name)}</strong> - ${escapeHtml(song.artist)}`;
    showLyrics(song);
    if (seekBar) seekBar.value = 0;
    if (currentTimeLabel)  currentTimeLabel.textContent  = '0:00';
    if (durationTimeLabel) durationTimeLabel.textContent = '0:00';
    if (playPauseBtn) { playPauseBtn.classList.remove('disabled'); setPlayPauseIcon(true); }

    updateMediaSession(song);

    audio.play().then(() => {
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
    const audio = document.getElementById('audioPlayer');
    // Прибираємо старий handler перед додаванням нового
    if (playlistEndedHandler) audio.removeEventListener('ended', playlistEndedHandler);
    playlistEndedHandler = () => playNext();
    audio.addEventListener('ended', playlistEndedHandler);
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
    const q = input.value.trim().toLowerCase();
    if (!q) { results.innerHTML = ''; return; }
    const found = songsDatabase.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        (s.lyrics && s.lyrics.toLowerCase().includes(q))
    );
    if (!found.length) { results.innerHTML = `<p class="no-results">${t('noResults')}</p>`; return; }
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
    const song = songsDatabase[Math.floor(Math.random() * songsDatabase.length)];
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
    modal.classList.add('open');
}

function closeNews() {
    const modal = document.getElementById('news-modal');
    if (modal) modal.classList.remove('open');
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

// ==================== МОВА ====================
function switchLanguage(lang) {
    window.location.href = lang === 'uk' ? './index.html' : './index_en.html';
}

// ==================== МОДАЛЬНІ ВІКНА ====================
function openModal()         { document.getElementById('tutorial-modal').classList.add('open'); }
function closeModal()        { document.getElementById('tutorial-modal').classList.remove('open'); }
function openPremiumModal()  { document.getElementById('premium-modal').classList.add('open'); }
function closePremiumModal() { document.getElementById('premium-modal').classList.remove('open'); }
function openSettings()      { document.getElementById('settings-modal').classList.add('open'); loadShakePreference(); }
function closeSettings()     { document.getElementById('settings-modal').classList.remove('open'); }
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

    audio.onended = () => { updateMediaSessionState(audio); };

    audio.onerror = () => {
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
        pinned: true, collapsible: true, defaultOpen: true
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
    loadModePreferences();
    updateNavButtons();
    setupAudioUnlock();
    checkShareUrl();
    setTimeout(() => precacheMusicFiles(), 2000);
});