const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'daily-messages.json'), 'utf8'));
let failures = 0;
function check(condition, message) {
  if (condition) console.log(`OK  ${message}`);
  else { failures += 1; console.error(`ERR ${message}`); }
}

function partsAt(timestamp) {
  return Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}
function zonedTimestamp(date, time) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const p = partsAt(guess);
    const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    guess += target - shown;
  }
  return guess;
}

check(config.timezone === 'Europe/Rome', 'fuso orario di Roma');
check(config.morningTime === '07:00', 'buongiorno alle 07:00');
check(config.nightTime === '23:30', 'buonanotte alle 23:30');
check(config.messages.some(message => message.date === '2026-07-25' && message.kind === 'night'), 'buonanotte del 25 luglio programmata');
check(config.messages.some(message => message.date === '2026-08-15' && message.kind === 'morning'), 'buongiorno di Ferragosto programmato');
check(new Date(zonedTimestamp('2026-07-23', '23:30')).toISOString() === '2026-07-23T21:30:00.000Z', 'ora estiva calcolata correttamente');
check(new Date(zonedTimestamp('2026-12-23', '23:30')).toISOString() === '2026-12-23T22:30:00.000Z', 'ora invernale calcolata correttamente');
check(html.includes("fetch('./daily-messages.json',{cache:'no-store'})"), 'calendario aggiornato senza vecchia cache');
check(html.includes("if(!isOpen){element.className='daily-moment is-locked'"), 'video futuro bloccato prima dell orario');
check(html.includes('setupLetterCarousel()'), 'lettera orizzontale attivata');
check(html.includes('scroll-snap-type:x mandatory'), 'scorrimento lettera ottimizzato per telefono');

for (const message of config.messages) {
  check(fs.existsSync(path.join(root, message.video)), `${message.id} video presente`);
  check(fs.statSync(path.join(root, message.video)).size < 100 * 1024 * 1024, `${message.id} sotto il limite GitHub`);
  check(fs.existsSync(path.join(root, message.poster)), `${message.id} copertina presente`);
}

process.exitCode = failures ? 1 : 0;
