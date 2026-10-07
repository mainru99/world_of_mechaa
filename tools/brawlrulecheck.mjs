/* 난투 런 규칙 자가 점검 — js/brawl.js (2026-10-07 · 계획 ②)
 *
 *   ① 풀 · 대여 — C 전부 + 보유 + 대여 · 스토리 없음 · 오늘의 6기는 날짜로 정해지고 보유를 뺀다
 *   ② 상점 — 결정적 · 풀 밖 기체 없음 · 라운드 1 등급 확률 · 복사본 한도
 *   ③ 동작 — 사기 · 팔기 · 옮기기 · 굴리기 · 잠그기 · 잘못된 동작 거절 · 받은 상태를 고치지 않음
 *   ④ 합성 — ★1 셋 → ★2(보급품) · ★2 셋 → ★3 · 자리가 차도 합성되는 기체는 산다
 *   ⑤ 시너지 — 서로 다른 기체 수로 센다 · 대기석은 안 센다 · 공명은 집안 기체만
 *   ⑥ 라운드 끝 — 수입(기본 · 이자 · 연승) · 목숨 · 10승 / 목숨 0 에서 끝
 *   ⑦ 팀 — teamOf 가 runBrawl 로 돈다 · ★ 배수 · 시너지가 능력치에 실린다
 *   ⑧ 봇 — 봇 런의 보드가 규칙을 지킨다 · (참고) 라운드별 보드 모양
 *
 * node --no-warnings tools/brawlrulecheck.mjs */
import { ROBOT_TYPES, CONST } from '../data/balance.js';
import { mulberry32 } from '../js/sim.js';
import { runBrawl } from '../js/brawl-sim.js';
import {
  dailyRentals, eligiblePool, newRun, rollShop, act, settle, autoMerge, synergiesOf, teamOf, baseStats,
  copiesOf, incomeOf, livesLostAt, botRun, brawlTypes, tagsOf, oddsOf, weightAt,
} from '../js/brawl.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const B = CONST.BRAWL;
const rar = t => ROBOT_TYPES[t].rarity;
const Cs = brawlTypes().filter(t => rar(t) === 'C');
const blank = over => ({ ...newRun({ seed: 1, owned: [], rentals: [] }), ...over });

console.log('== ① 풀 · 대여 ==');
{
  const pool = eligiblePool(['ranger', 'seraph', 'rook3_mod', 'nope'], ['azure']);
  ok(Cs.every(t => pool.includes(t)) && Cs.length === 10, `C ${Cs.length}종 전부 들어간다`);
  ok(pool.includes('ranger') && pool.includes('seraph') && pool.includes('azure'), '보유 · 대여가 들어간다');
  ok(!pool.includes('rook3_mod') && !pool.includes('nope') && !pool.some(t => ROBOT_TYPES[t].story), '스토리 · 없는 기체는 빠진다');
  ok(!eligiblePool([], []).some(t => rar(t) !== 'C'), '새 계정은 C 만');
  const many = brawlTypes().filter(t => rar(t) !== 'C');
  const capped = eligiblePool(many, [], null);
  ok(capped.filter(t => rar(t) !== 'C').length === B.deck, `출전 목록 — C 아닌 기체는 ${B.deck} 까지(전부 가져도)`);
  const dk = eligiblePool(many, ['azure', 'ranger'], ['seraph', 'wraith', 'mule', 'nope', 'kestrel', 'halo', 'hex']);
  ok(['azure', 'ranger', 'seraph', 'wraith', 'kestrel', 'halo'].every(t => dk.includes(t)) && !dk.includes('hex') && dk.length === 10 + B.deck,
     '대여가 먼저 · 남은 칸을 고른 출전 목록 순서대로 · C 는 칸을 안 먹는다');
  ok(!eligiblePool(['ranger'], [], ['seraph']).includes('seraph'), '출전 목록은 보유한 것만');
  const a = dailyRentals('2026-10-07', []), b = dailyRentals('2026-10-07', []), c = dailyRentals('2026-10-08', []);
  ok(a.length === B.rent.offers && JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c), `오늘의 ${a.length}기 — 날짜로 정해지고 날마다 바뀐다`);
  ok(a.every(t => rar(t) !== 'C' && !ROBOT_TYPES[t].story), 'C · 스토리 기체는 대여에 없다');
  const mine = dailyRentals('2026-10-07', [a[0], a[1]]);
  ok(!mine.includes(a[0]) && !mine.includes(a[1]) && mine.length === B.rent.offers, '보유 기체는 대여 후보에서 빠지고 다음 후보가 채운다');
  const r = newRun({ seed: 3, day: '2026-10-07', owned: [], rentals: [a[0], a[1], a[2], a[3], 'seraph'] });
  ok(r.rent.length === B.rent.daily && r.rent.every(t => a.includes(t)), `대여는 오늘의 후보 안에서 최대 ${B.rent.daily}장`);
}

console.log('\n== ② 상점 ==');
{
  const own = ['ranger', 'vanguard', 'azure', 'wraith', 'seraph'];
  const r1 = newRun({ seed: 77, owned: own, rentals: [] }), r2 = newRun({ seed: 77, owned: own, rentals: [] });
  ok(JSON.stringify(r1.shop) === JSON.stringify(r2.shop), '같은 시드 → 같은 상점');
  ok(JSON.stringify(rollShop({ ...r1, rerolls: 1 })) !== JSON.stringify(r1.shop), '굴리면 바뀐다');
  ok(r1.shop.length === B.shop.slots && r1.gold === B.startGold && r1.lives === B.lives, `상점 ${B.shop.slots}칸 · 골드 ${B.startGold} · 목숨 ${B.lives}`);
  const cnt = { C: 0, UC: 0, R: 0, UQ: 0, EP: 0 }; let outside = 0, n = 0;
  for (let s = 0; s < 2000; s++) {
    const r = newRun({ seed: s, owned: own, rentals: [] });
    for (const t of r.shop) { n++; cnt[rar(t)]++; if (!r.pool.includes(t)) outside++; }
  }
  ok(outside === 0, '풀 밖 기체는 상점에 나오지 않는다');
  const pc = k => cnt[k] / n * 100, od = oddsOf(r1, 1);
  ok(Math.abs(pc('C') - od.C) < 2 && Math.abs(pc('UC') - od.UC) < 2 && cnt.R + cnt.UQ + cnt.EP === 0,
     `라운드 1 — C ${pc('C').toFixed(1)}% · UC ${pc('UC').toFixed(1)}% (oddsOf ${od.C} · ${od.UC} — 기체 하나당 가중치)`);
  const w = weightAt(1), one = newRun({ seed: 1, owned: ['ranger'], rentals: [] }), two = newRun({ seed: 1, owned: ['ranger', 'vanguard'], rentals: [] });
  ok(Math.abs(oddsOf(one, 1).UC - w.UC / (10 * w.C + w.UC) * 100) < 0.1 && oddsOf(two, 1).UC > oddsOf(one, 1).UC,
     '풀이 작아도 한 기체가 더 자주 나오지 않는다(UC 하나 → 그 하나의 무게만큼)');
  const nc = newRun({ seed: 5, owned: [], rentals: [] });
  ok(nc.shop.every(t => rar(t) === 'C'), '보유 UC 가 없으면 C 만');
  ok(weightAt(99) === B.weight.at(-1), '표 끝을 넘으면 마지막 줄');
  /* 복사본 한도 — C 한 종만 남긴 풀에서 8개를 가진 상태 → 상점에 그 기체가 최대 1개 */
  const lim = blank({ pool: ['mule'], bench: [{ type: 'mule', star: 2 }, { type: 'mule', star: 2 }, { type: 'mule', star: 1 }, { type: 'mule', star: 1 }, null, null] });
  ok(copiesOf(lim, 'mule') === 8, '★2 는 기체 셋으로 센다');
  const sh = rollShop(lim);
  ok(sh.filter(Boolean).length === 1 && sh.filter(x => x === null).length === B.shop.slots - 1, `C 한도 ${B.copies.C} — 8개 가졌으면 상점에 1개만`);
}

console.log('\n== ③ 동작 ==');
{
  const r = blank({ shop: ['mule', 'dune', 'mule', null, 'rust'], gold: 10 });
  const snap = JSON.stringify(r);
  const b1 = act(r, { t: 'buy', i: 0 });
  ok(b1.run && b1.run.gold === 9 && b1.run.bench[0].type === 'mule' && b1.run.shop[0] === null, '사면 골드가 줄고 대기석 앞칸에 선다');
  ok(JSON.stringify(r) === snap, '받은 상태는 고치지 않는다');
  ok(act(r, { t: 'buy', i: 3 }).error === 'empty slot' && act(blank({ shop: ['seraph'], gold: 4 }), { t: 'buy', i: 0 }).error === 'gold', '빈 칸 · 골드 부족 거절');
  const s1 = act(b1.run, { t: 'sell', where: 'bench', i: 0 });
  ok(s1.run.gold === 10 && !s1.run.bench[0], '팔면 산 값');
  const s2 = act(blank({ bench: [{ type: 'seraph', star: 2 }, null, null, null, null, null] }), { t: 'sell', where: 'bench', i: 0 });
  ok(s2.run.gold === B.startGold + B.price.EP * 3, `★2 EP 는 ${B.price.EP * 3} 에 팔린다`);
  const m1 = act(b1.run, { t: 'move', from: { where: 'bench', i: 0 }, to: { where: 'board', i: 2 } });
  ok(m1.run.board[2].type === 'mule' && !m1.run.bench[0], '대기석 → 보드 뒷줄');
  const m2 = act(blank({ board: [{ type: 'mule', star: 1 }, null, null, null], bench: [{ type: 'dune', star: 1 }, null, null, null, null, null] }),
                 { t: 'move', from: { where: 'bench', i: 0 }, to: { where: 'board', i: 0 } });
  ok(m2.run.board[0].type === 'dune' && m2.run.bench[0].type === 'mule', '찬 칸으로 옮기면 서로 바뀐다');
  ok(act(r, { t: 'move', from: { where: 'board', i: 9 }, to: { where: 'bench', i: 0 } }).error === 'bad slot', '없는 칸 거절');
  const rr = act(r, { t: 'reroll' });
  ok(rr.run.gold === 10 - B.shop.reroll && rr.run.rerolls === 1, `굴리기 ${B.shop.reroll}골드`);
  ok(act(blank({ gold: 1 }), { t: 'reroll' }).error === 'gold', '골드가 없으면 못 굴린다');
  const lk = act(r, { t: 'lock' }).run;
  const nx = settle(lk, true).run;
  ok(JSON.stringify(nx.shop) === JSON.stringify(r.shop) && !nx.locked, '잠근 상점은 다음 라운드에 그대로 · 잠금은 풀린다');
  ok(JSON.stringify(settle(r, true).run.shop) !== JSON.stringify(r.shop), '안 잠그면 새 상점');
  ok(act(r, { t: 'hack' }).error && act(r, null).error && act({ ...r, done: true }, { t: 'reroll' }).error === 'run over', '모르는 동작 · 끝난 런 거절');
}

console.log('\n== ④ 합성 ==');
{
  const m = u => ({ type: 'mule', star: u });
  let r = blank({ shop: ['mule', 'mule', 'mule', 'mule', 'mule'], gold: 30, board: [null, m(1), null, null] });
  r = act(r, { t: 'buy', i: 0 }).run;
  const g0 = r.gold, x = act(r, { t: 'buy', i: 1 });
  ok(x.merged.length === 1 && x.run.board[1].star === 2 && x.run.bench.every(u => !u), '★1 셋 → ★2 · 보드에 있던 칸에 선다');
  ok(x.run.gold === g0 - B.price.C + B.mergeGold[2], `합성 보급품 ${B.mergeGold[2]}골드`);
  const y = { ...blank(), board: [m(2), m(2), null, null], bench: [m(1), m(1), m(1), null, null, null] };
  const mg = autoMerge(y);
  ok(mg.length === 2 && mg[1].star === 3 && y.board[0].star === 3 && units3(y) === 1, `★2 셋이 되면 이어서 ★3(보급품 ${B.mergeGold[3]})`);
  function units3(s) { return [...s.board, ...s.bench].filter(Boolean).length; }
  const full = blank({ shop: ['dune'], gold: 5, board: [m(1), m(1), m(1), m(1)].map((u, i) => i < 2 ? { type: 'dune', star: 1 } : u),
                       bench: Array(6).fill(0).map((_, i) => ({ type: Cs[i + 2] === 'dune' ? 'grit' : Cs[i + 2], star: 1 })) });
  const f1 = act(full, { t: 'buy', i: 0 });
  ok(f1.run && f1.run.board.filter(u => u && u.type === 'dune' && u.star === 2).length === 1, '보드 · 대기석이 다 차도 합성되는 기체는 산다');
  ok(act({ ...full, shop: ['scarab'] }, { t: 'buy', i: 0 }).error === 'full', '합성 안 되면 자리가 없다고 거절');
}

console.log('\n== ⑤ 시너지 ==');
{
  const sy = b => Object.fromEntries(synergiesOf(b).map(s => [s.key + (s.fam ? ':' + s.fam : ''), s]));
  const U = t => ({ type: t, star: 1 });
  ok(tagsOf('nebula').includes('shield') && tagsOf('nebula').includes('drain') && tagsOf('kestrel').includes('breach') && tagsOf('scarab').includes('flurry'), '딱지는 스킬 효과에서 읽는다(여러 개 가능)');
  ok(!sy([U('husk'), U('husk'), null, null]).shield, '같은 기체 둘은 하나로 센다');
  const s2 = sy([U('husk'), U('aegis'), null, null]);
  ok(s2.shield && s2.shield.tier === 1 && s2.shield.v === B.syn.shield.v[0], `서로 다른 방벽 둘 → 1단계(${B.syn.shield.v[0]})`);
  ok(sy([U('husk'), U('aegis'), U('nebula'), null]).shield.tier === 2, '셋 → 2단계');
  const r = blank({ board: [U('husk'), null, null, null], bench: [U('aegis'), null, null, null, null, null] });
  ok(!sy(r.board).shield, '대기석은 세지 않는다');
  const fam = sy([U('goliath_s'), U('goliath_r'), U('mule'), null]);
  ok(fam['family:goliath'] && fam['family:goliath'].types.length === 2, '같은 집안 아종 둘 → 공명');
  const t = teamOf([U('goliath_s'), U('goliath_r'), U('mule'), null]);
  const t0 = teamOf([U('goliath_s'), U('goliath_r'), U('mule'), null], { off: ['family'] });
  ok(t[0].stats.hp > t0[0].stats.hp && t[1].stats.atk > t0[1].stats.atk && t[2].stats.hp === t0[2].stats.hp, '공명은 그 집안 기체에게만');
  const ep = teamOf([U('seraph'), null, null, null])[0];
  ok(ep.stats.hp === Math.round(baseStats('seraph').hp * B.norm.EP), `등급 보정 — EP 내구 ×${B.norm.EP}`);
}

console.log('\n== ⑥ 라운드 끝 ==');
{
  let r = blank({ gold: 27 });
  const inc = incomeOf(r);
  ok(inc.base === B.income.base && inc.interest === Math.min(B.income.interestMax, Math.floor(27 / B.income.interestPer)) && inc.streak === 0, `수입 — 기본 ${inc.base} · 27골드 이자 ${inc.interest}`);
  ok(incomeOf(blank({ gold: 999 })).interest === B.income.interestMax, `이자 상한 ${B.income.interestMax}`);
  r = settle(r, true).run; r = settle(r, true).run;
  ok(r.streak === 2 && r.round === 3 && r.wins === 2, '연승을 센다');
  ok(incomeOf(r).streak === 1, '2연승 보너스 1');
  const lr = settle(r, false).run;
  ok(lr.streak === -1 && lr.lives === B.lives - livesLostAt(3), `3라운드 패배 → 목숨 ${livesLostAt(3)}`);
  const L = B.lossLives;
  ok(livesLostAt(1) === L[0][1] && livesLostAt(L[1][0]) === L[1][1] && livesLostAt(L[1][0] - 1) === L[0][1] && livesLostAt(99) === L.at(-1)[1],
     `목숨 손실 표 ${L.map(([a, b]) => a + '라운드~ ' + b).join(' · ')}`);
  let w = blank(); for (let k = 0; k < B.winGoal; k++) w = settle(w, true).run;
  ok(w.done && w.wins === B.winGoal && settle(w, true).error === 'run over', `${B.winGoal}승에서 끝`);
  let l = blank(), rounds = 0; while (!l.done) { l = settle(l, false).run; rounds++; }
  let need = 0, lose = B.lives; while (lose > 0) { need++; lose -= livesLostAt(need); }
  ok(l.lives === 0 && rounds === need, `내리 지면 ${rounds}라운드에 목숨 0 으로 끝`);
  let longest = 0;
  const rnd = mulberry32(9);
  for (let s = 0; s < 2000; s++) { let x = blank(), n = 0; while (!x.done) { x = settle(x, rnd() < 0.5).run; n++; } longest = Math.max(longest, n); }
  ok(longest <= 19, `반반 승패로 2000런 — 가장 긴 런 ${longest}라운드(끝이 있다)`);
}

console.log('\n== ⑦ 팀 ==');
{
  const U = (t, s) => ({ type: t, star: s || 1 });
  const t1 = teamOf([U('mule'), null, null, null])[0], t2 = teamOf([U('mule', 2), null, null, null])[0];
  ok(t2.stats.hp === Math.round(Math.round(baseStats('mule').hp * B.star.hp[1])) && t2.stats.atk > t1.stats.atk, `★2 — 내구 ×${B.star.hp[1]} · 공격 ×${B.star.atk[1]}`);
  const sh = teamOf([U('husk'), U('aegis'), U('mule'), null]);
  ok(sh.every(m => !m || m.shield > 0) && sh[2].shield === sh[2].stats.hp * B.syn.shield.v[0], '방벽 시너지 → 시작 방벽');
  const pr = teamOf([U('dune'), U('ranger'), null, null]);
  ok(Math.abs(pr[0].stats.skillMul - baseStats('dune').skillMul * (1 + B.syn.precise.v[0])) < 1e-9, '정밀 → 스킬 위력');
  const res = runBrawl({ p: sh, e: pr, seed: 4 });
  ok(res.events.at(-1).t === 'end' && res.E[0].skillMul === pr[0].stats.skillMul, 'teamOf → runBrawl 가 돈다 · 배수가 실린다');
  ok(res.events.some(x => x.t === 'hit' && x.side === 'E') && sh[0].shield > 0, '시작 방벽을 가진 채 싸운다');
  const plain = runBrawl({ p: [{ name: 'MULE', type: 'mule', stats: baseStats('mule'), tactic: 'none' }], e: [{ name: 'DUNE', type: 'dune', stats: baseStats('dune'), tactic: 'none' }], seed: 8 });
  const same = runBrawl({ p: teamOf([U('mule'), null, null, null]), e: teamOf([U('dune'), null, null, null]), seed: 8 });
  ok(JSON.stringify(plain.events) === JSON.stringify(same.events), '시너지 없는 ★1 은 기준 능력치 그대로(엔진에 덧붙는 것 없음)');
}

console.log('\n== ⑧ 봇 ==');
{
  let broken = 0, n = 0;
  const shape = {};
  for (let s = 0; s < 300; s++) {
    for (const round of [1, 4, 8]) {
      const r = botRun({ seed: s * 7 + 1, round });
      n++;
      const all = [...r.board, ...r.bench].filter(Boolean);
      const lim = all.every(u => copiesOf(r, u.type) <= B.copies[rar(u.type)]);
      const inPool = all.every(u => r.pool.includes(u.type));
      if (!(r.gold >= 0 && lim && inPool && r.board.length === B.board && r.bench.length === B.bench)) broken++;
      const k = 'R' + round; shape[k] = shape[k] || { units: 0, stars: 0, syn: 0, gold: 0, n: 0 };
      shape[k].units += r.board.filter(Boolean).length; shape[k].stars += r.board.filter(u => u && u.star > 1).length;
      shape[k].syn += synergiesOf(r.board).length; shape[k].gold += r.gold; shape[k].n++;
    }
  }
  ok(broken === 0, `봇 런 ${n}개 — 골드 · 한도 · 풀 · 칸 수 어긋남 ${broken}`);
  const a = botRun({ seed: 42, round: 6 }), b = botRun({ seed: 42, round: 6 });
  ok(JSON.stringify(a) === JSON.stringify(b), '봇 런은 시드로 정해진다');
  for (const k of Object.keys(shape)) {
    const x = shape[k];
    console.log(`  (참고) ${k} 봇 보드 — 기체 ${(x.units / x.n).toFixed(2)} · ★2 이상 ${(x.stars / x.n).toFixed(2)} · 시너지 ${(x.syn / x.n).toFixed(2)} · 남은 골드 ${(x.gold / x.n).toFixed(1)}`);
  }
  /* 라운드가 오른 봇이 낮은 봇을 이기는가 — 성장이 전투력이 되는지(참고) */
  let up = 0;
  for (let s = 0; s < 200; s++) {
    const hi = botRun({ seed: s + 1000, round: 8 }), lo = botRun({ seed: s + 5000, round: 2 });
    if (runBrawl({ p: teamOf(hi.board), e: teamOf(lo.board), seed: s }).win) up++;
  }
  console.log(`  (참고) 8라운드 봇 vs 2라운드 봇 — ${up / 2}% 승`);
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
if (bad) process.exitCode = 1;
