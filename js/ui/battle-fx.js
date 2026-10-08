/* 전투 타격감(Juice) — 표시 전용. 판정 · 피해 · 순서는 js/sim.js 가 이미 정했다. (proto/juice/juice.js 를 게임 아레나에 옮김 · 2026-10-08)
 *
 * 사용자 결정(docs/handoff/2026-10-08-juice-to-ui.md 9절): '대기 모션'만 빼고 전부 켠다 · 판이 길어져도 행동 간격(TL.gap)은 줄이지 않는다.
 * 공격 그림(탄 · 참격 · 자세)은 공격 모션 엔진(js/motion.js)이 그린다. 여기서는 그 위에 겨눔 · 먼저 쏘기 시각 · 예비 동작을 얹는다.
 *
 * 시간 — 연출 시계(gt)는 배속을 따르고 히트스톱 동안 멈춘다. 사건은 'gt − hold' 가 시각표(battleTimeline)에 닿을 때 처리된다.
 *   hold 는 등장 · 격파 · 교대처럼 다음 사건을 뒤로 미는 양이다. 그래서 판이 길어지지만 사건 순서 · 결과는 그대로다.
 * prefers-reduced-motion 이면 만들지 않는다(null) — 게임은 예전 재생을 쓴다. */
import { reducedMotion } from './fx-layer.js';
import { COMBAT_TYPES } from '../units.js';
import { kindOf, TIME as MOTION_TIME } from '../motion.js';

const RANGED = new Set(['shot', 'cannon', 'missile', 'beam']);
/* 원거리 사격 모양 — 역할 이름이 먼저(저격 · 개틀링 · 빔 · 미사일 · 포격), 없으면 모션 종류에서 */
export function shotCat(type) {
  const kind = kindOf(type); if (!RANGED.has(kind)) return null;
  const role = COMBAT_TYPES[type]?.role || '';
  if (/개틀링/.test(role)) return 'gatling';
  if (/빔|캐논/.test(role) || kind === 'beam') return 'beam';
  if (/저격/.test(role)) return 'sniper';
  if (/미사일/.test(role) || kind === 'missile') return 'missile';
  if (/포격|시즈/.test(role) || kind === 'cannon') return 'shell';
  return 'rifle';
}
const AIM = { sniper: 280, gatling: 120, beam: 200, missile: 60, shell: 80, rifle: 90 };
const RECOIL = { sniper: 28, gatling: 7, beam: 14, missile: 10, shell: 34, rifle: 12 };
/* 미리 시작할 시간 — 원거리는 겨눔 + 모션 엔진의 준비 · 비행, 근접은 움츠림(90ms) */
export function leadOf(type) {
  const cat = shotCat(type); if (!cat) return 90;
  const T = MOTION_TIME[kindOf(type)]; return AIM[cat] + T.pre + T.fly;
}
/* 스킬 성질 → 빛 색 · 충격파 색 · 이름표 (앞에 있는 것이 우선) */
const SK = [
  ['execute', '255,70,70', '#ff5a5a', '처형'], ['shred', '255,150,60', '#ffa040', '장갑 파쇄'], ['jam', '120,240,255', '#7bf0ff', '재밍'],
  ['mark', '255,90,90', '#ff7a7a', '표적'], ['drain', '255,80,120', '#ff5a8a', '흡혈'], ['repair', '110,255,170', '#6dffb0', '수리'],
  ['shield', '110,200,255', '#7bc8ff', '방벽'], ['ignoreDef', '170,200,255', '#c8d8ff', '관통'], ['alwaysCrit', '255,215,100', '#ffd45a', '확정 치명'],
];
export function skillStyle(fx, mine) {
  if (fx) for (const [k, rgb, col, tag] of SK) if (fx[k]) return { rgb, col, tag };
  return { rgb: mine ? '123,240,255' : '255,160,90', col: mine ? '#7bf0ff' : '#ffa060', tag: '' };
}
const SPARK_COL = ['#ffffff', '#fff3b0', '#ffd45a', '#ff9a3a'];
const ease = { out: u => 1 - (1 - u) ** 3, in: u => u * u };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rnd = (a, b) => a + Math.random() * (b - a);

export function createBattleFx(arena, { speed = () => 1 } = {}) {
  if (!arena || reducedMotion()) return null;
  const canvas = document.createElement('canvas'); canvas.className = 'bfx-canvas'; canvas.setAttribute('aria-hidden', 'true');
  const nums = document.createElement('div'); nums.className = 'bfx-nums'; nums.setAttribute('aria-hidden', 'true');
  const danger = document.createElement('div'); danger.className = 'bfx-danger'; danger.setAttribute('aria-hidden', 'true');
  const flashEl = arena.querySelector('#flash');
  for (const n of [canvas, nums, danger]) flashEl ? arena.insertBefore(n, flashEl) : arena.appendChild(n);
  const g = canvas.getContext('2d');
  let W = 0, H = 0, S = 1;
  function fit() { W = arena.clientWidth; H = arena.clientHeight; S = Math.max(.45, W / 960); const d = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.max(1, W * d); canvas.height = Math.max(1, H * d); g.setTransform(d, 0, 0, d, 0, 0); }
  fit();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null; ro?.observe(arena);

  /* ── 기체 ── 칸 열쇠 'p' · 'e' · 'p0' … */
  const F = {};
  function unit(k) {
    if (!F[k]) F[k] = { k, dir: k[0] === 'p' ? 1 : -1, anims: [], flashUntil: 0, glowUntil: 0, glowCol: '#7bf0ff', glitchUntil: 0, flickUntil: 0, dead: false, hp: 1, max: 1,
      shield: 0, shieldMax: 0, marked: 0, ripple: null, numAt: -1e9, numStack: 0, smk: 0, spk: 0, combo: 0, skillFx: null, skill: false };
    return F[k];
  }
  const elOf = k => arena.querySelector('#fighter-' + k);
  /* 칸의 자리 — 레이아웃 좌표(흔들림을 따라가지 않는다) */
  function geo(k) {
    const el = elOf(k);
    if (!el) return { cx: W * (k[0] === 'p' ? .27 : .73), floor: H * .9, fw: W * .24, fh: H * .6 };
    let x = 0, y = 0, n = el;
    while (n && n !== arena) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { cx: x + el.offsetWidth / 2, floor: y + el.offsetHeight * .97, fw: el.offsetWidth, fh: el.offsetHeight };
  }
  const chestY = G => G.floor - G.fh * .45, headY = G => G.floor - G.fh * .8;
  const contactX = (G, fromDir) => G.cx - fromDir * G.fw * .2;

  /* ── 시계 ── */
  let gt = 0, hold = 0, stopLeft = 0, slowLeft = 0, slowScale = 1, trauma = 0, disposed = false, last = performance.now(), lastTick = last, raf = 0;
  let timers = [], waiters = [], parts = [], numList = [];
  const tlNow = () => gt - hold;
  const after = (ms, fn) => timers.push({ at: gt + ms, fn, raw: true });
  const hitstop = ms => { stopLeft = Math.max(stopLeft, ms); };
  const anim = (U, dur, fn, kind) => { if (kind) U.anims = U.anims.filter(a => a.kind !== kind); U.anims.push({ t0: gt, dur, fn, kind }); };
  const addTrauma = x => { trauma = Math.min(1, trauma + x); };

  /* ── 동작 ── */
  function windup(U) {
    const D = U.dir, R = W * .123, B = 18 * S;
    anim(U, 390, u => {
      if (u < 90) { const p = ease.out(u / 90); return { x: -B * D * p, sx: 1 - .09 * p, sy: 1 + .08 * p, r: -3 * D * p }; }
      if (u < 150) { const p = ease.in((u - 90) / 60); return { x: D * (-B + (R + B) * p), sx: .91 + .22 * p, sy: 1.08 - .15 * p, r: D * (-3 + 7 * p) }; }
      if (u < 200) { const p = (u - 150) / 50; return { x: R * D, sx: 1.13 - .13 * p, sy: .93 + .07 * p, r: 4 * D * (1 - p) }; }
      const p = ease.out((u - 200) / 190); return { x: R * D * (1 - p) };
    }, 'atk');
  }
  function jab(U) { const D = U.dir, R = W * .073; anim(U, 220, u => u < 50 ? { x: R * D * ease.in(u / 50), sx: 1.08, sy: .95 } : { x: R * D * (1 - ease.out((u - 50) / 170)) }, 'atk'); }
  function knock(U, fromDir, I) {
    const A = (8 + 30 * I) * S * fromDir;
    anim(U, 460, u => { const x = u < 50 ? A * ease.out(u / 50) : A * Math.exp(-(u - 50) / 110) * Math.cos((u - 50) / 70), q = Math.max(0, 1 - u / 160);
      return { x, sx: 1 + .09 * I * q, sy: 1 - .08 * I * q, r: fromDir * 6 * I * Math.max(0, 1 - u / 260) }; }, 'hurt');
  }
  function dodge(U, fromDir) { anim(U, 320, u => { const s = Math.sin(Math.PI * u / 320); return { x: fromDir * 34 * S * s, y: -12 * S * s, r: -fromDir * 4 * s }; }, 'hurt'); afterimage(U); }
  function recoil(U, amt) { anim(U, 280, u => { const q = Math.exp(-u / 75); return { x: -U.dir * amt * S * q, r: -U.dir * 2.4 * (amt / 16) * q, sx: 1 - .03 * q * amt / 16, sy: 1 + .03 * q * amt / 16 }; }, 'atk'); }
  function brace(U, dur) { anim(U, dur + 40, u => { const p = ease.out(Math.min(1, u / dur)); return { x: -U.dir * 5 * S * p, sx: 1 + .02 * p, sy: 1 - .035 * p }; }, 'atk'); }
  function afterimage(U) {
    const el = elOf(U.k), im = el?.querySelector('img'); if (!im) return;
    const ghost = im.cloneNode(); const a = arena.getBoundingClientRect(), r = im.getBoundingClientRect();
    Object.assign(ghost.style, { position: 'absolute', left: (r.left - a.left) + 'px', top: (r.top - a.top) + 'px', width: r.width + 'px', height: r.height + 'px', opacity: .45,
      filter: 'brightness(1.6) sepia(1) hue-rotate(170deg) saturate(3)', pointerEvents: 'none', zIndex: 1, translate: 'none', rotate: 'none', scale: 'none' });
    ghost.removeAttribute('onerror'); arena.insertBefore(ghost, canvas);
    ghost.animate([{ opacity: .45 }, { opacity: 0 }], { duration: 260 / Math.max(.25, speed()) }).onfinish = () => ghost.remove();
  }

  /* ── 입자 ── */
  function sparks(x, y, dir, I, crit, col = SPARK_COL) {
    const n = Math.round(8 + 24 * I) + (crit ? 14 : 0);
    for (let i = 0; i < n; i++) { const a = (dir > 0 ? 0 : Math.PI) + rnd(-1, 1) - .25 * Math.random() * dir, v = rnd(.3, 1.3) * S * (.8 + .6 * I);
      parts.push({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - .1 * S, life: rnd(160, 380), age: 0, w: rnd(1.2, 2.6) * S, col: col[(Math.random() * col.length) | 0], drag: .994, grav: .0012 * S }); }
    if (I > .55 || crit) for (let i = 0; i < Math.round(1 + 5 * I); i++) debris(x, y, dir, .8);
    if (crit || I > 1) parts.push({ k: 'ring', x, y, r0: 8 * S, r1: (70 + 40 * I) * S, life: 260, age: 0, col: crit ? '#ffd45a' : '#ffffff', w: 4 * S });
    parts.push({ k: 'glow', x, y, r: (40 + 50 * I) * S, life: 120, age: 0, col: '255,230,170' });
  }
  function debris(x, y, dir, p = 1, floor = H * .92) {
    const a = (dir > 0 ? -.6 : Math.PI + .6) + rnd(-.7, .7), v = rnd(.25, .7) * S * p;
    parts.push({ k: 'chunk', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - .35 * S, life: rnd(700, 1100), age: 0, s: rnd(3, 7) * S, rot: rnd(0, 6), vr: rnd(-.02, .02), grav: .0016 * S, floor });
  }
  function explosion(x, y, floor) {
    for (let i = 0; i < 16; i++) parts.push({ k: 'fire', x: x + rnd(-30, 30) * S, y: y + rnd(-40, 20) * S, vx: rnd(-.08, .08) * S, vy: rnd(-.12, -.02) * S, r0: rnd(12, 26) * S, r1: rnd(40, 80) * S, life: rnd(380, 700), age: rnd(-120, 0) });
    for (let i = 0; i < 14; i++) parts.push({ k: 'smoke', x: x + rnd(-40, 40) * S, y: y + rnd(-50, 10) * S, vx: rnd(-.05, .05) * S, vy: rnd(-.08, -.03) * S, r0: rnd(18, 30) * S, r1: rnd(70, 120) * S, life: rnd(1100, 1700), age: rnd(-260, -60) });
    sparks(x, y, 1, 1.3, false); sparks(x, y, -1, 1.3, false);
    for (let i = 0; i < 14; i++) debris(x, y, Math.random() < .5 ? 1 : -1, 1.4, floor);
    parts.push({ k: 'ring', x, y, r0: 20 * S, r1: 220 * S, life: 420, age: 0, col: '#ffcf8a', w: 6 * S });
    parts.push({ k: 'glow', x, y, r: 260 * S, life: 300, age: 0, col: '255,190,120' });
  }
  function dust(x, y) { for (let i = 0; i < 18; i++) { const d = i % 2 ? 1 : -1; parts.push({ k: 'smoke', x: x + d * rnd(10, 60) * S, y: y - rnd(0, 10) * S, vx: d * rnd(.1, .35) * S, vy: rnd(-.05, -.01) * S, r0: rnd(8, 14) * S, r1: rnd(30, 50) * S, life: rnd(500, 800), age: 0, dustc: true }); } }
  function converge(x, y, col) { for (let i = 0; i < 26; i++) parts.push({ k: 'in', tx: x, ty: y, a: rnd(0, 7), R: rnd(90, 160) * S, life: rnd(300, 420), age: rnd(-80, 0), col }); }
  function miniBlast(x, y) {
    for (let i = 0; i < 6; i++) parts.push({ k: 'fire', x: x + rnd(-14, 14) * S, y: y + rnd(-14, 10) * S, vx: rnd(-.04, .04) * S, vy: -rnd(.02, .06) * S, r0: rnd(6, 12) * S, r1: rnd(22, 38) * S, life: rnd(260, 420), age: 0 });
    for (let i = 0; i < 5; i++) parts.push({ k: 'smoke', x: x + rnd(-18, 18) * S, y: y + rnd(-18, 8) * S, vx: rnd(-.03, .03) * S, vy: -rnd(.03, .06) * S, r0: 8 * S, r1: rnd(30, 50) * S, life: rnd(700, 1000), age: rnd(-120, 0), a: .4 });
  }
  function muzzle(A, G, cat) {
    const x = G.cx + A.dir * G.fw * .27, y = cat === 'shell' || cat === 'missile' ? G.floor - G.fh * .74 : chestY(G) - G.fh * .1;
    parts.push({ k: 'muzzle', x, y, dir: A.dir, r: (cat === 'shell' ? 62 : cat === 'sniper' ? 48 : cat === 'gatling' ? 26 : 34) * S, life: cat === 'shell' ? 170 : cat === 'gatling' ? 80 : 120, age: 0 });
    parts.push({ k: 'glow', x, y, r: (cat === 'shell' ? 120 : 80) * S, life: 110, age: 0, col: '255,200,120' });
    if (cat === 'sniper' || cat === 'gatling' || cat === 'shell' || cat === 'rifle') {          // 탄피 — 뒤로 튀어 바닥에 구른다
      const a = -Math.PI / 2 - A.dir * rnd(.5, 1.1), v = rnd(.25, .45) * S;
      parts.push({ k: 'chunk', brass: true, x: x - A.dir * 18 * S, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(700, 1000), age: 0, s: (cat === 'shell' ? 9 : 5) * S, rot: rnd(0, 6), vr: rnd(-.03, .03), grav: .0016 * S, floor: G.floor });
    }
    for (let i = 0; i < (cat === 'shell' ? 6 : cat === 'gatling' ? 1 : 3); i++) parts.push({ k: 'smoke', light: true, a: .4, x: x + A.dir * rnd(4, 18) * S, y: y + rnd(-6, 6) * S, vx: A.dir * rnd(.02, .08) * S, vy: -rnd(.01, .04) * S, r0: rnd(4, 8) * S, r1: rnd(18, cat === 'shell' ? 44 : 26) * S, life: rnd(420, 700), age: 0 });
    if (cat === 'shell') { addTrauma(.2); for (let i = 0; i < 6; i++) parts.push({ k: 'smoke', dustc: true, x: G.cx + rnd(-30, 30) * S, y: G.floor, vx: rnd(-.12, .12) * S, vy: -rnd(.01, .04) * S, r0: 6 * S, r1: 26 * S, life: 600, age: 0 }); }
    return { x, y };
  }
  const tracer = (x0, y0, x1, y1, long) => parts.push({ k: 'tracer', x0, y0, x1, y1, life: long ? 300 : 140, age: 0, long });

  /* ── 사격 · 근접 — plan() 이 시각표보다 먼저 부른다 ── */
  /* onShoot — 모션 엔진의 탄 · 참격을 시작할 때(원거리: 겨눔이 끝날 때 · 근접: 돌진 직전) */
  function fire(aK, dK, type, miss, onShoot) {
    const A = unit(aK), cat = shotCat(type); if (A.dead) return;
    const GA = geo(aK), GD = geo(dK), D = unit(dK);
    if (!cat) { windup(A); after(60, () => { if (!A.dead) onShoot?.(); }); return; }
    const t = AIM[cat], mz = { x: GA.cx + A.dir * GA.fw * .27, y: chestY(GA) - GA.fh * .1 };
    brace(A, t);
    const tx = miss ? GD.cx + A.dir * W * .5 : contactX(GD, A.dir), ty = chestY(GD) + rnd(-16, 16) * S;
    if (cat === 'sniper') { parts.push({ k: 'glint', x: mz.x, y: mz.y, life: t + 30, age: 0 }); parts.push({ k: 'laser', x: mz.x, y: mz.y, x1: tx, y1: ty, life: t, age: 0 }); }
    if (cat === 'beam') { parts.push({ k: 'charge', x: mz.x, y: mz.y, life: t + 40, age: 0 }); for (let i = 0; i < 16; i++) parts.push({ k: 'in', tx: mz.x, ty: mz.y, a: rnd(0, 7), R: rnd(30, 70) * S, life: rnd(160, t), age: rnd(-60, 0), col: '140,245,255' }); }
    const n = cat === 'gatling' ? 6 : 1;
    for (let k = 0; k < n; k++) after(t + k * 40, () => {
      if (A.dead || D.dead && !miss) return;
      const m = muzzle(A, GA, cat); recoil(A, RECOIL[cat]);
      if (!k) onShoot?.();
      if (k) tracer(m.x, m.y, tx + rnd(-8, 8) * S, ty + rnd(-8, 8) * S, false);           // 개틀링 — 첫 발은 모션 엔진이 그리고, 뒤 발은 예광탄
    });
  }
  /* 즉시 동작 — 미리 알 수 없던 타(스킬 연타 · 반격) */
  function quick(aK, dK, type, miss) {
    const A = unit(aK), cat = shotCat(type); if (A.dead) return;
    if (!cat) { jab(A); return; }
    const GA = geo(aK), GD = geo(dK), m = muzzle(A, GA, cat);
    recoil(A, RECOIL[cat] * .7);
    tracer(m.x, m.y, miss ? GD.cx + A.dir * W * .5 : contactX(GD, A.dir), chestY(GD) + rnd(-16, 16) * S, cat === 'sniper');
  }

  /* ── 피해 숫자 ── */
  let numSlot = 0;
  function num(k, text, kind, I = .5, fromDir = 0, cap = '') {
    const U = unit(k), G = geo(k), el = document.createElement('div');
    el.className = 'bfx-num ' + kind; el.textContent = text;
    if (cap) { const c = document.createElement('span'); c.className = 'cap'; c.textContent = cap; el.appendChild(c); }
    nums.appendChild(el);
    const size = kind === 'crit' ? 30 + 20 * I : kind === 'norm' ? 15 + 24 * I : 19;
    el.style.fontSize = Math.max(12, size * Math.max(.7, S)) + 'px';
    numSlot = (numSlot + 1) % 3;
    U.numStack = gt - U.numAt < 380 ? U.numStack + 1 : 0; U.numAt = gt;          // 연달아 뜨면 위로 쌓는다
    const n = { el, t0: gt, x: G.cx + (numSlot - 1) * 18 * S + rnd(-5, 5) * S, y: headY(G) - U.numStack * size * 1.05 * Math.max(.7, S), vx: fromDir * rnd(.03, .07) * S, vy: -.42 * S, crit: kind === 'crit', life: 950 };
    el.style.transform = `translate(${n.x}px,${n.y}px) translate(-50%,-50%) scale(2)`;           // 다음 프레임 전에도 제자리에
    numList.push(n);
  }

  /* ── 체력 잔상 — 깎인 만큼 밝은 띠가 380ms 머물렀다 따라 줄어든다 ── */
  const bars = {};
  function bar(k) {
    if (bars[k]?.el.isConnected) return bars[k];
    const host = arena.querySelector('#hp-' + k); if (!host) return null;
    host.classList.add('bfx-bar');
    let gh = host.querySelector('.bfx-ghost'); if (!gh) { gh = document.createElement('b'); gh.className = 'bfx-ghost'; host.prepend(gh); }
    return bars[k] = { el: gh, host, pct: 100, gpct: 100, gHold: 0 };
  }
  function hp(k, value, max, instant) {
    const U = unit(k); U.hp = value; U.max = max || U.max;
    const B = bar(k), pct = clamp(value / U.max * 100, 0, 100); if (!B) return;
    if (instant) B.gpct = pct; else if (pct < B.pct) { B.gpct = Math.max(B.gpct, B.pct); B.gHold = gt + 380; } else B.gpct = Math.max(B.gpct, pct);
    B.pct = pct;
  }

  /* ── 특화기술 ── */
  function shieldBreak(U, G) {
    for (let i = 0; i < 18; i++) { const a = rnd(0, 7), v = rnd(.15, .5) * S;
      parts.push({ k: 'spark', x: G.cx + Math.cos(a) * G.fw * .35, y: chestY(G) + Math.sin(a) * G.fh * .4, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(300, 600), age: 0, w: 2 * S, col: ['#9fe4ff', '#ffffff', '#5ab8ff'][i % 3], drag: .995, grav: .0006 * S }); }
    parts.push({ k: 'ring', x: G.cx, y: chestY(G), r0: G.fw * .3, r1: G.fw * .6, life: 280, age: 0, col: '#8fd8ff', w: 3 * S });
  }
  function pierceOut(G, dir) {
    const y = chestY(G); parts.push({ k: 'ring', x: G.cx, y, r0: 6 * S, r1: 40 * S, life: 200, age: 0, col: '#cfe0ff', w: 3 * S });
    for (let i = 0; i < 12; i++) parts.push({ k: 'spark', x: G.cx + dir * G.fw * .2, y: y + rnd(-14, 14) * S, vx: dir * rnd(.6, 1.6) * S, vy: rnd(-.08, .08) * S, life: rnd(160, 320), age: 0, w: rnd(1.2, 2.4) * S, col: ['#cfe0ff', '#ffffff', '#8fb8ff'][i % 3], drag: .996, grav: 0 });
  }

  /* ── 사건 ── */
  function impact(aK, dK, e, { maxhp, kind } = {}) {
    const A = unit(aK), D = unit(dK), GD = geo(dK), dir = A.dir, cat = kind;
    if (e.miss) { num(dK, 'MISS', 'miss', .5, dir); dodge(D, dir);
      if (!cat) for (let i = 0; i < 5; i++) parts.push({ k: 'spark', x: GD.cx - dir * 60 * S, y: chestY(GD) + rnd(-50, 30) * S, vx: dir * rnd(1, 1.6) * S, vy: 0, life: 160, age: 0, w: 1.2 * S, col: '#cfe0ff', drag: 1, grav: 0 });
      return; }
    const max = maxhp || D.max || 1, I = clamp((e.dmg || 0) / max / .16, .25, 1.4) * (e.crit ? 1.15 : 1), stopMs = 25 + 55 * I + (e.crit ? 40 : 0);
    hitstop(stopMs);
    D.flashUntil = performance.now() + stopMs / Math.max(.25, speed()) + 60;
    knock(D, dir, I);
    const cx = contactX(GD, dir), cy = chestY(GD) + rnd(-20, 20) * S;
    sparks(cx, cy, dir, I, e.crit);
    if (cat === 'shell' || cat === 'missile') miniBlast(cx, chestY(GD));
    if (A.skill && A.skillFx) {
      const fx = A.skillFx; A.combo++;
      if ((fx.hits || 1) > 1) num(dK, `×${A.combo}`, 'info', .5, dir);
      if (fx.ignoreDef) pierceOut(GD, dir);
      if (fx.shred) { for (let i = 0; i < 8; i++) debris(GD.cx - dir * GD.fw * .15, chestY(GD) + rnd(-30, 20) * S, -dir, 1.3, GD.floor); if (A.combo === 1) num(dK, '장갑 파쇄', 'info', .5, dir); }
      if (fx.execute && (e.thp + e.dmg + (e.absorb || 0)) < max * .35 && A.combo === 1) {        // 처형 — 마무리 일격
        hold += 260; slowLeft = 520; slowScale = .25; banner('처형!', dK[0] === 'p' ? 'e' : 'p');
        parts.push({ k: 'ring', x: GD.cx, y: chestY(GD), r0: 10 * S, r1: 170 * S, life: 380, age: 0, col: '#ff5a5a', w: 6 * S });
        parts.push({ k: 'glow', x: GD.cx, y: chestY(GD), r: 200 * S, life: 300, age: 0, col: '255,60,60' }); addTrauma(.5);
      }
      if (fx.drain) drain(aK, dK);
    }
    if (D.shield > 0 && e.absorb) { D.shield = Math.max(0, D.shield - e.absorb); D.ripple = { x: cx, y: chestY(GD), t0: gt }; if (D.shield <= 0) shieldBreak(D, GD); }
    addTrauma(.08 + .34 * I + (e.crit ? .2 : 0));
    num(dK, String(e.dmg), e.crit ? 'crit' : 'norm', I, dir, e.crit ? 'CRITICAL' : '');
    if (e.absorb) num(dK, '방벽 −' + e.absorb, 'info', .4, dir);
    hp(dK, e.thp, max);
    if (e.thp <= 0) knockout(D, A, GD);
  }
  function knockout(D, A, GD) {
    stopLeft = Math.max(stopLeft, 240); slowLeft = 650; slowScale = .35; hold += 500;
    const x = GD.cx, y = chestY(GD);
    after(1, () => { explosion(x, y, GD.floor); trauma = 1; });
    D.flashUntil = performance.now() + 260; D.dead = true;
    anim(D, 1e9, u => { const p = ease.out(Math.min(1, u / 700)); return { r: A.dir * 13 * p, y: 16 * S * p, x: A.dir * 26 * S * p }; }, 'dead');
  }
  function parry(pK, aK, type, pre) {
    const P = unit(pK), A = unit(aK), cat = shotCat(type), GP = geo(pK);
    if (!pre) quick(aK, pK, type, false);
    num(pK, 'PARRY', 'parry', .7, A.dir); hitstop(90);
    if (cat) knock(P, A.dir, .35); else { knock(A, P.dir, 1.2); knock(P, A.dir, .25); }
    sparks(contactX(GP, A.dir), chestY(GP), P.dir, .9, false, ['#ffffff', '#cfe8ff', '#7bf0ff', '#ffe9a0']);
    A.flashUntil = performance.now() + 150; addTrauma(.3);
  }
  function skill(k, fx, label) {
    const U = unit(k), G = geo(k), st = skillStyle(fx, k[0] === 'p');
    U.skill = true; U.skillFx = fx || null; U.combo = 0;
    banner(label + (st.tag ? ' · ' + st.tag : ''), k);
    /* 0.4초 기 모으기 — 시각표의 스킬 → 첫 타 사이(420ms) 안에 넣어 판을 늘리지 않는다 */
    U.glowUntil = gt + 480; U.glowCol = st.col; converge(G.cx, chestY(G), st.rgb);
    after(380, () => { parts.push({ k: 'ring', x: G.cx, y: chestY(G), r0: 20 * S, r1: 130 * S, life: 300, age: 0, col: st.col, w: 5 * S }); addTrauma(.25); });
  }
  function turn(k) { const U = unit(k); U.skill = false; U.skillFx = null; }
  function heal(k, amt, src, fromK) {
    const U = unit(k), G = geo(k); num(k, '+' + amt, 'heal', .4);
    if (src === 'repair') { parts.push({ k: 'sweep', x: G.cx, y: G.floor, w: G.fw * .8, h: G.fh * .85, life: 520, age: 0 });
      for (let i = 0; i < 10; i++) parts.push({ k: 'mote', x: G.cx + rnd(-.35, .35) * G.fw, y: G.floor - rnd(0, G.fh * .6), vx: 0, vy: -rnd(.08, .2) * S, life: rnd(400, 700), age: rnd(-100, 0), col: '110,255,170' }); }
    else if (!src && fromK) drain(k, fromK);
    else for (let i = 0; i < 12; i++) parts.push({ k: 'mote', x: G.cx + rnd(-40, 40) * S, y: chestY(G) + rnd(-30, 50) * S, vx: 0, vy: rnd(-.12, -.05) * S, life: rnd(500, 800), age: rnd(-100, 0), col: '79,227,154' });
    return U;
  }
  function drain(toK, fromK) { const a = geo(fromK), b = geo(toK);
    for (let i = 0; i < 16; i++) parts.push({ k: 'stream', x0: a.cx + rnd(-.1, .1) * a.fw, y0: chestY(a) + rnd(-.1, .1) * a.fh, x1: b.cx, y1: chestY(b), life: rnd(320, 520), age: rnd(-160, 0), w: rnd(1.4, 3) * S }); }
  function shield(k, amt, now) { const U = unit(k), G = geo(k); num(k, '방벽 ' + amt, 'heal', .4);
    U.shield = now ?? amt; U.shieldMax = Math.max(U.shieldMax, U.shield);
    parts.push({ k: 'ring', x: G.cx, y: chestY(G), r0: G.fw * .2, r1: G.fw * .5, life: 300, age: 0, col: '#8fd8ff', w: 3 * S }); }
  function mark(k) { unit(k).marked = gt; num(k, '표적', 'info', .4); }
  function jam(k) {
    const U = unit(k), G = geo(k); num(k, 'JAM', 'miss', .4);
    anim(U, 420, u => ({ x: (Math.random() - .5) * 18 * S * (1 - u / 420), sx: 1 + (Math.random() - .5) * .08 * (1 - u / 420) }), 'jam');
    for (let i = 0; i < 9; i++) parts.push({ k: 'spark', x: G.cx - G.fw * .35, y: G.floor - G.fh * rnd(.1, .9), vx: rnd(.5, 1.4) * S, vy: 0, life: rnd(90, 200), age: 0, w: rnd(1, 2.5) * S, col: ['#7bf0ff', '#ffffff', '#ff6af0'][i % 3], drag: 1, grav: 0 });
    U.glitchUntil = performance.now() + 420 / Math.max(.25, speed());
  }
  /* 띠 — 게임의 #skillbanner 를 쓴다(쪽에 따라 색 · 들어오는 방향) */
  function banner(txt, k) {
    const b = arena.querySelector('#skillbanner'); if (!b) return;
    b.textContent = txt; b.classList.remove('on', 'bfx-juice', 'r'); void b.offsetWidth;
    b.classList.add('bfx-juice'); if (k && k[0] === 'e') b.classList.add('r');
    b.style.setProperty('--from', k && k[0] === 'e' ? '60%' : '-60%'); b.style.setProperty('--bfx-dur', (1.1 / Math.max(.25, speed())).toFixed(2) + 's');
  }
  /* 교대 — 사라졌다가 다음 기체가 위에서 떨어져 착지. draw() 가 그림을 바꾼다 */
  function swap(k, draw, name) {
    const U = unit(k), el = elOf(k); hold += 600;
    if (el) el.style.opacity = 0;
    after(160, () => {
      draw(); Object.assign(U, { dead: false, anims: [], shield: 0, shieldMax: 0, marked: 0, ripple: null, skill: false, skillFx: null, smk: 0, spk: 0 });
      const e2 = elOf(k); if (e2) e2.style.opacity = '';
      const G = geo(k), drop = H * 1.1;
      anim(U, 300, u => ({ y: -drop * (1 - ease.in(u / 300)), sx: .94, sy: 1.08 }));
      after(300, () => { anim(U, 420, u => { const q = Math.exp(-u / 90) * Math.cos(u / 55); return { sx: 1 + .16 * q, sy: 1 - .16 * q }; }); dust(G.cx, G.floor); addTrauma(.55); hitstop(70); banner('교대 — ' + name, k); });
    });
  }
  /* 등장 — 두 기체가 걸어 들어와 서고 VS · FIGHT. 전투는 그만큼(1.5초) 늦게 시작한다 */
  function intro(keys, names) {
    hold += 1500;
    keys.forEach((k, i) => {
      const U = unit(k), el = elOf(k); if (el) el.style.opacity = 0;
      after(i ? 220 : 0, () => {
        if (el) el.style.opacity = '';
        anim(U, 520, u => { const q = ease.out(u / 520); return { x: -U.dir * W * .42 * (1 - q), y: -Math.abs(Math.sin(u / 520 * Math.PI * 3)) * 8 * S * (1 - q) }; });
        after(520, () => { const G = geo(k); dust(G.cx, G.floor); addTrauma(.3); anim(U, 260, u => { const q = Math.exp(-u / 70) * Math.cos(u / 45); return { sx: 1 + .08 * q, sy: 1 - .08 * q }; }); });
      });
    });
    after(900, () => banner(names.join('  VS  '), 'p'));
    after(1250, () => banner('FIGHT!', 'p'));
  }
  /* 끝 — 이긴 쪽이 뛰고 위에서 불꽃이 내린다. 지면 화면이 회색으로 */
  function finish(win, winKey) {
    const Wn = winKey && unit(winKey);
    if (win === false) arena.classList.add('bfx-lose');
    if (Wn && !Wn.dead) {
      anim(Wn, 900, u => ({ y: -Math.abs(Math.sin(u / 900 * Math.PI * 2)) * 26 * S * (1 - u / 900), sx: 1 + .03 * Math.sin(u / 60), sy: 1 - .03 * Math.sin(u / 60) }));
      for (let i = 0; i < 40; i++) parts.push({ k: 'spark', x: rnd(W * .2, W * .8), y: -10, vx: rnd(-.05, .05) * S, vy: rnd(.1, .3) * S, life: rnd(900, 1500), age: rnd(0, 400), w: rnd(1.5, 3) * S, col: ['#ffd45a', '#fff3b0', '#7bf0ff', '#ff9a3a'][i % 4], drag: 1, grav: .0001 * S });
    }
  }

  /* ── 미리 준비 — 엔진 사건열을 처음에 한 번 훑어, 행동 첫 타의 예비 동작 · 사격을 시각표보다 먼저 건다 ──
   * plan(t, lead, fn) — 시각표 t 보다 lead 만큼 먼저 fn. 이미 지난 시각이면 바로 */
  function plan(t, lead, fn) { timers.push({ at: t - lead, fn, tl: true }); }

  /* ── 대기 ── */
  function until(t, abort = () => false) {
    if (disposed || tlNow() >= t || abort()) return Promise.resolve();
    return new Promise(res => waiters.push({ t, res, abort }));
  }
  const wait = (ms, abort) => until(tlNow() + ms, abort);

  /* ── 그리기 ── */
  function drawStatus() {
    g.globalCompositeOperation = 'lighter';
    for (const U of Object.values(F)) {
      if (U.dead) continue; const G = geo(U.k), cx = G.cx, cy = chestY(G);
      if (U.shield > 0) {
        const q = clamp(U.shield / Math.max(1, U.shieldMax), .2, 1), pul = .85 + .15 * Math.sin(gt / 260 + cx), rx = G.fw * .46, ry = G.fh * .56;
        const gr = g.createRadialGradient(cx, cy, ry * .5, cx, cy, ry);
        gr.addColorStop(0, 'rgba(90,200,255,0)'); gr.addColorStop(.8, `rgba(90,200,255,${.12 * q * pul})`); gr.addColorStop(1, `rgba(170,235,255,${.4 * q * pul})`);
        g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.fill();
        g.strokeStyle = `rgba(160,230,255,${.55 * q * pul})`; g.lineWidth = 1.6 * S; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.stroke();
        g.strokeStyle = `rgba(160,230,255,${.18 * q})`; g.lineWidth = S;
        for (let k = -2; k <= 2; k++) { g.beginPath(); g.ellipse(cx, cy, rx * Math.abs(Math.cos(k * .5)), ry, 0, -1.2, 1.2); g.stroke(); }
        if (U.ripple) { const u = (gt - U.ripple.t0) / 320; if (u >= 1) U.ripple = null; else { g.strokeStyle = `rgba(230,250,255,${.9 * (1 - u)})`; g.lineWidth = 3 * S * (1 - u); g.beginPath(); g.arc(U.ripple.x, U.ripple.y, (14 + 60 * u) * S, 0, 7); g.stroke(); } }
      }
      if (U.marked) {
        const u = clamp((gt - U.marked) / 300, 0, 1), R = (34 - 18 * ease.out(u)) * S, hy = headY(G) - 10 * S;
        g.strokeStyle = `rgba(255,80,80,${.5 + .5 * Math.sin(gt / 150)})`; g.lineWidth = 1.8 * S; g.beginPath(); g.arc(cx, hy, R, 0, 7); g.stroke();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.beginPath(); g.moveTo(cx + dx * R * .55, hy + dy * R * .55); g.lineTo(cx + dx * R * 1.4, hy + dy * R * 1.4); g.stroke(); }
      }
    }
    g.globalCompositeOperation = 'source-over';
  }
  function damageFx(U, dt) {
    if (U.dead || !dt) return; const q = U.hp / U.max; if (q >= .5) return; const G = geo(U.k);
    U.smk += dt * (q < .25 ? .02 : .008);
    while (U.smk >= 1) { U.smk -= 1; parts.push({ k: 'smoke', a: q < .25 ? .42 : .3, x: G.cx + rnd(-.16, .16) * G.fw, y: G.floor - G.fh * rnd(.45, .8), vx: -U.dir * rnd(.005, .03) * S, vy: -rnd(.04, .09) * S, r0: rnd(4, 8) * S, r1: rnd(22, 40) * S, life: rnd(900, 1400), age: 0 }); }
    if (q < .25) { U.spk += dt * .0022; if (U.spk >= 1) { U.spk = 0; const x = G.cx + rnd(-.15, .15) * G.fw, y = G.floor - G.fh * rnd(.35, .75);
      for (let i = 0; i < 6; i++) { const a = rnd(-Math.PI, 0), v = rnd(.15, .5) * S; parts.push({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(150, 300), age: 0, w: 1.3 * S, col: SPARK_COL[(Math.random() * 4) | 0], drag: .994, grav: .0015 * S }); }
      parts.push({ k: 'glow', x, y, r: 26 * S, life: 110, age: 0, col: '255,170,80' }); U.flickUntil = performance.now() + 60; } }
  }
  function draw() {
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      if (p.age < 0) continue; const u = p.age / p.life;
      if (p.k === 'smoke') { const r = p.r0 + (p.r1 - p.r0) * ease.out(u); g.globalCompositeOperation = 'source-over';
        g.fillStyle = p.dustc ? `rgba(120,110,100,${.28 * (1 - u)})` : p.light ? `rgba(170,170,176,${(p.a ?? .35) * (1 - u)})` : `rgba(40,38,44,${(p.a ?? .5) * (1 - u)})`; g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.fill(); }
      else if (p.k === 'chunk') { g.globalCompositeOperation = 'source-over'; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, 3 * (1 - u));
        if (p.brass) { g.fillStyle = '#d9a441'; g.fillRect(-p.s / 2, -p.s * .2, p.s, p.s * .4); } else { g.fillStyle = '#3b4250'; g.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .7); g.fillStyle = '#ff9a3a'; g.fillRect(-p.s / 2, -p.s / 2, p.s, 1.2 * S); }
        g.restore(); g.globalAlpha = 1; }
    }
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (const p of parts) {
      if (p.age < 0) continue; const u = p.age / p.life;
      if (p.k === 'spark') { g.strokeStyle = p.col; g.globalAlpha = 1 - u; g.lineWidth = p.w * (1 - u * .5); g.beginPath(); g.moveTo(p.x - p.vx * 15, p.y - p.vy * 15); g.lineTo(p.x, p.y); g.stroke(); }
      else if (p.k === 'fire') { const r = p.r0 + (p.r1 - p.r0) * ease.out(u), gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        gr.addColorStop(0, `rgba(255,240,200,${.9 * (1 - u)})`); gr.addColorStop(.4, `rgba(255,140,40,${.7 * (1 - u)})`); gr.addColorStop(1, 'rgba(120,20,0,0)'); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.fill(); }
      else if (p.k === 'ring') { const r = p.r0 + (p.r1 - p.r0) * ease.out(u); g.globalAlpha = 1 - u; g.strokeStyle = p.col; g.lineWidth = Math.max(.1, p.w * (1 - u)); g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.stroke(); }
      else if (p.k === 'glow') { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); gr.addColorStop(0, `rgba(${p.col},${.55 * (1 - u)})`); gr.addColorStop(1, `rgba(${p.col},0)`); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
      else if (p.k === 'in') { const q = ease.in(u), R = p.R * (1 - q); g.globalAlpha = .3 + .7 * q; g.fillStyle = `rgb(${p.col})`; g.beginPath(); g.arc(p.tx + Math.cos(p.a) * R, p.ty + Math.sin(p.a) * R, (1.5 + 2 * q) * S, 0, 7); g.fill(); }
      else if (p.k === 'muzzle') { const R = p.r * (1 - u * .4), gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
        gr.addColorStop(0, `rgba(255,250,220,${1 - u})`); gr.addColorStop(.35, `rgba(255,190,80,${.8 * (1 - u)})`); gr.addColorStop(1, 'rgba(255,120,20,0)'); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, R, 0, 7); g.fill();
        g.strokeStyle = `rgba(255,245,210,${1 - u})`;
        for (const [a, L] of [[0, 1.9], [.5, 1.1], [-.5, 1.1]]) { const ang = (p.dir > 0 ? 0 : Math.PI) + a * p.dir; g.lineWidth = (a ? 1.5 : 2.4) * S; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + Math.cos(ang) * R * L, p.y + Math.sin(ang) * R * L); g.stroke(); } }
      else if (p.k === 'glint') { const q = u * u, L = (3 + 11 * q) * S; g.globalAlpha = .4 + .6 * q; g.strokeStyle = '#fffbe0'; g.lineWidth = 1.4 * S;
        g.beginPath(); g.moveTo(p.x - L, p.y); g.lineTo(p.x + L, p.y); g.moveTo(p.x, p.y - L * .6); g.lineTo(p.x, p.y + L * .6); g.stroke(); }
      else if (p.k === 'laser') { const a = u < .8 ? .25 + .55 * u : (Math.sin(p.age / 12) > 0 ? .95 : .3); g.globalAlpha = a; g.strokeStyle = '#ff3b3b'; g.lineWidth = 1.2 * S;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x1, p.y1); g.stroke(); g.fillStyle = '#ff6060'; g.beginPath(); g.arc(p.x1, p.y1, 3 * S, 0, 7); g.fill(); }
      else if (p.k === 'charge') { const R = (2 + 11 * ease.in(u)) * S * (1 + .12 * Math.sin(p.age / 18)), gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
        gr.addColorStop(0, 'rgba(240,255,255,1)'); gr.addColorStop(.45, 'rgba(120,240,255,.85)'); gr.addColorStop(1, 'rgba(60,160,255,0)'); g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, R, 0, 7); g.fill(); }
      else if (p.k === 'tracer') { g.strokeStyle = `rgba(255,225,150,${.5 * (1 - u)})`; g.lineWidth = (p.long ? 6 : 4) * S; g.globalAlpha = 1; g.beginPath(); g.moveTo(p.x0, p.y0); g.lineTo(p.x1, p.y1); g.stroke();
        g.strokeStyle = `rgba(255,252,235,${1 - u})`; g.lineWidth = 1.3 * S; g.stroke(); }
      else if (p.k === 'stream') { const q = ease.in(u); g.globalAlpha = Math.sin(Math.PI * u); g.fillStyle = '#ff5a8a'; g.beginPath(); g.arc(p.x0 + (p.x1 - p.x0) * q, p.y0 + (p.y1 - p.y0) * q - Math.sin(Math.PI * q) * 30 * S, p.w, 0, 7); g.fill(); }
      else if (p.k === 'sweep') { const y = p.y - p.h * ease.out(u), gr = g.createLinearGradient(0, y - 30 * S, 0, y + 6 * S);
        gr.addColorStop(0, 'rgba(110,255,170,0)'); gr.addColorStop(1, `rgba(110,255,170,${.55 * (1 - u)})`); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(p.x - p.w / 2, y - 30 * S, p.w, 36 * S); }
      else if (p.k === 'mote') { g.globalAlpha = Math.sin(Math.PI * u); g.fillStyle = `rgb(${p.col})`; g.fillRect(p.x - 1.5 * S, p.y - 4 * S, 3 * S, 8 * S); g.fillRect(p.x - 4 * S, p.y - 1.5 * S, 8 * S, 3 * S); }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    drawStatus();
  }
  function stepParts(dt) {
    for (const p of parts) {
      p.age += dt; if (p.age < 0) continue;
      if (p.k === 'spark' || p.k === 'chunk' || p.k === 'fire' || p.k === 'smoke' || p.k === 'mote') {
        if (p.drag) { p.vx *= p.drag ** dt; p.vy *= p.drag ** dt; }
        if (p.grav) p.vy += p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.k === 'chunk') { p.rot += p.vr * dt; if (p.y > p.floor) { p.y = p.floor; p.vy *= -.35; p.vx *= .6; } }
      }
    }
    parts = parts.filter(p => p.age < p.life);
  }

  /* ── 한 프레임 ── */
  /* fallback — rAF 가 멈춘 창에서 타이머가 부를 때는 실제로 흐른 시간을 그대로 쓴다(잘라내면 전투가 느려진다) */
  function tick(now, fallback = false) {
    if (disposed) return;
    if (!arena.isConnected) { dispose(); return; }
    const dtReal = Math.min(fallback || document.hidden ? 1000 : 50, now - last); last = lastTick = now;
    const sp = Math.max(.25, Number(speed()) || 1);
    let dt = dtReal * sp;
    if (stopLeft > 0) { stopLeft -= dt; dt = 0; } else if (slowLeft > 0) { slowLeft -= dt; dt *= slowScale; }
    gt += dt;
    timers = timers.filter(t => { if ((t.tl ? tlNow() : gt) >= t.at) { try { t.fn(); } catch (err) { console.error(err); } return false; } return true; });
    waiters = waiters.filter(w => { if (tlNow() >= w.t || w.abort()) { w.res(); return false; } return true; });
    for (const U of Object.values(F)) {
      const el = elOf(U.k); if (!el) continue;
      let x = 0, y = 0, sx = 1, sy = 1, r = 0;
      U.anims = U.anims.filter(a => { const u = gt - a.t0; if (u > a.dur) return false; const o = a.fn(u); x += o.x || 0; y += o.y || 0; sx *= o.sx || 1; sy *= o.sy || 1; r += o.r || 0; return true; });
      damageFx(U, dt);
      el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`; el.style.rotate = r.toFixed(2) + 'deg'; el.style.scale = `${sx.toFixed(3)} ${sy.toFixed(3)}`;
      el.style.filter = now < U.flashUntil ? 'brightness(0) invert(1)'
        : now < U.glitchUntil ? `hue-rotate(${(now % 200) * 3}deg) saturate(2.2) contrast(1.3)`
        : now < U.flickUntil ? 'brightness(1.6) saturate(1.3)'
        : U.dead ? 'brightness(.35) saturate(.3)'
        : gt < U.glowUntil ? `drop-shadow(0 0 ${(10 + 8 * Math.sin(gt / 40)).toFixed(1)}px ${U.glowCol}) brightness(1.15)` : '';
    }
    /* 카메라 — 아레나 전체가 흔들린다(트라우마 제곱) */
    trauma = Math.max(0, trauma - dtReal * .0017);
    const sh = trauma * trauma, T = now / 1000;
    arena.style.translate = `${(sh * 14 * S * (Math.sin(T * 61) * .6 + Math.sin(T * 97 + 1.3) * .4)).toFixed(1)}px ${(sh * 10 * S * (Math.sin(T * 73 + 2.1) * .6 + Math.sin(T * 113 + .4) * .4)).toFixed(1)}px`;
    arena.style.rotate = (sh * 1.1 * Math.sin(T * 53 + .7)).toFixed(2) + 'deg';
    stepParts(dt); draw();
    /* 숫자 */
    numList = numList.filter(n => { const u = gt - n.t0; if (u > n.life) { n.el.remove(); return false; }
      const t = Math.min(u, 700), x = n.x + n.vx * t, y = n.y + n.vy * t + .0006 * S * t * t, s = u < 90 ? 2 - ease.out(u / 90) * 1.15 : .85 + .15 * Math.min(1, (u - 90) / 120);
      const o = u > n.life - 280 ? (n.life - u) / 280 : 1, r = n.crit && u < 260 ? Math.sin(u / 14) * 6 * (1 - u / 260) : 0;
      n.el.style.opacity = o; n.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) rotate(${r}deg) scale(${s})`; return true; });
    /* 체력 잔상 */
    for (const B of Object.values(bars)) { if (!B.el.isConnected) continue;
      if (gt > B.gHold && B.gpct > B.pct) B.gpct = Math.max(B.pct, B.gpct - (B.gpct - B.pct) * (1 - Math.exp(-dt / 140)) - .02 * dt);
      B.el.style.width = B.gpct + '%'; }
    /* 내 기체 위험 — 가장자리가 심장 박동처럼 붉게 뛴다 */
    const me = F.p || F.p0; let dop = 0;
    if (me && !me.dead && me.hp / me.max < .3) { const t = (now % 1100) / 1100, beat = Math.max(0, 1 - Math.abs(t - .08) / .08) + .7 * Math.max(0, 1 - Math.abs(t - .3) / .08); dop = (.35 + .65 * beat) * .8; }
    danger.style.opacity = dop;
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  const iv = setInterval(() => { if (!disposed && performance.now() - lastTick > 120) { cancelAnimationFrame(raf); tick(performance.now(), true); } }, 40);   // 창이 가려져 rAF 가 멈추면 타이머가 대신 돈다

  function dispose() {
    if (disposed) return; disposed = true;
    cancelAnimationFrame(raf); clearInterval(iv); ro?.disconnect();
    for (const w of waiters) w.res(); waiters = []; timers = [];
    canvas.remove(); nums.remove(); danger.remove();
    for (const U of Object.values(F)) { const el = elOf(U.k); if (el) { el.style.translate = el.style.rotate = el.style.scale = el.style.filter = ''; el.style.opacity = ''; } }
    arena.style.translate = arena.style.rotate = '';
    for (const B of Object.values(bars)) B.el.remove();
  }
  return { unit, hp, plan, fire, quick, impact, parry, skill, turn, heal, shield, mark, jam, swap, intro, finish, banner, until, wait, tlNow, dispose, addHold: ms => { hold += ms; } };
}
