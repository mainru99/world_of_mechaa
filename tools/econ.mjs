/* 경제 자가 점검 — **돈을 찍어내는 길이 있는가.**

   이 게임의 재화는 전부 '들어오는 곳'(대전·토벌·원정·점령·레이드)과
   '나가는 곳'(레벨업·강화·정비·합성)이 정해져 있다. 위험한 것은 그 사이에
   **닫힌 고리**가 생기는 경우다 — 같은 파츠를 강화했다 분해하면 스크랩이 늘어난다든가.
   그런 고리는 한 번 열리면 다른 모든 수치가 무의미해진다.

   실제로 열려 있었다. 강화 비용은 등급과 무관한데(18·36·54…) 분해 환급은
   등급에 비례해서, SSR 은 18 을 넣으면 분해값이 38 올랐다. SR 은 정확히 본전이었다.
   여기서 그것부터 본다.

   node tools/econ.mjs */
import { CONST, RARITY } from '../data/balance.js';
import { enhCost, enhRate, enhMax, lvCost, skillCost, skillRate, skillMax } from '../js/stats.js';
import { scrapGain, scrapValue, enhSpent, autoScrapValue,
         fuseCost } from '../js/gacha.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const RARS = RARITY.map(r => r.k);
const ENH_MAX = 10;                      // server/hangar.js 의 상한

console.log('== ① 강화 → 분해 가 이득이 되면 안 된다 ==');
console.log('   (강화 한 단계에 드는 값보다 분해값이 더 오르면 파츠가 스크랩 기계가 된다)');
{
  let worst = null;
  for (const r of RARS) {
    for (let e = 0; e < ENH_MAX; e++) {
      const cost = enhCost(e);                       // +e → +(e+1) 비용
      const up   = scrapGain(r, e + 1) - scrapGain(r, e);   // 그때 오르는 분해값
      const net  = up - cost;                        // 0 이상이면 돈이 찍힌다
      if (!worst || net > worst.net) worst = { r, e, cost, up, net };
    }
  }
  console.log(`  가장 아슬아슬한 자리 — ${worst.r} +${worst.e}→+${worst.e + 1}: ` +
              `비용 ${worst.cost} · 분해값 상승 ${worst.up} · 차이 ${worst.net}`);
  ok(worst.net < 0, '어떤 등급·어떤 단계에서도 강화가 분해값을 비용만큼 올리지 못한다');
  /* 여러 단계를 한꺼번에 올려도 마찬가지여야 한다 — 한 단계씩은 손해인데
     묶으면 이득인 구간이 생길 수 있어서 따로 본다. */
  let pumps = 0;
  for (const r of RARS)
    for (let a = 0; a <= ENH_MAX; a++)
      for (let b = a + 1; b <= ENH_MAX; b++) {
        const spend = enhSpent(b) - enhSpent(a);
        if (scrapGain(r, b) - scrapGain(r, a) >= spend) pumps++;
      }
  ok(pumps === 0, `몇 단계를 한꺼번에 올려도 이득이 없다 (${RARS.length}등급 × 모든 구간)`);
  ok((CONST.ENH_REFUND ?? 0.5) < 1, `환급률 ${CONST.ENH_REFUND} < 1`);
}

console.log('\n== ② 분해값 표 ==');
{
  const w = 9;
  console.log('  등급  ' + [0, 1, 2, 3, 5, 10].map(e => ('+' + e).padStart(w)).join(''));
  for (const r of RARS)
    console.log('  ' + r.padEnd(6) + [0, 1, 2, 3, 5, 10]
      .map(e => String(scrapGain(r, e)).padStart(w)).join(''));
  console.log('  들인값' + [0, 1, 2, 3, 5, 10].map(e => String(enhSpent(e)).padStart(w)).join(''));
  ok(RARS.every(r => scrapGain(r, 0) === scrapValue(r)), '+0 은 등급 기본값 그대로');
  ok(RARS.every(r => { for (let e = 0; e < ENH_MAX; e++)
        if (scrapGain(r, e + 1) <= scrapGain(r, e)) return false; return true; }),
     '강화할수록 분해값은 오른다 (잘못 강화한 것을 버리는 값이 줄지 않는다)');
}

console.log('\n== ③ 합성이 스크랩을 늘리면 안 된다 ==');
{
  /* 재료 셋을 분해하는 것보다 합성해서 나온 하나를 분해하는 것이 이득이면,
     합성은 콘텐츠가 아니라 환전소가 된다. 등급이 오를 확률까지 쳐서 본다. */
  let worst = null;
  for (let i = 0; i < RARS.length; i++) {
    const r = RARS[i], need = CONST.FUSE.need, up = CONST.FUSE.up[r] || 0;
    const next = RARS[i + 1] || r;
    const before = scrapGain(r, 0) * need;                 // 그냥 셋을 분해
    const after  = (1 - up) * scrapGain(r, 0) + up * scrapGain(next, 0) - fuseCost(r);
    const net = after - before;
    console.log(`  ${r} ${need}개 — 그냥 분해 ${before} vs 합성 후 분해 ${after.toFixed(1)} (차이 ${net.toFixed(1)})`);
    if (!worst || net > worst.net) worst = { r, net };
  }
  ok(worst.net < 0, '어떤 등급에서도 합성이 분해보다 이득이 아니다');
}

console.log('\n== ④ 자동 분해는 손으로 분해하는 것보다 많이 주면 안 된다 ==');
{
  /* 많이 주면 '좋은 파츠가 자동으로 사라지는 것이 이득' 이 되어, 파츠를 모으는
     행동 자체가 손해가 된다. */
  const over = RARS.filter(r => autoScrapValue(r) > scrapGain(r, 0));
  ok(over.length === 0, over.length ? `초과: ${over.join(', ')}` : '전부 손분해 이하');
}

console.log('\n== ⑤ 나가는 곳이 살아 있는가 ==');
{
  ok(lvCost(60) > lvCost(1), `레벨업 비용이 오른다 (Lv.1 ${lvCost(1)} → Lv.60 ${lvCost(60)})`);
  ok(enhCost(9) > enhCost(0), `강화 비용이 오른다 (+0 ${enhCost(0)} → +9 ${enhCost(9)})`);
  const s0 = skillCost(0), s9 = skillCost(9);
  ok(s9.cr > s0.cr, `스킬 강화 비용이 오른다 (${s0.cr} → ${s9.cr} 크레딧)`);
}

console.log('\n== ⑥ 강화는 얼마나 무거운가 — 확률까지 친 기대값 ==');
{
  /* 명목 비용만 보면 실제 부담을 못 본다. 확률이 붙은 뒤로는 **기대 시도 횟수**가
     진짜 값이다. 사용자가 "너무 쉽고 저렴하다" 고 한 자리라 수치를 여기 남긴다. */
  let tries = 0, scrap = 0;
  for (let e = 0; e < enhMax(); e++) { const p = enhRate(e); tries += 1 / p; scrap += enhCost(e) / p; }
  console.log(`  파츠 +10 — 기대 ${tries.toFixed(1)}회 · 스크랩 ${Math.round(scrap)} (명목합 ${enhSpent(enhMax())})`);
  console.log('  단계별 ' + [...Array(enhMax())].map((_, e) => `${e}:${enhCost(e)}/${Math.round(enhRate(e) * 100)}%`).join(' '));
  let st = 0, cr = 0;
  for (let l = 0; l < skillMax(); l++) { st += 1 / skillRate(l); cr += skillCost(l).cr / skillRate(l); }
  console.log(`  스킬 +10 — 기대 ${st.toFixed(1)}회 · 크레딧 ${Math.round(cr)}`);
  console.log(`  파츠 한 벌(4개)을 +10 까지: 스크랩 약 ${Math.round(scrap * 4)}`);

  ok([...Array(enhMax())].every((_, e) => enhRate(e) > 0 && enhRate(e) <= 1), '강화 확률이 0 초과 1 이하다');
  /* 첫 몇 단계는 확실해야 한다. 전선 1장을 도는 사람에게 첫 강화부터 실패를 보이면
     배우는 것 없이 재화만 잃는다. */
  ok(enhRate(0) === 1, '첫 강화는 반드시 성공한다');
  ok([...Array(enhMax() - 1)].every((_, e) => enhRate(e + 1) <= enhRate(e)), '뒤로 갈수록 어려워진다');
  ok([...Array(skillMax() - 1)].every((_, l) => skillRate(l + 1) <= skillRate(l)), '스킬도 뒤로 갈수록 어려워진다');
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
