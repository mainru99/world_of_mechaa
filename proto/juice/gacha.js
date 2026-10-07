/* 뽑기 연출 시험대 — 등급이 높을수록 오래 · 크게 · 밝게. (2026-10-08 · 2판: 영화처럼)
 * 등급 가중치는 게임의 ROBOT_RARITY 그대로, 기체는 BY_RARITY 에서 무작위로 고른다.
 *
 * 흐름: 캡슐이 떨어진다 → 흔들리며 등급 색이 비친다 → 갈라지며 **유리처럼 깨진다** → 빛이 기체 뒤에서 쏟아진다 → 실루엣이 빛으로 물든다 → 별 · 이름.
 * 화면 층 — 뒤 캔버스(빛줄기 · 바닥 고리 · 불씨: 기체 **뒤**라 기체가 역광으로 서 보인다) / 기체 / 앞 캔버스(조각 · 불꽃 · 렌즈 플레어).
 * 연출 도구 — 레터박스 · 비네트 · 시간 늦추기 · 충격파(화면 일그러짐) · 카메라 줌 · 파편 · 애너모픽 스트릭 · 별 도장. */
import { ROBOT_TYPES, ROBOT_RARITY } from '../../data/balance.js';
import { BY_RARITY } from '../../js/gacha.js';
import { Sfx } from './sfx.js?v=1008d';

const $ = s => document.querySelector(s);
const sfx = new Sfx();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = { out: u => 1 - (1 - u) ** 3, in: u => u * u, inOut: u => u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2 };

const TIERS = [
  { k: 'C',  ko: '커먼',   col: '#9aa8b6', rgb: '154,168,182', stamp: '',       stars: 1 },
  { k: 'UC', ko: '언커먼', col: '#4fd192', rgb: '79,209,146',  stamp: '',       stars: 2 },
  { k: 'R',  ko: '레어',   col: '#5aa2ff', rgb: '90,162,255',  stamp: 'RARE',   stars: 3 },
  { k: 'UQ', ko: '유니크', col: '#b58cff', rgb: '181,140,255', stamp: 'UNIQUE', stars: 4 },
  { k: 'EP', ko: '에픽',   col: '#ffab4d', rgb: '255,171,77',  stamp: 'EPIC',   stars: 5 },
];
const W_ = ROBOT_RARITY.map(r => r.w), WT = W_.reduce((a, b) => a + b, 0);
const rollTier = () => { let r = Math.random() * WT; for (let i = 0; i < W_.length; i++) if ((r -= W_[i]) <= 0) return i; return 0; };
const robotOf = ti => { const l = BY_RARITY[TIERS[ti].k]; return l[(Math.random() * l.length) | 0]; };

/* ── 무대 · 두 캔버스 ── */
const stage = $('#stage'), cam = $('#cam'), cvF = $('#fx'), cvB = $('#fxb'), gF = cvF.getContext('2d'), gB = cvB.getContext('2d');
let W = 800, H = 500, S = 1, parts = [], trauma = 0, zoom = 0, zoomT = 0, zoomDur = 1400, roll = 0, ts = 1, revealed = false;
function fit() { const r = stage.getBoundingClientRect(); W = r.width; H = r.height; S = W / 800; const d = Math.min(2, devicePixelRatio || 1);
  for (const [c, g] of [[cvF, gF], [cvB, gB]]) { c.width = W * d; c.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); } }
new ResizeObserver(fit).observe(stage); fit();
const capImg = new Image(); capImg.src = '../../assets/gacha/core-capsule.png';
const CX = () => W / 2, CY = () => H * .52, FLOOR = () => H * .84;
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
const ember = (x, y, rgb, n = 1) => { for (let i = 0; i < n; i++) add({ k: 'ember', L: 'b', x: x + rnd(-1, 1) * W * .35, y: y + rnd(-.1, .2) * H, vy: -rnd(.03, .09) * S, vx: rnd(-.015, .015) * S, rgb, life: rnd(1800, 3200), r: rnd(1.2, 3.2) * S, ph: rnd(0, 7) }); };
const speed = (x, y, rgb, n, life = 340) => { for (let i = 0; i < n; i++) add({ k: 'speed', L: 'b', x, y, a: rnd(0, 7), r0: rnd(60, 120) * S, v: rnd(.9, 1.8) * S, len: rnd(60, 160) * S, rgb, life }); };
/* 레퍼런스(2026-10-08) — 원신: 등급 색 유성 · 구름 소용돌이 · 방사선 폭발 / 던파 태초: 겹겹이 도는 마법진 · 나선 소용돌이 */
const meteor = (x0, y0, x1, y1, rgb, life = 900) => add({ k: 'meteor', x0, y0, x1, y1, rgb, life });
const swirl = (x, y, rgb, life = 2000, R = 1, arms = 6) => add({ k: 'swirl', L: 'b', x, y, rgb, life, R, arms });
const rune = (x, y, rgb, R, life = 2600, flat = 1, spin = 1, layers = 4) => add({ k: 'rune', L: 'b', x, y, rgb, R: R * S, life, flat, spin, layers });
const burst = (x, y, rgb, n = 60, life = 700, len = 1) => add({ k: 'burst', x, y, rgb, life, len, rays: Array.from({ length: n }, () => ({ a: rnd(0, 7), r0: rnd(20, 70), L: rnd(120, 520) * len, w: rnd(.8, 2.4) })) });
const converge = (x, y, rgb, n = 30, R = 150) => { for (let i = 0; i < n; i++) add({ k: 'in', x, y, a: rnd(0, 7), R: rnd(R * .5, R) * S, life: rnd(350, 600), age: rnd(-200, 0), rgb }); };

const crackP = (x, y, life = 1400) => { const lines = []; for (let i = 0; i < 8; i++) { let a = rnd(0, 7), px = x, py = y; const seg = []; for (let j = 0; j < 4; j++) { a += rnd(-.7, .7); px += Math.cos(a) * rnd(8, 18) * S; py += Math.sin(a) * rnd(8, 18) * S; seg.push([px, py]); } lines.push(seg); } add({ k: 'crack', x, y, lines, life }); };
/* 캡슐 파편 — 그림을 삼각형으로 잘라 날린다(유리가 깨지는 느낌) */
function shatter(n, power = 1) {
  const cw = W * .22, cx = CX(), cy = CY(), N = n, tri = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = i / N, x1 = (i + 1) / N, y0 = j / N, y1 = (j + 1) / N;
    tri.push([[x0, y0], [x1, y0], [x0, y1]], [[x1, y0], [x1, y1], [x0, y1]]);
  }
  for (const t of tri) {
    const mx = (t[0][0] + t[1][0] + t[2][0]) / 3, my = (t[0][1] + t[1][1] + t[2][1]) / 3, dx = mx - .5, dy = my - .5, d = Math.hypot(dx, dy) || .1;
    if (d > .52) continue;                                           // 캡슐 밖(투명) 조각은 버린다
    const sp = rnd(.25, .7) * power * S;
    add({ k: 'shard', x: cx + dx * cw, y: cy + dy * cw, vx: dx / d * sp * 1.2 + rnd(-.1, .1) * S, vy: dy / d * sp - rnd(.1, .4) * power * S, rot: 0, vr: rnd(-.012, .012) * power, cw, mx, my,
      pts: t.map(p => [(p[0] - mx) * cw, (p[1] - my) * cw]), life: rnd(1100, 1800), grav: .0011 * S });
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
    else if (p.k === 'ring') { g.globalAlpha = 1 - u; g.strokeStyle = p.col; g.lineWidth = p.w * (1 - u); g.beginPath(); g.ellipse(p.x, p.y, p.r0 + (p.r1 - p.r0) * ease.out(u), (p.r0 + (p.r1 - p.r0) * ease.out(u)) * p.flat, 0, 0, 7); g.stroke(); }
    else if (p.k === 'glow') { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); gr.addColorStop(0, `rgba(${p.rgb},${.85 * (1 - u)})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
    else if (p.k === 'beam') { const a = u < .12 ? u / .12 : 1 - (u - .12) / .88, w = p.w * (1 - u * .6), gr = g.createLinearGradient(p.x - w, 0, p.x + w, 0);
      gr.addColorStop(0, `rgba(${p.rgb},0)`); gr.addColorStop(.5, `rgba(${p.rgb},${.8 * a})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(p.x - w, 0, w * 2, H); }
    else if (p.k === 'rays') { const a = u < .1 ? u / .1 : 1 - (u - .1) / .9, rot = p.age / 2600, L2 = Math.hypot(W, H) * p.len; g.globalAlpha = p.alpha * a; g.fillStyle = `rgb(${p.rgb})`;
      for (let i = 0; i < p.n; i++) { const a0 = rot + i * Math.PI * 2 / p.n, a1 = a0 + Math.PI / p.n * .5; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + Math.cos(a0) * L2, p.y + Math.sin(a0) * L2); g.lineTo(p.x + Math.cos(a1) * L2, p.y + Math.sin(a1) * L2); g.closePath(); g.fill(); } }
    else if (p.k === 'in') { const q = ease.in(u), R = p.R * (1 - q), R2 = p.R * (1 - Math.max(0, q - .12)), x = p.x + Math.cos(p.a) * R, y = p.y + Math.sin(p.a) * R;
      g.globalAlpha = .25 + .75 * q; g.strokeStyle = `rgb(${p.rgb})`; g.lineWidth = (1 + 1.6 * q) * S; g.beginPath(); g.moveTo(p.x + Math.cos(p.a) * R2, p.y + Math.sin(p.a) * R2); g.lineTo(x, y); g.stroke(); }
    else if (p.k === 'speed') { const r = p.r0 + p.v * p.age; g.globalAlpha = (1 - u) * .7; g.strokeStyle = `rgb(${p.rgb})`; g.lineWidth = 1.4 * S; g.beginPath(); g.moveTo(p.x + Math.cos(p.a) * r, p.y + Math.sin(p.a) * r); g.lineTo(p.x + Math.cos(p.a) * (r + p.len * (1 - u * .5)), p.y + Math.sin(p.a) * (r + p.len * (1 - u * .5))); g.stroke(); }
    else if (p.k === 'ember') { const f = .6 + .4 * Math.sin((p.age + p.ph * 100) / 120), a = Math.min(1, p.age / 400) * (u > .75 ? (1 - u) * 4 : 1);
      const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4); gr.addColorStop(0, `rgba(${p.rgb},${.9 * a * f})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r * 4, 0, 7); g.fill(); }
    else if (p.k === 'meteor') { const q = ease.in(u), x = p.x0 + (p.x1 - p.x0) * q, y = p.y0 + (p.y1 - p.y0) * q, L2 = 300 * S * Math.min(1, u * 3), dx = p.x1 - p.x0, dy = p.y1 - p.y0, d = Math.hypot(dx, dy), tx = x - dx / d * L2, ty = y - dy / d * L2;
      for (const [w, a, c] of [[16, .25, p.rgb], [7, .6, p.rgb], [2.4, 1, '255,255,255']]) { const gr = g.createLinearGradient(tx, ty, x, y); gr.addColorStop(0, `rgba(${c},0)`); gr.addColorStop(1, `rgba(${c},${a})`); g.globalAlpha = 1; g.strokeStyle = gr; g.lineWidth = w * S; g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke(); }
      const gr2 = g.createRadialGradient(x, y, 0, x, y, 34 * S); gr2.addColorStop(0, 'rgba(255,255,255,.95)'); gr2.addColorStop(.3, `rgba(${p.rgb},.7)`); gr2.addColorStop(1, `rgba(${p.rgb},0)`); g.fillStyle = gr2; g.beginPath(); g.arc(x, y, 34 * S, 0, 7); g.fill(); }
    else if (p.k === 'swirl') { const a = u < .2 ? u / .2 : u > .75 ? (1 - u) / .25 : 1, R0 = Math.hypot(W, H) * .62 * p.R * (.55 + .45 * ease.out(Math.min(1, p.age / 700)));
      g.globalAlpha = .5 * a; g.strokeStyle = `rgb(${p.rgb})`; g.lineCap = 'round';
      for (let k = 0; k < p.arms; k++) for (const [w, al] of [[34, .12], [14, .22], [4, .5]]) { g.lineWidth = w * S; g.globalAlpha = al * a; g.beginPath();
        for (let i = 0; i <= 40; i++) { const r = R0 * (i / 40) ** 1.3, ang = k * Math.PI * 2 / p.arms + (i / 40) * 4.2 - p.age / 900; const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r * .82; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); } }
    else if (p.k === 'rune') { const a = u < .12 ? u / .12 : u > .78 ? (1 - u) / .22 : 1, t = p.age / 1000 * p.spin;
      g.save(); g.translate(p.x, p.y); g.scale(1, p.flat); g.strokeStyle = `rgb(${p.rgb})`; g.fillStyle = `rgb(${p.rgb})`; g.lineCap = 'butt';
      const R = p.R, ringc = (r, w, al) => { g.globalAlpha = al * a; g.lineWidth = w * S; g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); };
      ringc(R, 3, .9); ringc(R * .97, 1, .6);
      g.save(); g.rotate(t * .5); g.globalAlpha = .8 * a; g.lineWidth = 6 * S; for (let i = 0; i < 36; i++) { const A0 = i * Math.PI / 18; g.beginPath(); g.arc(0, 0, R * .9, A0, A0 + .03); g.stroke(); } g.restore();
      g.save(); g.rotate(-t * .35); g.globalAlpha = .75 * a; for (let i = 0; i < 12; i++) { const A0 = i * Math.PI / 6; g.beginPath(); g.moveTo(Math.cos(A0) * R * .8, Math.sin(A0) * R * .8); g.lineTo(Math.cos(A0 + .13) * R * .7, Math.sin(A0 + .13) * R * .7); g.lineTo(Math.cos(A0 - .13) * R * .7, Math.sin(A0 - .13) * R * .7); g.closePath(); g.fill(); } g.restore();
      ringc(R * .68, 2, .8);
      if (p.layers >= 3) { g.save(); g.rotate(t * .8); g.globalAlpha = .6 * a; g.lineWidth = 2 * S; g.setLineDash([14 * S, 9 * S]); g.beginPath(); g.arc(0, 0, R * .58, 0, 7); g.stroke(); g.setLineDash([]); for (const dir of [0, Math.PI]) { g.beginPath(); for (let i = 0; i < 3; i++) { const A0 = dir + i * Math.PI * 2 / 3; const x = Math.cos(A0) * R * .5, y = Math.sin(A0) * R * .5; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.stroke(); } g.restore(); }
      if (p.layers >= 4) { g.save(); g.rotate(-t * 1.2); ringc(R * .36, 2, .7); g.globalAlpha = .7 * a; for (let i = 0; i < 8; i++) { const A0 = i * Math.PI / 4; g.beginPath(); g.moveTo(Math.cos(A0) * R * .36, Math.sin(A0) * R * .36); g.lineTo(Math.cos(A0) * R * .26, Math.sin(A0) * R * .26); g.stroke(); } g.restore(); }
      g.restore(); }
    else if (p.k === 'burst') { const a = 1 - u, e = ease.out(Math.min(1, u * 2));
      for (const r of p.rays) { g.globalAlpha = a * .9; g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = r.w * S * (1 - u * .5); g.beginPath(); g.moveTo(p.x + Math.cos(r.a) * (r.r0 * S + r.L * S * e * .5), p.y + Math.sin(r.a) * (r.r0 * S + r.L * S * e * .5)); g.lineTo(p.x + Math.cos(r.a) * (r.r0 * S + r.L * S * e), p.y + Math.sin(r.a) * (r.r0 * S + r.L * S * e)); g.stroke();
        g.globalAlpha = a * .35; g.strokeStyle = `rgb(${p.rgb})`; g.lineWidth = r.w * 3 * S; g.stroke(); }
      const sz = (160 + 260 * e) * S * (1 - u * .4), gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz * .35); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, sz * .35, 0, 7); g.fill();
      g.globalAlpha = a; g.strokeStyle = '#fff'; g.lineWidth = 2 * S; g.beginPath(); g.moveTo(p.x - sz, p.y); g.lineTo(p.x + sz, p.y); g.moveTo(p.x, p.y - sz * .75); g.lineTo(p.x, p.y + sz * .75); g.stroke(); }
    else if (p.k === 'halo') { const a = u < .15 ? u / .15 : u > .8 ? (1 - u) / .2 : 1; g.globalAlpha = .75 * a; g.strokeStyle = `rgb(${p.rgb})`; g.lineWidth = 2 * S;
      for (const [k, dir] of [[1, 1], [1.28, -1]]) { g.setLineDash([22 * S, 14 * S]); g.lineDashOffset = -p.age * .05 * dir; g.beginPath(); g.arc(p.x, p.y, p.r * k * (.9 + .1 * Math.sin(p.age / 300)), 0, 7); g.stroke(); } g.setLineDash([]); }
    else if (p.k === 'floor') { const a = Math.min(1, p.age / 500), y = FLOOR(), x = CX();
      const gr = g.createRadialGradient(x, y, 0, x, y, p.rx); gr.addColorStop(0, `rgba(${p.rgb},${.35 * a})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, p.rx, p.rx * .22, 0, 0, 7); g.fill();
      g.globalAlpha = .8 * a; g.strokeStyle = `rgb(${p.rgb})`; g.lineWidth = 2 * S; g.setLineDash([26 * S, 12 * S]); g.lineDashOffset = -p.age * .03; g.beginPath(); g.ellipse(x, y, p.rx * .8, p.rx * .8 * .22, 0, 0, 7); g.stroke();
      g.setLineDash([6 * S, 10 * S]); g.lineDashOffset = p.age * .04; g.beginPath(); g.ellipse(x, y, p.rx * .62, p.rx * .62 * .22, 0, 0, 7); g.stroke(); g.setLineDash([]); }
    else if (p.k === 'flare') { const a = u < .15 ? u / .15 : 1 - (u - .15) / .85, L2 = W * p.len, gr = g.createLinearGradient(p.x - L2 / 2, 0, p.x + L2 / 2, 0);
      gr.addColorStop(0, `rgba(${p.rgb},0)`); gr.addColorStop(.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(p.x - L2 / 2, p.y - 2.5 * S * a, L2, 5 * S * a);
      g.fillStyle = `rgba(${p.rgb},${.35 * a})`; g.fillRect(p.x - L2 / 2, p.y - 12 * S * a, L2, 24 * S * a);
      for (const [k, r, o] of [[-.55, 18, .35], [-.28, 40, .22], [.45, 26, .3], [.8, 58, .18]]) { const gx = p.x + k * W * .45, gg = g.createRadialGradient(gx, p.y, 0, gx, p.y, r * S); gg.addColorStop(0, `rgba(${p.rgb},${o * a})`); gg.addColorStop(1, `rgba(${p.rgb},0)`); g.fillStyle = gg; g.beginPath(); g.arc(gx, p.y, r * S, 0, 7); g.fill(); } }
  }
  g.globalCompositeOperation = 'source-over';
  if (L === 'f') for (const p of parts) {
    if (p.age < 0) continue; const u = p.age / p.life;
    if (p.k === 'crack') { const a = u < .75 ? 1 : 1 - (u - .75) / .25, show = clamp(p.age / 200, 0, 1);
      g.globalAlpha = a; g.strokeStyle = '#fff3c4'; g.lineWidth = 2 * S; g.shadowColor = '#ffb03a'; g.shadowBlur = 10;
      for (const seg of p.lines) { g.beginPath(); g.moveTo(p.x, p.y); const n = Math.ceil(seg.length * show); for (let i = 0; i < n; i++) g.lineTo(seg[i][0], seg[i][1]); g.stroke(); } g.shadowBlur = 0; }
    if (p.k === 'shard') { g.save(); g.globalAlpha = u > .7 ? 1 - (u - .7) / .3 : 1; g.translate(p.x, p.y); g.rotate(p.rot); g.beginPath(); p.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.clip();
      g.drawImage(capImg, -p.mx * p.cw, -p.my * p.cw, p.cw, p.cw); g.restore(); }
  }
  g.globalAlpha = 1;
}
let last = performance.now(), lastRaf = 0, bobT = 0;
function frame(now) {
  const dt = Math.min(50, now - last); last = now; step(dt); drawLayer(gB, 'b'); drawLayer(gF, 'f');
  trauma = Math.max(0, trauma - dt * .0016); const sh = trauma * trauma * (reduced ? 0 : 1), T = now / 1000;
  zoomT = Math.max(0, zoomT - dt); const z = 1 + zoom * (zoomT > 0 ? ease.out(zoomT / zoomDur) : 0);
  cam.style.transform = `translate(${sh * 18 * S * Math.sin(T * 61)}px,${sh * 12 * S * Math.sin(T * 79 + 1)}px) rotate(${sh * 1.1 * Math.sin(T * 53) + roll}deg) scale(${z})`;
  if (revealed) { bobT += dt; const b = Math.sin(bobT / 700) * 5 * S + 'px'; el.robot.style.marginTop = b; el.robotC.style.marginTop = b; }
}
const loop = t => { lastRaf = performance.now(); frame(t); requestAnimationFrame(loop); };
requestAnimationFrame(loop);
setInterval(() => { if (performance.now() - lastRaf > 120) frame(performance.now()); }, 16);

/* ── 도구 ── */
const el = { cap: $('#capsule'), capImg: $('#capsule img'), robot: $('#robot'), robotC: $('#robotC'), dim: $('#dim'), flash: $('#flash'), tint: $('#tint'), stamp: $('#stamp'), card: $('#card'), row: $('#row'), go: $('#go'),
  vig: $('#vig'), barT: $('#barT'), barB: $('#barB'), stars: $('#stars') };
const snd = (n, o) => sfx.file(n, o);
const anim = (e, kf, o) => reduced ? null : e.animate(kf, o);
const both = (kf, o) => { anim(el.robot, kf, o); anim(el.robotC, kf, o); };
const flash = (peak, dur, col = '#fff') => { if (reduced) return; el.flash.style.background = col; el.flash.animate([{ opacity: peak }, { opacity: 0 }], { duration: dur, easing: 'ease-out' }); };
const dimTo = async (to, ms) => { const from = +getComputedStyle(el.dim).opacity || 0; el.dim.getAnimations().forEach(a => a.cancel()); el.dim.animate([{ opacity: from }, { opacity: to }], { duration: ms, fill: 'forwards' }); el.dim.style.opacity = to; await sleep(ms); };
const shake = x => { trauma = Math.min(1, trauma + x); };
const slowmo = (ms, k) => { ts = k; setTimeout(() => ts = 1, ms); };
const vignette = (col, op, ms) => { el.vig.style.setProperty('--vc', col); el.vig.animate([{ opacity: +getComputedStyle(el.vig).opacity || 0 }, { opacity: op }], { duration: ms, fill: 'forwards' }); el.vig.style.opacity = op; };
const letterbox = (on, ms = 500) => { const h = on ? '11%' : '0%'; for (const b of [el.barT, el.barB]) { b.getAnimations().forEach(a => a.cancel()); b.animate([{ height: b.style.height || '0%' }, { height: h }], { duration: ms, fill: 'forwards', easing: 'ease-in-out' }); b.style.height = h; } };
/* 충격파 — 화면이 물결처럼 일그러졌다 돌아온다(SVG 변위 필터) */
let shockBusy = false;
function shockwave(power = 40, ms = 700) {
  if (reduced || shockBusy) return; shockBusy = true; const map = $('#shockMap'), t0 = performance.now(); cam.style.filter = 'url(#shock)';
  const iv = setInterval(() => { const u = (performance.now() - t0) / ms; if (u >= 1) { clearInterval(iv); map.setAttribute('scale', 0); cam.style.filter = ''; shockBusy = false; return; } map.setAttribute('scale', (power * Math.sin(Math.PI * Math.sqrt(u))).toFixed(1)); }, 16);
}
let juice = true, busy = false, forced = null, count = 1, mode = 'capsule';

function resetStage() {
  parts = []; revealed = false; ts = 1; roll = 0; zoomT = 0; trauma = 0;
  for (const e of [el.robot, el.robotC]) { e.getAnimations().forEach(a => a.cancel()); e.style.opacity = 0; e.style.filter = ''; e.style.marginTop = ''; }
  el.robotC.style.clipPath = 'inset(0 100% 0 0)';
  el.cap.getAnimations().forEach(a => a.cancel()); el.cap.style.opacity = 0; el.cap.style.transform = 'translate(-50%,-50%)'; el.capImg.style.filter = '';
  for (const e of [el.card, el.stamp, el.stars, el.vig]) { e.getAnimations().forEach(a => a.cancel()); e.style.opacity = 0; }
  el.stars.innerHTML = ''; el.card.querySelector('#cn').classList.remove('shine');
  el.dim.getAnimations().forEach(a => a.cancel()); el.dim.style.opacity = 0; el.row.innerHTML = '';
  for (const b of [el.barT, el.barB]) { b.getAnimations().forEach(a => a.cancel()); b.style.height = '0%'; }
  cam.style.filter = ''; shockBusy = false;
}
function setRobot(id) { const r = ROBOT_TYPES[id], src = `../../assets/${id}.png`; el.robot.src = el.robotC.src = src; el.robot.className = 'robot flip'; el.robotC.className = 'robot rc flip'; $('#cs').textContent = r.role; $('#cn').dataset.name = r.name; $('#cn').textContent = r.name; }
function setCard(ti) { const T = TIERS[ti]; $('#cr').textContent = `${T.ko} · ${T.k}`; $('#cr').style.color = T.col; $('#cn').style.color = T.col; $('#cn').style.setProperty('--c', T.col); el.stars.style.setProperty('--c', T.col); }

/* 별 도장 — 하나씩 튀어 나오며 소리가 올라간다 */
async function starStamp(ti) {
  const T = TIERS[ti]; el.stars.style.opacity = 1; el.stars.innerHTML = '';
  for (let i = 0; i < T.stars; i++) {
    const s = document.createElement('span'); s.textContent = '★'; el.stars.appendChild(s);
    s.animate([{ opacity: 0, transform: 'scale(0) rotate(-90deg)' }, { opacity: 1, transform: 'scale(1.8) rotate(10deg)', offset: .55 }, { opacity: 1, transform: 'scale(1) rotate(0)' }], { duration: 380, fill: 'forwards', easing: 'ease-out' });
    const r = s.getBoundingClientRect(), st = stage.getBoundingClientRect(), x = r.left - st.left + r.width / 2, y = r.top - st.top + r.height / 2;
    spark(x, y, 8, { col: [T.col, '#fff'], v: .35, life: 400, grav: 0 }); ring(x, y, 26, T.col, 300, 3);
    snd('ui_confirm', { gain: .5, rate: .8 + i * .12, max: .25 });
    await sleep(ti >= 3 ? 170 : 110);
  }
}
/* 이름 — 글자가 하나씩 떨어지고, 높은 등급은 빛이 한 번 훑고 지나간다 */
async function nameDrop(ti) {
  const T = TIERS[ti], cn = $('#cn'), name = cn.dataset.name; cn.classList.remove('shine'); cn.textContent = '';
  el.card.style.opacity = 1; el.card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' });
  [...name].forEach((ch, i) => { const s = document.createElement('span'); s.textContent = ch === ' ' ? ' ' : ch; cn.appendChild(s);
    s.animate([{ opacity: 0, transform: `translateY(${-30 - ti * 6}px) scale(1.6)`, filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 360, delay: i * 45, fill: 'backwards', easing: 'cubic-bezier(.2,1.3,.4,1)' }); });
  await sleep(name.length * 45 + 300);
  if (ti >= 3) cn.classList.add('shine');
}

/* ── 한 기 공개 ── */
const CHARGE = [450, 700, 1100, 1700, 2600];
async function reveal(ti, id) {
  const T = TIERS[ti], cx = CX(), cy = CY();
  setRobot(id); setCard(ti);
  if (!juice) {                                                       // 지금 게임 — 캡슐이 돌다가 기체가 튀어나온다
    el.cap.style.opacity = 1; el.cap.animate([{ transform: 'translate(-50%,-50%) rotate(0)' }, { transform: 'translate(-50%,-50%) rotate(360deg)' }], { duration: 700 }); await sleep(700);
    el.cap.style.opacity = 0; el.robot.style.opacity = 1; el.robot.animate([{ transform: 'translate(-50%,-50%) scaleX(-1) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-50%) scaleX(-1) scale(1)', opacity: 1 }], { duration: 400, easing: 'cubic-bezier(.2,1.4,.4,1)' });
    $('#cn').textContent = $('#cn').dataset.name; el.card.style.opacity = 1; await sleep(500); return;
  }
  const hi = ti >= 3, epic = ti === 4;
  /* 1. 무대를 연다 — 바닥 고리 · 비네트 · (높은 등급은) 레터박스 */
  floorRing(hi ? '150,170,200' : T.rgb, 190 + ti * 20); if (ti >= 2) ember(cx, H * .6, T.rgb, 6 + ti * 4);
  if (hi) { letterbox(true, 600); vignette('#02040a', .7, 700); }
  if (mode === 'meteor') await meteorSeq(ti);
  else await capsuleSeq(ti);
  await burstAndReveal(ti);
}

/* ── 유성 방식(원신식) — 등급 색 유성이 떨어져 부딪힌다. 높은 등급은 구름 소용돌이가 먼저 열린다 ── */
async function meteorSeq(ti) {
  const T = TIERS[ti], cx = CX(), cy = CY(), hi = ti >= 3;
  const col = ti <= 1 ? '120,190,255' : T.rgb;                        // 1~2성 느낌은 푸른 유성, 이후는 등급 색
  if (ti >= 2) { swirl(cx, cy, hi ? T.rgb : '150,190,255', hi ? 2400 : 1500, hi ? 1 : .8, hi ? 7 : 5); snd('enh_charge', { gain: .55, max: 1.6 }); }
  if (hi) { for (let i = 0; i < 4; i++) { setTimeout(() => { flash(.12, 120, `rgb(${T.rgb})`); shake(.1); }, 300 + i * 260); } await sleep(hi ? 1100 : 0); }
  else if (ti >= 2) await sleep(600);
  const n = ti === 4 ? 3 : ti === 3 ? 2 : 1;
  for (let i = 0; i < n; i++) { const x0 = W * (.75 + i * .12), y0 = -40 * S; meteor(x0, y0, cx + (i - (n - 1) / 2) * 24 * S, cy, col, 1000 - ti * 60); if (FX_S()) snd('enh_charge', { gain: .5, max: .9, rate: 1.3 + i * .1 }); await sleep(180); }
  await sleep(760 - ti * 40);
  if (hi) { shake(.4); }
}
const FX_S = () => true;

/* ── 캡슐 방식 ── */
async function capsuleSeq(ti) {
  const T = TIERS[ti], cx = CX(), cy = CY(), hi = ti >= 3, epic = ti === 4;
  /* 2. 떨어진다 */
  el.cap.style.opacity = 1; snd('land', { gain: .5, max: .6 });
  anim(el.cap, [{ transform: 'translate(-50%,-200%) scale(.9)' }, { transform: 'translate(-50%,-50%) scale(1.1,.88)', offset: .55 }, { transform: 'translate(-50%,-58%) scale(.96,1.05)', offset: .75 }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 560, easing: 'ease-in' });
  await sleep(520); spark(cx, cy + 62 * S, 10, { col: ['#aab', '#889'], v: .35, life: 450, grav: .0003 }); ring(cx, FLOOR(), 120, T.col, 450, 3, 0, .22); shake(.15);
  await sleep(140);
  /* 3. 기를 모은다 — 흔들림이 커지고 등급 색이 비친다. 높은 등급은 처음에 낮은 색이 비쳤다가 바뀐다 */
  const dur = CHARGE[ti], t0 = performance.now();
  const hint = epic ? [1, 2, 3, 4] : ti === 3 ? [1, 2, 3] : ti >= 2 ? [1, ti] : [ti];
  const hintT = hint.map((_, i) => dur * (i + 1) / hint.length);
  if (ti >= 2) { snd('enh_charge', { gain: .6, max: dur / 1000 }); converge(cx, cy, T.rgb, 20 + ti * 12, 170 + ti * 20); halo(cx, cy, T.rgb, 85 + ti * 6, dur); }
  if (hi) speed(cx, cy, T.rgb, 18, 380);
  let hiIdx = -1, lastSpeed = 0;
  while (performance.now() - t0 < dur) {
    const u = (performance.now() - t0) / dur, a = 1 + 8 * u * (ti + 1) / 3;
    el.cap.style.transform = `translate(calc(-50% + ${rnd(-a, a)}px),calc(-50% + ${rnd(-a, a) * .6}px)) rotate(${rnd(-a, a) * .35}deg) scale(${1 + .06 * u})`;
    const h = hintT.findIndex(t => performance.now() - t0 < t), idx = h < 0 ? hint.length - 1 : h;
    if (ti >= 1) { const H_ = TIERS[hint[idx]], k = u > .22 ? (.3 + .7 * u) : 0; el.capImg.style.filter = k ? `drop-shadow(0 0 ${8 + 28 * k}px rgba(${H_.rgb},${.4 + .6 * k})) brightness(${1 + .45 * k})` : '';
      if (idx !== hiIdx) { hiIdx = idx; if (u > .2) { glow(cx, cy, 150, H_.rgb, 300); flash(.12 + idx * .05, 160, `rgb(${H_.rgb})`); spark(cx, cy, 12, { col: [H_.col, '#fff'], v: .4, life: 350, grav: 0 }); if (idx > 0) snd('ui_confirm', { gain: .45, rate: .9 + idx * .15, max: .3 }); } } }
    if (hi && performance.now() - lastSpeed > 220 - 120 * u) { lastSpeed = performance.now(); speed(cx, cy, T.rgb, 4 + (u * 8 | 0), 320); }
    if (ti >= 2) ember(cx, H * .55, T.rgb, Math.random() < .3 ? 1 : 0);
    if (Math.random() < .12 * (ti + 1)) spark(cx + rnd(-50, 50) * S, cy + rnd(-50, 50) * S, 1, { col: [T.col, '#fff'], v: .25, life: 300, grav: 0 });
    await sleep(33);
  }
  el.capImg.style.filter = '';
  /* 4. 터지기 직전 — 어두워지고 갈라지고 하얗게 달아오른다. 에픽은 줌 인 + 정지 */
  if (hi) { dimTo(epic ? .62 : .4, 300); crackP(cx, cy, 900 + ti * 200); glow(cx, cy, 130, '255,240,200', 600); snd('anvil_hit', { gain: .6, max: .5 }); shake(.35); await sleep(epic ? 480 : 320); }
  if (epic) {
    crackP(cx, cy, 1100); glow(cx, cy, 190, '255,210,140', 700); shake(.55); snd('anvil_hit', { gain: .85, max: .5, rate: .8 });
    zoom = .14; zoomT = zoomDur = 1800; roll = -.8; await sleep(420);
    el.capImg.style.filter = 'brightness(3) saturate(.3) drop-shadow(0 0 40px #fff)'; el.cap.animate([{ transform: 'translate(-50%,-50%) scale(1.06)' }, { transform: 'translate(-50%,-50%) scale(1.22)' }], { duration: 380, fill: 'forwards', easing: 'ease-in' });
    snd('enh_charge', { gain: .5, max: .45, rate: 1.6 }); await sleep(380);
    ts = 0; await sleep(260); ts = 1;                                  // 숨 멎는 정지
  }
}

async function burstAndReveal(ti) {
  const T = TIERS[ti], cx = CX(), cy = CY(), hi = ti >= 3, epic = ti === 4;
  /* 5. 터진다 */
  el.cap.style.opacity = 0; roll = 0;
  flash([.35, .5, .7, .95, 1][ti], [260, 340, 480, 800, 1200][ti], ti >= 4 ? '#fff6dc' : '#fff');
  [() => snd('ui_confirm', { gain: .8, max: .4 }), () => snd('enh_success', { gain: .7, max: 1 }), () => snd('levelup', { gain: .85, max: 1.8 }),
   () => snd('rare_reveal', { gain: 1, max: 2.6 }), () => { snd('rare_reveal', { gain: 1, max: 3 }); setTimeout(() => snd('explosion', { gain: .5, max: 1.2 }), 80); }][ti]();
  if (ti >= 1 && mode === 'capsule') shatter(ti >= 3 ? 5 : ti === 2 ? 4 : 3, .6 + ti * .35);
  /* 레퍼런스에서 가져온 것 — 방사선 폭발 · 마법진 · 소용돌이 */
  if (ti >= 1) burst(cx, cy, T.rgb, [0, 36, 54, 80, 120][ti], 600 + ti * 140, .6 + ti * .2);
  if (ti >= 2) rune(cx, H * .5, T.rgb, [0, 0, 150, 200, 250][ti], 2600 + ti * 700, 1, ti >= 4 ? 4 : 3);
  if (ti >= 3) rune(cx, FLOOR(), T.rgb, 330 + (ti - 3) * 120, 3400 + ti * 500, .2, -1.4, 4);
  if (hi && mode === 'capsule') swirl(cx, cy, T.rgb, 1800 + (ti - 3) * 700, .9, 6);
  if (epic) rune(cx, H * .5, '255,235,170', 340, 5200, 1, -.6, 3);
  ring(cx, cy, 120 + ti * 45, T.col, 520 + ti * 100, 6); if (ti >= 1) ring(cx, cy, 90 + ti * 30, '#fff', 420, 4, 60); if (ti >= 2) ring(cx, cy, 190 + ti * 60, T.col, 760, 5, 140); if (epic) { ring(cx, cy, 340, '#ffe58a', 1000, 9, 200); ring(cx, FLOOR(), 420, T.col, 900, 5, 120, .22); }
  glow(cx, cy, 170 + ti * 70, T.rgb, 520 + ti * 160);
  spark(cx, cy, [20, 34, 52, 90, 160][ti], { col: [T.col, '#fff', '#ffe58a'], v: .65 + ti * .2, life: 760 + ti * 260, up: .25 });
  if (ti >= 2) { beam(cx, T.rgb, 800 + ti * 260, 46 + ti * 24); flare(cx, cy, T.rgb, 500 + ti * 250, 1 + ti * .1); }
  if (hi) { rays(cx, H * .5, T.rgb, 2200 + (epic ? 2200 : 0), epic ? 20 : 14, 1.1, epic ? .6 : .5); beam(cx - 170 * S, T.rgb, 1200, 28); beam(cx + 170 * S, T.rgb, 1200, 28); shockwave(epic ? 60 : 36, epic ? 900 : 650); }
  if (epic) { ember(cx, H * .7, '255,200,110', 36); for (let i = 0; i < 46; i++) add({ k: 'spark', x: rnd(0, W), y: -10, vx: rnd(-.05, .05) * S, vy: rnd(.1, .35) * S, life: rnd(1200, 2400), age: rnd(0, 800), w: rnd(1.5, 3.5) * S, col: ['#ffd45a', '#fff3b0', '#ff9a3a'][i % 3], grav: 0 }); slowmo(700, .25); }
  shake([.2, .3, .5, .85, 1][ti]);
  if (ti >= 2) await sleep(80 + ti * 20);
  /* 6. 기체 공개 — 높은 등급은 실루엣이 먼저 서고, 빛이 왼쪽에서 오른쪽으로 훑으며 색을 입힌다 */
  el.robot.style.opacity = 1;
  const kf = [{ transform: 'translate(-50%,-44%) scaleX(-1) scale(.55)', opacity: 0 }, { transform: 'translate(-50%,-50%) scaleX(-1) scale(1.06)', opacity: 1, offset: .7 }, { transform: 'translate(-50%,-50%) scaleX(-1) scale(1)', opacity: 1 }];
  if (ti >= 2) {
    el.robot.style.filter = 'brightness(0)'; el.robotC.style.opacity = 1; el.robotC.style.filter = `drop-shadow(0 0 ${12 + ti * 6}px rgba(${T.rgb},.85))`;
    both(kf, { duration: 520, easing: 'cubic-bezier(.2,1.2,.4,1)' });
    await sleep(epic ? 800 : hi ? 460 : 240);
    const scan = [320, 520, 900][ti - 2]; el.robotC.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: scan, fill: 'forwards', easing: 'ease-in-out' }); el.robotC.style.clipPath = 'inset(0 0 0 0)';
    const sx0 = cx - W * .14, sx1 = cx + W * .14, t1 = performance.now();                  // 훑는 빛줄기
    const iv = setInterval(() => { const u = (performance.now() - t1) / scan; if (u >= 1) return clearInterval(iv); const x = sx0 + (sx1 - sx0) * u; spark(x, H * (.3 + Math.random() * .4), 2, { col: [T.col, '#fff'], v: .3, life: 300, grav: 0 }); }, 30);
    if (ti >= 3) snd('enh_success', { gain: .7, max: 1 });
    await sleep(scan);
    el.robot.style.filter = ''; flash(.35 + (ti - 2) * .1, 280); glow(cx, cy, 260, T.rgb, 520); shake(.3 + (ti - 2) * .1); if (ti >= 3) flare(cx, cy, T.rgb, 600, 1.2);
  } else {
    both(kf, { duration: 380 + ti * 80, easing: 'cubic-bezier(.2,1.2,.4,1)' }); el.robotC.style.opacity = 0;
    el.robot.style.filter = ti >= 1 ? `drop-shadow(0 0 ${8 + ti * 6}px rgba(${T.rgb},.8))` : ''; await sleep(320);
  }
  revealed = true; bobT = 0;
  /* 7. 별 · 도장 · 이름 */
  if (T.stamp) { el.stamp.textContent = T.stamp.split('').join(' '); el.stamp.style.color = T.col; anim(el.stamp, [{ opacity: 0, transform: 'translateX(-50%) scale(2.4)', filter: 'blur(6px)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)', filter: 'blur(0)', offset: .3 }, { opacity: 1, transform: 'translateX(-50%) scale(1)' }], { duration: 620, fill: 'forwards', easing: 'cubic-bezier(.2,1.2,.4,1)' }); el.stamp.style.opacity = 1; if (hi) shake(.3); }
  await starStamp(ti);
  await nameDrop(ti);
  if (hi) { letterbox(false, 700); vignette('#000', 0, 900); await dimTo(0, 700); } else await sleep(300);
}

/* ── 한 판(단발 · 10연차) ── */
const bestEl = $('#bestTxt');
async function run() {
  if (busy) return; busy = true; sfx.unlock(); resetStage(); el.go.hidden = true;
  const picks = [];
  for (let i = 0; i < count; i++) picks.push(count === 1 && forced !== null ? forced : rollTier());
  if (count > 1 && forced !== null) picks[count - 1] = forced;
  const best = Math.max(...picks), bi = picks.indexOf(best);
  bestEl.textContent = TIERS[best].ko; bestEl.style.color = TIERS[best].col;
  const bestId = robotOf(best);
  await reveal(best, bestId);
  if (count > 1) {
    await sleep(300);
    for (const e of [el.card, el.stamp, el.robot, el.robotC, el.stars]) { e.getAnimations().forEach(x => x.cancel()); e.style.opacity = 0; }
    revealed = false; parts = []; el.row.innerHTML = '';
    const ids = picks.map((t, i) => i === bi ? bestId : robotOf(t));
    const order = picks.map((t, i) => i).sort((a, b) => picks[a] - picks[b]);          // 낮은 등급부터 — 가장 좋은 것이 마지막에 터진다
    const cells = picks.map((t, i) => { const T = TIERS[t], d = document.createElement('div'); d.className = 'mini'; d.style.setProperty('--c', T.col);
      d.innerHTML = `<img src="../../assets/${ids[i]}.png" alt=""><b>${T.k}</b>`; return d; });
    cells.forEach(c => el.row.appendChild(c));
    for (const [n, i] of order.entries()) {
      const t = picks[i], c = cells[i];
      c.animate([{ opacity: 0, transform: 'translateY(16px) scale(.8)' }, { opacity: 1, transform: 'translateY(0) scale(1.08)', offset: .7 }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 260, fill: 'forwards', easing: 'ease-out' });
      if (juice) { snd(t >= 3 ? 'enh_success' : 'coin_tick', { gain: t >= 3 ? .8 : .4, rate: .85 + n * .06, max: .3 }); if (t >= 2) { const r = c.getBoundingClientRect(), s = stage.getBoundingClientRect(), x = r.left - s.left + r.width / 2, y = r.top - s.top + r.height / 2; ring(x, y, 50, TIERS[t].col, 400, 4); spark(x, y, 12, { col: [TIERS[t].col, '#fff'], v: .4, life: 450 }); } }
      await sleep(juice ? 150 : 40);
    }
    await sleep(600);
  } else await sleep(600);
  el.go.style.bottom = count > 1 ? '36%' : '14px';
  el.go.hidden = false; el.go.textContent = '▶ 다시 뽑기'; busy = false;
}

/* ── 조작판 ── */
const tiersBox = $('#tiers');
TIERS.forEach((T, i) => { const b = document.createElement('button'); b.className = 'b r'; b.style.setProperty('--c', T.col); b.textContent = T.k; b.title = T.ko; b.onclick = () => { forced = i; run(); }; tiersBox.appendChild(b); });
$('#rand').onclick = () => { forced = null; run(); };
$('#go').onclick = () => { forced = null; run(); };
const setCount = n => { count = n; $('#m1').classList.toggle('on', n === 1); $('#m10').classList.toggle('on', n === 10); };
$('#m1').onclick = () => setCount(1); $('#m10').onclick = () => setCount(10);
const setMode = m => { mode = m; $('#mCap').classList.toggle('on', m === 'capsule'); $('#mMet').classList.toggle('on', m === 'meteor'); };
$('#mCap').onclick = () => setMode('capsule'); $('#mMet').onclick = () => setMode('meteor');
const setJuice = j => { juice = j; $('#vJuice').classList.toggle('on', j); $('#vNow').classList.toggle('on', !j); $('#modeTxt').textContent = j ? '켬' : '지금 게임'; };
$('#vNow').onclick = () => setJuice(false); $('#vJuice').onclick = () => setJuice(true);
$('#vol').oninput = e => { sfx.setVol(+e.target.value / 100); $('#volOut').textContent = e.target.value + '%'; };
$('#sfxsrc').onchange = e => { sfx.useFiles = e.target.value === 'files'; };
$('#odds').innerHTML = '<tr><th>등급</th><th>기체</th><th>가중치</th></tr>' + ROBOT_RARITY.map((r, i) => `<tr style="--c:${TIERS[i].col}"><td><span class="dot"></span>${r.ko}</td><td>${BY_RARITY[r.k].length}종</td><td>${(r.w / WT * 100).toFixed(1)}%</td></tr>`).join('');
window.__gacha = { run: () => run(), TIERS, state: () => ({ busy, parts: parts.length, trauma: +trauma.toFixed(2), shards: parts.filter(p => p.k === 'shard').length }) };
