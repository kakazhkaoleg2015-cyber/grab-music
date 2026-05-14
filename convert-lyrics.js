const fs = require('fs');
const readline = require('readline');

function shouldSkipLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^\[.*\]$/.test(trimmed)) return true;
  if (/^\(.*\)$/.test(trimmed)) return true;
  if (/https?:\/\//i.test(trimmed)) return true;
  if (/^www\./i.test(trimmed)) return true;
  if (/^\.+$/.test(trimmed)) return true;
  return false;
}

function normalizeLyrics(text) {
  const lines = text.split(/\r?\n/);
  const filtered = [];

  for (const line of lines) {
    let cleaned = line.replace(/\([^)]*\)/g, ' ');
    if (shouldSkipLine(cleaned)) continue;
    cleaned = cleaned.trim().replace(/\s+/g, ' ');
    if (!cleaned) continue;
    filtered.push(cleaned);
  }

  return filtered.join('/n');
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function readInteractive() {
  console.log('Paste your lyrics text below. Enter a single line with END to finish:');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];

  for await (const line of rl) {
    if (line.trim() === 'END') break;
    lines.push(line);
  }

  rl.close();
  return lines.join('\n');
}

async function main() {
  const filePath = process.argv[2];
  let input;

  if (filePath) {
    try {
      input = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('Error reading file:', err.message);
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    input = await readStdin();
  } else {
    input = await readInteractive();
  }

  const result = normalizeLyrics(input);
  console.log(result);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
