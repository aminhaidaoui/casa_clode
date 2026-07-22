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
check(html.includes('dailyVoiceButton'), 'voce del giorno presente');
check(html.includes('data-favorite-toggle'), 'preferiti audio presenti');
check(html.includes('surpriseVoiceButton'), 'scelta sorpresa presente');
check(html.includes('casa-nostra:night-mode'), 'modalita notte collegata alla musica');
check(html.includes('background:radial-gradient(circle at 50% 0,#342035,#100d14 58%)!important'), 'sfondo notte prevalente sui vecchi stili');
check(html.includes('body.cn-night .v21-moods h2'), 'titoli leggibili in modalita notte');
check(html.includes('body.cn-night .locked-room'), 'stanza finale leggibile in modalita notte');
check(html.includes("return 'È tardi, resta qui un momento.'"), 'messaggio serale automatico presente');
check(html.includes("showToast('Questa voce resta con te. ♡')"), 'conferma poetica dei preferiti presente');
check(html.includes("playerShell?.classList.add('is-playing')"), 'audio attivo evidenziato');
check(html.includes("window.scrollY>700"), 'pulsante torna all inizio presente');
check(html.includes('const introSequence=returningHome?'), 'ingresso rapido per chi ritorna');
check(html.includes("serviceWorker.register('./sw.js')"), 'installazione app abilitata');
check(html.includes("sessionStorage.setItem(SESSION_KEY,'open')"), 'apertura contata una volta per sessione');
check(html.includes('if(counted.has(audio))return'), 'pausa e ripresa non duplicano l’ascolto');
check(html.includes('DUCKED_VOLUME=.008'), 'musica ridotta a un sussurro durante gli audio');
check(html.includes('createMediaElementSource(soundtrack)'), 'mixer audio mobile collegato alla musica');
check(html.includes('mixForeground(event.target)'), 'voci e video collegati allo stesso mixer mobile');

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
