// Runs the real page script inside a simulated browser and checks the sharps/flats logic.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const code = scripts[scripts.length - 1];

// ---- Fake browser pieces ----
const els = {};
const defaults = { instrument: 'piano', accidentals: 'off', clef: 'treble', mode: 'buttons', octaveMode: 'any' };
function getEl(id) {
  if (!els[id]) {
    els[id] = {
      value: defaults[id] || '', style: {}, textContent: '', className: '', disabled: false,
      innerHTML: '', children: [], handlers: {}, classList: { toggle() {} }, querySelector() { return null; }, checked: false,
      addEventListener(t, f) { const prev = this.handlers[t]; this.handlers[t] = prev ? (...a) => { prev(...a); f(...a); } : f; },
      appendChild(c) { this.children.push(c); }
    };
  }
  return els[id];
}
let uid = 0;
const document = { getElementById: getEl, createElement: () => getEl('_new' + uid++), addEventListener() {} };

const drawn = [];   // every note the page asked VexFlow to draw
class Accidental { constructor(t) { this.type = t; } }
class StaveNote {
  constructor(o) { this.o = o; this.mods = []; drawn.push(this); }
  addModifier(m) { this.mods.push(m); return this; }
}
class Renderer { static Backends = { SVG: 1 }; resize() {} getContext() { return { scale() {} }; } }
class Stave { addClef() { return this; } setContext() { return this; } draw() {} }
class Voice { addTickables() {} draw() {} }
class Formatter { joinVoices() { return this; } format() {} }
const Vex = { Flow: { Renderer, Stave, StaveNote, Voice, Formatter, Accidental } };

const factory = new Function('document', 'navigator', 'performance', 'window', 'Vex', 'setTimeout', 'setInterval', 'clearInterval',
  code + `
  ;return { nextQuestion, answer, setAcc, noteToMidi, noteName, expectedMidi, micAnswer,
            getCurrent: () => currentNote, setCurrent: n => { currentNote = n; },
            stats: () => ({ score, total, streak }) };`);
const page = factory(document, {}, { now: () => 0 }, {}, Vex, () => 0, () => 0, () => {});

let pass = 0, fail = 0;
function ok(cond, label) { cond ? pass++ : (fail++, console.log('FAIL:', label)); }

// ---- 1. Piano treble: spelling rules and drawing ----
els.accidentals.value = 'on';
let withAcc = 0, N = 20000;
const seenGuitar = new Set();
for (let i = 0; i < N; i++) {
  page.nextQuestion();
  const n = page.getCurrent(), d = drawn[drawn.length - 1];
  const spelled = n.letter + n.acc;
  if (n.acc) withAcc++;
  ok(!['e#', 'b#', 'cb', 'fb'].includes(spelled), `odd spelling ${spelled}`);
  ok(d.o.keys[0] === `${n.letter}${n.acc}/${n.octave}`, `key format ${d.o.keys[0]}`);
  ok(d.mods.length === (n.acc ? 1 : 0) && (!n.acc || d.mods[0].type === n.acc), `accidental symbol for ${spelled}`);
}
const share = withAcc / N;
ok(share > 0.35 && share < 0.55, `share of accidental notes looks odd: ${share.toFixed(2)}`);
console.log(`Piano treble: ${N} notes checked, ${(share * 100).toFixed(0)}% had sharps/flats`);

// ---- 2. Guitar: everything must sound between low E (40) and 12th fret high E (76) ----
els.instrument.value = 'guitar';
els.instrument.handlers.change();
ok(els.clef.value === 'treble' && els.clef.disabled === true, 'guitar locks clef to treble');
let lo = 999, hi = -999, sharps = 0, flats = 0;
for (let i = 0; i < N; i++) {
  page.nextQuestion();
  const n = page.getCurrent();
  const sounding = page.noteToMidi(n) - 12;
  lo = Math.min(lo, sounding); hi = Math.max(hi, sounding);
  if (n.acc === '#') sharps++; if (n.acc === 'b') flats++;
  ok(sounding >= 40 && sounding <= 76, `guitar note out of range: ${page.noteName(n)}${n.octave} sounds ${sounding}`);
}
ok(lo === 40 && hi === 76, `guitar extremes were ${lo}..${hi}`);
console.log(`Guitar: sounding range reached ${lo} to ${hi} (expected 40 to 76), ${sharps} sharps, ${flats} flats`);

// ---- 3. Bass clef spelling ----
els.instrument.value = 'piano';
els.instrument.handlers.change();
els.clef.value = 'bass';
for (let i = 0; i < 5000; i++) {
  page.nextQuestion();
  const n = page.getCurrent();
  ok(!['e#', 'b#', 'cb', 'fb'].includes(n.letter + n.acc), 'bass odd spelling');
}
els.clef.value = 'treble';

// ---- 4. Button-mode answer checking ----
page.nextQuestion(); page.setCurrent({ letter: 'f', octave: 4, acc: '#', number: 31 });
page.setAcc('#'); page.answer('f');
ok(page.stats().score === 1, 'F sharp answered correctly should score');

page.nextQuestion(); page.setCurrent({ letter: 'b', octave: 3, acc: 'b', number: 27 });
page.setAcc(''); page.answer('b');
ok(page.stats().score === 1 && page.stats().streak === 0, 'B natural for B flat should be wrong');
ok(els.feedback.textContent.includes('B♭'), `feedback should name B♭: "${els.feedback.textContent}"`);

page.nextQuestion(); page.setCurrent({ letter: 'c', octave: 4, acc: '', number: 28 });
page.setAcc(''); page.answer('c');
ok(page.stats().score === 2, 'plain C answered correctly should score');

// ---- 5. Microphone checking (piano) ----
els.mode.value = 'mic';
page.nextQuestion(); page.setCurrent({ letter: 'd', octave: 4, acc: 'b', number: 29 });   // D flat 4 = MIDI 61
ok(page.expectedMidi() === 61, `D flat 4 should expect MIDI 61, got ${page.expectedMidi()}`);
page.micAnswer(73);   // C sharp 5: same pitch as D flat, other octave, "any octave"
ok(els.feedback.textContent.startsWith('Correct') && els.feedback.textContent.includes('D♭'), `enharmonic should pass: "${els.feedback.textContent}"`);

page.nextQuestion(); page.setCurrent({ letter: 'd', octave: 4, acc: 'b', number: 29 });
page.micAnswer(60);   // C natural: a semitone off
ok(els.feedback.textContent.includes('I heard C'), `C for D flat should be wrong: "${els.feedback.textContent}"`);

els.octaveMode.value = 'exact';
page.nextQuestion(); page.setCurrent({ letter: 'd', octave: 4, acc: 'b', number: 29 });
page.micAnswer(73);
ok(els.feedback.textContent.includes('wrong octave'), `exact octave should flag octave: "${els.feedback.textContent}"`);
els.octaveMode.value = 'any';

// ---- 6. Microphone checking (guitar) ----
els.instrument.value = 'guitar';
page.nextQuestion(); page.setCurrent({ letter: 'e', octave: 3, acc: '', number: 23 });
ok(page.expectedMidi() === 40, `written E3 on guitar should expect MIDI 40, got ${page.expectedMidi()}`);
page.micAnswer(40);
ok(els.feedback.textContent.startsWith('Correct'), 'low E open string should be accepted');

page.nextQuestion(); page.setCurrent({ letter: 'f', octave: 5, acc: '#', number: 38 });   // written F sharp 5
ok(page.expectedMidi() === 66 + 12 - 12 + 0 || page.expectedMidi() === 78 - 12, `guitar F sharp 5 expectation ${page.expectedMidi()}`);

console.log(`Checks: ${pass} passed, ${fail} failed`);
