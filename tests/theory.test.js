// Tests for the music-theory block of index.html (the part between BEGIN THEORY and END THEORY).
// Run:  node tests/theory.test.js     (from the project folder)
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const block = html.match(/\/\/ BEGIN THEORY([\s\S]*?)\/\/ END THEORY/)[1];
const T = new Function(block + `; return { LETTERS, SEMI, RANGES, BOTTOM_LINE, noteToMidi, noteName, pitchLabel,
  fullName, midiToFreq, soundingMidi, staffPosition };`)();

let pass = 0, fail = 0;
const n = (letter, octave, acc = '') => ({ letter, octave, acc });
function eq(actual, expected, label) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  same ? pass++ : (fail++, console.log(`FAIL: ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
}
function near(actual, expected, tol, label) {
  Math.abs(actual - expected) <= tol ? pass++ : (fail++, console.log(`FAIL: ${label}: expected about ${expected}, got ${actual}`));
}

// --- Written note -> MIDI number (middle C = 60, A4 = 69) ---
eq(T.noteToMidi(n('c', 4)), 60, 'middle C');
eq(T.noteToMidi(n('a', 4)), 69, 'A4');
eq(T.noteToMidi(n('e', 4)), 64, 'E4');
eq(T.noteToMidi(n('c', 2)), 36, 'C2');
eq(T.noteToMidi(n('e', 2)), 40, 'E2 (low guitar E, sounding)');
eq(T.noteToMidi(n('e', 5)), 76, 'E5 (12th fret high E, sounding)');
for (let o = 1; o <= 7; o++) 'cdefgab'.split('').forEach((l, i) => {
  eq(T.noteToMidi(n(l, o)), 12 * (o + 1) + [0, 2, 4, 5, 7, 9, 11][i], `natural ${l}${o}`);
});

// --- Accidentals ---
eq(T.noteToMidi(n('f', 4, '#')), 66, 'F sharp 4');
eq(T.noteToMidi(n('g', 4, 'b')), 66, 'G flat 4');
eq(T.noteToMidi(n('b', 3, 'b')), 58, 'B flat 3');
eq(T.noteToMidi(n('c', 4, '#')), 61, 'C sharp 4');
eq(T.noteToMidi(n('d', 4, 'b')), 61, 'D flat 4');
eq(T.noteName(n('b', 3, 'b')), 'B♭', 'name of B flat');
eq(T.noteName(n('f', 4, '#')), 'F♯', 'name of F sharp');
eq(T.noteName(n('g', 4)), 'G', 'name of G natural');

// --- Enharmonic equivalents: same sound, different spelling ---
for (const [a, b] of [[n('f', 4, '#'), n('g', 4, 'b')], [n('c', 5, '#'), n('d', 5, 'b')], [n('a', 3, '#'), n('b', 3, 'b')]]) {
  eq(T.noteToMidi(a), T.noteToMidi(b), `${T.noteName(a)} and ${T.noteName(b)} sound the same`);
  eq(T.noteName(a) === T.noteName(b), false, `${T.noteName(a)} and ${T.noteName(b)} are spelled differently`);
}
eq(T.pitchLabel(66), 'F♯/G♭', 'a heard black key is shown with both names');
eq(T.pitchLabel(67), 'G', 'a heard white key has one name');
eq(T.pitchLabel(66 + 12 * 3), 'F♯/G♭', 'label ignores the octave');
eq(T.fullName(60), 'C4', 'full name of middle C');
eq(T.fullName(69), 'A4', 'full name of A4');

// --- Frequencies ---
near(T.midiToFreq(69), 440, 0.001, 'A4 = 440 Hz');
near(T.midiToFreq(60), 261.626, 0.01, 'middle C');
near(T.midiToFreq(40), 82.407, 0.01, 'low E string');
near(T.midiToFreq(55), 195.998, 0.01, 'open G string');
near(T.midiToFreq(76), 659.255, 0.01, '12th fret high E');

// --- Written pitch versus sounding pitch ---
eq(T.soundingMidi(n('g', 4), 'piano'), 67, 'piano: written G4 sounds as G4');
eq(T.soundingMidi(n('g', 4), 'guitar'), 55, 'guitar: written G4 (second line) sounds as G3');
// The exact case from the lesson: the G on the second line of the treble staff is the OPEN G string.
near(T.midiToFreq(T.soundingMidi(n('g', 4), 'guitar')), 196, 0.1, 'second-line G on guitar is the open G string (196 Hz)');
// The same sound an octave up (G on the 3rd fret of the high E string) is a different written note.
eq(T.soundingMidi(n('g', 5), 'guitar'), 67, 'guitar: written G5 sounds as G4');
eq(T.soundingMidi(n('e', 3), 'guitar'), 40, 'guitar: written E3 = open low E string');
eq(T.soundingMidi(n('e', 6), 'guitar'), 76, 'guitar: written E6 = 12th fret of high E string');
eq(T.soundingMidi(n('b', 4), 'guitar'), 59, 'guitar: written B4 (middle line) = open B string');
eq(T.soundingMidi(n('e', 4), 'guitar'), 52, 'guitar: written E4 (bottom line) = 2nd fret of D string');
// The open strings of a guitar, as written and as sounding.
[['e', 3, 40], ['a', 3, 45], ['d', 4, 50], ['g', 4, 55], ['b', 4, 59], ['e', 5, 64]].forEach(([l, o, s]) =>
  eq(T.soundingMidi(n(l, o), 'guitar'), s, `open string, written ${l.toUpperCase()}${o}`));
eq(T.soundingMidi(n('b', 3, 'b'), 'guitar'), 46, 'guitar: accidentals shift the sounding pitch too');

// --- Staff positions (step 0 = bottom line, 8 = top line; ledger lines outside that) ---
const pos = (note, clef) => T.staffPosition(note, clef);
eq(pos(n('e', 4), 'treble'), { step: 0, ledgerLines: 0, side: 'inside' }, 'treble E4 bottom line');
eq(pos(n('g', 4), 'treble'), { step: 2, ledgerLines: 0, side: 'inside' }, 'treble G4 second line');
eq(pos(n('b', 4), 'treble'), { step: 4, ledgerLines: 0, side: 'inside' }, 'treble B4 middle line');
eq(pos(n('f', 5), 'treble'), { step: 8, ledgerLines: 0, side: 'inside' }, 'treble F5 top line');
eq(pos(n('d', 4), 'treble'), { step: -1, ledgerLines: 0, side: 'below' }, 'treble D4 hangs below with no ledger line');
eq(pos(n('c', 4), 'treble'), { step: -2, ledgerLines: 1, side: 'below' }, 'treble middle C: 1 ledger line below');
eq(pos(n('e', 3), 'treble'), { step: -7, ledgerLines: 3, side: 'below' }, 'treble E3: 3 ledger lines below');
eq(pos(n('g', 5), 'treble'), { step: 9, ledgerLines: 0, side: 'above' }, 'treble G5 sits above with no ledger line');
eq(pos(n('a', 5), 'treble'), { step: 10, ledgerLines: 1, side: 'above' }, 'treble A5: 1 ledger line above');
eq(pos(n('e', 6), 'treble'), { step: 14, ledgerLines: 3, side: 'above' }, 'treble E6: 3 ledger lines above');
eq(pos(n('g', 2), 'bass'), { step: 0, ledgerLines: 0, side: 'inside' }, 'bass G2 bottom line');
eq(pos(n('a', 3), 'bass'), { step: 8, ledgerLines: 0, side: 'inside' }, 'bass A3 top line');
eq(pos(n('e', 2), 'bass'), { step: -2, ledgerLines: 1, side: 'below' }, 'bass E2: 1 ledger line below');
eq(pos(n('c', 4), 'bass'), { step: 10, ledgerLines: 1, side: 'above' }, 'bass middle C: 1 ledger line above');

// --- The note ranges the game draws from ---
const numberOf = note => note.octave * 7 + T.LETTERS.indexOf(note.letter);
eq(T.RANGES.treble, { low: numberOf(n('e', 4)), high: numberOf(n('f', 5)) }, 'treble range is E4 to F5');
eq(T.RANGES.bass, { low: numberOf(n('g', 2)), high: numberOf(n('a', 3)) }, 'bass range is G2 to A3');
eq(T.RANGES.guitar, { low: numberOf(n('e', 3)), high: numberOf(n('e', 6)) }, 'guitar range is written E3 to E6');
for (const clef of ['treble', 'bass']) {
  for (let k = T.RANGES[clef].low; k <= T.RANGES[clef].high; k++) {
    const note = n(T.LETTERS[k % 7], Math.floor(k / 7));
    eq(T.staffPosition(note, clef).side, 'inside', `${clef} range note ${T.noteName(note)}${note.octave} stays on the staff`);
  }
}
let guitarMin = 999, guitarMax = -999;
for (let k = T.RANGES.guitar.low; k <= T.RANGES.guitar.high; k++) {
  const s = T.soundingMidi(n(T.LETTERS[k % 7], Math.floor(k / 7)), 'guitar');
  guitarMin = Math.min(guitarMin, s); guitarMax = Math.max(guitarMax, s);
}
eq([guitarMin, guitarMax], [40, 76], 'guitar range sounds from low E (40) to 12th fret high E (76)');

console.log(`Theory tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
