/* 상점 · 기체 조각 · 보관함 — 규칙. (2026-09-18 사용자 지시)
 *
 * **서버와 화면이 같이 쓴다.** DOM 을 쓰지 않는다. 값은 CONST.SHOP · CONST.SHARD_NEED.
 *
 * ── 진열은 저장하지 않고 다시 굴린다 ─────────────────────
 * 진열 = f(계정, 주기 번호, 새로 굴린 횟수, 레벨). 같은 넷이면 누가 굴려도 같은 진열이다.
 * 그래서 player.shop 에는 **작은 상태만** 둔다 — 진열 여섯 칸을 통째로 두지 않는다.
 *   p   주기 번호 — 지금과 다르면 새 주기다(굴린 횟수·산 칸이 비고, 레벨을 새로 잡는다)
 *   n   이번 주기에 새로 굴린 횟수
 *   lv  이번 주기 진열을 굴린 레벨 — 주기 중간에 레벨이 올라도 진열이 안 바뀌게 묶어 둔다
 *   b   산 칸 번호들
 *
 * ── 보관함 (player.items, JSON) ────────────────────────────
 *   { '<종류>:<id>': 개수 }. 지금은 기체 조각(shard:<기체id>)만 들어간다.
 *   **나중에 아이템이 늘면 같은 칸에 새 종류 접두어로 넣는다** — 표를 바꾸지 않아도 된다. */
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { mulberry32 } from './sim.js';
import { rollPart } from './gacha.js';

const SH = () => CONST.SHOP;
export const PERIOD_MS = () => (SH().periodH || 6) * 3600 * 1000;
export const periodOf = now => Math.floor(now / PERIOD_MS());
export const periodEnd = p => (p + 1) * PERIOD_MS();
export const priceMult = lv => +(SH().lv.base + SH().lv.per * Math.max(1, lv | 0)).toFixed(2);
export const refreshCost = (n, lv) => Math.round(SH().refresh.cr * ((n | 0) + 1) * priceMult(lv));
export const shardNeed = type => (CONST.SHARD_NEED || {})[(ROBOT_TYPES[type] || {}).rarity] || 0;
export const shardKey = type => 'shard:' + type;

/* 문자열 → 늘 같은 모양 */
export function parseItems(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = null; } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  const out = {};
  for (const [k, v] of Object.entries(o)) if ((v | 0) > 0) out[k] = v | 0;
  return out;
}
/* 저장된 상점 상태 → 지금 주기 기준 상태. 주기가 바뀌었으면 새로 시작한다(레벨을 새로 잡는다). */
export function shopState(raw, now, curLv) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { o = null; } }
  const p = periodOf(now);
  if (!o || typeof o !== 'object' || o.p !== p) return { p, n: 0, lv: Math.max(1, curLv | 0), b: [] };
  return { p, n: o.n | 0, lv: Math.max(1, o.lv | 0), b: Array.isArray(o.b) ? o.b.map(x => x | 0) : [] };
}

function seedOf(acc, p, n) {
  let h = 2166136261 >>> 0;
  for (const c of `${acc}:${p}:${n}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
const pickW = (obj, rnd, keys) => {
  const ks = keys || Object.keys(obj);
  const tot = ks.reduce((s, k) => s + (typeof obj[k] === 'number' ? obj[k] : obj[k].w), 0);
  let x = rnd() * tot;
  for (const k of ks) { x -= typeof obj[k] === 'number' ? obj[k] : obj[k].w; if (x < 0) return k; }
  return ks[ks.length - 1];
};
const ri = (a, b, rnd) => a + Math.floor(rnd() * (b - a + 1));
const ROBOTS_BY_RAR = {};
for (const [id, t] of Object.entries(ROBOT_TYPES)) (ROBOTS_BY_RAR[t.rarity] ||= []).push(id);
for (const k in ROBOTS_BY_RAR) ROBOTS_BY_RAR[k].sort();

/* 진열 여섯 칸. 칸마다 { i, kind, rarity?, type?, qty, price, part? } */
export function rollShop(acc, st) {
  const S = SH(), rnd = mulberry32(seedOf(acc, st.p, st.n)), m = priceMult(st.lv);
  const out = [];
  for (let i = 0; i < S.slots; i++) {
    const kind = pickW(S.kind, rnd);
    if (kind === 'part') {
      const rar = pickW(S.part, rnd, ['C', 'R', 'SR', 'SSR']);
      /* 파츠 uid 는 진열 자리로 정한다 — 같은 계정 안에서 겹치지 않는다(주기·횟수·칸이 다 들어간다) */
      const part = rollPart(st.lv, rnd, `sh${st.p.toString(36)}-${st.n}-${i}`, rar);
      out.push({ i, kind, rarity: rar, qty: 1, price: Math.round(S.part[rar].cr * m), part });
    } else if (kind === 'shard') {
      const rar = pickW(S.shard, rnd, ['C', 'UC', 'R', 'UQ', 'EP']);
      const list = ROBOTS_BY_RAR[rar] || ROBOTS_BY_RAR.C;
      const type = list[Math.floor(rnd() * list.length)];
      const qty = ri(S.shard.qty[0], S.shard.qty[1], rnd);
      out.push({ i, kind, rarity: rar, type, qty, price: Math.round(S.shard[rar].cr * qty * m) });
    } else if (kind === 'scrap') {
      const qty = ri(S.scrap.qty[0], S.scrap.qty[1], rnd);
      out.push({ i, kind, qty, price: Math.round(S.scrap.cr * qty * m) });
    } else {
      out.push({ i, kind: 'core', qty: S.core.qty, price: Math.round(S.core.cr * S.core.qty * m) });
    }
  }
  return out;
}

/* 칸의 서명 — 사려는 순간 화면이 본 것과 서버가 굴린 것이 같은지 본다.
   (레벨이 올라 새 주기의 진열이 달라졌는데 옛 화면으로 누르는 경우를 막는다) */
export const slotSig = x => `${x.i}|${x.kind}|${x.rarity || ''}|${x.type || (x.part && x.part.base) || ''}|${x.qty}|${x.price}`;

/* 보관함 한 장 — 조각을 기체별로. 모은 수·필요한 수·조립 가능 여부·이미 가졌는지. */
export function bagView(items, ownedTypes) {
  const own = new Set(ownedTypes || []);
  return Object.entries(items || {})
    .filter(([k, v]) => k.startsWith('shard:') && v > 0 && ROBOT_TYPES[k.slice(6)])
    .map(([k, v]) => { const type = k.slice(6), need = shardNeed(type);
      return { key: k, kind: 'shard', type, rarity: ROBOT_TYPES[type].rarity, have: v, need,
               ready: v >= need, owned: own.has(type) }; })
    .sort((a, b) => (b.ready - a.ready) || (b.have / b.need - a.have / a.need));
}
