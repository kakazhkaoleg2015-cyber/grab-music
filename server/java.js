// ==================== ГЛОБАЛЬНІ ЗМІННІ ====================
let songsDatabase = [];
let currentLrcLines = [];
let lrcSyncInterval = null;
let isUserInteracting = false;
 
// ==================== ЗАВАНТАЖЕННЯ БАЗИ ====================
async function loadDatabase() {
    try {
        const response = await fetch('database.json');
        if (!response.ok) throw new Error('Файл бази не знайдено');
        songsDatabase = await response.json();
        console.log('✅ База даних завантажена успішно!', songsDatabase.length);
    } catch (error) {
        console.error('❌ Помилка завантаження бази:', error);
        songsDatabase = [];
        const lyricsContent = document.getElementById('lyricsContent');
        if (lyricsContent) lyricsContent.textContent = 'Помилка завантаження бази пісень.';
    }
    // Якщо вже є текст у пошуку – виконати пошук повторно
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
    // Оновлюємо активну кнопку
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
            const resp = await fetch(song.lrc);
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
    // Видаляємо старі кнопки, якщо є
    const oldButtons = lyricsSection.querySelector('.lyrics-buttons');
    if (oldButtons) oldButtons.remove();
    // Створюємо нові кнопки
    const btnDiv = document.createElement('div');
    btnDiv.className = 'lyrics-buttons';
    const hasLrc = !!song.lrc;
    btnDiv.innerHTML = `
        <button class="lyrics-tab-btn active" onclick="showLyricsTab('${song.file}', 'text')">📝 Текст</button>
        ${hasLrc ? '<button class="lyrics-tab-btn" onclick="showLyricsTab(\'' + song.file + '\', \'lrc\')">🎵 LRC</button>' : ''}
    `;
    const title = lyricsSection.querySelector('h2');
    title.parentNode.insertBefore(btnDiv, title.nextSibling);
    // Показуємо текст за замовчуванням
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
    audio.src = 'music/' + filename;
    const lang = window.location.href.includes('index_en.html') ? 'en' : 'uk';
    const label = lang === 'en' ? 'Now playing:' : 'Програється:';
    nowPlaying.innerHTML = `<img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="player-image" onerror="this.src='fotomusic/no-photo.jpg'">▶ ${label} <strong>${escapeHtml(song.name)}</strong> - ${escapeHtml(song.artist)}`;
    showLyrics(song);
    audio.play().catch(e => console.log('Автовідтворення заблоковане', e));
}
 
// ==================== ЗАВАНТАЖЕННЯ ФАЙЛУ ====================
function downloadSong(filename) {
    const link = document.createElement('a');
    link.href = 'music/' + filename;
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
            <img src="${escapeHtml(song.image)}" alt="${escapeHtml(song.name)}" class="song-image" onerror="this.src='fotomusic/no-photo.jpg'">
            <div class="result-info">
                <h3>${escapeHtml(song.name)}</h3>
                <p>${escapeHtml(song.artist)}</p>
            </div>
            <div class="result-buttons">
                <button class="play-btn" onclick="playSong('${escapeHtml(song.file)}')">▶ ${playLabel}</button>
                <button class="download-btn" onclick="downloadSong('${escapeHtml(song.file)}')">⬇ ${downloadLabel}</button>
            </div>
        </div>
    `).join('');
}
 
// ==================== ПЕРЕМИКАННЯ МОВИ ====================
function switchLanguage(lang) {
    if (lang === 'uk') window.location.href = 'index.html';
    else window.location.href = 'index_en.html';
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
    // Скидаємо прапорець взаємодії при скролі
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
 