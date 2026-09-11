/* 원정 — 기체를 얼마간 내보내 두고 재화를 받아 온다.
 *
 * 설계에서 지키는 것 셋.
 *   ① **시간은 서버 것만 쓴다.** 클라 시계를 믿으면 시간을 앞당겨 받을 수 있다.
 *      보상은 받는 순간(claim) 서버 now 와 expd_end 를 비교해서만 준다.
 *   ② **보낸 기체는 그동안 못 싸운다.** 대가가 없으면 그냥 공짜 재화다.
 *      편성에서 빼고, 편성에 다시 넣는 것도 막는다.
 *   ③ **요청은 보낼 때와 받을 때 두 번뿐이다.** 남은 시간은 클라가 expd_end 로 계산한다.
 *      진행 상황을 물으러 서버에 오면 요청 수가 곧 무료 한도인 구조가 무너진다.
 *
 * 보상은 보낼 때의 레벨로 고정한다(expd_lv). 받을 때 다시 읽으면 '보내 놓고 키운 뒤 받기'가
 * 이득이 되어, 원정이 레벨업의 부산물이 된다.
 */
import { CONST } from '../data/balance.js';
import { rollPart } from '../js/gacha.js';
import { insertPart } from './parts.js';

const err = (status, error) => ({ ok: false, status, error });
const HOUR = 3600000;

/* 화면에 보여 줄 현재 상태. /api/state 에 실려 나가므로 따로 묻지 않아도 된다. */
export function expedView(p, now) {
  if (!p || !p.expd_tier || !p.expd_end) return null;
  const T = CONST.EXPED[p.expd_tier];
  if (!T) return null;
  return { tier: p.expd_tier, level: p.expd_lv | 0, endsAt: p.expd_end, ready: now >= p.expd_end };
}

/* 보상. 받는 시점에 서버가 정한다 — 클라는 계산하지 않는다. */
function roll(tier, lv, rnd, uid) {
  const T = CONST.EXPED[tier];
  const h = T.h, L = Math.max(1, lv | 0);
  const out = { cr: Math.round(T.crH * h * L), sc: Math.round(T.scH * h * L), core: 0, part: null };
  if (rnd() < T.coreP) out.core = 1;
  if (T.partP && rnd() < T.partP) out.part = rollPart(L, rnd, uid());
  return out;
}

/* ── 보내기 ────────────────────────────────────────────── */
export async function sendExped(env, accountId, now, robotUid, tier) {
  const T = CONST.EXPED[tier];
  if (!T) return err(400, 'unknown expedition');

  const p = await env.DB.prepare(
    'SELECT rev, sel_robot, squad1, squad2, expd_end FROM player WHERE account_id = ?1')
    .bind(accountId).first();
  if (!p) return err(404, 'no player');
  if (p.expd_end) return err(400, 'expedition in progress');

  const rb = await env.DB.prepare('SELECT id, level FROM robot WHERE account_id = ?1 AND uid = ?2')
    .bind(accountId, robotUid).first();
  if (!rb) return err(404, 'robot not found');

  /* 편성에서 뺀다. 마지막 한 기를 보내 버리면 대전이 아예 막히므로,
     남은 기체 하나를 대신 편성에 넣어 준다. 넣을 것이 없으면 거절한다. */
  const squad = [p.squad1, p.squad2].filter(Boolean).filter(id => id !== rb.id);
  if (!squad.length) {
    const alt = await env.DB.prepare(
      'SELECT id FROM robot WHERE account_id = ?1 AND id != ?2 ORDER BY level DESC, id LIMIT 1')
      .bind(accountId, rb.id).first();
    if (!alt) return err(400, 'no robot left');
    squad.push(alt.id);
  }
  const sel = squad.includes(p.sel_robot) ? p.sel_robot : squad[0];
  const end = now + T.h * HOUR;

  await env.DB.prepare(
    `UPDATE player SET expd_robot = ?1, expd_tier = ?2, expd_lv = ?3, expd_end = ?4,
       squad1 = ?5, squad2 = ?6, sel_robot = ?7, pending_match = NULL,
       rev = ?8, updated_at = ?9 WHERE account_id = ?10`)
    .bind(rb.id, tier, rb.level, end, squad[0], squad[1] ?? null, sel, p.rev + 1, now, accountId).run();

  return { ok: true, rev: p.rev + 1, endsAt: end, tier, squadChanged: true };
}

/* ── 받기 ──────────────────────────────────────────────── */
export async function claimExped(env, accountId, now, rnd, uid) {
  const p = await env.DB.prepare(
    'SELECT rev, credits, cores, scrap, expd_tier, expd_lv, expd_end FROM player WHERE account_id = ?1')
    .bind(accountId).first();
  if (!p) return err(404, 'no player');
  if (!p.expd_end) return err(400, 'no expedition');
  /* 시간은 서버 것만 본다 */
  if (now < p.expd_end) return err(400, 'expedition not done');

  /* 귀환을 '선점'한다. 여러 번 눌러 요청이 겹치면 둘 다 보상을 굴려, 재화는 마지막 것만
     남고 **파츠 행은 두 개가 생긴다.** 조건부로 비워서 한 번만 통과시킨다.
     (전투의 pending_match 선점과 같은 방식이다 — server/battle.js 참고) */
  const claim = await env.DB.prepare(
    `UPDATE player SET expd_robot = NULL, expd_tier = NULL, expd_lv = NULL, expd_end = NULL
      WHERE account_id = ?1 AND expd_end = ?2`).bind(accountId, p.expd_end).run();
  if ((claim.meta?.changes ?? 0) !== 1) return err(409, 'expedition already claimed');

  const rw = roll(p.expd_tier, p.expd_lv, rnd, uid);
  const credits = p.credits + rw.cr, scrap = p.scrap + rw.sc, cores = p.cores + rw.core;
  const rev = p.rev + 1;

  const stmts = [];
  if (rw.part) stmts.push(insertPart(env.DB, accountId, rw.part, now, 0));
  /* 원정 칸은 위에서 이미 비웠다. 여기서는 재화와 rev 만 적는다. */
  stmts.push(env.DB.prepare(
    `UPDATE player SET credits = ?1, scrap = ?2, cores = ?3,
       rev = ?4, updated_at = ?5 WHERE account_id = ?6`)
    .bind(credits, scrap, cores, rev, now, accountId));
  await env.DB.batch(stmts);

  return { ok: true, rev, reward: rw, player: { credits, cores, scrap } };
}
