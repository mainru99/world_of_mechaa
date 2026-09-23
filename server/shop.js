/* 상점 · 기체 조각 조립 — 서버 판정.
 *
 * 규칙(진열·값·조각 수)은 js/shop.js 에 있다. 여기서는 **행을 읽고 쓰는 일**만 한다.
 * 진열은 저장하지 않는다 — 계정·주기·횟수·레벨로 다시 굴리면 같은 것이 나온다.
 *
 * 쓰는 문장은 전부 '읽을 때의 값 그대로' 를 조건으로 건다(낙관적 잠금).
 * 두 번 눌러 요청이 둘 와도 둘째는 상태가 이미 바뀌어 0행이 되고, 두 번 사지 않는다. */
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { periodEnd, refreshCost, shardNeed, shardKey, parseItems, shopState, rollShop, slotSig, bagView } from '../js/shop.js';
import { insertPart } from './parts.js';
import { canDevelop } from '../js/lineage.js';

const err = (status, error, extra) => ({ ok: false, status, error, ...(extra || {}) });

async function load(env, acc) {
  const p = await env.DB.prepare(
    'SELECT credits, cores, scrap, items, shop, rev FROM player WHERE account_id = ?1').bind(acc).first();
  if (!p) return null;
  const robots = (await env.DB.prepare('SELECT type, level FROM robot WHERE account_id = ?1')
    .bind(acc).all()).results || [];
  /* 레벨은 뽑기(server/pull.js)와 같은 자 — 가진 기체 중 가장 높은 레벨 */
  const level = Math.max(1, ...robots.map(r => r.level | 0));
  return { p, level, owned: robots.map(r => r.type) };
}

function view(acc, L, now) {
  const st = shopState(L.p.shop, now, L.level);
  const items = parseItems(L.p.items);
  return {
    ok: true, server_now: now, endsAt: periodEnd(st.p),
    stock: rollShop(acc, st).map(x => ({ ...x, sold: st.b.includes(x.i), sig: slotSig(x) })),
    refresh: refreshCost(st.n, st.lv), refreshed: st.n, lv: st.lv,
    items, bag: bagView(items, L.owned),
    credits: L.p.credits, cores: L.p.cores, scrap: L.p.scrap,
  };
}

export async function shopView(env, acc, now) {
  const L = await load(env, acc);
  if (!L) return err(404, 'no player');
  return view(acc, L, now);
}

/* POST /api/shop  { action: 'buy', slot, sig }   진열 한 칸을 산다
                   { action: 'refresh' }          크레딧을 내고 진열을 새로 굴린다
                   { action: 'assemble', type }   조각을 모아 기체를 조립한다 */
export async function shopRun(env, acc, now, body) {
  const a = body && body.action;
  const L = await load(env, acc);
  if (!L) return err(404, 'no player');
  const st = shopState(L.p.shop, now, L.level);
  const stJson = s => JSON.stringify({ p: s.p, n: s.n, lv: s.lv, b: s.b });
  /* 조건 — 상점 상태와 보관함이 읽을 때 그대로일 것 */
  const guard = `account_id = ?1 AND shop IS ?2 AND items IS ?3`;

  if (a === 'buy') {
    const stock = rollShop(acc, st);
    const x = stock.find(s => s.i === (body.slot | 0));
    if (!x) return err(400, 'no such slot');
    if (st.b.includes(x.i)) return err(400, 'sold out');
    /* 화면이 본 칸과 다르면 사지 않는다 — 주기가 넘어가 진열이 바뀐 뒤 옛 화면으로 누른 경우다 */
    if (body.sig && body.sig !== slotSig(x)) return err(409, 'stock changed');
    if (L.p.credits < x.price) return err(400, 'not enough credits', { need: x.price, have: L.p.credits });

    const next = { ...st, b: [...st.b, x.i] };
    const items = parseItems(L.p.items);
    let dCores = 0, dScrap = 0;
    if (x.kind === 'shard') items[shardKey(x.type)] = (items[shardKey(x.type)] | 0) + x.qty;
    else if (x.kind === 'scrap') dScrap = x.qty;
    else if (x.kind === 'core') dCores = x.qty;

    const res = await env.DB.prepare(
      `UPDATE player SET shop = ?4, items = ?5, credits = credits - ?6, cores = cores + ?7, scrap = scrap + ?8,
              rev = rev + 1, updated_at = ?9
        WHERE ${guard} AND credits >= ?6`)
      .bind(acc, L.p.shop, L.p.items, stJson(next), JSON.stringify(items), x.price, dCores, dScrap, now).run();
    if ((res.meta?.changes ?? 0) !== 1) return err(409, 'shop changed, retry');
    /* 파츠는 행을 따로 만든다(도감 트리거가 이 INSERT 를 본다). 값은 위에서 이미 치렀다 —
       순서를 바꾸면 값을 안 치르고 파츠만 생기는 틈이 생긴다. */
    if (x.kind === 'part') await insertPart(env.DB, acc, x.part, now, 0).run();
    const after = { ...L, p: { ...L.p, credits: L.p.credits - x.price, cores: L.p.cores + dCores,
                              scrap: L.p.scrap + dScrap, shop: stJson(next), items: JSON.stringify(items),
                              rev: L.p.rev + 1 } };
    return { ...view(acc, after, now), bought: x, rev: L.p.rev + 1 };
  }

  if (a === 'refresh') {
    const cost = refreshCost(st.n, st.lv);
    if (L.p.credits < cost) return err(400, 'not enough credits', { need: cost, have: L.p.credits });
    const next = { ...st, n: st.n + 1, b: [] };
    const res = await env.DB.prepare(
      `UPDATE player SET shop = ?4, credits = credits - ?5, rev = rev + 1, updated_at = ?6
        WHERE ${guard} AND credits >= ?5`)
      .bind(acc, L.p.shop, L.p.items, stJson(next), cost, now).run();
    if ((res.meta?.changes ?? 0) !== 1) return err(409, 'shop changed, retry');
    const after = { ...L, p: { ...L.p, credits: L.p.credits - cost, shop: stJson(next), rev: L.p.rev + 1 } };
    return { ...view(acc, after, now), spent: cost, rev: L.p.rev + 1 };
  }

  if (a === 'assemble') {
    const type = String(body.type || '');
    if (!ROBOT_TYPES[type]) return err(400, 'unknown robot');
    const need = shardNeed(type), items = parseItems(L.p.items), have = items[shardKey(type)] | 0;
    if (!need || have < need) return err(400, 'not enough shards', { need, have });
    /* 개발 계보(2026-09-23) — 앞 기체를 다 가져야 조립한다. **스위치가 꺼져 있으면 보지 않는다**
       (CONST.LINEAGE.gate). 계보도 화면이 UI 개편에서 나올 때 켠다 — 이유를 보여 줄 화면 없이 막으면 고장처럼 보인다 */
    if (CONST.LINEAGE && CONST.LINEAGE.gate) {
      const dv = canDevelop(type, L.owned);
      if (!dv.ok) return err(400, 'lineage locked', { why: dv.why, need: dv.need });
    }
    items[shardKey(type)] = have - need;
    if (!items[shardKey(type)]) delete items[shardKey(type)];

    /* 이미 가진 기체면 뽑기와 같이 자원으로 바뀐다(CONST.DUPE_GAIN). 조각이 헛되지 않는다. */
    const dupe = L.owned.includes(type);
    const g = dupe ? (CONST.DUPE_GAIN[ROBOT_TYPES[type].rarity] || { cr: 0, sc: 0, co: 0 }) : { cr: 0, sc: 0, co: 0 };
    const uid = 'r' + now.toString(36) + 'a';
    const stmts = [env.DB.prepare(
      `UPDATE player SET items = ?4, credits = credits + ?5, scrap = scrap + ?6, cores = cores + ?7,
              rev = rev + 1, updated_at = ?8
        WHERE ${guard}`)
      .bind(acc, L.p.shop, L.p.items, JSON.stringify(items), g.cr, g.sc, g.co, now)];
    const res = await stmts[0].run();
    if ((res.meta?.changes ?? 0) !== 1) return err(409, 'shop changed, retry');
    if (!dupe) await env.DB.prepare(
      'INSERT INTO robot (account_id, uid, type, level, exp, fat, fat_at, created_at) VALUES (?1,?2,?3,1,0,0,?4,?4)')
      .bind(acc, uid, type, now).run();
    const after = { ...L, owned: dupe ? L.owned : [...L.owned, type],
                    p: { ...L.p, items: JSON.stringify(items), credits: L.p.credits + g.cr,
                         scrap: L.p.scrap + g.sc, cores: L.p.cores + g.co, rev: L.p.rev + 1 } };
    return { ...view(acc, after, now), assembled: { type, uid: dupe ? null : uid, dupe, gain: dupe ? g : null },
             rev: L.p.rev + 1 };
  }

  return err(400, 'unknown action');
}
