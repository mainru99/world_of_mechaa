/* 진행상황 읽기/쓰기 — 서버 쪽.
 *
 * 클라이언트 저장본과 같은 모양으로 주고받되, DB 에는 스키마대로 행으로 나눠 넣는다.
 *
 * 쓰기를 아끼는 것이 핵심이다. D1 무료 한도가 '쓴 행' 기준이라 매번 전부 지우고
 * 다시 넣으면(파츠 60개면 60행) 금방 한도를 쓴다. 그래서 **서버가 현재 상태와
 * 비교해서 달라진 행만** INSERT/UPDATE/DELETE 한다. 보통 한 번에 1~3행이면 끝난다.
 *
 * 검증은 '모양과 범위'까지만 한다. 클라가 보낸 값이 정당하게 얻은 것인지는
 * 아직 확인하지 않는다 — 그건 서버가 뽑기·전투를 직접 판정하는 다음 단계의 일이다.
 */
import { ROBOT_TYPES, RARITY, SLOTS, CONST } from '../data/balance.js';

const PART_RARITIES = new Set(RARITY.map(r => r.k));
const SLOT_SET = new Set(SLOTS);
const STAT_KEYS = new Set(['hp', 'atk', 'def', 'spd', 'crit', 'eva']);

const int = (v, lo, hi, dflt = 0) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
};
const uidOk = u => typeof u === 'string' && u.length > 0 && u.length <= 32;

/* 들어온 상태를 검사하고 깎아서 '안전한 모양'으로 만든다.
   못 쓰는 값은 버리고, 범위를 벗어나면 잘라 낸다. 통째로 거절하지 않는 이유는
   저장본이 조금 깨졌다고 진행을 통째로 잃게 하고 싶지 않아서다. */
export function sanitize(raw) {
  const out = { credits: 0, cores: 0, scrap: 0, sel: 0, stat: {}, robots: [], parts: [] };
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'state is not an object' };

  out.credits = int(raw.credits, 0, 1e12);
  out.cores   = int(raw.cores,   0, 1e9);
  out.scrap   = int(raw.scrap,   0, 1e12);
  const st = raw.stat && typeof raw.stat === 'object' ? raw.stat : {};
  out.stat = { wins: int(st.wins, 0, 1e9), losses: int(st.losses, 0, 1e9), pulls: int(st.pulls, 0, 1e9) };

  const parts = Array.isArray(raw.parts) ? raw.parts : [];
  const seenPart = new Set();
  for (const p of parts) {
    if (!p || !uidOk(p.uid) || seenPart.has(p.uid)) continue;
    if (!SLOT_SET.has(p.slot) || !PART_RARITIES.has(p.rarity)) continue;
    const stats = {};
    if (p.stats && typeof p.stats === 'object') {
      for (const k of Object.keys(p.stats)) {
        if (!STAT_KEYS.has(k)) continue;
        const v = Number(p.stats[k]);
        if (Number.isFinite(v) && v >= 0) stats[k] = v;
      }
    }
    seenPart.add(p.uid);
    out.parts.push({
      uid: p.uid, slot: p.slot, rarity: p.rarity,
      name: typeof p.name === 'string' ? p.name.slice(0, 40) : '?',
      enh: int(p.enh, 0, 10), stats,
    });
  }
  const partIds = new Set(out.parts.map(p => p.uid));

  const robots = Array.isArray(raw.robots) ? raw.robots : [];
  const seenRobot = new Set(), usedPart = new Set();
  for (const r of robots) {
    if (!r || !uidOk(r.uid) || seenRobot.has(r.uid)) continue;
    if (!ROBOT_TYPES[r.type]) continue;               // 몬스터·보스·미지의 id 는 소유 불가
    const slots = {};
    for (const sl of SLOTS) {
      const u = r.slots && r.slots[sl];
      // 없는 파츠, 슬롯이 안 맞는 파츠, 이미 다른 기체가 쓰는 파츠는 떼어 낸다
      if (!u || !partIds.has(u) || usedPart.has(u)) { slots[sl] = null; continue; }
      const p = out.parts.find(x => x.uid === u);
      if (!p || p.slot !== sl) { slots[sl] = null; continue; }
      slots[sl] = u; usedPart.add(u);
    }
    seenRobot.add(r.uid);
    out.robots.push({
      uid: r.uid, type: r.type,
      level: int(r.level, 1, CONST.MAXLV, 1),
      exp: int(r.exp, 0, 1e9),
      fat: int(r.fat, 0, CONST.FAT_MAX),
      fatAt: int(r.fatAt, 0, 4e12, Date.now()),
      slots,
    });
  }
  if (!out.robots.length) return { ok: false, error: 'no valid robots' };
  out.sel = int(raw.sel, 0, out.robots.length - 1);
  return { ok: true, state: out };
}

/* ── 읽기 ──────────────────────────────────────────────── */
export async function loadState(env, accountId) {
  const p = await env.DB.prepare(
    `SELECT nickname, credits, cores, scrap, wins, losses, pulls, rating, rev, sel_robot
       FROM player WHERE account_id = ?1`).bind(accountId).first();
  if (!p) return null;

  const robots = (await env.DB.prepare(
    `SELECT id, uid, type, level, exp, fat, fat_at, s_weapon, s_frame, s_booster, s_core
       FROM robot WHERE account_id = ?1 ORDER BY id`).bind(accountId).all()).results || [];
  const parts = (await env.DB.prepare(
    `SELECT id, uid, slot, name, rarity, stats, enh
       FROM part WHERE account_id = ?1 ORDER BY id`).bind(accountId).all()).results || [];

  const byId = new Map(parts.map(x => [x.id, x.uid]));
  const col = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };

  const sel = Math.max(0, robots.findIndex(r => r.id === p.sel_robot));
  return {
    rev: p.rev,
    nickname: p.nickname,
    rating: p.rating,
    state: {
      v: 2, credits: p.credits, cores: p.cores, scrap: p.scrap,
      stat: { wins: p.wins, losses: p.losses, pulls: p.pulls },
      sel,
      robots: robots.map(r => {
        const slots = {};
        for (const sl of SLOTS) slots[sl] = byId.get(r[col[sl]]) ?? null;
        return { uid: r.uid, type: r.type, level: r.level, exp: r.exp, fat: r.fat, fatAt: r.fat_at, slots };
      }),
      parts: parts.map(x => ({
        uid: x.uid, slot: x.slot, name: x.name, rarity: x.rarity,
        stats: JSON.parse(x.stats || '{}'), enh: x.enh,
      })),
    },
  };
}

/* ── 쓰기 (달라진 행만) ────────────────────────────────── */
export async function saveState(env, accountId, incoming, now) {
  const cur = {
    robots: (await env.DB.prepare('SELECT id, uid, type, level, exp, fat, fat_at, s_weapon, s_frame, s_booster, s_core FROM robot WHERE account_id = ?1')
      .bind(accountId).all()).results || [],
    parts: (await env.DB.prepare('SELECT id, uid, slot, name, rarity, stats, enh FROM part WHERE account_id = ?1')
      .bind(accountId).all()).results || [],
    player: await env.DB.prepare('SELECT credits, cores, scrap, wins, losses, pulls, rev, sel_robot FROM player WHERE account_id = ?1')
      .bind(accountId).first(),
  };
  if (!cur.player) return { ok: false, error: 'no player row' };

  const stmts = [];
  const D = env.DB;
  const partIdByUid = new Map(cur.parts.map(p => [p.uid, p.id]));
  const robotIdByUid = new Map(cur.robots.map(r => [r.uid, r.id]));

  /* 파츠: 새 것 INSERT, 바뀐 것 UPDATE, 사라진 것 DELETE */
  const wantParts = new Map(incoming.parts.map(p => [p.uid, p]));
  for (const p of incoming.parts) {
    const statsJson = JSON.stringify(p.stats);
    const old = cur.parts.find(x => x.uid === p.uid);
    if (!old) {
      stmts.push(D.prepare('INSERT INTO part (account_id, uid, slot, name, rarity, stats, enh, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)')
        .bind(accountId, p.uid, p.slot, p.name, p.rarity, statsJson, p.enh, now));
    } else if (old.enh !== p.enh || old.stats !== statsJson || old.name !== p.name) {
      stmts.push(D.prepare('UPDATE part SET name=?1, stats=?2, enh=?3 WHERE id=?4')
        .bind(p.name, statsJson, p.enh, old.id));
    }
  }
  for (const old of cur.parts) {
    if (!wantParts.has(old.uid)) stmts.push(D.prepare('DELETE FROM part WHERE id=?1').bind(old.id));
  }

  /* 기체: 슬롯은 파츠 id 를 참조하므로 파츠를 먼저 반영한 뒤 두 번째 배치에서 처리한다 */
  if (stmts.length) await D.batch(stmts);

  const parts2 = (await D.prepare('SELECT id, uid FROM part WHERE account_id = ?1').bind(accountId).all()).results || [];
  const pid = new Map(parts2.map(p => [p.uid, p.id]));

  const stmts2 = [];
  const wantRobots = new Map(incoming.robots.map(r => [r.uid, r]));
  for (const r of incoming.robots) {
    const s = k => (r.slots[k] ? pid.get(r.slots[k]) ?? null : null);
    const old = cur.robots.find(x => x.uid === r.uid);
    if (!old) {
      stmts2.push(D.prepare(`INSERT INTO robot (account_id, uid, type, level, exp, fat, fat_at, s_weapon, s_frame, s_booster, s_core, created_at)
                             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`)
        .bind(accountId, r.uid, r.type, r.level, r.exp, r.fat, r.fatAt,
              s('WEAPON'), s('FRAME'), s('BOOSTER'), s('CORE'), now));
    } else {
      const changed = old.type !== r.type || old.level !== r.level || old.exp !== r.exp ||
        old.fat !== r.fat || old.fat_at !== r.fatAt ||
        old.s_weapon !== s('WEAPON') || old.s_frame !== s('FRAME') ||
        old.s_booster !== s('BOOSTER') || old.s_core !== s('CORE');
      if (changed) {
        stmts2.push(D.prepare(`UPDATE robot SET type=?1, level=?2, exp=?3, fat=?4, fat_at=?5,
                                 s_weapon=?6, s_frame=?7, s_booster=?8, s_core=?9 WHERE id=?10`)
          .bind(r.type, r.level, r.exp, r.fat, r.fatAt,
                s('WEAPON'), s('FRAME'), s('BOOSTER'), s('CORE'), old.id));
      }
    }
  }
  for (const old of cur.robots) {
    if (!wantRobots.has(old.uid)) stmts2.push(D.prepare('DELETE FROM robot WHERE id=?1').bind(old.id));
  }

  /* player — 실제로 달라졌을 때만 쓴다. rev 는 항상 올려서 다른 기기가 알아채게 한다. */
  const selUid = incoming.robots[incoming.sel]?.uid;
  const rev = cur.player.rev + 1;
  stmts2.push(D.prepare(`UPDATE player SET credits=?1, cores=?2, scrap=?3, wins=?4, losses=?5, pulls=?6,
                           rev=?7, updated_at=?8 WHERE account_id=?9`)
    .bind(incoming.credits, incoming.cores, incoming.scrap,
          incoming.stat.wins, incoming.stat.losses, incoming.stat.pulls, rev, now, accountId));

  if (stmts2.length) await D.batch(stmts2);

  /* sel_robot 은 기체 행이 생긴 뒤에야 id 를 안다 */
  if (selUid) {
    const sr = await D.prepare('SELECT id FROM robot WHERE account_id=?1 AND uid=?2').bind(accountId, selUid).first();
    if (sr && sr.id !== cur.player.sel_robot) {
      await D.prepare('UPDATE player SET sel_robot=?1 WHERE account_id=?2').bind(sr.id, accountId).run();
    }
  }

  return { ok: true, rev, wrote: stmts.length + stmts2.length };
}
