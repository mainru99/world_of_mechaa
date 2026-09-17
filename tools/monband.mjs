/* 대전 상대(몬스터)가 나를 따라 세지는가 — 구간 관리를 위한 측정.
 *
 * 사용자 지적: "내 기체가 강해질 때마다 같이 강해지다 보니 일정 구간에선 역전이 일어난다."
 *
 * 지금 구조는 이렇다.
 *   상대 레벨 = 내 레벨 + 등급보정 + 흔들림(±1) + **내 장비를 레벨로 환산한 값**
 *   그 환산값은 `RATING_GEAR`(레이팅 구간표) → `partLevelValue` 로 나온다.
 * 즉 **파츠는 이미 구간제인데 레벨은 연속**이다. 둘이 섞이면서 구간이 바뀌는 자리마다
 * 상대가 계단으로 뛰고, 그 계단이 내 성장보다 가파르면 역전이 난다.
 *
 * 여기서 재는 것 — 진행 단계마다
 *   ① 내 공격력      ② 생성된 몬스터 상대의 공격력      ③ 실제 승률
 *
 * node tools/monband.mjs            표
 * node tools/monband.mjs --json     그래프용 JSON
 */
import { CONST, ROBOT_TYPES, MONSTER_TYPES } from '../data/balance.js';
import { computeStats, powerOf, atkRange } from '../js/stats.js';
import { rollPart } from '../js/gacha.js';
import { makeOpponent, gearFromRating } from '../js/rewards.js';
import { makeUnit, simulate, mulberry32 } from '../js/sim.js';

const JSON_OUT = process.argv.includes('--json');
/* `--enh N` 을 주면 **내 파츠의 강화만** N 으로 고정한다. 상대는 그대로다.
   RATING_GEAR 표가 구간마다 강화를 0 으로 되돌리는데(4xR+4 → 2xSR+0), 그 되돌림이
   승률 계단의 원인인지 가르기 위한 손잡이다. */
const ENH_ARG = process.argv.indexOf('--enh');
const FORCE_ENH = ENH_ARG >= 0 ? parseInt(process.argv[ENH_ARG + 1], 10) : null;
const EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const SLOTS = ['WEAPON', 'FRAME', 'BOOSTER', 'CORE'];
let sd = 20260917;
const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
let uc = 0; const uid = () => 'u' + (uc++);

/* 진행 단계. 레벨과 레이팅은 같이 오른다 — 이겨야 레이팅이 오르고, 이기려면 커야 한다.
   RATING_GEAR 의 문턱을 그대로 밟도록 잡아, 구간이 바뀌는 자리가 표에 드러나게 한다. */
const STAGES = CONST.RATING_GEAR.map((row, i) => ({
  rating: row.at || 1000,
  level: Math.min(CONST.MAXLV, Math.max(1, Math.round(1 + i * (CONST.MAXLV - 1) / (CONST.RATING_GEAR.length - 1)))),
  gear: row,
}));

/* 그 단계의 '나'. 상대 장비표(RATING_GEAR)와 같은 장비를 낀 것으로 본다 —
   그 표가 곧 '이 레이팅대의 사람은 이만큼 갖췄다' 는 뜻이기 때문이다. */
function me(type, stage) {
  const slots = { ...EMPTY }, parts = [];
  const g = stage.gear;
  const free = SLOTS.slice();
  for (let i = 0; i < (g.n | 0) && free.length; i++) {
    const sl = free.shift();
    const p = rollPart(stage.level, rnd, uid(), g.rar, sl);
    p.enh = FORCE_ENH != null ? FORCE_ENH : (g.enh | 0); parts.push(p); slots[sl] = p.uid;
  }
  const rb = { uid: 'me', type, level: stage.level, fat: 0, skillLv: g.skillLv | 0, slots };
  return { rb, parts, stats: computeStats(rb, parts) };
}

const OWNED = ['C', 'UC', 'R'];
const MY = 'azure';
const N = 300;

const ROLLS = 24;          // 내 파츠도 굴림이다. 한 벌만 보면 굴림 운이 곡선으로 보인다
const rows = [];
for (const st of STAGES) {
  /* 내 쪽도 여러 벌 굴려 평균을 쓴다. 한 벌만 재면 '표가 내려간 자리' 와
     '그냥 나쁘게 굴린 자리' 를 못 가른다. */
  const mine = Array.from({ length: ROLLS }, () => me(MY, st));
  const m = mine[0];
  const myAtk = mine.reduce((t, x) => t + x.stats.atk, 0) / ROLLS;
  const myPow = mine.reduce((t, x) => t + powerOf(x.stats), 0) / ROLLS;
  let oAtk = 0, oPow = 0, oLv = 0, win = 0, n = 0;
  for (let i = 0; i < N; i++) {
    const opp = makeOpponent(OWNED, st.level, rnd, uid, true, st.rating);   // true = 몬스터 고정
    const os = computeStats({ type: opp.type, level: opp.level, skillLv: 0, fat: 0, slots: EMPTY }, []);
    oAtk += os.atk; oPow += powerOf(os); oLv += opp.level; n++;
    const P = makeUnit('me', MY, mine[i % ROLLS].stats), E = makeUnit('opp', opp.type, os);
    const ev = simulate(P, E, (Math.floor(rnd() * 4294967296)) >>> 0);
    if (ev[ev.length - 1].winner === 'P') win++;
  }
  rows.push({ rating: st.rating, level: st.level,
              gear: `${st.gear.n}x${st.gear.rar}+${FORCE_ENH != null ? FORCE_ENH : st.gear.enh}`,
              myAtk: Math.round(myAtk), myPow: Math.round(myPow),
              oppAtk: Math.round(oAtk / n), oppPow: Math.round(oPow / n),
              oppLv: +(oLv / n).toFixed(1), ratio: +(oAtk / n / myAtk).toFixed(3),
              win: +(win / n * 100).toFixed(1) });
}

if (JSON_OUT) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }

console.log(`대전 몬스터 상대 — 진행 단계별 (기체 ${ROBOT_TYPES[MY].name} · 단계당 ${N}판)\n`);
console.log('레이팅  Lv  내 장비      내공격  상대공격  상대Lv  상대/내  승률');
for (const r of rows) {
  const flag = r.win < 35 ? ' ← 역전' : r.win > 80 ? ' ← 싱거움' : '';
  console.log(
    String(r.rating).padStart(6) + String(r.level).padStart(4) + '  ' +
    r.gear.padEnd(11) + String(r.myAtk).padStart(7) + String(r.oppAtk).padStart(9) +
    String(r.oppLv).padStart(8) + String(r.ratio.toFixed(2)).padStart(9) +
    (r.win.toFixed(1) + '%').padStart(8) + flag);
}

/* 역전 — 상대 공격력이 내 공격력을 넘는 구간 */
const over = rows.filter(r => r.ratio > 1);
console.log(`\n상대 공격력이 내 것을 넘는 단계: ${over.length} / ${rows.length}` +
            (over.length ? ` (레이팅 ${over.map(r => r.rating).join(', ')})` : ''));
const dips = rows.filter((r, i) => i > 0 && r.win < rows[i - 1].win - 12);
console.log(`앞 단계보다 승률이 12%p 넘게 떨어지는 계단: ${dips.length}` +
            (dips.length ? ` (레이팅 ${dips.map(r => r.rating).join(', ')})` : ''));
