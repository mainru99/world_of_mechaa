/* 뽑기 연출 시험대 — 등급이 높을수록 오래 · 크게 · 밝게. (2026-10-08)
 * 등급 가중치는 게임의 ROBOT_RARITY 그대로, 기체는 BY_RARITY 에서 무작위로 고른다.
 * 흐름: 캡슐이 떨어진다 → 흔들리며 등급 색이 비친다(기대감) → 갈라지며 터진다 → 기체 공개 → 이름표. */
import { ROBOT_TYPES, ROBOT_RARITY } from '../../data/balance.js';
import { BY_RARITY } from '../../js/gacha.js';
import { Sfx } from './sfx.js?v=1008a';

const $ = s => document.querySelector(s);
const sfx = new Sfx();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = { out: u => 1 - (1 - u) ** 3, in: u => u * u, inOut: u => u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2 };

const TIERS = [
  { k: 'C',  ko: '커먼',   col: '#9aa8b6', rgb: '154,168,182', stamp: '' },
  { k: 'UC', ko: '언커먼', col: '#4fd192', rgb: '79,209,146',  stamp: '' },
  { k: 'R',  ko: '레어',   col: '#5aa2ff', rgb: '90,162,255',  stamp: 'RARE' },
  { k: 'UQ', ko: '유니크', col: '#b58cff', rgb: '181,140,255', stamp: 'UNIQUE' },
  { k: 'EP', ko: '에픽',   col: '#ffab4d', rgb: '255,171,77',  stamp: 'EPIC' },
];
const W_ = ROBOT_RARITY.map(r => r.w), WT = W_.reduce((a, b) => a + b, 0);
const rollTier = () => { let r = Math.random() * WT; for (let i = 0; i < W_.length; i++) if ((r -= W_[i]) <= 0) return i; return 0; };
const robotOf = ti => { const l = BY_RARITY[TIERS[ti].k]; return l[(Math.random() * l.length) | 0]; };

/* ── 무대 ── */
const stage = $('#stage'), cam = $('#cam'), cv = $('#fx'), g = cv.getContext('2d');
let W = 800, H = 500, S = 1, parts = [], trauma = 0, zoom = 0, zoomT = 0, gt = 0;
function fit() { const r = stage.getBoundingClientRect(); W = r.width; H = r.height; S = W / 800; const d = Math.min(2, devicePixelRatio || 1); cv.width = W * d; cv.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); }
new ResizeObserver(fit).observe(stage); fit();
const add = o => { o.age = o.age ?? 0; parts.push(o); };
const CX = () => W / 2, CY = () => H * .52;
const spark = (x, y, n, { col = ['#fff', '#ffe58a'], v = .5, life = 600, up = 0, spread = Math.PI * 2, dir = 0, grav = .0007 } = {}) => {
  for (let i = 0; i < n; i++) { const a = dir + rnd(-.5, .5) * spread, s = rnd(.3, 1) * v * S;
    add({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - up * S, life: rnd(life * .6, life), w: rnd(1.2, 3) * S, col: col[(Math.random() * col.length) | 0], grav: grav * S }); }
};
const ring = (x, y, r1, col, life = 500, w = 5, delay = 0) => add({ k: 'ring', x, y, r0: 8 * S, r1: r1 * S, life, col, w: w * S, age: -delay });
const glow = (x, y, r, rgb, life = 400) => add({ k: 'glow', x, y, r: r * S, rgb, life });
const beam = (x, rgb, life = 900, w = 80) => add({ k: 'beam', x, rgb, life, w: w * S });
const rays = (x, y, rgb, life = 1600, n = 14, len = 1.1) => add({ k: 'rays', x, y, rgb, life, n, len });
const crackP = (x, y, life = 1400) => { const lines = []; for (let i = 0; i < 7; i++) { let a = rnd(0, 7), px = x, py = y; const seg = []; for (let j = 0; j < 4; j++) { a += rnd(-.7, .7); px += Math.cos(a) * rnd(8, 18) * S; py += Math.sin(a) * rnd(8, 18) * S; seg.push([px, py]); } lines.push(seg); } add({ k: 'crack', x, y, lines, life }); };
const converge = (x, y, rgb, n = 30, R = 150) => { for (let i = 0; i < n; i++) add({ k: 'in', tx: x, ty: y, a: rnd(0, 7), R: rnd(R * .5, R) * S, life: rnd(350, 600), age: rnd(-200, 0), rgb }); };

function step(dt) {
  for (const p of parts) { p.age += dt; if (p.age < 0) continue; if (p.k === 'spark') { p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .998 ** dt; } }
  parts = parts.filter(p => p.age < p.life);
}
function draw() {
  g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  for (const p of parts) {
    if (p.age < 0) continue; const u = p.age / p.life;
    if (p.k === 'spark') { g.globalAlpha = 1 - u; g.strokeStyle = p.col; g.lineWidth = p.w; g.beginPath(); g.moveTo(p.x - p.vx * 12, p.y - p.vy * 12); g.lineTo(p.x, p.y); g.stroke(); }
    else if (p.k === 'ring') { g.globalAlpha = 1 - u; g.strokeStyle = p.col; g.lineWidth = p.w * (1 - u); g.beginPath(); g.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * ease.out(u), 0, 7); g.stroke(); }
    else if (p.k === 'glow') { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); gr.addColorStop(0, `rgba(${p.rgb},${.85 * (1 - u)})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
    else if (p.k === 'beam') { const a = u < .12 ? u / .12 : 1 - (u - .12) / .88, w = p.w * (1 - u * .6), gr = g.createLinearGradient(p.x - w, 0, p.x + w, 0);
      gr.addColorStop(0, `rgba(${p.rgb},0)`); gr.addColorStop(.5, `rgba(${p.rgb},${.8 * a})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(p.x - w, 0, w * 2, H); }
    else if (p.k === 'rays') { const a = u < .1 ? u / .1 : 1 - (u - .1) / .9, rot = p.age / 2400, L = Math.hypot(W, H) * p.len; g.globalAlpha = .55 * a; g.fillStyle = `rgb(${p.rgb})`;
      for (let i = 0; i < p.n; i++) { const a0 = rot + i * Math.PI * 2 / p.n, a1 = a0 + Math.PI / p.n * .55; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + Math.cos(a0) * L, p.y + Math.sin(a0) * L); g.lineTo(p.x + Math.cos(a1) * L, p.y + Math.sin(a1) * L); g.closePath(); g.fill(); } }
    else if (p.k === 'in') { const q = ease.in(u), R = p.R * (1 - q); g.globalAlpha = .3 + .7 * q; g.fillStyle = `rgb(${p.rgb})`; g.beginPath(); g.arc(p.tx + Math.cos(p.a) * R, p.ty + Math.sin(p.a) * R, (1.5 + 2 * q) * S, 0, 7); g.fill(); }
  }
  g.globalCompositeOperation = 'source-over';
  for (const p of parts) if (p.k === 'crack' && p.age >= 0) { const u = p.age / p.life, a = u < .75 ? 1 : 1 - (u - .75) / .25, show = clamp(p.age / 200, 0, 1);
    g.globalAlpha = a; g.strokeStyle = '#fff3c4'; g.lineWidth = 2 * S; g.shadowColor = '#ffb03a'; g.shadowBlur = 10;
    for (const seg of p.lines) { g.beginPath(); g.moveTo(p.x, p.y); const n = Math.ceil(seg.length * show); for (let i = 0; i < n; i++) g.lineTo(seg[i][0], seg[i][1]); g.stroke(); } g.shadowBlur = 0; }
  g.globalAlpha = 1;
}
let last = performance.now(), lastRaf = 0;
function frame(now) {
  const dt = Math.min(50, now - last); last = now; step(dt); draw();
  trauma = Math.max(0, trauma - dt * .0016); const sh = trauma * trauma * (reduced ? 0 : 1), T = now / 1000;
  zoomT = Math.max(0, zoomT - dt); const z = 1 + zoom * (zoomT > 0 ? ease.out(zoomT / 1400) : 0);
  cam.style.transform = `translate(${sh * 18 * S * Math.sin(T * 61)}px,${sh * 12 * S * Math.sin(T * 79 + 1)}px) rotate(${sh * 1.1 * Math.sin(T * 53)}deg) scale(${z})`;
}
const loop = t => { lastRaf = performance.now(); frame(t); requestAnimationFrame(loop); };
requestAnimationFrame(loop);
setInterval(() => { if (performance.now() - lastRaf > 120) frame(performance.now()); }, 16);

/* ── 도구 ── */
const snd = (n, o) => sfx.file(n, o);
const el = { cap: $('#capsule'), capImg: $('#capsule img'), robot: $('#robot'), dim: $('#dim'), flash: $('#flash'), tint: $('#tint'), stamp: $('#stamp'), card: $('#card'), row: $('#row'), go: $('#go') };
const anim = (e, kf, o) => reduced ? null : e.animate(kf, o);
const flash = (peak, dur) => { if (!reduced) el.flash.animate([{ opacity: peak }, { opacity: 0 }], { duration: dur, easing: 'ease-out' }); };
const dim = async (to, ms) => { el.dim.animate([{ opacity: el.dim.style.opacity || 0 }, { opacity: to }], { duration: ms, fill: 'forwards' }); el.dim.style.opacity = to; await sleep(ms); };
const shake = x => { trauma = Math.min(1, trauma + x); };
let juice = true, busy = false, forced = null, count = 1;

function resetStage() {
  parts = []; el.robot.style.opacity = 0; el.robot.style.filter = ''; el.cap.style.opacity = 0; el.cap.style.filter = ''; el.cap.style.transform = 'translate(-50%,-50%)';
  el.card.style.opacity = 0; el.stamp.style.opacity = 0; el.tint.style.opacity = 0; el.dim.getAnimations().forEach(a => a.cancel()); el.dim.style.opacity = 0; el.row.innerHTML = '';
  el.robot.getAnimations().forEach(a => a.cancel()); el.cap.getAnimations().forEach(a => a.cancel()); el.card.getAnimations().forEach(a => a.cancel()); el.stamp.getAnimations().forEach(a => a.cancel());
  zoomT = 0;
}
function setRobot(id) { const r = ROBOT_TYPES[id]; el.robot.src = `../../assets/${id}.png`; el.robot.className = 'robot flip'; el.card.querySelector('#cn').textContent = r.name; el.card.querySelector('#cs').textContent = r.role; }
function setCard(ti) { const T = TIERS[ti]; $('#cr').textContent = `${T.ko} · ${T.k}`; $('#cr').style.color = T.col; $('#cn').style.color = T.col; }

/* ── 한 기 공개 ── */
const CHARGE = [450, 650, 950, 1500, 2400];
async function reveal(ti, id) {
  const T = TIERS[ti], cx = CX(), cy = CY();
  setRobot(id); setCard(ti);
  if (!juice) {                                                       // 지금 게임 — 캡슐이 돌다가 기체가 튀어나온다
    el.cap.style.opacity = 1; el.cap.animate([{ transform: 'translate(-50%,-50%) rotate(0)' }, { transform: 'translate(-50%,-50%) rotate(360deg)' }], { duration: 700 }); await sleep(700);
    el.cap.style.opacity = 0; el.robot.style.opacity = 1; el.robot.animate([{ transform: 'translate(-50%,-50%) scaleX(-1) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-50%) scaleX(-1) scale(1)', opacity: 1 }], { duration: 400, easing: 'cubic-bezier(.2,1.4,.4,1)' });
    el.card.style.opacity = 1; await sleep(500); return;
  }
  /* 1. 떨어진다 */
  el.cap.style.opacity = 1;
  snd('land', { gain: .45, max: .6 });
  anim(el.cap, [{ transform: 'translate(-50%,-190%) scale(.9)' }, { transform: 'translate(-50%,-50%) scale(1.08,.9)', offset: .55 }, { transform: 'translate(-50%,-56%) scale(.97,1.04)', offset: .75 }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 520, easing: 'ease-in' });
  await sleep(480); spark(cx, cy + 60 * S, 8, { col: ['#aab', '#889'], v: .3, life: 400, grav: .0003 }); shake(.1);
  await sleep(120);
  /* 2. 흔들리며 등급 색이 비친다 — 높은 등급은 처음에 낮은 색을 비췄다가 바뀐다(기대감) */
  const dur = CHARGE[ti], t0 = performance.now();
  const hint = ti >= 3 ? [1, 2, ti] : ti >= 2 ? [1, ti] : [ti];
  const hintT = hint.map((_, i) => dur * (i + 1) / hint.length);
  if (ti >= 2) { snd('enh_charge', { gain: .55, max: dur / 1000 }); converge(cx, cy, T.rgb, 18 + ti * 8, 120 + ti * 20); }
  let hi = -1;
  while (performance.now() - t0 < dur) {
    const u = (performance.now() - t0) / dur, a = (1 + 7 * u * (ti + 1) / 3);
    el.cap.style.transform = `translate(calc(-50% + ${rnd(-a, a)}px),calc(-50% + ${rnd(-a, a) * .6}px)) rotate(${rnd(-a, a) * .35}deg) scale(${1 + .05 * u})`;
    const h = hintT.findIndex(t => performance.now() - t0 < t); const idx = h < 0 ? hint.length - 1 : h;
    if (ti >= 1) { const H_ = TIERS[hint[idx]], k = u > .25 ? (.3 + .7 * u) : 0; el.capImg.style.filter = k ? `drop-shadow(0 0 ${8 + 24 * k}px rgba(${H_.rgb},${.4 + .6 * k})) brightness(${1 + .4 * k})` : '';
      if (idx !== hi) { hi = idx; if (u > .2) { glow(cx, cy, 130, H_.rgb, 260); spark(cx, cy, 10, { col: [H_.col, '#fff'], v: .35, life: 300, grav: 0 }); if (idx > 0 && FX_SOUND()) snd('ui_confirm', { gain: .4, rate: .9 + idx * .15, max: .3 }); } } }
    if (Math.random() < .12 * (ti + 1)) spark(cx + rnd(-50, 50) * S, cy + rnd(-50, 50) * S, 1, { col: [T.col, '#fff'], v: .25, life: 300, grav: 0 });
    await sleep(33);
  }
  el.capImg.style.filter = '';
  /* 3. 터지기 직전 — 높은 등급은 어두워지고 갈라지고 멈춘다 */
  if (ti >= 3) { dim(ti === 4 ? .72 : .45, 260); }
  if (ti >= 3) { crackP(cx, cy, 700 + ti * 200); glow(cx, cy, 120, '255,240,200', 500); snd('anvil_hit', { gain: .6, max: .5 }); shake(.3); await sleep(ti === 4 ? 520 : 300); }
  if (ti === 4) { crackP(cx, cy, 900); glow(cx, cy, 170, '255,200,120', 600); shake(.5); snd('anvil_hit', { gain: .8, max: .5, rate: .8 }); await sleep(420); zoom = .1; zoomT = 1400; await sleep(220); }
  /* 4. 터진다 */
  el.cap.style.opacity = 0;
  const big = ti >= 3;
  flash([.3, .45, .65, .9, 1][ti], [260, 320, 420, 700, 1000][ti]);
  [() => snd('ui_confirm', { gain: .8, max: .4 }), () => snd('enh_success', { gain: .7, max: 1 }), () => snd('levelup', { gain: .8, max: 1.8 }),
   () => { snd('rare_reveal', { gain: 1, max: 2.6 }); }, () => { snd('rare_reveal', { gain: 1, max: 3 }); setTimeout(() => snd('explosion', { gain: .45, max: 1.2 }), 80); }][ti]();
  ring(cx, cy, 110 + ti * 40, T.col, 520 + ti * 100, 6); if (ti >= 1) ring(cx, cy, 80 + ti * 30, '#fff', 420, 4, 60); if (ti >= 2) ring(cx, cy, 160 + ti * 50, T.col, 700, 5, 140); if (ti >= 4) ring(cx, cy, 300, '#ffe58a', 900, 8, 200);
  glow(cx, cy, 160 + ti * 70, T.rgb, 500 + ti * 150);
  spark(cx, cy, [18, 30, 46, 80, 140][ti], { col: [T.col, '#fff', '#ffe58a'], v: .6 + ti * .2, life: 700 + ti * 250, up: .25 });
  if (ti >= 2) beam(cx, T.rgb, 700 + ti * 250, 50 + ti * 24);
  if (ti >= 3) rays(cx, cy, T.rgb, 1500 + (ti - 3) * 1200, ti === 4 ? 18 : 12);
  if (ti >= 3) { beam(cx - 160 * S, T.rgb, 1200, 30); beam(cx + 160 * S, T.rgb, 1200, 30); }
  if (ti === 4) for (let i = 0; i < 40; i++) add({ k: 'spark', x: rnd(0, W), y: -10, vx: rnd(-.05, .05) * S, vy: rnd(.1, .35) * S, life: rnd(1200, 2200), age: rnd(0, 700), w: rnd(1.5, 3.5) * S, col: ['#ffd45a', '#fff3b0', '#ff9a3a'][i % 3], grav: 0 });
  shake([.15, .25, .45, .8, 1][ti]);
  if (ti >= 2) { await sleep(70 + ti * 20); }                         // 터진 순간의 정지
  /* 5. 기체 공개 */
  el.robot.style.opacity = 1;
  if (ti >= 3) {                                                      // 먼저 실루엣 → 빛이 차오르며 색이 돈다
    el.robot.style.filter = 'brightness(0)'; anim(el.robot, [{ transform: 'translate(-50%,-50%) scaleX(-1) scale(.5)', opacity: 0 }, { transform: 'translate(-50%,-50%) scaleX(-1) scale(1.06)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,1.2,.4,1)' });
    await sleep(ti === 4 ? 700 : 420);
    el.robot.style.filter = `drop-shadow(0 0 28px rgba(${T.rgb},.9)) brightness(1.5)`; flash(.5, 300); glow(cx, cy, 240, T.rgb, 500); shake(.35);
    setTimeout(() => el.robot.style.filter = `drop-shadow(0 0 ${ti === 4 ? 26 : 16}px rgba(${T.rgb},.7))`, 320);
  } else {
    anim(el.robot, [{ transform: 'translate(-50%,-50%) scaleX(-1) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-50%) scaleX(-1) scale(1.08)', opacity: 1, offset: .7 }, { transform: 'translate(-50%,-50%) scaleX(-1) scale(1)', opacity: 1 }], { duration: 380 + ti * 80, easing: 'cubic-bezier(.2,1.2,.4,1)' });
    el.robot.style.filter = ti >= 1 ? `drop-shadow(0 0 ${8 + ti * 6}px rgba(${T.rgb},.8))` : '';
    await sleep(300);
  }
  /* 6. 이름표 · 도장 */
  if (T.stamp) { el.stamp.textContent = T.stamp.split('').join(' '); el.stamp.style.color = T.col; anim(el.stamp, [{ opacity: 0, transform: 'translateX(-50%) scale(2.2)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: .3 }, { opacity: 1, transform: 'translateX(-50%) scale(1)' }], { duration: 600, fill: 'forwards', easing: 'cubic-bezier(.2,1.2,.4,1)' }); if (!reduced) {} else el.stamp.style.opacity = 1; if (ti >= 3) shake(.3); }
  el.card.style.opacity = 1; anim(el.card, [{ opacity: 0, transform: 'translateX(-50%) translateY(18px)' }, { opacity: 1, transform: 'translateX(-50%) translateY(0)' }], { duration: 400, easing: 'ease-out' });
  if (ti >= 3) { await dim(0, 800); } else await sleep(500);
}
const FX_SOUND = () => true;

/* ── 한 판(단발 · 10연차) ── */
const bestEl = $('#bestTxt');
async function run() {
  if (busy) return; busy = true; sfx.unlock(); resetStage(); el.go.hidden = true;
  const picks = [];
  for (let i = 0; i < count; i++) picks.push(count === 1 && forced !== null ? forced : rollTier());
  if (count > 1 && forced !== null) picks[count - 1] = forced;
  const best = Math.max(...picks), bi = picks.indexOf(best);
  bestEl.textContent = TIERS[best].ko; bestEl.style.color = TIERS[best].col;
  await dim(0, 1); await reveal(best, robotOf(best));
  if (count > 1) {
    await sleep(300);
    for (const e of [el.card, el.stamp, el.robot]) e.getAnimations().forEach(x => x.cancel());      // 끝 상태를 붙잡고 있는 애니메이션을 풀어야 가려진다
    el.card.style.opacity = 0; el.stamp.style.opacity = 0; el.robot.style.opacity = 0; el.row.innerHTML = '';
    const ids = picks.map(t => robotOf(t));
    ids[bi] = el.robot.src.split('/').pop().replace('.png', '');
    const order = picks.map((t, i) => i).sort((a, b) => picks[a] - picks[b]);          // 낮은 등급부터 — 가장 좋은 것이 마지막에 터진다
    const cells = picks.map((t, i) => { const T = TIERS[t], d = document.createElement('div'); d.className = 'mini'; d.style.setProperty('--c', T.col);
      d.innerHTML = `<img src="../../assets/${ids[i]}.png" alt=""><b>${T.k}</b>`; return d; });
    cells.forEach(c => el.row.appendChild(c));
    for (const [n, i] of order.entries()) {
      const t = picks[i], c = cells[i];
      c.animate([{ opacity: 0, transform: 'translateY(16px) scale(.8)' }, { opacity: 1, transform: 'translateY(0) scale(1.08)', offset: .7 }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 260, fill: 'forwards', easing: 'ease-out' });
      if (juice) { snd(t >= 3 ? 'enh_success' : 'coin_tick', { gain: t >= 3 ? .8 : .4, rate: .85 + n * .06, max: .3 }); if (t >= 2) { const r = c.getBoundingClientRect(), s = stage.getBoundingClientRect(); ring(r.left - s.left + r.width / 2, r.top - s.top + r.height / 2, 50, TIERS[t].col, 400, 4); spark(r.left - s.left + r.width / 2, r.top - s.top + r.height / 2, 10, { col: [TIERS[t].col, '#fff'], v: .4, life: 400 }); } }
      await sleep(juice ? 150 : 40);
    }
    await sleep(600);
  } else await sleep(600);
  el.go.style.bottom = count > 1 ? '38%' : '5%';
  el.go.hidden = false; el.go.textContent = '▶ 다시 뽑기'; busy = false;
}

/* ── 조작판 ── */
const tiersBox = $('#tiers');
TIERS.forEach((T, i) => { const b = document.createElement('button'); b.className = 'b r'; b.style.setProperty('--c', T.col); b.textContent = T.k; b.title = T.ko; b.onclick = () => { forced = i; run(); }; tiersBox.appendChild(b); });
$('#rand').onclick = () => { forced = null; run(); };
$('#go').onclick = () => { forced = null; run(); };
const setCount = n => { count = n; $('#m1').classList.toggle('on', n === 1); $('#m10').classList.toggle('on', n === 10); };
$('#m1').onclick = () => setCount(1); $('#m10').onclick = () => setCount(10);
const setJuice = j => { juice = j; $('#vJuice').classList.toggle('on', j); $('#vNow').classList.toggle('on', !j); $('#modeTxt').textContent = j ? '켬' : '지금 게임'; };
$('#vNow').onclick = () => setJuice(false); $('#vJuice').onclick = () => setJuice(true);
$('#vol').oninput = e => { sfx.setVol(+e.target.value / 100); $('#volOut').textContent = e.target.value + '%'; };
$('#sfxsrc').onchange = e => { sfx.useFiles = e.target.value === 'files'; };
$('#odds').innerHTML = '<tr><th>등급</th><th>기체</th><th>가중치</th></tr>' + ROBOT_RARITY.map((r, i) => `<tr style="--c:${TIERS[i].col}"><td><span class="dot"></span>${r.ko}</td><td>${BY_RARITY[r.k].length}종</td><td>${(r.w / WT * 100).toFixed(1)}%</td></tr>`).join('');
window.__gacha = { run: () => run(), TIERS, state: () => ({ busy, parts: parts.length, trauma: +trauma.toFixed(2) }) };
