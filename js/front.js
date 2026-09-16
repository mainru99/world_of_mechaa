/* 전선 규칙 — 순수 함수. DOM 도 전역 상태도 참조하지 않는다.
 *
 * 클라이언트와 Worker 가 **같은 파일**을 import 한다. 두 벌로 두면 반드시 어긋나고,
 * 어긋나는 순간 화면이 '열렸다'고 하는 칸을 서버가 거절한다.
 *
 * 여기 있는 것은 **판단**뿐이다 — 어느 칸이 열렸나 · 무엇이 해금됐나 · 방어선이 무엇인가.
 * 행을 읽고 쓰는 일은 server/front.js 가 한다.
 */
import { FRONT_CHAPTERS, FRONT_CELLS, FRONT_GATES } from '../data/front.js';
import { MONSTER_TYPES, SLOTS } from '../data/balance.js';
import { computeStats } from './stats.js';
import { applyTerrain } from './breach.js';
import { rollPart } from './gacha.js';
import { mulberry32 } from './sim.js';

export { FRONT_CHAPTERS, FRONT_CELLS, FRONT_GATES };

/* 진행 문자열 ↔ 배열. 저장은 '00000' 같은 글자 하나씩이다(마이그레이션 016).
   NULL·빈 문자열·길이가 모자란 것은 전부 '아직' 으로 읽는다 — 장이 늘어도
   옛 저장본이 그대로 읽히고, 자리가 밀리지 않는다. */
export function readProgress(s) {
  const out = new Array(FRONT_CELLS.length).fill(0);
  const t = typeof s === 'string' ? s : '';
  for (let i = 0; i < out.length && i < t.length; i++) {
    const v = t.charCodeAt(i) - 48;
    out[i] = v > 0 && v < 10 ? v : 0;
  }
  return out;
}
export const writeProgress = a => a.map(v => String(Math.max(0, Math.min(9, v | 0)))).join('');
export const clearedCount = a => a.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);

export const cellIndex = id => FRONT_CELLS.findIndex(c => c.id === id);

/* 한 칸이 도전 가능한가. **바로 앞 칸을 깼으면** 열린다 — 첫 칸은 언제나 열려 있다.
   이미 깬 칸도 다시 갈 수 있다(보상은 없다). 막히면 갈아서 레벨을 올리는 길이 전부다. */
export function cellOpen(prog, i) {
  if (i < 0 || i >= FRONT_CELLS.length) return false;
  return i === 0 || prog[i - 1] > 0;
}

/* 콘텐츠 해금. 문이 **둘**이다 — 전선을 밀었거나, 기체가 이미 그만큼 컸거나.
   둘 중 하나만 넘으면 열린다.

   왜 둘인가 — 기존 계정은 전선을 한 칸도 안 깼지만 Lv.32 까지 키운 사람이 있다.
   진행도만 보면 그 사람의 뽑기가 갑자기 잠긴다. 그리고 전선이 망가져도
   레벨로 열리므로 **아무도 갇히지 않는다**. */
export function gateOpen(name, prog, maxLv) {
  const g = FRONT_GATES[name];
  if (!g) return true;                       // 문이 없는 것은 늘 열려 있다
  return clearedCount(prog) >= g.need || (maxLv | 0) >= g.altLv;
}

/* 지금 잠겨 있는 문들. 화면이 '무엇을 하면 열리는지' 를 적을 때 쓴다. */
export function lockedGates(prog, maxLv) {
  return Object.keys(FRONT_GATES)
    .filter(k => !gateOpen(k, prog, maxLv))
    .map(k => ({ key: k, ...FRONT_GATES[k] }));
}

/* 칸의 방어선. 겹마다 몬스터 하나이고, 몬스터는 칸의 `mon` 을 순서대로 돌려 쓴다.
   난수는 **칸 id 와 겹 번호로만** 고정한다 — 도전할 때마다 장비가 바뀌면
   "아까 그 놈" 이 아니게 되고, 몇 번째 시도인지에 따라 난이도가 흔들린다.
   (territory.js 가 같은 이유로 같은 규칙을 쓴다) */
export function buildLines(cell) {
  const out = [];
  for (let i = 0; i < cell.lines; i++) {
    const type = cell.mon[i % cell.mon.length];
    const M = MONSTER_TYPES[type];
    if (!M) continue;
    const rnd = mulberry32(fnv(cell.id + '#' + i + '#' + type));
    const slots = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null }, parts = [];
    /* **1장의 방어선은 맨몸이다**(`gear: false`). 점령전은 방어선에 파츠 넷을 끼우는데,
       그대로 가져오니 Lv.1 신병(파츠 0개)이 1-1 에서 99% 졌다 — 새 계정이 정확히
       그 상태다. 파츠를 낀 적과 맨몸 플레이어는 같은 레벨이어도 같은 싸움이 아니다.
       뒷장은 `gear: true` 로 켠다. */
    if (cell.gear) for (const sl of SLOTS) {
      const p = rollPart(cell.lv, rnd, `${cell.id}-${i}-${sl}`, 'C', sl);
      slots[sl] = p.uid; parts.push(p);
    }
    const st = computeStats({ type, level: cell.lv, skillLv: 0, fat: 0, slots }, parts);
    /* 칸이 적의 세기를 직접 누른다(`foe`). 몬스터 자체를 약하게 만들면 파견·토벌의
       C 풀이 통째로 물러진다 — 나르는 동급 기준(mon.mjs 50%)에 맞춰 두고,
       **1장에서만** 눌러 쓴다. 이야기로도 1-1 의 적은 막 추락한 개체다.
       체력과 공격만 누른다. 속도를 누르면 판이 늘어져 첫 판이 길어진다. */
    const k = cell.foe == null ? 1 : cell.foe;
    if (k !== 1) { st.hp = Math.max(1, Math.round(st.hp * k)); st.atk = Math.max(1, Math.round(st.atk * k)); }
    out.push({ kind: 'monster', name: M.name, type, level: cell.lv,
               stats: applyTerrain(st, cell.terrain) });
  }
  return out;
}

/* 전선은 깎아 둔 방어선을 **남기지 않는다.** 점령전과 다른 점이다.
   점령은 여럿이 같은 칸을 오래 깎는 자리지만 전선은 혼자 미는 한 줄기라,
   반쯤 깎아 두고 기다리는 것이 '더 센 장비를 갖추는' 것보다 쉬우면 안 된다.
   그래서 도전은 언제나 가득 찬 방어선에서 시작한다. */
export const FRESH_LINES = true;

/* 첫 클리어 보상. **다시 깨면 0 이다** — 파밍 자리가 아니다(파견이 한다).
   D1 쓰기도 첫 클리어 때만 일어난다. */
export function rewardOf(cell, already) {
  if (already || !cell.reward) return null;
  const r = cell.reward;
  return { credits: r.credits | 0, scrap: r.scrap | 0, part: r.part || null };
}

/* 이 칸을 깨서 새로 열리는 문이 있으면 그 이름. 화면이 축하 문구를 띄운다. */
export function unlockedBy(cell, prog, maxLv) {
  if (!cell || !cell.unlock) return null;
  const i = cellIndex(cell.id);
  if (i < 0 || prog[i] > 0) return null;         // 이미 깬 칸이면 새로 열리는 것이 없다
  const after = prog.slice(); after[i] = 1;
  return gateOpen(cell.unlock, after, maxLv) && !gateOpen(cell.unlock, prog, maxLv)
    ? { key: cell.unlock, ...FRONT_GATES[cell.unlock] } : null;
}

/* 화면이 한 번에 받는 모양. 서버와 클라가 같은 함수로 만든다. */
export function frontView(prog, maxLv) {
  return FRONT_CHAPTERS.map(ch => ({
    id: ch.id, no: ch.no, ko: ch.ko, sub: ch.sub, lead: ch.lead,
    cells: ch.cells.map(c => {
      const i = cellIndex(c.id);
      return { id: c.id, ko: c.ko, terrain: c.terrain, lv: c.lv, lines: c.lines,
               boss: !!c.boss, mon: c.mon, intro: c.intro, outro: c.outro,
               reward: c.reward || null, unlock: c.unlock || null,
               cleared: prog[i] > 0, open: cellOpen(prog, i) };
    }),
  }));
}

/* 문자열 해시. territory.js 의 것과 같은 식이다 — 같은 입력이면 같은 방어선이 나온다. */
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
