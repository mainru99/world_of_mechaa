/* 대전 몬스터 구간표 자가 점검 — **구조**를 본다(난이도는 tools/bandplan.mjs 가 잰다).
 *
 * 이 기능의 약속은 둘이다.
 *   ① **구간 안에서 상대가 안 움직인다.** 내가 자라도 그대로다 — 그게 구간제의 전부다.
 *      이게 깨지면 예전의 제자리걸음(레이팅 2400 승률 33% 골짜기)으로 돌아간다.
 *   ② **표가 뒤로 가지 않는다.** 예전 RATING_GEAR 는 개수를 줄이며 등급을 올리고
 *      강화를 0 으로 되돌렸다. 가장 큰 축(강화 +0→+10 이 레벨 7.1 어치)을 주기적으로
 *      빼앗는 표였고, 그 되돌림이 승률 계단의 정체였다.
 *
 * node tools/bandcheck.mjs */
import { CONST, MONSTER_TYPES, RARITY } from '../data/balance.js';
import { computeStats, powerOf } from '../js/stats.js';
import { bandOf, bandNext, makeOpponent } from '../js/rewards.js';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };
const B = CONST.MON_BAND || [];
const RAR_I = RARITY.map(r => r.k);
const EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
let sd = 4242;
const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
let uc = 0; const uid = () => 'u' + (uc++);

console.log('== ① 표의 모양 ==');
ok(B.length > 0, `구간 ${B.length}개`);
ok(B[0].at === 0, '첫 구간이 레이팅 0 에서 시작한다 (시작 레이팅 1000 이 반드시 걸린다)');
ok(B.every((r, i) => i === 0 || r.at > B[i - 1].at), '레이팅 문턱이 오름차순이다');
ok(B.every(r => r.lv >= 1 && r.lv <= CONST.MAXLV + (CONST.OPP_LV_OVER || 0)),
   `상대 레벨이 1~${CONST.MAXLV + (CONST.OPP_LV_OVER || 0)} 안에 있다`);
ok(B.every(r => (r.rars || []).length && r.rars.every(k => k !== 'BOSS')),
   '등급 풀이 비어 있지 않고 보스가 섞이지 않았다');
ok(B.every(r => r.gear && r.gear.n >= 0 && r.gear.n <= 4), '장비 개수가 0~4 다');

console.log('\n== ② 표가 뒤로 가지 않는가 — 예전 RATING_GEAR 의 병이다 ==');
{
  let dipN = 0, dipR = 0, dipE = 0;
  for (let i = 1; i < B.length; i++) {
    const a = B[i - 1].gear, b = B[i].gear;
    if (b.n < a.n) dipN++;
    if (RAR_I.indexOf(b.rar) < RAR_I.indexOf(a.rar)) dipR++;
    if ((b.enh | 0) < (a.enh | 0)) dipE++;
  }
  ok(dipN === 0, `파츠 개수가 줄어드는 구간이 없다 (${dipN})`);
  ok(dipR === 0, `등급이 내려가는 구간이 없다 (${dipR})`);
  ok(dipE === 0, `강화가 되돌아가는 구간이 없다 (${dipE}) — 가장 큰 축이다`);

  /* 개수·등급·강화가 각각 안 내려가도 **합친 세기**가 내려갈 수 있다.
     실제로 옛 표가 그랬다(4xR+4 → 2xSR+0 에서 공격력이 640 → 567). 세기로 다시 본다. */
  const powOf = g => {
    const st = computeStats({ type: 'azure', level: 30, skillLv: 0, fat: 0, slots: EMPTY }, []);
    return powerOf(st) * (1 + g.n * 0.06) * (1 + RAR_I.indexOf(g.rar) * 0.18) * (1 + g.enh * 0.05);
  };
  let dipP = 0;
  for (let i = 1; i < B.length; i++) if (powOf(B[i].gear) < powOf(B[i - 1].gear)) dipP++;
  ok(dipP === 0, `장비의 합친 세기도 내려가지 않는다 (${dipP})`);
}

console.log('\n== ③ 구간 안에서 상대가 안 움직인다 ==');
{
  /* 같은 레이팅에서 **내 레벨만** 바꿔 여러 번 뽑는다. 상대 레벨이 따라 움직이면
     구간제가 아니다(흔들림 ±1 만 허용한다). */
  let worst = 0, sample = null;
  for (const r of [1000, 1300, 1600, 2000, 2400, 2900]) {
    const lvs = [];
    for (const myLv of [5, 15, 25, 35, 45, 55]) {
      for (let k = 0; k < 8; k++) lvs.push(makeOpponent(['C', 'R'], myLv, rnd, uid, true, r).level);
    }
    const spread = Math.max(...lvs) - Math.min(...lvs);
    if (spread > worst) { worst = spread; sample = r; }
  }
  ok(worst <= 2, `내 레벨이 5→55 로 변해도 상대 레벨이 안 따라온다 (가장 흔들린 폭 ${worst}, 레이팅 ${sample})`);

  /* 반대로 **레이팅이 오르면** 상대가 세져야 한다. 안 그러면 구간이 뜻이 없다. */
  const lv = [1000, 1600, 2400].map(r => bandOf(r).lv);
  ok(lv[0] < lv[1] && lv[1] < lv[2], `레이팅이 오르면 구간이 세진다 (Lv.${lv.join(' → ')})`);
}

console.log('\n== ④ 몬스터가 파츠를 낀다 — 레벨 천장을 푼 방법이다 ==');
{
  const hi = makeOpponent(['C', 'R'], 60, rnd, uid, true, 2400);
  ok((hi.parts || []).length === 4, `끝 구간 몬스터가 파츠 ${(hi.parts || []).length}개를 낀다`);
  ok(hi.parts.every(p => p.rarity === 'SSR'), '끝 구간은 SSR 이다');
  ok(Object.values(hi.slots).filter(Boolean).length === hi.parts.length, '슬롯이 파츠와 맞물려 있다');
  const cap = CONST.MAXLV + (CONST.OPP_LV_OVER || 0);
  ok(B.every(r => r.lv < cap),
     `상대 레벨이 천장(${cap})에 닿지 않는다 — 최고 ${Math.max(...B.map(r => r.lv))}`);
  /* 파츠를 끼우기 전에는 끝판에서 레벨 90 이 필요했다. 지금은 내 레벨 근처다. */
  ok(Math.max(...B.map(r => r.lv)) <= CONST.MAXLV,
     '가장 센 구간도 만렙을 넘지 않는다 (예전에는 90 이 필요했다)');
}

console.log('\n== ⑤ 목표가 보이는가 ==');
{
  ok(bandOf(1000).i === 1 && bandOf(9999).i === B.length, '레이팅 양 끝이 첫·끝 구간이다');
  const n = bandNext(1000);
  ok(n && n.left > 0, `다음 구간까지 남은 레이팅을 알려 준다 (1000 에서 ${n && n.left})`);
  ok(bandNext(99999) === null, '끝 구간에서는 다음이 없다');
  console.log('  구간표 —');
  for (const r of B) {
    const nx = bandNext(r.at);
    console.log(`    ${String(bandOf(r.at).i).padStart(2)}  레이팅 ${String(r.at).padStart(4)}~${nx ? String(nx.at - 1).padStart(4) : '   ∞'}` +
                `  Lv.${String(r.lv).padStart(2)}  ${r.rars.join('·').padEnd(6)}  ${r.gear.n}x${r.gear.rar}+${r.gear.enh}`);
  }
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
