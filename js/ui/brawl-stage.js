/* 난투 재생 무대 — 4 대 4 를 카드 판이 아니라 **무대 위에서** 재생한다. (2026-10-08 · 사용자 결정)
 *
 * 1:1 대전 · 합동전과 같은 연출 층을 쓴다 — 타격감(battle-fx: 예비 동작 · 사격 · 히트스톱 · 불꽃 · 숫자 · 격파)과
 * 공격 모션(motion.js: 76기 7가지 공격 종류 · 그림이 없으면 코드 대체 연출). 판정은 서버 사건(fight.events) 그대로 — 두 번째 시뮬이 아니다.
 * 상태(내구 · 기록)는 brawl-replay.js 의 reducer 가 계속 맡는다(onEvent). 이 파일은 그리기만 한다.
 *
 * 칸 열쇠 — 아군 'p0'~'p3', 상대 'e0'~'e3'. 0 · 1 전위 · 2 · 3 후위(엔진 board 번호 그대로, 빈칸 유지).
 * 배치가 보이게 — 전위는 가운데 가까이, 후위는 뒤에. 후위가 상대 후위를 치면 '후위 저격', 전위가 다 쓰러지면 '전위 붕괴' 를 띄운다
 * (난투의 재미는 배치 · 시너지 결정 — 그 결정이 먹힌 순간을 크게 보여 준다). */
import { createBattleFx, shotCat, leadOf } from './battle-fx.js';
import { createMotion } from '../motion.js';
import { COMBAT_TYPES } from '../units.js';

/* 시각표 — js/game.js battleTimeline 과 같은 규칙(행동 사이 평균 TL.gap, 한 행동 안은 짧게). 4 대 4 라 행동이 많아 간격을 조금 줄인다 */
const TL = { gap: 380, min: 36, step: { start: 0, turn: 60, skill: 420, hit: 160, heal: 110, shield: 110, mark: 90, jam: 140, parry: 240, down: 240, heat: 320 } };
export function brawlTimeline(events) {
  const ats = events.filter(e => e.t === 'turn' && e.at != null).map(e => e.at);
  const avg = ats.length > 1 ? (ats[ats.length - 1] - ats[0]) / (ats.length - 1) : 0;
  const scale = avg > 0 ? TL.gap / avg : 0, t0 = ats.length ? ats[0] : 0;
  const out = []; let base = 0, off = 0, prev = -Infinity, n = 0;
  for (const e of events) {
    if (e.t === 'turn') { base = (e.at != null && scale) ? (e.at - t0) * scale : (n++ ? Math.max(prev + TL.min, base + TL.gap) : 0); off = 0; }
    const t = Math.max(base + off, prev + TL.min);
    off += TL.step[e.t] != null ? TL.step[e.t] : 80;
    out.push(t); prev = t;
  }
  return out;
}

const key = (side, i) => (side === 'P' ? 'p' : 'e') + (i | 0);

/* opts: speed() · active() · skip() · onEvent(e) — 상태 reducer · 소리 · 기록 갱신. 끝까지 가면 'end' 사건의 winner, 멈추면 null */
export async function playBrawlStage(stage, fight, opts = {}) {
  const speed = opts.speed || (() => 1), active = opts.active || (() => true), skip = opts.skip || (() => false);
  const stopped = () => !active() || !stage.isConnected || skip();
  const juice = createBattleFx(stage, { speed });
  if (!juice) return null;                                           // 움직임 줄이기 — 부른 쪽이 옛 재생(글자 판)으로 돈다
  const motion = createMotion(stage, { speed });
  const team = { P: fight.me.team, E: fight.opponent.team };
  const unit = (side, i) => team[side][i | 0];
  const maxOf = k => { const u = unit(k[0] === 'p' ? 'P' : 'E', +k.slice(1)); return u ? u.stats.hp : 1; };
  const typeOf = k => { const u = unit(k[0] === 'p' ? 'P' : 'E', +k.slice(1)); return u ? u.type : null; };
  const fill = (k, hp) => { const i = stage.querySelector('#hp-' + k + ' > i'); if (i) i.style.width = Math.max(0, Math.min(100, hp / maxOf(k) * 100)) + '%'; };
  const keys = [];
  for (const side of ['P', 'E']) team[side].forEach((u, i) => { if (u) { const k = key(side, i); keys.push(k); juice.hp(k, u.stats.hp, u.stats.hp, true); fill(k, u.stats.hp); } });

  const events = fight.events || [], tl = brawlTimeline(events);
  /* 미리 준비 — 각 행동의 첫 타를 시각표보다 먼저 건다(근접은 움츠렸다 돌진, 원거리는 겨눔 + 비행). game.js planBattleFx 와 같은 규칙, 칸 열쇠만 넷씩 */
  const pre = new Set();
  events.forEach((e, ix) => {
    if (e.t !== 'turn') return;
    let j = -1;
    for (let n = ix + 1; n < events.length; n++) { const t = events[n].t; if (t === 'turn' || t === 'end') break; if (t === 'hit' || t === 'parry') { j = n; break; } }
    if (j < 0) return;
    const x = events[j], aSide = x.t === 'hit' ? x.side : x.dside, aI = x.t === 'hit' ? x.i : x.di;
    if (aSide !== e.side || aI !== e.i) return;
    const aK = key(aSide, aI), dK = x.t === 'hit' ? key(x.dside, x.di) : key(x.side, x.i), type = typeOf(aK);
    if (!type) return;
    pre.add(j);
    const miss = x.t === 'hit' && !!x.miss, crit = x.t === 'hit' && !!x.crit, low = x.t === 'hit' && x.thp < maxOf(dK) * .35;
    juice.plan(tl[j], leadOf(type), () => juice.fire(aK, dK, type, miss, () => motion.hit({ a: aK, d: dK, type, miss, crit, low })));
  });

  const downs = { P: new Set(), E: new Set() }, sniped = new Set();
  const front = side => [0, 1].filter(i => unit(side, i));
  try {
    juice.intro(keys, [opts.names?.P || '우리 부대', opts.names?.E || '상대']);
    for (let ix = 0; ix < events.length; ix++) {
      const e = events[ix];
      if (e.t !== 'end') await juice.until(tl[ix], stopped);
      if (stopped()) return null;
      opts.onEvent?.(e);
      if (e.t === 'turn') { juice.turn(key(e.side, e.i)); continue; }
      if (e.t === 'skill') { const k = key(e.side, e.i), ty = typeOf(k); juice.skill(k, COMBAT_TYPES[ty]?.skill?.fx, e.name); if (ty) motion.skill(k, ty); continue; }
      if (e.t === 'heal') { const k = key(e.side, e.i); juice.heal(k, e.amt, e.src, null); juice.hp(k, e.hp, maxOf(k)); fill(k, e.hp); continue; }
      if (e.t === 'shield') { juice.shield(key(e.side, e.i), e.amt, e.now); continue; }
      if (e.t === 'mark') { if (e.dside != null) juice.mark(key(e.dside, e.di)); continue; }
      if (e.t === 'jam') { if (e.dside != null) juice.jam(key(e.dside, e.di)); continue; }
      if (e.t === 'parry') {
        const pK = key(e.side, e.i), aK = key(e.dside, e.di);
        juice.parry(pK, aK, typeOf(aK), pre.has(ix));
        continue;
      }
      if (e.t === 'hit') {
        const aK = key(e.side, e.i), dK = key(e.dside, e.di), type = typeOf(aK);
        if (!pre.has(ix) && type) { juice.quick(aK, dK, type, !!e.miss); motion.hit({ a: aK, d: dK, type, miss: !!e.miss, crit: !!e.crit, low: e.thp < maxOf(dK) * .35 }); }
        juice.impact(aK, dK, e, { maxhp: maxOf(dK), kind: type ? shotCat(type) : null });
        if (!e.miss) fill(dK, e.thp);
        /* 배치가 먹힌 순간 — 후위가 상대 후위를 맞히면 */
        if (!e.miss && e.i >= 2 && e.di >= 2 && !sniped.has(aK)) { sniped.add(aK); juice.banner('후위 저격', aK); }   // 기체마다 처음 한 번만
        continue;
      }
      if (e.t === 'heat') { for (const h of e.hits || []) { const k = key(h.side, h.i); juice.hp(k, h.thp, maxOf(k)); fill(k, h.thp); } juice.banner(`과열 ${e.n}단계`, 'p'); continue; }
      if (e.t === 'down') {
        const k = key(e.side, e.i), el = stage.querySelector('#fighter-' + k); if (el) el.classList.add('down');
        downs[e.side].add(e.i);
        const f = front(e.side);
        if (e.i < 2 && f.length && f.every(i => downs[e.side].has(i)) && [2, 3].some(i => unit(e.side, i) && !downs[e.side].has(i)))
          juice.banner(e.side === 'P' ? '전위 붕괴 — 후위 노출' : '적 전위 붕괴!', e.side === 'P' ? 'e' : 'p');
        continue;
      }
      if (e.t === 'end') {
        await juice.until(tl[ix], stopped);
        if (stopped()) return null;
        const alive = side => team[side].findIndex((u, i) => u && !downs[side].has(i));
        const wi = alive(e.winner);
        juice.finish(e.winner === 'P', wi >= 0 ? key(e.winner, wi) : null);
        await juice.wait(1100, stopped);
        return stopped() ? null : e.winner;
      }
    }
    return null;
  } finally { juice.dispose(); motion.dispose(); }
}
