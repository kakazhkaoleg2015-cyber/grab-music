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
 
let playPauseBtn, nextBtn, prevBtn, loopBtn, seekBar, currentTimeLabel, durationTimeLabel;
 
let currentLanguage = window.location.pathname.includes('_en.html') ? 'en' : 'uk';
 
const translations = {
    uk: {
        errorLoadingDB: 'Помилка завантаження бази пісень.',
        noLyrics: 'Текст відсутній.',
        invalidLrc: 'Неправильний формат LRC.',
        lrcNotAvailable: 'LRC файл недоступний.',
        noResults: '❌ Пісні не знайдені',
        playlistEnded: '▶ Плейлист завершено.',
        favoriteAdded: '✅ Пісня додана в улюблені',
        favoriteRemoved: '❌ Пісня видалена з улюблених',
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
        playlistEnded: '▶ Playlist ended.',
        favoriteAdded: '✅ Song added to favorites',
        favoriteRemoved: '❌ Song removed from favorites',
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
 
// ==================== MEDIA SESSION API (шторка Android/iOS) ====================
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
 
    // Скидаємо всі handlers спочатку
    navigator.mediaSession.setActionHandler('play', () => {
        const audio = document.getElementById('audioPlayer');
        if (audio) audio.play();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
        const audio = document.getElementById('audioPlayer');
        if (audio) audio.pause();
    });
    navigator.mediaSession.setActionHandler('stop', () => {
        const audio = document.getElementById('audioPlayer');
        if (audio) { audio.pause(); audio.currentTime = 0; }
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const audio = document.getElementById('audioPlayer');
        if (audio) audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const audio = document.getElementById('audioPlayer');
        if (audio) audio.currentTime = Math.min(audio.duration, audio.currentTime + (details.seekOffset || 10));
    });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
        const audio = document.getElementById('audioPlayer');
        if (audio && details.seekTime !== undefined) audio.currentTime = details.seekTime;
    });
 
    // Кнопки попередня/наступна — тільки якщо є плейлист
    if (currentQueue.length > 1) {
        const canPrev = isPlaylistLoopEnabled || currentQueueIndex > 0;
        const canNext = isPlaylistLoopEnabled || currentQueueIndex < currentQueue.length - 1;
 
        navigator.mediaSession.setActionHandler('previoustrack', canPrev ? () => playPrev() : null);
        navigator.mediaSession.setActionHandler('nexttrack', canNext ? () => playNext() : null);
    } else {
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
    }
}
 
function updateMediaSessionPlaybackState(audio) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
 
    // Оновлюємо позицію треку для прогрес-бару в шторці
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
 
function updateMediaSessionNavHandlers() {
    if (!('mediaSession' in navigator)) return;
    if (currentQueue.length > 1) {
        const canPrev = isPlaylistLoopEnabled || currentQueueIndex > 0;
        const canNext = isPlaylistLoopEnabled || currentQueueIndex < currentQueue.length - 1;
        navigator.mediaSession.setActionHandler('previoustrack', canPrev ? () => playPrev() : null);
        navigator.mediaSession.setActionHandler('nexttrack', canNext ? () => playNext() : null);
    } else {
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
    }
}
 
// ==================== ТЕМА ТА НАЛАШТУВАННЯ ====================
function loadThemePreference() {
    const saved = localStorage.getItem('grab_music_theme');
    const isDark = saved === 'dark';
    document.body.classList.toggle('dark-theme', isDark);
    const darkCheck = document.getElementById('darkThemeToggle');
    if (darkCheck) darkCheck.checked = isDark;
}
 
function toggleTheme(checked) {
    const isDark = checked !== undefined ? checked : !document.body.classList.contains('dark-theme');
    document.body.classList.toggle('dark-theme', isDark);
    localStorage.setItem('grab_music_theme', isDark ? 'dark' : 'light');
}
 
function loadEqPreference() {
    const enabled = localStorage.getItem('grab_music_eq') !== 'false';
    const eqDiv = document.getElementById('eqControls');
    if (eqDiv) eqDiv.style.display = enabled ? 'flex' : 'none';
    const eqCheck = document.getElementById('eqToggleCheck');
    if (eqCheck) eqCheck.checked = enabled;
    if (enabled && !isEqInitialized) initEqualizer();
    else if (!enabled && audioContext) {
        audioContext.close();
        audioContext = null;
        sourceNode = null;
        bassFilter = null;
        midFilter = null;
        trebleFilter = null;
        isEqInitialized = false;
    }
}
 
function toggleEq(checked) {
    const enabled = checked !== undefined ? checked : !(localStorage.getItem('grab_music_eq') !== 'false');
    localStorage.setItem('grab_music_eq', enabled);
    const eqDiv = document.getElementById('eqControls');
    if (eqDiv) eqDiv.style.display = enabled ? 'flex' : 'none';
    if (enabled && !isEqInitialized) initEqualizer();
    else if (!enabled && audioContext) {
        audioContext.close();
        audioContext = null;
        sourceNode = null;
        bassFilter = null;
        midFilter = null;
        trebleFilter = null;
        isEqInitialized = false;
    }
}
 
function updateEqualizerLabels() {
    const eqDiv = document.getElementById('eqControls');
    if (!eqDiv) return;
    const bassVal = document.getElementById('bassSlider')?.value || 0;
    const midVal = document.getElementById('midSlider')?.value || 0;
    const trebleVal = document.getElementById('trebleSlider')?.value || 0;
    eqDiv.innerHTML = `
        <label>${t('eqBass')} <input type="range" id="bassSlider" min="-20" max="20" value="${bassVal}" step="1"></label>
        <label>${t('eqMid')} <input type="range" id="midSlider" min="-20" max="20" value="${midVal}" step="1"></label>
        <label>${t('eqTreble')} <input type="range" id="trebleSlider" min="-20" max="20" value="${trebleVal}" step="1"></label>
        <button id="resetEqBtn" class="reset-eq-btn">${t('resetEq')}</button>
    `;
    if (bassFilter && midFilter && trebleFilter) {
        const bs = document.getElementById('bassSlider');
        const ms = document.getElementById('midSlider');
        const ts = document.getElementById('trebleSlider');
        const rs = document.getElementById('resetEqBtn');
        if (bs) bs.oninput = (e) => { if(bassFilter) bassFilter.gain.value = e.target.value; };
        if (ms) ms.oninput = (e) => { if(midFilter) midFilter.gain.value = e.target.value; };
        if (ts) ts.oninput = (e) => { if(trebleFilter) trebleFilter.gain.value = e.target.value; };
        if (rs) rs.onclick = () => {
            if(bs) bs.value = 0;
            if(ms) ms.value = 0;
            if(ts) ts.value = 0;
            if(bassFilter) bassFilter.gain.value = 0;
            if(midFilter) midFilter.gain.value = 0;
            if(trebleFilter) trebleFilter.gain.value = 0;
        };
    }
}
 
function initEqualizer() {
    const audio = document.getElementById('audioPlayer');
    if (!audio || isEqInitialized || localStorage.getItem('grab_music_eq') === 'false') return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
        updateEqualizerLabels();
        audioContext.resume();
        console.log('✅ EQ initialized');
    } catch(e) { console.warn('EQ not supported', e); }
}
 
// ==================== LOCALSTORAGE ДЛЯ ПЛЕЙЛИСТІВ ====================
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
        document.getElementById('lyricsContent').textContent = t('errorLoadingDB');
    }
    if (!loadPlaylistsFromStorage()) {
        try {
            const res = await fetch('./playlists.json');
            if (res.ok) {
                playlistsDatabase = await res.json();
                console.log('✅ playlists loaded from file');
                savePlaylists();
            } else playlistsDatabase = [];
        } catch(e) { playlistsDatabase = []; }
    } else {
        console.log('📀 playlists from localStorage');
    }
    if (!playlistsDatabase.find(p => p.id === 'favorites')) {
        playlistsDatabase.push({
            id: 'favorites',
            name: 'Улюблене',
            name_en: 'Favorites',
            description: 'Твої улюблені пісні',
            description_en: 'Your favorite songs',
            songs: []
        });
        savePlaylists();
    }
    displayPlaylists();
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.value.trim()) searchSongs();
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
    for (let i=0; i<currentLrcLines.length; i++) {
        if (currentLrcLines[i].time <= ct) idx = i;
        else break;
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
    document.querySelectorAll('.lyrics-tab-btn').forEach(btn => btn.classList.remove('active'));
    if (type === 'text') {
        if (lrcSyncInterval) clearInterval(lrcSyncInterval);
        lrcSyncInterval = null;
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
function escapeHtml(str) { return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }
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
    if (lrcSyncInterval) clearInterval(lrcSyncInterval);
    lrcSyncInterval = null;
}
 
// ==================== УПРАВЛІННЯ КНОПКАМИ ПЛЕЄРА ====================
function updateNavButtons() {
    if (!prevBtn || !nextBtn || !loopBtn) return;
    const hasPlaylist = currentQueue.length > 1;
    if (!hasPlaylist) {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        loopBtn.style.display = 'none';
        return;
    }
    prevBtn.style.display = 'inline-flex';
    nextBtn.style.display = 'inline-flex';
    loopBtn.style.display = 'inline-flex';
    if (!isPlaylistLoopEnabled) {
        prevBtn.style.display = currentQueueIndex === 0 ? 'none' : 'inline-flex';
        nextBtn.style.display = currentQueueIndex === currentQueue.length - 1 ? 'none' : 'inline-flex';
    } else {
        prevBtn.style.display = 'inline-flex';
        nextBtn.style.display = 'inline-flex';
    }
    // Синхронізуємо Media Session з поточним станом навігації
    updateMediaSessionNavHandlers();
}
 
// ==================== ВІДТВОРЕННЯ ====================
function playSong(filename, fromQueue = false) {
    if (!fromQueue) clearQueue();
    const audio = document.getElementById('audioPlayer');
    const nowDiv = document.getElementById('nowPlaying');
    const song = songsDatabase.find(s => s.file === filename);
    if (!song) {
        console.error('Song not found:', filename);
        return;
    }
    if (lrcSyncInterval) clearInterval(lrcSyncInterval);
    lrcSyncInterval = null;
    if (audioContext && audioContext.state !== 'closed') {
        try { if (sourceNode) sourceNode.disconnect(); } catch(e) {}
        isEqInitialized = false;
        audioContext = null;
    }
    audio.src = './music/' + filename;
    nowDiv.innerHTML = `<img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="player-image" onerror="this.src='./fotomusic/no-photo.jpg'">▶ ${t('nowPlayingLabel')} <strong>${escapeHtml(song.name)}</strong> - ${escapeHtml(song.artist)}`;
    showLyrics(song);
    if (seekBar) seekBar.value = 0;
    if (currentTimeLabel) currentTimeLabel.textContent = '0:00';
    if (durationTimeLabel) durationTimeLabel.textContent = '0:00';
    if (playPauseBtn) {
        playPauseBtn.classList.remove('disabled');
        setPlayPauseIcon(true); // показуємо паузу, бо зараз почнемо грати
    }
 
    // Оновлюємо Media Session відразу з метаданими
    updateMediaSession(song);
 
    audio.play().then(() => {
        if (currentLrcLines.length && !lrcSyncInterval) lrcSyncInterval = setInterval(syncLRC, 100);
        if (localStorage.getItem('grab_music_eq') !== 'false') initEqualizer();
        navigator.mediaSession && (navigator.mediaSession.playbackState = 'playing');
    }).catch(e => console.log('play blocked', e));
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
    if (!isPlaylistLoopEnabled && currentQueueIndex === currentQueue.length-1) return;
    let next = currentQueueIndex + 1;
    if (next >= currentQueue.length) {
        if (isPlaylistLoopEnabled) next = 0;
        else return;
    }
    currentQueueIndex = next;
    playSong(currentQueue[currentQueueIndex], true);
}
function playPrev() {
    if (currentQueue.length <= 1) return;
    if (!isPlaylistLoopEnabled && currentQueueIndex === 0) return;
    let prev = currentQueueIndex - 1;
    if (prev < 0) {
        if (isPlaylistLoopEnabled) prev = currentQueue.length-1;
        else return;
    }
    currentQueueIndex = prev;
    playSong(currentQueue[currentQueueIndex], true);
}
function playPlaylist(songFiles) {
    if (!songFiles.length) return;
    clearQueue();
    currentQueue = [...songFiles];
    currentQueueIndex = 0;
    if (!playlistEndedHandler) {
        const audio = document.getElementById('audioPlayer');
        playlistEndedHandler = () => playNext();
        audio.addEventListener('ended', playlistEndedHandler);
    }
    playSong(currentQueue[0], true);
    updateNavButtons();
}
function toggleLoop() {
    if (currentQueue.length <= 1) return;
    isPlaylistLoopEnabled = !isPlaylistLoopEnabled;
    if (loopBtn) {
        if (isPlaylistLoopEnabled) loopBtn.classList.add('active');
        else loopBtn.classList.remove('active');
    }
    updateNavButtons();
}
 
// ==================== ІКОНКА PLAY/PAUSE ====================
function setPlayPauseIcon(isPlaying) {
    if (!playPauseBtn) return;
    if (isPlaying) {
        // Пауза — два вертикальні стовпчики, чітко по центру
        playPauseBtn.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;gap:4px;"><span style="display:inline-block;width:4px;height:18px;background:currentColor;border-radius:2px;"></span><span style="display:inline-block;width:4px;height:18px;background:currentColor;border-radius:2px;"></span></span>';
        playPauseBtn.style.paddingLeft = '0';
    } else {
        // Play — трикутник через CSS border trick, чітко по центру з компенсацією
        playPauseBtn.innerHTML = '<span style="display:inline-block;width:0;height:0;border-style:solid;border-width:10px 0 10px 18px;border-color:transparent transparent transparent currentColor;margin-left:4px;"></span>';
        playPauseBtn.style.paddingLeft = '0';
    }
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
    const found = songsDatabase.filter(s => s.name.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
    if (!found.length) { results.innerHTML = `<p class="no-results">${t('noResults')}</p>`; return; }
    results.innerHTML = found.map(song => `
        <div class="result-item">
            <img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="song-image" onerror="this.src='./fotomusic/no-photo.jpg'">
            <div class="result-info">
                <h3>${escapeHtml(song.name)}</h3>
                <p>${escapeHtml(song.artist)}</p>
            </div>
            <div class="result-buttons">
                <button class="play-btn" onclick="playSong('${escapeHtml(song.file)}', false)">▶ ${t('playBtn')}</button>
                <button class="download-btn" onclick="downloadSong('${escapeHtml(song.file)}')">⬇ ${t('downloadBtn')}</button>
                <button class="like-btn ${isFavorite(song.file) ? 'liked' : ''}" data-filename="${escapeHtml(song.file)}" onclick="toggleFavorite('${escapeHtml(song.file)}')">❤️</button>
            </div>
        </div>
    `).join('');
}
 
// ==================== ПЕРЕМИКАННЯ МОВИ ====================
function switchLanguage(lang) {
    window.location.href = lang === 'uk' ? './index.html' : './index_en.html';
}
 
// ==================== МОДАЛЬНІ ВІКНА ====================
function openModal() { document.getElementById('tutorial-modal').style.display = 'flex'; }
function closeModal() { document.getElementById('tutorial-modal').style.display = 'none'; }
function openPremiumModal() { document.getElementById('premium-modal').style.display = 'flex'; }
function closePremiumModal() { document.getElementById('premium-modal').style.display = 'none'; }
function openSettings() { document.getElementById('settings-modal').style.display = 'flex'; }
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
window.onclick = function(e) {
    if (e.target === document.getElementById('tutorial-modal')) closeModal();
    if (e.target === document.getElementById('premium-modal')) closePremiumModal();
    if (e.target === document.getElementById('settings-modal')) closeSettings();
};
 
// ==================== КАСТОМНИЙ ПЛЕЄР ====================
function setupAudioListeners() {
    const audio = document.getElementById('audioPlayer');
    if (!audio || audio.hasAttribute('data-listener')) return;
    audio.setAttribute('data-listener', 'true');
    playPauseBtn = document.getElementById('playPauseBtn');
    nextBtn = document.getElementById('nextBtn');
    prevBtn = document.getElementById('prevBtn');
    loopBtn = document.getElementById('loopBtn');
    seekBar = document.getElementById('seekBar');
    currentTimeLabel = document.getElementById('currentTime');
    durationTimeLabel = document.getElementById('durationTime');
 
    function hasTrack() { return audio.src && audio.src !== '' && audio.src !== window.location.href; }
 
    function updatePlayBtn() {
        if (!playPauseBtn) return;
        if (!hasTrack()) {
            playPauseBtn.classList.add('disabled');
            setPlayPauseIcon(false);
        } else {
            playPauseBtn.classList.remove('disabled');
            setPlayPauseIcon(!audio.paused);
        }
    }
 
    if (playPauseBtn) playPauseBtn.onclick = () => {
        if (!hasTrack()) return;
        if (audio.paused) {
            audio.play();
        } else {
            audio.pause();
        }
    };
    if (nextBtn) nextBtn.onclick = playNext;
    if (prevBtn) prevBtn.onclick = playPrev;
    if (loopBtn) loopBtn.onclick = toggleLoop;
    if (seekBar) seekBar.oninput = () => {
        if (!hasTrack()) return;
        audio.currentTime = audio.duration * (seekBar.value / 100);
    };
 
    audio.ontimeupdate = () => {
        if (!hasTrack()) return;
        if (!isNaN(audio.duration) && audio.duration > 0) {
            seekBar.value = (audio.currentTime / audio.duration) * 100;
            currentTimeLabel.textContent = formatTime(audio.currentTime);
            durationTimeLabel.textContent = formatTime(audio.duration);
            // Оновлюємо позицію в шторці кожні ~1 сек
            updateMediaSessionPlaybackState(audio);
        }
        updatePlayBtn();
    };
 
    audio.onplay = () => {
        updatePlayBtn();
        updateMediaSessionPlaybackState(audio);
        if (currentLrcLines.length && !lrcSyncInterval) {
            lrcSyncInterval = setInterval(syncLRC, 100);
            syncLRC();
        }
    };
 
    audio.onpause = () => {
        updatePlayBtn();
        updateMediaSessionPlaybackState(audio);
        if (lrcSyncInterval) clearInterval(lrcSyncInterval);
        lrcSyncInterval = null;
    };
 
    audio.onended = () => {
        updateMediaSessionPlaybackState(audio);
    };
 
    // Початковий стан
    setPlayPauseIcon(false);
 
    ['scroll','wheel','touchmove'].forEach(ev => {
        document.addEventListener(ev, () => {
            isUserInteracting = true;
            setTimeout(() => isUserInteracting = false, 500);
        });
    });
}
 
function formatTime(sec) {
    if (isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s<10 ? '0'+s : s}`;
}
 
// ==================== ПЛЕЙЛИСТИ ====================
function displayPlaylists() {
    const container = document.getElementById('playlistsContainer');
    if (!container) return;
    if (!playlistsDatabase.length) {
        container.innerHTML = '<p style="text-align:center; color:gray;">⚠️ Немає плейлистів</p>';
        return;
    }
    container.innerHTML = playlistsDatabase.map(pl => {
        const name = currentLanguage === 'en' ? (pl.name_en || pl.name) : pl.name;
        const desc = currentLanguage === 'en' ? (pl.description_en || pl.description) : pl.description;
        const songs = pl.songs.map(fn => songsDatabase.find(s => s.file === fn)).filter(s => s);
        const playAllBtn = songs.length ? `<button class="play-all-btn" onclick="event.stopPropagation(); playPlaylist(${JSON.stringify(pl.songs).replace(/"/g, '&quot;')})">▶ ${t('playAllBtn')}</button>` : '';
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
                        <button class="view-btn playlist-toggle-btn" onclick="event.stopPropagation(); togglePlaylist('${pl.id}')">
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
                                <button class="play-btn" onclick="playSong('${escapeHtml(song.file)}', false)">▶ ${t('playBtn')}</button>
                                <button class="download-btn" onclick="downloadSong('${escapeHtml(song.file)}')">⬇ ${t('downloadBtn')}</button>
                                <button class="like-btn ${isFavorite(song.file) ? 'liked' : ''}" data-filename="${escapeHtml(song.file)}" onclick="toggleFavorite('${escapeHtml(song.file)}')">❤️</button>
                            </div>
                        </div>
                    `).join('') : `<p style="text-align:center; color:var(--text-muted); padding:16px;">${currentLanguage === 'en' ? 'No songs yet' : 'Пісень ще немає'}</p>`}
                </div>
            </div>
        `;
    }).join('');
}
 
function togglePlaylist(id) {
    const dropdown = document.getElementById('dropdown-' + id);
    const btn = document.querySelector(`#playlist-${id} .playlist-toggle-btn`);
    const arrow = document.querySelector(`#playlist-${id} .toggle-arrow`);
    if (!dropdown) return;
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : 'block';
    if (arrow) arrow.textContent = isOpen ? '▼' : '▲';
    if (btn) btn.classList.toggle('active', !isOpen);
}
 
function viewPlaylist(id) {
    currentPlaylist = playlistsDatabase.find(p => p.id === id);
    if (!currentPlaylist) return;
    const resultsDiv = document.getElementById('searchResults');
    const songs = currentPlaylist.songs.map(fn => songsDatabase.find(s => s.file === fn)).filter(s => s);
    const name = currentLanguage === 'en' ? (currentPlaylist.name_en || currentPlaylist.name) : currentPlaylist.name;
    const playAllBtn = songs.length ? `<button class="play-all-btn" onclick="playPlaylist(${JSON.stringify(currentPlaylist.songs).replace(/"/g, '&quot;')})">▶ ${t('playAllBtn')}</button>` : '';
    resultsDiv.innerHTML = `
        <div style="margin-bottom:20px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <button class="back-btn" onclick="backToPlaylists()">← ${t('backBtn')}</button>
            ${playAllBtn}
        </div>
        <h2 style="color:var(--accent-color); margin-top:0;">📋 ${escapeHtml(name)}</h2>
        ${songs.map(song => `
            <div class="result-item">
                <img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="song-image" onerror="this.src='./fotomusic/no-photo.jpg'">
                <div class="result-info">
                    <h3>${escapeHtml(song.name)}</h3>
                    <p>${escapeHtml(song.artist)}</p>
                </div>
                <div class="result-buttons">
                    <button class="play-btn" onclick="playSong('${escapeHtml(song.file)}', false)">▶ ${t('playBtn')}</button>
                    <button class="download-btn" onclick="downloadSong('${escapeHtml(song.file)}')">⬇ ${t('downloadBtn')}</button>
                    <button class="like-btn ${isFavorite(song.file) ? 'liked' : ''}" data-filename="${escapeHtml(song.file)}" onclick="toggleFavorite('${escapeHtml(song.file)}')">❤️</button>
                </div>
            </div>
        `).join('')}
    `;
}
 
function backToPlaylists() {
    currentPlaylist = null;
    document.getElementById('searchInput').value = '';
    displayPlaylists();
    document.getElementById('searchResults').innerHTML = '';
}
 
function isFavorite(filename) {
    const fav = playlistsDatabase.find(p => p.id === 'favorites');
    return fav ? fav.songs.includes(filename) : false;
}
 
function toggleFavorite(filename) {
    const fav = playlistsDatabase.find(p => p.id === 'favorites');
    if (!fav) return;
    const idx = fav.songs.indexOf(filename);
    if (idx > -1) fav.songs.splice(idx, 1);
    else fav.songs.push(filename);
    savePlaylists();
    const btn = document.querySelector(`.like-btn[data-filename="${filename}"]`);
    if (btn) btn.classList.toggle('liked', fav.songs.includes(filename));
    displayPlaylists();
    if (currentPlaylist && currentPlaylist.id === 'favorites') viewPlaylist('favorites');
}
 
// ==================== СТАРТ ====================
window.addEventListener('DOMContentLoaded', async () => {
    await loadDatabase();
    setupAudioListeners();
    loadThemePreference();
    loadEqPreference();
    updateNavButtons();
});
 