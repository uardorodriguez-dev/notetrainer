// HEART DEFENSE: SCREEN
// Draws the game and handles taps and keys. All the rules live in heart-defense-game.js; this file only
// shows what the game state says and passes answers in through game.answer() and game.setTarget().
(function () {
  const Engine = window.MusicEngine, HD = window.HeartDefense, Staff = window.StaffSVG;
  const $ = id => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORS = { target: '#7fe7ff', good: '#5ee6a8', bad: '#ff6b6b', heart: '#ff3b4e', text: '#eef2ff' };

  let game = null;
  let viewTime = 0;                 // seconds since the page opened (for animations)
  const effects = [];               // pops, floating text
  const shakes = new Map();         // bubble id -> time its "wrong" shake started
  let heartHitAt = -10, heartHealAt = -10;

  // ---------- Canvas and layout ----------
  const canvas = $('arena'), ctx = canvas.getContext('2d');
  const L = {};
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    L.w = rect.width; L.h = rect.height;
    canvas.width = Math.max(1, Math.round(L.w * dpr)); canvas.height = Math.max(1, Math.round(L.h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const minHalf = Math.min(L.w, L.h) / 2;
    L.cx = L.w / 2; L.cy = L.h / 2;
    L.bubbleR = clamp(minHalf * 0.27, 40, 92);       // big enough to read the staff on a phone
    L.heartR = clamp(minHalf * 0.2, 28, 84);
    L.contactR = L.heartR + L.bubbleR * 0.45;         // where a bubble touches the heart
    // Bubbles start on an oval that fills the play area, fully inside it (short screens get a flatter oval).
    L.spawnRx = Math.max(L.w / 2 - L.bubbleR * 1.02, L.contactR + L.bubbleR * 0.3);
    L.spawnRy = Math.max(L.h / 2 - L.bubbleR * 1.02, L.contactR + L.bubbleR * 0.3);
  }
  window.addEventListener('resize', resize);

  // Where a bubble is on screen: from the spawn oval (progress 0) to touching the heart (progress 1).
  function bubblePos(b) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle), p = Math.min(1, b.progress);
    return { x: L.cx + (L.spawnRx * (1 - p) + L.contactR * p) * c, y: L.cy + (L.spawnRy * (1 - p) + L.contactR * p) * s };
  }

  // ---------- Pictures ----------
  // Each video is decoded once and drawn wherever it is needed. Their black backgrounds disappear because
  // they are drawn in "screen" mode (black adds nothing). If a video can't play, simple drawn shapes are used.
  // base is a path without extension: MP4 where the browser plays it (Chrome, Safari, Edge), WebM otherwise.
  function makeVideo(base) {
    const v = document.createElement('video');
    v.className = 'frames'; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
    v.src = base + (v.canPlayType('video/mp4; codecs="avc1.42E01E"') ? '.mp4' : '.webm');
    document.body.appendChild(v);
    const tryPlay = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
    tryPlay();
    window.addEventListener('pointerdown', tryPlay, { once: true });
    return v;
  }
  const heartVideo = makeVideo('assets/heart');
  const bubbleVideo = makeVideo('assets/bubble');
  const playable = v => v.readyState >= 2 && v.videoWidth > 0;

  // The heart video has faint stars around it; a soft round mask keeps only the heart and its glow.
  const heartLayer = document.createElement('canvas'), hctx = heartLayer.getContext('2d');

  const staffImages = new Map();
  function staffImage(note, clef) {
    const key = clef + ':' + note.letter + note.acc + note.octave;
    let img = staffImages.get(key);
    if (!img) {
      img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(Staff.staffSVG(note, clef, { size: 300 }));
      staffImages.set(key, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  // ---------- Drawing ----------
  function drawBackground() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#04060b';
    ctx.fillRect(0, 0, L.w, L.h);
    // A soft glow behind the heart that fades out before the edges, so no box edge shows. Turns red at 1 heart left.
    const g = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, Math.min(L.w, L.h) * 0.62);
    const danger = game && game.state.health === 1 ? 0.10 + 0.05 * Math.sin(viewTime * 4) : 0;
    const rgb = danger ? '120,20,40' : '40,60,110';
    g.addColorStop(0, `rgba(${rgb}, ${0.18 + danger})`);
    g.addColorStop(0.6, `rgba(${rgb}, ${0.06 + danger / 3})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.w, L.h);
  }

  function drawHeart() {
    const sinceHit = viewTime - heartHitAt;
    const health = game ? game.state.health : 3;
    const beatRate = health === 1 ? 2.2 : 1.1;
    const beat = reduceMotion ? 1 : 1 + 0.035 * Math.max(0, Math.sin(viewTime * Math.PI * 2 * beatRate));
    const shake = !reduceMotion && sinceHit < 0.35 ? Math.sin(sinceHit * 70) * 8 * (1 - sinceHit / 0.35) : 0;
    const r = L.heartR * beat;
    const x = L.cx + shake, y = L.cy;

    if (playable(heartVideo)) {
      const fw = (r * 2) / 0.62, fh = fw * heartVideo.videoHeight / heartVideo.videoWidth;   // the heart fills ~62% of the frame width
      const size = Math.ceil(Math.max(fw, fh));
      if (heartLayer.width !== size) { heartLayer.width = size; heartLayer.height = size; }
      hctx.globalCompositeOperation = 'source-over';
      hctx.clearRect(0, 0, size, size);
      hctx.drawImage(heartVideo, (size - fw) / 2, (size - fh) / 2, fw, fh);
      hctx.globalCompositeOperation = 'destination-in';
      const m = hctx.createRadialGradient(size / 2, size / 2, size * 0.30, size / 2, size / 2, size * 0.48);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      hctx.fillStyle = m; hctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(heartLayer, x - size / 2, y - size / 2);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.translate(x, y); ctx.scale(r / 50, r / 50);
      ctx.shadowColor = COLORS.heart; ctx.shadowBlur = 30;
      ctx.fillStyle = COLORS.heart;
      ctx.beginPath();
      ctx.moveTo(0, 38); ctx.bezierCurveTo(-60, -5, -32, -55, 0, -22); ctx.bezierCurveTo(32, -55, 60, -5, 0, 38);
      ctx.fill(); ctx.restore();
    }

    // Flash red when hit, green when healed.
    const flash = (since, color) => {
      if (since > 0.45) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.globalAlpha = 0.55 * (1 - since / 0.45);
      ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.shadowColor = color; ctx.shadowBlur = 24;
      ctx.beginPath(); ctx.arc(L.cx, L.cy, L.heartR * (1.2 + since), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    };
    flash(sinceHit, COLORS.bad);
    flash(viewTime - heartHealAt, COLORS.good);
  }

  function drawBubble(b, isTarget) {
    const p = bubblePos(b);
    const appear = Math.min(1, b.age / 0.45);
    const wobble = reduceMotion ? 1 : 1 + 0.025 * Math.sin(b.age * 2.4 + b.id);
    const R = L.bubbleR * (0.6 + 0.4 * appear) * wobble;
    const shookAt = shakes.get(b.id);
    const sinceWrong = shookAt === undefined ? 9 : viewTime - shookAt;
    const dx = !reduceMotion && sinceWrong < 0.4 ? Math.sin(sinceWrong * 60) * 7 * (1 - sinceWrong / 0.4) : 0;
    const x = p.x + dx, y = p.y;

    ctx.save();
    ctx.globalAlpha = appear;

    // Target glow (drawn first, behind the bubble)
    if (isTarget) {
      ctx.globalCompositeOperation = 'source-over';
      const pulse = reduceMotion ? 1 : 0.75 + 0.25 * Math.sin(viewTime * 6);
      ctx.strokeStyle = COLORS.target; ctx.lineWidth = 3; ctx.shadowColor = COLORS.target; ctx.shadowBlur = 20 * pulse;
      ctx.globalAlpha = appear * (0.6 + 0.4 * pulse);
      ctx.beginPath(); ctx.arc(x, y, R * 1.04, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = appear;
    }

    // The bubble itself
    if (playable(bubbleVideo)) {
      const fw = (R * 2) / 0.675;                       // the bubble fills ~67% of its video frame
      const fh = fw * bubbleVideo.videoHeight / bubbleVideo.videoWidth;
      ctx.globalCompositeOperation = 'screen';
      ctx.save(); ctx.translate(x, y); ctx.rotate(b.id * 1.7);   // each bubble turned differently so they don't look identical
      ctx.drawImage(bubbleVideo, -fw / 2, -fh / 2, fw, fh);
      ctx.restore();
    } else {
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createRadialGradient(x, y, R * 0.75, x, y, R);
      g.addColorStop(0, 'rgba(60,90,140,0.05)'); g.addColorStop(0.85, 'rgba(120,200,220,0.35)'); g.addColorStop(1, 'rgba(120,200,220,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    }

    // Darken the inside a little so the white staff always reads clearly
    ctx.globalCompositeOperation = 'source-over';
    const inner = ctx.createRadialGradient(x, y, 0, x, y, R * 0.9);
    inner.addColorStop(0, 'rgba(0,0,0,0.55)'); inner.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = inner; ctx.beginPath(); ctx.arc(x, y, R * 0.9, 0, Math.PI * 2); ctx.fill();

    // The note on its staff, clipped to the inside of the bubble
    const img = staffImage(b.note, b.clef);
    if (img) {
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, R * 0.86, 0, Math.PI * 2); ctx.clip();
      const sw = R * 2 * 0.82, sh = sw * Staff.HEIGHT / Staff.WIDTH;
      ctx.drawImage(img, x - sw / 2, y - sh / 2, sw, sh);
      ctx.restore();
    }

    // Red ring right after a wrong answer
    if (sinceWrong < 0.6) {
      ctx.globalAlpha = appear * (1 - sinceWrong / 0.6);
      ctx.strokeStyle = COLORS.bad; ctx.lineWidth = 3; ctx.shadowColor = COLORS.bad; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(x, y, R * 1.02, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawEffects() {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i], t = viewTime - e.t0;
      if (t > e.life) { effects.splice(i, 1); continue; }
      const k = t / e.life;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      if (e.type === 'pop') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = e.color; ctx.lineWidth = 3 * (1 - k) + 1; ctx.shadowColor = e.color; ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 + 0.6 * k), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = e.color;
        for (let d = 0; d < 10; d++) {             // droplets
          const a = d * (Math.PI * 2 / 10) + e.r, dist = e.r * (0.9 + 0.9 * k);
          ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * dist, e.y + Math.sin(a) * dist, 3.2 * (1 - k) + 0.5, 0, Math.PI * 2); ctx.fill();
        }
      } else if (e.type === 'text') {
        ctx.globalAlpha = 1 - k * k;
        ctx.fillStyle = e.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `800 ${e.size}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
        ctx.fillText(e.text, e.x, e.y - 40 * k);
      }
      ctx.restore();
    }
  }

  function draw() {
    drawBackground();
    drawHeart();
    if (game) {
      const target = game.state.phase === 'playing' ? game.target() : null;
      // Bubbles farthest from the heart first, so the closest ones are drawn on top.
      game.state.bubbles.slice().sort((a, b) => a.progress - b.progress).forEach(b => drawBubble(b, b === target && settings.mode === 'buttons'));   // microphone mode: any bubble can be popped, so no single target ring
    }
    drawEffects();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- Answer buttons ----------
  const choicesEl = $('choices');
  const buttons = [];
  for (let i = 0; i < 4; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.addEventListener('click', () => choose(i));
    choicesEl.appendChild(b);
    buttons.push(b);
  }
  let shownFor = null;               // "bubble id | wrong answers" the buttons currently show

  function renderChoices() {
    const t = game && game.state.phase === 'playing' && !game.state.paused ? game.target() : null;
    const key = t ? t.id + '|' + t.wrong.join(',') : 'none';
    if (key === shownFor) return;
    shownFor = key;
    buttons.forEach((btn, i) => {
      btn.classList.remove('wrong', 'right');
      if (!t) { btn.disabled = true; btn.innerHTML = '–<span class="key">' + (i + 1) + '</span>'; btn.removeAttribute('aria-label'); return; }
      const c = t.choices[i], label = Engine.noteName(c), tried = t.wrong.indexOf(label) >= 0;
      btn.innerHTML = label + '<span class="key">' + (i + 1) + '</span>';
      btn.setAttribute('aria-label', label + (tried ? ', already tried' : ''));
      btn.disabled = tried;
      if (tried) btn.classList.add('wrong');
    });
  }

  function choose(i) {
    if (!game) return;
    const t = game.target();
    if (!t || game.state.phase !== 'playing' || game.state.paused) return;
    const choice = t.choices[i];
    if (!choice) return;
    const result = game.answer(choice);
    if (result === true) {
      const btn = buttons[i]; btn.classList.add('right');
      setTimeout(() => btn.classList.remove('right'), 180);
    }
  }

  // ---------- Keyboard and taps ----------
  document.addEventListener('keydown', e => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') { togglePause(); e.preventDefault(); return; }
    if (k === 'enter' || k === ' ') {
      if ($('startScreen').classList.contains('show')) { startGame(); e.preventDefault(); return; }
      if ($('overScreen').classList.contains('show')) { startGame(); e.preventDefault(); return; }
      if ($('pauseScreen').classList.contains('show')) { togglePause(); e.preventDefault(); return; }
    }
    if (!game || game.state.phase !== 'playing' || game.state.paused) return;
    if (settings.mode !== 'buttons') return;                     // in microphone mode, the instrument answers
    if (k >= '1' && k <= '4') { choose(Number(k) - 1); return; }
    if ('abcdefg'.indexOf(k) >= 0 && k.length === 1) {         // typing a letter picks the button with that letter
      const t = game.target(); if (!t) return;
      const i = t.choices.findIndex(c => c.letter === k && !c.acc);
      if (i >= 0) choose(i);
    }
  });

  canvas.addEventListener('pointerdown', e => {
    if (!game || game.state.phase !== 'playing' || game.state.paused) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = null, bestD = Infinity;
    game.state.bubbles.forEach(b => {
      const p = bubblePos(b), d = Math.hypot(p.x - x, p.y - y);
      if (d < L.bubbleR * 1.1 && d < bestD) { best = b; bestD = d; }
    });
    if (best) game.setTarget(best.id);
  });

  // ---------- Top bar, banner, screens ----------
  const HEART_SVG = '<svg viewBox="0 0 32 30" aria-hidden="true"><path fill="#ff3b4e" d="M16 28C5 20 1 14 1 9 1 4.5 4.6 1 9 1c3 0 5.4 1.6 7 4 1.6-2.4 4-4 7-4 4.4 0 8 3.5 8 8 0 5-4 11-15 19z"/></svg>';
  const heartsEl = $('hearts');
  let shownHealth = null;
  function renderHud() {
    const s = game ? game.state : null;
    const health = s ? s.health : 3, max = game ? game.rules.maxHealth : 3;
    if (health !== shownHealth) {
      const gained = shownHealth !== null && health > shownHealth;
      heartsEl.innerHTML = '';
      for (let i = 0; i < max; i++) {
        heartsEl.insertAdjacentHTML('beforeend', HEART_SVG);
        if (i >= health) heartsEl.lastChild.classList.add('lost');
        if (gained && i === health - 1) { const el = heartsEl.lastChild; el.classList.add('gained'); setTimeout(() => el.classList.remove('gained'), 300); }
      }
      heartsEl.setAttribute('aria-label', health + (health === 1 ? ' heart' : ' hearts') + ' left');
      shownHealth = health;
    }
    setText('hudWave', s && s.wave ? s.wave.number : 1);
    setText('hudScore', s ? s.stats.score : 0);
    setText('hudStreak', s ? s.stats.streak : 0);
    const mult = s ? HD.multiplier(s.stats.streak) : 1;
    setText('hudMult', mult > 1 ? '×' + mult : '');
  }
  function setText(id, v) { const el = $(id); const t = String(v); if (el.textContent !== t) el.textContent = t; }

  let bannerTimer = null;
  function banner(text, sub, seconds) {
    const el = $('banner');
    el.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
    el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), (seconds || 1.6) * 1000);
  }
  function say(text) { $('status').textContent = text; }

  const RANGE_NOTES = {
    'treble-ledger': 'Now with ledger lines',
    'treble-wide': 'Two ledger lines above and below'
  };

  function showScreen(id) {
    ['startScreen', 'pauseScreen', 'overScreen'].forEach(s => $(s).classList.toggle('show', s === id));
    const btn = id && $(id).querySelector('.primary');
    if (btn) setTimeout(() => btn.focus(), 30);
  }

  function readBest() { try { return Number(localStorage.getItem('heartDefenseBest')) || 0; } catch (e) { return 0; } }
  function writeBest(v) { try { localStorage.setItem('heartDefenseBest', String(v)); } catch (e) { /* not available */ } }
  function showBest() { const b = readBest(); $('bestLine').textContent = b ? 'Best score ' + b : 'No best score yet'; }

  function formatTime(sec) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m + ':' + String(s).padStart(2, '0'); }

  function gameOver(summary) {
    const best = readBest(), isBest = summary.score > best;
    if (isBest) writeBest(summary.score);
    $('newBest').textContent = isBest && summary.score > 0 ? 'New best score!' : (best ? 'Best score ' + best : '');
    const rows = [
      ['Score', summary.score], ['Wave', summary.wave],
      ['Survived', formatTime(summary.time)], ['Accuracy', Math.round(summary.accuracy * 100) + '%'],
      ['Correct', summary.correct], ['Wrong', summary.incorrect],
      ['Best streak', summary.bestStreak], ['Reached heart', summary.missed]
    ];
    $('overStats').innerHTML = rows.map(r => `<div><b>${r[1]}</b><span>${r[0]}</span></div>`).join('');
    say(`Game over. Score ${summary.score}, wave ${summary.wave}, accuracy ${Math.round(summary.accuracy * 100)} percent.`);
    setTimeout(() => showScreen('overScreen'), 700);
  }

  // ---------- Game setup ----------
  function beginGame() {
    effects.length = 0; shakes.clear(); shownFor = null; shownHealth = null;
    game = HD.createGame({ instrument: settings.instrument, pace: settings.speed });
    window.__heartDefense.game = game;
    game.on('wave', w => {
      const sub = RANGE_NOTES[w.wave.range] && (w.number === 1 || HD.waveConfig(w.number - 1).range !== w.wave.range) ? RANGE_NOTES[w.wave.range] : '';
      banner('Wave ' + w.number, sub, w.number === 1 ? 1.4 : 2.2);
      say('Wave ' + w.number + (sub ? '. ' + sub : ''));
    });
    game.on('pop', p => {
      const pos = bubblePos(p.bubble);
      effects.push({ type: 'pop', x: pos.x, y: pos.y, r: L.bubbleR, color: COLORS.target, t0: viewTime, life: 0.45 });
      effects.push({ type: 'text', x: pos.x, y: pos.y - L.bubbleR * 0.2, text: '+' + p.points + (p.multiplier > 1 ? ' ×' + p.multiplier : ''),
        color: p.multiplier > 1 ? COLORS.good : COLORS.text, size: Math.round(L.bubbleR * 0.38), t0: viewTime, life: 0.9 });
      say('Correct, ' + Engine.noteName(p.bubble.note));
    });
    game.on('wrong', w => {
      shakes.set(w.bubble.id, viewTime);
      if (w.heard) {                       // microphone: show what was heard, above the heart
        const text = w.wrongOctave ? w.heard + ': wrong octave' : 'Heard ' + w.heard;
        effects.push({ type: 'text', x: L.cx, y: L.cy - L.heartR * 1.5, text: text, color: w.wrongOctave ? '#ffc861' : COLORS.bad,
          size: Math.round(clamp(L.heartR * 0.45, 16, 30)), t0: viewTime, life: w.wrongOctave ? 1.5 : 1.1 });
        say(w.wrongOctave ? 'Right note, ' + w.heard + ', but the wrong octave.' : 'Heard ' + w.heard + '. No bubble has that note.');
      } else say('Not ' + w.label);
    });
    game.on('hit', b => {
      heartHitAt = viewTime;
      const pos = bubblePos(b);
      effects.push({ type: 'pop', x: pos.x, y: pos.y, r: L.bubbleR * 0.8, color: COLORS.bad, t0: viewTime, life: 0.5 });
      effects.push({ type: 'text', x: L.cx, y: L.cy - L.heartR * 1.4, text: '−1', color: COLORS.bad, size: Math.round(L.heartR * 0.7), t0: viewTime, life: 1 });
      say('The heart was hit. It was ' + Engine.noteName(b.note) + '. ' + game.state.health + ' left.');
    });
    game.on('heal', h => { heartHealAt = viewTime; banner('+1 heart', h.streak + ' in a row!', 1.6); say('Heart restored'); });
    game.on('bonus', b => { banner('+' + b.points, b.streak + ' in a row!', 1.6); });
    game.on('pause', p => {
      mic.setPaused(p);
      if (p) placeMicPanel('micSlotPause');
      showScreen(p ? 'pauseScreen' : null);
      $('pauseBtn').textContent = p ? '▶' : 'II';
    });
    game.on('over', gameOver);
    showScreen(null);
    game.start();
  }

  function togglePause() {
    if (!game || game.state.phase === 'over' || game.state.phase === 'ready') return;
    game.setPaused(!game.state.paused);
  }

  // ---------- Settings (remembered in this browser) ----------
  const settings = { instrument: 'piano', mode: 'buttons', filter: 'strict', octave: 'any', speed: 'relaxed' };
  function loadSettings() {
    try { Object.assign(settings, JSON.parse(localStorage.getItem('heartDefenseSettings') || '{}')); } catch (e) { /* none saved */ }
    if (!['piano', 'guitar'].includes(settings.instrument)) settings.instrument = 'piano';
    if (!['buttons', 'mic'].includes(settings.mode)) settings.mode = 'buttons';
    if (!['strict', 'any'].includes(settings.filter)) settings.filter = 'strict';
    if (!['any', 'exact'].includes(settings.octave)) settings.octave = 'any';
    if (!['relaxed', 'normal', 'fast'].includes(settings.speed)) settings.speed = 'relaxed';
    $('instSel').value = settings.instrument; $('modeSel').value = settings.mode; $('filterSel').value = settings.filter;
    $('octaveSel').value = settings.octave; $('speedSel').value = settings.speed;
  }
  function saveSettings() { try { localStorage.setItem('heartDefenseSettings', JSON.stringify(settings)); } catch (e) { /* not available */ } }

  // Show buttons or the listening strip, and the matching instructions.
  function applyMode() {
    const micMode = settings.mode === 'mic';
    $('choices').hidden = micMode;
    $('hint').hidden = micMode;
    $('micStrip').hidden = !micMode;
    $('rulesButtons').hidden = micMode;
    $('rulesMic').hidden = !micMode;
    $('micPanel').hidden = !micMode;
  }

  // ---------- Microphone (shared listener, same detection as the Note Trainer) ----------
  const mic = window.MicListener.createListener({
    filter: settings.filter,
    // A played note pops whichever bubble has that note.
    onNote: midi => (game && game.state.phase === 'playing' && !game.state.paused)
      ? game.answerPitch(midi, { matchAny: true, instrument: settings.instrument, exactOctave: settings.octave === 'exact' })
      : null
  });
  const meterPct = rms => Math.min(100, Math.sqrt(Math.max(0, rms) / 0.25) * 100);   // square root so quiet sounds still show
  mic.on('level', l => {
    const level = meterPct(l.rms) + '%', gate = meterPct(l.gate) + '%';
    $('panelLevel').style.width = level; $('stripLevel').style.width = level;
    $('panelGate').style.left = gate; $('stripGate').style.left = gate;
  });
  mic.on('hearing', midi => {
    const text = midi === null ? '–' : Engine.pitchLabel(midi);
    setText('panelHearing', text); setText('stripHearing', text);
  });
  mic.on('status', text => { setText('panelStatus', text); setText('stripStatus', text); });
  mic.on('filter', f => { settings.filter = f; $('filterSel').value = f; saveSettings(); });
  mic.on('calibrated', () => refreshMicButtons());
  mic.on('note', n => {
    if (n.result === null && !game) setText('panelStatus', 'Heard ' + Engine.pitchLabel(n.midi) + '. The microphone is working.');
  });

  function refreshMicButtons() {
    $('micOnBtn').textContent = mic.running ? 'Turn off microphone' : 'Turn on microphone';
    $('calNoteBtn').disabled = !mic.running;
    $('calRoomBtn').disabled = !mic.running;
  }
  async function turnMicOn() {
    const r = await mic.start();
    refreshMicButtons();
    return r.ok;
  }
  function turnMicOff() { mic.stop(); refreshMicButtons(); setText('panelHearing', '–'); setText('stripHearing', '–'); }
  function placeMicPanel(slotId) { if (settings.mode === 'mic') $(slotId).appendChild($('micPanel')); }

  $('micOnBtn').addEventListener('click', () => { if (mic.running) turnMicOff(); else turnMicOn(); });
  $('calNoteBtn').addEventListener('click', () => mic.calibrateInstrument());
  $('calRoomBtn').addEventListener('click', () => mic.calibrateRoom());
  $('filterSel').addEventListener('change', e => { mic.setFilter(e.target.value); });
  $('instSel').addEventListener('change', e => { settings.instrument = e.target.value; saveSettings(); });
  $('octaveSel').addEventListener('change', e => { settings.octave = e.target.value; saveSettings(); });   // takes effect on the next note
  $('speedSel').addEventListener('change', e => { settings.speed = e.target.value; saveSettings(); });     // takes effect on the next game
  $('modeSel').addEventListener('change', e => {
    settings.mode = e.target.value; saveSettings(); applyMode();
    if (settings.mode === 'mic') placeMicPanel('micSlotStart'); else if (mic.running) turnMicOff();
  });

  // Start: in microphone mode, make sure the microphone is on (and the room measured) first.
  let starting = false;
  async function startGame() {
    if (starting) return;
    if (settings.mode === 'mic' && !mic.running) {
      starting = true;
      const okMic = await turnMicOn();
      starting = false;
      if (!okMic) {                                           // the panel shows why; make sure it is seen
        showScreen(game && game.state.phase === 'over' ? 'overScreen' : 'startScreen');
        placeMicPanel('micSlotStart');
        setText('panelStatus', mic.status + ' Or set "Answer with" to Buttons to play without the microphone.');
        setTimeout(() => $('micPanel').scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
        return;
      }
    }
    beginGame();
  }

  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('resumeBtn').addEventListener('click', togglePause);
  $('pauseBtn').addEventListener('click', togglePause);
  document.addEventListener('visibilitychange', () => { if (document.hidden && game && !game.state.paused) togglePause(); });

  // ---------- Main loop ----------
  let last = null;
  function frame(now) {
    const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    viewTime += dt;
    if (game) game.update(dt);
    draw();
    renderHud();
    renderChoices();
    requestAnimationFrame(frame);
  }

  // For tests and debugging in the browser console.
  window.__heartDefense = { game: null, layout: L, bubblePos: bubblePos, start: startGame, mic: mic, settings: settings,
    videosReady: () => [playable(heartVideo), playable(bubbleVideo)] };

  loadSettings();
  mic.setFilter(settings.filter);
  applyMode();
  placeMicPanel('micSlotStart');
  refreshMicButtons();
  resize();
  showBest();
  renderHud();
  renderChoices();
  requestAnimationFrame(frame);
})();
