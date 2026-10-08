/* 격납고 조작 — 서버 판정.
 *
 * 장착·해제·강화·레벨업·정비·출전기체 선택을 전부 서버가 확인하고 실행한다.
 * 클라는 "무엇을 하겠다"만 보내고, 비용 계산과 가능 여부 판단은 서버가 한다.
 *
 * 스키마 검토에서 'DB 제약으로는 막을 수 없다'고 확인된 두 가지를 여기서 막는다.
 *   ① 파츠 소유자 확인 — FK 는 소유자를 보지 않는다
 *   ② 슬롯 일치 확인   — 컬럼별 UNIQUE 는 A.s_weapon/B.s_frame 교차를 못 막는다
 */
import { CONST, RARITY } from '../data/balance.js';
import { lvCost, enhCost, enhRate, enhMax, serviceCost, fatOf, decayFat, skillCost, skillRate, skillMax } from '../js/stats.js';
import { scrapGain, fusePart, fuseCheck, fuseCost } from '../js/gacha.js';
import { registerArena } from './arena.js';
import { partOf, insertPart } from './parts.js';
import { parsePresets, cleanName, presetCheck, PRESET_MAX } from '../js/preset.js';
import { bindOn, unbindCost, equipCheck, fuseBind, presetBindFilter } from '../js/bind.js';
import { readMany, firstOf, later } from './dbread.js';

const SLOT_COL = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };
const err = (status, error) => ({ ok: false, status, error });

const getRobot = (env, acc, uid) => env.DB
  .prepare('SELECT * FROM robot WHERE account_id = ?1 AND uid = ?2').bind(acc, uid).first();
const getPart = (env, acc, uid) => env.DB
  .prepare('SELECT * FROM part WHERE account_id = ?1 AND uid = ?2').bind(acc, uid).first();
/* 귀속된 기체의 uid — 오류 응답이 '어느 기체 것인지' 를 알려 준다 */
const boundUid = async (env, id) => id == null ? null
  : ((await env.DB.prepare('SELECT uid FROM robot WHERE id = ?1').bind(id).first()) || {}).uid || null;

/* 재화를 깎고 rev 를 올린다. 두 곳에서 같은 문장을 쓰지 않으려고 묶었다. */
const spend = (env, acc, p, { credits = 0, scrap = 0 }, now) => env.DB
  .prepare('UPDATE player SET credits=?1, scrap=?2, rev=?3, updated_at=?4 WHERE account_id=?5')
  .bind(p.credits - credits, p.scrap - scrap, p.rev + 1, now, acc);

/* robot 행들에서 '끼고 있는 파츠 id' 만 뽑는다. 슬롯이 늘면 여기 한 곳만 고친다. */
export const wornIds = robots => {
  const s = new Set();
  for (const r of robots) for (const v of [r.s_weapon, r.s_frame, r.s_booster, r.s_core]) if (v != null) s.add(v);
  return s;
};

/* 일괄 분해에서 **무엇이 사라지는가**. 되돌릴 수 없는 판단이라 SQL 에 섞어 두지 않고
   따로 뺐다 — `tools/scrapbulk.mjs` 가 이것만 따로 검사한다.
   지키는 것 둘: 끼고 있는 것은 절대 안 지운다 · keepEnhanced 면 강화한 것도 남긴다. */
export function bulkTargets(parts, worn, keepEnhanced) {
  const hit = parts.filter(pt => !worn.has(pt.id) && !(keepEnhanced && (pt.enh | 0) > 0));
  return { hit, gain: hit.reduce((t, pt) => t + scrapGain(pt.rarity, pt.enh), 0) };
}

export async function hangarAction(env, acc, body, now) {
  const action = body && body.action;
  /* 플레이어 행과 요청에 적힌 기체 · 파츠를 한 번에 읽는다(server/dbread.js) — 레벨업 · 장착 · 강화가 모두 이 길이다.
     아래 각 동작은 robotOf · partOne 으로 이 값을 받는다(같은 요청 안이라 다시 읽을 필요가 없다) */
  const rUid = body && typeof body.robotUid === 'string' ? body.robotUid : null;
  const pUid = body && typeof body.partUid === 'string' ? body.partUid : null;
  const qs = [env.DB.prepare('SELECT credits, cores, scrap, rev, sel_robot, squad1, squad2, pending_match, expd_robot, presets FROM player WHERE account_id = ?1').bind(acc)];
  if (rUid) qs.push(env.DB.prepare('SELECT * FROM robot WHERE account_id = ?1 AND uid = ?2').bind(acc, rUid));
  if (pUid) qs.push(env.DB.prepare('SELECT * FROM part WHERE account_id = ?1 AND uid = ?2').bind(acc, pUid));
  const rs = await readMany(env, qs);
  const p = firstOf(rs[0]);
  const preRobot = rUid ? firstOf(rs[1]) : null, prePart = pUid ? firstOf(rs[rUid ? 2 : 1]) : null;
  const robotOf = async uid => (uid === rUid && rUid ? preRobot : await getRobot(env, acc, uid));
  const partOne = async uid => (uid === pUid && pUid ? prePart : await getPart(env, acc, uid));
  if (!p) return err(404, 'no player');

  /* ── 장착 ── */
  if (action === 'equip') {
    const rb = await robotOf(body.robotUid);
    if (!rb) return err(404, 'robot not found');
    const pt = await partOne(body.partUid);
    if (!pt) return err(404, 'part not found');            // 남의 파츠도 여기서 걸린다(account_id 로 찾으므로)
    const col = SLOT_COL[body.slot];
    if (!col) return err(400, 'bad slot');
    if (pt.slot !== body.slot) return err(400, 'slot mismatch');   // WEAPON 파츠를 CORE 에 못 넣는다
    /* 파츠 귀속(js/bind.js) — 다른 기체에 귀속된 파츠는 못 낀다. 스위치가 꺼져 있으면 보지 않는다 */
    const bindErr = equipCheck(pt.bound ?? null, rb.id);
    if (bindErr) return { ...err(400, bindErr), boundTo: await boundUid(env, pt.bound) };

    /* 다른 기체(또는 다른 슬롯)가 물고 있으면 먼저 떼어 낸다 */
    const stmts = [];
    for (const c of Object.values(SLOT_COL)) {
      stmts.push(env.DB.prepare(`UPDATE robot SET ${c} = NULL WHERE account_id = ?1 AND ${c} = ?2`)
        .bind(acc, pt.id));
    }
    stmts.push(env.DB.prepare(`UPDATE robot SET ${col} = ?1 WHERE id = ?2`).bind(pt.id, rb.id));
    /* 처음 끼는 순간 귀속한다 */
    if (bindOn()) stmts.push(env.DB.prepare('UPDATE part SET bound = ?1 WHERE id = ?2 AND bound IS NULL').bind(rb.id, pt.id));
    stmts.push(env.DB.prepare('UPDATE player SET rev = ?1, updated_at = ?2 WHERE account_id = ?3')
      .bind(p.rev + 1, now, acc));
    await env.DB.batch(stmts);
    await later(env, () => registerArena(env, acc, now));   // 방어 편성이 바뀌었다
    return { ok: true, rev: p.rev + 1, ...(bindOn() ? { bound: rb.uid } : {}) };
  }

  /* ── 귀속 풀기 (2026-09-28) ── 정제 코어를 치르고 파츠를 풀린 상태로 돌린다. 끼고 있던 것은 낀 채다
     (다른 기체가 끼면 그때 떼어 가고 그 기체에 귀속된다). 서킷 비우기와 같은 한 묶음 — 풀었는데 안 치름 · 치렀는데 안 풂이 없다 */
  if (action === 'unbind') {
    if (!bindOn()) return err(400, 'bind off');
    const pt = await partOne(body.partUid);
    if (!pt) return err(404, 'part not found');
    if (pt.bound == null) return err(400, 'not bound');
    const cost = unbindCost();
    const q = await env.DB.prepare('SELECT rcores FROM player WHERE account_id = ?1').bind(acc).first();
    const have = q ? q.rcores | 0 : 0;
    if (have < cost) return { ...err(400, 'not enough rcores'), need: cost, rcores: have };
    const out = await env.DB.batch([
      env.DB.prepare(`UPDATE part SET bound = NULL WHERE id = ?1 AND bound = ?2
                        AND (SELECT rcores FROM player WHERE account_id = ?3) >= ?4`).bind(pt.id, pt.bound, acc, cost),
      env.DB.prepare(`UPDATE player SET rcores = rcores - ?2, rev = rev + 1, updated_at = ?3
                       WHERE account_id = ?1 AND rcores >= ?2 AND changes() = 1`).bind(acc, cost, now),
    ]);
    if (((out && out[1] && out[1].meta && out[1].meta.changes) ?? 0) !== 1) return err(409, 'part changed, retry');
    return { ok: true, spent: cost, rcores: have - cost, uid: pt.uid, rev: p.rev + 1 };
  }

  /* ── 빌드 프리셋 (5순위 I) ─────────────────────────────
     저장 · 삭제 · 적용. 저장은 **지금 이 기체가 끼고 있는 것**을 적는다 — 클라가 보낸 목록을
     믿지 않는다(남의 파츠 uid 를 적어 둘 틈을 안 만든다). 적용은 장착과 같은 규칙으로 끼운다. */
  if (action === 'presetSave' || action === 'presetDelete' || action === 'presetApply') {
    const i = body.i | 0;
    if (i < 0 || i >= PRESET_MAX) return err(400, 'bad preset slot');
    /* 파츠 귀속이 켜지면 프리셋은 **기체마다**(robot.presets). 꺼져 있으면 예전처럼 계정 하나(player.presets) */
    const perRobot = bindOn();
    /* 계정 프리셋 지우기는 기체를 받지 않는다(예전 요청 모양) — 기체가 필요할 때만 찾는다 */
    const needRobot = perRobot || action !== 'presetDelete';
    const rb = needRobot && typeof body.robotUid === 'string' ? await robotOf(body.robotUid) : null;
    if (needRobot && !rb) return err(404, 'robot not found');
    const list = parsePresets(perRobot ? rb.presets : p.presets);
    const savePresets = l => perRobot
      ? env.DB.prepare('UPDATE robot SET presets = ?1 WHERE id = ?2').bind(JSON.stringify(l), rb.id)
      : env.DB.prepare('UPDATE player SET presets = ?1, updated_at = ?2 WHERE account_id = ?3').bind(JSON.stringify(l), now, acc);

    if (action === 'presetDelete') {
      list[i] = null;
      await savePresets(list).run();
      return { ok: true, presets: list, ...(perRobot ? { robotUid: rb.uid } : {}) };
    }

    if (action === 'presetSave') {
      const ids = Object.values(SLOT_COL).map(c => rb[c]).filter(v => v != null);
      const rows = ids.length ? ((await env.DB.prepare(
        `SELECT id, uid FROM part WHERE account_id = ?1 AND id IN (${ids.map((_, k) => '?' + (k + 2)).join(',')})`)
        .bind(acc, ...ids).all()).results || []) : [];
      const uidOf = new Map(rows.map(r => [r.id, r.uid]));
      const slots = {};
      for (const [sl, c] of Object.entries(SLOT_COL)) slots[sl] = rb[c] != null ? (uidOf.get(rb[c]) || null) : null;
      list[i] = { n: cleanName(body.name, i), s: slots };
      await savePresets(list).run();
      return { ok: true, presets: list, ...(perRobot ? { robotUid: rb.uid } : {}) };
    }

    /* 적용 */
    const pre = list[i];
    if (!pre) return err(400, 'empty preset');
    const want = Object.values(pre.s).filter(Boolean);
    const rows0 = want.length ? ((await env.DB.prepare(
      `SELECT id, uid, slot, bound FROM part WHERE account_id = ?1 AND uid IN (${want.map((_, k) => '?' + (k + 2)).join(',')})`)
      .bind(acc, ...want).all()).results || []) : [];
    /* 다른 기체에 귀속된 파츠는 건너뛴다(그 칸은 분해된 칸처럼 손대지 않는다) */
    const bf = presetBindFilter(rows0, rb.id);
    const rows = rows0.filter(r => bf.use.has(r.uid));
    const chk = presetCheck(pre, rows);
    const idOf = new Map(rows.map(r => [r.uid, r.id]));
    const stmts = [];
    for (const [sl, u] of Object.entries(chk.ok)) {
      const pid = idOf.get(u);
      /* 다른 기체(또는 다른 칸)가 물고 있으면 먼저 떼어 낸다 — 장착과 같은 규칙 */
      for (const c of Object.values(SLOT_COL))
        stmts.push(env.DB.prepare(`UPDATE robot SET ${c} = NULL WHERE account_id = ?1 AND ${c} = ?2`).bind(acc, pid));
      stmts.push(env.DB.prepare(`UPDATE robot SET ${SLOT_COL[sl]} = ?1 WHERE id = ?2`).bind(pid, rb.id));
      if (bindOn()) stmts.push(env.DB.prepare('UPDATE part SET bound = ?1 WHERE id = ?2 AND bound IS NULL').bind(rb.id, pid));
    }
    /* 프리셋에서 비워 둔 칸은 뗀다. 분해로 없어진 칸(missing)은 **손대지 않는다** —
       지금 끼고 있는 것까지 벗기면 적용 한 번에 기체가 맨몸이 된다. */
    for (const sl of chk.empty) stmts.push(env.DB.prepare(`UPDATE robot SET ${SLOT_COL[sl]} = NULL WHERE id = ?1`).bind(rb.id));
    stmts.push(env.DB.prepare('UPDATE player SET rev = ?1, updated_at = ?2 WHERE account_id = ?3').bind(p.rev + 1, now, acc));
    await env.DB.batch(stmts);
    await later(env, () => registerArena(env, acc, now));   // 방어 편성이 바뀌었다
    return { ok: true, rev: p.rev + 1, applied: chk.ok, emptied: chk.empty, missing: chk.missing,
             ...(bindOn() ? { bound: bf.blocked } : {}) };
  }

  /* ── 해제 ── */
  if (action === 'unequip') {
    const rb = await robotOf(body.robotUid);
    if (!rb) return err(404, 'robot not found');
    const col = SLOT_COL[body.slot];
    if (!col) return err(400, 'bad slot');
    await env.DB.batch([
      env.DB.prepare(`UPDATE robot SET ${col} = NULL WHERE id = ?1`).bind(rb.id),
      env.DB.prepare('UPDATE player SET rev = ?1, updated_at = ?2 WHERE account_id = ?3').bind(p.rev + 1, now, acc),
    ]);
    await later(env, () => registerArena(env, acc, now));   // 방어 편성이 바뀌었다
    return { ok: true, rev: p.rev + 1 };
  }

  /* ── 파츠 강화 (스크랩) ── */
  if (action === 'enhance') {
    const pt = await partOne(body.partUid);
    if (!pt) return err(404, 'part not found');
    if (pt.enh >= enhMax()) return err(400, 'max enhanced');
    const cost = enhCost(pt.enh);
    if (p.scrap < cost) return err(400, 'not enough scrap');
    /* **확률은 서버가 굴린다.** 클라가 굴려 보내면 성공할 때까지 다시 굴리면 그만이다.
       실패해도 단계는 안 내려가고 파츠도 안 깨진다 — 재화만 나간다. */
    const roll = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const okUp = roll < enhRate(pt.enh);
    if (!okUp) {
      await spend(env, acc, p, { scrap: cost }, now).run();
      return { ok: true, rev: p.rev + 1, scrap: p.scrap - cost, enh: pt.enh, cost, failed: true };
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE part SET enh = ?1 WHERE id = ?2').bind(pt.enh + 1, pt.id),
      spend(env, acc, p, { scrap: cost }, now),
    ]);
    /* 방어 스냅샷은 '나가는 기체가 낀 파츠'만 반영한다. 인벤토리에 있는 파츠를
       강화한 것이면 스냅샷이 달라질 리 없으므로 다시 쓰지 않는다. */
    const worn = await env.DB.prepare(
      `SELECT 1 FROM robot WHERE account_id = ?1 AND id = ?2
         AND ?3 IN (s_weapon, s_frame, s_booster, s_core)`).bind(acc, p.sel_robot, pt.id).first();
    if (worn) await later(env, () => registerArena(env, acc, now));
    return { ok: true, rev: p.rev + 1, scrap: p.scrap - cost, enh: pt.enh + 1, cost };
  }

  /* ── 즉시 레벨업 (크레딧) ── */
  /* 레벨은 기체마다 따로다(007). 키우는 과정이 곧 보상이라, 새로 뽑은 기체는
     Lv.1 부터 시작해 제 또래 상대와 싸우며 큰다. */
  if (action === 'levelup') {
    const rb = await robotOf(body.robotUid);
    if (!rb) return err(404, 'robot not found');
    if (rb.level >= CONST.MAXLV) return err(400, 'max level');
    const cost = lvCost(rb.level);
    if (p.credits < cost) return err(400, 'not enough credits');
    await env.DB.batch([
      env.DB.prepare('UPDATE robot SET level = ?1, exp = 0 WHERE id = ?2').bind(rb.level + 1, rb.id),
      spend(env, acc, p, { credits: cost }, now),
    ]);
    await later(env, () => registerArena(env, acc, now));
    return { ok: true, rev: p.rev + 1, credits: p.credits - cost, level: rb.level + 1, cost };
  }

  /* ── 정비 (크레딧) ── */
  if (action === 'service') {
    const rb = await robotOf(body.robotUid);
    if (!rb) return err(404, 'robot not found');
    /* 서버 시각으로 자연 회복부터 정산한다. 그래야 '이미 회복된 만큼'을 돈 주고 사지 않는다. */
    const r = { level: rb.level, fat: rb.fat, fatAt: rb.fat_at };
    decayFat(r, now);
    const cost = serviceCost({ type: rb.type, level: rb.level, fat: r.fat });
    if (cost <= 0) return err(400, 'already serviced');
    if (p.credits < cost) return err(400, 'not enough credits');
    await env.DB.batch([
      env.DB.prepare('UPDATE robot SET fat = 0, fat_at = ?1 WHERE id = ?2').bind(now, rb.id),
      spend(env, acc, p, { credits: cost }, now),
    ]);
    return { ok: true, rev: p.rev + 1, credits: p.credits - cost, cost };
  }

  /* ── 이번에 나갈 기체 고르기 ── 편성에 든 두 기 중에서만 고를 수 있다. */
  if (action === 'select') {
    const rb = await robotOf(body.robotUid);
    if (!rb) return err(404, 'robot not found');
    if (rb.id === p.expd_robot) return err(400, 'robot on expedition');
    const squad = [p.squad1, p.squad2].filter(Boolean);
    if (squad.length && !squad.includes(rb.id)) return err(400, 'not in squad');
    await env.DB.prepare('UPDATE player SET sel_robot = ?1, rev = ?2, updated_at = ?3 WHERE account_id = ?4')
      .bind(rb.id, p.rev + 1, now, acc).run();
    await later(env, () => registerArena(env, acc, now));   // 출전 기체가 곧 방어 기체다
    return { ok: true, rev: p.rev + 1 };
  }

  /* ── 출격 편성 ── 데려갈 기체를 최대 두 기까지 정한다.
     잡아 둔 상대가 있으면 그 상대를 놓는다(pending_match 를 비운다).
     안 그러면 상대를 본 뒤 편성을 갈아 끼우면 그만이라 '두 기' 제한이 사라진다 —
     보유한 기체가 많을수록 모든 답을 다 가진 셈이 된다.
     그래서 편성은 '무엇을 만날지에 대한 베팅'이고, 상대를 본 뒤에는 데려온 둘 중에서만 고른다. */
  if (action === 'squad') {
    const uids = Array.isArray(body.robotUids) ? body.robotUids.filter(Boolean).slice(0, CONST.SQUAD_MAX) : [];
    if (!uids.length) return err(400, 'squad cannot be empty');
    const ids = [];
    for (const u of uids) {
      const rb = await getRobot(env, acc, u);
      if (!rb) return err(404, 'robot not found');
      /* 원정 나간 기체는 데려갈 수 없다. 막지 않으면 보내 놓고 그대로 싸울 수 있다. */
      if (rb.id === p.expd_robot) return err(400, 'robot on expedition');
      if (!ids.includes(rb.id)) ids.push(rb.id);
    }
    const dropped = !!p.pending_match;
    const sel = ids.includes(p.sel_robot) ? p.sel_robot : ids[0];
    await env.DB.prepare(
      `UPDATE player SET squad1 = ?1, squad2 = ?2, sel_robot = ?3, pending_match = NULL,
         rev = ?4, updated_at = ?5 WHERE account_id = ?6`)
      .bind(ids[0], ids[1] ?? null, sel, p.rev + 1, now, acc).run();
    await later(env, () => registerArena(env, acc, now));   // 나갈 기체가 곧 방어 기체다
    return { ok: true, rev: p.rev + 1, squad: uids.slice(0, ids.length), dropped };
  }

  /* ── 스킬 강화 ── 크레딧과 스크랩을 같이 쓴다. **첫 강화부터 실패한다.**
     성공 판정은 반드시 서버가 한다 — 클라가 굴리면 될 때까지 다시 보내면 그만이다.
     실패해도 재화는 나간다. 그게 이 장치의 값이다. */
  if (action === 'skillup') {
    const rb = await robotOf(body.robotUid);
    if (!rb) return err(404, 'robot not found');
    const lv = rb.skill_lv | 0;
    if (lv >= skillMax()) return err(400, 'max skill');
    const c = skillCost(lv);
    if (p.credits < c.cr) return err(400, 'not enough credits');
    if (p.scrap   < c.sc) return err(400, 'not enough scrap');

    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const ok = (buf[0] / 4294967296) < skillRate(lv);

    const stmts = [spend(env, acc, p, { credits: c.cr, scrap: c.sc }, now)];
    if (ok) stmts.push(env.DB.prepare('UPDATE robot SET skill_lv = ?1 WHERE id = ?2').bind(lv + 1, rb.id));
    await env.DB.batch(stmts);
    if (ok) await later(env, () => registerArena(env, acc, now));   // 방어 기체의 위력이 달라졌다

    return { ok: true, rev: p.rev + 1, success: ok, skillLv: ok ? lv + 1 : lv,
             credits: p.credits - c.cr, scrap: p.scrap - c.sc, cost: c, rate: skillRate(lv) };
  }

  /* ── 파츠 분해 ── 뽑기가 더 이상 일반 등급을 자동으로 없애지 않으므로,
     치우는 일은 여기서 한다. 끼고 있는 파츠는 먼저 빼야 한다 —
     장착한 채로 지우면 robot 의 슬롯 컬럼이 없는 행을 가리킨다. */
  /* ── 합성 ───────────────────────────────────────
     같은 칸·같은 등급 파츠 셋을 하나로 합친다. 규칙은 js/gacha.js 의 fusePart 다 —
     화면과 서버가 **같은 함수**를 쓰므로 '화면에서는 되는데 서버가 거절' 이 없다.

     되돌릴 수 없는 작업이라 지키는 것 셋:
       · 끼고 있는 파츠는 재료가 될 수 없다 (분해와 같은 규칙)
       · 재화와 파츠를 **한 배치**로 처리한다. 나눠 보내면 스크랩만 나가고 파츠가 안
         나오는 반쪽 상태가 생긴다
       · 씨앗은 서버가 만든다. 클라가 보내면 마음에 드는 결과가 나올 때까지 고를 수 있다 */
  if (action === 'fuse') {
    const uids = Array.isArray(body.uids) ? body.uids.slice(0, 8) : [];
    const rows = [];
    for (const u of uids) {
      const pt = await getPart(env, acc, u);
      if (!pt) return err(404, 'part not found');
      rows.push(pt);
    }
    const mats = rows.map(partOf);
    const bad = fuseCheck(mats);
    if (bad) return err(400, bad);

    const worn = await env.DB.prepare(
      'SELECT s_weapon, s_frame, s_booster, s_core FROM robot WHERE account_id = ?1').bind(acc).all();
    if (rows.some(r => wornIds(worn.results || []).has(r.id))) return err(400, 'part equipped');

    /* 귀속 — 재료가 서로 다른 기체에 귀속돼 있으면 못 합친다. 결과는 그 귀속을 이어받는다(합성으로 푸는 길을 막는다) */
    const fb = fuseBind(rows.map(r => r.bound ?? null));
    if (!fb.ok) return err(400, 'bound mismatch');

    const cost = fuseCost(mats[0].rarity);
    if (p.scrap < cost) return err(400, 'not enough scrap');

    /* 씨앗은 서버에서 만든다. pull 과 같은 모양의 uid 를 쓰고
       결과에 실어 보낸다 — 클라가 따로 만들면 서버 행과 uid 가 갈라 파츠를 가리킬 수 없다. */
    let sd = (Math.random() * 4294967296) >>> 0;
    const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
    const uid = 'f' + now.toString(36) + Math.floor(Math.random() * 1679616).toString(36);
    const out = fusePart(mats, rnd, uid);
    if (out.error) return err(400, out.error);

    /* 남는 값을 **먼저** 잡아 둔다. 배치 뒤에 p.scrap 을 다시 읽으면, 읽어 온 행이
       그 사이 갱신된 경우 한 번 더 깎인 값을 돌려주게 된다. */
    const left = p.scrap - cost, rev = p.rev + 1;
    await env.DB.batch([
      ...rows.map(r => env.DB.prepare('DELETE FROM part WHERE id = ?1').bind(r.id)),
      insertPart(env.DB, acc, out.part, now, 0),
      ...(fb.bound != null ? [env.DB.prepare('UPDATE part SET bound = ?1 WHERE account_id = ?2 AND uid = ?3').bind(fb.bound, acc, out.part.uid)] : []),
      env.DB.prepare('UPDATE player SET scrap = ?1, rev = ?2, updated_at = ?3 WHERE account_id = ?4')
        .bind(left, rev, now, acc),
    ]);
    return { ok: true, rev, scrap: left, cost,
             used: rows.map(r => r.uid), part: out.part, up: out.up, guaranteed: out.guaranteed };
  }

  if (action === 'scrap') {
    const pt = await partOne(body.partUid);
    if (!pt) return err(404, 'part not found');
    const worn = await env.DB.prepare(
      `SELECT id FROM robot WHERE account_id = ?1
        AND (s_weapon = ?2 OR s_frame = ?2 OR s_booster = ?2 OR s_core = ?2)`).bind(acc, pt.id).first();
    if (worn) return err(400, 'part equipped');
    const gain = scrapGain(pt.rarity, pt.enh);
    if (gain <= 0) return err(400, 'cannot scrap');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM part WHERE id = ?1').bind(pt.id),
      env.DB.prepare('UPDATE player SET scrap = ?1, rev = ?2, updated_at = ?3 WHERE account_id = ?4')
        .bind(p.scrap + gain, p.rev + 1, now, acc),
    ]);
    return { ok: true, rev: p.rev + 1, scrap: p.scrap + gain, gain, uid: pt.uid };
  }

  /* ── 등급별 일괄 분해 ──────────────────────────────────────
     파츠가 수백 개가 되면 하나씩 누르는 것이 일이 된다. 등급을 골라 한 번에 치운다.

     **클라이언트가 지울 목록을 보내지 않는다.** 등급과 조건만 보내고 무엇이 지워질지는
     서버가 정한다 — 목록을 받으면 그 목록이 맞는지 서버가 어차피 다시 다 확인해야 하고,
     확인을 빠뜨리는 순간 남의 파츠나 장착 중인 파츠를 지우는 길이 열린다.

     되돌릴 수 없는 작업이라 **확인 수단을 같이 준다.** `expect` 를 보내면 그 수와
     실제 대상 수가 다를 때 아무것도 안 하고 되돌려 준다 — 화면이 "27개 분해"라고
     보여 준 뒤 다른 창에서 장비를 바꿔 수가 달라졌으면, 조용히 다른 것을 지우지 않는다. */
  if (action === 'scrapBulk') {
    const rarity = String(body.rarity || '');
    if (!RARITY.some(r => r.k === rarity)) return err(400, 'bad rarity');
    const keepEnhanced = !!body.keepEnhanced;

    const [{ results: mine }, { results: robots }] = await env.DB.batch([
      env.DB.prepare('SELECT id, uid, rarity, enh FROM part WHERE account_id = ?1 AND rarity = ?2').bind(acc, rarity),
      env.DB.prepare('SELECT s_weapon, s_frame, s_booster, s_core FROM robot WHERE account_id = ?1').bind(acc),
    ]);
    const { hit, gain } = bulkTargets(mine, wornIds(robots), keepEnhanced);
    if (!hit.length) return { ok: true, rev: p.rev, scrap: p.scrap, count: 0, gain: 0, removed: [] };

    /* 화면이 센 것과 다르면 멈춘다. 지운 뒤에 알려 봐야 소용이 없다. */
    if (body.expect != null && (body.expect | 0) !== hit.length)
      return err(409, 'part count changed');

    /* DELETE 를 한 문장으로 묶는다. 300개면 문장도 300개가 되고 D1 배치 한도에 걸린다.
       id 는 서버가 방금 읽은 정수라 그대로 넣어도 안전하다(클라이언트 값이 아니다). */
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM part WHERE account_id = ?1 AND id IN (${hit.map(x => x.id).join(',')})`).bind(acc),
      env.DB.prepare('UPDATE player SET scrap = ?1, rev = ?2, updated_at = ?3 WHERE account_id = ?4')
        .bind(p.scrap + gain, p.rev + 1, now, acc),
    ]);
    return { ok: true, rev: p.rev + 1, scrap: p.scrap + gain,
             count: hit.length, gain, removed: hit.map(x => x.uid) };
  }

  return err(400, 'unknown action');
}
