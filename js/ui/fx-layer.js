/* 화면 연출 공용층 — 표시 전용. 게임 상태 · 서버 · 판정을 건드리지 않는다. (2026-10-08 · proto/juice 에서 옮김)
 * 화면 전체를 덮는 투명 캔버스 하나에 입자를 그린다. 입자가 없으면 그리기를 멈춘다.
 * 열린 <dialog> 가 있으면 그 안으로 옮겨 붙는다(dialog 는 최상위 층이라 바깥 캔버스가 가려진다).
 * prefers-reduced-motion 이면 흔들림 · 섬광을 내지 않고 입자도 줄인다. 화면 섬광은 0.34초 간격 제한(광과민성). */
export const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const rnd = (a, b) => a + Math.random() * (b - a);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const ease = { out: u => 1 - (1 - u) ** 3, in: u => u * u, inOut: u => u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2 };
export const tween = (dur, fn) => new Promise(res => {
  const t0 = performance.now();
  (function f() { const u = clamp((performance.now() - t0) / dur, 0, 1); fn(u); u < 1 ? setTimeout(f, 16) : res(); })();
});
/* 요소의 화면 중심 — 없거나 숨어 있으면 null */
export function centerOf(el) {
  if (!el?.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, r };
}
export function animate(el, frames, opts) {
  if (!el?.animate || reducedMotion()) return null;
  try { return el.animate(frames, opts); } catch { return null; }
}
export const pop = (el, k = 1.3, dur = 380) => animate(el, [{ transform: 'scale(1)' }, { transform: `scale(${k})`, offset: .3 }, { transform: 'scale(1)' }], { duration: dur, easing: 'cubic-bezier(.2,1.4,.4,1)' });
export function shake(el, amp = 8, dur = 360) {
  const f = []; for (let i = 0; i < 9; i++) f.push({ transform: `translate(${rnd(-amp, amp)}px,${rnd(-amp, amp)}px)` });
  f.push({ transform: 'none' }); return animate(el, f, { duration: dur });
}

let layer = null;
function createLayer() {
  const c = document.createElement('canvas');
  c.className = 'fx-layer'; c.setAttribute('aria-hidden', 'true');
  const g = c.getContext('2d');
  const L = { c, g, p: [], W: 0, H: 0, running: false, last: 0, flashAt: -1e9 };
  L.fit = () => {
    const d = Math.min(2, devicePixelRatio || 1); L.W = innerWidth; L.H = innerHeight;
    c.width = Math.round(L.W * d); c.height = Math.round(L.H * d); g.setTransform(d, 0, 0, d, 0, 0);
  };
  addEventListener('resize', L.fit); L.fit();
  return L;
}
/* 열린 모달 안 · 아니면 body 끝에 붙인다 — 매번 확인해 모달이 열리고 닫혀도 위에 보인다 */
function host() {
  if (!layer) layer = createLayer();
  const dlg = document.querySelector('dialog[open]');
  const parent = dlg || document.body;
  if (layer.c.parentNode !== parent) parent.appendChild(layer.c);
  return layer;
}
function step(L, dt) {
  for (const p of L.p) {
    p.age += dt; if (p.age < 0) continue;
    if (p.k === 'spark') { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .997 ** dt; }
  }
  for (const p of L.p) if (p.k === 'chip' && p.age >= p.life && !p.fired) { p.fired = true; try { p.onArrive?.(); } catch {} }
  L.p = L.p.filter(p => p.age < p.life);
}
function draw(L) {
  const g = L.g; g.clearRect(0, 0, L.W, L.H); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  for (const p of L.p) {
    if (p.age < 0) continue; const u = p.age / p.life;
    if (p.k === 'spark') { g.globalAlpha = 1 - u; g.strokeStyle = p.col; g.lineWidth = p.w; g.beginPath(); g.moveTo(p.x - p.vx * 12, p.y - p.vy * 12); g.lineTo(p.x, p.y); g.stroke(); }
    else if (p.k === 'ring') { const r = p.r0 + (p.r1 - p.r0) * ease.out(u); g.globalAlpha = 1 - u; g.strokeStyle = p.col; g.lineWidth = Math.max(.1, p.w * (1 - u)); g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.stroke(); }
    else if (p.k === 'glow') { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); gr.addColorStop(0, `rgba(${p.rgb},${.8 * (1 - u)})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
    else if (p.k === 'chip') { const q = ease.in(u), x = p.x0 + (p.x1 - p.x0) * q, y = p.y0 + (p.y1 - p.y0) * q + Math.sin(Math.PI * q) * p.bend;
      g.globalAlpha = Math.min(1, u * 8) * (u > .92 ? (1 - u) * 12 : 1); g.fillStyle = p.col; g.save(); g.translate(x, y); g.rotate(u * 9); g.fillRect(-4, -2.5, 8, 5); g.restore();
      g.globalAlpha *= .4; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); }
    else if (p.k === 'beam') { const w = p.w * (1 - u * .5), a = u < .15 ? u / .15 : 1 - (u - .15) / .85, gr = g.createLinearGradient(p.x - w, 0, p.x + w, 0);
      gr.addColorStop(0, `rgba(${p.rgb},0)`); gr.addColorStop(.5, `rgba(${p.rgb},${.75 * a})`); gr.addColorStop(1, `rgba(${p.rgb},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(p.x - w, p.y0, w * 2, p.y1 - p.y0); }
  }
  g.globalCompositeOperation = 'source-over';
  for (const p of L.p) if (p.k === 'crack' && p.age >= 0) { const u = p.age / p.life, a = u < .7 ? 1 : 1 - (u - .7) / .3, show = clamp(p.age / 140, 0, 1);
    g.globalAlpha = a; g.strokeStyle = '#ffb36b'; g.lineWidth = 2; g.shadowColor = '#ff7a2a'; g.shadowBlur = 8;
    for (const seg of p.lines) { g.beginPath(); g.moveTo(p.x, p.y); const n = Math.ceil(seg.length * show); for (let i = 0; i < n; i++) g.lineTo(seg[i][0], seg[i][1]); g.stroke(); } g.shadowBlur = 0; }
  g.globalAlpha = 1;
}
function run(L) {
  if (L.running) return; L.running = true; L.last = performance.now();
  const tick = () => {
    const now = performance.now(), dt = Math.min(50, now - L.last); L.last = now;
    step(L, dt); draw(L);
    if (L.p.length) { L.raf = requestAnimationFrame(tick); L.to = setTimeout(() => { if (performance.now() - L.last > 120) { cancelAnimationFrame(L.raf); tick(); } }, 140); }
    else { L.running = false; L.g.clearRect(0, 0, L.W, L.H); }
  };
  L.raf = requestAnimationFrame(tick);
}
function add(o) { const L = host(); o.age = o.age ?? 0; L.p.push(o); run(L); return o; }

/* ── 입자 ── (좌표는 화면 px) */
export const fx = {
  spark(x, y, n, { col = ['#fff', '#ffe58a', '#ffb03a'], v = .5, life = 500, up = 0, spread = Math.PI * 2, dir = 0, g = .0008 } = {}) {
    if (reducedMotion()) n = Math.ceil(n / 4);
    for (let i = 0; i < n; i++) { const a = dir + rnd(-.5, .5) * spread, s = rnd(.3, 1) * v;
      add({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - up, life: rnd(life * .6, life), w: rnd(1.2, 2.6), col: col[(Math.random() * col.length) | 0], g }); }
  },
  ring(x, y, r1, { col = '#ffe58a', life = 400, w = 4, r0 = 6 } = {}) { add({ k: 'ring', x, y, r0, r1, life, col, w }); },
  glow(x, y, r, { rgb = '255,220,140', life = 300 } = {}) { add({ k: 'glow', x, y, r, life, rgb }); },
  chip(x0, y0, x1, y1, { delay = 0, life = 650, col = '#ffd45a', onArrive } = {}) { add({ k: 'chip', x0, y0, x1, y1, bend: rnd(-60, 60), life, age: -delay, col, onArrive }); },
  beam(x, y0, y1, { life = 900, rgb = '255,230,150', w = 70 } = {}) { add({ k: 'beam', x, y0, y1, life, rgb, w }); },
  crack(x, y, { life = 1400, size = 1 } = {}) {
    const lines = []; for (let i = 0; i < 6; i++) { let a = rnd(0, 7), px = x, py = y; const seg = [];
      for (let j = 0; j < 4; j++) { a += rnd(-.7, .7); px += Math.cos(a) * rnd(10, 22) * size; py += Math.sin(a) * rnd(10, 22) * size; seg.push([px, py]); } lines.push(seg); }
    add({ k: 'crack', x, y, lines, life });
  },
  /* 무게 있는 회색 파편(강화 실패) */
  debris(x, y, n = 10) {
    for (let i = 0; i < n; i++) add({ k: 'spark', x: x + rnd(-30, 30), y: y + rnd(-20, 20), vx: rnd(-.3, .3), vy: rnd(-.4, .1), life: rnd(500, 900), w: rnd(2, 4), col: '#9aa4b5', g: .0016 });
  },
  clear() { if (layer) layer.p = []; },
};

/* 화면 전체 섬광 — 0.34초 간격 제한 · 줄인 움직임에서는 내지 않는다 */
let flashEl = null, lastFlash = -1e9;
export function screenFlash(peak = .3, dur = 260, col = '#fff') {
  if (reducedMotion()) return;
  const now = performance.now(); if (now - lastFlash < 340) return; lastFlash = now;
  if (!flashEl) { flashEl = document.createElement('div'); flashEl.className = 'fx-flash'; flashEl.setAttribute('aria-hidden', 'true'); }
  const parent = document.querySelector('dialog[open]') || document.body;
  if (flashEl.parentNode !== parent) parent.appendChild(flashEl);
  flashEl.style.background = col;
  flashEl.animate([{ opacity: peak }, { opacity: 0 }], { duration: dur, easing: 'ease-out' });
}

/* 요소 위에 떠오르는 글자(+N · 강화 성공 · LEVEL UP) */
export function floatText(at, text, { color = '#ffcf5a', size = 22, dy = -46, dur = 1300, cls = '' } = {}) {
  if (!at) return;
  const el = document.createElement('div'); el.className = 'fx-float ' + cls; el.textContent = text;
  el.style.cssText = `left:${at.x}px;top:${at.y}px;color:${color};font-size:${size}px`;
  (document.querySelector('dialog[open]') || document.body).appendChild(el);
  const a = el.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.6)' }, { opacity: 1, transform: `translate(-50%,calc(-50% + ${dy * .4}px)) scale(1.15)`, offset: .2 },
    { opacity: 1, transform: `translate(-50%,calc(-50% + ${dy * .7}px)) scale(1)`, offset: .7 }, { opacity: 0, transform: `translate(-50%,calc(-50% + ${dy}px)) scale(1)` }], { duration: reducedMotion() ? dur * .7 : dur, fill: 'forwards' });
  a.onfinish = () => el.remove(); setTimeout(() => el.remove(), dur + 400);
  return el;
}

/* 숫자를 세어 올린다 — 글자 안의 첫 숫자 덩어리만 바꾼다(단위 · 기호는 그대로) */
export function countText(el, from, to, dur = 600, fmt = n => Math.round(n).toLocaleString('ko-KR'), onTick) {
  if (!el) return Promise.resolve();
  const src = el.textContent, m = src.match(/[\d,]+/);
  if (!m || reducedMotion()) { return Promise.resolve(); }
  const pre = src.slice(0, m.index), post = src.slice(m.index + m[0].length);
  return tween(dur, u => { el.textContent = pre + fmt(from + (to - from) * ease.out(u)) + post; onTick?.(u); }).then(() => { el.textContent = src; });
}
