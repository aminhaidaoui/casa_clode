const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let failures = 0;
function check(condition, message) {
  if (condition) console.log(`OK  ${message}`);
  else { failures += 1; console.error(`ERR ${message}`); }
}

for (let number = 15; number <= 22; number += 1) {
  const name = `${String(number).padStart(3, '0')}_image.jpg`;
  const file = path.join(root, 'assets', 'luglio', name);
  check(fs.existsSync(file) && fs.statSync(file).size > 100000, `${name} presente`);
  const references = html.split(`assets/luglio/${name}`).length - 1;
  check(references === 2, `${name} collegata a galleria e foto del giorno`);
}

check(html.includes('REAL_MEDIA.luglio.splice(10,0'), 'nuove foto in ordine cronologico');
check(html.includes('window.CASA_NOSTRA_FULL_MEDIA.luglio.splice(10,0'), 'nuove foto disponibili nella selezione quotidiana');

process.exitCode = failures ? 1 : 0;
