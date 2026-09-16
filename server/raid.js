/* 보스 레이드 — 서버 판정.
 *
 * 규칙은 js/raid.js 에 있다. 여기서는 행을 읽고 쓰는 일만 한다.
 *
 * 막대가 어긋나지 않게 하는 장치 둘:
 *   ① 전투는 매번 보스를 꽉 찬 체력으로 만난다. 그래서 '읽은 값에서 빼서 쓰기' 가
 *      없고, 막대는 `dealt = dealt + 피해` 한 문장으로만 는다(원자적이다).
 *   ② 하루 횟수를 서버가 센다. 클라가 보내는 값은 아무것도 믿지 않는다 —
 *      도전 요청에 실리는 것은 '도전한다' 는 사실뿐이다.
 */
import { computeStats, power } from '../js/stats.js';
import { weekOf, weekEnd, raidOf, runRaid, raidSeeds, raidReward,
         raidLeft, raidDaily, dayOf } from '../js/raid.js';
import { PART_COLS, partOf } from './parts.js';
import { MONSTER_TYPES } from '../data/balance.js';

const TOP_N = 10;
const err = (status, error) => ({ ok: false, status, error });
const SLOT_COL = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };

/* 편성 전체를 읽는다. 시련은 한 기지만 레이드는 편성 둘이 차례로 들어간다 —
   선봉이 쓰러지면 예비가 이어서 깎는다(js/breach.js 의 runBreach). */
async function loadSquad(env, acc) {
  const p = await env.DB.prepare(
    'SELECT nickname, credits, scrap, rev, sel_robot, squad1, squad2 FROM player WHERE account_id = ?1')
    .bind(acc).first();
  if (!p) return null;
  const robots = (await env.DB.prepare(
    `SELECT id, uid, type, level, fat, skill_lv, ${Object.values(SLOT_COL).join(', ')}
       FROM robot WHERE account_id = ?1 ORDER BY id`).bind(acc).all()).results || [];
  if (!robots.length) return null;

  /* 편성 순서대로. 선봉은 sel_robot 이다 — 점령전과 같은 규칙이라 화면이 보여 주는
     '선봉/예비' 가 여기서도 그대로 뜻을 갖는다. */
  const ids = [p.squad1, p.squad2].filter(Boolean);
  const ordered = [];
  const first = robots.find(r => r.id === p.sel_robot && ids.includes(r.id));
  if (first) ordered.push(first);
  for (const id of ids) { const r = robots.find(x => x.id === id); if (r && !ordered.includes(r)) ordered.push(r); }
  if (!ordered.length) ordered.push(robots[0]);

  const parts = (await env.DB.prepare(`SELECT ${PART_COLS} FROM part WHERE account_id = ?1`)
    .bind(acc).all()).results || [];
  const byId = new Map(parts.map(x => [x.id, x]));

  const mechs = ordered.map(row => {
    const slots = {}, used = [];
    for (const sl in SLOT_COL) {
      const q = byId.get(row[SLOT_COL[sl]]);
      slots[sl] = q ? q.uid : null;
      if (q) used.push(partOf(q));
    }
    const rb = { uid: row.uid, type: row.type, level: row.level, fat: row.fat,
                 skillLv: row.skill_lv, slots };
    return { name: row.type, type: row.type, robot: rb, parts: used,
             stats: computeStats(rb, used), power: power(rb, used) };
  });
  return { player: p, mechs };
}

/* 이번 주 막대. 없으면 만든다 — 주가 바뀌는 순간 처음 들어온 사람이 연다. */
async function getBar(env, r, now) {
  let row = await env.DB.prepare('SELECT * FROM raid WHERE week = ?1').bind(r.week).first();
  if (!row) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO raid (week, boss, level, max_hp, dealt, updated_at)
         VALUES (?1,?2,?3,?4,0,?5)`).bind(r.week, r.boss, r.level, r.maxHp, now).run();
    row = await env.DB.prepare('SELECT * FROM raid WHERE week = ?1').bind(r.week).first();
  } else if (!row.killed_at &&
             (row.max_hp !== r.maxHp || row.boss !== r.boss || row.level !== r.level)) {
    /* 주 도중에 수치가 바뀌면(CONST.RAID 조정, 보스 추가) 이 행은 옛 막대를 들고 있다.
       그대로 두면 화면의 보스와 막대가 서로 다른 규칙을 따른다 — 12배로 단단해진
       보스를 옛 막대에 대고 치면 하루 만에 넘어간다.
       **어긋날 때만** 한 번 맞춘다. 매번 쓰면 읽기마다 쓰기가 붙어 D1 예산이 샌다.
       이미 쓰러진 주는 건드리지 않는다 — 막대를 키우면 시체가 다시 일어선다. */
    await env.DB.prepare(
      'UPDATE raid SET boss = ?1, level = ?2, max_hp = ?3, updated_at = ?4 WHERE week = ?5')
      .bind(r.boss, r.level, r.maxHp, now, r.week).run();
    row = { ...row, boss: r.boss, level: r.level, max_hp: r.maxHp };
  }
  return row;
}

async function board(env, acc, week) {
  const top = (await env.DB.prepare(
    `SELECT account_id, nickname, damage, best FROM raid_hit
      WHERE week = ?1 AND damage > 0 ORDER BY damage DESC, account_id LIMIT ?2`)
    .bind(week, TOP_N).all()).results || [];
  const cnt = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM raid_hit WHERE week = ?1 AND damage > 0').bind(week).first();
  return {
    top: top.map((x, i) => ({ rank: i + 1, nickname: x.nickname, damage: x.damage,
                              best: x.best, me: x.account_id === acc })),
    joined: cnt ? cnt.n : 0,
  };
}

function view(r, bar, mine, now) {
  const dealt = Math.min(bar.max_hp, bar.dealt | 0);
  return {
    ok: true, week: r.week, endsAt: weekEnd(r.week),
    boss: r.boss, name: MONSTER_TYPES[r.boss].name, role: MONSTER_TYPES[r.boss].role,
    level: r.level, battleHp: r.battleHp,
    maxHp: bar.max_hp, dealt, left: Math.max(0, bar.max_hp - dealt),
    killed: !!bar.killed_at, killer: bar.killer || null, killedAt: bar.killed_at || null,
    daily: raidDaily(), triesLeft: raidLeft(mine, now),
    me: mine ? { damage: mine.damage, best: mine.best, tries: mine.tries } : null,
    server_now: now,
  };
}

export async function raidView(env, acc, now) {
  const r = raidOf(weekOf(now));
  const bar = await getBar(env, r, now);
  const mine = await env.DB.prepare(
    'SELECT damage, best, tries, day, today FROM raid_hit WHERE week = ?1 AND account_id = ?2')
    .bind(r.week, acc).first();
  return { ...view(r, bar, mine, now), ...(await board(env, acc, r.week)) };
}

export async function raidRun(env, acc, now) {
  const r = raidOf(weekOf(now));
  const bar = await getBar(env, r, now);
  if (bar.killed_at) return err(400, 'raid already down');

  const mine = await env.DB.prepare(
    'SELECT damage, best, tries, day, today FROM raid_hit WHERE week = ?1 AND account_id = ?2')
    .bind(r.week, acc).first();
  if (raidLeft(mine, now) <= 0) return err(400, 'no tries left');

  const f = await loadSquad(env, acc);
  if (!f) return err(404, 'no player');

  const tries = (mine ? mine.tries : 0) + 1;
  const seeds = raidSeeds(r.week, acc, tries, f.mechs.length);
  const out = runRaid(f.mechs, r, seeds);

  /* 막대가 남은 것보다 더 때렸으면 남은 만큼만 센다 — 순위표의 합이 막대보다
     커지면 '누가 얼마나 기여했나' 가 말이 안 된다. */
  const leftBefore = Math.max(0, bar.max_hp - (bar.dealt | 0));
  const dmg = Math.min(out.damage, leftBefore);
  /* 보상 기준은 **배수를 걸기 전** 보스 체력이다(js/raid.js 의 raidReward 주석).
     전투의 세기(RAID.bossX)와 보상의 크기를 갈라 두기 위해서다. */
  const rw = raidReward(dmg, r.baseHp || r.battleHp, r.level);
  const today = (mine && mine.day === dayOf(now)) ? (mine.today | 0) + 1 : 1;
  const kill = dmg >= leftBefore && leftBefore > 0;

  const stmts = [
    /* 막대 — 더하기 한 문장. 두 사람이 동시에 쳐도 피해가 사라지지 않는다.
       MIN 으로 천장을 씌워 막대가 넘치지 않게 한다. */
    env.DB.prepare(
      `UPDATE raid SET dealt = MIN(max_hp, dealt + ?1), updated_at = ?2
        WHERE week = ?3`).bind(dmg, now, r.week),
    env.DB.prepare(
      `INSERT INTO raid_hit (week, account_id, nickname, damage, best, tries, day, today, updated_at)
         VALUES (?1,?2,?3,?4,?4,1,?5,1,?6)
       ON CONFLICT(week, account_id) DO UPDATE SET
         nickname = ?3,
         damage   = raid_hit.damage + ?4,
         best     = MAX(raid_hit.best, ?4),
         tries    = raid_hit.tries + 1,
         day      = ?5,
         today    = ?7,
         updated_at = ?6`).bind(r.week, acc, f.player.nickname, dmg, dayOf(now), now, today),
    env.DB.prepare(
      'UPDATE player SET credits = credits + ?1, scrap = scrap + ?2, rev = rev + 1, updated_at = ?3 WHERE account_id = ?4')
      .bind(rw.cr, rw.sc, now, acc),
  ];
  /* 마지막 일격 — 이미 누워 있으면 덮어쓰지 않는다(killed_at IS NULL 조건). */
  if (kill) stmts.push(env.DB.prepare(
    'UPDATE raid SET killed_at = ?1, killer = ?2 WHERE week = ?3 AND killed_at IS NULL')
    .bind(now, f.player.nickname, r.week));
  await env.DB.batch(stmts);

  const after = await raidView(env, acc, now);
  /* 재생에 필요한 상대를 `foe` 로 보낸다. **`boss` 라고 부르면 안 된다** —
     아래 `...after` 의 boss 는 몬스터 id 문자열이고, 뒤에 퍼지므로 이 객체를 통째로
     덮는다. 실제로 덮여서 클라의 `r.boss.stats` 가 undefined 가 되고, 재생이
     시작되기도 전에 예외로 죽었다(도전 횟수만 줄고 화면은 안 뜨는 증상).
     같은 이름을 두 뜻으로 쓰지 않는 것이 고침이다. */
  return { ok: true, damage: dmg, raw: out.damage, reward: rw, kill,
           credits: f.player.credits + rw.cr, scrap: f.player.scrap + rw.sc, rev: f.player.rev + 1,
           mechs: f.mechs.map(m => ({ uid: m.robot.uid, type: m.type, level: m.robot.level,
                                      power: m.power, stats: m.stats })),
           seeds, tries, foe: { type: r.boss, level: r.level, stats: r.stats },
           ...after };
}
