// Pulls the yinDetect function out of index.html and tests it on generated tones.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/\/\/ BEGIN YIN([\s\S]*?)\/\/ END YIN/);
const yinDetect = new Function(m[1] + '; return yinDetect;')();

const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const name = midi => NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
const midiOf = f => Math.round(69 + 12 * Math.log2(f / 440));
const freqOf = midi => 440 * Math.pow(2, (midi - 69) / 12);

// Build a tone: harmonic amplitudes like [1, .5, .3] = fundamental plus overtones.
function tone(freq, sr, harmonics, n = 4096) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    harmonics.forEach((a, h) => { s += a * Math.sin(2 * Math.PI * freq * (h + 1) * i / sr); });
    buf[i] = 0.3 * s;
  }
  return buf;
}

let pass = 0, fail = 0;
function check(label, expectedMidi, buf, sr) {
  const r = yinDetect(buf, sr);
  const got = r ? midiOf(r.freq) : null;
  const ok = got === expectedMidi;
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${label}: expected ${name(expectedMidi)}, got ${got === null ? 'null' : name(got)}${r ? ' clarity ' + r.clarity.toFixed(2) : ''}`);
}

const timbres = {
  'pure sine':        [1],
  'piano-like':       [1, 0.6, 0.35, 0.2, 0.1],
  'guitar-like':      [0.6, 1, 0.7, 0.4, 0.2],   // strong 2nd harmonic
  'weak fundamental': [0.25, 1, 0.8, 0.5]        // common on low guitar strings
};

// Guitar range (E2 = 40) up through piano treble (C6 = 84), at two sample rates.
for (const sr of [44100, 48000]) {
  for (const [tname, h] of Object.entries(timbres)) {
    for (let midi = 40; midi <= 84; midi++) {
      check(`${tname} ${name(midi)} @${sr}`, midi, tone(freqOf(midi), sr, h), sr);
    }
  }
}

// Slightly out-of-tune notes (+/- 15 cents) should still round to the right note.
for (let midi = 40; midi <= 84; midi += 4) {
  for (const cents of [-15, 15]) {
    const f = freqOf(midi) * Math.pow(2, cents / 1200);
    check(`detuned ${cents}c ${name(midi)}`, midi, tone(f, 44100, timbres['piano-like']), 44100);
  }
}

// Noise and silence should NOT produce a confident note.
let noiseBad = 0;
for (let t = 0; t < 50; t++) {
  const buf = new Float32Array(4096);
  for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 2 - 1) * 0.3;
  const r = yinDetect(buf, 44100);
  if (r && r.clarity >= 0.85) noiseBad++;
}
const silent = yinDetect(new Float32Array(4096), 44100);

console.log(`Tone tests: ${pass} passed, ${fail} failed`);
console.log(`Noise: ${noiseBad}/50 random-noise frames wrongly passed the 0.85 clarity filter`);
console.log(`Pure silence result: ${silent === null ? 'null (good)' : JSON.stringify(silent)}`);

// Speed check: one detection should be far faster than the 50ms tick.
const t0 = process.hrtime.bigint();
for (let i = 0; i < 20; i++) yinDetect(tone(196, 48000, timbres['guitar-like']), 48000);
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
console.log(`Average detection time (including tone generation): ${ms.toFixed(1)} ms`);
