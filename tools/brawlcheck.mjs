/* 난투 팀전 엔진 자가 점검 — js/brawl-sim.js (2026-10-07 · 계획 ①)
 *
 *   ① 결정적 — 같은 입력 · 같은 시드면 사건이 한 글자도 같다
 *   ② 자리 — 앞줄이 서 있는 동안 뒷줄은 공격을 받지 않는다 · 뒷줄 공격력 배수
 *   ③ 지원 — 방벽 · 수리는 자기 편에게만 간다
 *   ④ 모양 — 빈칸 · 1 : 1 · 2 : 3 이 돈다 · end 사건이 맞다(이긴 쪽이 살아 있다)
 *   ⑤ 과열 — 시간이 길어지면 양쪽을 깎아 반드시 끝난다
 *   ⑥ 판의 모양(참고 · 판정 없음) — 무작위 4 : 4 의 길이 · 역전 비율
 *
 * node --no-warnings tools/brawlcheck.mjs */
import { ROBOT_TYPES, CONST } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { mulberry32 } from '../js/sim.js';
import { runBrawl, makeSide } from '../js/brawl-sim.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const E0 = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const ids = Object.keys(ROBOT_TYPES).filter(t => !ROBOT_TYPES[t].story);
const unit = t => ({ name: ROBOT_TYPES[t].name, type: t, stats: computeStats({ type: t, level: 30, skillLv: 0, fat: 0, slots: E0 }, []), tactic: 'none' });
const r = mulberry32(2026), pick = () => ids[Math.floor(r() * ids.length)];
const team = n => Array.from({ length: n }, () => unit(pick()));

console.log('== ① 결정적 ==');
{
  const p = team(4), e = team(4);
  const a = JSON.stringify(runBrawl({ p, e, seed: 99 }).events), b = JSON.stringify(runBrawl({ p, e, seed: 99 }).events);
  const c = JSON.stringify(runBrawl({ p, e, seed: 100 }).events);
  ok(a === b, '같은 시드 → 같은 사건');
  ok(a !== c, '다른 시드 → 다른 판');
}

console.log('\n== ② 자리 ==');
{
  let broken = 0, total = 0;
  for (let n = 0; n < 400; n++) {
    const res = runBrawl({ p: team(4), e: team(4), seed: n * 7919 + 3 });
    const live = { P: [1, 1, 1, 1], E: [1, 1, 1, 1] };
    /* 쓰러짐은 **맞은 직후 체력 0** 으로 본다 — down 사건은 행동이 끝난 뒤에 남아서, 연타 도중 앞줄이 쓰러지면
       다음 타가 뒷줄로 가는 것이 정상인데 down 만 보면 위반처럼 보인다. 회피 반격(counter)은 때린 상대를 되치는 것이라 뺀다 */
    for (const x of res.events) {
      if (x.t === 'hit' && !x.miss && !x.counter) {
        total++;
        const side = live[x.dside];
        if (x.di >= 2 && (side[0] || side[1])) broken++;
      }
      if (x.t === 'hit' && !x.miss && x.thp <= 0) live[x.dside][x.di] = 0;
      if (x.t === 'heat') for (const h of x.hits) if (h.thp <= 0) live[h.side][h.i] = 0;
      if (x.t === 'down') live[x.side][x.i] = 0;
    }
  }
  ok(broken === 0, `앞줄이 서 있는 동안 뒷줄이 맞은 타 — ${broken} / ${total}`);
  const [f, b] = makeSide([unit('mule'), null, unit('mule')], 'P');
  ok(b.atk === Math.round(f.atk * (CONST.JOINT.backAtk || 1)), `뒷줄 공격력 ×${CONST.JOINT.backAtk} — 앞 ${f.atk} · 뒤 ${b.atk}`);
}

console.log('\n== ③ 지원은 자기 편에게 ==');
{
  const sup = ids.filter(t => ROBOT_TYPES[t].skill.fx.shield || ROBOT_TYPES[t].skill.fx.repair);
  let wrong = 0, seen = 0;
  for (let n = 0; n < 300; n++) {
    const p = [unit(sup[n % sup.length]), unit(pick()), unit(sup[(n + 3) % sup.length]), unit(pick())];
    const res = runBrawl({ p, e: team(4), seed: n * 104729 + 7 });
    let caster = null;
    for (const x of res.events) {
      if (x.t === 'skill') caster = x.side;
      if ((x.t === 'shield' || (x.t === 'heal' && x.src === 'repair')) && caster) { seen++; if (x.side !== caster) wrong++; }
    }
  }
  ok(seen > 0 && wrong === 0, `방벽 · 수리 ${seen}번 — 상대 편에게 간 것 ${wrong}`);
}

console.log('\n== ④ 모양 ==');
{
  const one = runBrawl({ p: [unit('mule')], e: [unit('dune')], seed: 5 });
  ok(one.events.at(-1).t === 'end', '1 : 1 이 돈다');
  const gap = runBrawl({ p: [unit('mule'), null, unit('patch')], e: team(3), seed: 6 });
  ok(gap.P.length === 2 && gap.P[1].slot === 2 && gap.events.at(-1).t === 'end', '빈칸이 있는 2 : 3 이 돈다(뒷줄 칸 번호 유지)');
  let lie = 0;
  for (let n = 0; n < 300; n++) {
    const res = runBrawl({ p: team(4), e: team(4), seed: n * 31 + 1 }), end = res.events.at(-1);
    const winSide = end.winner === 'P' ? res.P : res.E;
    if (end.by === 'ko' && !winSide.some(u => u.hp > 0)) lie++;
  }
  ok(lie === 0, `KO 로 이긴 쪽에 살아 있는 기체가 있다 — 어긋남 ${lie}`);
}

console.log('\n== ⑤ 과열 ==');
{
  const p = team(4), e = team(4);
  const res = runBrawl({ p, e, seed: 11, opts: { heat: { at: 0.5, step: 0.05, every: 0.5 } } });
  const heats = res.events.filter(x => x.t === 'heat');
  ok(heats.length > 0 && heats[0].hits.length > 0 && res.events.at(-1).t === 'end', `과열을 일찍 켜면 ${heats.length}번 깎고 끝난다`);
  ok(!res.events.some(x => x.t === 'hit' && x.i < 0), '과열은 누구의 공격(hit)으로도 남지 않는다 — 딜표를 흐리지 않는다');
}

console.log('\n== ⑥ 판의 모양 (참고) ==');
{
  const T = []; let comeback = 0, downs = 0, byTime = 0;
  for (let n = 0; n < 1000; n++) {
    const res = runBrawl({ p: team(4), e: team(4), seed: n * 2654435761 >>> 0 }), end = res.events.at(-1);
    T.push(end.turns); if (end.by === 'time') byTime++;
    const fd = res.events.find(x => x.t === 'down');
    if (fd) { downs++; if ((fd.side === 'P' ? 'E' : 'P') !== end.winner) comeback++; }
  }
  T.sort((a, b) => a - b);
  console.log(`  무작위 4 : 4 Lv.30 1000판 — 행동 수 중앙 ${T[500]} · 90% ${T[900]} · 시간 판정 ${(byTime / 10).toFixed(1)}% · 첫 격추를 당하고도 이긴 판 ${(comeback / downs * 100).toFixed(1)}%`);
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
if (bad) process.exitCode = 1;
