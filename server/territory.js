/* 점령전 — 서버 판정.
 *
 * 지도는 서버에 **하나뿐이다**. 계정마다 사본을 두지 않는다 — 그래야 사람이 늘었을 때
 * 같은 칸을 두고 다투게 되고, 지금처럼 혼자일 때는 몬스터가 그 자리를 대신 지킨다.
 * 표가 12행으로 고정이라 비용도 사실상 없다.
 *
 * 요청은 셋뿐이다.
 *   view    지도를 연다 (클라가 잠깐 들고 있는다)
 *   attack  한 칸을 친다 — 방어선 전부를 한 요청에서 판정하고 재생 자료를 함께 내려보낸다
 *   claim   점령지 수입을 받는다 (여러 칸을 한 번에)
 * 진행 중인 것을 물으러 오는 경로는 없다. 남은 시간·쌓인 수입은 클라가 서버 시각으로 센다.
 *
 * 전투 규칙 자체는 js/breach.js 에 있다. 서버와 클라가 같은 파일을 쓰고, 시드도 서버가
 * 준다 — 그래서 화면에 보이는 전투와 확정된 결과가 갈릴 수 없다.
 */
import { CONST, TERRITORY, MONSTER_TYPES, ROBOT_TYPES, SLOTS } from '../data/balance.js';
import { computeStats, powerOf, gainExp, addFat, fatOf, decayFat, sortieCost } from '../js/stats.js';
import { battleExpFor } from '../js/rewards.js';
import { rarOf } from '../js/units.js';
import { genPart } from '../js/gacha.js';
import { mulberry32 } from '../js/sim.js';
import { applyTerrain, runBreach, regenLines, maxRounds, rarAllowed, withSpread } from '../js/breach.js';
import { registerArena } from './arena.js';

const err = (status, error) => ({ ok: false, status, error });
const HOUR = 3600000;
const T = CONST.TERR;
const NODE = Object.fromEntries(TERRITORY.map(n => [n.id, n]));
const COMBAT = { ...ROBOT_TYPES, ...MONSTER_TYPES };

/* 칸의 방어 파츠 등급. 칸이 셀수록 좋은 것을 낀다 — 레벨만으로는 차이가 밋밋하다. */
const DEF_PART = { C: 'C', UC: 'C', R: 'R', UQ: 'R', EP: 'SR', BOSS: 'SSR' };
/* 점령 보너스로 주는 코어 */
const CAPTURE_CORE = { C: 0, UC: 0, R: 0, UQ: 1, EP: 1, BOSS: 3 };

/* 칸의 방어선은 **매번 같아야 한다.** 깎아 둔 체력이 다음 시도로 이어지므로,
   방어자가 시도마다 새로 굴려지면 '어제 깎아 놓은 그 놈'이 아니게 된다.
   그래서 난수를 칸·방어선 번호로 고정한다. 시각도 계정도 섞지 않는다. */
function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function monsterLine(node, i) {
  const type = node.mon[i];
  const M = COMBAT[type];
  if (!M) return null;
  const rnd = mulberry32(fnv(node.id + '#' + i + '#' + type));
  const slots = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null }, parts = [];
  for (const sl of SLOTS) {
    const p = genPart(node.lv, rnd, `${node.id}-${i}-${sl}`, DEF_PART[node.rar] || 'C', sl);
    slots[sl] = p.uid; parts.push(p);
  }
  const st = computeStats({ type, level: node.lv, fat: 0, slots }, parts);
  return { kind: 'monster', name: M.name, type, level: node.lv,
           stats: applyTerrain(st, node.terrain) };
}

/* 사람이 점령한 칸에는 그 사람의 방어 스냅샷이 **맨 뒤에 한 겹 더** 붙는다.
   아레나 등록분을 그대로 읽는다 — 스냅샷을 또 만들면 두 벌이 되어 반드시 어긋난다.
   등록이 없으면(아직 한 번도 등록 안 된 계정) 몬스터만으로 지킨다. */
async function ownerLine(env, node, ownerId) {
  const row = await env.DB.prepare(
    'SELECT nickname, snapshot FROM arena_entry WHERE account_id = ?1').bind(ownerId).first();
  if (!row) return null;
  let snap; try { snap = JSON.parse(row.snapshot); } catch { return null; }
  if (!snap || !snap.stats || !ROBOT_TYPES[snap.type]) return null;
  return { kind: 'player', name: row.nickname, type: snap.type, level: snap.level,
           stats: applyTerrain(withSpread(snap.stats, snap.type), node.terrain) };
}

async function buildLines(env, node, ownerId) {
  const lines = node.mon.map((_, i) => monsterLine(node, i)).filter(Boolean);
  if (ownerId) { const o = await ownerLine(env, node, ownerId); if (o) lines.push(o); }
  return lines;
}

/* 칸의 방어 전력. 칸마다 고정이라 한 번만 계산해 들고 있는다(아이솔레이트가 살아 있는 동안).
   지도는 절대 난이도라, 눌러 보기 전에 '지금 내 전력으로 될 일인가'를 알 수 있어야 한다. */
let _pw = null;
function nodePower(id) {
  if (!_pw) {
    _pw = {};
    for (const n of TERRITORY) {
      const ps = n.mon.map((_, i) => { const l = monsterLine(n, i); return l ? powerOf(l.stats) : 0; });
      _pw[n.id] = ps.length ? Math.max(...ps) : 0;
    }
  }
  return _pw[id] || 0;
}

/* 저장된 방어선 상태를 지금 시각 기준으로 되돌린다. 읽기만 한다 — 쓰지 않는다. */
function liveHp(node, row, now, nLines) {
  let stored;
  try { stored = row && row.hp_left ? JSON.parse(row.hp_left) : null; } catch { stored = null; }
  if (!Array.isArray(stored)) stored = [];
  const base = Array.from({ length: nLines }, (_, i) => (stored[i] == null ? 1 : stored[i]));
  const hours = row && row.hp_at ? Math.max(0, (now - row.hp_at) / HOUR) : 1e6;
  return regenLines(base, hours);
}

/* 쌓인 수입. TERR.INCOME_CAP_H 시간까지만 쌓인다 — 하루 한 번은 들어와야 한다. */
function pendingIncome(node, row, now) {
  if (!row || !row.claimed_at) return { cr: 0, sc: 0, h: 0 };
  const h = Math.min(T.INCOME_CAP_H, Math.max(0, (now - row.claimed_at) / HOUR));
  return { cr: Math.floor(node.crH * h), sc: Math.floor(node.scH * h), h };
}

/* ── 지도 보기 ─────────────────────────────────────────── */
export async function territoryView(env, accountId, now) {
  const rows = (await env.DB.prepare(
    `SELECT node, owner_id, owner_name, hp_left, hp_at, taken_at, claimed_at FROM territory`)
    .all()).results || [];
  const byId = new Map(rows.map(r => [r.node, r]));

  let cr = 0, sc = 0, mine = 0;
  const nodes = TERRITORY.map(n => {
    const row = byId.get(n.id);
    const owner = row && row.owner_id ? (row.owner_id === accountId ? 'me' : 'other') : null;
    /* 사람이 지키면 방어선이 한 겹 늘어난다. 화면에도 그렇게 보여야 한다. */
    const nLines = n.mon.length + (owner ? 1 : 0);
    const out = { id: n.id, owner, ownerName: row ? row.owner_name : null,
                  lines: nLines, hp: liveHp(n, row, now, nLines), pw: nodePower(n.id) };
    if (owner === 'me') {
      mine++;
      const inc = pendingIncome(n, row, now);
      cr += inc.cr; sc += inc.sc;
      out.income = inc;
      out.takenAt = row.taken_at || null;
    }
    return out;
  });
  return { ok: true, nodes, mine, pending: { cr, sc }, at: now };
}

/* ── 편성 읽기 ─────────────────────────────────────────── */
/* 나갈 수 있는 것은 편성(squad1/squad2)에 든 두 기다. 순서가 곧 선봉·예비다. */
async function loadSquad(env, accountId) {
  const p = await env.DB.prepare(
    'SELECT nickname, credits, cores, scrap, rev, sel_robot, squad1, squad2, expd_robot FROM player WHERE account_id = ?1')
    .bind(accountId).first();
  if (!p) return null;
  const robots = (await env.DB.prepare(
    `SELECT id, uid, type, level, exp, fat, fat_at, s_weapon, s_frame, s_booster, s_core
       FROM robot WHERE account_id = ?1 ORDER BY id`).bind(accountId).all()).results || [];
  if (!robots.length) return null;
  const parts = (await env.DB.prepare('SELECT id, uid, slot, stats, enh FROM part WHERE account_id = ?1')
    .bind(accountId).all()).results || [];
  const byId = new Map(parts.map(x => [x.id, x]));
  const col = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };

  const order = [p.squad1, p.squad2].filter(Boolean);
  let picked = order.map(id => robots.find(r => r.id === id)).filter(Boolean);
  if (!picked.length) picked = [robots.find(r => r.id === p.sel_robot) || robots[0]];
  /* 원정 나간 기체는 못 나간다. 원정의 대가가 여기서도 그대로 걸린다. */
  picked = picked.filter(r => r.id !== p.expd_robot);
  /* 선봉은 격납고에서 '출격'으로 고른 기체다 — 편성에 넣은 순서가 아니라.
     대전(server/battle.js)이 sel_robot 을 내보내므로 여기도 같아야 한다.
     안 그러면 격납고에 'B 출격'이라고 떠 있는데 A 가 싸우고 피로도를 먹는다.
     ※ 클라(js/game.js openNode)도 같은 순서로 출격비와 명단을 보여 준다. */
  const si = picked.findIndex(r => r.id === p.sel_robot);
  if (si > 0) picked = [picked[si], ...picked.filter((_, i) => i !== si)];

  const mechs = picked.map(row => {
    const slots = {}, used = [];
    for (const sl of SLOTS) {
      const q = byId.get(row[col[sl]]);
      slots[sl] = q ? q.uid : null;
      if (q) used.push({ uid: q.uid, slot: q.slot, stats: JSON.parse(q.stats || '{}'), enh: q.enh });
    }
    return { row, robot: { uid: row.uid, type: row.type, level: row.level, exp: row.exp,
                           fat: row.fat, fatAt: row.fat_at, slots }, parts: used };
  });
  return { p, mechs };
}

/* ── 공격 ──────────────────────────────────────────────── */
export async function attackNode(env, accountId, now, nodeId) {
  const node = NODE[nodeId];
  if (!node) return err(400, 'unknown node');

  const row = await env.DB.prepare(
    'SELECT node, owner_id, owner_name, hp_left, hp_at, taken_at, claimed_at FROM territory WHERE node = ?1')
    .bind(nodeId).first();
  if (row && row.owner_id === accountId) return err(400, 'already yours');

  const me = await loadSquad(env, accountId);
  if (!me || !me.mechs.length) return err(400, 'no robot');

  /* 편성 제한. 넘는 기체는 데려가지 못한다 — 조용히 빼고, 남는 게 없으면 거절한다.
     주력 하나로 지도를 다 먹지 못하게 하는 장치이자, 뽑은 기체를 키울 이유다. */
  const eligible = me.mechs.filter(m => rarAllowed(rarOf(m.robot.type), node.maxRar));
  if (!eligible.length) return err(400, 'squad blocked');

  const cost = Math.ceil(sortieCost(eligible[0].robot) * T.COST_X);
  if (me.p.credits < cost)
    return err(400, 'not enough credits');

  /* 피로도는 서버 시각으로 먼저 정산한다. 깎인 체력 그대로 싸운다 — 그게 연전의 대가다. */
  for (const m of eligible) decayFat(m.robot, now);

  const lines = await buildLines(env, node, row && row.owner_id);
  if (!lines.length) return err(500, 'node has no defense');

  const mechs = eligible.map(m => ({
    name: ROBOT_TYPES[m.robot.type].name, type: m.robot.type, uid: m.robot.uid,
    level: m.robot.level, fat: fatOf(m.robot),
    stats: applyTerrain(computeStats(m.robot, m.parts), node.terrain),
  }));

  const hp0 = liveHp(node, row, now, lines.length);
  const n = maxRounds(lines.length, mechs.length);
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  const seeds = [...buf];

  const r = runBreach({ mechs, lines, seeds, hpLeft: hp0 });

  /* ── 정산 ──
     경험치는 방어선을 뚫은 기체가 받는다. 피로도는 쓰러진 쪽에 크게, 살아남은 쪽에 작게. */
  const perLine = Math.max(1, Math.round(battleExpFor(node.lv) * T.EXP_LINE));
  const fought = new Set(r.rounds.map(x => x.mi));
  const expOut = [], fatOut = [];
  for (let i = 0; i < eligible.length; i++) {
    if (!fought.has(i)) continue;
    const rb = eligible[i].robot;
    const won = r.rounds.filter(x => x.mi === i && x.win).length;
    /* 뚫은 방어선은 전액, 붙었지만 못 뚫은 방어선은 30%. 대전이 져도 35% 를 주는 것과 같은 이유다 —
       벽을 두드리는 동안 아무것도 안 남으면 크레딧만 녹고 다시 올 이유가 사라진다. */
    const tried = r.rounds.filter(x => x.mi === i).length;
    const amt = perLine * won + Math.round(perLine * 0.30) * (tried - won);
    const lv = gainExp(rb, amt);
    const add = addFat(rb, i < r.downed ? T.FAT_DOWN : T.FAT_LIVE);
    expOut.push({ uid: rb.uid, amt, from: lv.from, to: lv.to, exp: rb.exp });
    fatOut.push({ uid: rb.uid, add, now: fatOf(rb), fatAt: rb.fatAt });
  }

  const bonus = r.win
    ? { cr: Math.round(node.crH * T.CAPTURE_H), sc: Math.round(node.scH * T.CAPTURE_H),
        core: CAPTURE_CORE[node.rar] || 0 }
    : { cr: 0, sc: 0, core: 0 };

  const credits = me.p.credits - cost + bonus.cr;
  const scrap = me.p.scrap + bonus.sc;
  const cores = me.p.cores + bonus.core;
  const rev = me.p.rev + 1;

  const stmts = [];
  /* 칸의 상태. 이겼으면 주인이 바뀌고, 졌어도 깎아 둔 방어선은 남는다.
     행이 없으면 만든다 — 지도는 12칸 고정이라 표가 커지지 않는다. */
  stmts.push(env.DB.prepare(
    `INSERT INTO territory (node, owner_id, owner_name, hp_left, hp_at, taken_at, claimed_at, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?5)
     ON CONFLICT(node) DO UPDATE SET
       owner_id=?2, owner_name=?3, hp_left=?4, hp_at=?5, taken_at=?6, claimed_at=?7, updated_at=?5`)
    .bind(nodeId,
          r.win ? accountId : (row ? row.owner_id : null),
          r.win ? me.p.nickname : (row ? row.owner_name : null),
          r.win ? null : JSON.stringify(r.hpLeft.map(v => Math.round(v * 1000) / 1000)),
          now,
          r.win ? now : (row ? row.taken_at : null),
          r.win ? now : (row ? row.claimed_at : null)));

  for (let i = 0; i < eligible.length; i++) {
    if (!fought.has(i)) continue;
    const rb = eligible[i].robot;
    stmts.push(env.DB.prepare('UPDATE robot SET level=?1, exp=?2, fat=?3, fat_at=?4 WHERE id=?5')
      .bind(rb.level, rb.exp, rb.fat, rb.fatAt, eligible[i].row.id));
  }
  stmts.push(env.DB.prepare(
    'UPDATE player SET credits=?1, scrap=?2, cores=?3, rev=?4, updated_at=?5 WHERE account_id=?6')
    .bind(credits, scrap, cores, rev, now, accountId));
  await env.DB.batch(stmts);

  /* 점령했으면 내 방어 스냅샷을 최신으로 올려 둔다 — 이제 이 칸을 내 기체가 지킨다.
     (레벨이 올랐을 때도 갱신되어야 하므로 어차피 필요한 호출이다) */
  if (r.win || expOut.some(e => e.to > e.from)) await registerArena(env, accountId, now);

  return {
    ok: true, node: nodeId, win: r.win, cost, terrain: node.terrain,
    /* 클라는 아래 셋으로 같은 돌파를 다시 돌려 애니메이션만 재생한다 */
    mechs, lines, seeds, hpLeft0: hp0,
    hpLeft: r.hpLeft, cleared: r.cleared, downed: r.downed,
    blocked: me.mechs.length - eligible.length,
    reward: { ...bonus, exp: expOut, fat: fatOut },
    player: { credits, cores, scrap }, rev,
  };
}

/* ── 수입 받기 ─────────────────────────────────────────── */
/* 여러 칸을 한 번에 받는다. 칸마다 부르면 요청 수가 곧 무료 한도인 구조가 무너진다. */
export async function claimTerritory(env, accountId, now) {
  const rows = (await env.DB.prepare(
    'SELECT node, claimed_at FROM territory WHERE owner_id = ?1').bind(accountId).all()).results || [];
  if (!rows.length) return err(400, 'no territory');

  let cr = 0, sc = 0, n = 0;
  for (const row of rows) {
    const node = NODE[row.node]; if (!node) continue;
    const inc = pendingIncome(node, row, now);
    cr += inc.cr; sc += inc.sc; if (inc.cr || inc.sc) n++;
  }
  if (!cr && !sc) return err(400, 'nothing to claim');

  const p = await env.DB.prepare('SELECT credits, scrap, rev FROM player WHERE account_id = ?1')
    .bind(accountId).first();
  if (!p) return err(404, 'no player');

  const credits = p.credits + cr, scrap = p.scrap + sc, rev = p.rev + 1;
  await env.DB.batch([
    env.DB.prepare('UPDATE territory SET claimed_at = ?1, updated_at = ?1 WHERE owner_id = ?2')
      .bind(now, accountId),
    env.DB.prepare('UPDATE player SET credits = ?1, scrap = ?2, rev = ?3, updated_at = ?4 WHERE account_id = ?5')
      .bind(credits, scrap, rev, now, accountId),
  ]);
  return { ok: true, cr, sc, nodes: n, player: { credits, scrap }, rev };
}

/* ── 되찾기 (하루 한 번, 크론) ─────────────────────────
   혼자 노는 동안 지도를 다 먹으면 그걸로 끝이다. 그래서 한 사람이 절반을 넘게 들고 있을 때만
   가장 오래 들고 있던 칸 하나를 몬스터가 되찾는다.
   절반을 넘기 전에는 아무 일도 일어나지 않는다 — 애써 먹은 것을 초반부터 뺏지는 않는다. */
export async function retakeOne(env, now) {
  const rows = (await env.DB.prepare(
    `SELECT owner_id, COUNT(*) AS n FROM territory
      WHERE owner_id IS NOT NULL GROUP BY owner_id HAVING n > ?1`).bind(T.RETAKE_MIN).all()).results || [];
  if (!rows.length) return { retaken: 0 };

  const stmts = [];
  for (const r of rows) {
    const old = await env.DB.prepare(
      `SELECT node FROM territory WHERE owner_id = ?1 ORDER BY taken_at ASC LIMIT 1`)
      .bind(r.owner_id).first();
    if (!old) continue;
    stmts.push(env.DB.prepare(
      `UPDATE territory SET owner_id = NULL, owner_name = NULL,
         hp_left = NULL, hp_at = ?1, taken_at = NULL, claimed_at = NULL, updated_at = ?1
       WHERE node = ?2`).bind(now, old.node));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { retaken: stmts.length };
}
