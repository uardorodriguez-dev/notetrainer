// MUSIC ENGINE
// Shared by the trainer and every game: notes, ranges, random notes, answer choices and answer checking.
// There is no screen, sound or microphone code in here, so it is easy to test and easy to reuse.
//
// A written note is { letter: 'g', octave: 4, acc: '' }   acc is '' (natural), '#' (sharp) or 'b' (flat).
// Its "number" is octave * 7 + letter position (c=0 ... b=6): one step = one line or space on the staff.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MusicEngine = api;
})(this, function () {
  const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
  const ALPHABETICAL = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];          // the order answer buttons are shown in
  const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };         // semitones above C
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  // A sound alone does not say how a black key is spelled (F♯ and G♭ sound the same), so heard pitches get both names.
  const PITCH_LABELS = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];
  // The bottom line of each staff: treble E4, bass G2.
  const BOTTOM_LINE = { treble: 4 * 7 + 2, bass: 2 * 7 + 4 };

  // Named note ranges (natural notes, inclusive). Games choose one by name or pass their own { clef, low, high }.
  const RANGES = {
    'treble-staff':  { clef: 'treble', low: 'e4', high: 'f5' },   // the five lines and four spaces
    'treble-ledger': { clef: 'treble', low: 'c4', high: 'a5' },   // plus one ledger line below and above
    'treble-wide':   { clef: 'treble', low: 'a3', high: 'c6' },   // two ledger lines each way
    'bass-staff':    { clef: 'bass',   low: 'g2', high: 'a3' },
    'bass-ledger':   { clef: 'bass',   low: 'e2', high: 'c4' },
    'guitar':        { clef: 'treble', low: 'e3', high: 'e6' }    // written range: low E string to 12th fret of high E
  };

  // ---------- Basic conversions ----------
  function noteNumber(note) { return note.octave * 7 + LETTERS.indexOf(note.letter); }
  function fromNumber(n, acc) { return { letter: LETTERS[((n % 7) + 7) % 7], octave: Math.floor(n / 7), acc: acc || '' }; }

  // 'g4', 'F#5', 'bb3' -> { letter, octave, acc }
  function parse(text) {
    const m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(String(text).trim());
    if (!m) throw new Error('Not a note: ' + text);
    return { letter: m[1].toLowerCase(), acc: m[2], octave: Number(m[3]) };
  }
  function toNote(x) { return typeof x === 'string' ? parse(x) : x; }

  function noteToMidi(note) {
    const shift = note.acc === '#' ? 1 : note.acc === 'b' ? -1 : 0;
    return 12 * (note.octave + 1) + SEMI[note.letter] + shift;
  }
  function noteName(note) {          // "B♭", "F♯", "G"
    return note.letter.toUpperCase() + (note.acc === '#' ? '♯' : note.acc === 'b' ? '♭' : '');
  }
  function pitchLabel(midi) { return PITCH_LABELS[((midi % 12) + 12) % 12]; }
  function fullName(midi) { return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
  function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function sameWritten(a, b) { return a.letter === b.letter && a.octave === b.octave && (a.acc || '') === (b.acc || ''); }

  // The pitch that SOUNDS when a written note is played. Guitar is written an octave higher than it sounds.
  function soundingMidi(note, instrument) {
    const written = noteToMidi(note);
    return instrument === 'guitar' ? written - 12 : written;
  }

  // Where a written note sits: step 0 is the bottom line ... 8 the top line; outside that it needs ledger lines.
  function staffPosition(note, clef) {
    const step = noteNumber(note) - BOTTOM_LINE[clef];
    let ledgerLines = 0, side = 'inside';
    if (step < 0) { side = 'below'; ledgerLines = Math.floor(-step / 2); }
    else if (step > 8) { side = 'above'; ledgerLines = Math.floor((step - 8) / 2); }
    return { step: step, ledgerLines: ledgerLines, side: side };
  }

  // ---------- Ranges and random notes ----------
  // Accepts a range name ('treble-staff') or { clef, low, high } with notes or strings like 'c4'.
  function resolveRange(range) {
    const r = typeof range === 'string' ? RANGES[range] : range;
    if (!r) throw new Error('Unknown range: ' + range);
    return { clef: r.clef || 'treble', low: toNote(r.low), high: toNote(r.high) };
  }

  // Seeded random numbers, so games and tests can be replayed exactly. Returns a function like Math.random.
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A random written note inside the range.
  // options.accidentals: add sharps and flats (about half the notes); options.avoid: notes not to repeat.
  // Spellings nobody reads (E♯, B♯, C♭, F♭) are never produced, and a sharp or flat never leaves the range.
  function randomNote(range, options, rng) {
    const r = resolveRange(range), opts = options || {}, random = rng || Math.random;
    const low = noteNumber(r.low), high = noteNumber(r.high);
    const chance = opts.accidentalChance == null ? 0.5 : opts.accidentalChance;
    let note = null;
    for (let tries = 0; tries < 40; tries++) {
      const n = low + Math.floor(random() * (high - low + 1));
      const letter = LETTERS[n % 7];
      let acc = '';
      if (opts.accidentals && random() < chance) {
        const choices = [];
        if (letter !== 'e' && letter !== 'b' && n !== high) choices.push('#');
        if (letter !== 'c' && letter !== 'f' && n !== low) choices.push('b');
        if (choices.length) acc = choices[Math.floor(random() * choices.length)];
      }
      note = fromNumber(n, acc);
      if (!opts.avoid || !opts.avoid.some(a => sameWritten(a, note))) return note;
    }
    return note;
  }

  // ---------- Answer choices ----------
  // The correct name plus (count - 1) wrong names. Wrong names lean toward nearby letters (one line or space
  // away), because those are the mistakes students really make. Shown in A to G order so buttons stay predictable.
  function answerChoices(note, count, rng) {
    const n = count || 4, random = rng || Math.random;
    const correct = { letter: note.letter, acc: note.acc || '' };
    const odd = c => (c.acc === '#' && (c.letter === 'e' || c.letter === 'b')) || (c.acc === 'b' && (c.letter === 'c' || c.letter === 'f'));
    const accs = correct.acc ? ['', correct.acc] : [''];
    const pool = [];
    LETTERS.forEach(letter => accs.forEach(acc => {
      const c = { letter: letter, acc: acc };
      if ((c.letter === correct.letter && c.acc === correct.acc) || odd(c)) return;
      const d = Math.abs(LETTERS.indexOf(letter) - LETTERS.indexOf(correct.letter));
      const dist = Math.min(d, 7 - d);                                   // letters wrap: G is next to A
      pool.push({ c: c, w: dist === 0 ? 3 : dist === 1 ? 3 : dist === 2 ? 2 : 1 });
    }));
    const picked = [correct];
    while (picked.length < n && pool.length) {
      const total = pool.reduce((s, p) => s + p.w, 0);
      let x = random() * total, i = 0;
      while (x >= pool[i].w) { x -= pool[i].w; i++; }
      picked.push(pool.splice(i, 1)[0].c);
    }
    const order = c => ALPHABETICAL.indexOf(c.letter) * 3 + (c.acc === 'b' ? 0 : c.acc === '' ? 1 : 2);
    return picked.sort((a, b) => order(a) - order(b));
  }

  // ---------- Answer checking ----------
  // Tapped or typed answer: the spelling must match what is written.
  function isCorrectChoice(note, choice) {
    return choice.letter === note.letter && (choice.acc || '') === (note.acc || '');
  }
  // Heard answer (microphone): only the sound can be checked, so F♯ and G♭ both count for either.
  function checkSounding(note, heardMidi, options) {
    const o = options || {};
    const expected = soundingMidi(note, o.instrument || 'piano');
    const samePitchClass = (((heardMidi - expected) % 12) + 12) % 12 === 0;
    return {
      correct: o.exactOctave ? heardMidi === expected : samePitchClass,
      rightNoteWrongOctave: !!o.exactOctave && samePitchClass && heardMidi !== expected,
      expected: expected
    };
  }

  return {
    LETTERS, SEMI, NOTE_NAMES, PITCH_LABELS, BOTTOM_LINE, RANGES,
    noteNumber, fromNumber, parse, noteToMidi, noteName, pitchLabel, fullName, midiToFreq, sameWritten,
    soundingMidi, staffPosition, resolveRange, makeRng, randomNote, answerChoices, isCorrectChoice, checkSounding
  };
});
