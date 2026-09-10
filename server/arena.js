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
    'SELECT id, uid, type, level, skill_lv, s_weapon, s_frame, s_booster, s_core FROM robot WHERE account_id = ?1 ORDER BY id')
    .bind(accountId).all()).results || [];
  if (!robots.length) return null;
  const row = robots.find(r => r.id === p.sel_robot) || robots[0];

  const parts = (await env.DB.prepare('SELECT id, uid, slot, name, stats, enh FROM part WHERE account_id = ?1')
    .bind(accountId).all()).results || [];
  const byId = new Map(parts.map(x => [x.id, x]));

  const slots = {}, used = [];
  for (const sl of Object.keys(SLOT_COL)) {
    const q = byId.get(row[SLOT_COL[sl]]);
    slots[sl] = q ? q.uid : null;
    if (q) used.push({ uid: q.uid, slot: q.slot, name: q.name, stats: JSON.parse(q.stats || '{}'), enh: q.enh });
  }

  const lv = row.level;
  const defRobot = { type: row.type, level: lv, fat: 0, skillLv: row.skill_lv, slots };   // 피로도 0 으로 고정
  const stats = computeStats(defRobot, used);
  const pw = power(defRobot, used);

  const snapshot = JSON.stringify({ type: row.type, level: lv, skillLv: row.skill_lv, slots, parts: used, stats });
  const rnd = Math.floor(Math.random() * 0x40000000);   // 무작위 상대를 한 행만 읽고 고르기 위한 열쇠

  await env.DB.prepare(
    `INSERT INTO arena_entry (account_id, nickname, robot_type, level, power, rating, rnd, balance_ver, snapshot, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
     ON CONFLICT(account_id) DO UPDATE SET
       nickname=?2, robot_type=?3, level=?4, power=?5, rating=?6, rnd=?7, balance_ver=?8, snapshot=?9, updated_at=?10`)
    .bind(accountId, p.nickname, row.type, lv, pw, p.rating, rnd, balanceVersion(), snapshot, now).run();

  return { power: pw, rnd };
}

/* ── 옛 밸런스로 등록된 스냅샷을 지금 밸런스로 다시 계산한다 ──────────
   balanceVersion() 은 CONST 와 기체 스펙의 해시라 **밸런스를 한 줄만 고쳐도 바뀐다.**
   예전에는 매칭 질의가 `balance_ver = 지금값` 인 행만 읽었고, 그래서 밸런스를 고쳐
   배포할 때마다 등록된 방어 기체가 통째로 안 보였다 — 사람 상대 매칭이 조용히 비어
   기능이 아예 없는 것처럼 보였다.

   스냅샷에 type·level·skillLv·slots·parts 원본이 그대로 들어 있으므로 DB 를 더 읽지
   않고 다시 계산할 수 있다. 두 군데서 메운다.
     · 매칭이 옛 행을 만나면 그 자리에서 다시 계산한다 (아래 rowToOpponent)
     · 크론이 표를 훑어 power 컬럼까지 새 값으로 맞춘다 (migrateArena)
   앞쪽만 있으면 power 가 옛 값이라 ±15% 창이 어긋나고, 뒤쪽만 있으면 배포 직후
   크론이 돌 때까지 매칭이 빈다. 그래서 둘 다 둔다. */
export function recomputeSnapshot(snap) {
  if (!snap || !ROBOT_TYPES[snap.type]) return null;
  const parts = Array.isArray(snap.parts) ? snap.parts : [];
  const rb = { type: snap.type, level: snap.level | 0, fat: 0, skillLv: snap.skillLv | 0,
               slots: snap.slots || { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null } };
  const stats = computeStats(rb, parts);
  return { snapshot: { ...snap, stats }, stats, power: power(rb, parts) };
}

/* arena_entry 한 행을 전투에 쓸 상대로 바꾼다. 옛 밸런스면 여기서 다시 계산한다. */
function rowToOpponent(row, ver) {
  let snap;
  try { snap = JSON.parse(row.snapshot); } catch { return null; }
  if (!snap || !ROBOT_TYPES[snap.type]) return null;
  let stats = snap.stats;
  if (row.balance_ver !== ver) {
    const fresh = recomputeSnapshot(snap);
    if (!fresh) return null;
    stats = fresh.stats;
  }
  if (!stats) return null;
  return {
    kind: 'player',
    accountId: row.account_id,
    callsign: row.nickname,
    type: snap.type,
    level: snap.level,
    skillLv: snap.skillLv | 0,
    slots: snap.slots || { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null },
    parts: snap.parts || [],
    stats,                      // 스냅샷의 스탯. 옛 밸런스면 위에서 다시 계산한 것
    rating: row.rating,
  };
}

/* 전투력 ±15% 안에서 사람 상대 하나. 없으면 null 을 돌려주고 부르는 쪽이 생성 상대로 넘어간다.
   ORDER BY RANDOM() 은 후보를 전부 읽어 정렬하므로 쓰지 않는다 — rnd 로 한 행만 읽는다. */
export async function pickOpponentFromArena(env, accountId, myPower) {
  const lo = Math.floor(myPower * 0.85), hi = Math.ceil(myPower * 1.15);
  const cut = Math.floor(Math.random() * 0x40000000);

  const q = dir => env.DB.prepare(
    `SELECT account_id, nickname, robot_type, level, power, rating, balance_ver, snapshot
       FROM arena_entry
      WHERE power BETWEEN ?1 AND ?2 AND rnd ${dir === 'up' ? '>=' : '<'} ?3
        AND account_id != ?4
      ORDER BY power, rnd ${dir === 'up' ? 'ASC' : 'DESC'} LIMIT 1`)
    .bind(lo, hi, cut, accountId).first();

  /* rnd 가 끝까지 갔으면 앞쪽에서 다시 찾는다(원형 탐색) */
  const row = (await q('up')) || (await q('down'));
  if (!row) return null;
  return rowToOpponent(row, balanceVersion());
}

/* ── 지목 대전 ── 닉네임으로 특정 상대를 부른다.
   무작위 매칭과 달리 전투력 창을 두지 않는다 — '아는 사람과 붙어 본다'가 목적이라
   격차가 나도 그건 그것대로 뜻이 있다. 대신 부르는 쪽(battle.js)이 이 경로를
   친선전으로 처리한다: 출격비도 보상도 레이팅도 없다. 그래야 약한 상대를 골라
   잡아 파밍하는 길이 생기지 않는다.

   닉네임은 `GUEST-0002` 처럼 계정 번호가 박혀 있어 사실상 유일하다. 그래도 표에
   UNIQUE 를 걸지는 않았으므로(나중에 이름 바꾸기가 붙을 수 있다) LIMIT 1 로 받는다. */
export async function pickOpponentByNickname(env, accountId, nickname) {
  if (!nickname) return null;
  /* 자기 자신을 SQL 에서 걸러 내지 않는다. 걸러 내면 '없는 이름'과 구별이 안 돼
     자기 이름을 적은 사람에게 "이름이 정확한지 확인하세요" 라고 말하게 된다. */
  const row = await env.DB.prepare(
    `SELECT account_id, nickname, robot_type, level, power, rating, balance_ver, snapshot
       FROM arena_entry WHERE nickname = ?1 LIMIT 1`)
    .bind(nickname).first();
  if (!row) return null;
  if (row.account_id === accountId) return 'self';
  return rowToOpponent(row, balanceVersion());
}

/* 옛 밸런스로 남아 있는 등록을 지금 밸런스로 다시 계산해 넣는다. 크론이 부른다.
   한 번에 limit 만큼만 손댄다 — 크론 한 번이 쓰기 예산을 다 쓰면 안 된다.
   남은 것은 다음 크론이 이어서 한다(30분마다 돈다). */
export async function migrateArena(env, now, limit = 200) {
  const ver = balanceVersion();
  const rows = (await env.DB.prepare(
    'SELECT account_id, snapshot FROM arena_entry WHERE balance_ver != ?1 LIMIT ?2')
    .bind(ver, limit).all()).results || [];
  if (!rows.length) return { ver, scanned: 0, updated: 0, dropped: 0 };

  const stmts = [];
  let dropped = 0;
  for (const r of rows) {
    let snap;
    try { snap = JSON.parse(r.snapshot); } catch { snap = null; }
    const fresh = snap && recomputeSnapshot(snap);
    if (!fresh) {
      /* 지워진 기체 id 같은 것. 다시 계산할 수 없는 등록은 지운다 —
         남겨 두면 매칭이 매번 읽고 매번 버린다. 그 계정이 다시 접속하면
         registerArena 가 새로 넣는다. */
      dropped++;
      stmts.push(env.DB.prepare('DELETE FROM arena_entry WHERE account_id = ?1').bind(r.account_id));
      continue;
    }
    stmts.push(env.DB.prepare(
      'UPDATE arena_entry SET power=?1, balance_ver=?2, snapshot=?3, updated_at=?4 WHERE account_id=?5')
      .bind(fresh.power, ver, JSON.stringify(fresh.snapshot), now, r.account_id));
  }
  await env.DB.batch(stmts);
  return { ver, scanned: rows.length, updated: rows.length - dropped, dropped };
}

/* 레이팅 변동 — 기대 승률 기반(Elo). K 는 작게 잡아 한 판에 크게 흔들리지 않게 한다. */
export function ratingDelta(myRating, oppRating, win, K = 24) {
  const expect = 1 / (1 + Math.pow(10, (oppRating - myRating) / 400));
  return Math.round(K * ((win ? 1 : 0) - expect));
}
