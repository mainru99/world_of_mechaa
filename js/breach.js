/* 돌파 — 점령전의 전투 규칙. 순수 함수. DOM 도 Math.random 도 쓰지 않는다.
 *
 * ── 왜 새 규칙이 필요했나 ────────────────────────────────
 * 오토배틀러에서 재미는 조작이 아니라 '내가 짠 것이 예상대로 굴러가는지 확인하는 것'에서
 * 나온다. 그래서 전투 **안**(턴 순서·판정·조작)은 한 글자도 건드리지 않았다.
 * 건드리면 그건 오토배틀러가 아니라 다른 장르가 된다.
 * 바꾼 것은 전투 **밖**의 규칙뿐이다. sim.js 는 그대로다.
 *
 * ── 규칙 ────────────────────────────────────────────────
 *   ① 한 칸 = 방어선 여러 겹. 전부 뚫어야 점령한다.
 *      (서머너즈워 길드 점령전: 거점 하나에 방어덱 여러 개, 전부 무너뜨려야 점령)
 *   ② **체력과 스킬 게이지가 다음 방어선으로 이어진다.** 중간 회복이 없다.
 *      그래서 목표가 '이기기'에서 '덜 깎이고 이기기'로 바뀐다. 이게 이 규칙의 핵심이다.
 *      (AFK 아레나 신비의 미궁)
 *   ③ 선봉이 쓰러지면 편성의 다음 기체가 **그 방어선의 남은 체력을 상대로** 이어받는다.
 *      둘 다 쓰러지면 실패다. 쓰러진 기체에는 큰 피로도가 남는다 — 이겨도 대가가 있다.
 *      (에픽세븐 길드전: 죽은 영웅은 그 길드전 동안 못 쓴다)
 *   ④ 실패해도 **깎아 둔 방어선은 남는다.** 시간이 지나면 스스로 회복한다.
 *      혼자여도 며칠에 걸쳐 큰 칸을 깰 수 있고, 무한정 미룰 수는 없다.
 *      (서머너즈워의 누적 + 비동기 웹게임의 타이머)
 *   ⑤ 칸마다 지형 보정이 **양쪽 모두에** 걸린다. 같은 몬스터라도 칸이 다르면 다르게 싸운다.
 *      (워게임의 지형 보정)
 *
 * ── 서버와 클라가 어긋나지 않는 이유 ────────────────────
 * 서버가 이 함수로 결과를 확정하고, 클라는 **같은 입력으로 같은 함수를** 돌려 재생만 한다.
 * 시드까지 서버가 준다. 그래서 화면과 결과가 갈릴 수 없다 — sim.js 와 같은 방식이다.
 * (전투마다 결과를 따로 내려보내지 않는 이유이기도 하다. 그러면 재생과 결과가 갈린다.)
 */
import { CONST, TERRAIN } from '../data/balance.js';
import { makeUnit, simulate, spreadOf } from './sim.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* 지형 보정. 양쪽 모두에 같은 규칙으로 건다.
   상한/하한은 stats.js 와 같은 값을 쓴다 — 회피 85%, 치명 95% 를 넘지 않는다. */
export function applyTerrain(st, terrain) {
  const T = TERRAIN[terrain];
  const o = { ...st };
  if (!T) return o;
  if (T.hp)   o.hp   = Math.max(1, Math.round(o.hp  * T.hp));
  if (T.atk)  o.atk  = Math.max(1, Math.round(o.atk * T.atk));
  if (T.def)  o.def  = Math.round(o.def * T.def);
  if (T.spd)  o.spd  = Math.max(1, o.spd * T.spd);
  if (T.crit) o.crit = clamp(o.crit * T.crit, 0, 0.95);
  if (T.eva)  o.eva  = clamp(o.eva  * T.eva , 0, 0.85);
  if (T.spreadAdd)
    o.spread = clamp((o.spread != null ? o.spread : CONST.SPREAD) + T.spreadAdd,
                     CONST.SPREAD_MIN, CONST.SPREAD_MAX);
  return o;
}

/* 깎아 둔 방어선은 시간이 지나면 되돌아온다.
   서버 시각으로만 계산한다 — 클라 시계를 믿으면 기다린 척할 수 있다. */
export function regenLines(hpLeft, hours) {
  const g = CONST.TERR.LINE_REGEN * Math.max(0, hours || 0);
  return (hpLeft || []).map(v => clamp((v == null ? 1 : v) + g, 0, 1));
}

/* 한 번의 돌파에서 나올 수 있는 전투 수의 상한.
   매 판마다 방어선이 하나 뚫리거나 내 기체가 하나 쓰러진다. 그래서 둘의 합을 넘지 않는다.
   서버가 시드를 몇 개 만들어야 하는지가 이 값이다. */
export const maxRounds = (nLines, nMechs) => nLines + Math.max(1, nMechs) - 1;

/* 돌파 한 번.
     mechs   [{ name, type, stats }]  편성 순서대로. stats 는 지형 보정까지 끝난 값
     lines   [{ name, type, stats }]  방어선 순서대로
     hpLeft  [0~1]                    방어선별 남은 체력 비율. 없으면 전부 1
     seeds   [uint32]                 서버가 만든 시드. maxRounds 개면 충분하다
   돌려주는 것:
     win     전 방어선을 뚫었는가
     rounds  판별 기록 — 클라는 이걸로 애니메이션을 재생한다
     hpLeft  이번 돌파가 끝난 뒤의 방어선 상태 (서버가 그대로 저장한다)
     downed  쓰러진 내 기체 수 (피로도가 여기에 붙는다)
     cleared 이번에 뚫은 방어선 수 (경험치가 여기에 붙는다) */
export function runBreach({ mechs, lines, seeds, hpLeft }) {
  const left = (lines || []).map((_, i) =>
    clamp(hpLeft && hpLeft[i] != null ? hpLeft[i] : 1, 0, 1));
  const rounds = [];
  const M = mechs || [];
  if (!M.length || !lines || !lines.length)
    return { win: false, rounds, hpLeft: left, downed: 0, cleared: 0, survivor: null };

  const mk = m => makeUnit(m.name, m.type, m.stats);
  let mi = 0, li = 0, si = 0, cleared = 0;
  let P = mk(M[0]), E = null;

  while (li < lines.length) {
    /* 이미 무너져 있는 방어선은 싸우지 않고 지나간다.
       (지난 시도에서 뚫어 두었고 아직 회복되지 않은 경우) */
    if (left[li] <= 0) { li++; E = null; continue; }
    if (si >= (seeds || []).length) break;          // 시드가 모자라면 멈춘다 — 있을 수 없다

    if (!E) {
      E = mk(lines[li]);
      E.hp = Math.max(1, Math.round(E.maxhp * left[li]));
    }
    const seed = seeds[si++] >>> 0;
    /* 재생에 필요한 '들어갈 때의 상태'를 먼저 적어 둔다. simulate 가 P·E 를 직접 바꾼다. */
    const rec = { mi, li, seed, pHp: P.hp, pSp: P.sp, eHp: E.hp, eSp: E.sp };
    const events = simulate(P, E, seed);
    /* 판이 끝난 뒤 방어선에 남은 체력. 승패는 아래처럼 end 이벤트로 읽지만,
       '얼마나 깎였나' 를 재려면 실제 체력이 필요하다(레이드가 이걸로 기여를 센다). */
    rec.eEnd = Math.max(0, E.hp);
    rec.eMax = E.maxhp;
    /* 승패는 체력이 아니라 end 이벤트로 읽는다. 600턴 안전장치에 걸리면
       양쪽이 살아 있는 채로 P 승이 되는데, 체력으로 판단하면 여기서 갈린다. */
    rec.win = events[events.length - 1].winner === 'P';
    rec.events = events;                            // 서버는 쓰지 않는다. 클라가 재생에 쓴다
    rounds.push(rec);

    if (rec.win) { left[li] = 0; cleared++; li++; E = null; }
    else {
      left[li] = clamp(E.hp / E.maxhp, 0, 1);       // 깎아 둔 만큼은 남는다
      mi++;
      if (mi >= M.length) return {
        win: false, rounds, hpLeft: left, downed: M.length, cleared, survivor: null };
      P = mk(M[mi]);
    }
  }
  return { win: li >= lines.length, rounds, hpLeft: left,
           downed: mi, cleared, survivor: { idx: mi, hp: P.hp, maxhp: P.maxhp } };
}

/* 화면에 '이 기체로 갈 수 있는가'를 보여 주기 위한 것. 서버도 같은 함수로 막는다. */
const RANK = { C: 0, UC: 1, R: 2, UQ: 3, EP: 4, BOSS: 5 };
export const rarAllowed = (rar, maxRar) =>
  !maxRar || (RANK[rar] ?? 0) <= (RANK[maxRar] ?? 5);

/* 지형이 spread 를 건드리므로, 스냅샷에 spread 가 없는 옛 아레나 등록분도 채워 준다. */
export const withSpread = (st, type) =>
  st.spread != null ? st : { ...st, spread: spreadOf(type) };

/* 도감용 — 돌파 한 번에서 **몬스터가 지키던** 방어선을 [{type, win}] 로.
   닿은 방어선마다 한 번 만났고, 뚫었으면 처치다. 한 방어선을 기체 둘이 번갈아 쳐도 한 번이다.
   사람의 기체가 지키는 방어선(점령한 칸)은 kind 가 monster 가 아니라서 빠진다. */
export function codexLines(lines, rounds) {
  const out = new Map();
  for (const x of rounds || []) {
    const L = lines[x.li];
    if (!L || (L.kind && L.kind !== 'monster')) continue;
    const o = out.get(x.li) || { type: L.type, win: false };
    if (x.win) o.win = true;
    out.set(x.li, o);
  }
  return [...out.values()];
}
