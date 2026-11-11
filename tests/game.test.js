// Tests for js/heart-defense-game.js by simulating whole games.   Run: node tests/game.test.js
const E = require('../js/music-engine.js');
const HD = require('../js/heart-defense-game.js');
let pass = 0, fail = 0;
const ok = (c, label) => { c ? pass++ : (fail++, console.log('FAIL:', label)); };
const DT = 1 / 60;
const run = (g, seconds, each) => { for (let t = 0; t < seconds; t += DT) { g.update(DT); if (each) each(g); if (g.state.phase === 'over') break; } };
const correctChoice = b => b.choices.find(c => E.isCorrectChoice(b.note, c));
const wrongChoice = b => b.choices.find(c => !E.isCorrectChoice(b.note, c) && !b.wrong.includes(E.noteName(c)));

// 1. Start, first wave, first bubble
{
  const g = HD.createGame({ rng: E.makeRng(1) });
  const events = []; ['wave', 'playing', 'spawn'].forEach(t => g.on(t, () => events.push([t, +g.state.time.toFixed(2)])));
  ok(g.answer({ letter: 'c', acc: '' }) === null, 'answering before start does nothing');
  g.start();
  ok(g.state.phase === 'break' && g.state.health === 3, 'starts in the wave-1 break with 3 hearts');
  run(g, 3);
  const playing = events.find(e => e[0] === 'playing'), spawned = events.find(e => e[0] === 'spawn');
  ok(playing && Math.abs(playing[1] - 1.5) < 0.05, `play starts after 1.5 s (${playing && playing[1]})`);
  ok(spawned && spawned[1] - playing[1] <= 0.65, `first bubble arrives quickly (${spawned && (spawned[1] - playing[1]).toFixed(2)} s)`);
  const b = g.state.bubbles[0];
  ok(b && b.clef === 'treble' && b.choices.length === 4, 'bubble has a treble note and 4 choices');
  const r = E.noteToMidi(b.note); ok(r >= 64 && r <= 77, 'wave 1 notes are on the staff (E4 to F5)');
}

// 2. Doing nothing: bubbles reach the heart, three hits end the game
{
  const g = HD.createGame({ rng: E.makeRng(2) });
  const hits = []; let over = null;
  g.on('hit', () => hits.push(+g.state.time.toFixed(2))); g.on('over', s => { over = s; });
  g.start(); run(g, 120);
  ok(hits.length === 3 && g.state.health === 0 && g.state.phase === 'over', `three hits end the game (${hits.length} hits)`);
  const firstTravel = hits[0] - 1.5 - 0.6;
  ok(Math.abs(firstTravel - 14) < 0.2, `wave-1 bubble takes about 14 s to reach the heart (${firstTravel.toFixed(2)})`);
  ok(over && over.missed === 3 && over.correct === 0 && over.accuracy === 0, 'summary counts the misses');
  const t = g.state.time; g.update(1); ok(g.state.time === t, 'nothing moves after game over');
}

// 3. A perfect player never loses health, waves advance, multiplier and bonus work
{
  const g = HD.createGame({ rng: E.makeRng(3) });
  const pops = [], waves = []; let heals = 0, bonuses = 0;
  g.on('pop', p => pops.push(p)); g.on('wave', w => waves.push(w.number)); g.on('heal', () => heals++); g.on('bonus', () => bonuses++);
  let maxAlive = 0;
  g.start();
  run(g, 240, gg => {
    maxAlive = Math.max(maxAlive, gg.state.bubbles.length);
    const t = gg.target(); if (t && t.age > 1.0) ok(gg.answer(correctChoice(t)) === true, 'correct answer accepted');
  });
  ok(g.state.health === 3 && g.state.stats.missed === 0, 'perfect player keeps 3 hearts');
  ok(waves[waves.length - 1] >= 5, `waves advance (reached wave ${waves[waves.length - 1]})`);
  ok(pops[3].points === 100 && pops[4].points === 200 && pops[9].points === 300, 'points: x1, then x2 from 5 in a row, x3 from 10');
  ok(heals === 0 && bonuses >= 1, `at full health a 10-streak gives bonus points (${bonuses} bonuses)`);
  ok(g.summary().accuracy === 1, '100% accuracy');
  console.log(`  perfect player: ${g.state.stats.correct} pops, wave ${g.state.wave.number}, score ${g.state.stats.score}, most bubbles at once ${maxAlive}`);
}

// 4. Wrong answers: the bubble keeps coming, the same wrong name is not counted twice, streak resets
{
  const g = HD.createGame({ rng: E.makeRng(4) });
  g.start(); run(g, 2.5);
  const b = g.target(); const before = b.progress;
  g.state.stats.streak = 3;
  const w = wrongChoice(b);
  ok(g.answer(w) === false, 'wrong answer returns false');
  ok(g.state.bubbles.includes(b) && g.state.stats.incorrect === 1 && g.state.stats.streak === 0, 'bubble stays, incorrect counted, streak reset');
  ok(g.answer(w) === null && g.state.stats.incorrect === 1, 'same wrong name again is ignored');
  run(g, 1); ok(b.progress > before, 'bubble keeps moving after a wrong answer');
  ok(g.answer(correctChoice(b)) === true && !g.state.bubbles.includes(b), 'then the right answer pops it');
}

// 5. Healing: lose a heart, then 10 in a row gives it back
{
  const g = HD.createGame({ rng: E.makeRng(5) });
  let healed = false, healthAtHeal = null; g.on('heal', () => { healed = true; healthAtHeal = g.state.health; });
  g.start(); run(g, 1.6);
  g.state.health = 2;
  run(g, 200, gg => { const t = gg.target(); if (t && !healed) gg.answer(correctChoice(t)); });
  ok(healed && healthAtHeal === 3, `a streak of 10 restores a heart (health ${healthAtHeal})`);
}

// 6. Never more bubbles than the wave allows; wave settings get harder
{
  for (let n = 1; n <= 12; n++) {
    const a = HD.waveConfig(n), b = HD.waveConfig(n + 1);
    ok(b.travel <= a.travel && b.spawnEvery <= a.spawnEvery && b.count >= a.count && b.maxOnScreen >= a.maxOnScreen, `wave ${n + 1} is not easier than wave ${n}`);
  }
  ok(HD.waveConfig(40).travel >= 5.5 && HD.waveConfig(40).spawnEvery >= 0.9 && HD.waveConfig(40).maxOnScreen <= 6, 'difficulty has limits');
  ok(HD.waveConfig(4).range === 'treble-ledger' && HD.waveConfig(7).range === 'treble-wide', 'ledger lines arrive in later waves');
  const g = HD.createGame({ rng: E.makeRng(6) });
  g.start();
  let worst = 0;
  run(g, 300, gg => {
    if (gg.state.phase === 'playing') worst = Math.max(worst, gg.state.bubbles.length - gg.state.wave.maxOnScreen);
    const t = gg.target(); if (t && t.progress > 0.5) gg.answer(correctChoice(t));      // slow player
  });
  ok(worst <= 0, 'never more bubbles on screen than the wave allows');
}

// 7. Targeting: closest by default, a tapped bubble sticks, then back to closest
{
  const g = HD.createGame({ rng: E.makeRng(8) });
  g.start(); run(g, 1.6);
  run(g, 8);                                  // let a second bubble appear
  ok(g.state.bubbles.length >= 2, 'two bubbles on screen');
  const [first, second] = g.state.bubbles;
  ok(g.target() === first, 'the bubble closest to the heart is the target');
  g.setTarget(second.id); ok(g.target() === second, 'tapping another bubble targets it');
  g.answer(correctChoice(second)); ok(g.target() === first, 'after it pops, the closest one is targeted again');
}

// 8. Microphone answers (for later): checked by sound, guitar sounds an octave lower
{
  const g = HD.createGame({ rng: E.makeRng(9), instrument: 'guitar' });
  g.start(); run(g, 2.5);
  const b = g.target();
  const sounding = E.soundingMidi(b.note, 'guitar');
  ok(g.answerPitch(sounding + 1) === false, 'wrong pitch is wrong');
  ok(g.answerPitch(sounding, { exactOctave: true }) === true && !g.state.bubbles.includes(b), 'right pitch pops the bubble');
}

// 9. Pause, and answers between waves
{
  const g = HD.createGame({ rng: E.makeRng(10) });
  g.start(); run(g, 2.5);
  g.setPaused(true); const p = g.state.bubbles[0].progress, t = g.state.time;
  run(g, 5); ok(g.state.bubbles[0].progress === p && g.state.time === t, 'paused: nothing moves');
  ok(g.answer(correctChoice(g.target())) === null, 'paused: answers ignored');
  g.setPaused(false); run(g, 0.5); ok(g.state.bubbles[0].progress > p, 'unpaused: moving again');
  const g2 = HD.createGame({ rng: E.makeRng(11) }); g2.start();
  ok(g2.answer({ letter: 'c', acc: '' }) === null, 'no answers during the wave break');
}

// 10. A realistic 75%-accurate player: the game ends and the numbers add up
{
  const rng = E.makeRng(12);
  const g = HD.createGame({ rng: E.makeRng(13) });
  let summary = null; g.on('over', s => { summary = s; });
  g.start();
  let cooldown = 0;
  run(g, 1200, gg => {
    cooldown -= DT; const t = gg.target();
    if (t && cooldown <= 0 && t.age > 1.2) { gg.answer(rng() < 0.75 ? correctChoice(t) : wrongChoice(t)); cooldown = 1.0; }
  });
  ok(summary !== null, 'the game ends eventually');
  if (summary) {
    ok(Math.abs(summary.accuracy - summary.correct / (summary.correct + summary.incorrect)) < 1e-9, 'accuracy = correct / answers');
    ok(summary.missed >= 3, 'game over after missing at least 3 (healing can add more)');
    console.log(`  75% player: lasted ${summary.time.toFixed(0)} s, wave ${summary.wave}, ${summary.correct} right, ${summary.incorrect} wrong, ${summary.missed} missed, best streak ${summary.bestStreak}, score ${summary.score}`);
  }
}


// 11. Microphone answers with matchAny: the note played picks the bubble
{
  const g = HD.createGame({ rng: E.makeRng(21), instrument: 'guitar' });
  g.start(); run(g, 1.6);
  run(g, 8);
  const [first, second] = g.state.bubbles;
  ok(first && second, 'two bubbles on screen for matchAny');
  if (first && second) {
    // make the notes different letters so the test is clear
    first.note = E.parse('c5'); second.note = E.parse('g4');
    const heardOpenG = E.soundingMidi(second.note, 'guitar');          // open G string, 55
    ok(g.target() === first, 'the first bubble is the target');
    ok(g.answerPitch(heardOpenG, { matchAny: true }) === true, 'playing G pops the G bubble even though it is not the target');
    ok(!g.state.bubbles.includes(second) && g.state.bubbles.includes(first), 'only the G bubble popped');
    let wrongEvent = null; g.on('wrong', w => { wrongEvent = w; });
    ok(g.answerPitch(E.noteToMidi(E.parse('f3')), { matchAny: true }) === false, 'a note no bubble has is wrong');
    ok(wrongEvent && wrongEvent.heard === 'F' && wrongEvent.label === null && first.wrong.length === 0, 'wrong event says what was heard, nothing crossed out');
    ok(g.answerPitch(E.soundingMidi(first.note, 'guitar') + 12, { matchAny: true }) === true, 'any octave is accepted by default');
  }
}

// 12. Speed settings stretch the waves
{
  const wave1 = pace => { const g = HD.createGame({ rng: E.makeRng(30), pace }); g.start(); return g.state.wave; };
  const n = wave1('normal'), r = wave1('relaxed'), f = wave1('fast'), d = wave1(undefined);
  ok(Math.abs(r.travel - 22.4) < 1e-9 && Math.abs(r.spawnEvery - 5.12) < 1e-9 && r.maxOnScreen === 1, `relaxed wave 1: 22.4 s, every 5.1 s, one at a time (${r.travel}, ${r.spawnEvery}, ${r.maxOnScreen})`);
  ok(n.travel === 14 && n.maxOnScreen === 2 && d.travel === 14, 'normal (and the default) keep the table values');
  ok(Math.abs(f.travel - 11.2) < 1e-9, 'fast is quicker');
  ok(HD.WAVES[0].travel === 14, 'the difficulty table itself is not changed');
  const g = HD.createGame({ rng: E.makeRng(31), pace: 'relaxed' });
  const hits = []; g.on('hit', () => hits.push(g.state.time)); g.start();
  for (let t = 0; t < 40; t += 1 / 60) g.update(1 / 60);
  ok(hits.length >= 1 && Math.abs(hits[0] - 1.5 - 0.6 - 22.4) < 0.2, `relaxed: an untouched bubble takes about 22 s (${hits[0] && (hits[0] - 2.1).toFixed(1)})`);
  let maxAlive = 0; const g2 = HD.createGame({ rng: E.makeRng(32), pace: 'relaxed' }); g2.start();
  for (let t = 0; t < 60; t += 1 / 60) { g2.update(1 / 60); if (g2.state.wave.number === 1) maxAlive = Math.max(maxAlive, g2.state.bubbles.length); }
  ok(maxAlive === 1, 'relaxed wave 1 has one bubble at a time');
}

// 13. Exact octave with the microphone
{
  const g = HD.createGame({ rng: E.makeRng(33), instrument: 'guitar' });
  g.start(); for (let t = 0; t < 2.5; t += 1 / 60) g.update(1 / 60);
  const b = g.target(); b.note = E.parse('g4');                     // written G4 on guitar = open G string (55)
  let w = null; g.on('wrong', x => { w = x; });
  ok(g.answerPitch(67, { matchAny: true, exactOctave: true }) === false, 'exact octave: G an octave too high is wrong');
  ok(w && w.wrongOctave === true && w.heard === 'G' && w.bubble === b, 'it is reported as the right note in the wrong octave');
  w = null;
  ok(g.answerPitch(57, { matchAny: true, exactOctave: true }) === false && w && w.wrongOctave === false, 'a different note is just wrong');
  ok(g.answerPitch(55, { matchAny: true, exactOctave: true }) === true && !g.state.bubbles.includes(b), 'the open G string pops it');
  const g2 = HD.createGame({ rng: E.makeRng(34), instrument: 'guitar' });
  g2.start(); for (let t = 0; t < 2.5; t += 1 / 60) g2.update(1 / 60);
  g2.target().note = E.parse('g4');
  ok(g2.answerPitch(67, { matchAny: true }) === true, 'without exact octave, any octave still counts');
}

console.log(`Game tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
