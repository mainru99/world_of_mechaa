/* 격납고 조작 — 서버 판정.
 *
 * 장착·해제·강화·레벨업·정비·출전기체 선택을 전부 서버가 확인하고 실행한다.
 * 클라는 "무엇을 하겠다"만 보내고, 비용 계산과 가능 여부 판단은 서버가 한다.
 *
 * 스키마 검토에서 'DB 제약으로는 막을 수 없다'고 확인된 두 가지를 여기서 막는다.
 *   ① 파츠 소유자 확인 — FK 는 소유자를 보지 않는다
 *   ② 슬롯 일치 확인   — 컬럼별 UNIQUE 는 A.s_weapon/B.s_frame 교차를 못 막는다
 */
import { CONST } from '../data/balance.js';
import { lvCost, enhCost, serviceCost, fatOf, decayFat } from '../js/stats.js';

const SLOT_COL = { WEAPON: 's_weapon', FRAME: 's_frame', BOOSTER: 's_booster', CORE: 's_core' };
const err = (status, error) => ({ ok: false, status, error });

const getRobot = (env, acc, uid) => env.DB
  .prepare('SELECT * FROM robot WHERE account_id = ?1 AND uid = ?2').bind(acc, uid).first();
const getPart = (env, acc, uid) => env.DB
  .prepare('SELECT * FROM part WHERE account_id = ?1 AND uid = ?2').bind(acc, uid).first();
const getPlayer = (env, acc) => env.DB
  .prepare('SELECT credits, cores, scrap, rev, sel_robot FROM player WHERE account_id = ?1').bind(acc).first();

/* 재화를 깎고 rev 를 올린다. 두 곳에서 같은 문장을 쓰지 않으려고 묶었다. */
const spend = (env, acc, p, { credits = 0, scrap = 0 }, now) => env.DB
  .prepare('UPDATE player SET credits=?1, scrap=?2, rev=?3, updated_at=?4 WHERE account_id=?5')
  .bind(p.credits - credits, p.scrap - scrap, p.rev + 1, now, acc);

export async function hangarAction(env, acc, body, now) {
  const action = body && body.action;
  const p = await getPlayer(env, acc);
  if (!p) return err(404, 'no player');

  /* ── 장착 ── */
  if (action === 'equip') {
    const rb = await getRobot(env, acc, body.robotUid);
    if (!rb) return err(404, 'robot not found');
    const pt = await getPart(env, acc, body.partUid);
    if (!pt) return err(404, 'part not found');            // 남의 파츠도 여기서 걸린다(account_id 로 찾으므로)
    const col = SLOT_COL[body.slot];
    if (!col) return err(400, 'bad slot');
    if (pt.slot !== body.slot) return err(400, 'slot mismatch');   // WEAPON 파츠를 CORE 에 못 넣는다

    /* 다른 기체(또는 다른 슬롯)가 물고 있으면 먼저 떼어 낸다 */
    const stmts = [];
    for (const c of Object.values(SLOT_COL)) {
      stmts.push(env.DB.prepare(`UPDATE robot SET ${c} = NULL WHERE account_id = ?1 AND ${c} = ?2`)
        .bind(acc, pt.id));
    }
    stmts.push(env.DB.prepare(`UPDATE robot SET ${col} = ?1 WHERE id = ?2`).bind(pt.id, rb.id));
    stmts.push(env.DB.prepare('UPDATE player SET rev = ?1, updated_at = ?2 WHERE account_id = ?3')
      .bind(p.rev + 1, now, acc));
    await env.DB.batch(stmts);
    return { ok: true, rev: p.rev + 1 };
  }

  /* ── 해제 ── */
  if (action === 'unequip') {
    const rb = await getRobot(env, acc, body.robotUid);
    if (!rb) return err(404, 'robot not found');
    const col = SLOT_COL[body.slot];
    if (!col) return err(400, 'bad slot');
    await env.DB.batch([
      env.DB.prepare(`UPDATE robot SET ${col} = NULL WHERE id = ?1`).bind(rb.id),
      env.DB.prepare('UPDATE player SET rev = ?1, updated_at = ?2 WHERE account_id = ?3').bind(p.rev + 1, now, acc),
    ]);
    return { ok: true, rev: p.rev + 1 };
  }

  /* ── 파츠 강화 (스크랩) ── */
  if (action === 'enhance') {
    const pt = await getPart(env, acc, body.partUid);
    if (!pt) return err(404, 'part not found');
    if (pt.enh >= 10) return err(400, 'max enhanced');
    const cost = enhCost(pt.enh);
    if (p.scrap < cost) return err(400, 'not enough scrap');
    await env.DB.batch([
      env.DB.prepare('UPDATE part SET enh = ?1 WHERE id = ?2').bind(pt.enh + 1, pt.id),
      spend(env, acc, p, { scrap: cost }, now),
    ]);
    return { ok: true, rev: p.rev + 1, scrap: p.scrap - cost, enh: pt.enh + 1, cost };
  }

  /* ── 즉시 레벨업 (크레딧) ── */
  if (action === 'levelup') {
    const rb = await getRobot(env, acc, body.robotUid);
    if (!rb) return err(404, 'robot not found');
    if (rb.level >= CONST.MAXLV) return err(400, 'max level');
    const cost = lvCost(rb.level);
    if (p.credits < cost) return err(400, 'not enough credits');
    await env.DB.batch([
      env.DB.prepare('UPDATE robot SET level = ?1, exp = 0 WHERE id = ?2').bind(rb.level + 1, rb.id),
      spend(env, acc, p, { credits: cost }, now),
    ]);
    return { ok: true, rev: p.rev + 1, credits: p.credits - cost, level: rb.level + 1, cost };
  }

  /* ── 정비 (크레딧) ── */
  if (action === 'service') {
    const rb = await getRobot(env, acc, body.robotUid);
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

  /* ── 출전 기체 선택 ── */
  if (action === 'select') {
    const rb = await getRobot(env, acc, body.robotUid);
    if (!rb) return err(404, 'robot not found');
    await env.DB.prepare('UPDATE player SET sel_robot = ?1, rev = ?2, updated_at = ?3 WHERE account_id = ?4')
      .bind(rb.id, p.rev + 1, now, acc).run();
    return { ok: true, rev: p.rev + 1 };
  }

  return err(400, 'unknown action');
}
