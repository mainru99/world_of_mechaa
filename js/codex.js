/* 도감 — 무엇을 모았고, 무엇을 활성화했고, 무엇을 돌려받나. (2026-09-18 사용자 지시)
 *
 * **서버와 화면이 이 파일 하나를 같이 쓴다.** 비용·환급을 계산하는 규칙이 두 벌이면
 * 화면은 '받을 수 있음' 을 띄우는데 서버는 거절하는 날이 온다. DOM 을 쓰지 않는다.
 *
 * ── 흐름 ────────────────────────────────────────────────
 *   모은다(got)  → 재화를 내고 활성화한다(on) → 활성화 칸 수가 이정표에 닿으면
 *   그때까지 활성화에 쓴 재화를 돌려받는다(크레딧 ×1.02 · 코어 ×0.9) + 칭호
 *   값은 CONST.CODEX. 이정표를 세는 것은 **활성화한 칸**이다 — 모으기만 해서는 안 센다.
 *
 * ── 저장 모양 (player.codex, JSON) ─────────────────────────
 *   ms  { 몬스터id: 만난 수 }        — 싸운 적이 있다
 *   mk  { 몬스터id: 처치 수 }        — 이긴 적이 있다 (= 몬스터를 '모았다')
 *   r   { 기체id: 1 }               — 가져 본 적이 있다 (DB 트리거가 적는다)
 *   p   { '베이스:등급': 1 }         — 가져 본 적이 있다 (DB 트리거가 적는다)
 *   a   { 칸키: 1 }                 — 활성화한 칸.  칸키 = m:<id> · r:<id> · p:<베이스>:<등급>
 *   rf  { 칸키: 1 }                 — 활성화 비용을 이미 돌려받은 칸
 *   c   { 이정표키: 1 }              — 넘은 이정표.  S:<갈래>:<n> · S:all
 *   t   칭호 키 | null              — 달고 있는 칭호
 *
 * **몬스터의 '모음' 은 처치 수가 1단계 문턱(CONST.CODEX.mon[등급].t[0])에 닿은 것**이다 — 전에는 1번(2026-09-19).
 *   그 위로 단계가 넷 있다(monTier). 3·4단계는 확률이 섞인다. 단계는 **저장하지 않고 처치 수에서 계산한다.**
 *   이미 활성화한 칸은 처치 수가 문턱보다 적어도 그대로 활성이다(바꾸기 전에 켠 사람의 것을 빼앗지 않는다).
 *
 * **기체·파츠의 '모음' 은 저장값 ∪ 지금 가진 것** 으로 본다. 도감을 넣기 전에 얻은 것도 지금
 * 들고 있으면 모은 것으로 친다 — 따로 이관을 돌리지 않아도 된다.
 * (첫 판에는 모으면 바로 보상을 줬고 그 키가 c 에 'f:…' 로 남아 있을 수 있다. 지금 규칙은 안 본다.) */
import { CONST, MONSTER_TYPES, ROBOT_TYPES, PART_BASES, RARITY } from '../data/balance.js';

const K = () => CONST.CODEX || { act: {}, steps: {}, refund: { cr: 1, co: 1 }, all: null, titles: {} };
const RAR_ORDER = ['C', 'UC', 'R', 'UQ', 'EP', 'BOSS'];
const PART_RARS = RARITY.map(r => r.k);                       // C R SR SSR
const byRar = (a, b) => RAR_ORDER.indexOf(a.rarity) - RAR_ORDER.indexOf(b.rarity);
export const GROUPS = ['monster', 'robot', 'part'];
export const GROUP_KO = { monster: '몬스터', robot: '기체', part: '파츠' };

/* 표시 순서 — 등급, 그다음 id. 저장값과 무관하게 늘 같은 자리에 선다. */
export const MONSTER_IDS = Object.keys(MONSTER_TYPES)
  .map(id => ({ id, rarity: MONSTER_TYPES[id].rarity })).sort((a, b) => byRar(a, b) || a.id.localeCompare(b.id))
  .map(x => x.id);
export const ROBOT_IDS = Object.keys(ROBOT_TYPES).filter(id => !ROBOT_TYPES[id].story)   // 스토리 기체는 도감 칸이 없다
  .map(id => ({ id, rarity: ROBOT_TYPES[id].rarity })).sort((a, b) => byRar(a, b) || a.id.localeCompare(b.id))
  .map(x => x.id);
export const PART_KEYS = Object.keys(PART_BASES).flatMap(b => PART_RARS.map(r => b + ':' + r));

/* 문자열(또는 객체) → 늘 같은 모양. 망가진 값은 빈 도감이 된다 — 게임을 멈추지 않는다. */
export function parseCodex(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = null; } }
  if (!o || typeof o !== 'object') o = {};
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  return { ms: obj(o.ms), mk: obj(o.mk), r: obj(o.r), p: obj(o.p), a: obj(o.a), rf: obj(o.rf), c: obj(o.c),
           t: typeof o.t === 'string' ? o.t : null };
}

/* 칸 하나를 활성화하는 값 { cr, co }. */
export function actCost(group, rarity) {
  const r = ((K().act || {})[group] || {})[rarity] || {};
  return { cr: r.cr | 0, co: r.co | 0 };
}

/* ── 몬스터 도감 단계 (2026-09-19 사용자 지시) ─────────────────────────
   단계 0 — 아직 못 모음(처치 < t[0])
   단계 1 — 모음. 활성화할 수 있다         (처치 ≥ t[0])
   단계 2 —                                (처치 ≥ t[1])
   단계 3 — t[2] 번째 처치부터 **처치할 때마다 p[0]** 로 오른다
   단계 4 — 3단계에 오른 뒤, t[3] 번째 처치부터 **처치할 때마다 p[1]** 로 오른다

   **확률은 굴려서 저장하지 않는다.** '(계정, 몬스터, 단계, 몇 번째 처치)' 를 해시해서 그 처치가 붙었는지를 정한다.
     · 저장이 없다 — 몬스터 기록은 읽지 않고 더하는 한 문장이라(server/codex.js) 굴린 결과를 적을 자리가 없다
     · 같은 계정은 어느 기기에서 봐도 같은 단계다. 다시 불러도 바뀌지 않는다(새로 고침으로 다시 굴리는 길이 없다)
     · 계정마다 다르다 — 모두가 '173번째에 오른다' 를 공유하지 않는다
   단계는 보이는 것(카드 테두리 색)만 바꾼다. 서버는 단계를 쓰지 않으므로 salt 없이 불러도 된다. */
const MON_RULE_DFLT = { t: [1, 1e9, 1e9, 1e9], p: [0, 0] };
export const monRule = rarity => ((K().mon || {})[rarity]) || MON_RULE_DFLT;

/* 32비트 해시 → [0,1). FNV-1a 뒤에 한 번 섞는다(이웃한 처치 번호가 비슷한 값이 되지 않게). */
function roll01(salt, id, stage, k) {
  let h = 0x811c9dc5;
  const s = `${salt}|${id}|${stage}|${k}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/* from 번째 처치부터 kills 번째까지 처음으로 붙은 처치 번호. 없으면 -1 */
function firstHit(salt, id, stage, from, kills, p) {
  if (!(p > 0)) return -1;
  for (let k = Math.max(1, from); k <= kills; k++) if (roll01(salt, id, stage, k) < p) return k;
  return -1;
}

/* 몬스터 한 종의 단계와 다음 목표.
   next — { need: 다음 단계 문턱, chance: 문턱을 넘어 확률 구간에 들어왔나 } · 4단계면 null */
export function monTier(id, kills, salt = 0) {
  const T = MONSTER_TYPES[id]; if (!T) return { tier: 0, next: null };
  const { t, p } = monRule(T.rarity);
  kills = Math.max(0, kills | 0);
  if (kills < t[0]) return { tier: 0, next: { need: t[0], chance: false } };
  if (kills < t[1]) return { tier: 1, next: { need: t[1], chance: false } };
  const k3 = firstHit(salt, id, 3, t[2], kills, p[0]);
  if (k3 < 0) return { tier: 2, next: { need: t[2], chance: kills >= t[2] } };
  const from4 = Math.max(t[3], k3 + 1);
  const k4 = firstHit(salt, id, 4, from4, kills, p[1]);
  if (k4 < 0) return { tier: 3, next: { need: from4, chance: kills >= from4 } };
  return { tier: 4, next: null };
}

/* 도감 한 장. robots 는 [{type}], parts 는 [{base, rarity}] — 지금 가진 것.
   칸마다 got(모았다) · on(활성화했다) · cost(활성화 값). 갈래마다 got/on/total 개수.
   salt 는 몬스터 단계의 확률 씨앗(계정 번호). 화면만 넘긴다 — 서버의 판정(활성화·보상)은 단계를 안 본다. */
export function codexView(raw, robots = [], parts = [], salt = 0) {
  const cx = parseCodex(raw);
  const haveR = new Set(robots.map(r => r && r.type).filter(Boolean));
  const haveP = new Set(parts.filter(p => p && p.base).map(p => p.base + ':' + p.rarity));
  const cell = (group, key, rarity, got) =>
    ({ group, key, rarity, got, on: !!cx.a[key], cost: actCost(group, rarity) });

  const monsters = MONSTER_IDS.map(id => {
    const kills = cx.mk[id] | 0, seen = Math.max(cx.ms[id] | 0, kills);
    const mt = monTier(id, kills, salt);
    /* 모음 = 1단계 문턱. 이미 켠 칸은 문턱 아래여도 모은 것으로 친다(바꾸기 전에 켠 칸) */
    const got = mt.tier >= 1 || !!cx.a['m:' + id];
    return { id, seen, kills, tier: mt.tier, next: mt.next,
             ...cell('monster', 'm:' + id, MONSTER_TYPES[id].rarity, got) };
  });
  const robotsV = ROBOT_IDS.map(id =>
    ({ id, ...cell('robot', 'r:' + id, ROBOT_TYPES[id].rarity, !!cx.r[id] || haveR.has(id)) }));
  const partsV = PART_KEYS.map(k => {
    const [base, rar] = k.split(':');
    return { base, slot: PART_BASES[base].slot, ...cell('part', 'p:' + k, rar, !!cx.p[k] || haveP.has(k)) };
  });
  const cnt = a => ({ got: a.filter(x => x.got).length, on: a.filter(x => x.on).length, total: a.length });
  const by = { monster: monsters, robot: robotsV, part: partsV };
  return { cx, monsters, robots: robotsV, parts: partsV, by,
           count: { monster: cnt(monsters), robot: cnt(robotsV), part: cnt(partsV) } };
}

/* 모았지만 아직 활성화 안 한 칸과 그 값. keys 를 주면 그 칸만(없는 칸·못 여는 칸은 빠진다). */
export function codexActivatable(view, keys) {
  const want = keys ? new Set(keys) : null;
  const list = GROUPS.flatMap(g => view.by[g]).filter(x => x.got && !x.on && (!want || want.has(x.key)));
  const total = list.reduce((a, x) => ({ cr: a.cr + x.cost.cr, co: a.co + x.cost.co }), { cr: 0, co: 0 });
  return { list, total };
}

/* 넘었는데 아직 안 받은 이정표와, 그때 돌려받을 재화.
   이정표 하나를 넘으면 **그 갈래에서 활성화했고 아직 안 돌려받은 칸 전부** 의 값을 돌려준다.
   한꺼번에 여러 이정표를 넘었어도 한 번 계산한다(이중 환급이 없다).
     크레딧 = 합 × refund.cr(1.02) 반올림 · 코어 = 합 × refund.co(0.9) 버림 */
export function codexRewards(view) {
  const C = K(), got = view.cx.c, items = [], refundKeys = [];
  let cr = 0, co = 0;
  for (const g of GROUPS) {
    const due = (C.steps[g] || []).filter(st => view.count[g].on >= st.n && !got[`S:${g}:${st.n}`]);
    if (!due.length) continue;
    for (const st of due)
      items.push({ key: `S:${g}:${st.n}`, label: `${GROUP_KO[g]} ${st.n}칸`, title: st.title || null });
    let gcr = 0, gco = 0;
    for (const x of view.by[g]) if (x.on && !view.cx.rf[x.key]) { gcr += x.cost.cr; gco += x.cost.co; refundKeys.push(x.key); }
    cr += Math.round(gcr * (C.refund?.cr ?? 1));
    co += Math.floor(gco * (C.refund?.co ?? 1));
  }
  if (C.all && !got['S:all'] && GROUPS.every(g => view.count[g].on >= view.count[g].total))
    items.push({ key: 'S:all', label: '도감 완성', title: C.all.title || null });
  return { items, refundKeys, total: { cr, co } };
}

/* 다음 이정표 — 화면이 '몇 칸 더 켜면 얼마를 돌려받나' 를 보여 준다. */
export function codexNext(view, group) {
  const st = (K().steps[group] || []).find(s => view.count[group].on < s.n);
  if (!st) return null;
  let cr = 0, co = 0;
  for (const x of view.by[group]) if (x.on && !view.cx.rf[x.key]) { cr += x.cost.cr; co += x.cost.co; }
  return { n: st.n, left: st.n - view.count[group].on, title: st.title || null,
           pending: { cr: Math.round(cr * (K().refund?.cr ?? 1)), co: Math.floor(co * (K().refund?.co ?? 1)) } };
}

/* 칭호 — 이정표에 붙은 것. 활성화 칸 수가 닿으면 열린다(보상을 받았는지와 무관). */
export function codexTitles(view) {
  const C = K(), list = [];
  for (const g of GROUPS) {
    for (const st of (C.steps[g] || [])) {
      if (!st.title) continue;
      list.push({ id: st.title, name: C.titles[st.title] || st.title, group: g, need: st.n,
                  have: view.count[g].on, got: view.count[g].on >= st.n });
    }
  }
  if (C.all && C.all.title) {
    const got = GROUPS.every(g => view.count[g].on >= view.count[g].total);
    list.push({ id: C.all.title, name: C.titles[C.all.title] || C.all.title, group: 'all',
                need: null, have: null, got });
  }
  return list;
}

export const titleName = id => (id && (K().titles || {})[id]) || null;

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
