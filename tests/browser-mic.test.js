// Runs the REAL page in headless Chromium with a fake microphone that plays a synthetic plucked note.
// VexFlow (loaded from the internet in the real page) is replaced by a stub, so the staff is NOT drawn here:
// this tests the microphone permission, Web Audio, pitch detection, filters and answer checking.
// Run:  node tests/browser-mic.test.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = process.env.TEST_TMP || require('path').join(require('os').tmpdir(), 'note-trainer-tests');
fs.mkdirSync(OUT, { recursive: true });
const PAGE = 'file://' + path.join(__dirname, '..', 'index.html');

// ---- Make a WAV file: 2 s of quiet room, then one plucked note that fades over a few seconds ----
function makeWav(file, freq, { sr = 48000, quiet = 2.0, total = 7.0 } = {}) {
  const n = Math.round(total * sr), data = Buffer.alloc(n * 2);
  let seed = 99; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / sr; let v = 0.004 * rnd();
    if (t >= quiet) {
      const u = t - quiet;
      [1, 0.6, 0.35, 0.2].forEach((a, k) => { v += (0.3 / 2.15) * a * Math.sin(2 * Math.PI * freq * (k + 1) * u); });
      v *= Math.min(1, u / 0.003) * Math.exp(-u / 1.0);
    }
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

let pass = 0, fail = 0;
function ok(cond, label, detail = '') { cond ? pass++ : (fail++, console.log('FAIL:', label, detail)); }

// A tiny stand-in for VexFlow: just enough for the page to run.
const VEX_STUB = `window.Vex = { Flow: {
  Renderer: class { static get Backends() { return { SVG: 1 }; } constructor(div) { this.div = div; }
    resize() {} getContext() { return { scale() {} }; } },
  Stave: class { addClef() { return this; } setContext() { return this; } draw() {} },
  StaveNote: class { constructor(o) { window.__lastDraw = o; } addModifier() { return this; } },
  Voice: class { addTickables() {} draw() {} },
  Formatter: class { joinVoices() { return this; } format() {} },
  Accidental: class {} } };`;

// One scenario: which note is on screen, which settings, which note the fake microphone plays.
async function scenario(label, { playHz, writtenNote, instrument, octave, expect }) {
  const wav = path.join(OUT, `pluck_${Math.round(playHz)}.wav`);
  makeWav(wav, playHz);
  const browser = await chromium.launch({ args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`,
    '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/vexflow.js', r => r.fulfill({ contentType: 'application/javascript', body: VEX_STUB }));
  await page.goto(PAGE);

  await page.selectOption('#mode', 'mic');
  await page.selectOption('#instrument', instrument);
  await page.selectOption('#octaveMode', octave);
  // Put a known note on screen (the same data the page itself creates).
  await page.evaluate(n => { currentNote = { ...n, number: n.octave * 7 + LETTERS.indexOf(n.letter) }; updateMicNote(); }, writtenNote);
  const micNote = await page.textContent('#micNote');

  await page.click('#micToggle');
  let feedback = '';
  for (let i = 0; i < 70; i++) {                 // wait up to about 7 seconds for an answer
    await page.waitForTimeout(100);
    feedback = (await page.textContent('#feedback')).trim();
    if (feedback) break;
  }
  const status = (await page.textContent('#micStatus')).trim();
  await browser.close();

  ok(errors.length === 0, `${label}: no page errors`, errors.join(' | '));
  ok(expect.test(feedback), `${label}: feedback matches ${expect}`, `got "${feedback}" (status "${status}")`);
  console.log(`  ${label}\n    on-screen hint: ${micNote}\n    result: ${feedback || '(no answer)'}`);
}

(async () => {
  const G3 = 195.998, G4 = 391.995;
  const g4 = { letter: 'g', octave: 4, acc: '' }, g3 = { letter: 'g', octave: 3, acc: '' }, g5 = { letter: 'g', octave: 5, acc: '' };

  // YOUR CASE: the G on the second line is written G4; on guitar the open G string sounds G3 (196 Hz).
  await scenario('guitar, written G4, open G string (196 Hz), exact octave', { playHz: G3, writtenNote: g4, instrument: 'guitar', octave: 'exact', expect: /^Correct/ });
  // The same sound an octave up should NOT count as right when exact octave is required.
  await scenario('guitar, written G4, G one octave up (392 Hz), exact octave', { playHz: G4, writtenNote: g4, instrument: 'guitar', octave: 'exact', expect: /wrong octave for guitar/ });
  // ...but is fine when any octave is accepted.
  await scenario('guitar, written G4, G one octave up (392 Hz), any octave', { playHz: G4, writtenNote: g4, instrument: 'guitar', octave: 'any', expect: /^Correct/ });
  // Piano plays what is written.
  await scenario('piano, written G3, plays G3 (196 Hz), exact octave', { playHz: G3, writtenNote: g3, instrument: 'piano', octave: 'exact', expect: /^Correct/ });
  await scenario('piano, written G4, plays G3 (196 Hz), exact octave', { playHz: G3, writtenNote: g4, instrument: 'piano', octave: 'exact', expect: /wrong octave for piano/ });
  await scenario('piano, written G5, plays G4 (392 Hz), exact octave', { playHz: G4, writtenNote: g5, instrument: 'piano', octave: 'exact', expect: /wrong octave for piano/ });
  // A wrong note entirely.
  await scenario('piano, written C4, plays G3', { playHz: G3, writtenNote: { letter: 'c', octave: 4, acc: '' }, instrument: 'piano', octave: 'any', expect: /^I heard G\./ });

  console.log(`Browser mic tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Test crashed:', e); process.exit(2); });
