/* 조각 합성 — 순수 규칙. (2026-09-25 사용자 결정 · 할 일 20번)
 *
 * 같은 등급 기체 조각 6 ~ 10 개(기체는 섞여도 된다) + 스크랩 → 조각.
 *   결과 등급 — 매우 낮은 확률로 '명작'(두 등급 위) · 아니면 성공(한 등급 위) 또는 동급.
 *               성공률은 6 개에서 base, 7 개부터 하나 늘 때마다 step 씩 오른다.
 *   결과 기체 — **개발 목표 우선**(2026-09-25 사용자 결정): 결과 등급이 개발 목표 기체의 등급과 같으면 그 기체 조각,
 *               아니면 그 등급에서 무작위(가진 기체도 나온다 — 조립하면 자원으로 바뀐다).
 *   결과 수량 — 넣은 수에 비례. 동급 ½ · 한 등급 위 ⅓ · 명작 ⅕ (반올림 · 최소 1).
 * 에픽 조각은 넣을 수 없다(더 오를 등급이 없다). 유니크의 명작은 에픽에서 멈춘다.
 * 값은 CONST.SHARD_SYNTH. 재화를 깎고 보관함을 고치는 것은 부르는 쪽(server/shop.js)의 일이다.
 *
 * 브라우저와 Worker 가 같이 import 한다. DOM 을 참조하지 않는다.
 */
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { shardKey } from './shop.js';

export const RARS = ['C', 'UC', 'R', 'UQ', 'EP'];
export const SYN = () => CONST.SHARD_SYNTH;

/* 등급별 뽑을 수 있는 기체 — 스토리 · 몬스터 제외 */
const POOL = (() => {
  const m = {};
  for (const k of Object.keys(ROBOT_TYPES).sort()) {
    const T = ROBOT_TYPES[k];
    if (T.story || T.monster) continue;
    (m[T.rarity] = m[T.rarity] || []).push(k);
  }
  return m;
})();

/* 넣은 수 n · 재료 등급 → 확률 { up, master, same } */
export function synthRates(n, rar) {
  const S = SYN(), top = RARS.indexOf(rar) >= RARS.length - 1;
  if (top) return { up: 0, master: 0, same: 1 };
  const master = S.master;
  const up = Math.min(1 - master, S.base + Math.max(0, n - S.min) * S.step);
  return { up, master, same: Math.max(0, 1 - up - master) };
}

/* 재료가 규칙에 맞나 — 맞으면 { rar, n, cost }, 아니면 { error } (문장은 화면에 그대로 쓸 수 있다).
   mats = { 기체 id: 개수 } · items = 보관함 */
export function synthCheck(mats, items) {
  const S = SYN();
  if (!mats || typeof mats !== 'object' || Array.isArray(mats)) return { error: '재료를 골라야 합니다' };
  const list = Object.entries(mats).map(([t, c]) => [t, Math.round(Number(c))]).filter(([, c]) => c !== 0);
  if (!list.length) return { error: '재료를 골라야 합니다' };
  let rar = null, n = 0;
  for (const [t, c] of list) {
    const T = ROBOT_TYPES[t];
    if (!T || T.story || T.monster) return { error: '알 수 없는 조각입니다' };
    if (!Number.isInteger(c) || c < 1) return { error: '개수가 이상합니다' };
    if (rar && T.rarity !== rar) return { error: '같은 등급 조각끼리만 합성합니다' };
    rar = T.rarity;
    if (((items || {})[shardKey(t)] | 0) < c) return { error: `${T.name} 조각이 모자랍니다` };
    n += c;
  }
  if (rar === RARS[RARS.length - 1]) return { error: '에픽 조각은 합성할 수 없습니다' };
  if (n < S.min) return { error: `조각은 ${S.min}개부터 넣습니다` };
  if (n > S.max) return { error: `조각은 ${S.max}개까지 넣습니다` };
  return { rar, n, cost: S.scrap[rar] | 0, rates: synthRates(n, rar) };
}

/* 한 번 굴린다 — { grade: 'same' | 'up' | 'master', rarity, type, qty, goal } · goal 은 개발 목표 기체 id(없으면 무작위만) */
export function rollSynth(rar, n, rnd, goal) {
  const S = SYN(), r = synthRates(n, rar), x = rnd();
  const grade = x < r.master ? 'master' : x < r.master + r.up ? 'up' : 'same';
  const step = grade === 'master' ? 2 : grade === 'up' ? 1 : 0;
  const rarity = RARS[Math.min(RARS.length - 1, RARS.indexOf(rar) + step)];
  const pool = POOL[rarity];
  const pick = pool[Math.floor(rnd() * pool.length)];         // 난수는 늘 같은 수만큼 뽑는다
  const hit = !!goal && ROBOT_TYPES[goal] && ROBOT_TYPES[goal].rarity === rarity;
  const qty = Math.max(1, Math.round(n * S.qty[grade]));
  return { grade, rarity, type: hit ? goal : pick, qty, goal: hit };
}

/* 보관함에서 재료를 빼고 결과를 넣은 새 보관함 — 받은 것을 고치지 않는다 */
export function applySynth(items, mats, out) {
  const next = { ...(items || {}) };
  for (const [t, c] of Object.entries(mats)) {
    const k = shardKey(t), v = (next[k] | 0) - Math.round(Number(c));
    if (v > 0) next[k] = v; else delete next[k];
  }
  next[shardKey(out.type)] = (next[shardKey(out.type)] | 0) + out.qty;
  return next;
}
