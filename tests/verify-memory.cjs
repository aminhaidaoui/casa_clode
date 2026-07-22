const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const expected = {
  ansia: 9,
  coccole: 10,
  cosi: 10,
  felice: 10,
  incazzata: 10,
  'mi-sento-sola': 10,
  motivazione: 8,
  nostalgia: 10,
  'sto-bene': 10,
  triste: 10,
};

let failures = 0;
function check(condition, message) {
  if (condition) console.log(`OK  ${message}`);
  else {
    failures += 1;
    console.error(`ERR ${message}`);
  }
}

check(html.includes("const STORAGE_KEY='casaNostraMemoryV42'"), 'memoria locale presente');
check(html.includes('Benvenuta a Casa Nostra, Mon bébé.'), 'messaggio del primo accesso presente');
check(html.includes("if(days===1)return 'Bentornata.'"), 'ritorno del giorno dopo gestito');
check(html.includes("if(days>=3)return 'Mi sei mancata.'"), 'ritorno dopo più giorni gestito');
check(html.includes('memory.totalAudioListens='), 'conteggio totale degli ascolti presente');
check(html.includes('memory.favoriteCategory='), 'categoria preferita calcolata');
check(html.includes('memory.lastAudio='), 'ultimo audio memorizzato');
check(html.includes("sessionStorage.setItem(SESSION_KEY,'open')"), 'apertura contata una volta per sessione');
check(html.includes('if(counted.has(audio))return'), 'pausa e ripresa non duplicano l’ascolto');

let total = 0;
for (const [category, count] of Object.entries(expected)) {
  for (let index = 1; index <= count; index += 1) {
    total += 1;
    const file = path.join(root, 'assets', 'voci', category, `audio-${String(index).padStart(2, '0')}.mp4`);
    check(fs.existsSync(file), `${category} ${index} disponibile`);
  }
}
check(total === 97, 'tutti i 97 audio sono inclusi');

process.exitCode = failures ? 1 : 0;
