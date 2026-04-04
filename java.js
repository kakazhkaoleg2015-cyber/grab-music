// ==================== ГЛОБАЛЬНІ ЗМІННІ ====================
let songsDatabase = [];
let playlistsDatabase = [];
let currentLrcLines = [];
let lrcSyncInterval = null;
let isUserInteracting = false;
let currentPlaylist = null;
 
// ==================== ЗАВАНТАЖЕННЯ БАЗИ ====================
async function loadDatabase() {
    try {
        const response = await fetch('./database.json');
        if (!response.ok) throw new Error('Файл бази не знайдено');
        songsDatabase = await response.json();
        console.log('✅ База даних завантажена успішно!', songsDatabase.length);
    } catch (error) {
        console.error('❌ Помилка завантаження бази:', error);
        songsDatabase = [];
        const lyricsContent = document.getElementById('lyricsContent');
        if (lyricsContent) lyricsContent.textContent = 'Помилка завантаження бази пісень.';
    }
    try {
        const response = await fetch('./playlists.json');
        if (!response.ok) throw new Error('Файл плейлистів не знайдено');
        playlistsDatabase = await response.json();
        console.log('✅ Плейлисти завантажені успішно!');
        displayPlaylists();
    } catch (error) {
        console.error('⚠️ Помилка завантаження плейлистів:', error);
        playlistsDatabase = [];
    }
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.value.trim() !== '') searchSongs();
}
 
// ==================== ПАРСИНГ LRC ====================
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
 
// ==================== СИНХРОНІЗАЦІЯ LRC ====================
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
 
// ==================== ПОКАЗ ТЕКСТУ АБО LRC ====================
async function showLyricsTab(filename, type) {
    const song = songsDatabase.find(s => s.file === filename);
    if (!song) return;
    const lyricsContent = document.getElementById('lyricsContent');
    document.querySelectorAll('.lyrics-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if ((type === 'text' && btn.textContent.includes('Текст')) ||
            (type === 'text' && btn.textContent.includes('Text')) ||
            (type === 'lrc' && btn.textContent.includes('LRC'))) {
            btn.classList.add('active');
        }
    });
    if (type === 'text') {
        if (lrcSyncInterval) clearInterval(lrcSyncInterval);
        lrcSyncInterval = null;
        currentLrcLines = [];
        lyricsContent.textContent = song.lyrics || (window.location.href.includes('index_en.html') ? 'No lyrics.' : 'Текст відсутній.');
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
                lyricsContent.textContent = 'Неправильний формат LRC.';
                currentLrcLines = [];
            }
        } catch (err) {
            console.error('LRC помилка:', err);
            lyricsContent.textContent = 'Не вдалося завантажити LRC файл.';
            currentLrcLines = [];
        }
    } else {
        lyricsContent.textContent = 'LRC файл недоступний.';
        currentLrcLines = [];
    }
}
 
// Допоміжна функція для безпечного HTML
function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
 
// ==================== ПОКАЗ КНОПОК ТА ТЕКСТУ ПІСНІ ====================
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
        <button class="lyrics-tab-btn active" onclick="showLyricsTab('${song.file}', 'text')">📝 Текст</button>
        ${hasLrc ? '<button class="lyrics-tab-btn" onclick="showLyricsTab(\'' + song.file + '\', \'lrc\')">🎵 LRC</button>' : ''}
    `;
    const title = lyricsSection.querySelector('h2');
    title.parentNode.insertBefore(btnDiv, title.nextSibling);
    lyricsContent.textContent = song.lyrics || (window.location.href.includes('index_en.html') ? 'No lyrics.' : 'Текст відсутній.');
    currentLrcLines = [];
    if (lrcSyncInterval) clearInterval(lrcSyncInterval);
    lrcSyncInterval = null;
}
 
// ==================== ПРОГРАВАННЯ ПІСНІ ====================
function playSong(filename) {
    const audio = document.getElementById('audioPlayer');
    const nowPlaying = document.getElementById('nowPlaying');
    const song = songsDatabase.find(s => s.file === filename);
    if (!song) {
        console.error('Пісня не знайдена в базі');
        return;
    }
    if (lrcSyncInterval) clearInterval(lrcSyncInterval);
    lrcSyncInterval = null;
    audio.src = './music/' + filename;
    const lang = window.location.href.includes('index_en.html') ? 'en' : 'uk';
    const label = lang === 'en' ? 'Now playing:' : 'Програється:';
    nowPlaying.innerHTML = `<img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="player-image" onerror="this.src='./fotomusic/no-photo.jpg'">▶ ${label} <strong>${escapeHtml(song.name)}</strong> - ${escapeHtml(song.artist)}`;
    showLyrics(song);
    audio.play().catch(e => console.log('Автовідтворення заблоковане', e));
}
 
// ==================== ЗАВАНТАЖЕННЯ ФАЙЛУ ====================
function downloadSong(filename) {
    const link = document.createElement('a');
    link.href = './music/' + filename;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
 
// ==================== ПОШУК ====================
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
        resultsDiv.innerHTML = '<p class="no-results">❌ Пісні не знайдені</p>';
        return;
    }
    
    const lang = window.location.href.includes('index_en.html') ? 'en' : 'uk';
    const playLabel = lang === 'en' ? 'Play' : 'Програвати';
    const downloadLabel = lang === 'en' ? 'Download' : 'Скачати';
    
    resultsDiv.innerHTML = results.map(song => `
        <div class="result-item">
            <img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="song-image" onerror="this.src='./fotomusic/no-photo.jpg'">
            <div class="result-info">
                <h3>${escapeHtml(song.name)}</h3>
                <p>${escapeHtml(song.artist)}</p>
            </div>
            <div class="result-buttons">
                <button class="play-btn" onclick="playSong('${escapeHtml(song.file)}')">▶ ${playLabel}</button>
                <button class="download-btn" onclick="downloadSong('${escapeHtml(song.file)}')">⬇ ${downloadLabel}</button>
                <button class="like-btn ${isFavorite(song.file) ? 'liked' : ''}" onclick="toggleFavorite('${escapeHtml(song.file)}')">❤️</button>
            </div>
        </div>
    `).join('');
}
 
// ==================== ПЕРЕМИКАННЯ МОВИ ====================
function switchLanguage(lang) {
    if (lang === 'uk') window.location.href = './index.html';
    else window.location.href = './index_en.html';
}
 
// ==================== МОДАЛЬНІ ВІКНА ====================
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
 
// ==================== СЛУХАЧІ ДЛЯ ПАУЗИ/ПРОГРАВАННЯ ====================
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
 
// ==================== СТАРТ ====================
window.addEventListener('DOMContentLoaded', async () => {
    await loadDatabase();
    setupAudioListeners();
});
 
// ==================== ПЛЕЙЛИСТИ ====================
function displayPlaylists() {
    const playlistsList = document.getElementById('playlistsList');
    if (!playlistsList) return;
    
    const lang = window.location.href.includes('index_en.html') ? 'en' : 'uk';
    const viewLabel = lang === 'en' ? 'View' : 'Переглянути';
    
    playlistsList.innerHTML = playlistsDatabase.map(playlist => `
        <div class="playlist-card">
            <div class="playlist-card-info">
                <h4>${lang === 'en' ? playlist.name_en : playlist.name}</h4>
                <p>${playlist.songs.length} ${lang === 'en' ? 'songs' : 'пісень'}</p>
            </div>
            <button class="view-btn" onclick="viewPlaylist('${playlist.id}')">▶ ${viewLabel}</button>
        </div>
    `).join('');
}
 
function viewPlaylist(playlistId) {
    currentPlaylist = playlistsDatabase.find(p => p.id === playlistId);
    if (!currentPlaylist) return;
    
    const resultsDiv = document.getElementById('searchResults');
    const lang = window.location.href.includes('index_en.html') ? 'en' : 'uk';
    const playLabel = lang === 'en' ? 'Play' : 'Програвати';
    const downloadLabel = lang === 'en' ? 'Download' : 'Скачати';
    
    const songs = currentPlaylist.songs
        .map(filename => songsDatabase.find(s => s.file === filename))
        .filter(song => song);
    
    resultsDiv.innerHTML = `
        <div style="margin-bottom: 20px;">
            <button class="back-btn" onclick="backToPlaylists()" style="padding: 8px 16px; background: #a4c2f4; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">← ${lang === 'en' ? 'Back' : 'Назад'}</button>
            <h2 style="color: #a4c2f4; margin-top: 15px;">📋 ${lang === 'en' ? currentPlaylist.name_en : currentPlaylist.name}</h2>
        </div>
        ${songs.map(song => `
            <div class="result-item">
                <img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="song-image" onerror="this.src='./fotomusic/no-photo.jpg'">
                <div class="result-info">
                    <h3>${escapeHtml(song.name)}</h3>
                    <p>${escapeHtml(song.artist)}</p>
                </div>
                <div class="result-buttons">
                    <button class="play-btn" onclick="playSong('${escapeHtml(song.file)}')">▶ ${playLabel}</button>
                    <button class="download-btn" onclick="downloadSong('${escapeHtml(song.file)}')">⬇ ${downloadLabel}</button>
                    <button class="like-btn ${isFavorite(song.file) ? 'liked' : ''}" onclick="toggleFavorite('${escapeHtml(song.file)}')">❤️</button>
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
}
 
function addToPlaylist(playlistId, filename) {
    const playlist = playlistsDatabase.find(p => p.id === playlistId);
    if (playlist && !playlist.songs.includes(filename)) {
        playlist.songs.push(filename);
        console.log('✅ Пісня додана до плейлиста');
    }
}
 
// ==================== СИСТЕМА ЛАЙКІВ ====================
function isFavorite(filename) {
    const favorites = playlistsDatabase.find(p => p.id === 'favorites');
    return favorites && favorites.songs.includes(filename);
}
 
function toggleFavorite(filename) {
    const favorites = playlistsDatabase.find(p => p.id === 'favorites');
    if (!favorites) return;
    
    const index = favorites.songs.indexOf(filename);
    if (index > -1) {
        // Видалити з улюблених
        favorites.songs.splice(index, 1);
        console.log('❌ Пісня видалена з улюблених');
    } else {
        // Додати в улюблені
        favorites.songs.push(filename);
        console.log('✅ Пісня додана в улюблені');
    }
    
    // Оновити кнопку
    const buttons = document.querySelectorAll('.like-btn');
    buttons.forEach(btn => {
        if (btn.onclick.toString().includes(filename)) {
            btn.classList.toggle('liked');
        }
    });
    
    // Перезавантажити результати якщо вони видимі
    if (!document.getElementById('searchInput').value.trim()) {
        displayPlaylists();
    }
}