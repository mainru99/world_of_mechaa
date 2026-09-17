/* 구간제가 **실제 레이팅 흐름에서도** 서는가 — 대전만 도는 사람 하나를 끝까지 걸려 본다.
 *
 * ── 왜 이걸 따로 재나 ────────────────────────────────────
 * `tools/bandplan.mjs` 는 구간을 **누적 전투 수**로 나눠 놓고 잰다("구간 3 은 Lv.20~25").
 * 그런데 실제로 구간을 고르는 것은 **레이팅**이다(`CONST.MON_BAND` 의 `at`).
 * 둘이 같은 속도로 가는지를 재 본 적이 없다. 안 맞으면 표의 승률은 전부 헛값이다 —
 * 표는 Lv.20 이 3구간에 온다고 보는데 실제로 Lv.9 가 온다면, 그 사람이 만나는 것은
 * 3구간 몬스터(Lv.23)다.
 *
 * ── 어떻게 재나 ──────────────────────────────────────────
 * 한 판마다 이 순서다.
 *   1. 지금 레이팅으로 구간을 고른다      (bandOf — 게임이 하는 그대로)
 *   2. 그 구간의 몬스터와 붙는다          (simulate)
 *   3. 이기면 레이팅 +10 · 지면 −10       (ratingDelta, 몬스터는 rating=null 이라 기대 0.5)
 *   4. 경험치를 받아 레벨을 올린다        (battleExp / expNeed)
 * 장비는 `bandplan` 과 같은 사다리(누적 전투 수 기준)를 쓴다 — 그래야 달라지는 것이
 * **구간을 고르는 축 하나**뿐이라 원인이 갈린다.
 *
 * ── 이 도구가 보는 범위 ──────────────────────────────────
 * **몬스터 판만 본다.** 실제 대전은 `CONST.MONSTER_RATE`(0.4) 만큼만 몬스터로 고정이고,
 * 나머지는 아레나에 등록된 사람을 먼저 찾는다(없으면 몬스터로 떨어진다). 그러니 여기 숫자는
 * **가장 나쁜 경우**다 — 등록자가 적은 초기, 그리고 사람 상대를 못 찾는 시간대가 그렇다.
 * 다만 사람 상대로 얻은 레이팅도 문턱을 넘기므로, 진동 자체는 사람 판이 섞여도 남는다.
 *
 * ── 읽는 법 ──────────────────────────────────────────────
 * `구간승률` 이 25% 아래로 오래 머물면 그 구간에서 막힌 것이다. 레이팅은 지면
 * 내려가므로 영영 못 나가지는 않지만, **이기지도 지지도 못하고 진동한다.**
 *
 *   node tools/bandwalk.mjs            대전만 (가장 나쁜 경우)
 *   node tools/bandwalk.mjs 0.5        판마다 0.5 판어치 경험치를 밖에서 더 받는다
 *                                      (전선·파견·원정으로 레벨만 오르는 몫)
 *   node tools/bandwalk.mjs --json     그래프용
 */
import { CONST, MONSTER_TYPES } from '../data/balance.js';
import { MONSTER_BY_RARITY } from '../js/units.js';
import { computeStats, expNeed, battleExp } from '../js/stats.js';
import { rollPart } from '../js/gacha.js';
import { makeUnit, simulate } from '../js/sim.js';
import { bandOf } from '../js/rewards.js';

const ARG = process.argv.slice(2).filter(a => !a.startsWith('--'));
const JSON_OUT = process.argv.includes('--json');
const OUTSIDE = ARG.length ? Number(ARG[0]) : 0;   // 밖에서 들어오는 경험치 배수
const MAX_BATTLES = 4000;

const EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const SLOTS = ['WEAPON', 'FRAME', 'BOOSTER', 'CORE'];
let sd = 20260918;
const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
let uc = 0; const uid = () => 'u' + (uc++);
const MY = 'azure';

/* 레벨 → 누적 전투 수. 장비 사다리의 자다(bandplan 과 같은 자를 쓴다). */
const CUM = [0];
for (let lv = 1; lv < CONST.MAXLV; lv++)
  CUM.push(CUM[lv - 1] + Math.ceil(expNeed(lv) / battleExp(lv)));
const TOTAL = CUM[CONST.MAXLV - 1];

/* bandplan 의 gearAt 과 같은 사다리 — 세 축 모두 단조증가. */
function gearAt(t) {
  const n   = t < 0.08 ? 0 : t < 0.16 ? 1 : t < 0.26 ? 2 : t < 0.38 ? 3 : 4;
  const rar = t < 0.22 ? 'C' : t < 0.48 ? 'R' : t < 0.75 ? 'SR' : 'SSR';
  const enh = Math.round(Math.max(0, (t - 0.12) / 0.88) * 10);
  return { n, rar, enh };
}
const gearKo = g => `${g.n}x${g.rar}+${g.enh}`;

function myStats(lv, g) {
  const slots = { ...EMPTY }, parts = [], free = SLOTS.slice();
  for (let i = 0; i < g.n && free.length; i++) {
    const sl = free.shift();
    const p = rollPart(lv, rnd, uid(), g.rar, sl); p.enh = g.enh;
    parts.push(p); slots[sl] = p.uid;
  }
  const skillLv = Math.min(CONST.SKILL_UP.max, Math.floor(g.enh * 0.8));
  return computeStats({ uid: 'me', type: MY, level: lv, fat: 0, skillLv, slots }, parts);
}

const poolOf = rar => (MONSTER_BY_RARITY[rar] || []).filter(k => MONSTER_TYPES[k].rarity !== 'BOSS');
function foeStats(type, lv, fg) {
  const slots = { ...EMPTY }, parts = [], free = SLOTS.slice();
  for (let i = 0; i < (fg ? fg.n : 0) && free.length; i++) {
    const sl = free.shift();
    const p = rollPart(lv, rnd, uid(), fg.rar, sl); p.enh = fg.enh;
    parts.push(p); slots[sl] = p.uid;
  }
  return computeStats({ type, level: lv, skillLv: 0, fat: 0, slots }, parts);
}

/* ── 한 사람을 끝까지 걸린다 ── */
let level = 1, exp = 0, rating = 1000, battles = 0;
const K = CONST.RATING_K.pve;
const STEP = Math.round(K * 0.5);          // 몬스터는 rating=null → 기대 0.5 → ±K/2
const rows = [];
let cur = null;                            // 지금 구간의 누적

while (battles < MAX_BATTLES && level < CONST.MAXLV) {
  const band = bandOf(rating);
  if (!band) break;
  if (!cur || cur.i !== band.i) {
    if (cur) rows.push(cur);
    cur = { i: band.i, at: band.at, foeLv: band.lv, inLv: level, inRating: rating,
            inBattles: battles, w: 0, t: 0 };
  }
  const t = Math.min(1, CUM[Math.min(CONST.MAXLV, level) - 1] / TOTAL);
  const g = gearAt(t);
  cur.gear = gearKo(g);
  const pool = band.rars.flatMap(poolOf);
  const type = pool[Math.floor(rnd() * pool.length)] || 'enemy_reaper';
  const ev = simulate(makeUnit('me', MY, myStats(level, g)),
                      makeUnit('f', type, foeStats(type, band.lv, band.gear)),
                      (Math.floor(rnd() * 4294967296)) >>> 0);
  const win = ev[ev.length - 1].winner === 'P';

  rating = Math.max(0, rating + (win ? STEP : -STEP));
  exp += Math.round(battleExp(level) * (1 + OUTSIDE));
  while (level < CONST.MAXLV && exp >= expNeed(level)) { exp -= expNeed(level); level++; }
  battles++;
  cur.w += win ? 1 : 0; cur.t++;
  cur.outLv = level; cur.outRating = rating;
}
if (cur) rows.push(cur);

if (JSON_OUT) { console.log(JSON.stringify({ outside: OUTSIDE, battles, level, rating, rows })); process.exit(0); }

const G = s => `\x1b[32m${s}\x1b[0m`, R = s => `\x1b[31m${s}\x1b[0m`, Y = s => `\x1b[33m${s}\x1b[0m`;
console.log(`\n대전만 도는 사람 하나 — 밖에서 받는 경험치 ×${(1 + OUTSIDE).toFixed(1)} · 최대 ${MAX_BATTLES}판`);

/* bandplan 의 레벨 경계 — 누적 전투 수를 구간 수로 등분한 값 */
const N = CONST.MON_BAND.length;
const planLv = i => { const b = TOTAL * i / N; for (let L = 1; L <= CONST.MAXLV; L++) if (CUM[L - 1] >= b) return L; return CONST.MAXLV; };

/* 구간별로 합친다 — 같은 구간을 여러 번 드나든 것을 한 줄로 본다. */
const agg = new Map();
for (const r of rows) {
  const a = agg.get(r.i) || { i: r.i, foeLv: r.foeLv, visits: 0, w: 0, t: 0, firstLv: r.inLv, gear: r.gear };
  a.visits++; a.w += r.w; a.t += r.t; a.gear = r.gear || a.gear;
  agg.set(r.i, a);
}
console.log('\n구간  드나든횟수  머문판수  처음 들어온 Lv   bandplan 이 본 Lv   상대Lv   내 장비        승률');
let mismatch = 0;
for (const a of [...agg.values()].sort((x, y) => x.i - y.i)) {
  const wr = a.t ? a.w / a.t * 100 : 0;
  const want = planLv(a.i - 1), gap = a.firstLv - want;
  if (Math.abs(gap) >= 5) mismatch++;
  const wrs = wr < 25 ? R(wr.toFixed(1) + '%') : wr > 90 ? Y(wr.toFixed(1) + '%') : G(wr.toFixed(1) + '%');
  console.log(
    String(a.i).padStart(3), String(a.visits).padStart(10), String(a.t).padStart(9),
    `      Lv.${String(a.firstLv).padStart(2)}`.padEnd(16),
    `Lv.${want}~${planLv(a.i)}`.padEnd(19),
    String(a.foeLv).padStart(5), '   ' + String(a.gear || '-').padEnd(13), wrs,
    Math.abs(gap) >= 5 ? R(`  ← 설계보다 ${gap > 0 ? '+' : ''}${gap}레벨`) : '');
}

/* ── 경계 진동 — 이 설계의 진짜 증상이다 ──
   한 판 이기고 문턱을 넘었다가 한 판 지고 되돌아오기를 되풀이하면, 플레이어가 보는 것은
   '이길 판'과 '질 판'이 번갈아 오는 것이다. 고를 것이 없으니 재미가 아니라 대기다. */
const flips = rows.length - 1;
const churn = rows.filter(r => r.t <= 2).length;
const decisive = rows.filter(r => r.t <= 2 && (r.w === r.t || r.w === 0))
                     .reduce((s, r) => s + r.t, 0);
console.log(`\n  도달 — Lv.${level} · 레이팅 ${rating} · ${battles}판`);
console.log(`  구간을 넘나든 횟수 ${flips}번 · 그중 2판 이하만 머문 것 ${churn}번`);
console.log(`  거의 정해진 판(2판 이하 체류에서 전승 또는 전패) ${decisive}판 = 전체의 ${(decisive / battles * 100).toFixed(0)}%`);
console.log(`  설계 레벨과 5 이상 어긋나게 들어간 구간 ${mismatch}개 / ${agg.size}개`);

const bad = churn >= agg.size || mismatch > 0;
if (bad) {
  console.log(R('\n  ✗ 구간표의 레이팅 문턱과 레벨 진행 속도가 안 맞는다.'));
  console.log('    bandplan 은 구간을 **누적 전투 수**로 나눠 재는데, 실제 구간은 **레이팅**이 고른다.');
  console.log('    한 판 이기면(+10) 문턱을 넘고 한 판 지면(−10) 되돌아오므로 경계에서 진동한다.');
  console.log('    손잡이는 셋 — MON_BAND 의 `at`(문턱 간격) · 구간 사이 `lv` 낙차 · CONST.RATING_K.pve.');
  console.log('    셋 다 수치라 ChatGPT 담당이다. 다시 재는 것은 이 도구다.');
  process.exit(1);
}
console.log(G('\n  ✓ 레이팅 문턱과 레벨 진행이 같은 속도로 간다.'));
