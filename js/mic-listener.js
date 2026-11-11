// MICROPHONE LISTENER
// Shared by the games (and, later, the trainer). It turns microphone sound into "a note was played" events.
// Pitch detection (YIN) and the noise filters below are copied unchanged from the Note Trainer, so both
// behave the same; tests check that. Nothing here touches the page: screens listen to its events.
//
// Events (listener.on(name, fn)):
//   'level'      { rms, gate }        loudness 20 times a second, for a meter
//   'hearing'    midi | null          the note it currently hears, before it counts as an answer
//   'note'       { midi, result }     a played note that counts as an answer (result: what onNote returned)
//   'status'     text                 what to tell the player ("Calibrating...", reasons a sound is ignored)
//   'calibrated' { kind, ok, message } after measuring the room or the instrument
//   'filter'     'strict' | 'any'     the sound filter was changed (calibration can switch it)
(function (root, factory) {
  const Engine = root.MusicEngine || (typeof require === 'function' ? require('./music-engine.js') : null);
  const api = factory(Engine);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MicListener = api;
})(this, function (Engine) {
  const FRAME_MS = 50;            // check the microphone 20 times a second
  const STABLE_FRAMES = 5;        // the same note must be heard for 5 checks (about 1/4 second)
  const MIN_CLARITY = 0.85;       // ignore unclear readings
  const CAL_FRAMES = 20;          // room calibration listens for about 1 second
  const ONSET_WINDOW_MS = 1500;   // strict filter: how long after a note starts we wait for a steady pitch
  const MAX_PITCH_SPREAD = 0.4;   // strict filter: the pitch may wander at most 40 cents
  const NOTE_CAL_FRAMES = 34;     // instrument calibration listens to about 1.7 seconds of a held note
  const NOTE_CAL_WAIT_MS = 10000; // ...and gives up if nothing is played for 10 seconds
  const READY_TEXT = 'Listening... play the note on your instrument.';

  // ---------- Pitch detection (copied from the trainer) ----------
  // BEGIN YIN (identical to index.html)
  function yinDetect(buf, sampleRate, minFreq = 70, maxFreq = 1200, threshold = 0.15) {
    const W = Math.floor(buf.length / 2);                       // window we compare
    const tauMax = Math.min(Math.floor(sampleRate / minFreq), W);
    const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));

    // Step 1: how different is the sound from a copy of itself shifted by tau samples?
    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < W; i++) {
        const diff = buf[i] - buf[i + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }

    // Step 2: normalize so quiet and loud sounds are treated the same.
    const cm = new Float32Array(tauMax + 1);
    cm[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      cm[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
    }

    // Step 3: take the FIRST clear dip (this is what avoids octave-too-low mistakes).
    let tauEst = -1;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (cm[tau] < threshold) {
        while (tau + 1 < tauMax && cm[tau + 1] < cm[tau]) tau++;
        tauEst = tau;
        break;
      }
    }
    if (tauEst === -1) return null;

    // Step 4: refine between samples for accuracy.
    let refined = tauEst;
    if (tauEst > 1 && tauEst < tauMax) {
      const x0 = cm[tauEst - 1], x1 = cm[tauEst], x2 = cm[tauEst + 1];
      const denom = x0 + x2 - 2 * x1;
      if (denom !== 0) refined = tauEst + (x0 - x2) / (2 * denom);
    }
    return { freq: sampleRate / refined, clarity: 1 - cm[tauEst] };
  }
  // END YIN

  // ---------- Noise filters (copied from the trainer) ----------
  // BEGIN FILTERS (identical to index.html)

  // 1) Look for the "attack": the sudden jump in loudness when a key is struck or a string
  //    is plucked. Speech, humming and steady noise build up gradually, so they don't match.
  //    Returns the positions (in samples) where a sharp attack begins.
  function detectOnsets(buf, sampleRate, gate) {
    const C = 64;                                                    // work in chunks of 64 samples (about 1.3 ms)
    const n = Math.floor(buf.length / C);
    const span = Math.max(2, Math.round(sampleRate * 0.012 / C));    // 12 ms = one cycle of the lowest guitar note
    const L40 = Math.max(4, Math.round(sampleRate * 0.040 / C));     // look 40 ms ahead

    // Loudness envelope: the biggest sample seen over the last 12 ms.
    const peak = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let m = 0;
      for (let i = k * C; i < (k + 1) * C; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; }
      peak[k] = m;
    }
    const env = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let m = 0;
      for (let j = Math.max(0, k - span + 1); j <= k; j++) if (peak[j] > m) m = peak[j];
      env[k] = m;
    }

    // An attack = the envelope jumps past the gate AND past twice its recent level, and
    // reaches most of its volume within 12 ms. A voice swells up over tens of milliseconds,
    // so after 12 ms it is still well short of where it is heading.
    // It must also come out of a steady background (silence, or a note that is simply fading).
    // A signal that is already climbing is part of a swell, not a new attack.
    const found = [];
    for (let k = 2 * span; k < n - L40; k++) {
      let before = 0, lowest = Infinity;
      for (let j = k - 2 * span; j <= k - span; j++) {       // the 12 ms window that ended 12 ms ago
        if (env[j] > before) before = env[j];
        if (env[j] < lowest) lowest = env[j];
      }
      const steadyBefore = before <= 1.8 * Math.max(lowest, 0.75 * gate);
      const threshold = Math.max(gate, 2 * before);
      if (steadyBefore && env[k] >= threshold && env[k - 1] < threshold) {
        let top = 0;
        for (let j = k; j <= k + L40; j++) if (env[j] > top) top = env[j];
        if (env[k + span] >= 0.7 * top) {
          found.push(k * C);
          k += span;                                                 // count each attack once
        } else {
          k += L40;                                                  // a slow swell (a voice): don't re-judge its tail as a new attack
        }
      }
    }
    return found;
  }

  // 2) Is the pitch steady? A struck or plucked note holds one pitch. Voices drift and wobble.
  function steadyPitch(pitches, maxSpread) {
    return Math.max(...pitches) - Math.min(...pitches) <= maxSpread;
  }

  // 3) Set the volume gate from a short recording of the quiet room.
  function gateFromNoise(samples) {
    const sorted = samples.slice().sort((a, b) => a - b);
    const floor = sorted[Math.floor(0.9 * (sorted.length - 1))];
    const raw = floor * 4;                                           // gate sits well above the room noise
    return { gate: Math.min(0.06, Math.max(0.005, raw)), floor: floor, tooLoud: raw > 0.06 };
  }
  // END FILTERS

  // ---------- The listener ----------
  // options.filter: 'strict' (plucked or struck notes only, the default) or 'any'
  // options.onNote(midi): called when a played note counts; return true (right), false (wrong) or null (ignored)
  // options.now: clock in milliseconds (tests pass a fake one)
  function createListener(options) {
    const o = options || {};
    const now = o.now || (() => performance.now());
    const handlers = {};
    const on = (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); };
    const emit = (type, data) => (handlers[type] || []).forEach(fn => fn(data));

    const S = {
      running: false, paused: false, stream: null, ctx: null, analyser: null, sampleRate: 48000, timer: null,
      buf: new Float32Array(8192),
      filter: o.filter === 'any' ? 'any' : 'strict',
      gate: 0.01, floor: 0.004, calibrating: false, calSamples: [], noteCal: null,
      candidate: null, pitches: [], quietMs: 0, unclear: 0,
      lastAnswered: null, lastAnswerTime: -1e9, lastOnset: -1e9, pausedUntil: 0,
      why: '', whyAt: 0, lastStatus: '', dbg: {}
    };

    function status(text) { S.lastStatus = text; emit('status', text); }

    // A reason stays up at least 4 seconds, so it can still be read after the sound fades.
    function setWhy(text, force) {
      const t = now();
      if (S.why === text) return;
      if (!text && !force && S.why && t - S.whyAt < 4000) return;
      S.why = text; S.whyAt = t;
      if (!S.calibrating && !S.noteCal) status(text || READY_TEXT);
    }

    // ---- Starting and stopping ----
    async function start() {
      if (S.running) return { ok: true };
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const message = 'This browser is blocking the microphone here. Open the hosted (https) link of this page; on iPhone, use Safari. On a computer, opening the file in Chrome also works.';
        status(message); return { ok: false, message: message };
      }
      // iPhones and iPads only let audio start during the tap itself, so the audio engine is created and
      // started here, BEFORE waiting for microphone permission (after the wait, the tap no longer counts).
      const AC = window.AudioContext || window.webkitAudioContext;
      S.ctx = new AC();
      if (S.ctx.state === 'suspended' && S.ctx.resume) S.ctx.resume().catch(() => {});
      try {
        // The phone/computer "voice cleanup" features distort music, so they are turned off.
        S.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
      } catch (err) {
        if (S.ctx && S.ctx.close) S.ctx.close();
        S.ctx = null;
        let message;
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          message = 'The browser blocked the microphone. If this page is open inside a preview pane or an embedded window, ' +
            'download the files and open the page directly in Chrome, or use the hosted version. Otherwise, allow the ' +
            'microphone in the site settings (the icon left of the address bar) and try again.';
        } else if (err.name === 'NotFoundError') {
          message = 'No microphone was found. Check that one is plugged in and selected in your system sound settings.';
        } else if (err.name === 'NotReadableError') {
          message = 'The microphone is busy or unavailable. Close other apps that might be using it (Zoom, a recorder) and try again.';
        } else {
          message = `Could not start the microphone (${err.name}: ${err.message}).`;
        }
        status(message);
        return { ok: false, message: message };
      }
      if (S.ctx.state === 'suspended' && S.ctx.resume) S.ctx.resume().catch(() => {});
      const source = S.ctx.createMediaStreamSource(S.stream);
      const analyser = S.ctx.createAnalyser();
      analyser.fftSize = 8192;                   // about 0.17 s of sound: room to see a note's attack
      source.connect(analyser);                  // not connected to the speakers, so no echo
      useSource(analyser, S.ctx.sampleRate);
      S.timer = setInterval(tick, FRAME_MS);
      return { ok: true };
    }

    // Any object with getFloatTimeDomainData(array) works as a source (tests feed recorded sound this way).
    function useSource(analyser, sampleRate) {
      S.analyser = analyser; S.sampleRate = sampleRate;
      S.buf = new Float32Array(analyser.fftSize || 8192);
      S.running = true; S.why = '';
      resetNote();
      S.lastAnswered = null; S.lastAnswerTime = -1e9; S.lastOnset = -1e9; S.pausedUntil = 0;
      calibrateRoom();
    }

    function stop() {
      if (S.timer) clearInterval(S.timer);
      if (S.stream) S.stream.getTracks().forEach(t => t.stop());
      if (S.ctx && S.ctx.close) S.ctx.close();
      Object.assign(S, { running: false, timer: null, stream: null, ctx: null, analyser: null, calibrating: false, noteCal: null, why: '' });
      emit('level', { rms: 0, gate: S.gate });
      emit('hearing', null);
      status('');
    }

    function resetNote() { S.candidate = null; S.pitches = []; S.unclear = 0; }

    // ---- Room calibration: about a second of quiet ----
    function calibrateRoom() {
      if (!S.running) return;
      S.calibrating = true; S.noteCal = null; S.calSamples = [];
      resetNote();
      status('Calibrating... stay quiet for a second.');
    }
    function finishRoom() {
      const r = gateFromNoise(S.calSamples);
      S.gate = r.gate; S.floor = r.floor; S.calibrating = false;
      const message = r.tooLoud
        ? 'It is quite noisy here. Move closer to your instrument or find a quieter spot, then press "Re-measure room".'
        : READY_TEXT + ' If it does not hear you, press "Calibrate with my instrument".';
      S.why = '';
      status(message);
      emit('calibrated', { kind: 'room', ok: !r.tooLoud, message: message, gate: S.gate, floor: S.floor });
    }

    // ---- Instrument calibration: play one note and hold it about 2 seconds ----
    // The gate is set between the room noise and how loud the note still is one second after it started.
    function calibrateInstrument() {
      if (!S.running || S.calibrating) return false;
      S.noteCal = { floor: S.floor, waited: 0, started: false, frames: [], attack: false };
      resetNote(); S.why = '';
      status('Play one note on your instrument and hold it for about 2 seconds...');
      return true;
    }
    function noteCalStep(rms, recent) {
      const nc = S.noteCal;
      if (!nc.started) {
        nc.waited += FRAME_MS;
        if (rms > Math.max(2 * nc.floor, 0.003)) nc.started = true;
        else {
          if (nc.waited >= NOTE_CAL_WAIT_MS) endNoteCal(false, "I didn't hear anything. Check that the right microphone is selected in your computer's sound settings, then try again.");
          return;
        }
      }
      if (detectOnsets(S.buf, S.sampleRate, Math.max(0.005, 3 * nc.floor) * 1.5).length) nc.attack = true;
      const r = yinDetect(recent, S.sampleRate);
      nc.frames.push({ rms: rms, clarity: r ? r.clarity : 0, midi: r ? Math.round(69 + 12 * Math.log2(r.freq / 440)) : null });
      if (nc.frames.length >= NOTE_CAL_FRAMES) finishNoteCal();
    }
    function finishNoteCal() {
      const nc = S.noteCal, f = nc.frames;
      const median = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
      const held = median(f.slice(16, 25).map(x => x.rms));      // how loud it still is about one second in
      let best = { len: 0, midi: null, clarity: 0 }, run = null;
      f.forEach(x => {
        const clear = x.midi !== null && x.clarity >= MIN_CLARITY;
        if (clear && run && run.midi === x.midi) { run.len++; run.sum += x.clarity; }
        else run = clear ? { midi: x.midi, len: 1, sum: x.clarity } : null;
        if (run && run.len > best.len) best = { len: run.len, midi: run.midi, clarity: run.sum / run.len };
      });
      if (held < 1.5 * nc.floor) {
        endNoteCal(false, `I could barely hear that note one second after you played it (level ${held.toFixed(3)}, room noise ${nc.floor.toFixed(3)}). ` +
          "Move the microphone closer to your instrument, or raise the microphone volume in your computer's sound settings, then try again.");
        return;
      }
      S.gate = Math.min(0.06, Math.max(0.003, 1.5 * nc.floor, Math.sqrt(nc.floor * held)));
      const parts = [];
      if (best.len >= 5) parts.push(`Heard ${Engine.pitchLabel(best.midi)} steadily for ${(best.len * FRAME_MS / 1000).toFixed(1)} seconds (${Math.round(best.clarity * 100)}% sure).`);
      else parts.push('I could hear it, but not as one clear note. Play a single string (or key) and keep the microphone close.');
      if (S.filter === 'strict' && !nc.attack) {
        S.filter = 'any';
        emit('filter', 'any');
        parts.push('That note did not start sharply enough for "plucked or struck notes only", so I switched the Sound filter to "Any sound".');
      }
      parts.push('Microphone is set up for your instrument.');
      endNoteCal(true, parts.join(' '));
    }
    function endNoteCal(ok, message) {
      S.noteCal = null;
      resetNote();
      S.lastAnswered = null; S.lastOnset = -1e9;
      S.pausedUntil = now() + 400;
      S.why = '';
      status(message);
      emit('calibrated', { kind: 'instrument', ok: ok, message: message, gate: S.gate });
    }

    // ---- 20 times a second ----
    function tick() {
      if (!S.analyser) return;
      S.dbg = { gate: S.gate };
      S.analyser.getFloatTimeDomainData(S.buf);
      const recent = S.buf.subarray(S.buf.length - 4096);       // newest 4096 samples, used for pitch
      let sum = 0;
      for (let i = 0; i < recent.length; i++) sum += recent[i] * recent[i];
      const rms = Math.sqrt(sum / recent.length);
      S.dbg.rms = rms;
      emit('level', { rms: rms, gate: S.gate });
      const t = now();

      if (S.calibrating) {
        S.calSamples.push(rms);
        if (S.calSamples.length >= CAL_FRAMES) finishRoom();
        return;
      }
      if (S.noteCal) { noteCalStep(rms, recent); return; }
      if (S.paused) { resetNote(); emit('hearing', null); return; }

      const strict = S.filter === 'strict';
      if (strict) {
        detectOnsets(S.buf, S.sampleRate, S.gate * 1.5).forEach(index => {
          const startedAt = t - ((S.buf.length - index) / S.sampleRate) * 1000;
          if (startedAt - S.lastOnset > 100) S.lastOnset = startedAt;   // the same attack seen twice counts once
        });
      }
      if (t < S.pausedUntil) return;                           // brief pause after an answer

      // Quiet. After 0.3 s of quiet, the same note may count again.
      if (rms < S.gate) {
        S.quietMs += FRAME_MS;
        if (S.quietMs >= 300) S.lastAnswered = null;
        resetNote();
        emit('hearing', null);
        if (rms >= 0.5 * S.gate && t - S.lastAnswerTime > 1500) {
          setWhy('That is almost too quiet for me to hear. Play a little louder or closer to the microphone, or press "Calibrate with my instrument".');
        } else setWhy('');
        return;
      }
      S.quietMs = 0;

      const result = yinDetect(recent, S.sampleRate);
      if (!result || result.clarity < MIN_CLARITY) {
        S.candidate = null; S.pitches = [];
        S.unclear++;
        if (S.unclear >= 6) setWhy('I can hear a sound but not a clear note. Play one string (or key) at a time and keep the microphone close.');
        return;
      }
      S.unclear = 0;

      const exactPitch = 69 + 12 * Math.log2(result.freq / 440);   // MIDI number with decimals
      const midi = Math.round(exactPitch);
      Object.assign(S.dbg, { freq: result.freq, clarity: result.clarity, midi: midi, cents: Math.round((exactPitch - midi) * 100) });
      emit('hearing', midi);

      // The same note has to hold steady for a moment before it counts.
      if (midi === S.candidate) {
        S.pitches.push(exactPitch);
        if (S.pitches.length > STABLE_FRAMES) S.pitches.shift();
      } else { S.candidate = midi; S.pitches = [exactPitch]; }

      const heldLongEnough = S.pitches.length >= STABLE_FRAMES;
      const steady = !strict || steadyPitch(S.pitches, MAX_PITCH_SPREAD);
      const newAttack = S.lastOnset > S.lastAnswerTime && t - S.lastOnset <= ONSET_WINDOW_MS;
      const attacked = !strict || newAttack;
      // A note still ringing from the last answer does not count again; plucking it again does.
      const fresh = midi !== S.lastAnswered || (strict && newAttack);
      S.dbg.attack = attacked;

      if (heldLongEnough && fresh) {
        if (!steady) setWhy('The pitch is wobbling too much for "plucked or struck notes only". Play it steadily, or switch the Sound filter to "Any sound".');
        else if (!attacked) setWhy('I hear a steady note but not a sharp pluck or strike. Pluck or strike it again, or switch the Sound filter to "Any sound".');
        else setWhy('');
      }
      if (heldLongEnough && steady && attacked && fresh) accept(midi);
    }

    function accept(midi) {
      S.lastAnswered = midi;
      S.lastAnswerTime = now();
      setWhy('', true);
      resetNote();
      const result = o.onNote ? o.onNote(midi) : null;
      S.pausedUntil = now() + (result === true ? 300 : 650);
      emit('note', { midi: midi, result: result });
    }

    function setFilter(f) { S.filter = f === 'any' ? 'any' : 'strict'; emit('filter', S.filter); }
    function setPaused(p) { S.paused = !!p; if (!p) { resetNote(); S.pausedUntil = now() + 300; } }

    return {
      on, start, stop, useSource, tick, calibrateRoom, calibrateInstrument, setFilter, setPaused,
      get running() { return S.running; }, get filter() { return S.filter; }, get gate() { return S.gate; },
      get status() { return S.lastStatus; }, get busy() { return S.calibrating || !!S.noteCal; }, get debug() { return S.dbg; }
    };
  }

  return { createListener, yinDetect, detectOnsets, steadyPitch, gateFromNoise, FRAME_MS, STABLE_FRAMES, READY_TEXT };
});
