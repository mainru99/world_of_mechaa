/* 스킬 강화의 비용과 확률을 **게임이 실제로 쓰는 함수**로 잰다.

   손으로 계산해서 표를 적으면, 그 표와 코드가 갈려도 아무도 모른다.
   여기서는 `skillCost` · `skillRate` · `skillMul` 을 그대로 불러 쓴다.

   실패해도 재화가 나가므로 '+10 까지 얼마' 는 단순 합이 아니라 **기댓값**이다.
   단계 i 의 기대 시도는 1/rate[i] 이고, 비용은 그 시도마다 나간다.

   node tools/skill.mjs */
import { CONST } from '../data/balance.js';
import { skillCost, skillRate, skillMax, skillMul, sortieCost } from '../js/stats.js';
import { rollBattleRewards } from '../js/rewards.js';

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
  const one = skillCost(0), many = skillCost(0);
  const total = lv => { let s = 0; for (let i = 0; i < MAX; i++) s += skillCost(i).cr / skillRate(i); return s; };
  const a = total(1), b = total(CONST.MAXLV || 60);
  console.log(`  Lv.1 기준 +${MAX} 기대 크레딧\t${fmt(a)}`);
  console.log(`  Lv.${CONST.MAXLV||60} 기준\t\t${fmt(b)}`);
  console.log(a === b ? '  ✓ 같다 — 강화 시점이 값을 바꾸지 않는다'
                      : `  ✗ 다르다 (${((b/a-1)*100).toFixed(1)}%) — 육성 순서가 정답이 된다`);
  void one; void many;
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
