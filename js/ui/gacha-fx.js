/* 뽑기 공개 연출 — 표시 전용(proto/juice/gacha.js 를 게임 화면에 옮김 · 2026-10-08).
 * 결과는 서버가 이미 정했다. 여기서는 그 판의 최고 등급을 받아 **캡슐(기본) / 유성** 방식으로 보여 줄 뿐이다.
 * 방식은 GACHA_MODE 한 곳에서 고른다(사용자 결정: 지금은 캡슐, 유성은 다음에 바꿔 본다).
 * '건너뛰기' 를 누르면 곧바로 결과 판(10연차는 줄 세운 결과)으로 간다. 줄인 움직임이면 처음부터 결과 판이다.
 * 소리는 docs/handoff/2026-10-08-juice-to-ui.md 9-1 표 — 성장 소리 7종(enh_* · anvil_hit · levelup · coin_tick · reward_claim)은 쓰지 않는다. */
import { reducedMotion } from './fx-layer.js';

export const GACHA_MODE = 'capsule';                               // 'capsule' | 'meteor'
export const GACHA_TIERS = [
  { k: 'C',  ko: '커먼',   col: '#9aa8b6', rgb: '154,168,182', stamp: '',       stars: 1 },
  { k: 'UC', ko: '언커먼', col: '#4fd192', rgb: '79,209,146',  stamp: '',       stars: 2 },
  { k: 'R',  ko: '레어',   col: '#5aa2ff', rgb: '90,162,255',  stamp: 'RARE',   stars: 3 },
  { k: 'UQ', ko: '유니크', col: '#b58cff', rgb: '181,140,255', stamp: 'UNIQUE', stars: 4 },
  { k: 'EP', ko: '에픽',   col: '#ffab4d', rgb: '255,171,77',  stamp: 'EPIC',   stars: 5 },
];
/* 같은 이름으로 그림을 덮어쓰면(아트 교체) 이 값을 올린다 — /assets/* 는 하루 캐시된다(_headers) */
const GACHA_ART_V = '20261008-webp';
const asset = p => new URL('../../assets/' + p + '?v=' + GACHA_ART_V, import.meta.url).href;
const sleep0 = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = { out: u => 1 - (1 - u) ** 3, in: u => u * u };
const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ── 그림 — 한 번만 불러 둔다. 흰색 투명 그림에 등급 색을 입혀(source-in) 더하기로 얹는다 ── */
const IMG = {}, CAPS = {};
let loaded = false;
export function preloadGachaFx() {
  if (loaded || typeof Image === 'undefined') return; loaded = true;
  for (const n of ['rune-a', 'rune-b', 'rune-c', 'rune-d', 'swirl-energy', 'swirl-cloud', 'ray-burst', 'flare-star', 'flare-streak', 'meteor-head', 'meteor-trail']) {
    const im = new Image(); im.src = asset(`gacha/fx/${n}.webp`); IMG[n] = im;
  }
  for (const k of ['c', 'uc', 'r', 'uq', 'ep', 'uq-crack1', 'ep-crack1', 'ep-crack2']) { const im = new Image(); im.src = asset(`gacha/capsule-${k}.webp`); CAPS[k] = im; }
  const base = new Image(); base.src = asset('gacha/core-capsule.webp'); CAPS.base = base;
}
const ok = im => im && im.complete && im.naturalWidth > 0;
/* 그림이 다 받아지고 풀릴 때까지 — 안 받아진 효과는 그리기에서 조용히 빠지므로(첫 뽑기에 일부만 보였다 · 사용자 제보) 시작 전에 기다린다 */
const ready = im => !im || ok(im) ? Promise.resolve() : im.decode ? im.decode().catch(() => {}) : new Promise(r => { im.addEventListener('load', r, { once: true }); im.addEventListener('error', r, { once: true }); });
const tintCache = new Map();
function tinted(name, rgb) {
  const key = name + '|' + rgb, hit = tintCache.get(key); if (hit) return hit;
  const im = IMG[name]; if (!ok(im)) return null;
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d');
  x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = `rgb(${rgb})`; x.fillRect(0, 0, c.width, c.height);
  tintCache.set(key, c); return c;
}

/* play({ tier, hero:{src, flip}, name, sub, cells:[{src, tier}], sound, stop })
 *   tier  0~4 (C~EP) — 그 판의 최고 등급
 *   rk    파츠의 실제 등급(SR · SSR …) — 있으면 등급 글자를 그것으로 쓴다
 *   cells 10연차일 때 열 칸(받은 순서). 단발이면 비운다
 *   sound(name, opts) · stop() — 소리는 부르는 쪽(audio)이 낸다. stop 은 건너뛰기 때 남은 소리를 끊는다
 * 돌려주는 약속은 사용자가 '확인' 을 누르면 풀린다. */
export function playGacha({ tier = 0, hero = {}, name = '', sub = '', rk = '', cells = [], mode = GACHA_MODE, sound = () => {}, stop = () => {} } = {}) {
  preloadGachaFx();
  tier = Math.max(0, Math.min(4, tier | 0));
  const T = GACHA_TIERS[tier], ten = cells.length > 1;
  const root = document.createElement('div');
  root.className = 'gx'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '뽑기 결과 공개');
  root.innerHTML = `<div class="gx-cam"><div class="gx-bg"></div><canvas class="gx-fxb"></canvas>
    <div class="gx-capsule"><img alt="" draggable="false"></div>
    <div class="gx-robot"><img alt="" draggable="false"></div><div class="gx-robot gx-rc"><img alt="" draggable="false"></div></div>
    <canvas class="gx-fx"></canvas><div class="gx-vig"></div><div class="gx-dim"></div><div class="gx-bar t"></div><div class="gx-bar b"></div><div class="gx-flash"></div>
    <div class="gx-stamp"></div>
    <div class="gx-card"><div class="gx-stars"></div><div class="gx-rar"></div><div class="gx-name"></div><div class="gx-sub"></div></div>
    <div class="gx-row"></div>
    <div class="gx-live" aria-live="polite"></div>
    <button type="button" class="gx-skip" data-audio-silent>건너뛰기 ▶▶</button>
    <button type="button" class="gx-done" hidden>확인</button>
    <svg width="0" height="0" aria-hidden="true" style="position:absolute"><filter id="gx-shock" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="turbulence" baseFrequency="0.012" numOctaves="1" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`;
  document.body.appendChild(root);
  const $ = s => root.querySelector(s);
  const cam = $('.gx-cam'), cvF = $('.gx-fx'), cvB = $('.gx-fxb'), gF = cvF.getContext('2d'), gB = cvB.getContext('2d');
  const el = { cap: $('.gx-capsule'), capImg: $('.gx-capsule img'), robot: $('.gx-robot'), robotC: $('.gx-rc'), dim: $('.gx-dim'), flash: $('.gx-flash'),
    stamp: $('.gx-stamp'), card: $('.gx-card'), stars: $('.gx-stars'), rar: $('.gx-rar'), name: $('.gx-name'), sub: $('.gx-sub'), row: $('.gx-row'),
    vig: $('.gx-vig'), barT: $('.gx-bar.t'), barB: $('.gx-bar.b'), skip: $('.gx-skip'), done: $('.gx-done'), live: $('.gx-live') };
  const shockMap = root.querySelector('feDisplacementMap');
  const reduced = reducedMotion();
  for (const im of root.querySelectorAll('.gx-robot img')) { im.src = hero.src || ''; im.classList.toggle('flip', !!hero.flip); }
  el.robot.classList.toggle('item', !hero.flip); el.robotC.classList.toggle('item', !hero.flip);
  el.rar.textContent = rk ? `${rk} 파츠` : `${T.ko} · ${T.k}`; el.rar.style.color = T.col; el.name.style.color = T.col; el.name.style.setProperty('--c', T.col); el.stars.style.setProperty('--c', T.col);
  el.sub.textContent = sub;

  /* ── 무대 ── */
  let W = 800, H = 500, S = 1, parts = [], trauma = 0, zoom = 0, zoomT = 0, zoomDur = 1400, roll = 0, ts = 1, revealed = false, bobT = 0, alive = true, shardImg = CAPS.base;
  function fit() { W = innerWidth; H = innerHeight; S = Math.min(W / 800, H / 520); const d = Math.min(2, devicePixelRatio || 1);
    for (const [c, g] of [[cvF, gF], [cvB, gB]]) { c.width = W * d; c.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); } }
  fit(); addEventListener('resize', fit);
  const CX = () => W / 2, CY = () => H * .46, FLOOR = () => H * .66;
  const add = o => { o.age = o.age ?? 0; o.L = o.L || 'f'; parts.push(o); return o; };
  const spark = (x, y, n, { col = ['#fff', '#ffe58a'], v = .5, life = 600, up = 0, spread = Math.PI * 2, dir = 0, grav = .0007, L = 'f' } = {}) => {
    for (let i = 0; i < n; i++) { const a = dir + rnd(-.5, .5) * spread, s = rnd(.3, 1) * v * S;
      add({ k: 'spark', L, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - up * S, life: rnd(life * .6, life), w: rnd(1.2, 3) * S, col: col[(Math.random() * col.length) | 0], grav: grav * S }); }
  };
  const ring = (x, y, r1, col, life = 500, w = 5, delay = 0, flat = 1) => add({ k: 'ring', x, y, r0: 8 * S, r1: r1 * S, life, col, w: w * S, age: -delay, flat });
  const glow = (x, y, r, rgb, life = 400, L = 'f') => add({ k: 'glow', L, x, y, r: r * S, rgb, life });
  const beam = (x, rgb, life = 900, w = 80) => add({ k: 'beam', L: 'b', x, rgb, life, w: w * S });
  const rays = (x, y, rgb, life = 1600, n = 14, len = 1.1, alpha = .5) => add({ k: 'rays', L: 'b', x, y, rgb, life, n, len, alpha });
  const flare = (x, y, rgb, life = 700, len = 1.1) => add({ k: 'flare', x, y, rgb, life, len });
  const floorRing = (rgb, rx, life = 1e9) => add({ k: 'floor', L: 'b', rgb, rx: rx * S, life });
  const halo = (x, y, rgb, r, life) => add({ k: 'halo', L: 'b', x, y, rgb, r: r * S, life });
  const ember = (x, y, rgb, n = 1) => { for (let i = 0; i < n; i++) add({ k: 'ember', L: 'b', x: x + rnd(-1, 1) * W * .3, y: y + rnd(-.1, .2) * H, vy: -rnd(.03, .09) * S, vx: rnd(-.015, .015) * S, rgb, life: rnd(1800, 3200), r: rnd(1.2, 3.2) * S, ph: rnd(0, 7) }); };
  const speed = (x, y, rgb, n, life = 340) => { for (let i = 0; i < n; i++) add({ k: 'speed', L: 'b', x, y, a: rnd(0, 7), r0: rnd(60, 120) * S, v: rnd(.9, 1.8) * S, len: rnd(60, 160) * S, rgb, life }); };
  const meteor = (x0, y0, x1, y1, rgb, life = 900) => add({ k: 'meteor', x0, y0, x1, y1, rgb, life });
  const swirl = (x, y, rgb, life = 2000, R = 1, arms = 6) => add({ k: 'swirl', L: 'b', x, y, rgb, life, R, arms });
  const rune = (x, y, rgb, R, life = 2600, flat = 1, spin = 1) => add({ k: 'rune', L: 'b', x, y, rgb, R: R * S, life, flat, spin });
  const burst = (x, y, rgb, life = 700, len = 1) => add({ k: 'burst', x, y, rgb, life, len });
  const converge = (x, y, rgb, n = 30, R = 150) => { for (let i = 0; i < n; i++) add({ k: 'in', x, y, a: rnd(0, 7), R: rnd(R * .5, R) * S, life: rnd(350, 600), age: rnd(-200, 0), rgb }); };
  const crackP = (x, y, life = 1400) => { const lines = []; for (let i = 0; i < 8; i++) { let a = rnd(0, 7), px = x, py = y; const seg = []; for (let j = 0; j < 4; j++) { a += rnd(-.7, .7); px += Math.cos(a) * rnd(8, 18) * S; py += Math.sin(a) * rnd(8, 18) * S; seg.push([px, py]); } lines.push(seg); } add({ k: 'crack', x, y, lines, life }); };
  /* 캡슐 파편 — 그림을 삼각형으로 잘라 날린다(유리가 깨지는 느낌) */
  function shatter(n, power = 1) {
    if (!ok(shardImg)) return;
    const cw = el.cap.getBoundingClientRect().width || W * .22, cx = CX(), cy = CY();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x0 = i / n, x1 = (i + 1) / n, y0 = j / n, y1 = (j + 1) / n;
      for (const t of [[[x0, y0], [x1, y0], [x0, y1]], [[x1, y0], [x1, y1], [x0, y1]]]) {
        const mx = (t[0][0] + t[1][0] + t[2][0]) / 3, my = (t[0][1] + t[1][1] + t[2][1]) / 3, dx = mx - .5, dy = my - .5, d = Math.hypot(dx, dy) || .1;
        if (d > .52) continue;
        const sp = rnd(.25, .7) * power * S;
        add({ k: 'shard', x: cx + dx * cw, y: cy + dy * cw, vx: dx / d * sp * 1.2 + rnd(-.1, .1) * S, vy: dy / d * sp - rnd(.1, .4) * power * S, rot: 0, vr: rnd(-.012, .012) * power, cw, mx, my,
          pts: t.map(p => [(p[0] - mx) * cw, (p[1] - my) * cw]), life: rnd(1100, 1800), grav: .0011 * S });
      }
    }
  }
  function step(dt) {
    dt *= ts;
    for (const p of parts) {
      p.age += dt; if (p.age < 0) continue;
      if (p.k === 'spark' || p.k === 'shard') { p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.k === 'spark') p.vx *= .998 ** dt; else p.rot += p.vr * dt; }
      else if (p.k === 'ember') { p.x += p.vx * dt + Math.sin((p.age + p.ph * 300) / 400) * .02 * S * dt / 16; p.y += p.vy * dt; }
    }
    parts = parts.filter(p => p.age < p.life);
  }
  function drawLayer(g, L) {
    g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (const p of parts) {
      if (p.L !== L || p.age < 0) continue; const u = p.age / p.life;
      if (p.k === 'spark') { g.globalAlpha = 1 - u; g.strokeStyle = p.col; g.lineWidth = p.w; g.beginPath(); g.moveTo(p.x - p.vx * 12, p.y - p.vy * 12); g.lineTo(p.x, p.y); g.stroke(); }
      else if (p.k === 'rune') { if (!tinted('rune-a', p.rgb)) continue; const a = u < .12 ? u / .12 : u > .78 ? (1 - u) / .22 : 1, t = p.age / 1000 * p.spin, D = p.R * 2 / .98;
        g.save(); g.translate(p.x, p.y); g.scale(1, p.flat); g.globalAlpha = .95 * a;
        for (const [n, rot] of [['rune-a', t * .16], ['rune-b', -t * .32], ['rune-c', t * .5], ['rune-d', -t * .85]]) { const im = tinted(n, p.rgb); if (!im) continue; g.save(); g.rotate(rot); g.drawImage(im, -D / 2, -D / 2, D, D); g.restore(); }
        g.restore(); }
      else if (p.k === 'swirl') { const se = tinted('swirl-energy', p.rgb); if (!se) continue; const a = u < .2 ? u / .2 : u > .75 ? (1 - u) / .25 : 1, D = Math.hypot(W, H) * 1.25 * p.R * (.55 + .45 * ease.out(Math.min(1, p.age / 700)));
        const sc = p.arms >= 6 && tinted('swirl-cloud', p.rgb); if (sc) { g.save(); g.translate(p.x, p.y); g.rotate(-p.age / 3200); g.globalAlpha = .7 * a; g.drawImage(sc, -D * .6, -D * .6, D * 1.2, D * 1.2); g.restore(); }
        g.save(); g.translate(p.x, p.y); g.scale(1, .88); g.rotate(p.age / 1500); g.globalAlpha = .85 * a; g.drawImage(se, -D / 2, -D / 2, D, D); g.restore(); }
      else if (p.k === 'burst') { const rb = tinted('ray-burst', p.rgb), rw = tinted('ray-burst', '255,255,255'), fs = tinted('flare-star', '255,255,255'); if (!rb || !rw || !fs) continue;
        const a = 1 - u, e = ease.out(Math.min(1, u * 1.6)), D = (300 + 900 * e) * S * p.len;
        g.save(); g.translate(p.x, p.y); g.rotate(p.age / 4000); g.globalAlpha = a; g.drawImage(rb, -D / 2, -D / 2, D, D); g.globalAlpha = a * .8; g.drawImage(rw, -D * .36, -D * .36, D * .72, D * .72); g.restore();
        const F = (260 + 520 * e) * S; g.globalAlpha = a; g.drawImage(fs, p.x - F / 2, p.y - F / 2, F, F); }
      else if (p.k === 'flare') { const sw = tinted('flare-streak', '255,255,255'), sc = tinted('flare-streak', p.rgb), st = tinted('flare-star', p.rgb); if (!sw || !sc || !st) continue;
        const a = u < .15 ? u / .15 : 1 - (u - .15) / .85, Lw = W * p.len * 1.1, Hh = Lw / 16;
        g.globalAlpha = a; g.drawImage(sw, p.x - Lw / 2, p.y - Hh / 2, Lw, Hh); g.globalAlpha = a * .8; g.drawImage(sc, p.x - Lw / 2, p.y - Hh * 1.6, Lw, Hh * 3.2);
        const F = 360 * S * (.6 + .4 * a); g.globalAlpha = a * .9; g.drawImage(st, p.x - F / 2, p.y - F / 2, F, F); }
      else if (p.k === 'meteor') { const tr = tinted('meteor-trail', p.rgb), tw = tinted('meteor-trail', '255,255,255'), hd = tinted('meteor-head', p.rgb), hw = tinted('meteor-head', '255,255,255'); if (!tr || !tw || !hd || !hw) continue;
        const q = ease.in(u), x = p.x0 + (p.x1 - p.x0) * q, y = p.y0 + (p.y1 - p.y0) * q, ang = Math.atan2(p.y1 - p.y0, p.x1 - p.x0), L2 = 420 * S * Math.min(1, u * 3);
        g.save(); g.translate(x, y); g.rotate(ang); g.globalAlpha = 1; g.drawImage(tr, -L2, -22 * S, L2, 44 * S); g.drawImage(tw, -L2 * .7, -9 * S, L2 * .7, 18 * S); g.restore();
        const H2 = 150 * S; g.drawImage(hd, x - H2 / 2, y - H2 / 2, H2, H2); const H3 = 70 * S; g.drawImage(hw, x - H3 / 2, y - H3 / 2, H3, H3); }
      else if (p.k === 'ring') { const r = p.r0 + (p.r1 - p.r0) * ease.out(u); g.globalAlpha = 1 - u; g.strokeStyle = p.col; g.lineWidth = Math.max(.1, p.w * (1 - u)); g.beginPath(); g.ellipse(p.x, p.y, r, r * p.flat, 0, 0, 7); g.stroke(); }
      else if (p.k === 'glow') { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); gr.addColorStop(0, `rgba(${p.rgb},${.85 * (1 - u)})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
      else if (p.k === 'beam') { const a = u < .12 ? u / .12 : 1 - (u - .12) / .88, w = p.w * (1 - u * .6), gr = g.createLinearGradient(p.x - w, 0, p.x + w, 0);
        gr.addColorStop(0, `rgba(${p.rgb},0)`); gr.addColorStop(.5, `rgba(${p.rgb},${.8 * a})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(p.x - w, 0, w * 2, H); }
      else if (p.k === 'rays') { const a = u < .1 ? u / .1 : 1 - (u - .1) / .9, rot = p.age / 2600, L2 = Math.hypot(W, H) * p.len; g.globalAlpha = p.alpha * a; g.fillStyle = `rgb(${p.rgb})`;
        for (let i = 0; i < p.n; i++) { const a0 = rot + i * Math.PI * 2 / p.n, a1 = a0 + Math.PI / p.n * .5; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + Math.cos(a0) * L2, p.y + Math.sin(a0) * L2); g.lineTo(p.x + Math.cos(a1) * L2, p.y + Math.sin(a1) * L2); g.closePath(); g.fill(); } }
      else if (p.k === 'in') { const q = ease.in(u), R = p.R * (1 - q), R2 = p.R * (1 - Math.max(0, q - .12));
        g.globalAlpha = .25 + .75 * q; g.strokeStyle = `rgb(${p.rgb})`; g.lineWidth = (1 + 1.6 * q) * S; g.beginPath(); g.moveTo(p.x + Math.cos(p.a) * R2, p.y + Math.sin(p.a) * R2); g.lineTo(p.x + Math.cos(p.a) * R, p.y + Math.sin(p.a) * R); g.stroke(); }
      else if (p.k === 'speed') { const r = p.r0 + p.v * p.age, l = p.len * (1 - u * .5); g.globalAlpha = (1 - u) * .7; g.strokeStyle = `rgb(${p.rgb})`; g.lineWidth = 1.4 * S; g.beginPath(); g.moveTo(p.x + Math.cos(p.a) * r, p.y + Math.sin(p.a) * r); g.lineTo(p.x + Math.cos(p.a) * (r + l), p.y + Math.sin(p.a) * (r + l)); g.stroke(); }
      else if (p.k === 'ember') { const f = .6 + .4 * Math.sin((p.age + p.ph * 100) / 120), a = Math.min(1, p.age / 400) * (u > .75 ? (1 - u) * 4 : 1);
        const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4); gr.addColorStop(0, `rgba(${p.rgb},${.9 * a * f})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r * 4, 0, 7); g.fill(); }
      else if (p.k === 'halo') { const a = u < .15 ? u / .15 : u > .8 ? (1 - u) / .2 : 1; g.globalAlpha = .75 * a; g.strokeStyle = `rgb(${p.rgb})`; g.lineWidth = 2 * S;
        for (const [k, dir] of [[1, 1], [1.28, -1]]) { g.setLineDash([22 * S, 14 * S]); g.lineDashOffset = -p.age * .05 * dir; g.beginPath(); g.arc(p.x, p.y, p.r * k * (.9 + .1 * Math.sin(p.age / 300)), 0, 7); g.stroke(); } g.setLineDash([]); }
      else if (p.k === 'floor') { const a = Math.min(1, p.age / 500), y = FLOOR(), x = CX();
        const gr = g.createRadialGradient(x, y, 0, x, y, p.rx); gr.addColorStop(0, `rgba(${p.rgb},${.35 * a})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, p.rx, p.rx * .22, 0, 0, 7); g.fill();
        g.globalAlpha = .8 * a; g.strokeStyle = `rgb(${p.rgb})`; g.lineWidth = 2 * S; g.setLineDash([26 * S, 12 * S]); g.lineDashOffset = -p.age * .03; g.beginPath(); g.ellipse(x, y, p.rx * .8, p.rx * .8 * .22, 0, 0, 7); g.stroke();
        g.setLineDash([6 * S, 10 * S]); g.lineDashOffset = p.age * .04; g.beginPath(); g.ellipse(x, y, p.rx * .62, p.rx * .62 * .22, 0, 0, 7); g.stroke(); g.setLineDash([]); }
    }
    g.globalCompositeOperation = 'source-over';
    if (L === 'f') for (const p of parts) {
      if (p.age < 0) continue; const u = p.age / p.life;
      if (p.k === 'crack') { const a = u < .75 ? 1 : 1 - (u - .75) / .25, show = Math.min(1, p.age / 200);
        g.globalAlpha = a; g.strokeStyle = '#fff3c4'; g.lineWidth = 2 * S; g.shadowColor = '#ffb03a'; g.shadowBlur = 10;
        for (const seg of p.lines) { g.beginPath(); g.moveTo(p.x, p.y); const n = Math.ceil(seg.length * show); for (let i = 0; i < n; i++) g.lineTo(seg[i][0], seg[i][1]); g.stroke(); } g.shadowBlur = 0; }
      if (p.k === 'shard') { g.save(); g.globalAlpha = u > .7 ? 1 - (u - .7) / .3 : 1; g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); p.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.clip();
        g.drawImage(shardImg, -p.mx * p.cw, -p.my * p.cw, p.cw, p.cw); g.restore(); }
    }
    g.globalAlpha = 1;
  }
  let last = performance.now(), raf = 0;
  function frame(now) {
    const dt = Math.min(50, now - last); last = now; step(dt); drawLayer(gB, 'b'); drawLayer(gF, 'f');
    trauma = Math.max(0, trauma - dt * .0016); const sh = reduced ? 0 : trauma * trauma, t = now / 1000;
    zoomT = Math.max(0, zoomT - dt); const z = 1 + zoom * (zoomT > 0 ? ease.out(zoomT / zoomDur) : 0);
    cam.style.transform = `translate(${sh * 18 * S * Math.sin(t * 61)}px,${sh * 12 * S * Math.sin(t * 79 + 1)}px) rotate(${sh * 1.1 * Math.sin(t * 53) + roll}deg) scale(${z})`;
    if (revealed && !reduced) { bobT += dt; const b = Math.sin(bobT / 700) * 5 * S + 'px'; el.robot.style.marginTop = b; el.robotC.style.marginTop = b; }
  }
  const loop = t => { if (!alive) return; frame(t); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  /* ── 도구 ── */
  const SKIP = Symbol('skip'); let skipped = false; const waiters = new Set();
  const wait = ms => { if (skipped) return Promise.reject(SKIP); return new Promise((res, rej) => { const w = () => { clearTimeout(t); rej(SKIP); }, t = setTimeout(() => { waiters.delete(w); res(); }, ms); waiters.add(w); }); };
  const later = (ms, fn) => setTimeout(() => { if (alive && !skipped) fn(); }, ms);
  const snd = (n, o) => { if (!skipped) sound(n, o); };
  const anim = (e, kf, o) => reduced ? null : e.animate(kf, o);
  const both = (kf, o) => { anim(el.robot, kf, o); anim(el.robotC, kf, o); };
  let lastFlash = -1e9;
  const flash = (peak, dur, col = '#fff') => { if (reduced) return; const now = performance.now(); if (now - lastFlash < 340) return; lastFlash = now;    // 광과민성 — 0.34초 간격 제한
    el.flash.style.background = col; el.flash.animate([{ opacity: peak }, { opacity: 0 }], { duration: dur, easing: 'ease-out' }); };
  const dimTo = async (to, ms) => { const from = +getComputedStyle(el.dim).opacity || 0; el.dim.getAnimations().forEach(a => a.cancel()); el.dim.animate([{ opacity: from }, { opacity: to }], { duration: ms, fill: 'forwards' }); el.dim.style.opacity = to; await wait(ms); };
  const shake = x => { trauma = Math.min(1, trauma + x); };
  const slowmo = (ms, k) => { ts = k; setTimeout(() => ts = 1, ms); };
  const vignette = (col, op, ms) => { el.vig.style.setProperty('--vc', col); el.vig.animate([{ opacity: +getComputedStyle(el.vig).opacity || 0 }, { opacity: op }], { duration: ms, fill: 'forwards' }); el.vig.style.opacity = op; };
  const letterbox = (on, ms = 500) => { const h = on ? '11%' : '0%'; for (const b of [el.barT, el.barB]) { b.getAnimations().forEach(a => a.cancel()); b.animate([{ height: b.style.height || '0%' }, { height: h }], { duration: ms, fill: 'forwards', easing: 'ease-in-out' }); b.style.height = h; } };
  let shockBusy = false;
  function shockwave(power = 40, ms = 700) {
    if (reduced || shockBusy) return; shockBusy = true; const t0 = performance.now(); cam.style.filter = 'url(#gx-shock)';
    const iv = setInterval(() => { const u = (performance.now() - t0) / ms; if (u >= 1 || !alive) { clearInterval(iv); shockMap.setAttribute('scale', 0); cam.style.filter = ''; shockBusy = false; return; } shockMap.setAttribute('scale', (power * Math.sin(Math.PI * Math.sqrt(u))).toFixed(1)); }, 16);
  }

  /* 별 도장 — 하나씩 튀어 나온다 */
  async function starStamp() {
    el.stars.style.opacity = 1; el.stars.innerHTML = ''; el.name.textContent = ''; el.sub.style.opacity = 0;
    el.card.getAnimations().forEach(a => a.cancel()); el.card.style.opacity = 1;
    for (let i = 0; i < T.stars; i++) {
      const s = document.createElement('span'); s.textContent = '★'; el.stars.appendChild(s);
      s.animate([{ opacity: 0, transform: 'scale(0) rotate(-90deg)' }, { opacity: 1, transform: 'scale(1.8) rotate(10deg)', offset: .55 }, { opacity: 1, transform: 'scale(1) rotate(0)' }], { duration: 380, fill: 'forwards', easing: 'ease-out' });
      const r = s.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      spark(x, y, 8, { col: [T.col, '#fff'], v: .35, life: 400, grav: 0 }); ring(x, y, 26, T.col, 300, 3);
      snd('hit_light_b', { gain: .55, rate: .85 + i * .1, max: .25 });
      await wait(tier >= 3 ? 170 : 110);
    }
  }
  /* 이름 — 글자가 하나씩 떨어지고, 높은 등급은 빛이 한 번 훑는다 */
  async function nameDrop() {
    el.name.classList.remove('shine'); el.name.textContent = '';
    el.sub.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: name.length * 45, fill: 'forwards' });
    [...name].forEach((ch, i) => { const s = document.createElement('span'); s.textContent = ch === ' ' ? ' ' : ch; el.name.appendChild(s);
      s.animate([{ opacity: 0, transform: `translateY(${-30 - tier * 6}px) scale(1.6)`, filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 360, delay: i * 45, fill: 'backwards', easing: 'cubic-bezier(.2,1.3,.4,1)' }); });
    await wait(name.length * 45 + 300);
    if (tier >= 3) el.name.classList.add('shine');
  }

  /* ── 유성 방식(원신식) ── */
  async function meteorSeq() {
    const cx = CX(), cy = CY(), hi = tier >= 3, col = tier <= 1 ? '120,190,255' : T.rgb;
    if (tier >= 2) { swirl(cx, cy, hi ? T.rgb : '150,190,255', hi ? 2400 : 1500, hi ? 1 : .8, hi ? 7 : 5); snd('beam_charge', { gain: .55, max: 1.6 }); }
    if (hi) { for (let i = 0; i < 4; i++) later(300 + i * 260, () => shake(.1)); await wait(1100); }
    else if (tier >= 2) await wait(600);
    const n = tier === 4 ? 3 : tier === 3 ? 2 : 1;
    for (let i = 0; i < n; i++) { meteor(W * (.75 + i * .12), -40 * S, cx + (i - (n - 1) / 2) * 24 * S, cy, col, 1000 - tier * 60); snd('beam_fire', { gain: .5, max: .9, rate: 1.1 + i * .1 }); await wait(180); }
    await wait(760 - tier * 40);
    if (hi) shake(.4);
  }

  /* ── 캡슐 방식 ── */
  const CHARGE = [450, 700, 1100, 1700, 2600];
  async function capsuleSeq() {
    const cx = CX(), cy = CY(), hi = tier >= 3, epic = tier === 4, ck = T.k.toLowerCase();
    el.capImg.src = asset(`gacha/capsule-${ck}.webp`); shardImg = ok(CAPS[ck]) ? CAPS[ck] : CAPS.base;
    el.cap.style.opacity = 1;
    anim(el.cap, [{ transform: 'translate(-50%,-200%) scale(.9)' }, { transform: 'translate(-50%,-50%) scale(1.1,.88)', offset: .55 }, { transform: 'translate(-50%,-58%) scale(.96,1.05)', offset: .75 }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 560, easing: 'ease-in' });
    await wait(520); snd('land', { gain: .6, max: .6 });
    spark(cx, cy + 62 * S, 10, { col: ['#aab', '#889'], v: .35, life: 450, grav: .0003 }); ring(cx, FLOOR(), 120, T.col, 450, 3, 0, .22); shake(.15);
    await wait(140);
    /* 기를 모은다 — 흔들림이 커지고 등급 색이 비친다. 높은 등급은 처음에 낮은 색이 비쳤다가 바뀐다(기대감) */
    const dur = CHARGE[tier], t0 = performance.now();
    const hint = epic ? [1, 2, 3, 4] : tier === 3 ? [1, 2, 3] : tier >= 2 ? [1, tier] : [tier];
    const hintT = hint.map((_, i) => dur * (i + 1) / hint.length);
    snd('windup', { gain: .6, max: .5 });
    if (tier >= 2) { converge(cx, cy, T.rgb, 20 + tier * 12, 170 + tier * 20); halo(cx, cy, T.rgb, 85 + tier * 6, dur); }
    if (hi) speed(cx, cy, T.rgb, 18, 380);
    let hiIdx = -1, lastSpeed = 0;
    while (performance.now() - t0 < dur) {
      const u = (performance.now() - t0) / dur, a = 1 + 8 * u * (tier + 1) / 3;
      el.cap.style.transform = `translate(calc(-50% + ${rnd(-a, a)}px),calc(-50% + ${rnd(-a, a) * .6}px)) rotate(${rnd(-a, a) * .35}deg) scale(${1 + .06 * u})`;
      const h = hintT.findIndex(t => performance.now() - t0 < t), idx = h < 0 ? hint.length - 1 : h;
      if (tier >= 1) { const HT = GACHA_TIERS[hint[idx]], k = u > .22 ? (.3 + .7 * u) : 0; el.capImg.style.filter = k ? `drop-shadow(0 0 ${8 + 28 * k}px rgba(${HT.rgb},${.4 + .6 * k})) brightness(${1 + .45 * k})` : '';
        if (idx !== hiIdx) { hiIdx = idx; if (u > .2) { glow(cx, cy, 150, HT.rgb, 300); flash(.12 + idx * .05, 160, `rgb(${HT.rgb})`); spark(cx, cy, 12, { col: [HT.col, '#fff'], v: .4, life: 350, grav: 0 }); if (idx > 0) snd('windup', { gain: .5, rate: .9 + idx * .15, max: .4 }); } } }
      if (hi && performance.now() - lastSpeed > 220 - 120 * u) { lastSpeed = performance.now(); speed(cx, cy, T.rgb, 4 + (u * 8 | 0), 320); }
      if (tier >= 2 && Math.random() < .3) ember(cx, H * .55, T.rgb, 1);
      if (Math.random() < .12 * (tier + 1)) spark(cx + rnd(-50, 50) * S, cy + rnd(-50, 50) * S, 1, { col: [T.col, '#fff'], v: .25, life: 300, grav: 0 });
      await wait(33);
    }
    el.capImg.style.filter = '';
    /* 터지기 직전 — 어두워지고 갈라진다. 에픽은 줌 인 + 정지 */
    if (hi) { el.capImg.src = asset(`gacha/capsule-${ck}-crack1.webp`); dimTo(epic ? .62 : .4, 300).catch(() => {}); crackP(cx, cy, 900 + tier * 200); glow(cx, cy, 130, '255,240,200', 600); snd('parry', { gain: .8, max: .6 }); shake(.35); await wait(epic ? 480 : 320); }
    if (epic) {
      el.capImg.src = asset('gacha/capsule-ep-crack2.webp'); crackP(cx, cy, 1100); glow(cx, cy, 190, '255,210,140', 700); shake(.55); snd('parry', { gain: 1, max: .6, rate: .8 });
      zoom = .14; zoomT = zoomDur = 1800; roll = -.8; await wait(420);
      el.capImg.style.filter = 'brightness(3) saturate(.3) drop-shadow(0 0 40px #fff)'; anim(el.cap, [{ transform: 'translate(-50%,-50%) scale(1.06)' }, { transform: 'translate(-50%,-50%) scale(1.22)' }], { duration: 380, fill: 'forwards', easing: 'ease-in' });
      await wait(380);
      ts = 0; await wait(260); ts = 1;                                   // 숨 멎는 정지
    }
  }

  async function burstAndReveal() {
    const cx = CX(), cy = CY(), hi = tier >= 3, epic = tier === 4;
    el.cap.style.opacity = 0; roll = 0;
    flash([.35, .5, .7, .95, 1][tier], [260, 340, 480, 800, 1200][tier], tier >= 4 ? '#fff6dc' : '#fff');
    snd(tier === 4 ? 'explosion' : tier === 3 ? 'hit_heavy_a' : 'hit_heavy_b', { gain: .9, max: 1.4 });
    if (tier >= 1 && mode === 'capsule') shatter(tier >= 3 ? 5 : tier === 2 ? 4 : 3, .6 + tier * .35);
    if (tier >= 1) burst(cx, cy, T.rgb, 600 + tier * 140, .6 + tier * .2);
    if (tier >= 2) rune(cx, cy, T.rgb, [0, 0, 150, 200, 250][tier], 2600 + tier * 700, 1, tier >= 4 ? 1.2 : 1);
    if (tier >= 3) rune(cx, FLOOR(), T.rgb, 330 + (tier - 3) * 120, 3400 + tier * 500, .2, -1.4);
    if (hi && mode === 'capsule') swirl(cx, cy, T.rgb, 1800 + (tier - 3) * 700, .9, 6);
    if (epic) rune(cx, cy, '255,235,170', 340, 5200, 1, -.6);
    ring(cx, cy, 120 + tier * 45, T.col, 520 + tier * 100, 6); if (tier >= 1) ring(cx, cy, 90 + tier * 30, '#fff', 420, 4, 60); if (tier >= 2) ring(cx, cy, 190 + tier * 60, T.col, 760, 5, 140);
    if (epic) { ring(cx, cy, 340, '#ffe58a', 1000, 9, 200); ring(cx, FLOOR(), 420, T.col, 900, 5, 120, .22); }
    glow(cx, cy, 170 + tier * 70, T.rgb, 520 + tier * 160);
    spark(cx, cy, [20, 34, 52, 90, 160][tier], { col: [T.col, '#fff', '#ffe58a'], v: .65 + tier * .2, life: 760 + tier * 260, up: .25 });
    if (tier >= 2) { beam(cx, T.rgb, 800 + tier * 260, 46 + tier * 24); flare(cx, cy, T.rgb, 500 + tier * 250, 1 + tier * .1); }
    if (hi) { rays(cx, cy, T.rgb, 2200 + (epic ? 2200 : 0), epic ? 20 : 14, 1.1, epic ? .6 : .5); beam(cx - 170 * S, T.rgb, 1200, 28); beam(cx + 170 * S, T.rgb, 1200, 28); shockwave(epic ? 60 : 36, epic ? 900 : 650); }
    if (epic) { ember(cx, H * .7, '255,200,110', 36); for (let i = 0; i < 46; i++) add({ k: 'spark', x: rnd(0, W), y: -10, vx: rnd(-.05, .05) * S, vy: rnd(.1, .35) * S, life: rnd(1200, 2400), age: rnd(0, 800), w: rnd(1.5, 3.5) * S, col: ['#ffd45a', '#fff3b0', '#ff9a3a'][i % 3], grav: 0 }); slowmo(700, .25); }
    shake([.2, .3, .5, .85, 1][tier]);
    if (tier >= 2) await wait(80 + tier * 20);
    /* 공개 — 높은 등급은 실루엣이 먼저 서고, 빛이 왼쪽에서 오른쪽으로 훑으며 색을 입힌다 */
    el.robot.style.opacity = 1;
    const kf = [{ transform: 'translate(-50%,-44%) scale(.55)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.06)', opacity: 1, offset: .7 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }];
    const reveal = () => { snd(tier === 4 ? 'rare_reveal' : tier === 3 ? 'rare_reveal' : tier === 2 ? 'shield' : 'ui_confirm', { gain: 1, max: 3 }); if (epic) later(250, () => snd('win', { gain: .8, max: 3 })); };
    if (tier >= 2) {
      el.robot.style.filter = 'brightness(0)'; el.robotC.style.opacity = 1; el.robotC.style.filter = `drop-shadow(0 0 ${12 + tier * 6}px rgba(${T.rgb},.85))`;
      both(kf, { duration: 520, easing: 'cubic-bezier(.2,1.2,.4,1)' });
      await wait(epic ? 800 : hi ? 460 : 240);
      const scan = [320, 520, 900][tier - 2]; el.robotC.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: scan, fill: 'forwards', easing: 'ease-in-out' }); el.robotC.style.clipPath = 'inset(0 0 0 0)';
      const sx0 = cx - W * .12, sx1 = cx + W * .12, t1 = performance.now();
      const iv = setInterval(() => { const u = (performance.now() - t1) / scan; if (u >= 1 || !alive) return clearInterval(iv); spark(sx0 + (sx1 - sx0) * u, H * (.25 + Math.random() * .4), 2, { col: [T.col, '#fff'], v: .3, life: 300, grav: 0 }); }, 30);
      reveal();
      await wait(scan);
      el.robot.style.filter = ''; flash(.35 + (tier - 2) * .1, 280); glow(cx, cy, 260, T.rgb, 520); shake(.3 + (tier - 2) * .1); if (hi) flare(cx, cy, T.rgb, 600, 1.2);
    } else {
      both(kf, { duration: 380 + tier * 80, easing: 'cubic-bezier(.2,1.2,.4,1)' }); el.robotC.style.opacity = 0;
      el.robot.style.filter = tier >= 1 ? `drop-shadow(0 0 ${8 + tier * 6}px rgba(${T.rgb},.8))` : ''; reveal(); await wait(320);
    }
    revealed = true; bobT = 0;
    /* 별 · 도장 · 이름 — 레터박스는 여기서 걷는다(검은 띠가 도장과 이름 판을 가리지 않게) */
    if (hi) { letterbox(false, 450); vignette('#000', 0, 700); }
    if (T.stamp) { el.stamp.textContent = T.stamp.split('').join(' '); el.stamp.style.color = T.col; anim(el.stamp, [{ opacity: 0, transform: 'translateX(-50%) scale(2.4)', filter: 'blur(6px)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)', filter: 'blur(0)', offset: .3 }, { opacity: 1, transform: 'translateX(-50%) scale(1)' }], { duration: 620, fill: 'forwards', easing: 'cubic-bezier(.2,1.2,.4,1)' }); el.stamp.style.opacity = 1; if (hi) shake(.3); }
    await starStamp();
    await nameDrop();
    if (hi) await dimTo(0, 700); else await wait(300);
  }

  /* 10연차 — 낮은 등급부터 줄 세운다. 가장 좋은 것이 마지막에 터진다 */
  function buildRow() {
    el.row.innerHTML = '';
    return cells.map(c => { const C = GACHA_TIERS[Math.max(0, Math.min(4, c.tier | 0))], d = document.createElement('div'); d.className = 'gx-mini' + (c.flip ? ' robot' : ''); d.style.setProperty('--c', C.col);
      d.innerHTML = `<img src="${escHtml(c.src)}" alt=""><b>${escHtml(c.rk || C.k)}</b>${c.label ? `<small>${escHtml(c.label)}</small>` : ''}`; el.row.appendChild(d); return d; });
  }
  async function lineUp() {
    for (const e of [el.card, el.stamp, el.robot, el.robotC, el.stars]) { e.getAnimations().forEach(x => x.cancel()); e.style.opacity = 0; }
    revealed = false; parts = [];
    el.row.classList.add('on');
    const els = buildRow(), order = cells.map((c, i) => i).sort((a, b) => (cells[a].tier | 0) - (cells[b].tier | 0));
    for (const [n, i] of order.entries()) {
      const t = cells[i].tier | 0, c = els[i];
      c.animate([{ opacity: 0, transform: 'translateY(16px) scale(.8)' }, { opacity: 1, transform: 'translateY(0) scale(1.08)', offset: .7 }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 260, fill: 'forwards', easing: 'ease-out' });
      snd('ui_click', { gain: .5, rate: .85 + n * .06, max: .3 });
      if (t >= 2) { const r = c.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; ring(x, y, 50, GACHA_TIERS[t].col, 400, 4); spark(x, y, 12, { col: [GACHA_TIERS[t].col, '#fff'], v: .4, life: 450 }); }
      await wait(150);
    }
  }

  /* 결과 판 — 건너뛰기 · 줄인 움직임 · 끝까지 본 경우가 모두 여기로 모인다 */
  function finalBoard() {
    for (const e of [el.cap, el.dim, el.vig, el.flash, el.barT, el.barB, el.robot, el.robotC, el.card, el.stamp, el.stars, ...el.row.children]) e.getAnimations().forEach(a => a.cancel());
    parts = []; ts = 1; zoomT = 0; trauma = 0; roll = 0; cam.style.filter = ''; shockMap.setAttribute('scale', 0);
    el.cap.style.opacity = 0; el.dim.style.opacity = 0; el.vig.style.opacity = 0; el.barT.style.height = el.barB.style.height = '0%';
    if (ten) {
      for (const e of [el.robot, el.robotC, el.card, el.stamp]) e.style.opacity = 0;
      el.row.classList.add('on'); const els = el.row.children.length === cells.length ? [...el.row.children] : buildRow();
      for (const c of els) { c.style.opacity = 1; c.style.transform = 'none'; }
    } else {
      el.robot.style.opacity = 1; el.robot.style.filter = tier >= 1 ? `drop-shadow(0 0 ${8 + tier * 6}px rgba(${T.rgb},.8))` : ''; el.robotC.style.opacity = 0;
      el.card.style.opacity = 1; el.stars.style.opacity = 1; el.stars.innerHTML = '<span>★</span>'.repeat(T.stars); for (const s of el.stars.children) { s.style.opacity = 1; s.style.transform = 'none'; }
      el.name.textContent = name; el.sub.style.opacity = 1;
      if (T.stamp) { el.stamp.textContent = T.stamp.split('').join(' '); el.stamp.style.color = T.col; el.stamp.style.opacity = 1; }
      floorRing(T.rgb, 190 + tier * 20); revealed = !reduced;
    }
    el.live.textContent = ten ? `10연차 결과 · 최고 ${T.ko} ${name}` : `${T.ko} ${name}`;
    el.skip.hidden = true; el.done.hidden = false; el.done.focus({ preventScroll: true });
  }

  return new Promise(resolve => {
    let finished = false;
    const close = () => {
      if (finished) return; finished = true; alive = false; skipped = true;
      for (const w of [...waiters]) w(); cancelAnimationFrame(raf); removeEventListener('resize', fit); removeEventListener('keydown', key, true);
      root.remove(); resolve();
    };
    const skip = () => { if (skipped) return; skipped = true; stop(); for (const w of [...waiters]) w(); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); if (!el.done.hidden) close(); else skip(); } };
    addEventListener('keydown', key, true);
    el.skip.onclick = skip; el.done.onclick = close;
    el.skip.focus({ preventScroll: true });
    (async () => {
      try {
        if (reduced) throw SKIP;
        { const ck = T.k.toLowerCase(), cellImgs = cells.map(c => { const im = new Image(); im.src = c.src; return im; });
          const need = [...Object.values(IMG), CAPS[ck], CAPS[ck + '-crack1'], tier === 4 ? CAPS['ep-crack2'] : null, CAPS.base, ...root.querySelectorAll('.gx-robot img'), ...cellImgs];
          await Promise.race([Promise.all(need.map(ready)), sleep0(2500)]);
          if (skipped) throw SKIP; }
        /* 무대를 연다 — 바닥 고리 · (높은 등급은) 레터박스 */
        floorRing(tier >= 3 ? '150,170,200' : T.rgb, 190 + tier * 20); if (tier >= 2) ember(CX(), H * .6, T.rgb, 6 + tier * 4);
        if (tier >= 3) { letterbox(true, 600); vignette('#02040a', .7, 700); snd('miss', { gain: .7, max: .5 }); }
        if (mode === 'meteor') await meteorSeq(); else await capsuleSeq();
        await burstAndReveal();
        if (ten) { await wait(300); await lineUp(); }
        await wait(500);
      } catch (e) { if (e !== SKIP) console.error(e); }
      if (!finished) finalBoard();
    })();
  });
}
