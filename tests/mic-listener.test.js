// Tests for js/mic-listener.js.   Run: node tests/mic-listener.test.js
// 1) its pitch detection and filters give exactly the trainer's results; 2) the whole listener, fed recorded sound.
const fs = require('fs'), path = require('path');
const M = require('../js/mic-listener.js');
let pass = 0, fail = 0;
const ok = (c, label) => { c ? pass++ : (fail++, console.log('FAIL:', label)); };

let seed = 777;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const SR = 48000;
const GUITAR = [0.7, 1, 0.6, 0.35, 0.2], NORM = 2.85;

// ---- 1. Same results as the trainer ----
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const T = new Function(html.match(/\/\/ BEGIN YIN([\s\S]*?)\/\/ END YIN/)[1] + html.match(/\/\/ BEGIN FILTERS([\s\S]*?)\/\/ END FILTERS/)[1] +
  '; return { yinDetect, detectOnsets, steadyPitch, gateFromNoise };')();
let compared = 0;
for (let k = 0; k < 300; k++) {
  const buf = new Float32Array(8192), f = 70 + rnd() * 900, amp = rnd() * 0.3, noise = rnd() * 0.02, start = Math.floor(rnd() * 6000);
  for (let i = 0; i < buf.length; i++) {
    const t = (i - start) / SR;
    buf[i] = noise * gauss() + (i >= start ? amp * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.8) * Math.min(1, t / 0.003) : 0);
  }
  ok(JSON.stringify(M.yinDetect(buf.subarray(4096), SR)) === JSON.stringify(T.yinDetect(buf.subarray(4096), SR)), 'yinDetect matches trainer');
  const gate = 0.005 + rnd() * 0.02;
  ok(JSON.stringify(M.detectOnsets(buf, SR, gate)) === JSON.stringify(T.detectOnsets(buf, SR, gate)), 'detectOnsets matches trainer');
  const samples = Array.from({ length: 20 }, () => rnd() * 0.02);
  ok(JSON.stringify(M.gateFromNoise(samples)) === JSON.stringify(T.gateFromNoise(samples)), 'gateFromNoise matches trainer');
  const ps = Array.from({ length: 5 }, () => 60 + rnd());
  ok(M.steadyPitch(ps, 0.4) === T.steadyPitch(ps, 0.4), 'steadyPitch matches trainer');
  compared++;
}
console.log(`  pitch detection and filters identical to the trainer on ${compared} random sounds`);

// ---- 2. The listener, fed a "recording" through a fake microphone and a fake clock ----
function recording(seconds, events, noise = 0.003) {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = noise * gauss();
  for (const e of events) {
    const s0 = Math.round(e.at * SR); let phase = 0;
    for (let j = 0; s0 + j < x.length && j < (e.dur || seconds) * SR; j++) {
      const t = j / SR; let v = 0;
      if (e.kind === 'pluck') {
        GUITAR.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * e.hz * (k + 1) * t); });
        v *= (e.amp / NORM) * Math.min(1, t / 0.003) * Math.exp(-t / (e.tau || 0.8));
      } else if (e.kind === 'sung') {
        phase += 2 * Math.PI * e.hz * Math.pow(2, 30 * Math.sin(2 * Math.PI * 5.5 * t) / 1200) / SR;
        GUITAR.forEach((a, k) => { v += a * Math.sin((k + 1) * phase); });
        v *= (e.amp / NORM) * (t < 0.15 ? 0.5 * (1 - Math.cos(Math.PI * t / 0.15)) : 1);
      } else v = e.amp * gauss();
      x[s0 + j] += v;
    }
  }
  return x;
}
// Run a listener over a recording. actions: [{ at: seconds, do: listener => ... }]
function listen(signal, { filter = 'strict', onNote = () => true, actions = [] } = {}) {
  let clock = 0;
  const notes = [], statuses = [], cal = [];
  const L = M.createListener({ filter, onNote, now: () => clock });
  L.on('note', n => notes.push({ midi: n.midi, t: clock / 1000 }));
  L.on('status', s => statuses.push(s));
  L.on('calibrated', c => cal.push(c));
  const src = { fftSize: 8192, getFloatTimeDomainData(a) { const e = Math.round(clock / 1000 * SR); for (let i = 0; i < a.length; i++) { const k = e - a.length + i; a[i] = k >= 0 && k < signal.length ? signal[k] : 0; } } };
  L.useSource(src, SR);
  const pending = actions.slice();
  for (clock = 0; clock <= signal.length / SR * 1000; clock += 50) {
    while (pending.length && pending[0].at * 1000 <= clock) pending.shift().do(L);
    L.tick();
  }
  return { L, notes, statuses, cal };
}
const G3 = 195.998, A3 = 220, C4 = 261.626;

// A pluck is heard once, quickly, as the right note; the ringing note does not count again.
{
  const r = listen(recording(5, [{ kind: 'pluck', at: 1.5, hz: G3, amp: 0.3 }]));
  ok(r.cal.length === 1 && r.cal[0].kind === 'room', 'room calibration runs first');
  ok(r.notes.length === 1 && r.notes[0].midi === 55, `one G3 pluck = one G3 note (${JSON.stringify(r.notes)})`);
  ok(r.notes[0] && r.notes[0].t - 1.5 < 0.45, 'heard within half a second');
}
// Plucking the SAME note again counts again (two bubbles can carry the same note).
{
  const r = listen(recording(6, [{ kind: 'pluck', at: 1.5, hz: G3, amp: 0.3 }, { kind: 'pluck', at: 2.6, hz: G3, amp: 0.3 }]));
  ok(r.notes.length === 2 && r.notes.every(n => n.midi === 55), `re-plucking G counts twice (${r.notes.length})`);
}
// Three different notes in a row.
{
  const r = listen(recording(7, [{ kind: 'pluck', at: 1.5, hz: G3, amp: 0.3 }, { kind: 'pluck', at: 2.6, hz: A3, amp: 0.3 }, { kind: 'pluck', at: 3.7, hz: C4, amp: 0.3 }]));
  ok(JSON.stringify(r.notes.map(n => n.midi)) === '[55,57,60]', `G, A, C heard in order (${r.notes.map(n => n.midi)})`);
}
// A wrong answer pauses a little longer, then listens again.
{
  const r = listen(recording(6, [{ kind: 'pluck', at: 1.5, hz: A3, amp: 0.3 }, { kind: 'pluck', at: 2.8, hz: G3, amp: 0.3 }]), { onNote: m => m === 55 });
  ok(r.notes.length === 2, 'after a wrong note, the next note is still heard');
}
// Strict filter ignores singing and hiss, and says why; "any sound" accepts singing.
{
  const sung = recording(6, [{ kind: 'sung', at: 1.5, dur: 3, hz: A3, amp: 0.3 }]);
  const strict = listen(sung);
  ok(strict.notes.length === 0, 'strict: singing is ignored');
  ok(strict.statuses.some(s => /sharp pluck|wobbling/.test(s)), 'strict: says why the singing was ignored');
  const any = listen(sung, { filter: 'any' });
  ok(any.notes.length >= 1 && any.notes[0].midi === 57, 'any sound: singing counts');
  const hiss = listen(recording(6, [{ kind: 'noise', at: 1.5, dur: 3, amp: 0.05 }]));
  ok(hiss.notes.length === 0 && hiss.statuses.some(s => /not a clear note/.test(s)), 'hiss: ignored, says no clear note');
}
// Paused: nothing counts.
{
  const r = listen(recording(5, [{ kind: 'pluck', at: 1.5, hz: G3, amp: 0.3 }]), { actions: [{ at: 1.2, do: L => L.setPaused(true) }] });
  ok(r.notes.length === 0, 'paused: notes are not counted');
}
// Quiet guitar: not heard with the room gate alone, heard after "Calibrate with my instrument".
{
  const quietPluck = (at) => ({ kind: 'pluck', at, hz: G3, amp: 0.05 });
  const before = listen(recording(6, [quietPluck(2)], 0.004));
  ok(before.notes.length === 0, 'quiet guitar is missed with only the room measured');
  const after = listen(recording(10, [quietPluck(2.0), quietPluck(6.0)], 0.004), { actions: [{ at: 1.5, do: L => L.calibrateInstrument() }] });
  const instr = after.cal.find(c => c.kind === 'instrument');
  ok(instr && instr.ok && /Heard G/.test(instr.message), `instrument calibration reports what it heard (${instr && instr.message})`);
  ok(after.notes.length === 1 && after.notes[0].midi === 55 && after.notes[0].t > 5.9, 'after calibrating, the quiet G is heard');
}
// Instrument calibration switches to "any sound" when the note has no sharp start (e.g. a singer).
{
  const filters = [];
  const r = listen(recording(6, [{ kind: 'sung', at: 2, dur: 3, hz: A3, amp: 0.2 }]), { actions: [{ at: 1.5, do: L => { L.on('filter', f => filters.push(f)); L.calibrateInstrument(); } }] });
  ok(filters.includes('any') && r.L.filter === 'any', 'calibrating with a smooth sound switches the filter to "any sound"');
}

console.log(`Microphone listener tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
