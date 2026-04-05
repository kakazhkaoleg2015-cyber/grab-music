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

// ==================== LANGUAGE DETECTION ====================
let currentLanguage = window.location.pathname.includes('_en.html') ? 'en' : 'uk';

// ==================== TRANSLATIONS FOR DYNAMIC MESSAGES ====================
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
        lrcTabText: '🎵 LRC'
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
        lrcTabText: '🎵 LRC'
    }
};

function t(key) {
    return translations[currentLanguage][key] || key;
}

// ==================== LOAD DATABASE ====================
async function loadDatabase() {
    try {
        const response = await fetch('./database.json');
        if (!response.ok) throw new Error('Database file not found');
        songsDatabase = await response.json();
        console.log('✅ Database loaded successfully!', songsDatabase.length);
    } catch (error) {
        console.error('❌ Error loading database:', error);
        songsDatabase = [];
        const lyricsContent = document.getElementById('lyricsContent');
        if (lyricsContent) lyricsContent.textContent = t('errorLoadingDB');
    }
    try {
        const response = await fetch('./playlists.json');
        if (!response.ok) throw new Error('Playlists file not found');
        playlistsDatabase = await response.json();
        // Ensure "Favorites" playlist exists
        if (!playlistsDatabase.find(p => p.id === 'favorites')) {
            playlistsDatabase.push({
                id: 'favorites',
                name: 'Улюблене',
                name_en: 'Favorites',
                description: 'Твої улюблені пісні',
                description_en: 'Your favorite songs',
                songs: []
            });
        }
        console.log('✅ Playlists loaded successfully!');
        displayPlaylists();
    } catch (error) {
        console.error('⚠️ Error loading playlists:', error);
        playlistsDatabase = [];
    }
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.value.trim() !== '') searchSongs();
}

// ==================== LRC PARSING ====================
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

// ==================== LRC SYNC ====================
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
    const currentIdx = currentActive ? Array.from(lines).indexOf(currentActive) : -1;
    if (currentIdx !== activeIndex && activeIndex >= 0 && lines[activeIndex]) {
        if (currentActive) currentActive.classList.remove('active');
        lines[activeIndex].classList.add('active');
        lines[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// ==================== DISPLAY LYRICS OR LRC ====================
async function showLyricsTab(filename, type) {
    const song = songsDatabase.find(s => s.file === filename);
    if (!song) return;
    const lyricsContent = document.getElementById('lyricsContent');
    document.querySelectorAll('.lyrics-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if ((type === 'text' && btn.textContent.includes(t('lyricsTabText'))) ||
            (type === 'lrc' && btn.textContent.includes('LRC'))) {
            btn.classList.add('active');
        }
    });
    if (type === 'text') {
        if (lrcSyncInterval) clearInterval(lrcSyncInterval);
        lrcSyncInterval = null;
        currentLrcLines = [];
        lyricsContent.textContent = song.lyrics || t('noLyrics');
    } else if (type === 'lrc' && song.lrc) {
        try {
            const resp = await fetch('./' + song.lrc);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const lrcText = await resp.text();
            currentLrcLines = parseLRC(lrcText);
            if (currentLrcLines.length) {
                lyricsContent.innerHTML = currentLrcLines.map(line => `<div class="lrc-line">${escapeHtml(line.text)}</div>`).join('');
                if (lrcSyncInterval) clearInterval(lrcSyncInterval);
                lrcSyncInterval = setInterval(syncLRC, 100);
                syncLRC();
            } else {
                lyricsContent.textContent = t('invalidLrc');
                currentLrcLines = [];
            }
        } catch (err) {
            console.error('LRC error:', err);
            lyricsContent.textContent = t('lrcNotAvailable');
            currentLrcLines = [];
        }
    } else {
        lyricsContent.textContent = t('lrcNotAvailable');
        currentLrcLines = [];
    }
}

function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ==================== SHOW LYRICS BUTTONS ====================
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
        ${hasLrc ? '<button class="lyrics-tab-btn" onclick="showLyricsTab(\'' + song.file + '\', \'lrc\')">' + t('lrcTabText') + '</button>' : ''}
    `;
    const title = lyricsSection.querySelector('h2');
    title.parentNode.insertBefore(btnDiv, title.nextSibling);
    lyricsContent.textContent = song.lyrics || t('noLyrics');
    currentLrcLines = [];
    if (lrcSyncInterval) clearInterval(lrcSyncInterval);
    lrcSyncInterval = null;
}

// ==================== PLAY SONG (with queue support) ====================
function playSong(filename, fromQueue = false) {
    if (!fromQueue) clearQueue();

    const audio = document.getElementById('audioPlayer');
    const nowPlaying = document.getElementById('nowPlaying');
    const song = songsDatabase.find(s => s.file === filename);
    if (!song) {
        console.error('Song not found in database');
        return;
    }
    if (lrcSyncInterval) clearInterval(lrcSyncInterval);
    lrcSyncInterval = null;
    audio.src = './music/' + filename;
    const label = t('nowPlayingLabel');
    nowPlaying.innerHTML = `<img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="player-image" onerror="this.src='./fotomusic/no-photo.jpg'">▶ ${label} <strong>${escapeHtml(song.name)}</strong> - ${escapeHtml(song.artist)}`;
    showLyrics(song);
    audio.play().catch(e => console.log('Autoplay blocked', e));
}

// ==================== AUTO-PLAY PLAYLIST ====================
function clearQueue() {
    if (playlistEndedHandler) {
        const audio = document.getElementById('audioPlayer');
        if (audio) audio.removeEventListener('ended', playlistEndedHandler);
        playlistEndedHandler = null;
    }
    currentQueue = [];
    currentQueueIndex = -1;
}

function playNextInQueue() {
    if (currentQueueIndex + 1 < currentQueue.length) {
        currentQueueIndex++;
        playSong(currentQueue[currentQueueIndex], true);
    } else {
        clearQueue();
        const nowPlaying = document.getElementById('nowPlaying');
        if (nowPlaying) nowPlaying.innerHTML = t('playlistEnded');
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
    if (!query) {
        resultsDiv.innerHTML = '';
        return;
    }
    const results = songsDatabase.filter(song =>
        song.name.toLowerCase().includes(query) ||
        song.artist.toLowerCase().includes(query)
    );
    if (!results.length) {
        resultsDiv.innerHTML = `<p class="no-results">${t('noResults')}</p>`;
        return;
    }
    
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
function openModal() {
    const modal = document.getElementById('tutorial-modal');
    if (modal) modal.style.display = 'block';
}
function closeModal() {
    const modal = document.getElementById('tutorial-modal');
    if (modal) modal.style.display = 'none';
}

function openPremiumModal() {
    const modal = document.getElementById('premium-modal');
    if (modal) modal.style.display = 'block';
}
function closePremiumModal() {
    const modal = document.getElementById('premium-modal');
    if (modal) modal.style.display = 'none';
}

window.onclick = function(e) {
    const tutorialModal = document.getElementById('tutorial-modal');
    const premiumModal = document.getElementById('premium-modal');
    if (e.target === tutorialModal) tutorialModal.style.display = 'none';
    if (e.target === premiumModal) premiumModal.style.display = 'none';
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
});

// ==================== PLAYLISTS ====================
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
    
    const songs = currentPlaylist.songs
        .map(filename => songsDatabase.find(s => s.file === filename))
        .filter(song => song);
    
    const playlistName = currentLanguage === 'en' ? (currentPlaylist.name_en || currentPlaylist.name) : currentPlaylist.name;
    const playAllButton = songs.length > 0 
        ? `<button class="play-all-btn" onclick="playPlaylist(${JSON.stringify(currentPlaylist.songs).replace(/"/g, '&quot;')})">▶ ${t('playAllBtn')}</button>`
        : '';
    
    resultsDiv.innerHTML = `
        <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <button class="back-btn" onclick="backToPlaylists()" style="padding: 8px 16px; background: #a4c2f4; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">← ${t('backBtn')}</button>
            ${playAllButton}
        </div>
        <h2 style="color: #a4c2f4; margin-top: 0;">📋 ${escapeHtml(playlistName)}</h2>
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

// ==================== FAVORITES SYSTEM ====================
function isFavorite(filename) {
    const favorites = playlistsDatabase.find(p => p.id === 'favorites');
    return favorites && favorites.songs.includes(filename);
}

function toggleFavorite(filename) {
    const favorites = playlistsDatabase.find(p => p.id === 'favorites');
    if (!favorites) return;
    
    const index = favorites.songs.indexOf(filename);
    if (index > -1) {
        favorites.songs.splice(index, 1);
        console.log(t('favoriteRemoved'));
    } else {
        favorites.songs.push(filename);
        console.log(t('favoriteAdded'));
    }
    
    // Update like button state
    const likeBtn = document.querySelector(`.like-btn[data-filename="${filename}"]`);
    if (likeBtn) {
        if (favorites.songs.includes(filename)) {
            likeBtn.classList.add('liked');
        } else {
            likeBtn.classList.remove('liked');
        }
    }
    
    // Update playlist counters and view if needed
    displayPlaylists();
    if (currentPlaylist && currentPlaylist.id === 'favorites') {
        viewPlaylist('favorites');
    }
}