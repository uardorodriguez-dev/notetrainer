// Tests for js/music-engine.js.   Run: node tests/engine.test.js
const path = require('path'), fs = require('fs');
const E = require('../js/music-engine.js');
let pass = 0, fail = 0;
const ok = (c, label) => { c ? pass++ : (fail++, console.log('FAIL:', label)); };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// 1. Same answers as the trainer's theory block (index.html), for every note from octave 1 to 7 with every accidental.
const trainer = path.join(__dirname, '..', 'index.html');
if (fs.existsSync(trainer)) {
  const block = fs.readFileSync(trainer, 'utf8').match(/\/\/ BEGIN THEORY([\s\S]*?)\/\/ END THEORY/)[1];
  const T = new Function(block + '; return { noteToMidi, noteName, pitchLabel, fullName, soundingMidi, staffPosition, midiToFreq };')();
  let compared = 0;
  for (let o = 1; o <= 7; o++) for (const l of E.LETTERS) for (const acc of ['', '#', 'b']) {
    const n = { letter: l, octave: o, acc };
    eq(E.noteToMidi(n), T.noteToMidi(n), `midi ${l}${acc}${o}`);
    eq(E.noteName(n), T.noteName(n), `name ${l}${acc}${o}`);
    for (const inst of ['piano', 'guitar']) eq(E.soundingMidi(n, inst), T.soundingMidi(n, inst), `sounding ${inst} ${l}${acc}${o}`);
    for (const clef of ['treble', 'bass']) eq(E.staffPosition(n, clef), T.staffPosition(n, clef), `staff ${clef} ${l}${o}`);
    compared++;
  }
  for (let m = 0; m < 128; m++) { eq(E.pitchLabel(m), T.pitchLabel(m), `label ${m}`); eq(E.fullName(m), T.fullName(m), `full ${m}`); }
  console.log(`  matches the trainer's theory code on ${compared} written notes and 128 pitches`);
} else console.log('  (trainer index.html not found next to this folder: equivalence check skipped)');

// 2. Parsing and conversions
eq(E.parse('g4'), { letter: 'g', acc: '', octave: 4 }, 'parse g4');
eq(E.parse('F#5'), { letter: 'f', acc: '#', octave: 5 }, 'parse F#5');
eq(E.parse('bb3'), { letter: 'b', acc: 'b', octave: 3 }, 'parse bb3');
eq(E.noteToMidi(E.parse('a4')), 69, 'A4 = 69');
eq(E.fromNumber(E.noteNumber(E.parse('c6'))), { letter: 'c', octave: 6, acc: '' }, 'number round trip');

// 3. Random notes stay inside every named range, never use odd spellings, and respect "avoid"
const rng = E.makeRng(7);
for (const [name, r] of Object.entries(E.RANGES)) {
  const lo = E.noteToMidi(E.parse(r.low)), hi = E.noteToMidi(E.parse(r.high));
  let acc = 0, minM = 999, maxM = -999;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const n = E.randomNote(name, { accidentals: true }, rng);
    const m = E.noteToMidi(n); minM = Math.min(minM, m); maxM = Math.max(maxM, m);
    if (n.acc) acc++;
    ok(m >= lo && m <= hi, `${name}: ${E.noteName(n)}${n.octave} outside the range`);
    ok(!['e#', 'b#', 'cb', 'fb'].includes(n.letter + n.acc), `${name}: odd spelling ${n.letter}${n.acc}`);
  }
  ok(minM === lo && maxM === hi, `${name}: reaches both ends (${minM}..${maxM} vs ${lo}..${hi})`);
  ok(acc / N > 0.3 && acc / N < 0.55, `${name}: share of sharps/flats ${acc / N}`);
  for (let i = 0; i < 500; i++) ok(!E.randomNote(name, {}, rng).acc, `${name}: naturals only when accidentals are off`);
}
const avoid = [E.parse('e4'), E.parse('f4'), E.parse('g4')];
for (let i = 0; i < 2000; i++) ok(!avoid.some(a => E.sameWritten(a, E.randomNote('treble-staff', { avoid }, rng))), 'avoid list respected');

// 4. Answer choices
const ALPHA = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const distCount = [0, 0, 0, 0];
for (let i = 0; i < 5000; i++) {
  const n = E.randomNote('treble-wide', {}, rng);
  const ch = E.answerChoices(n, 4, rng);
  ok(ch.length === 4, 'four choices');
  ok(new Set(ch.map(c => c.letter + c.acc)).size === 4, 'choices are all different');
  ok(ch.filter(c => E.isCorrectChoice(n, c)).length === 1, 'exactly one correct choice');
  const order = ch.map(c => ALPHA.indexOf(c.letter));
  ok(order.every((v, k) => k === 0 || v > order[k - 1]), 'choices in A-G order');
  ch.forEach(c => { if (c.letter !== n.letter) { const d = Math.abs(E.LETTERS.indexOf(c.letter) - E.LETTERS.indexOf(n.letter)); distCount[Math.min(d, 7 - d)]++; } });
}
ok(distCount[1] > distCount[3], `wrong choices lean toward neighbouring letters (1 away: ${distCount[1]}, 3 away: ${distCount[3]})`);
console.log(`  wrong choices by distance: 1 step ${distCount[1]}, 2 steps ${distCount[2]}, 3 steps ${distCount[3]}`);
for (let i = 0; i < 3000; i++) {
  const n = E.randomNote('treble-staff', { accidentals: true, accidentalChance: 1 }, rng);
  const ch = E.answerChoices(n, 4, rng);
  ok(ch.filter(c => E.isCorrectChoice(n, c)).length === 1, 'accidentals: exactly one correct');
  ok(!ch.some(c => ['e#', 'b#', 'cb', 'fb'].includes(c.letter + c.acc)), 'accidentals: no odd spellings among choices');
}

// 5. Answer checking
const g4 = E.parse('g4');
ok(E.isCorrectChoice(g4, { letter: 'g', acc: '' }), 'G is right for G4');
ok(!E.isCorrectChoice(g4, { letter: 'g', acc: '#' }), 'G sharp is wrong for G4');
ok(!E.isCorrectChoice(E.parse('f#4'), { letter: 'g', acc: 'b' }), 'tapping G flat for a written F sharp is wrong (spelling counts)');
eq(E.checkSounding(g4, 55, { instrument: 'guitar', exactOctave: true }).correct, true, 'guitar: open G string for written G4');
eq(E.checkSounding(g4, 67, { instrument: 'guitar', exactOctave: true }).rightNoteWrongOctave, true, 'guitar: G4 sound is the wrong octave');
eq(E.checkSounding(g4, 67, { instrument: 'guitar' }).correct, true, 'guitar: any octave accepted by default');
eq(E.checkSounding(E.parse('f#4'), 66, {}).correct, true, 'heard F sharp/G flat counts for written F sharp');
eq(E.checkSounding(g4, 60, {}).correct, false, 'C is wrong for G');

// 6. Seeded random numbers repeat exactly
const a = E.makeRng(99), b = E.makeRng(99);
ok([1, 2, 3, 4, 5].every(() => a() === b()), 'same seed, same numbers');

console.log(`Engine tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
