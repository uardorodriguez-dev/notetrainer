// Heart Defense with the microphone, in headless Chromium. A fake microphone plays synthetic guitar recordings.
// Run: node tests/play-mic.test.js [screenshot folder]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const OUT = path.join(os.tmpdir(), 'heart-defense-mic'); fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.argv[2] || OUT; fs.mkdirSync(SHOTS, { recursive: true });
const PAGE = 'file://' + path.join(__dirname, '..', 'heart-defense.html');
const SR = 48000, GUITAR = [0.7, 1, 0.6, 0.35, 0.2], NORM = 2.85;
let pass = 0, fail = 0;
const ok = (c, label, detail = '') => { c ? pass++ : (fail++, console.log('FAIL:', label, detail)); };

let seed = 31;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function wav(file, seconds, plucks, noise = 0.003) {
  const n = Math.round(seconds * SR), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = noise * gauss();
  for (const p of plucks) {
    const s0 = Math.round(p.at * SR);
    for (let j = 0; s0 + j < n; j++) {
      const t = j / SR; let v = 0;
      GUITAR.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * p.hz * (k + 1) * t); });
      x[s0 + j] += v * (p.amp / NORM) * Math.min(1, t / 0.003) * Math.exp(-t / 0.8);
    }
  }
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
  return file;
}
async function launch(file, viewport = { width: 1280, height: 800 }) {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${file}`, '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ permissions: ['microphone'], viewport });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE); await page.waitForTimeout(500);
  return { browser, context, page, errors };
}
const stats = page => page.evaluate(() => { const g = window.__heartDefense.game; return g ? { ...g.state.stats, health: g.state.health, bubbles: g.state.bubbles.length, phase: g.state.phase } : null; });
// Keep every bubble on screen carrying the written note `name` (so we know what to "play").
const forceNotes = (page, name) => page.evaluate(n => { const g = window.__heartDefense.game; if (g) g.state.bubbles.forEach(b => { b.note = MusicEngine.parse(n); b.choices = MusicEngine.answerChoices(b.note, 4); }); }, name);
async function playFor(page, seconds, noteName, until) {
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < seconds) {
    if (noteName) await forceNotes(page, noteName);
    await page.waitForTimeout(100);
    if (until && until(await stats(page))) break;
  }
}
const G3 = 195.998, A3 = 220;

(async () => {
  // A. Guitar: open G string pops the written-G4 bubbles; plucking G again pops the next one too
  {
    const { browser, page, errors } = await launch(wav(path.join(OUT, 'a.wav'), 14, [{ at: 6.0, hz: G3, amp: 0.3 }, { at: 9.5, hz: G3, amp: 0.3 }]));
    await page.selectOption('#instSel', 'guitar');
    await page.selectOption('#modeSel', 'mic');
    ok(await page.isVisible('#micPanel') && await page.isVisible('#rulesMic'), 'microphone mode shows the setup panel and the play-the-note rules');
    await page.screenshot({ path: path.join(SHOTS, 'mic-start.png') });
    await page.click('#startBtn');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => window.__heartDefense.mic.running), 'Start turns the microphone on');
    ok(await page.isVisible('#micStrip') && !(await page.isVisible('#choices')), 'during play the listening strip replaces the buttons');
    await playFor(page, 11, 'g4', s => s && s.correct >= 2);
    const s = await stats(page);
    console.log(`  guitar run: ${s.correct} popped, ${s.incorrect} wrong, health ${s.health}`);
    ok(s.correct >= 1, 'playing the open G string pops a written-G4 bubble');
    ok(s.correct === 2, 'plucking G again pops the next G bubble');
    ok(s.incorrect === 0, 'no wrong answers counted from the ringing note');
    await page.screenshot({ path: path.join(SHOTS, 'mic-playing.png') });
    ok(errors.length === 0, 'no page errors (A)', errors.join(' | '));
    await browser.close();
  }

  // B. A note no bubble has: counted wrong, "Heard A" shown, the bubble keeps coming
  {
    const { browser, page, errors } = await launch(wav(path.join(OUT, 'b.wav'), 12, [{ at: 6.0, hz: A3, amp: 0.3 }]));
    await page.selectOption('#instSel', 'guitar');
    await page.selectOption('#modeSel', 'mic');
    await page.click('#startBtn');
    await playFor(page, 9, 'g4', s => s && s.incorrect >= 1);
    const s = await stats(page);
    ok(s.incorrect === 1 && s.correct === 0 && s.health === 3, `a wrong note counts as wrong (${JSON.stringify(s)})`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, 'mic-wrong.png') });
    ok(errors.length === 0, 'no page errors (B)', errors.join(' | '));
    await browser.close();
  }

  // C. Quiet guitar: calibrate on the start screen, then it is heard in the game
  {
    const quiet = (at) => ({ at, hz: G3, amp: 0.05 });
    const { browser, page, errors } = await launch(wav(path.join(OUT, 'c.wav'), 20, [quiet(3.0), quiet(11.0)], 0.004));
    await page.selectOption('#instSel', 'guitar');
    await page.selectOption('#modeSel', 'mic');
    await page.click('#micOnBtn');
    await page.waitForTimeout(1600);
    ok(!(await page.isDisabled('#calNoteBtn')), 'calibrate button is enabled once the microphone is on');
    await page.click('#calNoteBtn');
    let msg = '';
    for (let i = 0; i < 60; i++) { await page.waitForTimeout(100); msg = await page.textContent('#panelStatus'); if (/Microphone is set up|barely hear/.test(msg)) break; }
    console.log(`  calibration said: ${msg}`);
    ok(/Heard G/.test(msg) && /set up/.test(msg), 'calibration with a quiet guitar succeeds and says what it heard');
    await page.screenshot({ path: path.join(SHOTS, 'mic-calibrated.png') });
    await page.click('#startBtn');
    await playFor(page, 10, 'g4', s => s && s.correct >= 1);
    const s = await stats(page);
    ok(s.correct === 1, `after calibrating, the quiet G pops a bubble (${JSON.stringify(s)})`);
    // pause shows the microphone panel too
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    ok(await page.isVisible('#pauseScreen') && await page.isVisible('#micSlotPause #micPanel'), 'pause screen offers the microphone setup');
    // settings remembered after reload
    await page.reload(); await page.waitForTimeout(400);
    ok(await page.inputValue('#instSel') === 'guitar' && await page.inputValue('#modeSel') === 'mic', 'instrument and answer mode are remembered');
    ok(errors.length === 0, 'no page errors (C)', errors.join(' | '));
    await browser.close();
  }

  // D. Phone layout in microphone mode
  {
    const { browser, page, errors } = await launch(wav(path.join(OUT, 'd.wav'), 8, []), { width: 390, height: 844 });
    await page.selectOption('#modeSel', 'mic');
    const fit = await page.evaluate(() => { const c = document.querySelector('#startScreen .card').getBoundingClientRect(); return c.top >= 0 && c.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth; });
    ok(fit, 'phone: start screen with microphone setup fits');
    await page.screenshot({ path: path.join(SHOTS, 'mic-phone-start.png') });
    await page.click('#startBtn'); await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(SHOTS, 'mic-phone-playing.png') });
    ok(errors.length === 0, 'no page errors (D)', errors.join(' | '));
    await browser.close();
  }


  // E. Exact octave: G one octave too high says "wrong octave"; then the open G string pops the bubble
  {
    const G4 = 391.995;
    const { browser, page, errors } = await launch(wav(path.join(OUT, 'e.wav'), 16, [{ at: 6.0, hz: G4, amp: 0.3 }, { at: 8.0, hz: G3, amp: 0.3 }]));
    await page.selectOption('#instSel', 'guitar');
    await page.selectOption('#modeSel', 'mic');
    await page.selectOption('#octaveSel', 'exact');
    await page.selectOption('#speedSel', 'relaxed');
    await page.click('#startBtn');
    const wrongs = [];
    await page.exposeFunction('__noteWrong', w => wrongs.push(w));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__heartDefense.game.on('wrong', w => window.__noteWrong({ heard: w.heard, wrongOctave: w.wrongOctave })));
    await playFor(page, 7.2, 'g4', s => s && s.incorrect >= 1);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(SHOTS, 'mic-wrong-octave.png') });
    ok(wrongs.length === 1 && wrongs[0].wrongOctave === true && wrongs[0].heard === 'G', `G an octave too high is "wrong octave" (${JSON.stringify(wrongs)})`);
    await playFor(page, 4, 'g4', s => s && s.correct >= 1);
    const s = await stats(page);
    ok(s.correct === 1 && s.incorrect === 1, `then the open G string pops it (${JSON.stringify(s)})`);
    const wave = await page.evaluate(() => window.__heartDefense.game.state.wave);
    ok(Math.abs(wave.travel - 22.4) < 1e-6 && wave.maxOnScreen === 1, 'Relaxed speed is applied to the game');
    await page.reload(); await page.waitForTimeout(300);
    ok(await page.inputValue('#octaveSel') === 'exact' && await page.inputValue('#speedSel') === 'relaxed', 'octave and speed are remembered');
    ok(errors.length === 0, 'no page errors (E)', errors.join(' | '));
    await browser.close();
  }

  console.log(`Heart Defense microphone tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Test crashed:', e); process.exit(2); });
