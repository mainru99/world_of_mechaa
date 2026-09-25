/* 코어 서킷 규칙 — 별자리 만들기 · 찍기 판정 · 효과 합산. DOM 없음(서버 · 도구 · 화면이 같이 쓴다).
 * 값과 갈래 종류는 data/circuit.js. 2026-09-23 Claude 시안 — 전투에는 아직 안 붙어 있다.
 *
 * 별 id — 갈래 글자 + 순번: 'A1' ~ 'A8', 전문 별은 'A*'.
 * 찍기 규칙 — 갈래 안에서 **안쪽부터** 이어서 찍는다(A3 은 A2 가 있어야). 전문 별은 잠겨 있다.
 */
import { ROBOT_TYPES, CONST } from '../data/balance.js';
import { CIRCUIT, CIRCUIT_THEMES, CIRCUIT_PICK, CIRCUIT_FIT } from '../data/circuit.js';

const BR = 'ABCD'.slice(0, CIRCUIT.branches);
const LV = 60;
const raw = (T, k) => T.base[k] + (T.grow[k] || 0) * (LV - 1) + (T.curve ? (T.curve[k] || 0) * (LV - 1) : 0);

/* 등급 평균 — 갈래를 고를 때 '그 등급 안에서 무엇이 두드러지나' 를 본다 */
let MEAN = null;
function means() {
  if (MEAN) return MEAN;
  MEAN = {};
  const by = {};
  for (const T of Object.values(ROBOT_TYPES)) if (!T.story && !T.monster) (by[T.rarity] = by[T.rarity] || []).push(T);
  for (const r in by) {
    const L = by[r], m = {};
    for (const k of ['hp', 'atk', 'def', 'spd']) m[k] = L.reduce((s, T) => s + raw(T, k), 0) / L.length;
    m.crit = L.reduce((s, T) => s + T.base.crit, 0) / L.length;
    m.eva = L.reduce((s, T) => s + T.base.eva, 0) / L.length;
    m.sk = L.reduce((s, T) => s + skillWeight(T), 0) / L.length;
    MEAN[r] = m;
  }
  return MEAN;
}
function skillWeight(T) { const f = (T.skill && T.skill.fx) || {}; return (f.mult || 1) * (f.hits || 1); }

/* 갈래 점수 — 그 기체에게 어울릴수록 높다. 값은 '얼마나 그 기체다운가' 의 순서만 쓰인다 */
function scores(T) {
  const M = means()[T.rarity] || means().C, f = (T.skill && T.skill.fx) || {};
  const h = raw(T, 'hp') / M.hp - 1, a = raw(T, 'atk') / M.atk - 1, d = raw(T, 'def') / M.def - 1, s = raw(T, 'spd') / M.spd - 1;
  const c = (T.base.crit - M.crit) * 6, e = (T.base.eva - M.eva) * 6, k = skillWeight(T) / M.sk - 1;
  const special = f.shred || f.mark || f.jam || f.execute ? .2 : 0;
  return {
    armor:     2 * h + d - s + (f.shield || f.repair ? .3 : 0),
    fortress:  2 * d + h - s + (f.shield ? .3 : 0),
    absorb:    2 * d - e,
    overdrive: 2 * a - d,
    heavy:     2 * a + h - s,
    light:     2 * s - h + e / 2,
    accel:     2 * s - h + ((f.hits || 1) >= 3 ? .3 : 0),
    aim:       c + a / 2 - (f.alwaysCrit ? .4 : 0),
    target:    c + a - d / 2 + (f.mark ? .4 : 0),
    evade:     e + s / 2,
    regen:     e + (f.drain || f.repair ? .4 : 0) - .2,
    amp:       k + special + (f.execute ? .2 : 0),
    cool:      k + special - h,
    pierce:    (f.ignoreDef ? .6 + f.ignoreDef : 0) + a - c / 2,
  };
}

/* 비슷한 갈래는 한 묶음 — 한 기체에 같은 묶음은 하나만 들어간다(속도 갈래 둘이 같이 붙지 않게) */
const FAMILY = { armor:'tough', fortress:'tough', absorb:'tough', overdrive:'power', heavy:'power', light:'speed', accel:'speed',
                 aim:'crit', target:'crit', evade:'evade', regen:'evade', amp:'skill', cool:'skill', pierce:'pierce' };

/* 점수는 크기가 갈래마다 달라서 그대로 비교하면 한 갈래가 독식한다(실측: 관통탄 41기 · 조준 보정 1기).
   그래서 '뽑기 기체 전체 중 몇 등인가'(백분위)로 바꿔 고른다 */
let PCT = null;
function percentiles() {
  if (PCT) return PCT;
  const ids = Object.keys(ROBOT_TYPES).filter(i => !ROBOT_TYPES[i].story && !ROBOT_TYPES[i].monster);
  const sc = Object.fromEntries(ids.map(i => [i, scores(ROBOT_TYPES[i])]));
  PCT = Object.fromEntries(ids.map(i => [i, {}]));
  for (const th of Object.keys(CIRCUIT_THEMES)) {
    const order = ids.slice().sort((x, y) => sc[x][th] - sc[y][th] || (x < y ? -1 : 1));
    order.forEach((i, n) => { PCT[i][th] = n / (order.length - 1); });
  }
  return PCT;
}

/* 그 기체의 네 갈래 — 백분위 순, 묶음이 겹치지 않게. 순서가 A B C D(A 가 가장 그 기체답다).
   CIRCUIT_FIT 에 그 기체의 실측이 있으면 **안 맞는 갈래는 고르지 않는다** — 값어치 배수가 FIT_BAND 밖이면
   가격을 아무리 맞춰도 숫자가 이상해진다(배수 3 이면 '공격 +0.6%' 가 '+1.8%' 로 보인다) */
export const FIT_BAND = [0.5, 2.0];
export function themesOf(type) {
  if (CIRCUIT_PICK[type]) return CIRCUIT_PICK[type].slice(0, BR.length);
  const T = ROBOT_TYPES[type]; if (!T) return [];
  const pc = percentiles()[type] || scores(T), fit = CIRCUIT_FIT[type];
  const fits = id => !fit || fit[id] == null || (fit[id] >= FIT_BAND[0] && fit[id] <= FIT_BAND[1]);
  const picked = [], fams = new Set();
  const order = Object.keys(pc).sort((x, y) => pc[y] - pc[x] || (x < y ? -1 : 1));
  for (const pass of [true, false]) {          // 맞는 갈래로 네 개가 안 차면 묶음 제한만 지키고 채운다
    for (const id of order) {
      if (picked.length === BR.length) break;
      if (picked.includes(id) || fams.has(FAMILY[id]) || (pass && !fits(id))) continue;
      picked.push(id); fams.add(FAMILY[id]);
    }
  }
  return picked;
}

/* 갈래 하나(8칸)의 효과 합 — 배수를 걸기 전. 도구가 값어치를 잴 때 쓴다 */
export function branchFx(theme) {
  const sum = {};
  for (const kind of CIRCUIT.pattern) { const f = starFx(theme, kind, 1); for (const k in f) sum[k] = (sum[k] || 0) + f[k]; }
  return sum;
}

/* 별 하나의 효과 { 효과: 값 }. g 는 그 기체 · 갈래의 값어치 배수(CIRCUIT_FIT) */
function starFx(theme, kind, g) {
  const th = CIRCUIT_THEMES[theme], K = CIRCUIT.kinds[kind], U = CIRCUIT.unit, sc = CIRCUIT.scale * (g || 1);
  const fx = {};
  const put = (ch, n) => { if (ch && n) fx[ch] = (fx[ch] || 0) + n * U[ch] * sc; };
  put(th.main, K.main);
  if (K.neg) put(CIRCUIT.upOnly.includes(th.neg) ? null : th.neg, -K.neg);
  if (K.side) put(th.side, K.side);
  return fx;
}

/* 별자리 전체 — [{ id, br, i, theme, kind, fx, notable?, locked? }] */
const CACHE = {};
export function constellation(type) {
  if (CACHE[type]) return CACHE[type];
  const T = ROBOT_TYPES[type], th = themesOf(type), fit = CIRCUIT_FIT[type] || {}, out = [];
  th.forEach((theme, b) => {
    CIRCUIT.pattern.forEach((kind, i) => out.push({ id: BR[b] + (i + 1), br: BR[b], i: i + 1, theme, kind, fx: starFx(theme, kind, fit[theme]) }));
    out.push({ id: BR[b] + '*', br: BR[b], i: CIRCUIT.stars + 1, theme, notable: true, locked: true,
               text: CIRCUIT_THEMES[theme].notable.replace('{skill}', (T && T.skill && T.skill.name) || '스킬') });
  });
  return (CACHE[type] = out);
}

/* 찍을 수 있나 — 이유 문자열, 되면 null */
export function blockOf(type, taken, id, points) {
  const set = taken instanceof Set ? taken : new Set(taken || []);
  const star = constellation(type).find(s => s.id === id);
  if (!star) return '없는 별이다';
  if (star.locked) return '전문 별은 아직 잠겨 있다';
  if (set.has(id)) return '이미 찍었다';
  if (star.i > 1 && !set.has(star.br + (star.i - 1))) return `안쪽 ${star.br}${star.i - 1} 부터 찍어야 한다`;
  if (points != null && set.size >= points) return '남은 포인트가 없다';
  return null;
}

/* 찍은 목록이 규칙에 맞나 — 맞으면 null */
export function checkTaken(type, taken, points) {
  const list = [...new Set(taken || [])], set = new Set();
  if (points != null && list.length > points) return '포인트보다 많이 찍었다';
  const order = list.slice().sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
  for (const id of order) { const why = blockOf(type, set, id, null); if (why) return `${id}: ${why}`; set.add(id); }
  return null;
}

/* 찍은 별의 효과 합 { 효과: 값 } */
export function circuitFx(type, taken) {
  const set = taken instanceof Set ? taken : new Set(taken || []), sum = {};
  for (const s of constellation(type)) if (!s.locked && set.has(s.id)) for (const k in s.fx) sum[k] = (sum[k] || 0) + s.fx[k];
  return sum;
}

/* computeStats 결과에 얹는다 — 새 객체를 돌려준다. 상한은 computeStats 와 같다 */
export function applyCircuit(st, fx) {
  const s = { ...st };
  const mul = (k, v) => { s[k] = Math.round(s[k] * (1 + v)); };
  if (fx.hp)    { mul('hp', fx.hp); s.hp = Math.max(1, s.hp); if (s.hpFull != null) s.hpFull = Math.max(1, Math.round(s.hpFull * (1 + fx.hp))); }
  if (fx.atk)   { mul('atk', fx.atk); s.atk = Math.max(1, s.atk); }
  if (fx.def)   { mul('def', fx.def); s.def = Math.max(0, s.def); }
  if (fx.spd)   { mul('spd', fx.spd); s.spd = Math.max(1, s.spd); }
  if (fx.crit)  s.crit = Math.min(.75, Math.max(0, s.crit + fx.crit));
  if (fx.eva)   s.eva = Math.min(.6, Math.max(0, s.eva + fx.eva));
  if (fx.skill) s.skillMul = (s.skillMul || 1) * (1 + fx.skill);
  if (fx.pen)   s.pen = Math.min(1, (s.pen || 0) + fx.pen);
  if (fx.regen) s.regen = (s.regen || 0) + fx.regen;
  if (fx.accel && !(s.stackMax > 0)) { s.stackSpd = fx.accel; s.stackMax = 5; }   // 파츠의 감속 스택이 있으면 그쪽이 이긴다
  return s;
}

/* ── 저장(이관 023 · robot.circuit) ───────────────────────────
   찍은 별 목록을 JSON 배열로 둔다. 읽을 때는 모양만 거른다 — 규칙은 checkTaken 이 본다 */
export function parseCircuit(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = null; } }
  if (!Array.isArray(o)) return [];
  return [...new Set(o.filter(x => typeof x === 'string' && /^[A-D][1-9*]$/.test(x)))];
}
/* 저장할 모양 — 순서를 정해 두면 같은 서킷이 늘 같은 문자열이 된다(낙관적 잠금이 이 문자열을 본다). 비면 NULL */
export const circuitKey = taken => {
  const l = [...new Set(taken || [])].sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
  return l.length ? JSON.stringify(l) : null;
};
/* 서킷을 비우는 값(정제 코어) — 2026-09-25 사용자 지시 '정제 코어 1개'. 추가 비용은 나중에 정한다 */
export const circuitResetCost = () => ((CONST.REFINE || {}).circuitReset ?? 1);
