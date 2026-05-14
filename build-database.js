const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

const MUSIC_DIR = './music';
const IMAGE_DIR = './fotomusic';
const LRC_DIR = './lrc music';
const OUTPUT_FILE = './database.json';

const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

function normalizeName(value) {
  return value.trim().replace(/\s+/g, ' ');
}

async function listFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function findMatchingFile(files, baseName, exts) {
  const lower = baseName.toLowerCase();
  const exact = files.find(name => name.toLowerCase() === `${lower}`);
  if (exact) return exact;
  return files.find(name => exts.includes(path.extname(name).toLowerCase()) && name.toLowerCase().replace(path.extname(name).toLowerCase(), '') === lower);
}

function askQuestion(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function buildDatabase() {
  const musicFiles = await listFiles(MUSIC_DIR);
  const imageFiles = await listFiles(IMAGE_DIR);
  const lrcFiles = await listFiles(LRC_DIR);

  const noFotoName = imageFiles.find(name => name.toLowerCase() === 'no foto.jpg' || name.toLowerCase() === 'no foto.jpeg' || name.toLowerCase() === 'no foto.png');
  const notSupportName = imageFiles.find(name => name.toLowerCase() === 'not support.jpg' || name.toLowerCase() === 'not support.jpeg' || name.toLowerCase() === 'not support.png');
  const noFotoPath = noFotoName ? `./fotomusic/${noFotoName}` : null;
  const notSupportPath = notSupportName ? `./fotomusic/${notSupportName}` : null;

  let chosenFallbackPath = null;
  let askedFallback = false;

  const entries = [];
  const warnings = [];

  for (const filename of musicFiles) {
    const ext = path.extname(filename).toLowerCase();
    if (!audioExts.includes(ext)) continue;

    const baseName = path.basename(filename, ext);
    const name = '';
    const artist = '';

    const matchingImage = findMatchingFile(imageFiles, baseName, imageExts);
    const matchingLrc = lrcFiles.find(file => file.toLowerCase() === `${baseName.toLowerCase()}.lrc`);

    let imagePath;

    if (matchingImage) {
      imagePath = `./fotomusic/${matchingImage}`;
    } else {
      if (!askedFallback && (noFotoPath || notSupportPath)) {
        askedFallback = true;
        const choices = [];
        if (noFotoPath) choices.push('1');
        if (notSupportPath) choices.push('2');

        const prompt = `No cover found for "${filename}". Choose fallback image:\n` +
          `${noFotoPath ? '1 - no foto (немає фото)\n' : ''}` +
          `${notSupportPath ? '2 - not support (не підтримується)\n' : ''}` +
          `Enter 1 or 2 [1]: `;

        let answer = await askQuestion(prompt);
        if (!answer) answer = '1';
        if (!choices.includes(answer)) answer = '1';

        if (answer === '2' && notSupportPath) {
          chosenFallbackPath = notSupportPath;
        } else if (noFotoPath) {
          chosenFallbackPath = noFotoPath;
        } else {
          chosenFallbackPath = notSupportPath || noFotoPath || '';
        }
      }

      if (!chosenFallbackPath) {
        chosenFallbackPath = noFotoPath || notSupportPath || '';
      }
      imagePath = chosenFallbackPath;
    }

    const entry = {
      name,
      artist,
      file: filename,
      image: imagePath,
      lyrics: '',
      lrc: matchingLrc ? `./lrc music/${matchingLrc}` : ''
    };

    if (!matchingLrc) {
      warnings.push(`.lrc not found for ${filename}`);
    }

    entries.push(entry);
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, 'uk', { sensitivity: 'base' }));
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(entries, null, 2), 'utf8');

  console.log(`Generated ${OUTPUT_FILE} with ${entries.length} tracks.`);
  if (warnings.length) {
    console.log('Warnings:');
    warnings.slice(0, 50).forEach(w => console.log(' -', w));
    if (warnings.length > 50) console.log(` - ...and ${warnings.length - 50} more warnings`);
  }
}

buildDatabase().catch(err => {
  console.error('Error generating database:', err);
  process.exit(1);
});
