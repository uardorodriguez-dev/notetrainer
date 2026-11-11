// STAFF DRAWING
// Builds a small SVG picture of one note on a staff: white lines on a transparent background, sized to sit
// inside a bubble. Uses the music engine for where the note sits, and the FreeSerif clef and accidental shapes.
// Works offline, with no notation library.
(function (root, factory) {
  const Engine = root.MusicEngine || (typeof require === 'function' ? require('./music-engine.js') : null);
  const Glyphs = root.MusicGlyphs || (typeof require === 'function' ? require('./glyphs.js') : null);
  const api = factory(Engine, Glyphs);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.StaffSVG = api;
})(this, function (Engine, Glyphs) {
  // Picture coordinates: 100 wide x 135 tall. Staff lines 10 apart, bottom line at y = 85, top line at y = 45.
  // One step (line to space) is 5. That leaves room for 3 ledger lines above and below.
  const W = 100, H = 135, SPACE = 10, BOTTOM_Y = 85, TOP_Y = 45;
  const NOTE_X = 64;
  const LINE_W = 1.3;

  const stepY = step => BOTTOM_Y - step * (SPACE / 2);
  const r = v => Math.round(v * 100) / 100;

  // Place a font glyph so its bounding box lands on the given box.
  function glyph(g, x, top, height, color) {
    const [x0, y0, , y1] = g.bbox;
    const s = height / (y1 - y0);
    return `<path fill="${color}" transform="translate(${r(x - x0 * s)} ${r(top - y0 * s)}) scale(${r(s * 1e4) / 1e4})" d="${g.d}"/>`;
  }

  // A whole note: an oval with a tilted oval hole (the hole is cut out, so staff lines show through it).
  function wholeNote(cx, cy, color) {
    const pts = (rx, ry, rot, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2, x = rx * Math.cos(t), y = ry * Math.sin(t);
        out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
      }
      return 'M' + out.map(p => r(p[0]) + ' ' + r(p[1])).join('L') + 'Z';
    };
    return `<path fill="${color}" fill-rule="evenodd" d="${pts(6.6, 4.6, 0, 32)}${pts(2.7, 3.9, -0.6, 24)}"/>`;
  }

  // Clef shapes, sized against the staff.
  const CLEFS = {
    treble: { glyph: 'treble', x: 3, top: TOP_Y - 1.75 * SPACE, height: 7.35 * SPACE },
    bass:   { glyph: 'bass',   x: 4, top: TOP_Y,                height: 3.1 * SPACE }
  };
  const ACCIDENTALS = {
    '#': { glyph: 'sharp', height: 2.9 * SPACE, center: 0.5 },   // vertical centre of the sign sits on the note
    'b': { glyph: 'flat',  height: 2.5 * SPACE, center: 0.72 }   // the round part of the flat sits on the note
  };

  // note: { letter, octave, acc }   clef: 'treble' | 'bass'   options.color (default white)
  function staffSVG(note, clef, options) {
    const o = options || {}, color = o.color || '#f4f6ff', c = clef || 'treble';
    const pos = Engine.staffPosition(note, c);
    const y = stepY(pos.step);
    const parts = [];

    for (let i = 0; i < 5; i++) {                                     // the five staff lines
      const ly = BOTTOM_Y - i * SPACE;
      parts.push(`<line x1="1" y1="${ly}" x2="${W - 1}" y2="${ly}" stroke="${color}" stroke-width="${LINE_W}"/>`);
    }
    const ledger = ly => parts.push(`<line x1="${NOTE_X - 10.5}" y1="${ly}" x2="${NOTE_X + 10.5}" y2="${ly}" stroke="${color}" stroke-width="${LINE_W}"/>`);
    for (let s = -2; s >= pos.step; s -= 2) ledger(stepY(s));          // ledger lines below
    for (let s = 10; s <= pos.step; s += 2) ledger(stepY(s));          // ledger lines above

    const cl = CLEFS[c];
    parts.push(glyph(Glyphs[cl.glyph], cl.x, cl.top, cl.height, color));

    if (note.acc && ACCIDENTALS[note.acc]) {
      const a = ACCIDENTALS[note.acc], g = Glyphs[a.glyph];
      const top = y - a.height * a.center;
      const width = a.height * (g.bbox[2] - g.bbox[0]) / (g.bbox[3] - g.bbox[1]);
      parts.push(glyph(g, NOTE_X - 10 - width, top, a.height, color));
    }
    parts.push(wholeNote(NOTE_X, y, color));

    const size = o.size ? ` width="${o.size}" height="${r(o.size * H / W)}"` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"${size}>${parts.join('')}</svg>`;
  }

  return { staffSVG, WIDTH: W, HEIGHT: H, stepY };
});
