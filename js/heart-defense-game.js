// HEART DEFENSE: GAME RULES
// Pure game logic: waves, bubbles, health, scoring. Nothing here draws or listens to the keyboard, so the
// same rules can be driven by buttons today and by the microphone later, and whole games can be simulated in tests.
//
// A bubble moves from the spawn ring (progress 0) to the heart (progress 1). The screen code decides
// where that is in pixels.
(function (root, factory) {
  const Engine = root.MusicEngine || (typeof require === 'function' ? require('./music-engine.js') : null);
  const api = factory(Engine);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.HeartDefense = api;
})(this, function (Engine) {

  // ---------- Difficulty ----------
  // One row per wave. count: bubbles in the wave. spawnEvery: seconds between bubbles.
  // travel: seconds a bubble takes to reach the heart. maxOnScreen: bubbles alive at once. range: which notes.
  const WAVES = [
    { count: 6,  spawnEvery: 3.2, travel: 14,   maxOnScreen: 2, range: 'treble-staff' },
    { count: 8,  spawnEvery: 2.8, travel: 12.5, maxOnScreen: 3, range: 'treble-staff' },
    { count: 10, spawnEvery: 2.4, travel: 11,   maxOnScreen: 3, range: 'treble-staff' },
    { count: 10, spawnEvery: 2.4, travel: 11,   maxOnScreen: 3, range: 'treble-ledger' },
    { count: 12, spawnEvery: 2.1, travel: 10,   maxOnScreen: 4, range: 'treble-ledger' }
  ];

  // Waves past the table keep getting harder: more bubbles, sooner, faster, more at once, wider range.
  function waveConfig(number, table) {
    const t = table || WAVES;
    if (number <= t.length) return Object.assign({ number: number }, t[number - 1]);
    const last = t[t.length - 1], k = number - t.length;
    return {
      number: number,
      count: last.count + 2 * k,
      spawnEvery: Math.max(0.9, last.spawnEvery * Math.pow(0.92, k)),
      travel: Math.max(5.5, last.travel * Math.pow(0.93, k)),
      maxOnScreen: Math.min(6, last.maxOnScreen + Math.floor(k / 2)),
      range: k >= 2 ? 'treble-wide' : last.range
    };
  }

  const RULES = {
    startHealth: 3,
    maxHealth: 3,
    choices: 4,             // answer buttons per bubble
    breakSeconds: 2.5,      // pause between waves
    firstSpawnDelay: 0.8,   // after a wave starts
    pointsPerPop: 100,
    healEveryStreak: 10     // every 10 in a row: +1 heart (or +500 points at full health)
  };
  // Score multiplier from the current streak: x2 from 5 in a row, x3 from 10.
  function multiplier(streak) { return streak >= 10 ? 3 : streak >= 5 ? 2 : 1; }

  // Speed settings. They stretch every wave of the difficulty table:
  // time: multiplies the seconds to reach the heart and the seconds between bubbles.
  // fewer: how many fewer bubbles may be on screen at once (never below 1).
  const PACES = {
    relaxed: { time: 1.6, fewer: 1 },   // wave 1: 22 s to reach the heart, a bubble every 5 s, one at a time
    normal:  { time: 1.0, fewer: 0 },
    fast:    { time: 0.8, fewer: 0 }
  };

  // ---------- A game ----------
  // options: rng (random function), waves (difficulty table), range (use this range for every wave),
  //          accidentals (true/false), instrument ('piano' | 'guitar', for the microphone),
  //          pace ('relaxed' | 'normal' | 'fast', default normal), rules overrides.
  function createGame(options) {
    const opts = options || {};
    const rng = opts.rng || Math.random;
    const rules = Object.assign({}, RULES, opts.rules || {});
    const listeners = {};
    let nextId = 1;

    const state = {
      phase: 'ready',         // ready -> break -> playing -> break -> ... -> over
      paused: false,
      time: 0,                // seconds of play (survival time)
      wave: null,             // current wave config
      spawned: 0,             // bubbles spawned this wave
      spawnTimer: 0,
      breakLeft: 0,
      bubbles: [],
      targetId: null,
      health: rules.startHealth,
      stats: { correct: 0, incorrect: 0, missed: 0, streak: 0, bestStreak: 0, score: 0, popped: 0 }
    };

    function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
    function emit(type, data) { (listeners[type] || []).forEach(fn => fn(data, state)); }

    function start() {
      state.phase = 'break';
      beginWave(1);
    }

    function beginWave(number) {
      state.wave = waveConfig(number, opts.waves);
      if (opts.range) state.wave.range = opts.range;
      const pace = PACES[opts.pace] || PACES.normal;
      state.wave.travel *= pace.time;
      state.wave.spawnEvery *= pace.time;
      state.wave.maxOnScreen = Math.max(1, state.wave.maxOnScreen - pace.fewer);
      state.spawned = 0;
      state.spawnTimer = rules.firstSpawnDelay;
      state.phase = 'break';
      state.breakLeft = number === 1 ? 1.5 : rules.breakSeconds;
      emit('wave', { number: number, wave: state.wave });
    }

    // Pick the spawn angle farthest from the bubbles already on screen, so they don't stack up.
    function spawnAngle() {
      let best = rng() * Math.PI * 2, bestGap = -1;
      for (let i = 0; i < 12; i++) {
        const a = rng() * Math.PI * 2;
        let gap = Math.PI;
        state.bubbles.forEach(b => {
          const d = Math.abs(((a - b.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          gap = Math.min(gap, d);
        });
        if (gap > bestGap) { bestGap = gap; best = a; }
      }
      return best;
    }

    function spawn() {
      const avoid = state.bubbles.map(b => b.note);
      const note = Engine.randomNote(state.wave.range, { accidentals: !!opts.accidentals, avoid: avoid }, rng);
      const bubble = {
        id: nextId++,
        note: note,
        clef: Engine.resolveRange(state.wave.range).clef,
        choices: Engine.answerChoices(note, rules.choices, rng),
        wrong: [],                       // names already tried on this bubble
        angle: spawnAngle(),
        progress: 0,
        speed: 1 / state.wave.travel,    // progress per second
        age: 0
      };
      state.bubbles.push(bubble);
      state.spawned++;
      emit('spawn', bubble);
      return bubble;
    }

    // Advance the game by dt seconds.
    function update(dt) {
      if (state.paused || state.phase === 'over' || state.phase === 'ready') return;
      const step = Math.min(dt, 0.25);   // a long hiccup (tab switch) must not teleport bubbles
      state.time += step;

      if (state.phase === 'break') {
        state.breakLeft -= step;
        if (state.breakLeft <= 0) { state.phase = 'playing'; emit('playing', state.wave); }
        return;
      }

      // Spawning
      const remaining = state.wave.count - state.spawned;
      if (remaining > 0) {
        // An empty screen gets its next bubble within 0.6 seconds, so there is no dead time.
        if (state.bubbles.length === 0) state.spawnTimer = Math.min(state.spawnTimer, 0.6);
        state.spawnTimer -= step;
        const room = state.bubbles.length < state.wave.maxOnScreen;
        if (room && state.spawnTimer <= 0) {
          spawn();
          state.spawnTimer = state.wave.spawnEvery;
        }
      }

      // Movement, and bubbles reaching the heart
      for (const b of state.bubbles.slice()) {
        b.age += step;
        b.progress += b.speed * step;
        if (b.progress >= 1) {
          removeBubble(b);
          state.health -= 1;
          state.stats.missed++;
          state.stats.streak = 0;
          emit('hit', b);
          if (state.health <= 0) { state.health = 0; state.phase = 'over'; emit('over', summary()); return; }
        }
      }

      // Wave cleared
      if (state.spawned >= state.wave.count && state.bubbles.length === 0) {
        emit('waveclear', state.wave);
        beginWave(state.wave.number + 1);
      }
    }

    function removeBubble(b) {
      state.bubbles = state.bubbles.filter(x => x !== b);
      if (state.targetId === b.id) state.targetId = null;
    }

    // The bubble the answer buttons refer to: the one the player tapped, otherwise the one closest to the heart.
    function target() {
      let t = state.bubbles.find(b => b.id === state.targetId);
      if (!t && state.bubbles.length) {
        t = state.bubbles.reduce((a, b) => (b.progress > a.progress ? b : a));
        state.targetId = t.id;
      }
      return t || null;
    }
    function setTarget(id) {
      if (state.bubbles.some(b => b.id === id)) { state.targetId = id; emit('target', target()); }
    }

    function correctAnswer(b) {
      const s = state.stats;
      s.correct++; s.popped++; s.streak++;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
      const mult = multiplier(s.streak);
      const points = rules.pointsPerPop * mult;
      s.score += points;
      removeBubble(b);
      emit('pop', { bubble: b, points: points, multiplier: mult, streak: s.streak });
      if (s.streak % rules.healEveryStreak === 0) {
        if (state.health < rules.maxHealth) { state.health++; emit('heal', { health: state.health, streak: s.streak }); }
        else { s.score += 500; emit('bonus', { points: 500, streak: s.streak }); }
      }
    }
    // label: the button name tried (crossed out on that bubble); heard: what the microphone heard (shown, not crossed out)
    // wrongOctave: the microphone heard a note some bubble has, but in the wrong octave (exact-octave setting)
    function wrongAnswer(b, label, heard, wrongOctave) {
      state.stats.incorrect++;
      state.stats.streak = 0;
      if (label && b.wrong.indexOf(label) < 0) b.wrong.push(label);
      emit('wrong', { bubble: b, label: label, heard: heard || null, wrongOctave: !!wrongOctave });
    }

    // Answer with a name, e.g. { letter: 'g', acc: '' }. Returns true / false, or null if there was nothing to answer.
    function answer(choice) {
      if (state.paused || state.phase !== 'playing') return null;
      const b = target();
      if (!b) return null;
      const label = Engine.noteName(choice);
      if (b.wrong.indexOf(label) >= 0) return null;        // already tried that one on this bubble
      if (Engine.isCorrectChoice(b.note, choice)) { correctAnswer(b); return true; }
      wrongAnswer(b, label);
      return false;
    }

    // Answer by playing: heardMidi is the pitch the microphone recognized.
    // options.matchAny: pop whichever bubble has that note (closest to the heart first). With hands on an
    // instrument the player can't tap to aim, so the note they play does the aiming. A note that matches
    // no bubble counts as wrong (against the target bubble).
    // options.instrument / exactOctave: how the sound is compared (guitar sounds an octave below written).
    function answerPitch(heardMidi, options) {
      if (state.paused || state.phase !== 'playing') return null;
      const b = target();
      if (!b) return null;
      const o = Object.assign({ instrument: opts.instrument || 'piano' }, options || {});
      const heard = Engine.pitchLabel(heardMidi);
      if (o.matchAny) {
        const checks = state.bubbles.map(x => ({ x: x, r: Engine.checkSounding(x.note, heardMidi, o) }));
        const hits = checks.filter(c => c.r.correct).map(c => c.x);
        if (hits.length) { correctAnswer(hits.reduce((a, c) => (c.progress > a.progress ? c : a))); return true; }
        const octaveMiss = checks.find(c => c.r.rightNoteWrongOctave);
        wrongAnswer(octaveMiss ? octaveMiss.x : b, null, heard, !!octaveMiss);
        return false;
      }
      const r = Engine.checkSounding(b.note, heardMidi, o);
      if (r.correct) { correctAnswer(b); return true; }
      wrongAnswer(b, null, heard, r.rightNoteWrongOctave);
      return false;
    }

    function setPaused(p) {
      if (state.phase === 'over' || state.phase === 'ready') return;
      state.paused = !!p;
      emit('pause', state.paused);
    }

    function summary() {
      const s = state.stats, answered = s.correct + s.incorrect;
      return {
        wave: state.wave ? state.wave.number : 0,
        time: state.time,
        correct: s.correct, incorrect: s.incorrect, missed: s.missed,
        accuracy: answered ? s.correct / answered : 0,
        bestStreak: s.bestStreak, score: s.score
      };
    }

    return { state, rules, on, start, update, answer, answerPitch, target, setTarget, setPaused, summary, multiplier };
  }

  return { WAVES, RULES, PACES, waveConfig, multiplier, createGame };
});
