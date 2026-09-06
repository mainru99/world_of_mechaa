/* 아레나 — 방어 편성 등록과 사람 상대 매칭.
 *
 * 상대는 접속해 있지 않다. 그래서 '싸울 수 있는 상태'를 arena_entry 에 통째로 박아 두고,
 * 매칭은 그 한 행만 읽어 끝낸다(조인 없음). D1 무료 한도가 행 읽기 기준이라 그렇다.
 *
 * 갱신 시점은 편성·레벨이 바뀔 때뿐이다. 전투마다 쓰면 쓰기 예산이 금방 마른다.
 * 피로도는 반영하지 않는다 — 쉬고 있는 방어 기체가 지쳐 있을 이유가 없다.
 */
import { ROBOT_TYPES, MONSTER_TYPES, CONST } from '../data/balance.js';
import { computeStats, power } from '../js/stats.js';

const SLOT_COL = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };

/* 밸런스 버전 — 값이 바뀌면 자동으로 달라진다.
   balance.js 에 버전 상수를 두면 고칠 때마다 같이 올려야 하는데 잊기 쉽다.
   그래서 데이터에서 직접 뽑는다. 옛 밸런스로 만든 스냅샷을 매칭에서 걸러 내는 용도다. */
let _ver = null;
export function balanceVersion() {
  if (_ver) return _ver;
  let h = 2166136261;
  const feed = s => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
  for (const t of Object.values(ROBOT_TYPES)) feed(t.id + JSON.stringify(t.base) + JSON.stringify(t.grow) + JSON.stringify(t.skill.fx) + t.spread);
  for (const t of Object.values(MONSTER_TYPES)) feed(t.id + JSON.stringify(t.base) + JSON.stringify(t.grow) + t.spread);
  feed(JSON.stringify(CONST));
  _ver = (h >>> 0).toString(36);
  return _ver;
}

/* 출전 기체의 '피로도 없는' 스냅샷을 만들어 등록한다. */
export async function registerArena(env, accountId, now) {
  const p = await env.DB.prepare(
    'SELECT nickname, rating, sel_robot FROM player WHERE account_id = ?1').bind(accountId).first();
  if (!p) return null;

  const robots = (await env.DB.prepare(
    'SELECT id, uid, type, level, s_weapon, s_frame, s_booster, s_core FROM robot WHERE account_id = ?1 ORDER BY id')
    .bind(accountId).all()).results || [];
  if (!robots.length) return null;
  const row = robots.find(r => r.id === p.sel_robot) || robots[0];

  const parts = (await env.DB.prepare('SELECT id, uid, slot, stats, enh FROM part WHERE account_id = ?1')
    .bind(accountId).all()).results || [];
  const byId = new Map(parts.map(x => [x.id, x]));

  const slots = {}, used = [];
  for (const sl of Object.keys(SLOT_COL)) {
    const q = byId.get(row[SLOT_COL[sl]]);
    slots[sl] = q ? q.uid : null;
    if (q) used.push({ uid: q.uid, slot: q.slot, stats: JSON.parse(q.stats || '{}'), enh: q.enh });
  }

  const lv = row.level;
  const defRobot = { type: row.type, level: lv, fat: 0, slots };   // 피로도 0 으로 고정
  const stats = computeStats(defRobot, used);
  const pw = power(defRobot, used);

  const snapshot = JSON.stringify({ type: row.type, level: lv, slots, parts: used, stats });
  const rnd = Math.floor(Math.random() * 0x40000000);   // 무작위 상대를 한 행만 읽고 고르기 위한 열쇠

  await env.DB.prepare(
    `INSERT INTO arena_entry (account_id, nickname, robot_type, level, power, rating, rnd, balance_ver, snapshot, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
     ON CONFLICT(account_id) DO UPDATE SET
       nickname=?2, robot_type=?3, level=?4, power=?5, rating=?6, rnd=?7, balance_ver=?8, snapshot=?9, updated_at=?10`)
    .bind(accountId, p.nickname, row.type, lv, pw, p.rating, rnd, balanceVersion(), snapshot, now).run();

  return { power: pw, rnd };
}

/* 전투력 ±15% 안에서 사람 상대 하나. 없으면 null 을 돌려주고 부르는 쪽이 생성 상대로 넘어간다.
   ORDER BY RANDOM() 은 후보를 전부 읽어 정렬하므로 쓰지 않는다 — rnd 로 한 행만 읽는다. */
export async function pickOpponentFromArena(env, accountId, myPower) {
  const lo = Math.floor(myPower * 0.85), hi = Math.ceil(myPower * 1.15);
  const cut = Math.floor(Math.random() * 0x40000000);
  const ver = balanceVersion();

  const q = dir => env.DB.prepare(
    `SELECT account_id, nickname, robot_type, level, power, rating, snapshot
       FROM arena_entry
      WHERE power BETWEEN ?1 AND ?2 AND rnd ${dir === 'up' ? '>=' : '<'} ?3
        AND account_id != ?4 AND balance_ver = ?5
      ORDER BY power, rnd ${dir === 'up' ? 'ASC' : 'DESC'} LIMIT 1`)
    .bind(lo, hi, cut, accountId, ver).first();

  /* rnd 가 끝까지 갔으면 앞쪽에서 다시 찾는다(원형 탐색) */
  const row = (await q('up')) || (await q('down'));
  if (!row) return null;

  let snap;
  try { snap = JSON.parse(row.snapshot); } catch { return null; }
  if (!snap || !snap.stats || !ROBOT_TYPES[snap.type]) return null;

  return {
    kind: 'player',
    accountId: row.account_id,
    callsign: row.nickname,
    type: snap.type,
    level: snap.level,
    slots: snap.slots || { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null },
    parts: snap.parts || [],
    stats: snap.stats,          // 스냅샷의 스탯을 그대로 쓴다. 다시 계산하지 않는다
    rating: row.rating,
  };
}

/* 레이팅 변동 — 기대 승률 기반(Elo). K 는 작게 잡아 한 판에 크게 흔들리지 않게 한다. */
export function ratingDelta(myRating, oppRating, win, K = 24) {
  const expect = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
  return Math.round(K * ((win ? 1 : 0) - expect));
}
