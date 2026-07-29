const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');

assert(html.includes('id="contentArchiveToggle"'), 'Diary toggle is missing');
assert(html.includes('casaNostraOpenedContentV1'), 'Persistent opened-content memory is missing');
assert(html.includes('localStorage.setItem(OPENED_KEY'), 'Opened state is not saved');
assert(html.includes('content-seen-badge'), 'Persistent green check badge is missing');
assert(html.includes('data-archive-entry'), 'Combined dated archive entries are missing');
assert(html.includes("type:'daily'"), 'Daily messages are not included in the diary');
assert(html.includes("type:'surprise'"), 'Surprises are not included in the diary');
assert(html.includes("markOpened(content.dataset.contentId)"), 'Current content is not marked as opened');
assert(html.includes('id="surprisePopup"'), 'Surprise popup is missing');
assert(html.includes('data-open-surprise'), 'Surprise cards do not open the popup');
assert(html.includes('function openSurprisePopup'), 'Surprise popup controller is missing');
assert(html.includes("if(entry.type==='surprise'){openSurprisePopup"), 'Diary surprises do not use the popup');

for (const source of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  new Function(source[1]);
}

console.log('Content diary verified.');
