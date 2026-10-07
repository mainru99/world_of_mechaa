/* 타격감 시험대 — 실제 전투 엔진의 사건을 연출만 바꿔 재생한다. (2026-09-29 · 사용자 지시)
 *
 * '지금 게임' 은 js/game.js playBattle 의 연출을 그대로 옮겼다 — 돌진 120px · 좌우 떨림 0.28초 ·
 * 화면 전체 섬광(불투명 0.18 · 0.34초 간격 제한) · 떠오르는 숫자 1초 · 체력 막대 0.35초 · 스킬 이름 띠.
 * 사건 시각도 같은 표(battleTimeline · TL)를 쓴다. 켜는 연출은 그 위에 하나씩 얹힌다.
 *
 * 시간은 셋이다.
 *   gt    게임 시간 — 사건 · 기체 동작 · 입자가 이걸 따른다. 히트스톱 동안 멈추고, 느린 재생에서 느려진다
 *   hold  사건을 뒤로 미룬 양 — 예비 동작 · 스킬 예고 · 격파 · 착지가 다음 사건을 기다리게 한다
 *   실시간 — 카메라 흔들림 · 기체 번쩍임은 멈춤 중에도 보여야 해서 실제 시계를 쓴다 */
import { ROBOT_TYPES } from '../../data/balance.js';
import { makeUnit, simulate } from '../../js/sim.js';
import { computeStats } from '../../js/stats.js';
import { Sfx } from './sfx.js?v=1007a';

const $ = s => document.querySelector(s);
const sfx = new Sfx();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── 연출 스위치 ── */
const TOGGLES = [
  ['sound',     '소리',          '타격 · 치명 · 회피 · 스킬 · 격파 · 착지마다 효과음'],
  ['hitstop',   '히트스톱',      '맞는 순간 몇십 ms 멈춘다. 큰 타격일수록 길게'],
  ['knock',     '튕겨남 · 회피 동작', '맞으면 뒤로 밀렸다 돌아오고, 피하면 비켜선다. 끄면 지금처럼 좌우 떨림'],
  ['anticip',   '예비 동작',     '움츠렸다 튀어 나간다. 찌그러졌다 늘어난다. 끄면 지금처럼 직선 돌진'],
  ['ranged',    '원거리 사격',   '저격 · 포격 · 미사일 · 빔 · 개틀링 기체 11기는 달려가지 않고 제자리에서 쏜다. 총구 화염 · 반동 · 탄 궤적', true],
  ['idle',      '대기 모션',     '가만히 서 있지 않고 숨 쉬듯 들썩이며 조금씩 흔들린다', true],
  ['flashSprite','맞은 기체 번쩍임', '맞은 기체만 하얗게. 끄면 지금처럼 화면 전체가 옅게 번쩍'],
  ['sparks',    '불꽃 · 파편',   '맞은 자리에서 불꽃, 큰 타격엔 쇳조각, 치명타엔 충격파'],
  ['shake',     '화면 흔들림',   '카메라가 흔들린다. 피해가 클수록 세게 · 치명타엔 확대'],
  ['ghost',     '체력 잔상',     '깎인 만큼 밝은 잔상이 남았다가 따라 줄어든다'],
  ['numbers',   '피해 숫자',     '크기가 피해에 비례하고 튀어 오른다. 끄면 지금처럼 같은 크기로 떠오른다'],
  ['telegraph', '스킬 예고',     '0.4초 기를 모은다 — 빛이 모이고 카메라가 다가간다'],
  ['ko',        '격파 · 교대',   '폭발 · 느린 재생 · 쓰러짐, 다음 기체가 떨어져 착지'],
  ['damage',    '파손 상태',     '체력 50% 밑이면 연기, 25% 밑이면 불꽃이 튀고 깜빡인다. 내 기체가 30% 밑이면 화면 가장자리가 붉게 뛴다', true],
  ['scale',     '세기 비례',     '모든 연출의 세기를 피해량에 맞춘다. 끄면 모든 타격이 같은 세기'],
];
const FX = Object.fromEntries(TOGGLES.map(([k]) => [k, true]));
let shakeAmt = reduced ? 0 : 1;
let speed = 1;

/* ── 대진 ── */
const LV = 30;
const ROBOTS = Object.values(ROBOT_TYPES).filter(r => !r.story && !r.monster)
  .sort((a, b) => 'C UC R UQ EP'.split(' ').indexOf(a.rarity) - 'C UC R UQ EP'.split(' ').indexOf(b.rarity) || a.name.localeCompare(b.name));
const pick = { p1: 'ranger', p2: 'azure', e1: 'dune', e2: 'bastion', relay: true };   // 근접 · 저격 · 미사일이 다 나오는 대진

/* 원거리 기체 — 역할 이름으로 가른다(2026-09-30 · 뽑기 기체 11기). 쏘는 모양이 다섯 가지
 *   aim 겨누는 시간 · fly 탄이 날아가는 시간 — 둘을 더한 만큼 먼저 쏘기 시작해서 탄이 닿는 순간 = 엔진의 명중 사건 */
const SHOT = {};
for (const r of Object.values(ROBOT_TYPES)) {
  const t = r.role || '';
  SHOT[r.id] = /개틀링/.test(t) ? 'gatling' : /빔|캐논/.test(t) ? 'beam' : /저격/.test(t) ? 'sniper' : /미사일/.test(t) ? 'missile' : /포격|시즈/.test(t) ? 'shell' : null;
}
const SHOT_KO = { sniper: '저격', gatling: '개틀링', beam: '빔', missile: '미사일', shell: '포격' };
const SHOT_T = { sniper: { aim: 280, fly: 110 }, gatling: { aim: 120, fly: 90, n: 6, gap: 40 }, beam: { aim: 320, fly: 0 },
                 missile: { aim: 60, fly: 420, n: 2, gap: 60 }, shell: { aim: 80, fly: 480 } };
const leadOf = k => { const t = SHOT_T[k]; return t.aim + t.fly + (t.n ? (t.n - 1) * t.gap : 0); };
const LEAD_MAX = 620;
const RECOIL = { sniper: 28, gatling: 7, beam: 14, missile: 10, shell: 34 };
let seed = (+new URLSearchParams(location.search).get('seed') || Math.random() * 1e9) >>> 0;   // ?seed=123 이면 그 판
const E0 = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const stOf = id => computeStats({ type: id, level: LV, fat: 0, skillLv: 0, slots: E0 }, []);
const mk = id => makeUnit(ROBOT_TYPES[id].name, id, stOf(id));

function buildBattle() {
  const P = mk(pick.p1), E = mk(pick.e1);
  const init = { p: { type: P.type, name: P.name, max: P.maxhp }, e: { type: E.type, name: E.name, max: E.maxhp } };
  const bench = pick.relay ? { P: [mk(pick.p2)], E: [mk(pick.e2)] } : undefined;
  return { ev: simulate(P, E, seed, bench), init };
}

/* ── 사건 시각표 — js/game.js battleTimeline · TL 과 같다 ── */
const TL = { gap: 520, min: 40,
  step: { start: 0, turn: 60, skill: 420, hit: 170, heal: 120, shield: 120, mark: 100, jam: 150, parry: 260, down: 220, trait: 320 } };
function battleTimeline(events) {
  const ats = events.filter(e => e.t === 'turn' && e.at != null).map(e => e.at);
  const avg = ats.length > 1 ? (ats[ats.length - 1] - ats[0]) / (ats.length - 1) : 0;
  const scale = avg > 0 ? TL.gap / avg : 0, t0 = ats.length ? ats[0] : 0;
  const out = []; let base = 0, off = 0, prev = -Infinity, n = 0;
  for (const e of events) {
    if (e.t === 'turn') { base = (e.at != null && scale) ? (e.at - t0) * scale : (n++ ? Math.max(prev + TL.min, base + TL.gap) : 0); off = 0; }
    const t = Math.max(base + off, prev + TL.min);
    off += TL.step[e.t] != null ? TL.step[e.t] : 80;
    out.push(t); prev = t;
  }
  if (out.length && out[0] < 0) out[0] = 0;
  return out;
}

/* ── 무대 치수 ── */
const stage = $('#stage'), cam = $('#cam'), canvas = $('#fx'), g2 = canvas.getContext('2d');
let W = 960, H = 540, S = 1, FW = 250, FH = 240, FLOOR = 470;
function layout() {
  const r = stage.getBoundingClientRect();
  W = r.width; H = r.height; S = W / 960;
  FW = W * 0.25; FH = FW * 420 / 440; FLOOR = H * 0.9;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  g2.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const F of Object.values(fighters)) {
    F.cx = W * (F.k === 'p' ? 0.27 : 0.73);
    Object.assign(F.el.style, { width: FW + 'px', height: FH + 'px', left: (F.cx - FW / 2) + 'px', top: (FLOOR - FH * 408 / 420) + 'px' });
  }
}

/* ── 기체 ── */
const fighters = {};
for (const k of ['p', 'e']) {
  const el = $('#f-' + k);
  fighters[k] = { k, el, img: el.querySelector('img'), dir: k === 'p' ? 1 : -1, cx: 0,
                  anims: [], flashUntil: 0, glowUntil: 0, dead: false, deadAt: 0, hp: 0, max: 1, name: '', type: '', wound: false };
}
const FS = side => fighters[side === 'P' ? 'p' : 'e'];
const other = F => fighters[F.k === 'p' ? 'e' : 'p'];
const headY = () => FLOOR - FH * 0.78;
const chestY = () => FLOOR - FH * 0.45;
const contactX = (D, fromDir) => D.cx - fromDir * FW * 0.2;

const ease = { out: u => 1 - (1 - u) ** 3, in: u => u * u, inOut: u => u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2, css: u => 1 - (1 - u) ** 2 };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
/* kind 가 같은 동작은 새 것이 옛 것을 대신한다 — 연타에서 돌진이 겹쳐 두 배로 나가지 않게(지금 게임의 CSS 클래스와 같다) */
const anim = (F, dur, fn, kind) => { if (kind) F.anims = F.anims.filter(a => a.kind !== kind); F.anims.push({ t0: gt, dur, fn, kind }); };

/* 지금 게임 — 돌진(.lungeL: translateX 120px, 0.18초 전환, 0.11초 뒤 해제) */
function lungeNow(F) {
  const D = 120 * S * F.dir, top = ease.css(110 / 180);
  anim(F, 290, u => u < 110 ? { x: D * ease.css(u / 180) } : { x: D * top * (1 - ease.css((u - 110) / 180)) }, 'atk');
}
/* 지금 게임 — 좌우 떨림(@keyframes shake) */
function shakeNow(F) {
  const K = [[0, 0], [.25, -6], [.5, 5], [.75, -3], [1, 0]];
  anim(F, 280, u => { const p = u / 280; for (let i = 1; i < K.length; i++) if (p <= K[i][0]) {
    const [a, x0] = K[i - 1], [b, x1] = K[i]; return { x: (x0 + (x1 - x0) * (p - a) / (b - a)) * S }; } return {}; }, 'hurt');
}
/* 예비 동작 — 움츠림 90ms → 돌진 60ms(늘어남) → 머묾 → 복귀. 부딪히는 순간이 150ms 에 온다 */
function windup(F) {
  const D = F.dir, R = 118 * S, B = 18 * S;
  anim(F, 390, u => {
    if (u < 90) { const p = ease.out(u / 90); return { x: -B * D * p, sx: 1 - .09 * p, sy: 1 + .08 * p, r: -3 * D * p }; }
    if (u < 150) { const p = ease.in((u - 90) / 60); return { x: D * (-B + (R + B) * p), sx: .91 + .22 * p, sy: 1.08 - .15 * p, r: D * (-3 + 7 * p) }; }
    if (u < 200) { const p = (u - 150) / 50; return { x: R * D, sx: 1.13 - .13 * p, sy: .93 + .07 * p, r: 4 * D * (1 - p) }; }
    const p = ease.out((u - 200) / 190); return { x: R * D * (1 - p) };
  }, 'atk');
}
/* 짧게 찌르기 — 스킬의 연타 · 반격 */
function jab(F) {
  const D = F.dir, R = 70 * S;
  anim(F, 220, u => u < 50 ? { x: R * D * ease.in(u / 50), sx: 1.08, sy: .95 } : { x: R * D * (1 - ease.out((u - 50) / 170)) }, 'atk');
}
/* 튕겨남 — 밀렸다가 감쇠 진동으로 제자리. 찌그러짐 · 기울어짐이 함께 */
function knock(F, fromDir, I) {
  const A = (8 + 30 * I) * S * fromDir;
  anim(F, 460, u => {
    const x = u < 50 ? A * ease.out(u / 50) : A * Math.exp(-(u - 50) / 110) * Math.cos((u - 50) / 70);
    const q = Math.max(0, 1 - u / 160);
    return { x, sx: 1 + .09 * I * q, sy: 1 - .08 * I * q, r: fromDir * 6 * I * Math.max(0, 1 - u / 260) };
  }, 'hurt');
}
function dodge(F, fromDir) {
  anim(F, 320, u => { const s = Math.sin(Math.PI * u / 320); return { x: fromDir * 34 * S * s, y: -12 * S * s, r: -fromDir * 4 * s }; }, 'hurt');
  afterimage(F);
}

/* ── 카메라 ── */
let trauma = 0, zooms = [], focus = null;
function addTrauma(x) { if (FX.shake) trauma = Math.min(1, trauma + x); }
function punch(z, dur) { zooms.push({ t0: gt, z, dur }); }

/* ── 화면 전체 섬광 — 광과민성 때문에 0.34초 간격 제한(js/game.js 와 같다) ── */
let lastFlash = -1e9, flashT0 = -1e9, flashPeak = 0;
function flashScreen(peak = 0.18) {
  const now = performance.now();
  if (now - lastFlash < 340) return;
  lastFlash = flashT0 = now; flashPeak = peak;
}

/* ── 입자 ── */
let parts = [];
const rnd = (a, b) => a + Math.random() * (b - a);
const SPARK_COL = ['#ffffff', '#fff3b0', '#ffd45a', '#ff9a3a'];
function sparks(x, y, dir, I, crit, col = SPARK_COL) {
  const n = Math.round(8 + 24 * I) + (crit ? 14 : 0);
  for (let i = 0; i < n; i++) {
    const a = (dir > 0 ? 0 : Math.PI) + rnd(-1, 1) * 1.0 - 0.25 * Math.random() * dir;   // 조금 위로
    const v = rnd(.3, 1.3) * S * (.8 + .6 * I);
    parts.push({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - .1 * S, life: rnd(160, 380), age: 0,
                 w: rnd(1.2, 2.6) * S, col: col[(Math.random() * col.length) | 0], drag: .994, grav: .0012 * S });
  }
  if (I > .55 || crit) for (let i = 0; i < Math.round(1 + 5 * I); i++) debris(x, y, dir, .8);
  if (crit || I > 1) parts.push({ k: 'ring', x, y, r0: 8 * S, r1: (70 + 40 * I) * S, life: 260, age: 0, col: crit ? '#ffd45a' : '#ffffff', w: 4 * S });
  parts.push({ k: 'glow', x, y, r: (40 + 50 * I) * S, life: 120, age: 0, col: '255,230,170' });
}
function debris(x, y, dir, p = 1) {
  const a = (dir > 0 ? -0.6 : Math.PI + 0.6) + rnd(-.7, .7), v = rnd(.25, .7) * S * p;
  parts.push({ k: 'chunk', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - .35 * S, life: rnd(700, 1100), age: 0,
               s: rnd(3, 7) * S, rot: rnd(0, 6), vr: rnd(-.02, .02), grav: .0016 * S });
}
function explosion(x, y) {
  for (let i = 0; i < 16; i++) parts.push({ k: 'fire', x: x + rnd(-30, 30) * S, y: y + rnd(-40, 20) * S, vx: rnd(-.08, .08) * S, vy: rnd(-.12, -.02) * S,
                                            r0: rnd(12, 26) * S, r1: rnd(40, 80) * S, life: rnd(380, 700), age: rnd(-120, 0) });
  for (let i = 0; i < 14; i++) parts.push({ k: 'smoke', x: x + rnd(-40, 40) * S, y: y + rnd(-50, 10) * S, vx: rnd(-.05, .05) * S, vy: rnd(-.08, -.03) * S,
                                            r0: rnd(18, 30) * S, r1: rnd(70, 120) * S, life: rnd(1100, 1700), age: rnd(-260, -60) });
  sparks(x, y, 1, 1.3, false); sparks(x, y, -1, 1.3, false);
  for (let i = 0; i < 14; i++) debris(x, y, Math.random() < .5 ? 1 : -1, 1.4);
  parts.push({ k: 'ring', x, y, r0: 20 * S, r1: 220 * S, life: 420, age: 0, col: '#ffcf8a', w: 6 * S });
  parts.push({ k: 'glow', x, y, r: 260 * S, life: 300, age: 0, col: '255,190,120' });
}
function dust(x, y) {
  for (let i = 0; i < 18; i++) { const d = i % 2 ? 1 : -1;
    parts.push({ k: 'smoke', x: x + d * rnd(10, 60) * S, y: y - rnd(0, 10) * S, vx: d * rnd(.1, .35) * S, vy: rnd(-.05, -.01) * S,
                 r0: rnd(8, 14) * S, r1: rnd(30, 50) * S, life: rnd(500, 800), age: 0, dustc: true }); }
}
function converge(x, y, col = '123,240,255') {
  for (let i = 0; i < 26; i++) { const a = rnd(0, Math.PI * 2), R = rnd(90, 160) * S;
    parts.push({ k: 'in', tx: x, ty: y, a, R, life: rnd(300, 420), age: rnd(-80, 0), col }); }
}
function healMotes(F) {
  for (let i = 0; i < 12; i++) parts.push({ k: 'mote', x: F.cx + rnd(-40, 40) * S, y: chestY() + rnd(-30, 50) * S, vx: 0, vy: rnd(-.12, -.05) * S,
                                            life: rnd(500, 800), age: rnd(-100, 0), col: '79,227,154' });
}
function airStreak(D, fromDir) {
  for (let i = 0; i < 5; i++) parts.push({ k: 'spark', x: D.cx - fromDir * 60 * S, y: chestY() + rnd(-50, 30) * S, vx: fromDir * rnd(1, 1.6) * S, vy: 0,
                                           life: 160, age: 0, w: 1.2 * S, col: '#cfe0ff', drag: 1, grav: 0 });
}
function stepParts(dt) {
  for (const p of parts) {
    p.age += dt;
    if (p.age < 0) continue;
    if (p.k === 'spark' || p.k === 'chunk' || p.k === 'fire' || p.k === 'smoke' || p.k === 'mote') {
      if (p.drag) { p.vx *= p.drag ** dt; p.vy *= p.drag ** dt; }
      if (p.grav) p.vy += p.grav * dt;
      p.px = p.x; p.py = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'chunk') { p.rot += p.vr * dt; if (p.y > FLOOR) { p.y = FLOOR; p.vy *= -.35; p.vx *= .6; } }
    }
  }
  parts = parts.filter(p => p.age < p.life);
}
function drawParts() {
  g2.clearRect(0, 0, W, H);
  for (const p of parts) {
    if (p.age < 0) continue;
    const u = p.age / p.life;
    if (p.k === 'smoke') {
      const r = p.r0 + (p.r1 - p.r0) * ease.out(u);
      g2.globalCompositeOperation = 'source-over';
      g2.fillStyle = p.dustc ? `rgba(120,110,100,${.28 * (1 - u)})` : p.light ? `rgba(170,170,176,${(p.a ?? .35) * (1 - u)})` : `rgba(40,38,44,${(p.a ?? .5) * (1 - u)})`;
      g2.beginPath(); g2.arc(p.x, p.y, r, 0, 7); g2.fill();
    } else if (p.k === 'chunk') {
      g2.globalCompositeOperation = 'source-over';
      g2.save(); g2.translate(p.x, p.y); g2.rotate(p.rot);
      g2.globalAlpha = Math.min(1, 3 * (1 - u));
      if (p.brass) { g2.fillStyle = '#d9a441'; g2.fillRect(-p.s / 2, -p.s * .2, p.s, p.s * .4); g2.fillStyle = '#fff0b0'; g2.fillRect(-p.s / 2, -p.s * .2, p.s, .9 * S); }
      else { g2.fillStyle = '#3b4250'; g2.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .7);
             g2.fillStyle = '#ff9a3a'; g2.fillRect(-p.s / 2, -p.s / 2, p.s, 1.2 * S); }
      g2.restore(); g2.globalAlpha = 1;
    }
  }
  g2.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    if (p.age < 0) continue;
    const u = p.age / p.life;
    if (p.k === 'spark') {
      g2.strokeStyle = p.col; g2.globalAlpha = 1 - u; g2.lineWidth = p.w * (1 - u * .5); g2.lineCap = 'round';
      const L = 5;   // 속도 방향으로 꼬리를 그린다
      g2.beginPath(); g2.moveTo(p.x - p.vx * L * 3, p.y - p.vy * L * 3); g2.lineTo(p.x, p.y); g2.stroke();
    } else if (p.k === 'fire') {
      const r = p.r0 + (p.r1 - p.r0) * ease.out(u);
      const gr = g2.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      gr.addColorStop(0, `rgba(255,240,200,${.9 * (1 - u)})`); gr.addColorStop(.4, `rgba(255,140,40,${.7 * (1 - u)})`); gr.addColorStop(1, 'rgba(120,20,0,0)');
      g2.globalAlpha = 1; g2.fillStyle = gr; g2.beginPath(); g2.arc(p.x, p.y, r, 0, 7); g2.fill();
    } else if (p.k === 'ring') {
      const r = p.r0 + (p.r1 - p.r0) * ease.out(u);
      g2.globalAlpha = 1 - u; g2.strokeStyle = p.col; g2.lineWidth = p.w * (1 - u);
      g2.beginPath(); g2.arc(p.x, p.y, r, 0, 7); g2.stroke();
    } else if (p.k === 'glow') {
      const gr = g2.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      gr.addColorStop(0, `rgba(${p.col},${.55 * (1 - u)})`); gr.addColorStop(1, `rgba(${p.col},0)`);
      g2.globalAlpha = 1; g2.fillStyle = gr; g2.beginPath(); g2.arc(p.x, p.y, p.r, 0, 7); g2.fill();
    } else if (p.k === 'in') {
      const q = ease.in(u), R = p.R * (1 - q), x = p.tx + Math.cos(p.a) * R, y = p.ty + Math.sin(p.a) * R;
      g2.globalAlpha = .3 + .7 * q; g2.fillStyle = `rgb(${p.col})`;
      g2.beginPath(); g2.arc(x, y, (1.5 + 2 * q) * S, 0, 7); g2.fill();
    } else if (p.k === 'muzzle') {
      const R = p.r * (1 - u * .4);
      const gr = g2.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      gr.addColorStop(0, `rgba(255,250,220,${1 - u})`); gr.addColorStop(.35, `rgba(255,190,80,${.8 * (1 - u)})`); gr.addColorStop(1, 'rgba(255,120,20,0)');
      g2.globalAlpha = 1; g2.fillStyle = gr; g2.beginPath(); g2.arc(p.x, p.y, R, 0, 7); g2.fill();
      g2.strokeStyle = `rgba(255,245,210,${1 - u})`; g2.lineCap = 'round';
      for (const [a, L] of [[0, 1.9], [.5, 1.1], [-.5, 1.1]]) {
        const ang = (p.dir > 0 ? 0 : Math.PI) + a * p.dir;
        g2.lineWidth = (a ? 1.5 : 2.4) * S; g2.beginPath(); g2.moveTo(p.x, p.y); g2.lineTo(p.x + Math.cos(ang) * R * L, p.y + Math.sin(ang) * R * L); g2.stroke();
      }
    } else if (p.k === 'glint') {                 // 저격 조준 반짝임
      const q = u * u, L = (3 + 11 * q) * S;
      g2.globalAlpha = .4 + .6 * q; g2.strokeStyle = '#fffbe0'; g2.lineWidth = 1.4 * S; g2.lineCap = 'round';
      g2.beginPath(); g2.moveTo(p.x - L, p.y); g2.lineTo(p.x + L, p.y); g2.moveTo(p.x, p.y - L * .6); g2.lineTo(p.x, p.y + L * .6); g2.stroke();
      const gr = g2.createRadialGradient(p.x, p.y, 0, p.x, p.y, L * .7);
      gr.addColorStop(0, 'rgba(255,255,230,.9)'); gr.addColorStop(1, 'rgba(255,255,230,0)'); g2.fillStyle = gr; g2.beginPath(); g2.arc(p.x, p.y, L * .7, 0, 7); g2.fill();
    } else if (p.k === 'laser') {                 // 저격 조준선 — 점점 진해지다가 쏘기 직전 깜빡
      const a = u < .8 ? .25 + .55 * u : (Math.sin(p.age / 12) > 0 ? .95 : .3);
      g2.globalAlpha = a; g2.strokeStyle = '#ff3b3b'; g2.lineWidth = 1.2 * S;
      g2.beginPath(); g2.moveTo(p.x, p.y); g2.lineTo(p.x1, p.y1); g2.stroke();
      g2.fillStyle = '#ff6060'; g2.beginPath(); g2.arc(p.x1, p.y1, 3 * S, 0, 7); g2.fill();
    } else if (p.k === 'charge') {                // 빔 충전
      const R = (2 + 11 * ease.in(u)) * S * (1 + .12 * Math.sin(p.age / 18));
      const gr = g2.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      gr.addColorStop(0, 'rgba(240,255,255,1)'); gr.addColorStop(.45, 'rgba(120,240,255,.85)'); gr.addColorStop(1, 'rgba(60,160,255,0)');
      g2.globalAlpha = 1; g2.fillStyle = gr; g2.beginPath(); g2.arc(p.x, p.y, R, 0, 7); g2.fill();
    } else if (p.k === 'mote') {
      g2.globalAlpha = Math.sin(Math.PI * u); g2.fillStyle = `rgb(${p.col})`;
      g2.fillRect(p.x - 1.5 * S, p.y - 4 * S, 3 * S, 8 * S); g2.fillRect(p.x - 4 * S, p.y - 1.5 * S, 8 * S, 3 * S);
    }
  }
  g2.globalAlpha = 1; g2.globalCompositeOperation = 'source-over';
}

/* ── 탄 — 게임 시간으로 날아가서 히트스톱 동안 함께 멈춘다 ── */
let shots = [];
const muzzleOf = (A, kind) => ({ x: A.cx + A.dir * FW * .27, y: kind === 'shell' || kind === 'missile' ? FLOOR - FH * .74 : chestY() - FH * .1 });
function muzzleFlash(x, y, dir, kind) {
  parts.push({ k: 'muzzle', x, y, dir, r: (kind === 'shell' ? 62 : kind === 'sniper' ? 48 : kind === 'gatling' ? 26 : 34) * S, life: kind === 'shell' ? 170 : kind === 'gatling' ? 80 : 120, age: 0 });
  parts.push({ k: 'glow', x, y, r: (kind === 'shell' ? 120 : 80) * S, life: 110, age: 0, col: '255,200,120' });
  if (kind === 'sniper' || kind === 'gatling' || kind === 'shell') {          // 탄피 — 뒤로 튀어 바닥에 구른다
    const a = -Math.PI / 2 - dir * rnd(.5, 1.1), v = rnd(.25, .45) * S;
    parts.push({ k: 'chunk', brass: true, x: x - dir * 18 * S, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(700, 1000), age: 0,
                 s: (kind === 'shell' ? 9 : 5) * S, rot: rnd(0, 6), vr: rnd(-.03, .03), grav: .0016 * S });
  }
  const n = kind === 'shell' ? 6 : kind === 'gatling' ? 1 : 3;
  for (let i = 0; i < n; i++) parts.push({ k: 'smoke', light: true, a: .4, x: x + dir * rnd(4, 18) * S, y: y + rnd(-6, 6) * S, vx: dir * rnd(.02, .08) * S, vy: -rnd(.01, .04) * S,
                                           r0: rnd(4, 8) * S, r1: rnd(18, kind === 'shell' ? 44 : 26) * S, life: rnd(420, 700), age: 0 });
}
function recoil(F, amt) {
  anim(F, 280, u => { const q = Math.exp(-u / 75); return { x: -F.dir * amt * S * q, r: -F.dir * 2.4 * (amt / 16) * q, sx: 1 - .03 * q * amt / 16, sy: 1 + .03 * q * amt / 16 }; }, 'atk');
}
function brace(F, dur) {           // 겨누기 — 살짝 몸을 낮추고 뒤로 기댄다
  anim(F, dur + 40, u => { const p = ease.out(Math.min(1, u / dur)); return { x: -F.dir * 5 * S * p, sx: 1 + .02 * p, sy: 1 - .035 * p }; }, 'atk');
}
function shotTarget(A, D, miss) {
  return miss ? { x: D.cx + A.dir * W * .5, y: chestY() - rnd(40, 70) * S } : { x: contactX(D, A.dir), y: chestY() + rnd(-16, 16) * S };
}
/* 미리 쏘기 — 행동(turn) 사건보다 leadOf(kind) 먼저 부른다. j 는 탄이 닿는 사건(명중 · 흘려내기) */
function shoot(A, D, kind, j) {
  if (A.dead) return;
  const e = ev[j], miss = e.t === 'hit' && e.miss, hitT = tl[j] + hold, T = SHOT_T[kind], n = T.n || 1, gap = T.gap || 0;
  const mz = muzzleOf(A, kind);
  brace(A, T.aim);
  if (kind === 'sniper') {
    parts.push({ k: 'glint', x: mz.x, y: mz.y, life: T.aim + 30, age: 0 });
    const t = shotTarget(A, D, miss);
    parts.push({ k: 'laser', x: mz.x, y: mz.y, x1: t.x, y1: t.y, life: T.aim, age: 0 });
  }
  if (kind === 'beam') {
    parts.push({ k: 'charge', x: mz.x, y: mz.y, life: T.aim + 40, age: 0 });
    for (let i = 0; i < 16; i++) parts.push({ k: 'in', tx: mz.x, ty: mz.y, a: rnd(0, 7), R: rnd(30, 70) * S, life: rnd(160, T.aim), age: rnd(-60, 0), col: '140,245,255' });
    if (FX.sound) sfx.charge(T.aim / 1000);
  }
  for (let k = 0; k < n; k++) after(T.aim + k * gap, () => {
    if (A.dead) return;
    const t = shotTarget(A, D, miss), arrive = hitT - (n - 1 - k) * gap;
    shots.push({ kind, x0: mz.x, y0: mz.y, x1: t.x + (kind === 'gatling' ? rnd(-6, 6) * S : 0), y1: t.y, t0: gt, t1: Math.max(gt + 30, arrive), dir: A.dir, bend: rnd(-1, 1), trail: 0 });
    muzzleFlash(mz.x, mz.y, A.dir, kind);
    recoil(A, RECOIL[kind]);
    if (FX.sound) sfx.shot(kind);
    if (kind === 'shell') { addTrauma(.2); for (let i = 0; i < 6; i++) parts.push({ k: 'smoke', dustc: true, x: A.cx + rnd(-30, 30) * S, y: FLOOR, vx: rnd(-.12, .12) * S, vy: -rnd(.01, .04) * S, r0: 6 * S, r1: 26 * S, life: 600, age: 0 }); }
  });
}
/* 즉시 사격 — 스킬 연타 · 반격처럼 미리 알 수 없는 탄. 탄 궤적이 한 번에 긋고 사라진다 */
function quickShot(A, D, kind, miss) {
  const mz = muzzleOf(A, kind), t = shotTarget(A, D, miss);
  shots.push({ kind: kind === 'beam' ? 'beam' : 'tracer', x0: mz.x, y0: mz.y, x1: t.x, y1: t.y, t0: gt, t1: gt, dir: A.dir, bend: 0, trail: 0 });
  muzzleFlash(mz.x, mz.y, A.dir, kind);
  recoil(A, RECOIL[kind] * .7);
  if (FX.sound) sfx.shot(kind);
}
function shotPos(s, u) {
  if (s.kind === 'shell') { const arc = H * .34; return { x: s.x0 + (s.x1 - s.x0) * u, y: s.y0 + (s.y1 - s.y0) * u - arc * 4 * u * (1 - u) }; }
  if (s.kind === 'missile') {                  // 위로 솟았다가 휘어 내려꽂힌다
    const q = u < 1 ? Math.pow(u, 1.35) : 1, a = 1 - q;
    const p1 = { x: s.x0 + s.dir * 40 * S, y: s.y0 - (120 + 40 * s.bend) * S }, p2 = { x: s.x1 - s.dir * 70 * S, y: s.y1 - (70 + 50 * s.bend) * S };
    return { x: a * a * a * s.x0 + 3 * a * a * q * p1.x + 3 * a * q * q * p2.x + q * q * q * s.x1,
             y: a * a * a * s.y0 + 3 * a * a * q * p1.y + 3 * a * q * q * p2.y + q * q * q * s.y1 };
  }
  return { x: s.x0 + (s.x1 - s.x0) * u, y: s.y0 + (s.y1 - s.y0) * u };
}
function stepShots(dt) {
  for (const s of shots) {
    if ((s.kind === 'shell' || s.kind === 'missile') && gt < s.t1 && dt > 0) {
      s.trail += dt;
      while (s.trail > 14) { s.trail -= 14; const q = shotPos(s, clamp((gt - s.t0) / (s.t1 - s.t0), 0, 1));
        parts.push({ k: 'smoke', light: true, a: s.kind === 'missile' ? .45 : .3, x: q.x, y: q.y, vx: 0, vy: -.01 * S, r0: 3 * S, r1: (s.kind === 'missile' ? 16 : 12) * S, life: rnd(380, 600), age: 0 }); }
    }
  }
  for (const s of shots) if ((s.kind === 'sniper' || s.kind === 'gatling') && gt >= s.t1 && !s.left) {
    s.left = true; shots.push({ kind: 'tracer', x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, t0: gt, t1: gt, dir: s.dir, bend: 0, trail: 0, long: s.kind === 'sniper' });
  }
  shots = shots.filter(s => gt < s.t1 + (s.kind === 'beam' ? 260 : s.kind === 'tracer' ? (s.long ? 300 : 140) : 20));
}
function drawShots() {
  g2.globalCompositeOperation = 'lighter'; g2.lineCap = 'round';
  for (const s of shots) {
    if (s.kind === 'beam') {
      if (gt < s.t1 - 10) continue;
      const v = clamp((gt - s.t1) / 260, 0, 1), w = (18 * (1 - v) + 3) * S * (1 + .15 * Math.sin(gt / 9));
      for (const [col, k] of [['rgba(80,200,255,.35)', 2.4], ['rgba(150,245,255,.85)', 1], ['rgba(255,255,255,.95)', .35]]) {
        g2.strokeStyle = col; g2.lineWidth = w * k; g2.beginPath(); g2.moveTo(s.x0, s.y0); g2.lineTo(s.x1, s.y1); g2.stroke();
      }
      continue;
    }
    if (s.kind === 'tracer') {
      const v = clamp((gt - s.t0) / (s.long ? 300 : 140), 0, 1);
      g2.strokeStyle = `rgba(255,225,150,${.5 * (1 - v)})`; g2.lineWidth = (s.long ? 6 : 4) * S; g2.beginPath(); g2.moveTo(s.x0, s.y0); g2.lineTo(s.x1, s.y1); g2.stroke();
      g2.strokeStyle = `rgba(255,252,235,${1 - v})`; g2.lineWidth = 1.3 * S; g2.beginPath(); g2.moveTo(s.x0, s.y0); g2.lineTo(s.x1, s.y1); g2.stroke();
      continue;
    }
    const u = clamp((gt - s.t0) / Math.max(1, s.t1 - s.t0), 0, 1);
    if (u >= 1) continue;
    const h = shotPos(s, u), tl0 = shotPos(s, Math.max(0, u - (s.kind === 'sniper' ? .45 : s.kind === 'gatling' ? .3 : .08)));
    if (s.kind === 'sniper' || s.kind === 'gatling') {
      g2.strokeStyle = 'rgba(255,215,130,.55)'; g2.lineWidth = (s.kind === 'sniper' ? 8 : 4.5) * S; g2.beginPath(); g2.moveTo(tl0.x, tl0.y); g2.lineTo(h.x, h.y); g2.stroke();
      g2.strokeStyle = '#fffbe8'; g2.lineWidth = (s.kind === 'sniper' ? 2.6 : 1.6) * S; g2.beginPath(); g2.moveTo(tl0.x, tl0.y); g2.lineTo(h.x, h.y); g2.stroke();
    } else {                                   // 포탄 · 미사일 — 빛나는 탄두와 불꽃 꼬리
      const gr = g2.createRadialGradient(h.x, h.y, 0, h.x, h.y, 16 * S);
      gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(.4, 'rgba(255,170,60,.8)'); gr.addColorStop(1, 'rgba(255,90,0,0)');
      g2.fillStyle = gr; g2.beginPath(); g2.arc(h.x, h.y, 16 * S, 0, 7); g2.fill();
      g2.strokeStyle = 'rgba(255,160,60,.7)'; g2.lineWidth = 3 * S; g2.beginPath(); g2.moveTo(tl0.x, tl0.y); g2.lineTo(h.x, h.y); g2.stroke();
    }
  }
  g2.globalCompositeOperation = 'source-over';
}
function miniBlast(x, y) {
  for (let i = 0; i < 6; i++) parts.push({ k: 'fire', x: x + rnd(-14, 14) * S, y: y + rnd(-14, 10) * S, vx: rnd(-.04, .04) * S, vy: -rnd(.02, .06) * S, r0: rnd(6, 12) * S, r1: rnd(22, 38) * S, life: rnd(260, 420), age: 0 });
  for (let i = 0; i < 5; i++) parts.push({ k: 'smoke', x: x + rnd(-18, 18) * S, y: y + rnd(-18, 8) * S, vx: rnd(-.03, .03) * S, vy: -rnd(.03, .06) * S, r0: 8 * S, r1: rnd(30, 50) * S, life: rnd(700, 1000), age: rnd(-120, 0), a: .4 });
}

/* ── 파손 상태 — 체력이 낮을수록 연기 · 불꽃 ── */
function damageFx(F, dt) {
  if (!FX.damage || F.dead || !dt || !playing) return;
  const q = F.hp / F.max;
  if (q >= .5) return;
  F.smk = (F.smk || 0) + dt * (q < .25 ? .02 : .008);
  while (F.smk >= 1) { F.smk -= 1;
    parts.push({ k: 'smoke', a: q < .25 ? .42 : .3, x: F.cx + rnd(-.16, .16) * FW, y: FLOOR - FH * rnd(.45, .8), vx: -F.dir * rnd(.005, .03) * S, vy: -rnd(.04, .09) * S,
                 r0: rnd(4, 8) * S, r1: rnd(22, 40) * S, life: rnd(900, 1400), age: 0 }); }
  if (q < .25) {
    F.spk = (F.spk || 0) + dt * .0022;
    if (F.spk >= 1) { F.spk = 0;
      const x = F.cx + rnd(-.15, .15) * FW, y = FLOOR - FH * rnd(.35, .75);
      for (let i = 0; i < 6; i++) { const a = rnd(-Math.PI, 0), v = rnd(.15, .5) * S;
        parts.push({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(150, 300), age: 0, w: 1.3 * S, col: SPARK_COL[(Math.random() * 4) | 0], drag: .994, grav: .0015 * S }); }
      parts.push({ k: 'glow', x, y, r: 26 * S, life: 110, age: 0, col: '255,170,80' });
      F.flickUntil = performance.now() + 60;
      if (FX.sound) sfx.blip(1800);
    }
  }
}

/* ── 잔상(회피) ── */
let ghosts = [];
function afterimage(F) {
  const im = F.img.cloneNode();
  const r = F.el.getBoundingClientRect(), s = stage.getBoundingClientRect();
  Object.assign(im.style, { position: 'absolute', left: (r.left - s.left) + 'px', top: (r.top - s.top) + 'px', width: r.width + 'px', height: r.height + 'px',
                            opacity: .45, filter: 'brightness(1.6) sepia(1) hue-rotate(170deg) saturate(3)', pointerEvents: 'none' });
  cam.insertBefore(im, canvas);
  ghosts.push({ el: im, t0: gt, life: 260 });
}

/* ── 피해 숫자 ── */
let nums = [];
const numLayer = $('#nums');
let numSlot = 0;
function num(F, text, kind, I = .5, fromDir = 0, cap = '') {
  const el = document.createElement('div');
  el.className = 'num ' + kind;
  el.innerHTML = cap ? `${text}<span class="cap">${cap}</span>` : text;
  numLayer.appendChild(el);
  const juice = FX.numbers;
  const size = !juice ? (kind === 'crit' ? 30 : 22) : kind === 'crit' ? 30 + 20 * I : kind === 'norm' ? 15 + 24 * I : 19;
  el.style.fontSize = (size * S) + 'px';
  numSlot = (numSlot + 1) % 3;
  /* 연달아 뜨면 위로 쌓는다 — 스킬 연타 숫자가 겹쳐 '2194' 처럼 읽히지 않게 */
  F.numStack = juice && gt - (F.numAt ?? -1e9) < 380 ? (F.numStack || 0) + 1 : 0; F.numAt = gt;
  const x = F.cx + (juice ? (numSlot - 1) * 18 * S + rnd(-5, 5) * S : (F.k === 'p' ? -40 : 30) * S), y = headY() - F.numStack * size * 1.05 * S;
  nums.push({ el, t0: gt, juice, x, y, vx: juice ? fromDir * rnd(.03, .07) * S : 0, vy: -.42 * S, crit: kind === 'crit', life: juice ? 950 : 1000 });
}
function stepNums() {
  nums = nums.filter(n => {
    const u = gt - n.t0;
    if (u > n.life) { n.el.remove(); return false; }
    let x = n.x, y = n.y, s = 1, o = 1, r = 0;
    if (!n.juice) {                     // @keyframes rise
      const p = u / n.life;
      if (p < .2) { const q = p / .2; y -= 6 * S * q; s = .6 + .55 * q; o = q; }
      else { const q = (p - .2) / .8; y -= (6 + 40 * q) * S; s = 1.15 - .15 * q; o = 1 - q; }
    } else {
      const t = Math.min(u, 700);
      x += n.vx * t; y += n.vy * t + .0006 * S * t * t;
      s = u < 90 ? 2 - ease.out(u / 90) * 1.15 : 0.85 + .15 * Math.min(1, (u - 90) / 120);
      o = u > n.life - 280 ? (n.life - u) / 280 : 1;
      if (n.crit && u < 260) r = Math.sin(u / 14) * 6 * (1 - u / 260);
    }
    n.el.style.opacity = o;
    n.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) rotate(${r}deg) scale(${s})`;
    return true;
  });
}

/* ── 체력 막대 ── */
const bars = {};
for (const k of ['p', 'e']) bars[k] = { bar: $('#bar-' + k), fill: $('#bar-' + k + ' .fill'), ghost: $('#bar-' + k + ' .ghost'), hurt: $('#bar-' + k + ' .hurt'),
  txt: $('#hpn-' + k), nm: $('#nm-' + k), sp: $('#sp-' + k), pct: 100, gpct: 100, gHold: 0, shown: 0, target: 0, hurtAt: -1e9 };
function setHP(k, hp, instant) {
  const B = bars[k], F = fighters[k], pct = clamp(hp / F.max * 100, 0, 100);
  F.hp = hp;
  B.bar.classList.toggle('css', !FX.ghost && !instant);
  B.bar.classList.toggle('low', pct < 30);
  if (FX.ghost && !instant) {
    if (pct < B.pct) { B.gpct = Math.max(B.gpct, B.pct); B.gHold = gt + 380; B.hurtAt = performance.now(); } else B.gpct = Math.max(B.gpct, pct);
  } else B.gpct = pct;
  B.pct = pct; B.fill.style.width = pct + '%';
  B.target = Math.max(0, Math.round(hp));
  if (!FX.ghost || instant) B.shown = B.target;
}
function setSP(k, sp) { bars[k].sp.style.width = clamp(sp, 0, 100) + '%'; }
function stepBars(dt) {
  const now = performance.now();
  for (const k of ['p', 'e']) {
    const B = bars[k], F = fighters[k];
    if (FX.ghost) {
      if (gt > B.gHold && B.gpct > B.pct) B.gpct = Math.max(B.pct, B.gpct - (B.gpct - B.pct) * (1 - Math.exp(-dt / 140)) - .02 * dt);
      B.ghost.style.width = B.gpct + '%'; B.ghost.style.display = '';
      if (B.shown !== B.target) B.shown += Math.sign(B.target - B.shown) * Math.max(1, Math.round(Math.abs(B.target - B.shown) * Math.min(1, dt / 90)));
      B.hurt.style.opacity = Math.max(0, .7 * (1 - (now - B.hurtAt) / 110));
    } else { B.ghost.style.display = 'none'; B.hurt.style.opacity = 0; B.shown = B.target; }
    B.txt.textContent = B.shown + ' / ' + Math.round(F.max);
  }
}

/* ── 띠 ── */
const bannerEl = $('#banner');
function banner(txt, side) {
  bannerEl.textContent = txt;
  bannerEl.className = 'banner';
  void bannerEl.offsetWidth;
  if (FX.telegraph) { bannerEl.classList.add('juice'); if (side === 'e') bannerEl.classList.add('r'); bannerEl.style.setProperty('--from', side === 'e' ? '60%' : '-60%'); }
  else bannerEl.classList.add('now');
}

/* ── 재생 ── */
let ev = [], tl = [], idx = 0, gt = 0, hold = 0, stopLeft = 0, slowLeft = 0, slowScale = 1, playing = false, timers = [];
let tStart = 0, stats = null;
const after = (ms, fn) => timers.push({ at: gt + ms, fn });
function hitstop(ms) { if (FX.hitstop) stopLeft = Math.max(stopLeft, ms); }
const intensity = (dmg, F) => FX.scale ? clamp(dmg / F.max / 0.16, .25, 1.4) : .6;

function setFighter(k, x) {
  const F = fighters[k];
  F.type = x.type; F.name = x.name; F.max = x.max ?? x.maxhp;
  F.img.src = `../../assets/${x.type}.png?v=20260917-nhar`;
  F.dead = false; F.anims = []; F.wound = false; F.skillHits = false; F.numAt = -1e9; F.numStack = 0; F.smk = 0; F.spk = 0; F.flickUntil = 0;
  bars[k].nm.textContent = F.name;
  bars[k].pct = bars[k].gpct = 100;
}
function reset() {
  const b = buildBattle();
  ev = b.ev; tl = battleTimeline(ev).map(t => t + 400);
  typeAt = []; { const cur = { P: b.init.p.type, E: b.init.e.type }; for (const e of ev) { if (e.t === 'swap') cur[e.side] = e.type; typeAt.push({ ...cur }); } }
  idx = 0; preIdx = 0; pre.clear(); pending = []; shots = []; gt = 0; hold = 0; stopLeft = 0; slowLeft = 0; timers = []; trauma = 0; zooms = []; focus = null;
  parts = []; nums.forEach(n => n.el.remove()); nums = []; ghosts.forEach(g => g.el.remove()); ghosts = [];
  for (const k of ['p', 'e']) { setFighter(k, b.init[k]); setHP(k, b.init[k].max, true); setSP(k, 0); }
  $('#result').className = 'result'; bannerEl.className = 'banner';
  $('#seed').textContent = seed;
  stats = { hit: 0, crit: 0, miss: 0, skill: 0, swap: 0, parry: 0 };
  for (const e of ev) { if (e.t === 'hit') { if (e.miss) stats.miss++; else { stats.hit++; if (e.crit) stats.crit++; } }
    if (e.t === 'skill') stats.skill++; if (e.t === 'swap') stats.swap++; if (e.t === 'parry') stats.parry++; }
  $('#stat').textContent = `명중 ${stats.hit} · 치명 ${stats.crit} · 회피 ${stats.miss} · 스킬 ${stats.skill} · 흘려내기 ${stats.parry} · 교대 ${stats.swap}`;
  layout();
}
function start() {
  sfx.unlock();
  reset();
  playing = true; tStart = performance.now();
  $('#play').hidden = true;
  $('#dur').textContent = '재생 중…';
}

/* 이 turn 다음에 오는 행동 사건의 번호(회복 · 방벽 따위는 건너뛴다). 없으면 -1 */
function nextActionAt(i) {
  for (let j = i + 1; j < ev.length; j++) {
    const t = ev[j].t;
    if (t === 'turn' || t === 'end') return -1;
    if (t === 'hit' || t === 'skill' || t === 'parry') return j;
  }
  return -1;
}

/* 행동을 미리 준비한다 — 근접은 90ms 전에 움츠리고, 원거리는 탄이 날아갈 시간만큼 먼저 쏜다.
   그래서 부딪히는(닿는) 순간이 엔진의 명중 사건과 맞고, 판이 길어지지 않는다 */
let preIdx = 0, pending = [], typeAt = []; const pre = new Set();
function planTurn(i) {
  const e = ev[i];
  if (e.t !== 'turn') return;
  const j = nextActionAt(i); if (j < 0) return;
  const nx = ev[j];
  if (!((nx.t === 'hit' && nx.side === e.side) || (nx.t === 'parry' && nx.dside === e.side))) return;
  const kind = FX.ranged ? SHOT[typeAt[i][e.side]] : null;
  const A = () => FS(e.side), D = () => FS(e.side === 'P' ? 'E' : 'P');
  if (kind) { pre.add(i); pending.push({ at: tl[i] - leadOf(kind), fn: () => shoot(A(), D(), kind, j) }); }
  else if (FX.anticip) pending.push({ at: tl[i] - 90, fn: () => { if (A().dead) return; windup(A()); pre.add(i); if (FX.sound) sfx.windup(); } });
}

function fire(e, i) {
  switch (e.t) {
    case 'turn': {
      const A = FS(e.side); A.skillHits = false; A.wound = false;
      setSP(A.k, e.sp);
      if (pre.has(i)) A.wound = true;          // 예비 동작은 90ms 먼저 시작했다(아래 preTurn)
      break;
    }
    case 'skill': {
      const A = FS(e.side); A.skillHits = true;
      banner(e.name, A.k);
      if (FX.telegraph) {
        /* 시간표에서 스킬 이름 → 첫 타 사이가 이미 TL.step.skill(420ms)이다. 기 모으기를 그 안에 넣어 판을 늘리지 않는다 */
        A.glowUntil = gt + 480;
        converge(A.cx, chestY(), A.k === 'p' ? '123,240,255' : '255,160,90');
        focus = { k: A.k, t0: gt, dur: 700 };
        if (FX.sound) sfx.charge(.4);
        after(380, () => { if (FX.sound) sfx.fire(); parts.push({ k: 'ring', x: A.cx, y: chestY(), r0: 20 * S, r1: 130 * S, life: 300, age: 0, col: A.k === 'p' ? '#7bf0ff' : '#ffa060', w: 5 * S }); addTrauma(.25); });
      } else if (FX.sound) sfx.blip(520);
      break;
    }
    case 'hit': {
      const A = FS(e.side), D = FS(e.dside), gun = FX.ranged ? SHOT[A.type] : null;
      if (!A.wound) { if (gun) quickShot(A, D, gun, e.miss); else if (FX.anticip) jab(A); else lungeNow(A); }
      A.wound = false;
      if (e.miss) {
        num(D, 'MISS', 'miss', .5, A.dir);
        if (FX.knock) dodge(D, A.dir);
        if (FX.sparks && !gun) airStreak(D, A.dir);
        if (FX.sound) sfx.miss();
        break;
      }
      const I = intensity(e.dmg, D) * (e.crit ? 1.15 : 1);
      const ko = e.thp <= 0;
      const stopMs = 25 + 55 * I + (e.crit ? 40 : 0);
      hitstop(stopMs);
      if (FX.sound) e.crit ? sfx.crit(I) : sfx.hit(I);
      if (FX.flashSprite) D.flashUntil = performance.now() + (FX.hitstop ? stopMs / speed : 0) + 60;
      else flashScreen(.18);
      if (FX.knock) knock(D, A.dir, I); else shakeNow(D);
      if (FX.sparks) sparks(contactX(D, A.dir), chestY() + rnd(-20, 20) * S, A.dir, I, e.crit);
      if (FX.sparks && (gun === 'shell' || gun === 'missile')) miniBlast(contactX(D, A.dir), chestY());
      addTrauma(.08 + .34 * I + (e.crit ? .2 : 0));
      if (e.crit && FX.shake) punch(.045, 200);
      if (FX.numbers) num(D, e.dmg, e.crit ? 'crit' : 'norm', I, A.dir, e.crit ? 'CRITICAL' : '');
      else num(D, (e.crit ? 'CRIT ' : '') + e.dmg, e.crit ? 'crit' : 'norm');
      if (e.absorb) num(D, '방벽 −' + e.absorb, 'info', .4, A.dir);
      setHP(D.k, e.thp);
      if (ko) knockout(D, A);
      break;
    }
    case 'parry': {
      const P = FS(e.side), A = FS(e.dside), gun = FX.ranged ? SHOT[A.type] : null;
      if (!A.wound) { if (gun) quickShot(A, P, gun, false); else if (FX.anticip) jab(A); else lungeNow(A); }
      A.wound = false;
      num(P, 'PARRY', 'parry', .7, A.dir);
      hitstop(90);
      if (FX.sound) sfx.parry();
      if (gun) { if (FX.knock) knock(P, A.dir, .35); }          // 멀리서 쏜 탄을 쳐냈다 — 쏜 쪽은 튕기지 않는다
      else if (FX.knock) { knock(A, P.dir, 1.2); knock(P, A.dir, .25); } else shakeNow(A);
      if (FX.sparks) sparks(contactX(P, A.dir), chestY(), P.dir, .9, false, ['#ffffff', '#cfe8ff', '#7bf0ff', '#ffe9a0']);
      if (FX.flashSprite) A.flashUntil = performance.now() + 150;
      addTrauma(.3);
      break;
    }
    case 'heal': {
      const F = FS(e.side);
      setHP(F.k, e.hp);
      num(F, '+' + e.amt, 'heal', .4);
      if (FX.sparks) healMotes(F);
      if (FX.sound) sfx.heal();
      break;
    }
    case 'shield': { const F = FS(e.side); num(F, '방벽 ' + e.amt, 'heal', .4); if (FX.sound && !sfx.file('shield', { gain: .9, max: 1 })) sfx.blip(880); break; }
    case 'mark': { const D = FS(e.dside); num(D, '표적', 'info', .4); if (FX.sound) sfx.blip(440); break; }
    case 'jam': { const D = FS(e.dside); setSP(D.k, e.sp); num(D, 'JAM', 'miss', .4); if (FX.sound) sfx.blip(300); break; }
    case 'swap': swapIn(e); break;
    case 'end': finish(e.winner); break;
  }
}

function knockout(D, A) {
  if (!FX.ko) return;                       // 지금 게임은 격파 연출이 따로 없다
  stopLeft = Math.max(stopLeft, FX.hitstop ? 240 : 0);
  slowLeft = 650; slowScale = .35;
  hold += 500;
  const x = D.cx, y = chestY();
  after(1, () => { explosion(x, y); flashScreen(.3); trauma = FX.shake ? 1 : 0; punch(.06, 500); if (FX.sound) sfx.boom(); });
  D.flashUntil = performance.now() + 260;
  D.dead = true; D.deadAt = gt;
  anim(D, 1e9, u => { const p = ease.out(Math.min(1, u / 700)); return { r: A.dir * 13 * p, y: 16 * S * p, x: A.dir * 26 * S * p }; });
}

function swapIn(e) {
  const k = e.side === 'P' ? 'p' : 'e', F = fighters[k];
  if (!FX.ko) {                             // 지금 게임 — 그림을 바꾸고 '교대!'
    setFighter(k, e); setHP(k, e.hp, true); setSP(k, 0);
    banner('교대!', k);
    if (FX.sound) sfx.blip(700);
    return;
  }
  hold += 600;
  F.el.style.opacity = 0;
  after(160, () => {
    setFighter(k, e); setHP(k, e.hp, true); setSP(k, 0);
    F.el.style.opacity = 1;
    if (FX.sound) sfx.drop();
    const drop = H * 1.1;
    anim(F, 300, u => ({ y: -drop * (1 - ease.in(u / 300)), sx: .94, sy: 1.08 }));
    after(300, () => {
      anim(F, 420, u => { const q = Math.exp(-u / 90) * Math.cos(u / 55); return { sx: 1 + .16 * q, sy: 1 - .16 * q }; });
      dust(F.cx, FLOOR);
      trauma = Math.min(1, trauma + (FX.shake ? .55 : 0));
      if (FX.sound) sfx.land();
      hitstop(70);
      banner('교대 — ' + e.name, k);
    });
  });
}

function finish(winner) {
  const win = winner === 'P';
  after(FX.ko ? 500 : 300, () => {
    const r = $('#result');
    r.textContent = win ? '승리' : '패배';
    r.style.color = win ? '#ffcf5a' : '#ff6a6a';
    r.className = 'result on';
    if (FX.sound) win ? sfx.win() : sfx.lose();
    const sec = (performance.now() - tStart) / 1000;
    $('#dur').innerHTML = `재생 시간 <b>${sec.toFixed(1)}초</b>${speed > 1 ? ` (x${speed})` : ''}`;
    after(900, () => { playing = false; const p = $('#play'); p.hidden = false; p.querySelector('b').textContent = '▶ 같은 판 다시'; });
  });
}

/* ── 프레임 ── */
const dangerEl = $('#danger');
let last = performance.now();
function frame(now) {
  const dtReal = Math.min(50, now - last); last = now;
  let dt = window.__frozen ? 0 : dtReal * speed;          // __frozen — 점검용 일시정지(콘솔)
  if (stopLeft > 0) { stopLeft -= dtReal * speed; dt = 0; }
  else if (slowLeft > 0) { slowLeft -= dtReal; dt *= slowScale; }
  gt += dt;

  if (playing) {
    /* 미리 준비 — 가장 긴 준비(LEAD_MAX)만큼 앞을 내다보고, 각자 시각이 되면 움직인다(planTurn) */
    while (preIdx < ev.length && gt - hold >= tl[preIdx] - LEAD_MAX) { planTurn(preIdx); preIdx++; }
    pending = pending.filter(q => { if (gt - hold >= q.at) { q.fn(); return false; } return true; });
    while (idx < ev.length && gt - hold >= tl[idx]) fire(ev[idx], idx++);
    timers = timers.filter(t => { if (gt >= t.at) { t.fn(); return false; } return true; });
  }

  /* 기체 */
  for (const F of Object.values(fighters)) {
    let x = 0, y = 0, sx = 1, sy = 1, r = 0;
    F.anims = F.anims.filter(a => {
      const u = gt - a.t0; if (u > a.dur) return false;
      const o = a.fn(u); x += o.x || 0; y += o.y || 0; sx *= o.sx || 1; sy *= o.sy || 1; r += o.r || 0; return true;
    });
    if (FX.idle && !F.dead) {               // 대기 모션 — 발끝을 축으로 숨 쉬듯 늘었다 줄고, 느리게 몸을 흔든다
      const ph = F.k === 'p' ? 0 : 2.1, b = Math.sin(gt / 380 + ph);
      sy *= 1 + b * .04; sx *= 1 - b * .018; y += b * 2.5 * S; r += Math.sin(gt / 1100 + ph) * 1.6 * F.dir; x += Math.sin(gt / 1100 + ph) * 3 * S * F.dir;
    }
    damageFx(F, dt);
    F.el.style.transform = `translate(${x}px,${y}px) rotate(${r}deg) scale(${sx},${sy})`;
    const fl = now < F.flashUntil, glow = gt < F.glowUntil;
    F.img.style.filter = fl ? 'brightness(0) invert(1)'
      : now < F.flickUntil ? 'brightness(1.6) saturate(1.3)'
      : F.dead ? `brightness(${FX.ko ? .35 : 1}) saturate(${FX.ko ? .3 : 1})`
      : glow ? `drop-shadow(0 0 ${10 + 8 * Math.sin(gt / 40)}px ${F.k === 'p' ? '#7bf0ff' : '#ffa060'}) brightness(1.15)`
      : '';
  }
  ghosts = ghosts.filter(gh => { const u = (gt - gh.t0) / gh.life; if (u >= 1) { gh.el.remove(); return false; } gh.el.style.opacity = .45 * (1 - u); return true; });

  /* 카메라 */
  trauma = Math.max(0, trauma - dtReal * .0017);
  const sh = trauma * trauma * shakeAmt, T = now / 1000;
  const ox = sh * 20 * S * (Math.sin(T * 61) * .6 + Math.sin(T * 97 + 1.3) * .4);
  const oy = sh * 14 * S * (Math.sin(T * 73 + 2.1) * .6 + Math.sin(T * 113 + .4) * .4);
  const rot = sh * 1.3 * Math.sin(T * 53 + .7);
  let z = 1;
  zooms = zooms.filter(q => { const u = (gt - q.t0) / q.dur; if (u >= 1) return false; z += q.z * (1 - ease.out(u)); return true; });
  let tx = 0;
  if (focus) {
    const u = (gt - focus.t0) / focus.dur;
    if (u >= 1) focus = null;
    else { const w = u < .55 ? ease.out(u / .55) : 1 - ease.inOut((u - .55) / .45); z += .06 * w; tx = -(fighters[focus.k].cx - W / 2) * .06 * w; }
  }
  cam.style.transform = `translate(${ox + tx}px,${oy}px) rotate(${rot}deg) scale(${z})`;

  const fu = (now - flashT0) / 340;
  $('#flash').style.opacity = fu < 1 && !reduced ? flashPeak * (1 - fu) : 0;

  /* 내 기체가 위험하면 화면 가장자리가 심장 박동처럼 붉게 뛴다(두 번 뛰고 쉰다) */
  const me = fighters.p, mq = me.hp / me.max;
  let dop = 0;
  if (FX.damage && playing && !me.dead && mq < .3) {
    const t = (now % 1100) / 1100, beat = Math.max(0, 1 - Math.abs(t - .08) / .08) + .7 * Math.max(0, 1 - Math.abs(t - .3) / .08);
    dop = (.35 + .65 * beat) * (reduced ? .4 : .8);
  }
  dangerEl.style.opacity = dop;

  stepParts(dt); stepShots(dt); drawParts(); drawShots(); stepNums(); stepBars(dtReal);
}
/* 보통은 화면 주사율로 돈다. 창이 가려져 requestAnimationFrame 이 멈추면(앱 안 미리보기 창 등) 타이머가 대신 돈다 */
let lastRaf = 0;
const loop = t => { lastRaf = performance.now(); frame(t); requestAnimationFrame(loop); };
setInterval(() => { if (performance.now() - lastRaf > 120) frame(performance.now()); }, 16);

/* ── 조작판 ── */
const tgHost = $('#toggles');
for (const [k, label, desc, isNew] of TOGGLES) {
  const id = 'tg-' + k;
  tgHost.insertAdjacentHTML('beforeend', `<div class="tgrow"><label class="tg" for="${id}"><input type="checkbox" id="${id}" checked><span><b>${label}${isNew ? '<em class="new">새로</em>' : ''}</b><small>${desc}</small></span></label><button class="solo" id="solo-${k}" title="이 연출만 켜고 다시 재생">이것만</button></div>`);
  $('#solo-' + k).onclick = () => { setAll(false); FX[k] = true; $('#' + id).checked = true; syncMode(); start(); };
  $('#' + id).addEventListener('change', ev2 => { FX[k] = ev2.target.checked; syncMode(); });
}
function setAll(on) { for (const [k] of TOGGLES) { FX[k] = on; $('#tg-' + k).checked = on; } syncMode(); }
function syncMode() {
  const n = TOGGLES.filter(([k]) => FX[k]).length, tag = $('#modeTag');
  tag.textContent = n === 0 ? '지금 게임' : n === TOGGLES.length ? '전부 켬' : `${n}개 켬`;
  tag.classList.toggle('all', n > 0);
  $('#pre-now').classList.toggle('on', n === 0);
  $('#pre-all').classList.toggle('on', n === TOGGLES.length);
}
$('#pre-now').onclick = () => { setAll(false); start(); };
$('#pre-all').onclick = () => { setAll(true); start(); };
$('#replay').onclick = start;
$('#fresh').onclick = () => { seed = (Math.random() * 1e9) >>> 0; start(); };
$('#play').onclick = start;
const bindRange = (id, out, fn) => { const el = $('#' + id); const f = () => { $('#' + out).textContent = fn(+el.value); }; el.addEventListener('input', f); f(); };
$('#shakeAmt').value = Math.round(shakeAmt * 100);
bindRange('shakeAmt', 'shakeOut', v => { shakeAmt = v / 100; return v + '%'; });
$('#sfxsrc').onchange = e2 => { sfx.useFiles = e2.target.value === 'files'; };
bindRange('vol', 'volOut', v => { sfx.setVol(v / 100); return v + '%'; });
bindRange('speed', 'speedOut', v => { speed = [1, 2, 4][v - 1]; return 'x' + speed; });
for (const s of ['p1', 'p2', 'e1', 'e2']) {
  const sel = $('#' + s);
  sel.innerHTML = ROBOTS.map(r => `<option value="${r.id}">${r.name} · ${r.rarity}${SHOT[r.id] ? ' · 원거리(' + SHOT_KO[SHOT[r.id]] + ')' : ''}</option>`).join('');
  sel.value = pick[s];
  sel.onchange = () => { pick[s] = sel.value; reset(); };
}
$('#relay').onchange = e2 => { pick.relay = e2.target.checked; $('#p2').disabled = $('#e2').disabled = !pick.relay; reset(); };
addEventListener('keydown', e2 => {
  if (e2.target.closest && e2.target.closest('select,input[type=range]')) return;
  if (e2.code === 'Space') { e2.preventDefault(); start(); }
  else if (e2.key === 'a' || e2.key === 'A') { setAll(false); start(); }
  else if (e2.key === 'b' || e2.key === 'B') { setAll(true); start(); }
  else if (e2.key === 'n' || e2.key === 'N') { seed = (Math.random() * 1e9) >>> 0; start(); }
});
addEventListener('resize', layout);

/* 점검용 — 콘솔에서 __juice() */
window.__juice = () => ({ gt: Math.round(gt), hold, idx, of: ev.length, parts: parts.length, nums: nums.length, trauma: +trauma.toFixed(2), stopLeft: Math.round(stopLeft),
  slowLeft: Math.round(slowLeft), playing, shots: shots.map(x => x.kind), pending: pending.length, fx: { ...FX }, tf: { p: fighters.p.el.style.transform, e: fighters.e.el.style.transform }, cam: cam.style.transform });

/* ?only=ranged 처럼 열면 그 연출 하나만 켠 채로 시작한다 */
{ const only = new URLSearchParams(location.search).get('only');
  if (only && only in FX) { setAll(false); FX[only] = true; $('#tg-' + only).checked = true; } }
syncMode();
reset();
requestAnimationFrame(loop);
