/* 대전 몬스터 구간표 자가 점검 — **구조**를 본다(난이도는 tools/bandplan.mjs 가 잰다).
 *
 * 이 기능의 약속은 셋이다.
 *   ① **구간 안에서 상대가 안 움직인다.** 내가 자라도 그대로다 — 그게 구간제의 전부다.
 *      이게 깨지면 예전의 제자리걸음(레이팅 2400 승률 33% 골짜기)으로 돌아간다.
 *   ② **표가 뒤로 가지 않는다.** 예전 RATING_GEAR 는 개수를 줄이며 등급을 올리고
 *      강화를 0 으로 되돌렸다. 가장 큰 축(강화 +0→+10 이 레벨 7.1 어치)을 주기적으로
 *      빼앗는 표였고, 그 되돌림이 승률 계단의 정체였다. 로봇 상대 표(RATING_GEAR)도 같이 본다.
 *   ③ **구간은 몬스터 판 승패로 움직인다**(bandStep). 레이팅은 몬스터 판에서 안 움직여서,
 *      레이팅으로 고르면 구간이 몬스터 성적과 무관해진다 — 실제로 그랬다.
 *
 * node tools/bandcheck.mjs */
import { CONST, MONSTER_TYPES, RARITY } from '../data/balance.js';
import { computeStats, powerOf } from '../js/stats.js';
import { bandRow, bandStart, bandStep, bandGoal, gearFromRating, makeOpponent } from '../js/rewards.js';

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

console.log('\n== ②-b 로봇 상대 장비표(RATING_GEAR)도 뒤로 가지 않는다 ==');
{
  const T = CONST.RATING_GEAR || [];
  let dN = 0, dR = 0, dE = 0, dS = 0;
  for (let i = 1; i < T.length; i++) {
    const a = T[i - 1], b = T[i];
    if (b.n < a.n) dN++;
    if (RAR_I.indexOf(b.rar) < RAR_I.indexOf(a.rar)) dR++;
    if (b.enh < a.enh) dE++;
    if ((b.skillLv | 0) < (a.skillLv | 0)) dS++;
  }
  ok(T.every((r, i) => i === 0 || r.at > T[i - 1].at), 'RATING_GEAR 문턱이 오름차순이다');
  ok(dN + dR + dE + dS === 0,
     `개수·등급·강화·스킬 어느 것도 줄지 않는다 (개수 ${dN} · 등급 ${dR} · 강화 ${dE} · 스킬 ${dS})` +
     ' — 예전 표는 1620·1880·2400 에서 강화를 0 으로 되돌려 로봇 판이 90~100% 가 됐다');
  const g1 = gearFromRating(1600), g2 = gearFromRating(2500);
  ok(g2.n >= g1.n && RAR_I.indexOf(g2.rar) > RAR_I.indexOf(g1.rar),
     `gearFromRating 이 표를 읽는다 (${g1.n}x${g1.rar} → ${g2.n}x${g2.rar})`);
}

console.log('\n== ③ 구간 안에서 상대가 안 움직인다 ==');
{
  /* 같은 구간에서 **내 레벨만** 바꿔 여러 번 뽑는다. 상대 레벨이 따라 움직이면
     구간제가 아니다(흔들림 ±1 만 허용한다). */
  let worst = 0, sample = null;
  for (const b of [1, 4, 7, 10, 12]) {
    const lvs = [];
    for (const myLv of [5, 15, 25, 35, 45, 55]) {
      for (let k = 0; k < 8; k++) lvs.push(makeOpponent(['C', 'R'], myLv, rnd, uid, true, 1000, b).level);
    }
    const spread = Math.max(...lvs) - Math.min(...lvs);
    if (spread > worst) { worst = spread; sample = b; }
  }
  ok(worst <= 2, `내 레벨이 5→55 로 변해도 상대 레벨이 안 따라온다 (가장 흔들린 폭 ${worst}, 구간 ${sample})`);

  /* 구간이 오르면 상대가 세져야 한다. 안 그러면 구간이 뜻이 없다. */
  const lv = [1, 6, 11].map(b => bandRow(b).lv);
  ok(lv[0] < lv[1] && lv[1] < lv[2], `구간이 오르면 상대가 세진다 (Lv.${lv.join(' → ')})`);
  /* **레이팅이 아니라 구간 칸이 고른다.** 레이팅 2400 이어도 구간 2 면 구간 2 몬스터다. */
  const o = makeOpponent(['C'], 30, rnd, uid, true, 2400, 2);
  ok(o.band === 2 && o.level <= bandRow(2).lv + 1,
     `레이팅이 높아도 구간 칸이 이긴다 (레이팅 2400 · 구간 2 → 구간 ${o.band} Lv.${o.level})`);
}

console.log('\n== ③-b 승급·강등 (bandStep) ==');
{
  const S = CONST.MON_BAND_STEP;
  ok(S && S.up > S.down && S.down >= 2, `승급 ${S && S.up}승 · 강등 ${S && S.down}패 — 올라가기가 내려가기보다 멀다`);
  let b = 3, p = 0, moved = 0;
  for (let k = 0; k < S.up; k++) ({ band: b, pts: p, moved } = bandStep(b, p, true));
  ok(b === 4 && p === 0 && moved === 1, `${S.up}연승이면 한 구간 오르고 점수가 0 이 된다 (→ 구간 ${b}, 점수 ${p})`);
  ({ band: b, pts: p, moved } = bandStep(4, 0, false));
  ok(b === 4 && p === -1 && moved === 0, '**올라가자마자 한 판 져도 안 떨어진다** — 경계 흔들림이 없다');
  b = 4; p = 0;
  for (let k = 0; k < S.down; k++) ({ band: b, pts: p, moved } = bandStep(b, p, false));
  ok(b === 3 && moved === -1, `${S.down}연패면 한 구간 내려간다 (→ 구간 ${b})`);
  ({ band: b, pts: p } = bandStep(3, 1, false));
  ok(b === 3 && p === 0, '이기고 지면 제자리다');
  let e = bandStep(1, -(S.down - 1), false);
  ok(e.band === 1 && e.pts === -(S.down - 1), '첫 구간 바닥에서는 점수가 문턱 앞에서 멈춘다');
  e = bandStep(B.length, S.up - 1, true);
  ok(e.band === B.length && e.pts === S.up - 1, '끝 구간 꼭대기에서도 점수가 문턱 앞에서 멈춘다');
  ok(bandStart(null, 1000) === 1 && bandStart(null, 2400) === B.length && bandStart(5, 2400) === 5,
     '칸이 비면 레이팅으로 자리를 잡고, 칸이 있으면 칸을 따른다');
  ok(bandStart(99, 1000) === B.length && bandStart(0, 1000) === 1, '엉뚱한 값은 표 안으로 잘린다');
}

console.log('\n== ④ 몬스터가 파츠를 낀다 — 레벨 천장을 푼 방법이다 ==');
{
  const hi = makeOpponent(['C', 'R'], 60, rnd, uid, true, 1000, B.length);
  ok((hi.parts || []).length === 4, `끝 구간 몬스터가 파츠 ${(hi.parts || []).length}개를 낀다`);
  ok(hi.parts.every(p => p.rarity === 'SSR'), '끝 구간은 SSR 이다');
  ok(Object.values(hi.slots).filter(Boolean).length === hi.parts.length, '슬롯이 파츠와 맞물려 있다');
  const cap = CONST.MAXLV + (CONST.OPP_LV_OVER || 0);
  ok(B.every(r => r.lv < cap), `상대 레벨이 천장(${cap})에 닿지 않는다 — 최고 ${Math.max(...B.map(r => r.lv))}`);
  ok(Math.max(...B.map(r => r.lv)) <= CONST.MAXLV, '가장 센 구간도 만렙을 넘지 않는다 (예전에는 90 이 필요했다)');
}

console.log('\n== ⑤ 목표가 보이는가 ==');
{
  const g = bandGoal(3, 2);
  ok(g.up === CONST.MON_BAND_STEP.up - 2 && g.down === CONST.MON_BAND_STEP.down + 2,
     `승급까지 ${g.up}승 · 강등까지 ${g.down}패 를 알려 준다 (구간 3, 점수 +2)`);
  ok(bandGoal(1, 0).down === null && bandGoal(B.length, 0).up === null, '첫 구간엔 강등이, 끝 구간엔 승급이 없다');
  console.log('  구간표 —');
  for (let i = 1; i <= B.length; i++) {
    const r = bandRow(i);
    console.log(`    ${String(i).padStart(2)}  첫 자리 레이팅 ${String(r.at).padStart(4)}` +
                `  Lv.${String(r.lv).padStart(2)}  ${r.rars.join('·').padEnd(6)}  ${r.gear.n}x${r.gear.rar}+${r.gear.enh}`);
  }
}

console.log(bad ? `\n✗ ${bad}건 실패` : '\n전부 통과');
process.exitCode = bad ? 1 : 0;
