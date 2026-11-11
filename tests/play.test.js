// Plays Heart Defense in headless Chromium: start screen, popping bubbles, wrong answers, damage, game over.
// Also takes screenshots at phone and laptop sizes.   Run: node tests/play.test.js [screenshot folder]
const { chromium } = require('playwright');
const path = require('path');
const SHOTS = process.argv[2] || path.join(require('os').tmpdir(), 'heart-defense-screenshots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const PAGE = 'file://' + path.join(__dirname, '..', 'heart-defense.html');
let pass = 0, fail = 0;
const ok = (c, label, detail = '') => { c ? pass++ : (fail++, console.log('FAIL:', label, detail)); };

async function open(browser, viewport, opts = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: opts.dpr || 1, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(PAGE);
  await page.waitForTimeout(800);
  return { page, errors, context };
}
// Answer the target bubble correctly (true) or wrongly (false) by clicking the button, like a player would.
async function answer(page, right) {
  const idx = await page.evaluate(r => {
    const g = window.__heartDefense.game, t = g && g.target();
    if (!t || g.state.phase !== 'playing') return -1;
    return t.choices.findIndex(c => MusicEngine.isCorrectChoice(t.note, c) === r && !t.wrong.includes(MusicEngine.noteName(c)));
  }, right);
  if (idx < 0) return false;
  await page.click(`#choices button:nth-child(${idx + 1})`);
  return true;
}
const state = page => page.evaluate(() => { const g = window.__heartDefense.game; return g ? { phase: g.state.phase, health: g.state.health, bubbles: g.state.bubbles.length, stats: g.state.stats, wave: g.state.wave && g.state.wave.number, target: g.target() && g.target().id } : null; });

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  // ---- Laptop: full play-through ----
  {
    const { page, errors } = await open(browser, { width: 1280, height: 800 }, { dpr: 1 });
    ok(await page.isVisible('#startScreen'), 'start screen shows');
    await page.screenshot({ path: path.join(SHOTS, 'laptop-start.png') });
    await page.selectOption('#speedSel', 'normal');      // this run checks tapping between two bubbles, so it uses Normal speed
    await page.click('#startBtn');
    await page.waitForTimeout(1500);
    ok(await page.evaluate(() => window.__heartDefense.videosReady().every(Boolean)), 'heart and bubble videos are playing', JSON.stringify(await page.evaluate(() => window.__heartDefense.videosReady())));
    // wait for two bubbles to be on screen, then screenshot
    for (let i = 0; i < 80 && (await state(page)).bubbles < 2; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(1500);
    let s = await state(page);
    ok(s.phase === 'playing' && s.bubbles >= 1, 'bubbles are on screen', JSON.stringify(s));
    const labels = await page.$$eval('#choices button', bs => bs.map(b => b.textContent.replace(/\d$/, '')));
    ok(labels.length === 4 && labels.every(l => /^[A-G]$/.test(l)), 'four letter buttons', labels.join(','));
    await page.screenshot({ path: path.join(SHOTS, 'laptop-playing.png') });

    // wrong answer: bubble stays, button marked
    const before = s;
    await answer(page, false);
    await page.waitForTimeout(150);
    s = await state(page);
    ok(s.stats.incorrect === 1 && s.bubbles === before.bubbles && s.target === before.target, 'wrong answer: bubble keeps coming');
    ok((await page.$$('#choices button.wrong')).length === 1, 'wrong button is crossed out');
    await page.screenshot({ path: path.join(SHOTS, 'laptop-wrong.png') });

    // correct answers pop bubbles
    let popped = 0;
    for (let i = 0; i < 6; i++) { if (await answer(page, true)) { popped++; await page.waitForTimeout(120); } else await page.waitForTimeout(700); }
    s = await state(page);
    ok(s.stats.correct === popped && popped >= 3, `correct answers pop bubbles (${popped})`);
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(SHOTS, 'laptop-pop.png') });

    // keyboard: number keys answer
    await page.waitForTimeout(1200);
    const keyIdx = await page.evaluate(() => { const t = window.__heartDefense.game.target(); return t ? t.choices.findIndex(c => MusicEngine.isCorrectChoice(t.note, c)) : -1; });
    if (keyIdx >= 0) { const c0 = (await state(page)).stats.correct; await page.keyboard.press(String(keyIdx + 1)); await page.waitForTimeout(100); ok((await state(page)).stats.correct === c0 + 1, 'number keys answer'); }

    // pause
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    ok(await page.isVisible('#pauseScreen'), 'Esc pauses');
    const p1 = await page.evaluate(() => window.__heartDefense.game.state.time); await page.waitForTimeout(600);
    ok(await page.evaluate(() => window.__heartDefense.game.state.time) === p1, 'time stops while paused');
    await page.click('#resumeBtn'); await page.waitForTimeout(200);
    ok(!(await page.isVisible('#pauseScreen')), 'resume works');

    // tapping a bubble changes the target
    for (let i = 0; i < 250 && (await state(page)).bubbles < 2; i++) await page.waitForTimeout(100);
    const tap = await page.evaluate(() => {
      const H = window.__heartDefense, g = H.game, t = g.target(), other = g.state.bubbles.find(b => b !== t);
      if (!other) return null;
      const p = H.bubblePos(other), r = document.getElementById('arena').getBoundingClientRect();
      return { id: other.id, x: r.left + p.x, y: r.top + p.y };
    });
    if (tap) { await page.mouse.click(tap.x, tap.y); await page.waitForTimeout(100); ok((await state(page)).target === tap.id, 'tapping a bubble aims at it'); }
    else ok(false, 'two bubbles appeared for the tap check');

    // speed up time and let bubbles hit the heart until game over
    await page.evaluate(() => { const g = window.__heartDefense.game; g.state.bubbles.forEach(b => { b.progress = 0.97; }); });
    await page.waitForTimeout(900);
    s = await state(page);
    ok(s.health < 3, `a bubble reaching the heart costs a heart (health ${s.health})`);
    await page.screenshot({ path: path.join(SHOTS, 'laptop-hit.png') });
    for (let i = 0; i < 40 && (await state(page)).phase !== 'over'; i++) {
      await page.evaluate(() => { const g = window.__heartDefense.game; g.state.bubbles.forEach(b => { b.progress = Math.max(b.progress, 0.98); }); });
      await page.waitForTimeout(250);
    }
    s = await state(page);
    ok(s.phase === 'over' && s.health === 0, 'losing all three hearts ends the game');
    await page.waitForTimeout(900);
    ok(await page.isVisible('#overScreen'), 'game-over screen shows');
    const stats = await page.$$eval('#overStats div', ds => ds.map(d => d.innerText.replace('\n', ' ')));
    console.log('  game-over screen: ' + stats.join(' | '));
    ok(stats.length === 8, 'game-over screen shows 8 stats');
    await page.screenshot({ path: path.join(SHOTS, 'laptop-over.png') });
    await page.click('#againBtn'); await page.waitForTimeout(300);
    s = await state(page);
    ok(s.health === 3 && s.stats.correct === 0, 'play again starts fresh');
    ok(errors.length === 0, 'no page errors (laptop)', errors.join(' | '));
  }

  // ---- Phone ----
  {
    const { page, errors } = await open(browser, { width: 390, height: 844 }, { dpr: 2, touch: true });
    await page.screenshot({ path: path.join(SHOTS, 'phone-start.png') });
    await page.tap('#startBtn');
    for (let i = 0; i < 120 && (await state(page)).bubbles < 2; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(2500);
    const lay = await page.evaluate(() => ({ r: window.__heartDefense.layout.bubbleR, sw: document.documentElement.scrollWidth, w: innerWidth }));
    ok(lay.sw <= lay.w, 'phone: no sideways scrolling');
    ok(lay.r * 2 >= 96, `phone: bubbles are big enough to read (${Math.round(lay.r * 2)} px wide)`);
    const sizes = await page.$$eval('#choices button', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    ok(sizes.every(([w, h]) => w >= 60 && h >= 56), 'phone: answer buttons are big touch targets', JSON.stringify(sizes));
    await page.screenshot({ path: path.join(SHOTS, 'phone-playing.png') });
    const c0 = (await state(page)).stats.correct;
    const idx = await page.evaluate(() => { const t = window.__heartDefense.game.target(); return t.choices.findIndex(c => MusicEngine.isCorrectChoice(t.note, c)); });
    await page.tap(`#choices button:nth-child(${idx + 1})`); await page.waitForTimeout(120);
    ok((await state(page)).stats.correct === c0 + 1, 'phone: tapping the right answer pops the bubble');
    ok(errors.length === 0, 'no page errors (phone)', errors.join(' | '));
  }

  // ---- Small landscape phone ----
  {
    const { page, errors } = await open(browser, { width: 740, height: 360 }, { dpr: 2, touch: true });
    await page.tap('#startBtn');
    for (let i = 0; i < 120 && (await state(page)).bubbles < 2; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(1500);
    const fits = await page.evaluate(() => { const f = document.querySelector('footer').getBoundingClientRect(); return f.bottom <= innerHeight + 1 && document.documentElement.scrollHeight <= innerHeight + 1; });
    ok(fits, 'landscape phone: everything fits without scrolling');
    await page.screenshot({ path: path.join(SHOTS, 'phone-landscape.png') });
    ok(errors.length === 0, 'no page errors (landscape)', errors.join(' | '));
  }


  // ---- Smallest phones (320 px), both answer modes ----
  for (const mode of ['buttons', 'mic']) {
    const { page, errors } = await open(browser, { width: 320, height: 568 }, { dpr: 1, touch: true });
    await page.selectOption('#modeSel', mode);
    const startOk = await page.evaluate(() => { const s = document.getElementById('startBtn').getBoundingClientRect(); return s.top >= 0 && s.bottom <= innerHeight; });
    ok(startOk, `320 px ${mode}: Start button visible without scrolling`);
    if (mode === 'buttons') {
      await page.tap('#startBtn'); await page.waitForTimeout(1500);
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `320 px ${mode}: no sideways scrolling during play`);
    } else ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `320 px ${mode}: no sideways scrolling`);
    ok(errors.length === 0, `no page errors (320 px ${mode})`, errors.join(' | '));
  }

  await browser.close();
  console.log(`Play tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Test crashed:', e); process.exit(2); });
