// Runs the real page script (with the microphone replaced by synthetic audio) to test the sound filters:
// plucked/struck notes should be accepted; singing, speech, humming and noise should be rejected in strict mode.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const code = scripts[scripts.length - 1];

// ---- Fake browser pieces ----
const els = {};
const defaults = { instrument: 'piano', accidentals: 'off', clef: 'treble', mode: 'mic', octaveMode: 'any', listenMode: 'strict' };
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
class Accidental { constructor(t) { this.type = t; } }
class StaveNote { constructor(o) { this.o = o; } addModifier() { return this; } }
class Renderer { static Backends = { SVG: 1 }; resize() {} getContext() { return { scale() {} }; } }
class Stave { addClef() { return this; } setContext() { return this; } draw() {} }
class Voice { addTickables() {} draw() {} }
class Formatter { joinVoices() { return this; } format() {} }
const Vex = { Flow: { Renderer, Stave, StaveNote, Voice, Formatter, Accidental } };

let T = 0;   // the fake clock, in milliseconds
const factory = new Function('document', 'navigator', 'performance', 'window', 'Vex', 'setTimeout', 'setInterval', 'clearInterval',
  code + `
  ;return { MIC, micTick, beginCalibration, detectOnsets, nextQuestion,
            setCurrent: n => { currentNote = n; }, stats: () => ({ score, total, streak }) };`);
const page = factory(document, {}, { now: () => T }, {}, Vex, () => 0, () => 0, () => {});

// ---- Random numbers (seeded so results repeat) ----
let seed = 12345;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

// ---- Synthetic sounds ----
// A plucked or struck note: very fast attack, then a slow fade.
function pluck(freq, sr, secs, o = {}) {
  const { harm = [1, 0.6, 0.35, 0.2, 0.1], amp = 0.3, tau = 0.8, attack = 0.003 } = o;
  const norm = harm.reduce((a, b) => a + b, 0);
  const n = Math.round(secs * sr), s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    harm.forEach((h, k) => { v += h * Math.sin(2 * Math.PI * freq * (k + 1) * t); });
    s[i] = (amp / norm) * v * Math.min(1, t / attack) * Math.exp(-t / tau);
  }
  return s;
}
// A sung note: gradual attack, steady loudness, vibrato and a little tremolo.
function sung(freq, sr, secs, o = {}) {
  const { attack = 0.15, vibCents = 30, vibHz = 5.5, amp = 0.25, release = 0.2, harm = [1, 0.5, 0.3, 0.2, 0.1] } = o;
  const norm = harm.reduce((a, b) => a + b, 0);
  const n = Math.round(secs * sr), s = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    phase += 2 * Math.PI * freq * Math.pow(2, vibCents * Math.sin(2 * Math.PI * vibHz * t) / 1200) / sr;
    let v = 0;
    harm.forEach((h, k) => { v += h * Math.sin((k + 1) * phase); });
    const rise = t < attack ? 0.5 * (1 - Math.cos(Math.PI * t / attack)) : 1;
    const fall = t > secs - release ? Math.max(0, (secs - t) / release) : 1;
    s[i] = (amp / norm) * v * rise * fall * (1 + 0.08 * Math.sin(2 * Math.PI * 5 * t));
  }
  return s;
}
// Speech-like: short syllables whose pitch glides, each fading in over about 50 ms.
function speech(sr, syllables = 5) {
  const synLen = 0.18, gap = 0.07;
  const n = Math.round(syllables * (synLen + gap) * sr), s = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, k = Math.floor(t / (synLen + gap)), local = t - k * (synLen + gap);
    if (local > synLen) { continue; }
    const f = (110 + 8 * k) * (1 + 0.25 * local / synLen);
    phase += 2 * Math.PI * f / sr;
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(h * phase) / h;
    const rise = local < 0.05 ? 0.5 * (1 - Math.cos(Math.PI * local / 0.05)) : 1;
    const fall = local > synLen - 0.06 ? (synLen - local) / 0.06 : 1;
    s[i] = 0.12 * v * rise * fall;
  }
  return s;
}
// A clap or knock: a short burst of noise.
function clap(sr) {
  const n = Math.round(0.3 * sr), s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = 0.5 * gauss() * Math.exp(-(i / sr) / 0.02);
  return s;
}
// Room noise plus any sounds placed at given times (seconds).
function mix(sr, secs, parts, sigma = 0.002) {
  const out = new Float32Array(Math.round(secs * sr));
  for (let i = 0; i < out.length; i++) out[i] = sigma * gauss();
  parts.forEach(({ at, sig }) => {
    const o = Math.round(at * sr);
    for (let j = 0; j < sig.length && o + j < out.length; j++) out[o + j] += sig[j];
  });
  return out;
}

let pass = 0, fail = 0;
function ok(cond, label) { cond ? pass++ : (fail++, console.log('FAIL:', label)); }

// ---- Part 1: attack detection on its own ----
function countOnsets(signal, sr, gate) {
  const win = 8192, buf = new Float32Array(win);
  let count = 0, last = -1e9;
  for (let end = win; end <= signal.length; end += Math.round(sr * 0.05)) {
    for (let i = 0; i < win; i++) buf[i] = signal[end - win + i];
    page.detectOnsets(buf, sr, gate * 1.5).forEach(idx => {
      const t = (end - (win - idx)) / sr * 1000;
      if (t - last > 100) { count++; last = t; }
    });
  }
  return count;
}

console.log('--- Attack detection (how many "attacks" are found; room gate 0.008) ---');
for (const sr of [44100, 48000]) {
  const fade = (sig, secs) => { for (let i = 0; i < Math.min(sig.length, secs * sr); i++) sig[i] *= i / (secs * sr); return sig; };
  const cases = [
    // [label, signal parts, expected count or null for "just report"]
    ['piano pluck C4',            [{ at: 0.3, sig: pluck(261.63, sr, 2) }], 1],
    ['guitar low E (weak fund.)', [{ at: 0.3, sig: pluck(82.41, sr, 2, { harm: [0.3, 1, 0.8, 0.5] }) }], 1],
    ['soft pluck',                [{ at: 0.3, sig: pluck(440, sr, 2, { amp: 0.03 }) }], 1],
    ['two plucks',                [{ at: 0.3, sig: pluck(220, sr, 1.5) }, { at: 1.8, sig: pluck(330, sr, 1.5) }], 2],
    ['re-strike over ringing',    [{ at: 0.3, sig: pluck(220, sr, 2.5) }, { at: 1.0, sig: pluck(330, sr, 1.5) }], 2],
    ['sung, 150 ms attack',       [{ at: 0.3, sig: sung(220, sr, 1.5, { attack: 0.15 }) }], 0],
    ['sung, 80 ms attack',        [{ at: 0.3, sig: sung(220, sr, 1.5, { attack: 0.08 }) }], 0],
    ['sung, 40 ms attack',        [{ at: 0.3, sig: sung(220, sr, 1.5, { attack: 0.04 }) }], 0],
    ['sung, 20 ms attack',        [{ at: 0.3, sig: sung(220, sr, 1.5, { attack: 0.02 }) }], null],
    ['speech-like syllables',     [{ at: 0.3, sig: speech(sr) }], 0],
    ['steady hum, slow fade-in',  [{ at: 0.3, sig: fade(sung(180, sr, 2, { attack: 0.01, vibCents: 0 }), 0.4) }], 0],
    ['room noise only',           [], 0]
  ];
  for (const [label, parts, expected] of cases) {
    const sig = mix(sr, 3.5, parts);
    const n = countOnsets(sig, sr, 0.008);
    if (expected === null) console.log(`  ${sr} Hz  ${label}: ${n} (informational)`);
    else ok(n === expected, `${sr} Hz attack count for "${label}": expected ${expected}, got ${n}`);
  }
}

// ---- Part 2: the whole listening pipeline, end to end ----
function run(label, { sr, strict, instrument, note, parts, secs, sigma = 0.002, expect }) {
  getEl('listenMode').value = strict ? 'strict' : 'any';
  getEl('instrument').value = instrument;
  getEl('octaveMode').value = 'any';

  const lead = 1.2;                                              // quiet room first, for calibration
  const signal = mix(sr, lead + secs, parts.map(p => ({ at: p.at + lead, sig: p.sig })), sigma);
  page.nextQuestion();
  page.setCurrent(note);
  const before = page.stats().total;

  const MIC = page.MIC, T0 = 5000;
  MIC.ctx = { sampleRate: sr };
  MIC.buf = new Float32Array(8192);
  MIC.analyser = {
    getFloatTimeDomainData(arr) {
      const e = Math.round((T - T0) / 1000 * sr);
      for (let i = 0; i < arr.length; i++) { const idx = e - arr.length + i; arr[i] = idx >= 0 && idx < signal.length ? signal[idx] : 0; }
    }
  };
  Object.assign(MIC, { candidate: null, pitches: [], quietMs: 0, lastAnswered: null, pausedUntil: 0, lastOnset: 0, lastAnswerTime: 0, gate: 0.01 });
  T = T0;
  page.beginCalibration();
  let answeredAt = null;
  for (let t = 0; t <= (lead + secs) * 1000; t += 50) {
    T = T0 + t; page.micTick();
    if (answeredAt === null && page.stats().total > before) answeredAt = t;
  }
  const latency = answeredAt === null || !parts.length ? null : answeredAt - (lead + parts[0].at) * 1000;

  const answers = page.stats().total - before;
  const text = getEl('feedback').textContent;
  let good;
  if (expect === 'correct') good = answers === 1 && text.startsWith('Correct');
  else if (expect === 'answered') good = answers === 1;
  else good = answers === 0;
  ok(good, `${label}: expected ${expect}, got ${answers} answer(s), feedback "${text}", gate ${MIC.gate.toFixed(4)}`);
  return { answers, text, latency, good };
}

console.log('--- Whole pipeline (calibrate, then play) ---');
for (const sr of [44100, 48000]) {
  const piano = (letter, octave, number) => ({ letter, octave, acc: '', number });
  // Struck and plucked notes should be accepted.
  run(`${sr} piano C4`,  { sr, strict: true, instrument: 'piano',  note: piano('c', 4, 28), parts: [{ at: 0.3, sig: pluck(261.63, sr, 2) }], secs: 2.5, expect: 'correct' });
  run(`${sr} piano A4`,  { sr, strict: true, instrument: 'piano',  note: piano('a', 4, 33), parts: [{ at: 0.3, sig: pluck(440, sr, 2) }], secs: 2.5, expect: 'correct' });
  run(`${sr} piano E5`,  { sr, strict: true, instrument: 'piano',  note: piano('e', 5, 37), parts: [{ at: 0.3, sig: pluck(659.26, sr, 2) }], secs: 2.5, expect: 'correct' });
  run(`${sr} soft piano A4`, { sr, strict: true, instrument: 'piano', note: piano('a', 4, 33), parts: [{ at: 0.3, sig: pluck(440, sr, 2, { amp: 0.03 }) }], secs: 2.5, expect: 'correct' });
  run(`${sr} guitar low E`, { sr, strict: true, instrument: 'guitar', note: piano('e', 3, 23), parts: [{ at: 0.3, sig: pluck(82.41, sr, 2, { harm: [0.3, 1, 0.8, 0.5] }) }], secs: 2.5, expect: 'correct' });
  run(`${sr} guitar A2`,    { sr, strict: true, instrument: 'guitar', note: piano('a', 3, 26), parts: [{ at: 0.3, sig: pluck(110, sr, 2, { harm: [0.5, 1, 0.7, 0.4] }) }], secs: 2.5, expect: 'correct' });
  run(`${sr} guitar 12th fret high E`, { sr, strict: true, instrument: 'guitar', note: piano('e', 6, 44), parts: [{ at: 0.3, sig: pluck(659.26, sr, 2) }], secs: 2.5, expect: 'correct' });

  // Wrong note played right: still counts as an answer (the game says "try again").
  run(`${sr} piano wrong note`, { sr, strict: true, instrument: 'piano', note: piano('c', 4, 28), parts: [{ at: 0.3, sig: pluck(440, sr, 2) }], secs: 2.5, expect: 'answered' });

  // Things that are NOT a struck or plucked note should be ignored in strict mode.
  const a3 = piano('a', 3, 26);
  run(`${sr} strict: singing with vibrato`, { sr, strict: true, instrument: 'piano', note: a3, parts: [{ at: 0.3, sig: sung(220, sr, 1.6) }], secs: 2.5, expect: 'none' });
  run(`${sr} strict: singing, straight tone`, { sr, strict: true, instrument: 'piano', note: a3, parts: [{ at: 0.3, sig: sung(220, sr, 1.6, { vibCents: 0 }) }], secs: 2.5, expect: 'none' });
  run(`${sr} strict: singing, 80 ms attack`, { sr, strict: true, instrument: 'piano', note: a3, parts: [{ at: 0.3, sig: sung(220, sr, 1.6, { attack: 0.08 }) }], secs: 2.5, expect: 'none' });
  run(`${sr} strict: humming, slow start`, { sr, strict: true, instrument: 'piano', note: a3, parts: [{ at: 0.3, sig: sung(220, sr, 1.6, { attack: 0.3, vibCents: 0 }) }], secs: 2.5, expect: 'none' });
  run(`${sr} strict: speech`, { sr, strict: true, instrument: 'piano', note: a3, parts: [{ at: 0.3, sig: speech(sr, 8) }], secs: 2.8, expect: 'none' });
  run(`${sr} strict: clap`, { sr, strict: true, instrument: 'piano', note: a3, parts: [{ at: 0.3, sig: clap(sr) }, { at: 1.2, sig: clap(sr) }], secs: 2.5, expect: 'none' });
  run(`${sr} strict: loud room noise`, { sr, strict: true, instrument: 'piano', note: a3, parts: [{ at: 0.3, sig: mix(sr, 1.5, [], 0.05) }], secs: 2.5, expect: 'none' });

  // "Any sound" mode lets voices through.
  run(`${sr} any: singing`, { sr, strict: false, instrument: 'piano', note: a3, parts: [{ at: 0.3, sig: sung(220, sr, 1.6) }], secs: 2.5, expect: 'correct' });
  run(`${sr} any: loud room noise`, { sr, strict: false, instrument: 'piano', note: a3, parts: [{ at: 0.3, sig: mix(sr, 1.5, [], 0.05) }], secs: 2.5, expect: 'none' });
  const any = run(`${sr} any: speech (informational)`, { sr, strict: false, instrument: 'piano', note: a3, parts: [{ at: 0.3, sig: speech(sr, 8) }], secs: 2.8, expect: 'none' });
}

// ---- Part 3: many different noise patterns, so one lucky seed can't hide a weakness ----
console.log('--- Robustness: real notes across many noise patterns (12 per case, both sample rates) ---');
const robust = [
  ['guitar low E (E2)',        'guitar', { letter: 'e', octave: 3, acc: '', number: 23 }, 82.41,  { harm: [0.3, 1, 0.8, 0.5] }],
  ['guitar A2',                'guitar', { letter: 'a', octave: 3, acc: '', number: 26 }, 110,    { harm: [0.5, 1, 0.7, 0.4] }],
  ['guitar 12th fret high E',  'guitar', { letter: 'e', octave: 6, acc: '', number: 44 }, 659.26, {}],
  ['piano C4',                 'piano',  { letter: 'c', octave: 4, acc: '', number: 28 }, 261.63, {}],
  ['piano A4, soft (amp .03)', 'piano',  { letter: 'a', octave: 4, acc: '', number: 33 }, 440,    { amp: 0.03 }],
  ['piano A4, normal',         'piano',  { letter: 'a', octave: 4, acc: '', number: 33 }, 440,    {}]
];
const failBefore = fail;
for (const [label, instrument, note, freq, opts] of robust) {
  let accepted = 0, total = 0; const lat = [];
  for (const sr of [44100, 48000]) {
    for (let s = 1; s <= 12; s++) {
      seed = 1000 * s + 7;
      const r = run(`robust ${label} ${sr} seed ${s}`, { sr, strict: true, instrument, note, parts: [{ at: 0.3, sig: pluck(freq, sr, 2, opts) }], secs: 2.5, expect: 'correct' });
      total++; if (r.good) accepted++; if (r.latency !== null) lat.push(r.latency);
    }
  }
  lat.sort((a, b) => a - b);
  const med = lat.length ? lat[Math.floor(lat.length / 2)] : 'n/a', worst = lat.length ? lat[lat.length - 1] : 'n/a';
  console.log(`  ${label}: accepted ${accepted} of ${total}; time to answer after the note starts: typical ${med} ms, slowest ${worst} ms`);
}

console.log(`Checks: ${pass} passed, ${fail} failed`);
