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
import { parseCodex } from '../js/codex.js';
import { parseItems } from '../js/shop.js';
import { parsePresets } from '../js/preset.js';
import { huntWeekView } from '../js/rewards.js';
import { settleMastery, masteryView } from '../js/mastery.js';
import { ROBOT_TYPES, RARITY, SLOTS, PART_NAMES, STAT_ROLL, COST_ROLL, SPREAD_ROLL, CONST } from '../data/balance.js';
import { expedView } from './expedition.js';
import { PART_COLS, partOf, insertPart, updatePart, partChanged, checkNewPart } from './parts.js';

const PART_RARITIES = new Set(RARITY.map(r => r.k));
/* 파츠 이름은 **정해진 목록 안의 것만** 받는다.
   예전에는 아무 문자열이나 40자까지 받아 그대로 저장했다. 클라가 화면을 innerHTML 로
   그리므로, 이름에 태그를 넣어 보내면 그대로 실행된다(저장형 XSS).
   정당한 이름은 전부 PART_NAMES 에서 나오므로 목록 밖은 버린다. */
const PART_NAME_SET = new Set(Object.values(PART_NAMES).flat());
const SLOT_SET = new Set(SLOTS);
const STAT_LIST = ['hp', 'atk', 'def', 'spd', 'crit', 'eva', 'spread'];
const STAT_KEYS = new Set(STAT_LIST);
const isPct = k => k === 'crit' || k === 'eva' || k === 'spread';

/* 파츠 스탯 상한을 밸런스 데이터에서 유도한다.
   옛 genPart 는 등급 k 마다 n_k 번 굴리고 각 굴림에 mul_k 를 곱한다.
   비율이 아닌 스탯에는 레벨 배율(1 + lv*0.03)이 한 번 더 곱해진다.
   따라서 정당하게 만들어질 수 있는 최댓값은
       n_k × max(STAT_ROLL[s]) × mul_k × (비율이면 1, 아니면 1 + MAXLV*0.03)
   이다. 상수를 베껴 두지 않고 여기서 계산하므로, ChatGPT 가 수치를 바꾸면
   상한도 같이 움직인다. (강화 enh 는 스탯에 굽지 않고 계산할 때 곱하므로 무관) */
const LV_SCALE_MAX = 1 + CONST.MAXLV * 0.03;
const STAT_CAP = {}, STAT_FLOOR = {};
/* 파츠는 이제 대가로 한 스탯을 깎는다(SLOT_COST). 그래서 하한도 같이 유도한다 —
   음수를 통째로 버리면 정상 파츠의 대가가 사라져 오히려 더 센 파츠가 된다. */
for (const r of RARITY) {
  const cap = {}, floor = {};
  for (const st of STAT_LIST) {
    /* spread 는 SLOT_STATS 로 굴려지지 않고 슬롯마다 한 번 붙는 '성향'이라
       상·하한 모두 SPREAD_ROLL 에서 유도한다. 양쪽으로 다 갈 수 있다. */
    const hi = st === 'spread' ? SPREAD_ROLL[1] : (STAT_ROLL[st] ? STAT_ROLL[st][1] : 0);
    const n  = st === 'spread' ? 1 : r.n;
    cap[st] = n * hi * r.mul * (isPct(st) ? 1 : LV_SCALE_MAX) * 1.02;   // 반올림 여유 2%
    /* 대가는 슬롯당 한 번뿐이라 굴림 수 n 을 곱하지 않는다 */
    const lo = st === 'spread' ? SPREAD_ROLL[1] : (COST_ROLL[st] ? COST_ROLL[st][1] : 0);
    floor[st] = -lo * r.mul * (isPct(st) ? 1 : LV_SCALE_MAX) * 1.02;
  }
  STAT_CAP[r.k] = cap; STAT_FLOOR[r.k] = floor;
}

/* 이관 상한 — 오래 논 저장본보다는 넉넉하되 무한은 아니게.
   이 문은 '브라우저에 있던 예전 저장본을 한 번 옮기는' 용도다.
   넘어가면 통째로 거절하지 않고 잘라 낸 뒤 무엇을 잘랐는지 남긴다. */
export const MIG_CAP = {
  credits: 500000, cores: 2000, scrap: 200000,
  wins: 100000, losses: 100000, pulls: 100000,
  parts: 300,
  robots: Object.keys(ROBOT_TYPES).length,      // 뽑기가 중복을 분해하므로 종류 수를 넘을 수 없다
};

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
  const clamped = [];                       // 무엇을 잘랐는지 — 호출한 쪽이 기록한다
  const cut = (what, from, to) => { if (from > to) clamped.push(`${what} ${from}→${to}`); };
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'state is not an object' };

  out.credits = int(raw.credits, 0, MIG_CAP.credits);
  out.cores   = int(raw.cores,   0, MIG_CAP.cores);
  out.scrap   = int(raw.scrap,   0, MIG_CAP.scrap);
  cut('credits', int(raw.credits, 0, 1e12), out.credits);
  cut('cores',   int(raw.cores,   0, 1e12), out.cores);
  cut('scrap',   int(raw.scrap,   0, 1e12), out.scrap);
  const st = raw.stat && typeof raw.stat === 'object' ? raw.stat : {};
  out.stat = { wins: int(st.wins, 0, MIG_CAP.wins), losses: int(st.losses, 0, MIG_CAP.losses),
               pulls: int(st.pulls, 0, MIG_CAP.pulls) };

  const parts = Array.isArray(raw.parts) ? raw.parts : [];
  const seenPart = new Set();
  for (const p of parts) {
    if (!p || !uidOk(p.uid) || seenPart.has(p.uid)) continue;
    if (!SLOT_SET.has(p.slot) || !PART_RARITIES.has(p.rarity)) continue;
    if (out.parts.length >= MIG_CAP.parts) { clamped.push('parts>' + MIG_CAP.parts); break; }

    /* 새 파츠(base 가 있다)는 **자르지 않고 통째로 판정한다.** 스탯을 안 들고 오므로
       자를 것이 없고, 대신 base·인챈트·티어·등급이 정당한 조합인지만 보면 된다.
       어긋나면 고쳐서 통과시키지 않고 버린다 — '대충 맞춰 주기' 가 예전에 상한을
       뚫리게 한 발상이다(아래 STAT_CAP 주석 참고). */
    if (p.base != null) {
      const ok = checkNewPart(p);
      if (!ok) { clamped.push(`${p.uid} 버림(조합이 정당하지 않다)`); continue; }
      seenPart.add(p.uid);
      out.parts.push(ok);
      continue;
    }

    const stats = {};
    if (p.stats && typeof p.stats === 'object') {
      for (const k of Object.keys(p.stats)) {
        if (!STAT_KEYS.has(k)) continue;
        const v = Number(p.stats[k]);
        if (!Number.isFinite(v)) continue;
        // 등급이 낼 수 있는 범위를 넘으면 잘라 낸다. 여기가 예전에 뚫려 있던 자리다.
        // 아래쪽도 막는다 — 대가를 실제보다 크게 적어 넣는 것은 막을 이유가 없지만,
        // 터무니없는 음수로 다른 계산을 흔드는 것은 막아야 한다.
        const cap = STAT_CAP[p.rarity][k], floor = STAT_FLOOR[p.rarity][k];
        if (v > cap)        { clamped.push(`${p.uid}.${k} ${v}→${cap.toFixed(3)}`);   stats[k] = cap; }
        else if (v < floor) { clamped.push(`${p.uid}.${k} ${v}→${floor.toFixed(3)}`); stats[k] = floor; }
        else stats[k] = v;
      }
    }
    seenPart.add(p.uid);
    out.parts.push({
      uid: p.uid, slot: p.slot, rarity: p.rarity,
      name: PART_NAME_SET.has(p.name) ? p.name : '파츠',
      enh: int(p.enh, 0, 10), stats,
    });
  }
  const partIds = new Set(out.parts.map(p => p.uid));

  const robots = Array.isArray(raw.robots) ? raw.robots : [];
  const seenRobot = new Set(), seenType = new Set(), usedPart = new Set();
  for (const r of robots) {
    if (!r || !uidOk(r.uid) || seenRobot.has(r.uid)) continue;
    if (!ROBOT_TYPES[r.type]) continue;               // 몬스터·보스·미지의 id 는 소유 불가
    // 뽑기는 중복 기체를 분해하므로, 정당한 저장본에 같은 종류가 둘 있을 수 없다.
    if (seenType.has(r.type)) { clamped.push('dup ' + r.type); continue; }
    if (out.robots.length >= MIG_CAP.robots) { clamped.push('robots>' + MIG_CAP.robots); break; }
    seenType.add(r.type);
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
  return { ok: true, state: out, clamped };
}

/* ── 이관 문 ───────────────────────────────────────────────
 * 상한을 걸어도 '정당하게 도달 가능한 최대치'까지는 만들 수 있다.
 * 30기를 만렙으로 채운 계정을 새로 심는 건 상한으로 못 막는다.
 * 그래서 이관이 끝나면 문을 닫는 것이 유일한 완전한 방어다.
 *
 *   닫기: npx wrangler d1 execute rowar --remote  *           --command="INSERT OR REPLACE INTO meta VALUES('migration_open','0')"
 *   열기: 같은 명령에서 '1'
 *
 * 값이 없으면 열린 것으로 본다 — 기존 동작을 바꾸지 않기 위해서다.
 */
export async function migrationOpen(env) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'migration_open'").first();
  return !row || row.v === '1';
}

/* 누가 언제 무엇을 잘린 채로 이관했는지 남긴다. 나중에 되짚을 수 있어야 한다. */
export async function noteMigration(env, accountId, clamped, now) {
  await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)')
    .bind('migrated:' + accountId,
          JSON.stringify({ at: now, clamped: (clamped || []).slice(0, 20) })).run();
}

/* ── 읽기 ──────────────────────────────────────────────── */
export async function loadState(env, accountId) {
  const p = await env.DB.prepare(
    `SELECT nickname, credits, cores, scrap, wins, losses, pulls, rating, rev, mband, mband_pts, codex, items, presets,
            campaign, hunt_wk, m_goal, sel_robot, squad1, squad2, expd_robot, expd_tier, expd_lv, expd_end
       FROM player WHERE account_id = ?1`).bind(accountId).first();
  if (!p) return null;

  const robots = (await env.DB.prepare(
    `SELECT id, uid, type, level, exp, fat, fat_at, skill_lv, m_lv, s_weapon, s_frame, s_booster, s_core
       FROM robot WHERE account_id = ?1 ORDER BY id`).bind(accountId).all()).results || [];

  /* ── 숙련 조각 정산(022) ──────────────────────────────────────
     레벨이 오르는 길은 여럿이지만(대전 · 전선 · 점령 · 레벨업 구매) 정산은 **여기 한 곳**에서 한다.
     클라는 무엇을 하든 곧 상태를 다시 읽으므로 늦어도 그때 들어온다. 줄 것이 있을 때만 쓴다. */
  const mast = settleMastery(
    robots.map(r => ({ id: r.id, uid: r.uid, type: r.type, level: r.level, mLv: r.m_lv })),
    robots.map(r => r.type), parseItems(p.items), p.m_goal);
  if (mast.changed) {
    const w = [env.DB.prepare('UPDATE player SET items=?1, m_goal=?2 WHERE account_id=?3')
      .bind(JSON.stringify(mast.items), mast.goal, accountId)];
    for (const g of mast.grants)
      w.push(env.DB.prepare('UPDATE robot SET m_lv=?1 WHERE id=?2').bind(g.to, g.id));
    await env.DB.batch(w);
    p.items = JSON.stringify(mast.items);
    p.m_goal = mast.goal;
    for (const g of mast.grants) { const r = robots.find(x => x.id === g.id); if (r) r.m_lv = g.to; }
  }
  const parts = (await env.DB.prepare(
    `SELECT ${PART_COLS} FROM part WHERE account_id = ?1 ORDER BY id`).bind(accountId).all()).results || [];

  const byId = new Map(parts.map(x => [x.id, x.uid]));
  const col = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };

  const sel = Math.max(0, robots.findIndex(r => r.id === p.sel_robot));
  const uidOf = id => (robots.find(r => r.id === id) || {}).uid || null;
  return {
    rev: p.rev,
    nickname: p.nickname,
    rating: p.rating,
    /* 대전 몬스터 구간과 승급 점수. 칸이 비었으면 첫 대전에서 레이팅으로 잡힌다 —
       그 전까지는 화면도 같은 규칙(bandStart)으로 보여 준다. */
    band: { i: p.mband ?? null, pts: p.mband_pts | 0 },
    /* 도감 원본. 채운 것·받을 보상·칭호는 화면이 js/codex.js 로 계산한다(서버와 같은 함수).
       기체·파츠는 여기 state 에 이미 있으므로 따로 안 보낸다. */
    codex: parseCodex(p.codex),
    /* 보관함 — 기체 조각 등. 모양은 js/shop.js 머리말 */
    items: parseItems(p.items),
    /* 빌드 프리셋 다섯 칸. 모양은 js/preset.js 머리말 */
    presets: parsePresets(p.presets),
    /* 토벌 주간 입장 수(021) — 사냥터 줄에 '이번 주 3 / 21' 을 띄운다. 지난주 값이면 0 으로 내려간다 */
    hunt: huntWeekView(p.hunt_wk, Date.now()),
    /* 숙련 조각(022) — 개발 목표와 모인 조각. 조각 자체는 items 에 들어 있다(shard:<id>).
       방금 정산한 만큼은 grants 로 알려 준다 — 화면이 '조각 +n' 을 띄울 수 있게. */
    mastery: { ...masteryView(robots, parseItems(p.items), p.m_goal), got: mast.total, grants: mast.grants },
    state: {
      v: 2, credits: p.credits, cores: p.cores, scrap: p.scrap,
      stat: { wins: p.wins, losses: p.losses, pulls: p.pulls },
      /* 전선 진행(016). **빠져 있었다** — 클라는 접속할 때마다 이 state 로 저장본을 갈아 끼우므로
         (syncOnConnect adopt) 진행이 빈 문자열이 되어, 새로 고칠 때마다 깬 칸이 전부 안 깬 칸으로 보였다.
         서버 값은 멀쩡했다 — 칸을 다시 깨면 서버가 제 진행을 돌려주어 그때만 맞았다. (2026-09-19) */
      campaign: typeof p.campaign === 'string' ? p.campaign : '',
      /* 출격 편성 — 데려갈 수 있는 두 기. uid 로 내려 클라가 그대로 쓴다. */
      squad: [uidOf(p.squad1), uidOf(p.squad2)].filter(Boolean),
      /* 원정. endsAt 은 서버 시각이다 — 클라가 이걸로 남은 시간을 세므로 물으러 오지 않는다. */
      expd: (() => { const v = expedView(p, Date.now()); return v ? { ...v, uid: uidOf(p.expd_robot) } : null; })(),
      sel,
      robots: robots.map(r => {
        const slots = {};
        for (const sl of SLOTS) slots[sl] = byId.get(r[col[sl]]) ?? null;
        return { uid: r.uid, type: r.type, level: r.level, exp: r.exp, fat: r.fat, fatAt: r.fat_at,
                 skillLv: r.skill_lv | 0, slots };
      }),
      parts: parts.map(partOf),
    },
  };
}

/* ── 쓰기 (달라진 행만) ────────────────────────────────── */
export async function saveState(env, accountId, incoming, now) {
  const cur = {
    robots: (await env.DB.prepare('SELECT id, uid, type, level, exp, fat, fat_at, s_weapon, s_frame, s_booster, s_core FROM robot WHERE account_id = ?1')
      .bind(accountId).all()).results || [],
    parts: (await env.DB.prepare(`SELECT ${PART_COLS} FROM part WHERE account_id = ?1`)
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
    const old = cur.parts.find(x => x.uid === p.uid);
    if (!old) stmts.push(insertPart(D, accountId, p, now));
    else if (partChanged(old, p)) stmts.push(updatePart(D, old.id, p));
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
      /* m_lv 를 그 레벨로 박는다(022) — 동기화로 들어온 레벨은 클라가 적은 값이라
         숙련 조각의 바탕이 되면 안 된다. 여기서부터 오른 레벨만 조각이 된다. */
      stmts2.push(D.prepare(`INSERT INTO robot (account_id, uid, type, level, exp, fat, fat_at, s_weapon, s_frame, s_booster, s_core, created_at, m_lv)
                             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?4)`)
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
