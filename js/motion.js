/* 공격 모션 — 화면 연출만. 전투 사건 · 피해는 sim.js 그대로다. (2026-10-07 사용자 결정 · docs/art/attack-motion-spec-2026-10-07.md)
 *
 * 기체마다 '공격 종류' 하나(KINDS)가 있고, 종류마다 이펙트 아틀라스 하나를 쓴다(GPT 가 그린다).
 * 아틀라스가 아직 없는 종류는 **코드로 그린 대체 연출**로 돈다 — 그림이 들어오면 manifest(js/motion-assets.js)에 오르고 바로 바뀐다.
 * 공격 자세 그림(assets/motions/attack/<id>.png)이 있는 기체는 때리는 순간 그 그림으로 잠깐 바뀐다(정렬은 manifest 의 dx · dy).
 *
 *   const m = createMotion(arena, { speed: () => battleSpeed, anchor: key => el });
 *   m.skill(key, type)                         다음 타격들은 스킬 타격(더 크게 · 스킬 효과 딱지)
 *   await m.hit({ a, d, type, miss, crit, index, low })   a · d = 칸 열쇠('p' · 'e' · 'P0' …). 맞는 순간에 풀린다
 *   m.status(kind, key, from?)                  'shield' | 'repair' | 'mark' | 'jam' | 'drain' | 'crit' | 'pierce' | 'execute'
 *   m.dispose()
 *
 * 아틀라스 모양 — 정사각 2 × 2. 0 날아가는 것(탄 · 궤적 · 참격 호) · 1 시작(총구 섬광 · 휘두름 번뜩임) · 2 맞는 순간 · 3 흩어짐.
 * 상태 아틀라스 a — 0 방벽 · 1 수리 · 2 표적 · 3 재밍, b — 0 흡혈 · 1 치명 · 2 관통 · 3 처형.
 * 원본 그림은 전부 왼쪽을 본다(js/sprites.js). 그래서 아틀라스도 **왼쪽으로 쏘는 방향**으로 그린다 — 아군(왼쪽에 서서 오른쪽을 친다)은 뒤집는다.
 * 논리 픽셀 1 = 화면 2px(이그니스 레인과 같다). 모션 줄이기 설정이면 흩어짐 한 칸만 그린다.
 */
import { COMBAT_TYPES, isMonster } from './units.js';
import { MOTION_ASSETS } from './motion-assets.js';

/* ── 공격 종류 ─────────────────────────────────────────── */
export const KIND_LIST = ['shot', 'cannon', 'missile', 'beam', 'slash', 'smash', 'thrust'];
export const KIND_KO = { shot: '사격', cannon: '포격', missile: '미사일', beam: '광선', slash: '참격', smash: '타격', thrust: '찌르기' };
const MELEE = new Set(['slash', 'smash', 'thrust']);

/* 기체마다 정해 둔 종류 — 역할 · 스킬 글에서 골랐다. 새 기체는 아래 kindOf 의 낱말 규칙이 고른다 */
export const KINDS = {
  dune: 'shot', ranger: 'shot', tempest: 'shot', specter: 'shot', swift: 'shot', patch: 'shot', vega: 'shot', orbit: 'shot',
  cipher: 'shot', sentry: 'shot', osprey: 'shot', aquila: 'shot', hydra_s: 'shot', hydra_g: 'shot', salvo: 'shot', polaris: 'shot',
  oracle: 'shot', lens: 'shot', scarab: 'shot', ignis: 'shot',
  vanguard: 'cannon', kestrel: 'cannon', cobalt: 'cannon', howitzer: 'cannon', mortar: 'cannon', mantis: 'cannon', quake: 'cannon',
  longbow: 'cannon', verdict: 'cannon', nemesis: 'cannon', tyrant: 'cannon', behemoth: 'cannon',
  bastion: 'missile', tracer: 'missile',
  nimbus_c: 'beam', hex: 'beam', static: 'beam', halo: 'beam', seraph: 'beam', nebula: 'beam', quasar: 'beam',
  azure: 'slash', umbra: 'slash', shrike: 'slash', zephyr: 'slash', vesper: 'slash', ronin: 'slash', solaris: 'slash', monarch: 'slash',
  shogun: 'slash', revenant: 'slash', halberd: 'slash', sovereign: 'slash', wraith: 'slash', lionheart: 'slash',
  mule: 'smash', rust: 'smash', grit: 'smash', chalk: 'smash', glacier: 'smash', atlas: 'smash', auric: 'smash', zealot: 'smash',
  paladin: 'smash', goliath_s: 'smash', goliath_r: 'smash', goliath_c: 'smash', goliath_v: 'smash', nimbus_f: 'smash', gyre: 'smash',
  aegis: 'smash', husk: 'smash', anvil: 'smash', auger: 'smash',
  lancer: 'thrust', pike: 'thrust',
};
const WORDS = [
  ['missile', /미사일|추적탄/], ['beam', /광선|빔|전격|전파|오브|중력/], ['slash', /참격|베기|검|낫|일섬|발도|슬래/],
  ['thrust', /찌르기|창|랜스/], ['smash', /해머|철퇴|주먹|펀치|너클|강타|가격|박치기|발톱|물기|돌진/],
  ['cannon', /포격|폭격|캐논|포/], ['shot', /사격|저격|탄|개틀링|비트/],
];
export function kindOf(type) {
  if (KINDS[type]) return KINDS[type];
  const T = COMBAT_TYPES[type];
  if (!T) return 'shot';
  const text = (T.role || '') + ' ' + ((T.skill && (T.skill.name + ' ' + T.skill.desc)) || '');
  for (const [k, re] of WORDS) if (re.test(text)) return k;
  return isMonster(type) ? 'smash' : 'shot';                     // 몬스터는 몸으로 · 기체는 총으로
}

/* 스킬 효과 → 덧붙일 상태 연출(맞을 때) */
function skillMarks(type) {
  const fx = (COMBAT_TYPES[type] && COMBAT_TYPES[type].skill && COMBAT_TYPES[type].skill.fx) || {};
  return { pierce: !!(fx.ignoreDef || fx.shred), drain: !!fx.drain, execute: !!fx.execute, hits: fx.hits || 1 };
}

/* 종류마다의 시간(ms · 배속 1)과 대체 연출 색 */
const TIME = {
  shot:    { pre: 40,  fly: 90,  hit: 110, fade: 220, color: '#ffe08a', core: '#fff6d8' },
  cannon:  { pre: 90,  fly: 150, hit: 150, fade: 320, color: '#ff9a3c', core: '#ffe2a8' },
  missile: { pre: 60,  fly: 280, hit: 160, fade: 340, color: '#ff7a3c', core: '#ffd28a' },
  beam:    { pre: 120, fly: 60,  hit: 160, fade: 260, color: '#7fe3ff', core: '#e9fbff' },
  slash:   { pre: 70,  fly: 0,   hit: 120, fade: 240, color: '#bfe8ff', core: '#ffffff' },
  smash:   { pre: 90,  fly: 0,   hit: 140, fade: 280, color: '#ffc06a', core: '#fff1d0' },
  thrust:  { pre: 60,  fly: 0,   hit: 110, fade: 220, color: '#c9f0ff', core: '#ffffff' },
};
const STATUS_CELL = { shield: ['a', 0], repair: ['a', 1], mark: ['a', 2], jam: ['a', 3], drain: ['b', 0], crit: ['b', 1], pierce: ['b', 2], execute: ['b', 3] };
const STATUS_COLOR = { shield: '#8fd3ff', repair: '#7dffa8', mark: '#ff5a5a', jam: '#c9a6ff', drain: '#ff4f6d', crit: '#ffe066', pierce: '#ffd7a0', execute: '#ff3b3b' };

/* ── 그림 읽기 ─────────────────────────────────────────── */
const images = new Map();
function load(src) {
  if (!src) return Promise.resolve(null);
  if (!images.has(src)) images.set(src, new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
  return images.get(src);
}
export const atlasSrc = name => (MOTION_ASSETS.atlas || {})[name] || null;
export const poseOf = type => (MOTION_ASSETS.pose || {})[type] || null;

/* ── 재생기 ────────────────────────────────────────────── */
export function createMotion(arena, opts = {}) {
  let disposed = false, canvas, ctx, raf = 0, observer;
  let fx = [];                                   // 그릴 것 { start, life, draw(ctx, age) }
  const skillOf = new Map();                     // 칸 열쇠 → 스킬 타격 남은 수
  const atlas = {};
  const speed = () => Math.max(0.25, Number(opts.speed ? opts.speed() : 1) || 1);
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const live = () => !disposed && !!arena && arena.isConnected !== false;
  const findEl = key => (opts.anchor ? opts.anchor(key) : arena.querySelector('#fighter-' + key));
  for (const n of [...KIND_LIST, 'status-a', 'status-b']) load(atlasSrc(n)).then(img => { if (img && !disposed) atlas[n] = img; });

  function resize() {
    if (!canvas) return;
    const w = Math.max(1, Math.ceil(arena.clientWidth / 2)), h = Math.max(1, Math.ceil(arena.clientHeight / 2));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      canvas.style.width = w * 2 + 'px'; canvas.style.height = h * 2 + 'px';
      ctx.imageSmoothingEnabled = false;
    }
  }
  function ensure() {
    if (!live()) return false;
    if (canvas) return !!ctx;
    canvas = document.createElement('canvas');
    canvas.className = 'motion-fx';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', imageRendering: 'pixelated', zIndex: '5' });
    const flash = arena.querySelector('#flash');
    flash ? arena.insertBefore(canvas, flash) : arena.appendChild(canvas);
    ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return false; }
    resize();
    if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(resize); observer.observe(arena); }
    return true;
  }
  /* 칸의 기준점 — 레이아웃 좌표(흔들림 transform 을 따라가지 않는다). 논리 픽셀 */
  function spot(key) {
    const el = findEl(key);
    if (!el) return { x: canvas.width * (String(key)[0].toLowerCase() === 'p' ? 0.25 : 0.75), y: canvas.height * 0.6, w: 60, h: 60, dir: 1 };
    let x = 0, y = 0, n = el;
    while (n && n !== arena) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    if (n !== arena) { const a = arena.getBoundingClientRect(), b = el.getBoundingClientRect(); x = b.left - a.left; y = b.top - a.top; }
    return { x: (x + el.offsetWidth / 2) / 2, y: (y + el.offsetHeight * 0.55) / 2, w: el.offsetWidth / 2, h: el.offsetHeight / 2 };
  }
  function render(now) {
    raf = 0;
    if (!live()) { dispose(); return; }
    resize(); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const hpBottom = Math.max(0, ...Array.from(arena.querySelectorAll('.hpwrap'), el => el.offsetTop + el.offsetHeight));
    ctx.save(); ctx.beginPath(); ctx.rect(0, Math.ceil((hpBottom + 4) / 2), canvas.width, canvas.height); ctx.clip();
    fx = fx.filter(f => now - f.start < f.life);
    for (const f of fx) { const age = now - f.start; if (age >= 0) { ctx.save(); f.draw(ctx, age, f.life); ctx.restore(); } }
    ctx.restore();
    if (fx.length) raf = requestAnimationFrame(render);
  }
  function add(delay, life, draw) {
    if (!ensure()) return;
    const s = speed();
    fx.push({ start: performance.now() + delay / s, life: life / s, draw: (c, age, L) => draw(c, age * s, L * s) });
    if (!raf) raf = requestAnimationFrame(render);
  }

  /* 아틀라스 한 칸을 찍는다. mirror = 오른쪽을 보게(아군) */
  function stamp(c, img, cell, x, y, size, { mirror = false, alpha = 1, rot = 0 } = {}) {
    if (!img || alpha <= 0) return false;
    const sw = img.naturalWidth / 2, sh = img.naturalHeight / 2;
    c.globalAlpha = Math.max(0, Math.min(1, alpha));
    c.translate(Math.round(x), Math.round(y));
    if (rot) c.rotate(rot);
    if (mirror) c.scale(-1, 1);
    c.drawImage(img, (cell % 2) * sw, Math.floor(cell / 2) * sh, sw, sh, -Math.round(size / 2), -Math.round(size / 2), size, size);
    c.setTransform(1, 0, 0, 1, 0, 0);
    return true;
  }

  /* ── 공격 자세 — 그림이 있는 기체만. 맞는 순간 앞뒤로 잠깐 바꾼다 ── */
  function pose(key, type, hold) {
    const P = poseOf(type), el = findEl(key);
    if (!P || !el || reduced()) return;
    const img = el.querySelector('img');
    if (!img) return;
    load(P.src).then(pi => {
      if (!pi || disposed || !img.isConnected) return;
      const keep = img.getAttribute('src'), keepT = img.style.translate;
      img.setAttribute('src', P.src);
      /* 정렬 — 원본 440 × 420 기준 픽셀을 지금 그려진 크기로 줄인다. 뒤집힌 그림이면 dx 도 뒤집는다 */
      const k = (img.clientWidth || 440) / 440, flip = img.classList.contains('flip') ? -1 : 1;
      img.style.translate = `${(P.dx || 0) * k * flip}px ${(P.dy || 0) * k}px`;
      setTimeout(() => { if (img.isConnected && img.getAttribute('src') === P.src) { img.setAttribute('src', keep); img.style.translate = keepT; } }, hold / speed());
    });
  }

  /* ── 대체 연출(코드로 그림) ── */
  const glow = (c, x, y, r, color, a) => { c.globalAlpha = a; c.fillStyle = color; c.beginPath(); c.arc(x, y, Math.max(1, r), 0, Math.PI * 2); c.fill(); };
  function drawFallback(kind, c, phase, p, A, D, big) {
    const T = TIME[kind], s = (big ? 1.5 : 1) * 1.4, dir = D.x > A.x ? 1 : -1;     // 대체 연출은 아틀라스보다 가늘어 1.4배
    const mx = A.x + dir * A.w * 0.35, my = A.y - A.h * 0.1;
    c.lineCap = 'round';
    if (phase === 'pre') {
      if (MELEE.has(kind)) { glow(c, A.x + dir * A.w * 0.2, A.y - A.h * 0.25, 3 * s * (1 - p), T.core, 0.9 * (1 - p)); return; }
      glow(c, mx, my, (kind === 'beam' ? 4 + 6 * p : 6 * (1 - p)) * s, kind === 'beam' ? T.color : T.core, 0.9);
      return;
    }
    if (phase === 'fly') {
      if (kind === 'beam') {
        c.globalAlpha = 0.9; c.strokeStyle = T.color; c.lineWidth = 5 * s; c.beginPath(); c.moveTo(mx, my); c.lineTo(D.x, D.y); c.stroke();
        c.strokeStyle = T.core; c.lineWidth = 2 * s; c.stroke(); return;
      }
      const lift = kind === 'missile' ? -Math.sin(p * Math.PI) * 38 : kind === 'cannon' ? -Math.sin(p * Math.PI) * 10 : 0;
      const x = mx + (D.x - mx) * p, y = my + (D.y - my) * p + lift;
      if (kind === 'missile') for (let k = 1; k <= 5; k++) { const q = Math.max(0, p - k * 0.05); glow(c, mx + (D.x - mx) * q, my + (D.y - my) * q - Math.sin(q * Math.PI) * 38, 2.5 * s, '#9aa3ad', 0.5 - k * 0.08); }
      c.globalAlpha = 1; c.strokeStyle = T.color; c.lineWidth = (kind === 'cannon' ? 4 : 2) * s;
      c.beginPath(); c.moveTo(x - dir * 10 * s, y); c.lineTo(x, y); c.stroke();
      glow(c, x, y, (kind === 'cannon' ? 3 : 1.6) * s, T.core, 1);
      return;
    }
    if (phase === 'hit') {
      if (kind === 'slash') {
        c.globalAlpha = 1 - p * 0.6; c.strokeStyle = T.core; c.lineWidth = 3 * s;
        c.beginPath(); c.arc(D.x - dir * 6, D.y, 18 * s, -1.9 + p * 0.6, 0.5 + p * 0.6); c.stroke();
        c.strokeStyle = T.color; c.lineWidth = 1.5 * s; c.beginPath(); c.arc(D.x - dir * 6, D.y, 22 * s, -1.7 + p * 0.6, 0.4 + p * 0.6); c.stroke();
        return;
      }
      if (kind === 'thrust') {
        c.globalAlpha = 1 - p; c.strokeStyle = T.core; c.lineWidth = 3 * s;
        c.beginPath(); c.moveTo(D.x - dir * 34 * s, D.y); c.lineTo(D.x + dir * 8 * s * p, D.y); c.stroke(); return;
      }
      const r = (kind === 'smash' || kind === 'cannon' ? 16 : kind === 'missile' ? 18 : 9) * s * (0.4 + p);
      glow(c, D.x, D.y, r * 0.55, T.core, 1 - p);
      c.globalAlpha = 1 - p; c.strokeStyle = T.color; c.lineWidth = 2 * s; c.beginPath(); c.arc(D.x, D.y, r, 0, Math.PI * 2); c.stroke();
      if (kind === 'smash') for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; c.beginPath(); c.moveTo(D.x + Math.cos(a) * r * 0.6, D.y + Math.sin(a) * r * 0.6); c.lineTo(D.x + Math.cos(a) * r * 1.2, D.y + Math.sin(a) * r * 1.2); c.stroke(); }
      return;
    }
    /* fade — 흩어지는 불티 */
    for (let k = 0; k < 6; k++) {
      const a = k * 1.047 + 0.4, d = (8 + 14 * p) * s;
      glow(c, D.x + Math.cos(a) * d, D.y + Math.sin(a) * d + p * 6, 1.4 * s, T.color, (1 - p) * 0.8);
    }
  }
  function drawStatus(kind, c, p, at, from) {
    const col = STATUS_COLOR[kind], [sheet, cell] = STATUS_CELL[kind], img = atlas['status-' + sheet];
    if (kind === 'drain' && from) {                               // 상대 → 나로 흐르는 핏빛 구슬
      for (let k = 0; k < 4; k++) { const q = Math.min(1, Math.max(0, p * 1.4 - k * 0.12)); if (q <= 0 || q >= 1) continue;
        const x = from.x + (at.x - from.x) * q, y = from.y + (at.y - from.y) * q - Math.sin(q * Math.PI) * 14;
        if (!stamp(c, img, cell, x, y, 16, { alpha: 1 - q * 0.3 })) glow(c, x, y, 2.2, col, 1 - q * 0.3); }
      return;
    }
    const size = kind === 'shield' ? at.w * 1.1 : kind === 'execute' ? 54 : 40, a = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8;
    const y = kind === 'repair' ? at.y - p * 14 : at.y;
    if (stamp(c, img, cell, at.x, y, size * (kind === 'crit' ? 0.7 + p * 0.5 : 1), { alpha: a })) return;
    c.globalAlpha = Math.max(0, a); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2;
    if (kind === 'shield') { c.beginPath(); for (let k = 0; k < 7; k++) { const t = k * Math.PI / 3; c[k ? 'lineTo' : 'moveTo'](at.x + Math.cos(t) * size / 2, at.y + Math.sin(t) * size / 2.3); } c.stroke(); }
    else if (kind === 'repair') { for (let k = 0; k < 4; k++) { const x = at.x - 14 + k * 9, yy = y - (k % 2) * 8; c.fillRect(x - 1, yy - 4, 2, 8); c.fillRect(x - 4, yy - 1, 8, 2); } }
    else if (kind === 'mark') { c.beginPath(); c.arc(at.x, at.y, 12, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.moveTo(at.x - 18, at.y); c.lineTo(at.x + 18, at.y); c.moveTo(at.x, at.y - 18); c.lineTo(at.x, at.y + 18); c.stroke(); }
    else if (kind === 'jam') { for (let k = 0; k < 5; k++) c.fillRect(at.x - 18 + ((k * 13 + Math.round(p * 40)) % 36), at.y - 14 + k * 6, 10, 2); }
    else if (kind === 'crit') { const r = 8 + p * 12; c.beginPath(); for (let k = 0; k < 10; k++) { const t = k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; c[k ? 'lineTo' : 'moveTo'](at.x + Math.cos(t) * rr, at.y - 16 + Math.sin(t) * rr); } c.closePath(); c.fill(); }
    else if (kind === 'pierce') { c.beginPath(); c.moveTo(at.x - 10, at.y - 12); c.lineTo(at.x - 2, at.y - 2); c.lineTo(at.x - 8, at.y + 4); c.lineTo(at.x + 4, at.y + 14); c.moveTo(at.x - 2, at.y - 2); c.lineTo(at.x + 10, at.y - 6); c.stroke(); }
    else if (kind === 'execute') { c.lineWidth = 4; c.beginPath(); c.moveTo(at.x - 18, at.y - 18); c.lineTo(at.x + 18, at.y + 18); c.moveTo(at.x + 18, at.y - 18); c.lineTo(at.x - 18, at.y + 18); c.stroke(); }
  }

  /* ── 한 타 ── */
  function hit({ a, d, type, miss = false, crit = false, index = 0, low = false } = {}) {
    if (!ensure()) return Promise.resolve();
    const kind = kindOf(type), T = TIME[kind], s = speed();
    const left = skillOf.get(a) || 0, big = left > 0;
    if (big) skillOf.set(a, left - 1);
    const marks = big ? skillMarks(type) : null;
    const A = spot(a), D0 = spot(d);
    const jitter = big && marks.hits > 1 ? [[0, 0], [-7, -6], [6, 5], [-4, 9], [8, -4], [0, -9]][index % 6] : [0, 0];
    const D = { ...D0, x: D0.x + jitter[0] + (miss ? (D0.x > A.x ? 22 : -22) : 0), y: D0.y + jitter[1] - (miss ? 10 : 0) };
    const mirror = D.x > A.x;                                     // 그림은 왼쪽을 본다 — 오른쪽으로 치면 뒤집는다
    const img = atlas[kind], red = reduced();
    const size = (MELEE.has(kind) ? 56 : 44) * (big ? 1.35 : 1);
    pose(a, type, T.pre + T.fly + T.hit + (big ? 160 : 60));
    if (red) {
      add(T.pre + T.fly, T.fade, (c, age, L) => { const p = age / L; if (!miss && !stamp(c, img, 3, D.x, D.y, size * 0.6, { mirror, alpha: 0.6 * (1 - p) })) drawFallback(kind, c, 'fade', p, A, D, false); });
      return new Promise(r => setTimeout(r, (T.pre + T.fly) / s));
    }
    add(0, T.pre, (c, age, L) => { const p = age / L;
      const at = MELEE.has(kind) ? { x: A.x + (mirror ? 1 : -1) * A.w * 0.2, y: A.y - A.h * 0.25 } : { x: A.x + (mirror ? 1 : -1) * A.w * 0.35, y: A.y - A.h * 0.1 };
      if (!stamp(c, img, 1, at.x, at.y, size * 0.6, { mirror, alpha: 1 - p * 0.5 })) drawFallback(kind, c, 'pre', p, A, D, big); });
    if (T.fly) add(T.pre, T.fly, (c, age, L) => { const p = age / L;
      if (img && kind !== 'beam') {
        const mx = A.x + (mirror ? 1 : -1) * A.w * 0.35, my = A.y - A.h * 0.1;
        const lift = kind === 'missile' ? -Math.sin(p * Math.PI) * 38 : kind === 'cannon' ? -Math.sin(p * Math.PI) * 10 : 0;
        const x = mx + (D.x - mx) * p, y = my + (D.y - my) * p + lift;
        const slope = kind === 'missile' ? Math.atan2((D.y - my) - Math.cos(p * Math.PI) * 38 * Math.PI, D.x - mx) * (mirror ? 1 : -1) * 0.5 : 0;
        stamp(c, img, 0, x, y, size * 0.7, { mirror, rot: slope });
      } else if (img && kind === 'beam') {
        const mx = A.x + (mirror ? 1 : -1) * A.w * 0.35, my = A.y - A.h * 0.1, n = Math.max(2, Math.round(Math.abs(D.x - mx) / (size * 0.45)));
        for (let k = 0; k <= n; k++) stamp(c, img, 0, mx + (D.x - mx) * k / n, my + (D.y - my) * k / n, size * 0.55, { mirror, alpha: 0.95 });
      } else drawFallback(kind, c, 'fly', p, A, D, big); });
    const tHit = T.pre + T.fly;
    if (!miss) {
      add(tHit, T.hit, (c, age, L) => { const p = age / L; if (!stamp(c, img, MELEE.has(kind) ? 0 : 2, D.x, D.y, size * (0.8 + p * 0.4), { mirror, alpha: 1 - p * 0.3 })) drawFallback(kind, c, 'hit', p, A, D, big);
        if (MELEE.has(kind) && img && p > 0.3) stamp(c, img, 2, D.x, D.y, size * 0.7, { mirror, alpha: 1 - p }); });
      add(tHit + T.hit * 0.6, T.fade, (c, age, L) => { const p = age / L; if (!stamp(c, img, 3, D.x, D.y + p * 4, size * (0.9 + p * 0.3), { mirror, alpha: 1 - p })) drawFallback(kind, c, 'fade', p, A, D, big); });
      if (crit) status('crit', d, null, tHit);
      if (marks && marks.pierce) status('pierce', d, null, tHit + 40);
      if (marks && marks.execute && low) status('execute', d, null, tHit + 20);
      if (marks && marks.drain) status('drain', a, d, tHit + 80);
    } else if (!MELEE.has(kind)) {
      add(tHit, T.fly * 0.8 + 60, (c, age, L) => { const p = age / L, dir = mirror ? 1 : -1;
        if (!stamp(c, img, 0, D.x + dir * 40 * p, D.y + 10 * p, size * 0.6, { mirror, alpha: 0.6 * (1 - p) })) drawFallback(kind, c, 'fly', Math.min(1, 1 + p * 0.3), A, { ...D, x: D.x + dir * 40 * p }, false); });
    }
    return new Promise(r => setTimeout(r, tHit / s));
  }

  function status(kind, key, fromKey, delay = 0) {
    if (!STATUS_CELL[kind] || !ensure()) return;
    const at = spot(key), from = fromKey ? spot(fromKey) : null;
    add(delay, kind === 'shield' ? 520 : kind === 'drain' ? 480 : 420, (c, age, L) => drawStatus(kind, c, age / L, at, from));
  }
  function skill(key, type) { skillOf.set(key, skillMarks(type).hits); }
  function dispose() {
    disposed = true; fx = [];
    if (raf) cancelAnimationFrame(raf);
    if (observer) observer.disconnect();
    if (canvas) canvas.remove();
  }
  return { hit, status, skill, dispose, kindOf };
}
