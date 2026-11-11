// Checks that index.html still parses and that the guitar range maps to the right sounding notes.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

// 1. The inline script must still be valid JavaScript.
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
try { new Function(scripts[scripts.length - 1]); console.log('Script syntax: OK'); }
catch (e) { console.log('Script syntax ERROR:', e.message); process.exit(1); }

// 2. Only one instrument menu, and it is in the main options.
console.log('Instrument menus in page:', (html.match(/id="instrument"/g) || []).length);

// 3. Pull the guitar range out of the code and walk it.
const m = html.match(/guitar:\s*\{\s*low:\s*(\d+)\s*\*\s*7\s*\+\s*(\d+),\s*high:\s*(\d+)\s*\*\s*7\s*\+\s*(\d+)/);
const low = +m[1] * 7 + +m[2], high = +m[3] * 7 + +m[4];

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const freq = midi => 440 * Math.pow(2, (midi - 69) / 12);

const notes = [];
for (let n = low; n <= high; n++) {
  const letter = LETTERS[n % 7], octave = Math.floor(n / 7);
  const written = 12 * (octave + 1) + SEMI[letter];
  const sounding = written - 12;                       // guitar sounds an octave lower
  notes.push({ label: letter.toUpperCase() + octave, written, sounding, hz: freq(sounding) });
}

console.log(`Notes in guitar range: ${notes.length}`);
console.log('Written: ' + notes.map(n => n.label).join(' '));
const first = notes[0], last = notes[notes.length - 1];
console.log(`Lowest:  written ${first.label} -> sounds MIDI ${first.sounding} (${NAMES[first.sounding % 12]}${Math.floor(first.sounding / 12) - 1}, ${first.hz.toFixed(1)} Hz)`);
console.log(`Highest: written ${last.label} -> sounds MIDI ${last.sounding} (${NAMES[last.sounding % 12]}${Math.floor(last.sounding / 12) - 1}, ${last.hz.toFixed(1)} Hz)`);
console.log(`Low E open string expected MIDI 40, 12th fret high E expected MIDI 76: ${first.sounding === 40 && last.sounding === 76 ? 'MATCH' : 'MISMATCH'}`);
console.log(`Detector limits are 70 to 1200 Hz; guitar range ${first.hz.toFixed(1)} to ${last.hz.toFixed(1)} Hz: ${first.hz > 70 && last.hz < 1200 ? 'inside limits' : 'OUTSIDE limits'}`);
