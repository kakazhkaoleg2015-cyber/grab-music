// ==================== GLOBAL VARIABLES ====================
let songsDatabase = [];
let playlistsDatabase = [];
let currentLrcLines = [];
let lrcSyncInterval = null;
let isUserInteracting = false;
let currentPlaylist = null;

// For auto-playing playlist
let currentQueue = [];
let currentQueueIndex = -1;
let playlistEndedHandler = null;
let isPlaylistLoopEnabled = false;

// Audio context and equalizer
let audioContext = null;
let sourceNode = null;
let analyserNode = null;
let bassFilter = null;
let midFilter = null;
let trebleFilter = null;
let visualizerAnimationId = null;
let isEqInitialized = false;

// ==================== LANGUAGE DETECTION ====================
let currentLanguage = window.location.pathname.includes('_en.html') ? 'en' : 'uk';

// ==================== TRANSLATIONS ====================
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

function t(key) {
    return translations[currentLanguage][key] || key;
}

// ==================== THEME MANAGEMENT ====================
function loadThemePreference() {
    const savedTheme = localStorage.getItem('grab_music_theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        const toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn) toggleBtn.innerHTML = '☀️';
    } else {
        document.body.classList.remove('dark-theme');
        const toggleBtn = document.getElementById('themeToggle');
        if (toggleBtn) toggleBtn.innerHTML = '🌙';
    }
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('grab_music_theme', isDark ? 'dark' : 'light');
    const toggleBtn = document.getElementById('themeToggle');
    if (toggleBtn) toggleBtn.innerHTML = isDark ? '☀️' : '🌙';
}

// ==================== UPDATE EQUALIZER LABELS ON LANGUAGE CHANGE ====================
function updateEqualizerLabels() {
    const eqDiv = document.getElementById('eqControls');
    if (!eqDiv) return;
    // Save current slider values before rebuilding
    const bassVal = document.getElementById('bassSlider')?.value || 0;
    const midVal = document.getElementById('midSlider')?.value || 0;
    const trebleVal = document.getElementById('trebleSlider')?.value || 0;
    eqDiv.innerHTML = `
        <label>${t('eqBass')} <input type="range" id="bassSlider" min="-20" max="20" value="${bassVal}" step="1"></label>
        <label>${t('eqMid')} <input type="range" id="midSlider" min="-20" max="20" value="${midVal}" step="1"></label>
        <label>${t('eqTreble')} <input type="range" id="trebleSlider" min="-20" max="20" value="${trebleVal}" step="1"></label>
        <button id="resetEqBtn" class="reset-eq-btn" title="${t('resetEq')}">${t('resetEq')}</button>
    `;
    // Reattach event listeners if filters exist
    if (bassFilter && midFilter && trebleFilter) {
        const bassSlider = document.getElementById('bassSlider');
        const midSlider = document.getElementById('midSlider');
        const trebleSlider = document.getElementById('trebleSlider');
        const resetBtn = document.getElementById('resetEqBtn');
        if (bassSlider) bassSlider.addEventListener('input', (e) => { bassFilter.gain.value = e.target.value; });
        if (midSlider) midSlider.addEventListener('input', (e) => { midFilter.gain.value = e.target.value; });
        if (trebleSlider) trebleSlider.addEventListener('input', (e) => { trebleFilter.gain.value = e.target.value; });
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                const bs = document.getElementById('bassSlider');
                const ms = document.getElementById('midSlider');
                const ts = document.getElementById('trebleSlider');
                if (bs) bs.value = 0;
                if (ms) ms.value = 0;
                if (ts) ts.value = 0;
                if (bassFilter) bassFilter.gain.value = 0;
                if (midFilter) midFilter.gain.value = 0;
                if (trebleFilter) trebleFilter.gain.value = 0;
            });
        }
    }
}

// ==================== EQUALIZER SETUP ====================
function initEqualizer() {
    const audio = document.getElementById('audioPlayer');
    if (!audio || isEqInitialized) return;

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        sourceNode = audioContext.createMediaElementSource(audio);
        
        // Create filters
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
        
        // Analyser for visualizer
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 256;
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Connect: source -> filters -> analyser -> destination
        sourceNode.connect(bassFilter);
        bassFilter.connect(midFilter);
        midFilter.connect(trebleFilter);
        trebleFilter.connect(analyserNode);
        analyserNode.connect(audioContext.destination);
        
        // Visualizer canvas
        const canvas = document.getElementById('visualizer');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            function draw() {
                if (!analyserNode) return;
                visualizerAnimationId = requestAnimationFrame(draw);
                analyserNode.getByteFrequencyData(dataArray);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const barWidth = (canvas.width / bufferLength) * 2.5;
                let x = 0;
                for (let i = 0; i < bufferLength; i++) {
                    const barHeight = dataArray[i] / 2;
                    ctx.fillStyle = `hsl(${200 + i / bufferLength * 100}, 80%, 60%)`;
                    ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
                    x += barWidth;
                }
            }
            draw();
        }
        
        // Connect sliders and reset button
        const bassSlider = document.getElementById('bassSlider');
        const midSlider = document.getElementById('midSlider');
        const trebleSlider = document.getElementById('trebleSlider');
        const resetBtn = document.getElementById('resetEqBtn');
        if (bassSlider) bassSlider.addEventListener('input', (e) => { bassFilter.gain.value = e.target.value; });
        if (midSlider) midSlider.addEventListener('input', (e) => { midFilter.gain.value = e.target.value; });
        if (trebleSlider) trebleSlider.addEventListener('input', (e) => { trebleFilter.gain.value = e.target.value; });
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (bassSlider) bassSlider.value = 0;
                if (midSlider) midSlider.value = 0;
                if (trebleSlider) trebleSlider.value = 0;
                bassFilter.gain.value = 0;
                midFilter.gain.value = 0;
                trebleFilter.gain.value = 0;
            });
        }
        
        isEqInitialized = true;
        
        audio.addEventListener('play', () => {
            if (audioContext.state === 'suspended') audioContext.resume();
            const eqDiv = document.getElementById('eqControls');
            if (eqDiv) eqDiv.style.display = 'flex';
        });
    } catch (e) {
        console.error('Equalizer init error:', e);
    }
}

// ==================== LOCALSTORAGE PERSISTENCE ====================
const STORAGE_KEY = 'grab_music_playlists';

function savePlaylistsToLocalStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(playlistsDatabase));
    } catch (e) {}
}

function loadPlaylistsFromLocalStorage() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                playlistsDatabase = parsed;
                return true;
            }
        } catch (e) {}
    }
    return false;
}

// ==================== LOAD DATABASE ====================
async function loadDatabase() {
    try {
        const response = await fetch('./database.json');
        if (!response.ok) throw new Error();
        songsDatabase = await response.json();
    } catch (error) {
        songsDatabase = [];
        const lyricsContent = document.getElementById('lyricsContent');
        if (lyricsContent) lyricsContent.textContent = t('errorLoadingDB');
    }

    if (!loadPlaylistsFromLocalStorage()) {
        try {
            const response = await fetch('./playlists.json');
            if (response.ok) playlistsDatabase = await response.json();
        } catch (e) { playlistsDatabase = []; }
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
        savePlaylistsToLocalStorage();
    }

    displayPlaylists();
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.value.trim() !== '') searchSongs();
    
    // Update equalizer labels after page load
    updateEqualizerLabels();
}

// ==================== LRC PARSING & SYNC ====================
function parseLRC(lrcText) {
    const lines = [];
    const regex = /\[(\d{2}):(\d{2})\.(\d{2})\]/;
    lrcText.split('\n').forEach(line => {
        const match = line.match(regex);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const centiseconds = parseInt(match[3]);
            const time = minutes * 60 + seconds + centiseconds / 100;
            const text = line.replace(regex, '').trim();
            if (text) lines.push({ time, text });
        }
    });
    return lines;
}

function syncLRC() {
    const audio = document.getElementById('audioPlayer');
    if (!audio || currentLrcLines.length === 0 || isUserInteracting) return;
    const currentTime = audio.currentTime;
    let activeIndex = -1;
    for (let i = 0; i < currentLrcLines.length; i++) {
        if (currentLrcLines[i].time <= currentTime) activeIndex = i;
        else break;
    }
    const lines = document.querySelectorAll('.lrc-line');
    const currentActive = document.querySelector('.lrc-line.active');
    if (currentActive && lines && activeIndex >= 0 && lines[activeIndex] && currentActive !== lines[activeIndex]) {
        currentActive.classList.remove('active');
        lines[activeIndex].classList.add('active');
        lines[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

async function showLyricsTab(filename, type) {
    const song = songsDatabase.find(s => s.file === filename);
    if (!song) return;
    const lyricsContent = document.getElementById('lyricsContent');
    document.querySelectorAll('.lyrics-tab-btn').forEach(btn => btn.classList.remove('active'));
    if (type === 'text') {
        if (lrcSyncInterval) clearInterval(lrcSyncInterval);
        lrcSyncInterval = null;
        currentLrcLines = [];
        lyricsContent.textContent = song.lyrics || t('noLyrics');
        document.querySelector('.lyrics-tab-btn:first-child')?.classList.add('active');
    } else if (type === 'lrc' && song.lrc) {
        try {
            const resp = await fetch('./' + song.lrc);
            if (!resp.ok) throw new Error();
            const lrcText = await resp.text();
            currentLrcLines = parseLRC(lrcText);
            if (currentLrcLines.length) {
                lyricsContent.innerHTML = currentLrcLines.map(line => `<div class="lrc-line">${escapeHtml(line.text)}</div>`).join('');
                if (lrcSyncInterval) clearInterval(lrcSyncInterval);
                lrcSyncInterval = setInterval(syncLRC, 100);
                syncLRC();
                document.querySelector('.lyrics-tab-btn:last-child')?.classList.add('active');
            } else lyricsContent.textContent = t('invalidLrc');
        } catch (err) {
            lyricsContent.textContent = t('lrcNotAvailable');
        }
    } else {
        lyricsContent.textContent = t('lrcNotAvailable');
    }
}

function escapeHtml(str) {
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

function showLyrics(song) {
    const lyricsSection = document.getElementById('lyricsSection');
    const lyricsContent = document.getElementById('lyricsContent');
    if (!lyricsSection || !lyricsContent) return;
    const oldButtons = lyricsSection.querySelector('.lyrics-buttons');
    if (oldButtons) oldButtons.remove();
    const btnDiv = document.createElement('div');
    btnDiv.className = 'lyrics-buttons';
    const hasLrc = !!song.lrc;
    btnDiv.innerHTML = `
        <button class="lyrics-tab-btn active" onclick="showLyricsTab('${song.file}', 'text')">${t('lyricsTabText')}</button>
        ${hasLrc ? `<button class="lyrics-tab-btn" onclick="showLyricsTab('${song.file}', 'lrc')">${t('lrcTabText')}</button>` : ''}
    `;
    const title = lyricsSection.querySelector('h2');
    title.parentNode.insertBefore(btnDiv, title.nextSibling);
    lyricsContent.textContent = song.lyrics || t('noLyrics');
    currentLrcLines = [];
    if (lrcSyncInterval) clearInterval(lrcSyncInterval);
    lrcSyncInterval = null;
}

// ==================== PLAY SONG ====================
function playSong(filename, fromQueue = false) {
    if (!fromQueue) clearQueue();

    const audio = document.getElementById('audioPlayer');
    const nowPlayingDiv = document.getElementById('nowPlaying');
    const song = songsDatabase.find(s => s.file === filename);
    if (!song) return;

    if (lrcSyncInterval) clearInterval(lrcSyncInterval);
    lrcSyncInterval = null;
    audio.src = './music/' + filename;
    const label = t('nowPlayingLabel');
    let loopBtnHtml = '';
    if (currentQueue.length > 0) {
        loopBtnHtml = `<button class="loop-btn ${isPlaylistLoopEnabled ? 'active' : ''}" onclick="togglePlaylistLoop()">🔁</button>`;
    }
    nowPlayingDiv.innerHTML = `<img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="player-image" onerror="this.src='./fotomusic/no-photo.jpg'">▶ ${label} <strong>${escapeHtml(song.name)}</strong> - ${escapeHtml(song.artist)} ${loopBtnHtml}`;
    showLyrics(song);
    audio.play().catch(e => console.log('Autoplay blocked', e));
    
    if (!isEqInitialized) initEqualizer();
}

// ==================== PLAYLIST AUTO-PLAY ====================
function clearQueue() {
    if (playlistEndedHandler) {
        const audio = document.getElementById('audioPlayer');
        if (audio) audio.removeEventListener('ended', playlistEndedHandler);
        playlistEndedHandler = null;
    }
    currentQueue = [];
    currentQueueIndex = -1;
    const nowPlayingDiv = document.getElementById('nowPlaying');
    if (nowPlayingDiv && !nowPlayingDiv.innerHTML.includes('loop-btn')) {
        const loopBtn = nowPlayingDiv.querySelector('.loop-btn');
        if (loopBtn) loopBtn.remove();
    }
    isPlaylistLoopEnabled = false;
}

function playNextInQueue() {
    if (currentQueueIndex + 1 < currentQueue.length) {
        currentQueueIndex++;
        playSong(currentQueue[currentQueueIndex], true);
    } else if (isPlaylistLoopEnabled && currentQueue.length > 0) {
        currentQueueIndex = 0;
        playSong(currentQueue[currentQueueIndex], true);
    } else {
        clearQueue();
        const nowPlayingDiv = document.getElementById('nowPlaying');
        if (nowPlayingDiv) nowPlayingDiv.innerHTML = t('playlistEnded');
    }
}

function playPlaylist(songFiles) {
    if (!songFiles.length) return;
    clearQueue();
    currentQueue = [...songFiles];
    currentQueueIndex = 0;
    if (!playlistEndedHandler) {
        const audio = document.getElementById('audioPlayer');
        playlistEndedHandler = () => playNextInQueue();
        audio.addEventListener('ended', playlistEndedHandler);
    }
    playSong(currentQueue[0], true);
}

function togglePlaylistLoop() {
    if (currentQueue.length === 0) return;
    isPlaylistLoopEnabled = !isPlaylistLoopEnabled;
    const loopBtn = document.querySelector('#nowPlaying .loop-btn');
    if (loopBtn) {
        if (isPlaylistLoopEnabled) {
            loopBtn.classList.add('active');
        } else {
            loopBtn.classList.remove('active');
        }
    }
}

// ==================== DOWNLOAD SONG ====================
function downloadSong(filename) {
    const link = document.createElement('a');
    link.href = './music/' + filename;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==================== SEARCH ====================
function searchSongs() {
    const input = document.getElementById('searchInput');
    const resultsDiv = document.getElementById('searchResults');
    const query = input.value.trim().toLowerCase();
    if (!query) { resultsDiv.innerHTML = ''; return; }
    const results = songsDatabase.filter(song => song.name.toLowerCase().includes(query) || song.artist.toLowerCase().includes(query));
    if (!results.length) { resultsDiv.innerHTML = `<p class="no-results">${t('noResults')}</p>`; return; }
    
    resultsDiv.innerHTML = results.map(song => `
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

// ==================== SWITCH LANGUAGE ====================
function switchLanguage(lang) {
    if (lang === 'uk') window.location.href = './index.html';
    else window.location.href = './index_en.html';
}

// ==================== MODALS ====================
function openModal() { document.getElementById('tutorial-modal').style.display = 'block'; }
function closeModal() { document.getElementById('tutorial-modal').style.display = 'none'; }
function openPremiumModal() { document.getElementById('premium-modal').style.display = 'block'; }
function closePremiumModal() { document.getElementById('premium-modal').style.display = 'none'; }
window.onclick = function(e) {
    if (e.target === document.getElementById('tutorial-modal')) closeModal();
    if (e.target === document.getElementById('premium-modal')) closePremiumModal();
};

// ==================== AUDIO LISTENERS ====================
function setupAudioListeners() {
    const audio = document.getElementById('audioPlayer');
    if (!audio || audio.hasAttribute('data-listener')) return;
    audio.setAttribute('data-listener', 'true');
    audio.addEventListener('play', () => {
        if (currentLrcLines.length && !lrcSyncInterval) {
            lrcSyncInterval = setInterval(syncLRC, 100);
            syncLRC();
        }
    });
    audio.addEventListener('pause', () => {
        if (lrcSyncInterval) clearInterval(lrcSyncInterval);
        lrcSyncInterval = null;
    });
    ['scroll', 'wheel', 'touchmove'].forEach(ev => {
        document.addEventListener(ev, () => {
            isUserInteracting = true;
            setTimeout(() => { isUserInteracting = false; }, 500);
        });
    });
}

// ==================== START ====================
window.addEventListener('DOMContentLoaded', async () => {
    await loadDatabase();
    setupAudioListeners();
    loadThemePreference();
});

// ==================== PLAYLISTS DISPLAY ====================
function displayPlaylists() {
    const container = document.getElementById('playlistsContainer');
    if (!container) return;
    container.innerHTML = playlistsDatabase.map(playlist => {
        const name = currentLanguage === 'en' ? (playlist.name_en || playlist.name) : playlist.name;
        const desc = currentLanguage === 'en' ? (playlist.description_en || playlist.description) : playlist.description;
        return `
        <div class="playlist-item">
            <div class="playlist-info">
                <h3>📋 ${escapeHtml(name)}</h3>
                <p>${escapeHtml(desc)}</p>
                <small>${playlist.songs.length} ${currentLanguage === 'en' ? 'songs' : 'пісень'}</small>
            </div>
            <button class="view-btn" onclick="viewPlaylist('${playlist.id}')">▶ ${t('viewBtn')}</button>
        </div>
    `}).join('');
}

function viewPlaylist(playlistId) {
    currentPlaylist = playlistsDatabase.find(p => p.id === playlistId);
    if (!currentPlaylist) return;
    const resultsDiv = document.getElementById('searchResults');
    const songs = currentPlaylist.songs.map(fn => songsDatabase.find(s => s.file === fn)).filter(s => s);
    const playlistName = currentLanguage === 'en' ? (currentPlaylist.name_en || currentPlaylist.name) : currentPlaylist.name;
    const playAllButton = songs.length ? `<button class="play-all-btn" onclick="playPlaylist(${JSON.stringify(currentPlaylist.songs).replace(/"/g, '&quot;')})">▶ ${t('playAllBtn')}</button>` : '';
    resultsDiv.innerHTML = `
        <div style="margin-bottom:20px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <button class="back-btn" onclick="backToPlaylists()" style="padding:8px 16px; background:var(--accent-color); color:#1a2a3a; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">← ${t('backBtn')}</button>
            ${playAllButton}
        </div>
        <h2 style="color:var(--accent-color); margin-top:0;">📋 ${escapeHtml(playlistName)}</h2>
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
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    displayPlaylists();
    const resultsDiv = document.getElementById('searchResults');
    if (resultsDiv) resultsDiv.innerHTML = '';
}

// ==================== FAVORITES ====================
function isFavorite(filename) {
    const fav = playlistsDatabase.find(p => p.id === 'favorites');
    return fav && fav.songs.includes(filename);
}

function toggleFavorite(filename) {
    const fav = playlistsDatabase.find(p => p.id === 'favorites');
    if (!fav) return;
    const idx = fav.songs.indexOf(filename);
    if (idx > -1) fav.songs.splice(idx, 1);
    else fav.songs.push(filename);
    savePlaylistsToLocalStorage();
    const btn = document.querySelector(`.like-btn[data-filename="${filename}"]`);
    if (btn) btn.classList.toggle('liked', fav.songs.includes(filename));
    displayPlaylists();
    if (currentPlaylist && currentPlaylist.id === 'favorites') viewPlaylist('favorites');
}