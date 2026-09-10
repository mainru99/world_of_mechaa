/* 스킬 강화의 비용과 확률을 **게임이 실제로 쓰는 함수**로 잰다.

   손으로 계산해서 표를 적으면, 그 표와 코드가 갈려도 아무도 모른다.
   여기서는 `skillCost` · `skillRate` · `skillMul` 을 그대로 불러 쓴다.

   실패해도 재화가 나가므로 '+10 까지 얼마' 는 단순 합이 아니라 **기댓값**이다.
   단계 i 의 기대 시도는 1/rate[i] 이고, 비용은 그 시도마다 나간다.

   node tools/skill.mjs */
import { CONST } from '../data/balance.js';
import { skillCost, skillRate, skillMax, skillMul, sortieCost, rescueCredits,
         computeStats, powerOf } from '../js/stats.js';
import { rollBattleRewards, gearFromRating, makeOpponent, makeHuntTarget } from '../js/rewards.js';

const MAX = skillMax();
const fmt = n => Math.round(n).toLocaleString('en-US');

console.log('== ① 단계별 비용과 확률 ==');
console.log('단계\t확률\t크레딧/회\t스크랩/회\t기대 시도\t스킬 배수');
let tries = 0, cr = 0, sc = 0;
for (let i = 0; i < MAX; i++) {
  const c = skillCost(i), r = skillRate(i), t = 1 / r;
  tries += t; cr += c.cr * t; sc += c.sc * t;
  console.log(`+${i}→+${i+1}\t${(r*100).toFixed(0)}%\t${fmt(c.cr)}\t\t${fmt(c.sc)}\t\t${t.toFixed(2)}\t\t×${skillMul(i+1).toFixed(2)}`);
}
console.log(`\n+0 → +${MAX} 기대치 — 시도 ${tries.toFixed(2)}회 · 크레딧 ${fmt(cr)} · 스크랩 ${fmt(sc)}`);

/* ── ② 기체 레벨이 값을 바꾸는가 ─────────────────────────────
   예전에는 크레딧에 (1 + 기체레벨 × 0.02)가 곱해져서, **먼저 강화하고 나중에 키우면**
   같은 +10 이 54% 쌌다. 육성 순서가 곧 정답이 되는 구조였다.
   지금은 안 곱한다 — 이 항목은 늘 '같다' 로 나와야 한다. */
console.log('\n== ② 기체 레벨에 따라 값이 달라지나 (달라지면 안 된다) ==');
{
  /* The second argument is intentional: the current one-argument function ignores it,
     while the removed legacy implementation used it as the robot-level multiplier. */
  const total = lv => { let s = 0; for (let i = 0; i < MAX; i++) s += skillCost(i, lv).cr / skillRate(i); return s; };
  const a = total(1), b = total(CONST.MAXLV || 60);
  const oneArg = skillCost.length === 1;
  console.log(`  Lv.1 기준 +${MAX} 기대 크레딧\t${fmt(a)}`);
  console.log(`  Lv.${CONST.MAXLV||60} 기준\t\t${fmt(b)}`);
  console.log(a === b && oneArg ? '  ✓ 같다 — 강화 시점이 값을 바꾸지 않는다'
                                : `  ✗ 계약 위반 — 값 차이 ${((b/a-1)*100).toFixed(1)}% · 함수 인자 ${skillCost.length}개`);
  if (a !== b || !oneArg) process.exitCode = 1;
}

/* ── ③ 실패 꼬리 ────────────────────────────────────────────
   첫 강화부터 실패하는 설계라, '몇 번을 내리 실패할 수 있나' 가 체감을 정한다.
   마지막 단계에서 열 번 연속 실패하면 사람은 그만둔다. */
console.log('\n== ③ 실패 꼬리 (마지막 단계에서 n번 연속 실패할 확률) ==');
{
  const r = skillRate(MAX - 1), c = skillCost(MAX - 1);
  for (const n of [5, 10, 20]) {
    const p = Math.pow(1 - r, n);
    console.log(`  ${n}연속\t${(p*100).toFixed(1)}%\t(그때까지 나간 크레딧 ${fmt(c.cr*n)})`);
  }
}

/* ── ④ 이 값은 아레나 몇 판인가 ─────────────────────────────
   숫자만 보면 크고 작음을 알 수 없다. 벌이와 견줘야 '얼마나 먼 목표' 인지 보인다.
   보상 함수를 그대로 불러 표본을 낸다. */
console.log('\n== ④ 아레나 벌이로 환산 ==');
{
  let s = 1234567; const rnd = () => ((s = Math.imul(s, 1103515245) + 12345 | 0) >>> 0) / 4294967296;
  let uidN = 0; const uid = () => 'x' + (uidN++);
  for (const lv of [30, CONST.MAXLV || 60]) {
    let sum = 0, n = 4000;
    for (let i = 0; i < n; i++) sum += rollBattleRewards(rnd() < 0.5, lv, rnd, uid).cr;
    const gross = sum / n;
    /* 출격비를 빼야 '실제로 손에 남는 돈' 이다. 안 빼면 판수를 낙관적으로 센다. */
    const cost = sortieCost({ level: lv, type: 'mule' });
    const net = gross - cost;
    console.log(`  Lv.${lv}	한 판 ${fmt(gross)} − 출격비 ${fmt(cost)} = ${fmt(net)} 크레딧`
      + `	→ +${MAX} 까지 약 ${net > 0 ? Math.round(cr/net) + '판' : '벌이가 안 된다'}`);
  }
  console.log('  (승패 반반 · 아레나만 돈다고 볼 때. 토벌·점령은 크레딧을 쓰는 쪽이다)');
}

/* ── ⑤ 표시 전투력에 스킬 강화가 들어가는가 ─────────────────
   스킬을 전부 평타처럼 세면 과대평가하고, 아예 빼면 사람 상대 검색이 +0과 +10을
   같은 기체로 본다. 확정한 공격 몫만 반영되어 단계별로 단조 증가해야 한다. */
console.log('\n== ⑤ 스킬 강화 표시 전투력 ==');
{
  const empty = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
  const powers = [];
  for (let skillLv = 0; skillLv <= MAX; skillLv++) {
    powers.push(powerOf(computeStats({ type: 'mule', level: CONST.MAXLV || 60,
                                       skillLv, fat: 0, slots: empty }, [])));
  }
  const s0 = computeStats({ type: 'mule', level: CONST.MAXLV || 60,
                            skillLv: 0, fat: 0, slots: empty }, []);
  const legacy = { ...s0 }; delete legacy.skillMul;
  const oldSafe = powerOf(legacy) === powers[0];
  const monotonic = powers.every((p, i) => i === 0 || p > powers[i - 1]);
  const ratio = powers[MAX] / powers[0];
  const expected = Math.sqrt(1 + CONST.SKILL_POWER_SHARE * (skillMul(MAX) - 1));
  console.log(`  +0 ${fmt(powers[0])} → +${MAX} ${fmt(powers[MAX])} · ×${ratio.toFixed(3)} (기대 ×${expected.toFixed(3)})`);
  console.log(monotonic && oldSafe && Math.abs(ratio - expected) < 0.002
    ? '  ✓ 단계별 증가 · 구형 스냅샷 호환 · 확정 계수 일치'
    : '  ✗ 표시 전투력 계약 위반');
  if (!monotonic || !oldSafe || Math.abs(ratio - expected) >= 0.002) process.exitCode = 1;
}

/* ── ⑥ 생성 상대 스킬 계단과 콘텐츠 격리 ───────────────────
   일반 아레나는 레이팅을 따라 +0→+10으로 오른다. 비상 출격·토벌은 +0이어야
   구제전과 선택형 PvE 난도가 플레이어 성적에 끌려 올라가지 않는다. */
console.log('\n== ⑥ 생성 상대 스킬 강화 경로 ==');
{
  const actual = CONST.RATING_GEAR.map(row => gearFromRating(row.at).skillLv);
  const expected = [0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  let seq = 0; const uid = () => 's' + (seq++);
  const arenaRobot = makeOpponent(['C', 'UC', 'R', 'UQ', 'EP'], 60, () => 0.99, uid, false, 2850);
  const arenaMonster = makeOpponent(['C', 'UC', 'R', 'UQ', 'EP'], 60, () => 0, uid, false, 2850);
  const rescue = makeOpponent(['C', 'UC', 'R', 'UQ', 'EP'], 60, () => 0, uid, true, 2850);
  const hunt = makeHuntTarget('C', 60, () => 0, uid);
  const tableOk = actual.length === expected.length && actual.every((x, i) => x === expected[i]);
  const pathsOk = arenaRobot.skillLv === 10 && arenaMonster.skillLv === 10
               && rescue.skillLv === 0 && hunt.skillLv === 0;
  console.log(`  레이팅 계단\t${actual.join(' / ')}`);
  console.log(`  일반 로봇 +${arenaRobot.skillLv} · 일반 몬스터 +${arenaMonster.skillLv} · 비상 +${rescue.skillLv} · 토벌 +${hunt.skillLv}`);
  console.log(tableOk && pathsOk ? '  ✓ 아레나만 성장하고 구제·토벌은 +0'
                                  : '  ✗ 생성 상대 스킬 경로 계약 위반');
  if (!tableOk || !pathsOk) process.exitCode = 1;
}

/* ── ⑦ 비상 출격은 전 레벨에서 다음 정상 출격을 보장하는가 ─────── */
console.log('\n== ⑦ 비상 출격 회복 바닥 ==');
{
  let ok = true;
  for (const level of [1, 30, CONST.MAXLV || 60]) {
    const rb = { type: 'mule', level };
    const cost = sortieCost(rb), lose = rescueCredits(rb, false), win = rescueCredits(rb, true);
    const rowOk = lose === cost && win === cost * 2;
    ok = ok && rowOk;
    console.log(`  Lv.${level}\t출격비 ${cost} · 패배 ${lose} · 승리 ${win}${rowOk ? '' : '  ✗'}`);
  }
  console.log(ok ? '  ✓ 패배 1회분 · 승리 2회분을 레벨에 맞춰 지급'
                 : '  ✗ 비상 출격이 다음 정상 출격을 보장하지 않는다');
  if (!ok) process.exitCode = 1;
}
