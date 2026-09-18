/* 도감 — 몬스터 기록 · 보상 받기 · 칭호 달기.
 *
 * 기체·파츠 기록은 여기 없다. DB 트리거가 한다(migrations/018_codex.sql).
 * 몬스터는 전투가 행을 만들지 않아 트리거로 못 잡으므로, 전투를 정산하는 곳이
 * `codexMonsterStmt` 를 batch 에 한 줄 더 얹는다(대전·토벌·전선·점령·시련·레이드).
 *
 * 규칙(무엇이 채워졌고 무엇을 받을 수 있나)은 js/codex.js 한 곳에 있다. 화면과 같은 함수다. */
import { tallyMonsters, codexView, codexRewards, codexTitles, codexActivatable, parseCodex } from '../js/codex.js';

/* 몬스터 전투 기록 한 문장. list = [{ type, win }]. 적을 것이 없으면 null.
   **읽지 않고 쓴다** — json_set 이 지금 값에 더한다. 같은 판을 두 요청이 동시에 적어도
   D1 은 문장 하나가 원자적이라 셈이 빠지지 않는다.
   몬스터 id 는 MONSTER_TYPES 에 있는 것만 통과한다(tallyMonsters) — 경로에 들어가는 글자라서다. */
export function codexMonsterStmt(db, accountId, list) {
  const t = tallyMonsters(list);
  const ids = Object.keys(t);
  if (!ids.length) return null;
  const args = [], parts = [];
  let k = 1;
  for (const id of ids) {
    const ms = `'$.ms.${id}'`, mk = `'$.mk.${id}'`;
    parts.push(`${ms}, COALESCE(json_extract(codex, ${ms}), 0) + ?${k}`); args.push(t[id].seen); k++;
    if (t[id].kills) { parts.push(`${mk}, COALESCE(json_extract(codex, ${mk}), 0) + ?${k}`); args.push(t[id].kills); k++; }
  }
  args.push(accountId);
  return db.prepare(
    `UPDATE player SET codex = json_set(COALESCE(codex, '{}'), ${parts.join(', ')}) WHERE account_id = ?${k}`)
    .bind(...args);
}

async function load(env, acc) {
  const p = await env.DB.prepare(
    'SELECT codex, credits, cores, scrap, rev FROM player WHERE account_id = ?1').bind(acc).first();
  if (!p) return null;
  const robots = (await env.DB.prepare('SELECT type FROM robot WHERE account_id = ?1')
    .bind(acc).all()).results || [];
  const parts = (await env.DB.prepare('SELECT base, rarity FROM part WHERE account_id = ?1 AND base IS NOT NULL')
    .bind(acc).all()).results || [];
  return { p, view: codexView(p.codex, robots, parts) };
}

/* GET — 도감 원본만. 행 하나를 읽는다. 기체·파츠는 화면이 이미 들고 있다. */
export async function codexGet(env, acc) {
  const p = await env.DB.prepare('SELECT codex FROM player WHERE account_id = ?1').bind(acc).first();
  if (!p) return { ok: false, status: 404, error: 'no player' };
  return { ok: true, codex: parseCodex(p.codex) };
}

const err = (status, error, extra) => ({ ok: false, status, error, ...(extra || {}) });

/* POST /api/codex  { action: 'activate', keys: [칸키…] | 'all' }  모은 칸을 재화를 내고 켠다
                    { action: 'claim' }                          넘은 이정표의 환급 + 칭호
                    { action: 'title', id: 키|null }              칭호를 단다(null 이면 뗀다)

   세 가지 모두 '읽을 때의 도감 그대로' 를 조건으로 건다(낙관적 잠금). 두 번 눌러 요청이 둘 와도
   둘째는 도감이 이미 바뀌어 changes=0 이 되고, 재화가 두 번 움직이지 않는다.
   그 사이 전투가 몬스터를 적어도 마찬가지로 0 이 된다 — 그때는 다시 누르면 된다.
   도감에 적는 것은 **JSON 하나로 묶어 json_patch** 한다. 키마다 인자를 쓰면 오래 한 계정은
   한 번에 100칸이 넘어 D1 의 바인딩 한도(100)와 SQLite 함수 인자 한도(127)에 걸린다. */
export async function codexRun(env, acc, now, body) {
  const a = body && body.action;
  const L = await load(env, acc);
  if (!L) return err(404, 'no player');

  if (a === 'activate') {
    const keys = body.keys === 'all' ? null
      : Array.isArray(body.keys) ? body.keys.slice(0, 200).map(String) : [];
    if (keys && !keys.length) return err(400, 'no keys');
    const act = codexActivatable(L.view, keys);
    if (!act.list.length) return err(400, 'nothing to activate');
    if (L.p.credits < act.total.cr || L.p.cores < act.total.co)
      return err(400, 'not enough', { need: act.total, have: { cr: L.p.credits, co: L.p.cores } });
    const patch = JSON.stringify({ a: Object.fromEntries(act.list.map(x => [x.key, 1])) });
    const res = await env.DB.prepare(
      `UPDATE player SET codex = json_patch(COALESCE(codex, '{}'), ?1),
              credits = credits - ?2, cores = cores - ?3, rev = rev + 1, updated_at = ?4
        WHERE account_id = ?5 AND codex IS ?6 AND credits >= ?2 AND cores >= ?3`)
      .bind(patch, act.total.cr, act.total.co, now, acc, L.p.codex).run();
    if ((res.meta?.changes ?? 0) !== 1) return err(409, 'codex changed, retry');
    return { ok: true, activated: act.list.map(x => x.key), spent: act.total,
             credits: L.p.credits - act.total.cr, cores: L.p.cores - act.total.co, rev: L.p.rev + 1 };
  }

  if (a === 'claim') {
    const due = codexRewards(L.view);
    if (!due.items.length) return err(400, 'nothing to claim');
    const patch = JSON.stringify({ c: Object.fromEntries(due.items.map(x => [x.key, 1])),
                                   rf: Object.fromEntries(due.refundKeys.map(k => [k, 1])) });
    const res = await env.DB.prepare(
      `UPDATE player SET codex = json_patch(COALESCE(codex, '{}'), ?5),
              credits = credits + ?1, cores = cores + ?2, rev = rev + 1, updated_at = ?3
        WHERE account_id = ?4 AND codex IS ?6`)
      .bind(due.total.cr, due.total.co, now, acc, patch, L.p.codex).run();
    if ((res.meta?.changes ?? 0) !== 1) return err(409, 'codex changed, retry');
    return { ok: true, claimed: due.items, refunded: due.refundKeys.length, total: due.total,
             credits: L.p.credits + due.total.cr, cores: L.p.cores + due.total.co, rev: L.p.rev + 1 };
  }

  if (a === 'title') {
    const id = body.id == null || body.id === '' ? null : String(body.id);
    if (id) {
      const t = codexTitles(L.view).find(x => x.id === id);
      if (!t) return err(400, 'unknown title');
      if (!t.got) return err(400, 'title locked');
    }
    await env.DB.prepare(
      `UPDATE player SET codex = json_set(COALESCE(codex, '{}'), '$.t', ?1), updated_at = ?2 WHERE account_id = ?3`)
      .bind(id, now, acc).run();
    return { ok: true, title: id };
  }

  return err(400, 'unknown action');
}
