'use strict';

/**
 * Ruin Runner — a pseudo-3D endless runner.
 * Three lanes, obstacles rushing toward the camera, jump / slide / lane-switch.
 * Original code and visuals; inspired by the endless-runner genre.
 */

(() => {
  // ---------- canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  // ---------- perspective ----------
  // z: distance ahead of the player, 0 = player plane, 1 = horizon spawn line.
  function project(z, lane) {
    const t = clamp(1 - z, 0, 1);          // 0 far → 1 near
    const p = Math.pow(t, 2.6);            // perspective easing
    const horizonY = H * 0.34;
    const baseY = H * 0.92;
    const y = lerp(horizonY, baseY, p);
    const roadHalf = lerp(W * 0.015, W * 0.42, p);
    const x = W / 2 + lane * roadHalf * 0.62;
    return { x, y, p, roadHalf };
  }

  // ---------- audio (tiny WebAudio synth, no assets) ----------
  const sound = {
    ctx: null,
    muted: localStorage.getItem('rr-muted') === '1',
    ensure() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch { this.ctx = null; }
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    blip(freq, dur, type, vol, slide) {
      if (this.muted || !this.ctx) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    jump() { this.blip(280, 0.18, 'triangle', 0.25, 520); },
    slide() { this.blip(220, 0.15, 'sine', 0.2, 130); },
    coin() { this.blip(880, 0.09, 'sine', 0.22); setTimeout(() => this.blip(1320, 0.12, 'sine', 0.2), 60); },
    crash() { this.blip(140, 0.4, 'sawtooth', 0.35, 40); },
  };

  // ---------- state ----------
  const S = { MENU: 0, PLAY: 1, DEAD: 2 };
  let state = S.MENU;

  const player = {
    lane: 0,          // target lane: -1 | 0 | 1
    laneX: 0,         // smoothed lane position
    jumpV: 0,
    jumpY: 0,         // 0 = grounded, positive = height in "units"
    sliding: 0,       // seconds remaining
    runPhase: 0,
  };

  let obstacles = []; // { z, lane, type } — type: 'block' | 'low' | 'gate' | 'coin'
  let pillars = [];   // decorative edge pillars { z, side }
  let speed = 0;
  let distScore = 0;
  let coins = 0;
  let spawnTimer = 0;
  let elapsed = 0;
  let shake = 0;
  let scroll = 0;     // road stripe scroll
  let best = Number(localStorage.getItem('rr-best') || 0);

  // ---------- input ----------
  function moveLane(dir) {
    if (state !== S.PLAY) return;
    player.lane = clamp(player.lane + dir, -1, 1);
  }
  function jump() {
    if (state !== S.PLAY) return;
    if (player.jumpY <= 0 && player.sliding <= 0) {
      player.jumpV = 3.1;
      sound.jump();
    }
  }
  function slide() {
    if (state !== S.PLAY) return;
    if (player.jumpY <= 0) {
      player.sliding = 0.65;
      sound.slide();
    }
  }

  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') moveLane(-1);
    if (e.code === 'ArrowRight' || e.code === 'KeyD') moveLane(1);
    if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') jump();
    if (e.code === 'ArrowDown' || e.code === 'KeyS') slide();
    if (e.code === 'Enter') {
      if (state === S.MENU) start();
      else if (state === S.DEAD && document.activeElement !== nameInput) restart();
    }
  });

  // touch: swipe to steer, tap to jump
  let touchX = 0, touchY = 0, touchT = 0;
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touchX = t.clientX; touchY = t.clientY; touchT = performance.now();
  }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    const dt = performance.now() - touchT;
    const TH = 28;
    if (Math.abs(dx) < TH && Math.abs(dy) < TH && dt < 300) { jump(); return; }
    if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
    else if (dy < 0) jump();
    else slide();
  }, { passive: true });

  // ---------- spawning ----------
  function spawnPattern() {
    const roll = Math.random();
    if (roll < 0.22) {
      // coin trail: 4-6 coins in one lane
      const lane = pick([-1, 0, 1]);
      const n = 4 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        obstacles.push({ z: 1.05 + i * 0.075, lane, type: 'coin' });
      }
    } else if (roll < 0.62) {
      // single obstacle
      obstacles.push({ z: 1.05, lane: pick([-1, 0, 1]), type: pick(['block', 'low', 'gate']) });
    } else {
      // two lanes blocked, one always left open
      const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5).slice(0, 2);
      for (const lane of lanes) {
        obstacles.push({ z: 1.05, lane, type: pick(['block', 'low', 'gate']) });
      }
      // sweeten the open lane sometimes
      if (Math.random() < 0.5) {
        const open = [-1, 0, 1].find((l) => !lanes.includes(l));
        obstacles.push({ z: 1.12, lane: open, type: 'coin' });
      }
    }
  }

  // ---------- game flow ----------
  const menuEl = document.getElementById('menu');
  const overEl = document.getElementById('gameover');
  const hudEl = document.getElementById('hud');
  const hudScore = document.getElementById('hud-score');
  const hudCoins = document.getElementById('hud-coins');
  const hudBest = document.getElementById('hud-best');
  const finalScore = document.getElementById('final-score');
  const finalDetail = document.getElementById('final-detail');
  const nameInput = document.getElementById('name-input');
  const submitNote = document.getElementById('submit-note');
  const boardList = document.getElementById('board-list');
  const submitRow = document.getElementById('submit-row');

  function start() {
    sound.ensure();
    obstacles = [];
    pillars = [];
    for (let i = 0; i < 8; i++) pillars.push({ z: i / 8, side: i % 2 ? 1 : -1 });
    speed = 0.55;
    distScore = 0;
    coins = 0;
    spawnTimer = 0.4;
    elapsed = 0;
    shake = 0;
    player.lane = 0; player.laneX = 0;
    player.jumpY = 0; player.jumpV = 0; player.sliding = 0;
    state = S.PLAY;
    menuEl.hidden = true;
    overEl.hidden = true;
    hudEl.hidden = false;
  }

  function die() {
    state = S.DEAD;
    shake = 1;
    sound.crash();
    const total = totalScore();
    if (total > best) {
      best = total;
      localStorage.setItem('rr-best', String(best));
    }
    finalScore.textContent = total.toLocaleString();
    finalDetail.textContent = `${coins} relic shard${coins === 1 ? '' : 's'} collected`;
    submitRow.hidden = false;
    submitNote.textContent = '';
    nameInput.value = localStorage.getItem('rr-name') || '';
    setTimeout(() => { overEl.hidden = false; }, 650);
    loadBoard();
  }

  function restart() { start(); }

  const totalScore = () => Math.floor(distScore) + coins * 250;

  // ---------- leaderboard ----------
  function renderBoard(scores) {
    boardList.innerHTML = '';
    if (!scores || scores.length === 0) {
      boardList.innerHTML = '<li class="is-empty">No runs recorded yet — be the first.</li>';
      return;
    }
    for (const s of scores) {
      const li = document.createElement('li');
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = s.name;
      const sc = document.createElement('span');
      sc.className = 'sc';
      sc.textContent = Number(s.score).toLocaleString();
      li.append(nm, sc);
      boardList.appendChild(li);
    }
  }

  async function loadBoard() {
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      renderBoard(data.scores);
    } catch {
      boardList.innerHTML = '<li class="is-empty">Leaderboard unavailable.</li>';
    }
  }

  async function submitScore() {
    const name = nameInput.value.trim() || 'Runner';
    localStorage.setItem('rr-name', name);
    submitNote.textContent = 'Saving…';
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, score: totalScore() }),
      });
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      renderBoard(data.scores);
      submitNote.textContent = 'Saved.';
      submitRow.hidden = true;
    } catch {
      submitNote.textContent = 'Could not save — try again.';
    }
  }

  document.getElementById('btn-start').addEventListener('click', start);
  document.getElementById('btn-retry').addEventListener('click', restart);
  document.getElementById('btn-submit').addEventListener('click', submitScore);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitScore(); });

  const muteBtn = document.getElementById('btn-mute');
  muteBtn.classList.toggle('is-muted', sound.muted);
  muteBtn.addEventListener('click', () => {
    sound.muted = !sound.muted;
    localStorage.setItem('rr-muted', sound.muted ? '1' : '0');
    muteBtn.classList.toggle('is-muted', sound.muted);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === S.PLAY) { menuEl.hidden = false; state = S.MENU; hudEl.hidden = true; }
  });

  // ---------- update ----------
  function update(dt) {
    if (state !== S.PLAY) {
      shake = Math.max(0, shake - dt * 2);
      scroll = (scroll + dt * 0.2) % 1;
      return;
    }

    elapsed += dt;
    speed = clamp(0.55 + elapsed * 0.012, 0.55, 1.5);
    distScore += speed * dt * 120;
    scroll = (scroll + dt * speed * 2.2) % 1;

    // player physics
    player.laneX = lerp(player.laneX, player.lane, clamp(dt * 12, 0, 1));
    if (player.jumpY > 0 || player.jumpV > 0) {
      player.jumpY += player.jumpV * dt * 2.4;
      player.jumpV -= dt * 9.2;
      if (player.jumpY <= 0) { player.jumpY = 0; player.jumpV = 0; }
    }
    if (player.sliding > 0) player.sliding -= dt;
    player.runPhase += dt * (8 + speed * 6);

    // world motion
    for (const o of obstacles) o.z -= speed * dt;
    for (const p of pillars) { p.z -= speed * dt; if (p.z < -0.05) p.z += 1.05; }

    // collisions in the player zone
    for (const o of obstacles) {
      if (o.hit || o.z > 0.05 || o.z < -0.06) continue;
      if (Math.round(player.laneX) !== o.lane) continue;

      if (o.type === 'coin') {
        o.hit = true;
        coins += 1;
        sound.coin();
      } else if (o.type === 'low') {
        if (player.jumpY < 0.45) { die(); return; }
      } else if (o.type === 'gate') {
        if (player.sliding <= 0) { die(); return; }
      } else { // block
        die(); return;
      }
    }
    obstacles = obstacles.filter((o) => o.z > -0.1 && !o.hit);

    // spawning
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnPattern();
      spawnTimer = clamp(rand(0.75, 1.15) / speed, 0.42, 2);
    }

    // HUD
    hudScore.textContent = totalScore().toLocaleString();
    hudCoins.textContent = `◈ ${coins}`;
    hudBest.textContent = `best ${Math.max(best, totalScore()).toLocaleString()}`;
  }

  // ---------- drawing ----------
  function drawSky() {
    const horizonY = H * 0.34;
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY * 1.4);
    sky.addColorStop(0, '#0a1a12');
    sky.addColorStop(0.6, '#14301f');
    sky.addColorStop(1, '#3d4a26');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizonY * 1.4);

    // low sun
    ctx.beginPath();
    ctx.arc(W * 0.5, horizonY * 0.96, Math.min(W, H) * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 190, 90, 0.85)';
    ctx.fill();

    // temple silhouettes (two parallax bands, procedural, stable per width)
    silhouette(horizonY, 0.9, 'rgba(6, 12, 9, 0.55)', 90);
    silhouette(horizonY, 1.0, 'rgba(4, 8, 6, 0.9)', 55);
  }

  function silhouette(horizonY, yScale, color, seed) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, horizonY * yScale);
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const x = (W / steps) * i;
      // deterministic pseudo-random height per column
      const n = Math.sin(i * 12.9898 + seed) * 43758.5453;
      const f = n - Math.floor(n);
      const hgt = horizonY * (0.12 + f * 0.3);
      ctx.lineTo(x, horizonY * yScale - hgt);
      ctx.lineTo(x + W / steps / 2, horizonY * yScale - hgt);
    }
    ctx.lineTo(W, horizonY * yScale);
    ctx.lineTo(W, horizonY * 1.5);
    ctx.lineTo(0, horizonY * 1.5);
    ctx.closePath();
    ctx.fill();
  }

  function drawGround() {
    const horizonY = H * 0.34;
    // jungle floor
    const g = ctx.createLinearGradient(0, horizonY, 0, H);
    g.addColorStop(0, '#1c2416');
    g.addColorStop(1, '#0c120a');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizonY, W, H - horizonY);

    // stone road (trapezoid)
    const near = project(0, 0);
    const far = project(1, 0);
    const road = ctx.createLinearGradient(0, far.y, 0, near.y);
    road.addColorStop(0, '#4a4438');
    road.addColorStop(1, '#2a2620');
    ctx.fillStyle = road;
    ctx.beginPath();
    ctx.moveTo(far.x - far.roadHalf, far.y);
    ctx.lineTo(far.x + far.roadHalf, far.y);
    ctx.lineTo(near.x + near.roadHalf, near.y);
    ctx.lineTo(near.x - near.roadHalf, near.y);
    ctx.closePath();
    ctx.fill();

    // road edges
    ctx.strokeStyle = 'rgba(255, 210, 140, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(far.x - far.roadHalf, far.y); ctx.lineTo(near.x - near.roadHalf, near.y);
    ctx.moveTo(far.x + far.roadHalf, far.y); ctx.lineTo(near.x + near.roadHalf, near.y);
    ctx.stroke();

    // lane divider dashes (scrolling)
    ctx.strokeStyle = 'rgba(240, 230, 200, 0.28)';
    for (const d of [-0.5, 0.5]) {
      for (let i = 0; i < 14; i++) {
        const zz = (i / 14 + scroll) % 1;
        const a = project(zz, 0);
        const b = project(clamp(zz + 0.028, 0, 1), 0);
        if (a.p < 0.02) continue;
        ctx.lineWidth = Math.max(1, 3.5 * a.p);
        ctx.beginPath();
        ctx.moveTo(a.x + d * a.roadHalf * 0.62, a.y);
        ctx.lineTo(b.x + d * b.roadHalf * 0.62, b.y);
        ctx.stroke();
      }
    }

    // fog above horizon line
    const fog = ctx.createLinearGradient(0, horizonY - 30, 0, horizonY + H * 0.12);
    fog.addColorStop(0, 'rgba(190, 210, 170, 0.16)');
    fog.addColorStop(1, 'rgba(190, 210, 170, 0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, horizonY - 30, W, H * 0.16);
  }

  function drawPillar(p) {
    const pos = project(p.z, p.side * 1.55);
    if (pos.p < 0.03) return;
    const s = pos.p;
    const w = 14 * s * (W / 900);
    const h = 130 * s * (H / 700);
    ctx.fillStyle = '#3a3428';
    ctx.fillRect(pos.x - w / 2, pos.y - h, w, h);
    ctx.fillStyle = '#4c4434';
    ctx.fillRect(pos.x - w * 0.8, pos.y - h, w * 1.6, w * 0.5);
    // torch glow
    const glow = ctx.createRadialGradient(pos.x, pos.y - h, 0, pos.x, pos.y - h, 26 * s);
    glow.addColorStop(0, 'rgba(255, 170, 60, 0.55)');
    glow.addColorStop(1, 'rgba(255, 170, 60, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(pos.x - 30 * s, pos.y - h - 30 * s, 60 * s, 60 * s);
  }

  function drawObstacle(o) {
    const pos = project(o.z, o.lane);
    if (pos.p < 0.02) return;
    const s = pos.p;
    const unit = Math.min(W, H) / 10;

    if (o.type === 'coin') {
      const bob = Math.sin(performance.now() / 180 + o.z * 20) * 4 * s;
      const r = unit * 0.24 * s;
      const glow = ctx.createRadialGradient(pos.x, pos.y - unit * 0.5 * s + bob, 0, pos.x, pos.y - unit * 0.5 * s + bob, r * 2.4);
      glow.addColorStop(0, 'rgba(255, 215, 94, 0.5)');
      glow.addColorStop(1, 'rgba(255, 215, 94, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(pos.x - r * 2.4, pos.y - unit * 0.5 * s + bob - r * 2.4, r * 4.8, r * 4.8);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y - unit * 0.5 * s + bob - r);
      ctx.lineTo(pos.x + r * 0.8, pos.y - unit * 0.5 * s + bob);
      ctx.lineTo(pos.x, pos.y - unit * 0.5 * s + bob + r);
      ctx.lineTo(pos.x - r * 0.8, pos.y - unit * 0.5 * s + bob);
      ctx.closePath();
      ctx.fillStyle = '#ffd75e';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 80, 0, 0.6)';
      ctx.lineWidth = Math.max(1, 1.5 * s);
      ctx.stroke();
      return;
    }

    if (o.type === 'block') {
      const w = unit * 1.05 * s, h = unit * 1.5 * s;
      ctx.fillStyle = '#5a5244';
      ctx.fillRect(pos.x - w / 2, pos.y - h, w, h);
      ctx.fillStyle = '#6c6250';
      ctx.fillRect(pos.x - w / 2, pos.y - h, w, h * 0.18);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = Math.max(1, 2 * s);
      ctx.strokeRect(pos.x - w / 2, pos.y - h, w, h);
      // crack
      ctx.beginPath();
      ctx.moveTo(pos.x - w * 0.15, pos.y - h);
      ctx.lineTo(pos.x + w * 0.05, pos.y - h * 0.55);
      ctx.lineTo(pos.x - w * 0.1, pos.y - h * 0.2);
      ctx.stroke();
      return;
    }

    if (o.type === 'low') {
      const w = unit * 1.15 * s, h = unit * 0.5 * s;
      ctx.fillStyle = '#4a3a26';
      ctx.beginPath();
      const rr = h / 2;
      ctx.moveTo(pos.x - w / 2 + rr, pos.y - h);
      ctx.lineTo(pos.x + w / 2 - rr, pos.y - h);
      ctx.arc(pos.x + w / 2 - rr, pos.y - h / 2, rr, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(pos.x - w / 2 + rr, pos.y);
      ctx.arc(pos.x - w / 2 + rr, pos.y - h / 2, rr, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 12, 4, 0.5)';
      ctx.lineWidth = Math.max(1, 2 * s);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pos.x + w / 2 - rr, pos.y - h / 2, rr * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 220, 170, 0.3)';
      ctx.stroke();
      return;
    }

    // gate: slide under the beam
    const w = unit * 1.2 * s, h = unit * 1.7 * s, beam = unit * 0.42 * s, post = unit * 0.16 * s;
    ctx.fillStyle = '#55503f';
    ctx.fillRect(pos.x - w / 2, pos.y - h, post, h);
    ctx.fillRect(pos.x + w / 2 - post, pos.y - h, post, h);
    ctx.fillStyle = '#6a6248';
    ctx.fillRect(pos.x - w / 2 - post * 0.5, pos.y - h, w + post, beam);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = Math.max(1, 2 * s);
    ctx.strokeRect(pos.x - w / 2 - post * 0.5, pos.y - h, w + post, beam);
  }

  function drawPlayer() {
    const pos = project(0.02, player.laneX);
    const unit = Math.min(W, H) / 10;
    const jump = player.jumpY * unit * 0.9;
    const sliding = player.sliding > 0;
    const bodyH = sliding ? unit * 0.42 : unit * 0.85;
    const bodyW = sliding ? unit * 0.5 : unit * 0.34;
    const baseY = pos.y - jump;
    const swing = Math.sin(player.runPhase) * 0.5;

    ctx.save();
    // shadow stays on the ground
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 4, unit * 0.28 * (1 - player.jumpY * 0.2), unit * 0.08, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${0.4 - player.jumpY * 0.12})`;
    ctx.fill();

    // legs
    if (!sliding && player.jumpY <= 0) {
      ctx.strokeStyle = '#c9b78e';
      ctx.lineWidth = unit * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pos.x, baseY - unit * 0.32);
      ctx.lineTo(pos.x + swing * unit * 0.22, baseY);
      ctx.moveTo(pos.x, baseY - unit * 0.32);
      ctx.lineTo(pos.x - swing * unit * 0.22, baseY);
      ctx.stroke();
    }

    // body
    ctx.fillStyle = '#e0632f';
    const bx = pos.x - bodyW / 2;
    const by = baseY - bodyH - (sliding ? 0 : unit * 0.28);
    ctx.beginPath();
    ctx.roundRect(bx, by, bodyW, bodyH, unit * 0.08);
    ctx.fill();

    // satchel strap
    ctx.strokeStyle = '#7a4a20';
    ctx.lineWidth = unit * 0.05;
    ctx.beginPath();
    ctx.moveTo(bx, by + bodyH * 0.25);
    ctx.lineTo(bx + bodyW, by + bodyH * 0.6);
    ctx.stroke();

    // head
    ctx.beginPath();
    ctx.arc(pos.x, by - unit * 0.12, unit * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = '#e8c9a0';
    ctx.fill();

    // arms while airborne
    if (player.jumpY > 0) {
      ctx.strokeStyle = '#e0632f';
      ctx.lineWidth = unit * 0.07;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pos.x - bodyW / 2, by + bodyH * 0.2);
      ctx.lineTo(pos.x - bodyW, by - unit * 0.05);
      ctx.moveTo(pos.x + bodyW / 2, by + bodyH * 0.2);
      ctx.lineTo(pos.x + bodyW, by - unit * 0.05);
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    ctx.save();
    if (shake > 0) {
      ctx.translate(rand(-1, 1) * shake * 10, rand(-1, 1) * shake * 8);
    }
    drawSky();
    drawGround();

    // far-to-near draw order
    const drawables = [
      ...pillars.map((p) => ({ z: p.z, kind: 'pillar', ref: p })),
      ...obstacles.map((o) => ({ z: o.z, kind: 'obs', ref: o })),
    ].sort((a, b) => b.z - a.z);

    for (const d of drawables) {
      if (d.kind === 'pillar') drawPillar(d.ref);
      else drawObstacle(d.ref);
    }

    if (state !== S.MENU) drawPlayer();

    // vignette
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ---------- main loop ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
