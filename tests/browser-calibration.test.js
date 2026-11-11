// Quiet-guitar scenarios in headless Chromium with a fake microphone playing a synthetic recording.
// Checks (1) how a quiet guitar behaves WITHOUT the new calibration step, (2) that "Calibrate with my instrument"
// fixes it, and (3) that the on-screen reasons appear when a sound is being ignored.
// VexFlow is stubbed (the staff is not drawn). Run:  node tests/browser-calibration.test.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = process.env.TEST_TMP || require('path').join(require('os').tmpdir(), 'note-trainer-tests');
fs.mkdirSync(OUT, { recursive: true });
const PAGE = 'file://' + path.join(__dirname, '..', 'index.html');
const SR = 48000;
const GUITAR = [0.7, 1, 0.6, 0.35, 0.2];
const G3 = 195.998;

let seed = 4242;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

// events: [{ kind: 'pluck' | 'sung' | 'noise', at, dur, hz, amp, tau, attack, vib }]
function makeWav(file, { total, noise, events }) {
  const n = Math.round(total * SR), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = noise * gauss();
  for (const e of events) {
    const start = Math.round(e.at * SR);
    const dur = e.dur || (total - e.at);
    const norm = GUITAR.reduce((a, b) => a + b, 0);
    let phase = 0;
    for (let j = 0; j < Math.round(dur * SR) && start + j < n; j++) {
      const t = j / SR; let v = 0;
      if (e.kind === 'pluck') {
        GUITAR.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * e.hz * (k + 1) * t); });
        v *= (e.amp / norm) * Math.min(1, t / 0.003) * Math.exp(-t / (e.tau || 0.8));
      } else if (e.kind === 'sung') {
        phase += 2 * Math.PI * e.hz * Math.pow(2, (e.vib || 0) * Math.sin(2 * Math.PI * 5.5 * t) / 1200) / SR;
        GUITAR.forEach((a, k) => { v += a * Math.sin((k + 1) * phase); });
        v *= (e.amp / norm) * (t < e.attack ? 0.5 * (1 - Math.cos(Math.PI * t / e.attack)) : 1);
      } else { v = e.amp * gauss(); }
      x[start + j] += v;
    }
  }
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

const VEX_STUB = `window.Vex={Flow:{Renderer:class{static get Backends(){return{SVG:1}}resize(){}getContext(){return{scale(){}}}},Stave:class{addClef(){return this}setContext(){return this}draw(){}},StaveNote:class{addModifier(){return this}},Voice:class{addTickables(){}draw(){}},Formatter:class{joinVoices(){return this}format(){}},Accidental:class{}}};`;

let pass = 0, fail = 0;
function ok(cond, label, detail = '') { cond ? pass++ : (fail++, console.log('FAIL:', label, detail)); }

// calibrateAt: seconds after Start at which to press "Calibrate with my instrument" (null = never).
async function run(label, { wav, calibrateAt = null, filter = 'strict', waitForAnswer = true, listenSeconds = 9 }) {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/vexflow.js', r => r.fulfill({ contentType: 'application/javascript', body: VEX_STUB }));
  await page.goto(PAGE);
  await page.selectOption('#mode', 'mic');
  await page.selectOption('#instrument', 'guitar');
  await page.selectOption('#octaveMode', 'any');
  await page.selectOption('#listenMode', filter);
  await page.evaluate(() => { currentNote = { letter: 'g', octave: 4, acc: '', number: 4 * 7 + 4 }; updateMicNote(); });

  const t0 = Date.now();
  await page.click('#micToggle');
  let calReport = '', statuses = new Set(), feedback = '', answeredAt = null, calDone = false;
  while ((Date.now() - t0) / 1000 < listenSeconds) {
    await page.waitForTimeout(100);
    const t = (Date.now() - t0) / 1000;
    if (calibrateAt !== null && t >= calibrateAt && !calDone && !statuses.has('__pressed')) {
      statuses.add('__pressed'); await page.click('#micCalibrateNote');
    }
    const status = (await page.textContent('#micStatus')).trim();
    if (status) statuses.add(status);
    if (statuses.has('__pressed') && !calDone && !/^Play one note/.test(status) && status && !/^Calibrating/.test(status) && !/^Listening/.test(status)) { calDone = true; calReport = status; }
    feedback = (await page.textContent('#feedback')).trim();
    if (feedback && answeredAt === null) { answeredAt = t; if (waitForAnswer) break; }
  }
  const finalStatus = (await page.textContent('#micStatus')).trim();
  await browser.close();
  ok(errors.length === 0, `${label}: no page errors`, errors.join(' | '));
  return { feedback, answeredAt, calReport, finalStatus, statuses: [...statuses].filter(s => s !== '__pressed') };
}

(async () => {
  const NOISE = 0.004;   // a typical laptop microphone's room noise
  console.log('PART 1: quiet guitar, NO instrument calibration (how the old behaviour fares)');
  const part1 = {};
  for (const amp of [0.3, 0.1, 0.05, 0.025]) {
    const wav = path.join(OUT, `q1_${amp}.wav`);
    makeWav(wav, { total: 12, noise: NOISE, events: [{ kind: 'pluck', at: 5.0, hz: G3, amp }] });
    const r = await run(`part1 amp ${amp}`, { wav, listenSeconds: 9 });
    part1[amp] = r;
    console.log(`  pluck strength ${amp}: ${r.answeredAt ? 'answered after ' + r.answeredAt.toFixed(1) + ' s: ' + r.feedback : 'NOT HEARD'}${r.answeredAt ? '' : ' | screen said: ' + r.finalStatus}`);
  }

  console.log('\nPART 2: same guitar, calibrating first (play and hold one note, then play the real note)');
  for (const amp of [0.1, 0.05, 0.025]) {
    const wav = path.join(OUT, `q2_${amp}.wav`);
    makeWav(wav, { total: 20, noise: NOISE, events: [
      { kind: 'pluck', at: 2.4, hz: G3, amp }, { kind: 'pluck', at: 8.5, hz: G3, amp }] });
    const r = await run(`part2 amp ${amp}`, { wav, calibrateAt: 1.6, listenSeconds: 16 });
    console.log(`  pluck strength ${amp}:\n    calibration said: ${r.calReport || '(nothing)'}\n    then: ${r.answeredAt ? 'answered after ' + r.answeredAt.toFixed(1) + ' s: ' + r.feedback : 'NOT HEARD | screen said: ' + r.finalStatus}`);
    if (amp >= 0.05) ok(/^Correct/.test(r.feedback), `part2 amp ${amp}: the note is heard after calibrating`, r.feedback + ' / ' + r.finalStatus);
    else ok(/barely hear|Heard/.test(r.calReport), `part2 amp ${amp}: calibration reports honestly`, r.calReport);
  }

  console.log('\nPART 3: reasons shown on screen when a sound is ignored');
  // Loud hiss: sound, but no clear note.
  makeWav(path.join(OUT, 'r_hiss.wav'), { total: 10, noise: NOISE, events: [{ kind: 'noise', at: 3, dur: 5, amp: 0.05 }] });
  let r = await run('hiss', { wav: path.join(OUT, 'r_hiss.wav'), listenSeconds: 8, waitForAnswer: false });
  console.log(`  loud hiss -> ${r.statuses.filter(s => !/^Calibrating|^Listening/.test(s)).join(' || ') || '(no message)'}`);
  ok(r.statuses.some(s => /not a clear note/.test(s)), 'hiss: says it cannot find a clear note');
  // A held, steady, gradually-starting note in strict mode: heard but no sharp attack.
  makeWav(path.join(OUT, 'r_held.wav'), { total: 10, noise: NOISE, events: [{ kind: 'sung', at: 3, dur: 5, hz: G3, amp: 0.3, attack: 0.25, vib: 0 }] });
  r = await run('held', { wav: path.join(OUT, 'r_held.wav'), listenSeconds: 8, waitForAnswer: false });
  console.log(`  steady note with a slow start, strict filter -> ${r.statuses.filter(s => !/^Calibrating|^Listening/.test(s)).join(' || ') || '(no message)'}`);
  ok(r.statuses.some(s => /not a sharp pluck/.test(s)), 'held note: says there was no sharp pluck');
  // Very quiet note near the gate.
  makeWav(path.join(OUT, 'r_quiet.wav'), { total: 12, noise: NOISE, events: [{ kind: 'pluck', at: 3, hz: G3, amp: 0.03, tau: 3 }] });
  r = await run('quiet', { wav: path.join(OUT, 'r_quiet.wav'), listenSeconds: 9, waitForAnswer: false });
  console.log(`  a quiet note -> ${r.statuses.filter(s => !/^Calibrating|^Listening/.test(s)).join(' || ') || '(no message)'}  | answered: ${r.feedback || 'no'}`);

  console.log(`\nCalibration browser tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Test crashed:', e); process.exit(2); });
