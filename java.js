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

// 1. Wake Lock — не дає екрану засинати
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

// 2. Мовчазний осцилятор — не дає iOS вбивати AudioContext у фоні
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

// 3. Інтервал відновлення AudioContext кожні 15 сек
function startKeepAlive() {
    stopKeepAlive();
    keepAliveInterval = setInterval(() => {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }, 15000);
}

function stopKeepAlive() {
    if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
}

// 4. Audio ping кожні 25 сек — не дає браузеру заморозити потік
function startAudioKeepAlive(audio) {
    stopAudioKeepAlive();
    audioKeepAliveInterval = setInterval(() => {
        if (!audio.paused && !isNaN(audio.currentTime)) {
            const _ = audio.currentTime; // читання достатньо
        }
    }, 25000);
}

function stopAudioKeepAlive() {
    if (audioKeepAliveInterval) { clearInterval(audioKeepAliveInterval); audioKeepAliveInterval = null; }
}

// 5. Відновлення при поверненні на вкладку
let lastSrc = '';
let lastTime = 0;

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const audio = document.getElementById('audioPlayer');
    if (audioContext && audioContext.state === 'suspended') {
        try { await audioContext.resume(); } catch(e) {}
    }
    if (!audio) return;
    // Запам'ятовуємо позицію перед відходом
    if (!audio.paused && !isNaN(audio.currentTime)) lastTime = audio.currentTime;
    // Якщо аудіо зупинилось без паузи — перезапускаємо
    if (audio.paused && audio.src && audio.src !== window.location.href && lastSrc === audio.src) {
        audio.currentTime = lastTime;
        audio.play().catch(() => {});
    }
    if (!audio.paused) requestWakeLock();
});

// 6. Розблокування AudioContext при будь-якому жесті
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

    // Вже ініціалізовано — просто відновлюємо
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
    // Ініціалізація — тільки при першому play()
}

function toggleEq(checked) {
    const enabled = checked !== undefined ? checked : !(localStorage.getItem('grab_music_eq') !== 'false');
    localStorage.setItem('grab_music_eq', enabled ? 'true' : 'false');
    const eqDiv = document.getElementById('eqControls');
    if (eqDiv) eqDiv.style.display = enabled ? 'flex' : 'none';
    if (enabled) {
        if (!isEqInitialized) {
            initEqualizer();
        } else {
            const bs = document.getElementById('bassSlider');
            const ms = document.getElementById('midSlider');
            const ts = document.getElementById('trebleSlider');
            if (bassFilter   && bs) bassFilter.gain.value   = bs.value;
            if (midFilter    && ms) midFilter.gain.value    = ms.value;
            if (trebleFilter && ts) trebleFilter.gain.value = ts.value;
        }
    } else {
        // Байпас: скидаємо gain, НЕ закриваємо контекст
        if (bassFilter)   bassFilter.gain.value   = 0;
        if (midFilter)    midFilter.gain.value    = 0;
        if (trebleFilter) trebleFilter.gain.value = 0;
    }
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

// ==================== РЕЖИМИ ІНТЕРФЕЙСУ ====================
function loadModePreferences() {
    const simpleCheck = document.getElementById('simpleModeToggle');
    const ultraCheck  = document.getElementById('ultraSimpleModeToggle');

    const isSimple = localStorage.getItem('grab_music_simple') === 'true';
    const isUltra  = localStorage.getItem('grab_music_ultra')  === 'true';

    if (isSimple) { document.body.classList.add('simple-mode'); if (simpleCheck) simpleCheck.checked = true; }
    if (isUltra)  { document.body.classList.add('ultra-simple-mode'); if (ultraCheck)  ultraCheck.checked  = true; }
}

function toggleSimpleMode(checked) {
    const enabled = checked !== undefined ? checked : !document.body.classList.contains('simple-mode');
    document.body.classList.toggle('simple-mode', enabled);
    localStorage.setItem('grab_music_simple', enabled ? 'true' : 'false');
    // Прості і ультра режими взаємовиключні
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

// ==================== MEDIA SESSION API ====================
function updateMediaSession(song) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name,
        artist: song.artist,
        album: 'Grab Music',
        artwork: [
            { src: song.image, sizes: '512x512', type: 'image/jpeg' },
            { src: song.image, sizes: '256x256', type: 'image/jpeg' }
        ]
    });
    const audio = document.getElementById('audioPlayer');
    navigator.mediaSession.setActionHandler('play',         () => audio && audio.play());
    navigator.mediaSession.setActionHandler('pause',        () => audio && audio.pause());
    navigator.mediaSession.setActionHandler('stop',         () => { if(audio){ audio.pause(); audio.currentTime=0; }});
    navigator.mediaSession.setActionHandler('seekbackward', d  => { if(audio) audio.currentTime = Math.max(0, audio.currentTime-(d.seekOffset||10)); });
    navigator.mediaSession.setActionHandler('seekforward',  d  => { if(audio) audio.currentTime = Math.min(audio.duration, audio.currentTime+(d.seekOffset||10)); });
    navigator.mediaSession.setActionHandler('seekto',       d  => { if(audio && d.seekTime!==undefined) audio.currentTime=d.seekTime; });
    updateMediaSessionNavHandlers();
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
    if (!loadPlaylistsFromStorage()) {
        try {
            const res = await fetch('./playlists.json');
            if (res.ok) { playlistsDatabase = await res.json(); savePlaylists(); }
            else playlistsDatabase = [];
        } catch(e) { playlistsDatabase = []; }
    }
    if (!playlistsDatabase.find(p => p.id === 'favorites')) {
        playlistsDatabase.push({
            id: 'favorites', name: 'Улюблене', name_en: 'Favorites',
            description: 'Твої улюблені пісні', description_en: 'Your favorite songs', songs: []
        });
        savePlaylists();
    }
    displayPlaylists();
    const si = document.getElementById('searchInput');
    if (si && si.value.trim()) searchSongs();
}

// ==================== LRC ====================
function parseLRC(text) {
    const lines = [];
    const regex = /\[(\d{2}):(\d{2})\.(\d{2})\]/;
    text.split('\n').forEach(line => {
        const m = line.match(regex);
        if (m) {
            const time = parseInt(m[1])*60 + parseInt(m[2]) + parseInt(m[3])/100;
            const txt = line.replace(regex, '').trim();
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

async function showLyricsTab(filename, type) {
    const song = songsDatabase.find(s => s.file === filename);
    if (!song) return;
    const content = document.getElementById('lyricsContent');
    document.querySelectorAll('.lyrics-tab-btn').forEach(b => b.classList.remove('active'));
    if (type === 'text') {
        if (lrcSyncInterval) { clearInterval(lrcSyncInterval); lrcSyncInterval = null; }
        currentLrcLines = [];
        content.textContent = song.lyrics || t('noLyrics');
        document.querySelector('.lyrics-tab-btn:first-child')?.classList.add('active');
    } else if (type === 'lrc' && song.lrc) {
        try {
            const resp = await fetch('./' + song.lrc);
            if (!resp.ok) throw new Error();
            const lrcText = await resp.text();
            currentLrcLines = parseLRC(lrcText);
            if (currentLrcLines.length) {
                content.innerHTML = currentLrcLines.map(l => `<div class="lrc-line">${escapeHtml(l.text)}</div>`).join('');
                if (lrcSyncInterval) clearInterval(lrcSyncInterval);
                lrcSyncInterval = setInterval(syncLRC, 100);
                syncLRC();
                document.querySelector('.lyrics-tab-btn:last-child')?.classList.add('active');
            } else content.textContent = t('invalidLrc');
        } catch(e) { content.textContent = t('lrcNotAvailable'); }
    } else content.textContent = t('lrcNotAvailable');
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
    content.textContent = song.lyrics || t('noLyrics');
    currentLrcLines = [];
    if (lrcSyncInterval) { clearInterval(lrcSyncInterval); lrcSyncInterval = null; }
}

// ==================== ІКОНКА PLAY/PAUSE ====================
function setPlayPauseIcon(isPlaying) {
    if (!playPauseBtn) return;
    if (isPlaying) {
        playPauseBtn.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;gap:4px;"><span style="display:inline-block;width:4px;height:18px;background:currentColor;border-radius:2px;"></span><span style="display:inline-block;width:4px;height:18px;background:currentColor;border-radius:2px;"></span></span>';
    } else {
        playPauseBtn.innerHTML = '<span style="display:inline-block;width:0;height:0;border-style:solid;border-width:10px 0 10px 18px;border-color:transparent transparent transparent currentColor;margin-left:4px;"></span>';
    }
}

// ==================== НАВІГАЦІЯ ====================
function updateNavButtons() {
    if (!prevBtn || !nextBtn || !loopBtn) return;
    if (currentQueue.length <= 1) {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        loopBtn.style.display = 'none';
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

        // EQ — ініціалізуємо тільки один раз
        if (localStorage.getItem('grab_music_eq') !== 'false' && !isEqInitialized) {
            initEqualizer();
        } else if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }

        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
        requestWakeLock();
        startAudioKeepAlive(audio);
        startKeepAlive();
    }).catch(e => console.log('play blocked:', e));

    updateNavButtons();
}

function clearQueue() {
    if (playlistEndedHandler) {
        const audio = document.getElementById('audioPlayer');
        if (audio) audio.removeEventListener('ended', playlistEndedHandler);
        playlistEndedHandler = null;
    }
    currentQueue = [];
    currentQueueIndex = -1;
    isPlaylistLoopEnabled = false;
    if (loopBtn) loopBtn.classList.remove('active');
    updateNavButtons();
}

function playNext() {
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
    if (!songFiles.length) return;
    clearQueue();
    currentQueue = [...songFiles];
    currentQueueIndex = 0;
    const audio = document.getElementById('audioPlayer');
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
        s.name.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
    );
    if (!found.length) { results.innerHTML = `<p class="no-results">${t('noResults')}</p>`; return; }
    results.innerHTML = found.map(song => `
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
            </div>
        </div>
    `).join('');
}

// ==================== НОВИНИ ====================
let newsDatabase = [];

async function loadNews() {
    try {
        const res = await fetch('./news.json');
        if (!res.ok) throw new Error();
        newsDatabase = await res.json();
        updateNewsBadge();
    } catch(e) {
        newsDatabase = [];
    }
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
            return `
                <div class="news-card">
                    <div class="news-card-header">
                        <span class="news-tag">${tag}</span>
                        <span class="news-date">${date}</span>
                    </div>
                    <h3>${title}</h3>
                    <p>${text}</p>
                </div>
            `;
        }).join('');
    }

    // Позначаємо всі як переглянуті
    if (newsDatabase.length) {
        const maxId = Math.max(...newsDatabase.map(n => n.id));
        localStorage.setItem('grab_music_news_seen', maxId);
        updateNewsBadge();
    }

    modal.style.display = 'flex';
}

function closeNews() {
    const modal = document.getElementById('news-modal');
    if (modal) modal.style.display = 'none';
}
function switchLanguage(lang) {
    window.location.href = lang === 'uk' ? './index.html' : './index_en.html';
}

// ==================== МОДАЛЬНІ ВІКНА ====================
function openModal()         { document.getElementById('tutorial-modal').style.display = 'flex'; }
function closeModal()        { document.getElementById('tutorial-modal').style.display = 'none'; }
function openPremiumModal()  { document.getElementById('premium-modal').style.display = 'flex'; }
function closePremiumModal() { document.getElementById('premium-modal').style.display = 'none'; }
function openSettings()      { document.getElementById('settings-modal').style.display = 'flex'; }
function closeSettings()     { document.getElementById('settings-modal').style.display = 'none'; }
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
        if (lrcSyncInterval) { clearInterval(lrcSyncInterval); lrcSyncInterval = null; }
    };

    audio.onended = () => {
        updateMediaSessionState(audio);
    };

    // Помилка — переходимо до наступного треку
    audio.onerror = () => {
        console.warn('Audio error, skipping to next');
        if (currentQueue.length > 1) playNext();
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
function displayPlaylists() {
    const container = document.getElementById('playlistsContainer');
    if (!container) return;
    if (!playlistsDatabase.length) {
        container.innerHTML = '<p style="text-align:center;color:gray;">⚠️ Немає плейлистів</p>';
        return;
    }
    container.innerHTML = playlistsDatabase.map(pl => {
        const name = currentLanguage === 'en' ? (pl.name_en || pl.name) : pl.name;
        const desc = currentLanguage === 'en' ? (pl.description_en || pl.description) : pl.description;
        const songs = pl.songs.map(fn => songsDatabase.find(s => s.file === fn)).filter(Boolean);
        const playAllBtn = songs.length
            ? `<button class="play-all-btn" onclick="event.stopPropagation();playPlaylist(${JSON.stringify(pl.songs).replace(/"/g,'&quot;')})">▶ ${t('playAllBtn')}</button>`
            : '';
        return `
            <div class="playlist-item" id="playlist-${pl.id}">
                <div class="playlist-header" onclick="togglePlaylist('${pl.id}')">
                    <div class="playlist-info">
                        <h3>📋 ${escapeHtml(name)}</h3>
                        <p>${escapeHtml(desc)}</p>
                        <small>${pl.songs.length} ${currentLanguage === 'en' ? 'songs' : 'пісень'}</small>
                    </div>
                    <div class="playlist-header-btns">
                        ${playAllBtn}
                        <button class="view-btn playlist-toggle-btn" onclick="event.stopPropagation();togglePlaylist('${pl.id}')">
                            ${t('viewBtn')} <span class="toggle-arrow">▼</span>
                        </button>
                    </div>
                </div>
                <div class="playlist-dropdown" id="dropdown-${pl.id}" style="display:none;">
                    ${songs.length ? songs.map(song => `
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
                            </div>
                        </div>
                    `).join('') : `<p style="text-align:center;color:rgba(255,255,255,0.7);padding:16px;">${currentLanguage==='en'?'No songs yet':'Пісень ще немає'}</p>`}
                </div>
            </div>
        `;
    }).join('');
}

function togglePlaylist(id) {
    const dropdown = document.getElementById('dropdown-' + id);
    const arrow = document.querySelector(`#playlist-${id} .toggle-arrow`);
    const btn   = document.querySelector(`#playlist-${id} .playlist-toggle-btn`);
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
    const btn = document.querySelector(`.like-btn[data-filename="${filename}"]`);
    if (btn) btn.classList.toggle('liked', fav.songs.includes(filename));
    displayPlaylists();
}

// ==================== СТАРТ ====================
window.addEventListener('DOMContentLoaded', async () => {
    await loadDatabase();
    await loadNews();
    setupAudioListeners();
    loadThemePreference();
    loadEqPreference();
    loadModePreferences();
    updateNavButtons();
    setupAudioUnlock();
});