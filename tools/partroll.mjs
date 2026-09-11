/* 4단계 검증 — 새 파츠 생성(rollPart)과 재계산(partStat)이 맞물리는가.
 *
 * 이 단계가 바꾸는 것은 **파밍으로 나오는 물건 전부**다. 그래서 눈으로 몇 개
 * 찍어 보는 대신 10만 개를 굴려서 모양·분포·재현성을 한꺼번에 본다.
 *
 * 특히 셋을 본다.
 *   ① 모양   — 슬롯에 안 맞는 베이스, 그룹이 겹친 인챈트, 등급이 허용하지 않는
 *              개수·티어가 하나라도 나오면 실패다. 하나 나오면 계속 나온다.
 *   ② 재현성 — 파츠는 스탯을 저장하지 않는다. JSON 으로 넣었다 뺀 뒤에도 값이
 *              같아야 서버가 클라를 검증할 수 있다. 이게 이번 구조의 전제다.
 *   ③ 속도   — DESIGN.md §8 이 지목한 1순위 위험. 강제 대가(SLOT_COST)가
 *              사라지고 인챈트 다섯 종이 속도를 올린다. spd +5% 가 승률 72% 인
 *              게임이라(ba75c35) 여기가 새면 다른 게 다 맞아도 소용없다.
 *
 * node tools/partroll.mjs [개수]        기본 100000
 */
import { PART_BASES, AFFIXES, AFFIX_GROUPS, AFFIX_ROLL, RARITY, SLOTS, CONST } from '../data/balance.js';
import { rollPart, BASES_BY_SLOT } from '../js/gacha.js';
import { computeStats, partStat, partMods, isNewPart, powerOf, SLOT_ORDER } from '../js/stats.js';
import { makeUnit, simulate, mulberry32 } from '../js/sim.js';

const N = Math.max(1000, parseInt(process.argv[2] || '100000', 10));
const LV = 40;
const REFS = ['mule', 'ranger', 'azure'];
const G = s => '\x1b[32m' + s + '\x1b[0m', R = s => '\x1b[31m' + s + '\x1b[0m';

let fail = 0;
const ok  = m => console.log('  ' + G('✓') + ' ' + m);
const bad = m => { console.log('  ' + R('✗') + ' ' + m); fail++; };
const is  = (c, m) => c ? ok(m) : bad(m);

const RAR_BY = Object.fromEntries(RARITY.map(r => [r.k, r]));
const GROUP_OF = {};
for (const g in AFFIX_GROUPS) for (const id of AFFIX_GROUPS[g]) GROUP_OF[id] = g;
const rnd = mulberry32(20260912);

/* ── ① 10만 개 굴려서 모양을 본다 ─────────────────────────── */
console.log('\n① 생성 모양 (' + N.toLocaleString() + '개)');
const bySlot = {}, byRar = {}, byBase = {}, byTier = {}, byNAff = {};
const seenSeed = new Set();
let badSlot = 0, badBaseSlot = 0, badCount = 0, badTier = 0, badDup = 0, badGroup = 0,
    badAffixSlot = 0, badLv = 0, hasStats = 0;

const parts = [];
for (let i = 0; i < N; i++) {
  const p = rollPart(LV, rnd, 'p' + i);
  if (i < 4000) parts.push(p);
  bySlot[p.slot] = (bySlot[p.slot] || 0) + 1;
  byRar[p.rarity] = (byRar[p.rarity] || 0) + 1;
  byBase[p.base] = (byBase[p.base] || 0) + 1;
  seenSeed.add(p.seed);

  const B = PART_BASES[p.base], rar = RAR_BY[p.rarity];
  if (!SLOTS.includes(p.slot)) badSlot++;
  if (!B || B.slot !== p.slot) badBaseSlot++;
  if (p.stats !== undefined) hasStats++;
  if (p.lv !== LV) badLv++;

  const n = p.affixes.length;
  byNAff[n] = (byNAff[n] || 0) + 1;
  if (n < rar.affixes[0] || n > rar.affixes[1]) badCount++;

  const ids = new Set(), groups = new Set();
  for (const a of p.affixes) {
    const A = AFFIXES[a.id];
    if (!rar.tiers[a.tier]) badTier++;
    byTier[a.tier] = (byTier[a.tier] || 0) + 1;
    if (ids.has(a.id)) badDup++;
    ids.add(a.id);
    if (GROUP_OF[a.id]) { if (groups.has(GROUP_OF[a.id])) badGroup++; groups.add(GROUP_OF[a.id]); }
    if (!A || (A.slots !== '*' && !A.slots.includes(p.slot))) badAffixSlot++;
  }
}
is(!badSlot,      '슬롯이 SLOTS 안에 있다');
is(!badBaseSlot,  '베이스가 자기 슬롯에만 나온다' + (badBaseSlot ? ' (' + badBaseSlot + '건)' : ''));
is(!hasStats,     '스탯을 저장하지 않는다 (p.stats 없음)');
is(!badLv,        '주운 레벨을 들고 있다');
is(!badCount,     '인챈트 개수가 등급 범위 안이다' + (badCount ? ' (' + badCount + '건)' : ''));
is(!badTier,      '티어가 등급이 허용한 것만 나온다' + (badTier ? ' (' + badTier + '건)' : ''));
is(!badDup,       '같은 인챈트가 두 번 안 붙는다' + (badDup ? ' (' + badDup + '건)' : ''));
is(!badGroup,     '같은 그룹이 두 번 안 붙는다' + (badGroup ? ' (' + badGroup + '건)' : ''));
is(!badAffixSlot, '인챈트가 붙을 수 있는 슬롯에만 붙는다' + (badAffixSlot ? ' (' + badAffixSlot + '건)' : ''));
is(Object.keys(byBase).length === Object.keys(PART_BASES).length,
   '베이스 21종이 전부 나온다 (' + Object.keys(byBase).length + '/' + Object.keys(PART_BASES).length + ')');
is(seenSeed.size > N * 0.9,
   '씨앗이 겹치지 않는다 (' + seenSeed.size.toLocaleString() + '/' + N.toLocaleString() + ')');

/* ── ② 분포가 표와 맞나 ────────────────────────────────────── */
console.log('\n② 분포');
{
  const pct = (a, b) => a / b * 100;
  /* 기준을 표본 수에 맞춘다. 비율의 표준오차는 1/√N 로 줄어드는데 기준을 고정해 두면
     적은 판수로 돌릴 때 **고르게 나오는데도 실패**한다(실제로 2000판에서 걸렸다).
     아래 값들은 10만 개 기준이고, 그보다 적게 돌리면 같은 비율로 늘린다. */
  const slack = Math.sqrt(100000 / N);
  let off = 0;
  for (const r of RARITY) {
    const got = pct(byRar[r.k] || 0, N), want = r.w;
    if (Math.abs(got - want) > Math.max(0.6, want * 0.06) * slack) {
      off++; bad(r.k + ' 등급 ' + got.toFixed(2) + '% (표 ' + want + '%)');
    }
  }
  if (!off) ok('등급 분포가 RARITY 가중치와 맞는다  ' +
    RARITY.map(r => r.k + ' ' + pct(byRar[r.k] || 0, N).toFixed(1) + '%').join(' · '));

  const sl = SLOTS.map(s => pct(bySlot[s] || 0, N));
  is(Math.max(...sl) - Math.min(...sl) < 1.2 * slack,
     '슬롯이 고르게 나온다  ' + SLOTS.map((s, i) => s + ' ' + sl[i].toFixed(1) + '%').join(' · '));

  /* 슬롯 안에서 베이스가 고른가 — 한쪽으로 쏠리면 '늘 같은 걸 줍는' 상태가 된다 */
  let worst = 0, worstSlot = '';
  for (const s of SLOTS) {
    const list = BASES_BY_SLOT[s].map(b => (byBase[b] || 0) / (bySlot[s] || 1) * 100);
    const d = Math.max(...list) - Math.min(...list);
    if (d > worst) { worst = d; worstSlot = s; }
  }
  is(worst < 2.5 * slack, '슬롯 안 베이스가 고르다 (가장 쏠린 ' + worstSlot + ' 폭 ' + worst.toFixed(2) + '%p)');

  console.log('     인챈트 개수  ' + Object.keys(byNAff).sort()
    .map(k => k + '개 ' + (byNAff[k] / N * 100).toFixed(1) + '%').join(' · '));
  const tot = Object.values(byTier).reduce((a, b) => a + b, 0);
  console.log('     티어         ' + ['I', 'II', 'III', 'IV'].filter(t => byTier[t])
    .map(t => t + ' ' + (byTier[t] / tot * 100).toFixed(1) + '%').join(' · '));
}

/* ── ③ 재현성 — 스탯을 저장하지 않는다는 전제 ─────────────── */
console.log('\n③ 재현성 (서버가 같은 값을 다시 만든다)');
{
  const key = o => JSON.stringify(Object.keys(o).sort().map(k => [k, Math.round(o[k] * 1e9)]));
  let diffStat = 0, diffRound = 0, diffMods = 0, notNew = 0;
  for (const p of parts) {
    if (!isNewPart(p)) notNew++;
    const a = partStat(p);
    if (key(a) !== key(partStat(p))) diffStat++;
    /* 서버는 DB 에서 꺼낸 JSON 으로 다시 센다 — 왕복시켜서 같은지 본다 */
    const rt = JSON.parse(JSON.stringify(p));
    if (key(partStat(rt)) !== key(a)) diffRound++;
    const m1 = partMods(p), m2 = partMods(rt);
    if (m1.range !== m2.range || key(m1.fx) !== key(m2.fx)) diffMods++;
  }
  is(!notNew,    '전부 새 모양으로 판정된다');
  is(!diffStat,  '같은 파츠를 두 번 세면 같다' + (diffStat ? ' (' + diffStat + '건)' : ''));
  is(!diffRound, 'JSON 왕복 뒤에도 같다' + (diffRound ? ' (' + diffRound + '건)' : ''));
  is(!diffMods,  '구간 배수·고유 효과도 같다' + (diffMods ? ' (' + diffMods + '건)' : ''));

  /* seed 가 다르면 값도 달라야 한다 — 안 그러면 티어 안 굴림이 죽은 것이다 */
  const a = parts.find(p => p.affixes.length);
  if (a) {
    const v1 = key(partStat(a)), v2 = key(partStat({ ...a, seed: (a.seed ^ 12345) >>> 0 }));
    is(v1 !== v2, '씨앗이 다르면 값이 다르다 (티어 안 ±' + (AFFIX_ROLL * 100).toFixed(0) + '% 굴림이 산다)');
  }
}

/* ── ④ 구간은 곱셈인가 ─────────────────────────────────────── */
console.log('\n④ 구간 — 더하지 않고 곱한다');
{
  const narrow = 'mule', wide = 'azure';
  const bs = computeStats({ type: narrow, level: LV, skillLv: 0, fat: 0, slots: {} }, []);
  const bw = computeStats({ type: wide,   level: LV, skillLv: 0, fat: 0, slots: {} }, []);
  /* 구간을 좁히는 베이스 하나(경량 골격 range 0.86)를 같은 조건으로 끼운다 */
  const p = { uid: 'x', slot: 'FRAME', base: 'lightFrame', rarity: 'C', ko: '일반',
              name: PART_BASES.lightFrame.ko, affixes: [], seed: 0, lv: LV, enh: 0 };
  const sn = computeStats({ type: narrow, level: LV, skillLv: 0, fat: 0, slots: { FRAME: 'x' } }, [p]);
  const sw = computeStats({ type: wide,   level: LV, skillLv: 0, fat: 0, slots: { FRAME: 'x' } }, [p]);
  const rn = sn.spread / bs.spread, rw = sw.spread / bw.spread;
  is(Math.abs(rn - rw) < 0.01,
     '좁은 기체와 넓은 기체가 같은 비율로 움직인다 (' + narrow + ' ×' + rn.toFixed(3) +
     ' · ' + wide + ' ×' + rw.toFixed(3) + ')');
  is(Math.abs(rn - PART_BASES.lightFrame.range) < 0.01,
     '비율이 베이스의 range 와 같다 (×' + PART_BASES.lightFrame.range + ')');
  is(sn.spread >= CONST.SPREAD_MIN && sw.spread <= CONST.SPREAD_MAX, '구간이 상·하한 안에 있다');
}

/* 한 벌(네 칸)을 같은 등급으로 채운다 */
const suit = (rar, seed) => {
  const r = mulberry32(seed), ps = [], slots = {};
  for (const s of SLOT_ORDER) { const p = rollPart(LV, r, 's' + s, rar, s); ps.push(p); slots[s] = p.uid; }
  return { ps, slots };
};

/* ── ⑤ 속도 인플레 — §8 의 1순위 위험 ──────────────────────── */
console.log('\n⑤ 속도 — 한 벌을 다 끼웠을 때 (맨몸 대비)');
{
  let worst = 0, worstRar = '';
  for (const rar of ['C', 'R', 'SR', 'SSR']) {
    const d = [];
    for (const t of REFS) {
      const bare = computeStats({ type: t, level: LV, skillLv: 0, fat: 0, slots: {} }, []);
      for (let i = 0; i < 600; i++) {
        const { ps, slots } = suit(rar, i * 104729 + 7);
        const s = computeStats({ type: t, level: LV, skillLv: 0, fat: 0, slots }, ps);
        d.push(s.spd / bare.spd);
        if (s.spd <= 1) bad(rar + ' 에서 속도가 바닥(1)에 닿았다 — 한 번도 행동 못 하고 진다');
      }
    }
    d.sort((a, b) => a - b);
    const avg = d.reduce((a, b) => a + b, 0) / d.length;
    const p99 = d[Math.floor(d.length * 0.99)];
    console.log('     ' + rar.padEnd(3) + ' 평균 ×' + avg.toFixed(2) +
                ' · 최저 ×' + d[0].toFixed(2) + ' · 99분위 ×' + p99.toFixed(2));
    if (p99 > worst) { worst = p99; worstRar = rar; }
  }
  /* 옛 구조에서는 무장·코어가 둘 다 속도를 깎아 한 벌을 끼우면 오히려 느려졌다.
     이제 강제 대가가 없으니 위로 새는 쪽을 본다. 기준은 §8 의 경고다. */
  is(worst < 2.0, '속도가 맨몸의 2배를 넘지 않는다 (가장 높은 ' + worstRar +
     ' 99분위 ×' + worst.toFixed(2) + ')');
}

/* ── ⑥ 한 벌 승률 — 등급이 올라갈수록 세지나 ───────────────── */
console.log('\n⑥ 한 벌을 다 끼웠을 때 맨몸 상대 승률');
{
  const wr = {};
  for (const rar of ['C', 'R', 'SR', 'SSR']) {
    let w = 0, n = 0;
    for (const t of REFS) {
      const bare = computeStats({ type: t, level: LV, skillLv: 0, fat: 0, slots: {} }, []);
      for (let i = 0; i < 260; i++) {
        const { ps, slots } = suit(rar, i * 104729 + 7);
        const mine = computeStats({ type: t, level: LV, skillLv: 0, fat: 0, slots }, ps);
        const ev = simulate(makeUnit('P', t, mine), makeUnit('E', t, bare), i * 7919 + 13);
        if (ev[ev.length - 1].winner === 'P') w++;
        n++;
      }
    }
    wr[rar] = w / n * 100;
    console.log('     ' + rar.padEnd(3) + ' ' + wr[rar].toFixed(1) + '%');
  }
  is(wr.C < wr.R && wr.R < wr.SR && wr.SR < wr.SSR, '등급이 오를수록 세진다');
  is(wr.C > 60, 'C 한 벌도 맨몸보다 확실히 낫다 (' + wr.C.toFixed(1) + '%)');
  is(wr.SSR < 99.5, 'SSR 한 벌이 맨몸을 완전히 지우지는 않는다 (' + wr.SSR.toFixed(1) + '%)');
}

/* ── ⑦ 판 길이 — §8 의 세 번째 위험 ────────────────────
   방어를 깎는 인챈트가 흔하다(경량·누더기·고속·광폭·재생…). 그래서 한 벌씩 낀
   대결이 짧아질 수 있다. 짧아지면 스킬이 덜 터지고 먼저 때린 쪽이 그냥 이겨서,
   전술·상성 같은 것이 전부 묻힌다.

   tools/verify.mjs 의 21.6타는 **맨몸** 기준이라 이 위험을 못 본다.
   여기서는 양쪽 다 같은 등급 한 벌을 끼우고 잰다. */
console.log('\n⑦ 판 길이 — 양쪽 다 한 벌을 끼운 대결 (맨몸 기준선 21.6타)');
{
  let shortest = 99, shortRar = '';
  for (const rar of ['C', 'R', 'SR', 'SSR']) {
    let h = 0, sk = 0, n = 0;
    for (const t of REFS) {
      for (let i = 0; i < 240; i++) {
        const a = suit(rar, i * 104729 + 7), b = suit(rar, i * 15485863 + 11);
        const P = computeStats({ type: t, level: LV, skillLv: 0, fat: 0, slots: a.slots }, a.ps);
        const E = computeStats({ type: t, level: LV, skillLv: 0, fat: 0, slots: b.slots }, b.ps);
        const ev = simulate(makeUnit('P', t, P), makeUnit('E', t, E), i * 7919 + 13);
        h += ev.filter(e => e.t === 'hit').length;
        sk += ev.filter(e => e.t === 'skill').length;
        n++;
      }
    }
    const avg = h / n;
    console.log('     ' + rar.padEnd(3) + ' 타격 ' + avg.toFixed(1) + '회 · 스킬 ' + (sk / n).toFixed(1) + '회');
    if (avg < shortest) { shortest = avg; shortRar = rar; }
  }
  /* 스킬이 두어 번은 터져야 전술과 상성이 뜻을 갖는다. 12타 밑이면 그 전에 끝난다. */
  is(shortest >= 12, '한 벌을 껴도 판이 너무 짧아지지 않는다 (가장 짧은 ' + shortRar +
     ' ' + shortest.toFixed(1) + '타)');
}

/* ── ⑧ 표시 전투력이 얼마나 맞나 — §8 의 세 번째 위험 ─────────────
   `powerOf` 는 구간(spread)도 고유 효과(관통·스택·재생)도 안 센다. 아레나가
   전투력 ±15% 창으로 매칭하므로, 전투력이 실제 세기를 잘못 말하면 매칭이 틀어진다.

   재는 법 — 베이스 21종을 하나씩 끼우고 **전투력 증가율**과 **실제 승률**을
   같이 잰 뒤, 둘 사이 직선을 구해 각 베이스가 그 직선에서 얼마나 벗어나는지 본다.
   전투력이 완벽한 예보기라면 전부 직선 위에 놓인다.

   2026-09-12 실측에서 드러난 것 — **고유 효과가 주범이 아니었다.**
   오차가 가장 큰 둘(리액터 +3.1%p · 실드 프레임 +2.5%p)은 고유 효과도 구간 배수도
   없다. `powerOf` 의 생존 항(`hp × (1+def/100) / (1-eva)`)이 방어·체력 중심 조합을
   과소평가하는 것이 더 크다. 고유 효과 2종의 평균 오차는 -1.19%p 였다.

   그래서 **고치지 않았다.** 아레나의 ±15% 창은 승률로 약 ±13%p 에 해당하는데
   평균 오차는 1%p 아래다. 고유 효과를 전투력에 욱여넣으면(채프는 판이 길어질수록
   약해지고 관통은 상대 방어가 높을 때만 값이 있다) 상황에 따라 달라지는 것을
   상수로 적는 셈이라, 지금 오차보다 크게 틀릴 수 있다.
   여기서는 **그 판단이 계속 유효한지만 지킨다.** */
console.log('\n⑧ 표시 전투력 — 실제 세기를 얼마나 맞히나');
{
  const one = id => { const B = PART_BASES[id];
    return { uid:'x', slot:B.slot, base:id, rarity:'C', ko:'일반',
             name:B.ko, affixes:[], seed:0, lv:LV, enh:0 }; };
  const rows = [];
  for (const id in PART_BASES) {
    const p = one(id);
    let w = 0, n = 0, pw = 0, bw = 0;
    for (const t of REFS) {
      const rb = { type:t, level:LV, skillLv:0, fat:0, slots:{} };
      const bare = computeStats(rb, []);
      const mine = computeStats({ ...rb, slots:{ [p.slot]:'x' } }, [p]);
      pw += powerOf(mine); bw += powerOf(bare);
      for (let i = 0; i < 400; i++) {
        const ev = simulate(makeUnit('P', t, mine), makeUnit('E', t, bare), i * 7919 + 13);
        if (ev[ev.length - 1].winner === 'P') w++;
        n++;
      }
    }
    rows.push({ id, ko: PART_BASES[id].ko, fx: !!PART_BASES[id].fx, wr: w / n * 100, gain: (pw / bw - 1) * 100 });
  }
  /* 전투력 증가율 → 승률 직선 */
  const mx = rows.reduce((s, r) => s + r.gain, 0) / rows.length;
  const my = rows.reduce((s, r) => s + r.wr, 0) / rows.length;
  const k = rows.reduce((s, r) => s + (r.gain - mx) * (r.wr - my), 0)
          / rows.reduce((s, r) => s + (r.gain - mx) ** 2, 0);
  const c = my - k * mx;
  let sum = 0, worst = null, fxSum = 0, fxN = 0;
  for (const r of rows) {
    r.err = r.wr - (k * r.gain + c);
    sum += Math.abs(r.err);
    if (!worst || Math.abs(r.err) > Math.abs(worst.err)) worst = r;
    if (r.fx) { fxSum += r.err; fxN++; }
  }
  const mae = sum / rows.length;
  console.log(`     승률 ≈ ${k.toFixed(2)} × 전투력증가% + ${c.toFixed(1)}`);
  console.log(`     평균 절대오차 ${mae.toFixed(2)}%p · 가장 어긋난 것 ${worst.ko} ${worst.err > 0 ? '+' : ''}${worst.err.toFixed(1)}%p` +
              (worst.fx ? ' (고유효과)' : ' (고유효과 아님)'));
  console.log(`     고유효과 ${fxN}종 평균 ${fxSum / fxN > 0 ? '+' : ''}${(fxSum / fxN).toFixed(2)}%p`);
  /* 아레나 ±15% 창 = 승률로 약 ±(15×k)%p. 그 10분의 1 을 넘으면 매칭이 흔들린다. */
  const budget = 15 * k / 10;
  is(mae < budget, `전투력 오차가 아레나 매칭 창(±15%)에 비해 작다 (${mae.toFixed(2)} < ${budget.toFixed(2)}%p)`);
  is(Math.abs(fxSum / fxN) < 2.0,
     `고유 효과를 안 세는 것이 아직 감당할 만하다 (평균 ${Math.abs(fxSum / fxN).toFixed(2)}%p)`);
}

console.log(fail ? '\n' + R('✗ ' + fail + '건 실패') : '\n' + G('전부 통과'));
process.exitCode = fail ? 1 : 0;
