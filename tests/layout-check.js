// Measures the page at phone and Chromebook sizes: horizontal overflow and touch-target sizes.
// VexFlow is stubbed (the staff itself is not drawn), so this checks the controls only.
const { chromium } = require('playwright');
const path = require('path');
const STUB = `window.Vex={Flow:{Renderer:class{static get Backends(){return{SVG:1}}resize(){}getContext(){return{scale(){}}}},Stave:class{addClef(){return this}setContext(){return this}draw(){}},StaveNote:class{addModifier(){return this}},Voice:class{addTickables(){}draw(){}},Formatter:class{joinVoices(){return this}format(){}},Accidental:class{}}};`;
(async () => {
  const browser = await chromium.launch();
  for (const [name, w, h] of [['small phone', 320, 640], ['phone', 375, 667], ['Chromebook', 1366, 768]]) {
    for (const mode of ['buttons', 'mic']) {
      const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800 })).newPage();
      await page.route('**/vexflow.js', r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
      await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
      await page.selectOption('#mode', mode);
      await page.selectOption('#accidentals', 'on');
      const r = await page.evaluate(() => {
        const small = [];
        document.querySelectorAll('button, select, input').forEach(e => {
          const b = e.getBoundingClientRect();
          if (b.width && (b.height < 44 || b.width < 44)) small.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} ${Math.round(b.width)}x${Math.round(b.height)}`);
        });
        return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, small };
      });
      console.log(`${name} ${w}px, ${mode} mode: ${r.scrollW > r.innerW ? 'SIDEWAYS SCROLL (' + r.scrollW + ' > ' + r.innerW + ')' : 'no sideways scroll'}; controls under 44px: ${r.small.join(', ') || 'none'}`);
    }
  }
  await browser.close();
})();
