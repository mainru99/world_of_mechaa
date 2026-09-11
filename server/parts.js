/* DB 의 `part` 행 ↔ 게임이 쓰는 파츠 객체. (파츠 개편 7단계)
 *
 * 지금까지 같은 SELECT 를 네 곳이(arena·battle·territory·state), 같은 INSERT 를
 * 네 곳이(battle·expedition·pull·state) 각자 적고 있었다. 이번에 칸이 넷 늘었는데
 * 그 구조로 두면 한 곳을 빼먹는 것이 시간문제다. 그래서 여기 한 곳에 모은다.
 *
 * **검사가 달라졌다.** 예전에는 클라가 보낸 스탯을 등급별 상한으로 *자르기만* 했다
 * (server/state.js 의 STAT_CAP). 자르기는 정확한 검증이 아니다 — 상한 바로 밑의
 * 값으로 전부 채운 파츠는 통과한다. 새 파츠는 스탯을 안 보내고
 * `base·rarity·affixes·seed·lv` 만 보내므로, **그것이 정당한 조합인지**만 보면 된다.
 * 통과하면 값은 서버가 직접 만든다(js/stats.js). 위조할 자리가 없다.
 */
import { PART_BASES, AFFIXES, AFFIX_GROUPS, AFFIX_TIER, RARITY, SLOTS, CONST }
  from '../data/balance.js';

export const PART_COLS = 'id, uid, slot, name, rarity, stats, enh, base, affixes, seed, lv';

const RAR_BY = Object.fromEntries(RARITY.map(r => [r.k, r]));
const SLOT_SET = new Set(SLOTS);
const GROUP_OF = (() => {
  const m = {};
  for (const g in AFFIX_GROUPS) for (const id of AFFIX_GROUPS[g]) m[id] = g;
  return m;
})();

const u32 = v => (Number(v) >>> 0);
const jsonOr = (s, dflt) => {
  if (typeof s !== 'string') return dflt;
  try { const v = JSON.parse(s); return v == null ? dflt : v; } catch { return dflt; }
};

/* ── 읽기 ───────────────────────────────────────────────
   base 가 있으면 새 파츠다. 그때는 stats 를 아예 싣지 않는다 —
   실으면 js/stats.js 의 isNewPart 가 옛 파츠로 판정해 버린다. */
export function partOf(r) {
  if (!r) return null;
  const o = { uid: r.uid, slot: r.slot, name: r.name, rarity: r.rarity, enh: r.enh | 0 };
  if (r.base) {
    o.base = r.base;
    o.affixes = Array.isArray(jsonOr(r.affixes, [])) ? jsonOr(r.affixes, []) : [];
    o.seed = u32(r.seed);
    o.lv = Math.max(1, r.lv | 0 || 1);
  } else {
    o.stats = jsonOr(r.stats, {});
  }
  return o;
}

/* ── 쓰기 ───────────────────────────────────────────────
   stats 칸은 NOT NULL 이라 새 파츠도 '{}' 를 넣는다. 아무도 읽지 않는다. */
const INSERT_SQL = `INSERT INTO part
  (account_id, uid, slot, name, rarity, stats, enh, created_at, base, affixes, seed, lv)
  VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`;

export function insertPart(D, accountId, p, now, enh) {
  return D.prepare(INSERT_SQL).bind(
    accountId, p.uid, p.slot, p.name, p.rarity,
    p.base ? '{}' : JSON.stringify(p.stats || {}),
    enh != null ? enh : (p.enh | 0), now,
    p.base || null,
    p.base ? JSON.stringify(p.affixes || []) : null,
    p.base ? u32(p.seed) : null,
    p.base ? Math.max(1, p.lv | 0 || 1) : null);
}

/* 같은 파츠인가 — 저장된 행과 들어온 파츠가 달라졌는지 본다(동기화가 UPDATE 를 걸지 결정).
   새 파츠에서 바뀔 수 있는 것은 강화뿐이다. base·affixes·seed·lv 는 만들 때 정해진다. */
export function partChanged(row, p) {
  if (!!row.base !== !!p.base) return true;
  if (row.enh !== (p.enh | 0)) return true;
  if (p.base) {
    return row.base !== p.base
        || u32(row.seed) !== u32(p.seed)
        || (row.lv | 0) !== Math.max(1, p.lv | 0 || 1)
        || (row.affixes || '') !== JSON.stringify(p.affixes || []);
  }
  return row.name !== p.name || (row.stats || '') !== JSON.stringify(p.stats || {});
}

export const UPDATE_SQL =
  'UPDATE part SET name=?1, stats=?2, enh=?3, base=?4, affixes=?5, seed=?6, lv=?7 WHERE id=?8';

export function updatePart(D, id, p) {
  return D.prepare(UPDATE_SQL).bind(
    p.name, p.base ? '{}' : JSON.stringify(p.stats || {}), p.enh | 0,
    p.base || null,
    p.base ? JSON.stringify(p.affixes || []) : null,
    p.base ? u32(p.seed) : null,
    p.base ? Math.max(1, p.lv | 0 || 1) : null, id);
}

/* ── 검사 ───────────────────────────────────────────────
   정당하게 만들어질 수 있는 조합인지만 본다. 하나라도 어긋나면 **고치지 않고 버린다** —
   '대충 맞춰서 통과시키기' 가 예전에 상한을 뚫리게 한 발상이다.
   돌려주는 것은 저장해도 되는 파츠이거나 null 이다. */
export function checkNewPart(p) {
  if (!p || typeof p !== 'object') return null;
  const B = PART_BASES[p.base];
  if (!B) return null;                                   // 모르는 베이스
  if (!SLOT_SET.has(p.slot) || B.slot !== p.slot) return null;   // 슬롯이 베이스와 안 맞는다
  const rar = RAR_BY[p.rarity];
  if (!rar) return null;

  const raw = Array.isArray(p.affixes) ? p.affixes : [];
  const [lo, hi] = rar.affixes;
  if (raw.length < lo || raw.length > hi) return null;    // 등급이 허용하는 개수 밖

  const seen = new Set(), groups = new Set(), affixes = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') return null;
    const A = AFFIXES[a.id];
    if (!A) return null;                                 // 모르는 인챈트
    if (seen.has(a.id)) return null;                     // 같은 것 두 번
    if (A.slots !== '*' && !A.slots.includes(p.slot)) return null;   // 못 붙는 슬롯
    const g = GROUP_OF[a.id];
    if (g) { if (groups.has(g)) return null; groups.add(g); }        // 같은 그룹 두 번
    if (!AFFIX_TIER[a.tier] || !rar.tiers[a.tier]) return null;      // 등급이 못 내는 티어
    seen.add(a.id);
    affixes.push({ id: a.id, tier: a.tier });            // 딴 칸은 버리고 두 칸만 남긴다
  }

  /* 이름은 베이스에서 다시 만든다. 클라가 보낸 문자열을 그대로 저장하지 않는다 —
     화면을 innerHTML 로 그리므로 이름에 태그를 넣어 보내면 그대로 실행된다. */
  return { uid: p.uid, slot: p.slot, base: p.base, rarity: p.rarity, name: B.ko,
           ko: rar.ko, affixes, seed: u32(p.seed),
           lv: Math.max(1, Math.min(CONST.MAXLV, p.lv | 0 || 1)),
           enh: Math.max(0, Math.min(10, p.enh | 0)) };
}
