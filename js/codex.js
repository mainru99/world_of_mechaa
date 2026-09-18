/* 도감 — 무엇을 채웠고, 무엇을 받을 수 있고, 어떤 칭호가 열렸나. (2026-09-18 사용자 지시)
 *
 * **서버와 화면이 이 파일 하나를 같이 쓴다.** 보상을 계산하는 규칙이 두 벌이면
 * 화면은 '받을 수 있음' 을 띄우는데 서버는 거절하는 날이 온다. DOM 을 쓰지 않는다.
 *
 * ── 저장 모양 (player.codex, JSON) ─────────────────────────
 *   ms  { 몬스터id: 만난 수 }        — 싸운 적이 있다
 *   mk  { 몬스터id: 처치 수 }        — 이긴 적이 있다
 *   r   { 기체id: 1 }               — 가져 본 적이 있다 (DB 트리거가 적는다)
 *   p   { '베이스:등급': 1 }         — 가져 본 적이 있다 (DB 트리거가 적는다)
 *   c   { 보상키: 1 }               — 받은 보상
 *   t   칭호 키 | null              — 달고 있는 칭호
 *
 * **기체·파츠는 저장값 ∪ 지금 가진 것** 으로 본다. 도감을 넣기 전에 얻은 것도 지금
 * 들고 있으면 채워진 것으로 친다 — 따로 이관을 돌리지 않아도 된다.
 * (이미 분해해 버린 옛 파츠는 알 방법이 없다. 그것만 빈다.) */
import { CONST, MONSTER_TYPES, ROBOT_TYPES, PART_BASES, RARITY } from '../data/balance.js';

const C = () => CONST.CODEX || { first: {}, steps: {}, all: null, titles: {} };
const RAR_ORDER = ['C', 'UC', 'R', 'UQ', 'EP', 'BOSS'];
const PART_RARS = RARITY.map(r => r.k);                       // C R SR SSR
const byRar = (a, b) => RAR_ORDER.indexOf(a.rarity) - RAR_ORDER.indexOf(b.rarity);

/* 표시 순서 — 등급, 그다음 id. 저장값과 무관하게 늘 같은 자리에 선다. */
export const MONSTER_IDS = Object.keys(MONSTER_TYPES)
  .map(id => ({ id, rarity: MONSTER_TYPES[id].rarity })).sort((a, b) => byRar(a, b) || a.id.localeCompare(b.id))
  .map(x => x.id);
export const ROBOT_IDS = Object.keys(ROBOT_TYPES)
  .map(id => ({ id, rarity: ROBOT_TYPES[id].rarity })).sort((a, b) => byRar(a, b) || a.id.localeCompare(b.id))
  .map(x => x.id);
export const PART_KEYS = Object.keys(PART_BASES).flatMap(b => PART_RARS.map(r => b + ':' + r));

/* 문자열(또는 객체) → 늘 같은 모양. 망가진 값은 빈 도감이 된다 — 게임을 멈추지 않는다. */
export function parseCodex(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = null; } }
  if (!o || typeof o !== 'object') o = {};
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  return { ms: obj(o.ms), mk: obj(o.mk), r: obj(o.r), p: obj(o.p), c: obj(o.c),
           t: typeof o.t === 'string' ? o.t : null };
}

/* 도감 한 장. robots 는 [{type}], parts 는 [{base, rarity}] — 지금 가진 것. */
export function codexView(raw, robots = [], parts = []) {
  const cx = parseCodex(raw);
  const haveR = new Set(robots.map(r => r && r.type).filter(Boolean));
  const haveP = new Set(parts.filter(p => p && p.base).map(p => p.base + ':' + p.rarity));

  const monsters = MONSTER_IDS.map(id => {
    const seen = cx.ms[id] | 0, kills = cx.mk[id] | 0;
    return { id, rarity: MONSTER_TYPES[id].rarity, seen: Math.max(seen, kills), kills, done: kills > 0 };
  });
  const robotsV = ROBOT_IDS.map(id => ({ id, rarity: ROBOT_TYPES[id].rarity,
                                         done: !!cx.r[id] || haveR.has(id) }));
  const partsV = PART_KEYS.map(k => {
    const [base, rar] = k.split(':');
    return { key: k, base, rarity: rar, slot: PART_BASES[base].slot, done: !!cx.p[k] || haveP.has(k) };
  });
  const cnt = a => ({ done: a.filter(x => x.done).length, total: a.length });
  return { cx, monsters, robots: robotsV, parts: partsV,
           count: { monster: cnt(monsters), robot: cnt(robotsV), part: cnt(partsV) } };
}

/* 이 도감으로 **아직 안 받은** 보상 전부. 키가 곧 '받았음' 표시다.
     f:m:<id>  f:r:<id>  f:p:<base>:<rar>   첫 채움
     s:monster:<n> …                        이정표
     all                                    세 갈래 전부 */
export function codexRewards(view) {
  const K = C(), got = view.cx.c, out = [];
  const add = (key, rw, label, kind) => {
    if (got[key] || !rw) return;
    out.push({ key, sc: rw.sc | 0, co: rw.co | 0, label, kind, title: rw.title || null });
  };
  for (const m of view.monsters) if (m.done)
    add('f:m:' + m.id, (K.first.monster || {})[m.rarity], MONSTER_TYPES[m.id].name + ' 첫 처치', 'first');
  for (const r of view.robots) if (r.done)
    add('f:r:' + r.id, (K.first.robot || {})[r.rarity], ROBOT_TYPES[r.id].name + ' 첫 입수', 'first');
  for (const p of view.parts) if (p.done)
    add('f:p:' + p.key, (K.first.part || {})[p.rarity], `${PART_BASES[p.base].ko} ${p.rarity} 첫 입수`, 'first');
  const GROUP_KO = { monster: '몬스터', robot: '기체', part: '파츠' };
  for (const g of ['monster', 'robot', 'part']) {
    for (const st of (K.steps[g] || [])) {
      if (view.count[g].done >= st.n) add(`s:${g}:${st.n}`, st, `${GROUP_KO[g]} ${st.n}칸`, 'step');
    }
  }
  if (K.all && ['monster', 'robot', 'part'].every(g => view.count[g].done >= view.count[g].total))
    add('all', K.all, '도감 완성', 'step');
  const total = out.reduce((a, x) => ({ sc: a.sc + x.sc, co: a.co + x.co }), { sc: 0, co: 0 });
  return { items: out, total };
}

/* 칭호 — 이정표에 붙은 것. 받을 수 있는 조건만 채우면 열린다(보상을 받았는지와 무관).
   next 는 '다음에 무엇을 채우면 열리나' — 화면이 목표로 띄운다. */
export function codexTitles(view) {
  const K = C(), list = [];
  for (const g of ['monster', 'robot', 'part']) {
    for (const st of (K.steps[g] || [])) {
      if (!st.title) continue;
      list.push({ id: st.title, name: K.titles[st.title] || st.title, group: g, need: st.n,
                  have: view.count[g].done, got: view.count[g].done >= st.n });
    }
  }
  if (K.all && K.all.title) {
    const got = ['monster', 'robot', 'part'].every(g => view.count[g].done >= view.count[g].total);
    list.push({ id: K.all.title, name: K.titles[K.all.title] || K.all.title, group: 'all',
                need: null, have: null, got });
  }
  return list;
}

export const titleName = id => (id && (C().titles || {})[id]) || null;

/* 몬스터 전투 결과 → 합친 기록. 같은 판에 같은 몬스터가 여러 번 나와도 한 줄로 모은다.
   서버가 json_set 한 문장으로 적는 데 쓴다(같은 경로를 두 번 쓰면 뒤엣것만 남는다). */
export function tallyMonsters(list) {
  const out = {};
  for (const x of list || []) {
    if (!x || !MONSTER_TYPES[x.type]) continue;
    const o = out[x.type] || (out[x.type] = { seen: 0, kills: 0 });
    o.seen++; if (x.win) o.kills++;
  }
  return out;
}
