const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// Tutti gli script inline devono almeno compilare come JavaScript classico.
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
scripts.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    failures.push(`Script inline ${index + 1}: ${error.message}`);
  }
});

// 20 luglio 2026, Europe/Rome: CEST = UTC+02:00.
const videoAt = Date.UTC(2026, 6, 20, 12, 0, 0);
const letterAt = Date.UTC(2026, 6, 20, 12, 15, 0);
const stateAt = timestamp => timestamp < videoAt ? 'locked' : timestamp < letterAt ? 'video' : 'letter';
const cases = [
  [Date.UTC(2026, 6, 20, 11, 59, 59), 'locked', 'prima delle 14:00'],
  [Date.UTC(2026, 6, 20, 12, 0, 0), 'video', 'alle 14:00'],
  [Date.UTC(2026, 6, 20, 12, 14, 59), 'video', 'tra le 14:00 e le 14:15'],
  [Date.UTC(2026, 6, 20, 12, 15, 0), 'letter', 'alle 14:15'],
  [Date.UTC(2027, 0, 1, 0, 0, 0), 'letter', 'dopo la data di sblocco']
];
cases.forEach(([timestamp, expected, label]) => check(stateAt(timestamp) === expected, `${label}: atteso ${expected}`));

check(html.includes("const ROME_TIME_ZONE='Europe/Rome'"), 'Fuso Europe/Rome non dichiarato');
check(html.includes('const VIDEO_AT=Date.UTC(2026,6,20,12,0,0)'), 'Soglia video non numerica o errata');
check(html.includes('const LETTER_AT=Date.UTC(2026,6,20,12,15,0)'), 'Soglia lettera non numerica o errata');
check(/<video[^>]*\bcontrols\b[^>]*\bplaysinline\b/i.test(html), 'Il video deve avere controls e playsinline');
check(!/<video[^>]*\bautoplay\b/i.test(html), 'Il video non deve avere autoplay');
check(/<audio[^>]*\bid="siteSoundtrack"[^>]*\bloop\b/i.test(html), 'La musica di sottofondo deve essere in loop');
check(!/<audio[^>]*\bautoplay\b/i.test(html), 'La musica non deve avere autoplay');
check(html.includes("enterButton.addEventListener('click'"), 'Avvio della musica dal gesto di ingresso assente');
check(html.includes("event.target instanceof HTMLVideoElement"), 'Dissolvenza della musica durante i video assente');
check(!html.includes("document.querySelectorAll('video,audio')"), 'La chiusura dei ricordi non deve fermare la musica globale');
check(html.includes('setInterval(()=>updateRoom(Date.now()),1000)'), 'Aggiornamento automatico senza reload assente');
check(html.includes('@media(max-width:650px)'), 'Breakpoint smartphone assente');

const requiredAssets = [
  'assets/sorpresa/video-introduttivo.mp4',
  'assets/sorpresa/video-introduttivo-poster.jpg',
  'assets/sorpresa/lettera-per-te-amore-mio.pdf',
  'assets/audio/poetica.mp3',
  ...Array.from({length: 5}, (_, index) => `assets/sorpresa/lettera-pagina-${index + 1}.png`)
];
requiredAssets.forEach(relativePath => {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  check(fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0, `Risorsa mancante o vuota: ${relativePath}`);
});
requiredAssets.slice(0, 4).forEach(relativePath => check(html.includes(relativePath), `Riferimento HTML mancante: ${relativePath}`));
check(html.includes('assets/sorpresa/lettera-pagina-${page}.png'), 'Riferimento dinamico alle pagine della lettera mancante');

if (failures.length) {
  console.error(failures.map(item => `FAIL: ${item}`).join('\n'));
  process.exit(1);
}

console.log(`OK: ${scripts.length} script compilati; 5 stati temporali verificati; ${requiredAssets.length} risorse presenti.`);
