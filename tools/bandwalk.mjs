/* 구간제가 **실제 흐름에서도** 서는가 — 대전만 도는 사람 하나를 Lv.60 까지 걸려 본다.
 *
 * ── 이 도구가 한 번 틀렸다 (2026-09-18) ──────────────────
 * 처음 판은 "몬스터를 이기면 레이팅 +10" 으로 걸었다. **실제 서버는 몬스터 판에서 레이팅을
 * 움직이지 않는다**(server/battle.js — 로봇·사람 상대만). 그래서 그 판이 본 '경계 진동
 * 151번' 은 없는 증상이었고, 진짜 증상을 못 봤다 —
 *   레이팅은 로봇 판에서만 오르고, 로봇 판 승률이 85% 라 레이팅이 전투 수에 비례해 쌓였다.
 *   구간이 몬스터 성적과 무관하게 올라가, 앞 구간 94~100% · 뒤 구간 4~42% 였다.
 * **다시 틀리지 않게, 이 판은 규칙을 흉내 내지 않고 게임 코드를 그대로 부른다.**
 *   상대 — js/rewards.js makeOpponent · 구간 — js/rewards.js bandStep
 *
 * ── 두 가지를 잰다 ───────────────────────────────────────
 *   기본      몬스터 판만 — 구간이 어떻게 오르내리나. 몬스터 한 판 사이에 다른 판이
 *             (1/MONSTER_RATE − 1) 판 끼어 있다고 보고 그만큼 경험치를 준다
 *   --robot   생성 로봇 판만 — 레이팅이 어떻게 오르나(RATING_GEAR 가 정한다).
 *             사람 상대가 없는 초기가 가장 나쁜 경우라 사람 판은 넣지 않는다
 *
 * 장비는 누적 전투 수를 따라가는 사다리다(tools/bandplan.mjs 와 같은 자).
 *
 *   node tools/bandwalk.mjs            몬스터 구간 — 대전만 (가장 나쁜 경우)
 *   node tools/bandwalk.mjs 1          밖에서(전선·파견·원정) 경험치를 ×2 받는다
 *   node tools/bandwalk.mjs --robot    로봇 판의 레이팅 흐름
 *   --seed N                           시드를 바꾼다 */
import { CONST, ROBOT_TYPES } from '../data/balance.js';
import { computeStats, expNeed, battleExp } from '../js/stats.js';
import { rollPart } from '../js/gacha.js';
import { makeUnit, simulate } from '../js/sim.js';
import { makeOpponent, bandStep } from '../js/rewards.js';

const argv = process.argv.slice(2);
const flag = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const ROBOT = argv.includes('--robot');
const nums = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--seed');
const OUTSIDE = nums.length ? Number(nums[0]) : 0;
const SEED = Number(flag('--seed') || 20260918);
const MY = 'azure';

const EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const SLOTS = Object.keys(EMPTY);
let sd = SEED;
const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
let uc = 0; const uid = () => 'u' + (uc++);

const CUM = [0];
for (let lv = 1; lv < CONST.MAXLV; lv++) CUM.push(CUM[lv - 1] + Math.ceil(expNeed(lv) / battleExp(lv)));
const TOTAL = CUM[CONST.MAXLV - 1];
/* bandplan 의 gearAt 과 같은 사다리 — 세 축 모두 단조증가 */
function gearAt(t) {
  const n   = t < 0.08 ? 0 : t < 0.16 ? 1 : t < 0.26 ? 2 : t < 0.38 ? 3 : 4;
  const rar = t < 0.22 ? 'C' : t < 0.48 ? 'R' : t < 0.75 ? 'SR' : 'SSR';
  return { n, rar, enh: Math.round(Math.max(0, (t - 0.12) / 0.88) * 10) };
}
const gearKo = g => `${g.n}x${g.rar}+${g.enh}`;
function stats(type, lv, g, skillLv) {
  const slots = { ...EMPTY }, parts = [], free = SLOTS.slice();
  for (let i = 0; i < g.n && free.length; i++) {
    const sl = free.shift();
    const p = rollPart(lv, rnd, uid(), g.rar, sl); p.enh = g.enh;
    parts.push(p); slots[sl] = p.uid;
  }
  return computeStats({ uid: 'x', type, level: lv, fat: 0, skillLv, slots }, parts);
}
function fight(level, rating, band, wantMonster) {
  const g = gearAt(Math.min(1, CUM[level - 1] / TOTAL));
  const me = stats(MY, level, g, Math.min(CONST.SKILL_UP.max, Math.floor(g.enh * 0.8)));
  let o;
  do o = makeOpponent([ROBOT_TYPES[MY].rarity], level, rnd, uid, wantMonster, rating, band);
  while (!wantMonster && o.kind === 'monster');
  const os = computeStats({ uid: 'o', type: o.type, level: o.level, fat: 0,
                            skillLv: o.skillLv | 0, slots: o.slots }, o.parts);
  const ev = simulate(makeUnit('me', MY, me), makeUnit('o', o.type, os), (Math.floor(rnd() * 4294967296)) >>> 0);
  return { win: ev[ev.length - 1].winner === 'P', gear: gearKo(g) };
}
const G = s => `\x1b[32m${s}\x1b[0m`, R = s => `\x1b[31m${s}\x1b[0m`;
let level = 1, exp = 0, n = 0;
const grow = mult => {
  exp += Math.round(battleExp(level) * mult * (1 + OUTSIDE));
  while (level < CONST.MAXLV && exp >= expNeed(level)) { exp -= expNeed(level); level++; }
};

if (ROBOT) {
  /* ── 로봇 판 — 레이팅 흐름 ── 생성 로봇은 rating=null 이라 기대 0.5 → ±K/2 */
  const STEP = Math.round(CONST.RATING_K.pve * 0.5);
  let rating = 1000, win40 = [], worst = 0;
  console.log(`\n생성 로봇 판만 — 밖에서 받는 경험치 ×${(1 + OUTSIDE).toFixed(1)}`);
  console.log('   판수  Lv   내 장비       레이팅   최근 40판');
  while (n < 5000 && level < CONST.MAXLV) {
    const f = fight(level, rating, null, false);
    rating = Math.max(0, rating + (f.win ? STEP : -STEP));
    win40.push(f.win); grow(1); n++;
    if (n % 40 === 0) {
      const wr = win40.filter(Boolean).length / win40.length; win40 = [];
      worst = Math.max(worst, wr);
      console.log(`  ${String(n).padStart(5)}  ${String(level).padStart(2)}   ${f.gear.padEnd(12)} ${String(rating).padStart(6)}   ${(wr * 100).toFixed(0).padStart(3)}%`);
    }
  }
  console.log(`\n  도달 — Lv.${level} · 레이팅 ${rating} · ${n}판 · 40판 창 최고 승률 ${(worst * 100).toFixed(0)}%`);
  /* 예전 표(되돌림 네 줄)는 1620~2400 에서 90~100% 로 치솟았다. 그러면 레이팅이 실력과
     무관하게 쌓여 랭킹이 '판 수' 가 된다. */
  if (worst > 0.88) { console.log(R('  ✗ 로봇 판이 한 구간에서 거의 전승이다 — RATING_GEAR 에 약해지는 줄이 있다')); process.exit(1); }
  console.log(G('  ✓ 로봇 판 승률이 튀지 않는다'));
  process.exit(0);
}

/* ── 몬스터 판 — 구간 흐름 ── */
let band = 1, pts = 0;
const log = [];
const between = 1 / CONST.MONSTER_RATE;          // 몬스터 한 판 사이에 치르는 판 수(자기 포함)
while (n < 3000 && level < CONST.MAXLV) {
  const f = fight(level, null, band, true);
  log.push({ b: band, win: f.win, lv: level, gear: f.gear });
  const st = bandStep(band, pts, f.win);
  band = st.band; pts = st.pts;
  grow(between); n++;
}
const runs = [];
for (const m of log) {
  const r = runs[runs.length - 1];
  if (!r || r.b !== m.b) runs.push({ b: m.b, t: 1 }); else r.t++;
}
const down = runs.filter((r, i) => i && r.b < runs[i - 1].b).length;
const churn = runs.filter(r => r.t <= 2).length;
console.log(`\n대전만 도는 사람 — 밖에서 받는 경험치 ×${(1 + OUTSIDE).toFixed(1)} · 몬스터 판 ${n}판 (다른 판 포함 약 ${Math.round(n * between)}판)`);
console.log('\n구간  상대Lv  머문판  승률   처음6판  승급직전6판   내 Lv      내 장비');
const B = CONST.MON_BAND;
let stuck = 0, flat = 0;
for (let i = 1; i <= B.length; i++) {
  const L = log.filter(m => m.b === i);
  if (!L.length) continue;
  const wr = a => a.filter(m => m.win).length / a.length;
  const f6 = wr(L.slice(0, 6)), l6 = wr(L.slice(-6)), all = wr(L);
  if (L.length >= 30 && all < 0.35) stuck++;
  if (i > 1 && i < B.length && f6 >= 1 && L.length > 6) flat++;
  const pc = v => (v * 100).toFixed(0).padStart(3) + '%';
  console.log(`${String(i).padStart(3)}   ${String(B[i - 1].lv).padStart(5)}  ${String(L.length).padStart(6)}  ${pc(all)}   ${pc(f6)}     ${pc(l6)}      Lv.${L[0].lv}~${L[L.length - 1].lv}`.padEnd(66) + L[L.length - 1].gear);
}
console.log(`\n  도달 — Lv.${level} · 구간 ${band}/${B.length}`);
console.log(`  구간 전환 ${runs.length - 1}번 (강등 ${down}) · 2판 이하만 머문 것 ${churn}번`);

/* 판정 — 구간제가 약속한 셋.
     ① 대전만 해도 끝 구간에 닿는다 (파밍은 강제가 아니라 가속)
     ② 한 구간에 갇히지 않는다 (30판 넘게 머물며 35% 미만)
     ③ 경계에서 흔들리지 않는다 (2판 이하 체류가 구간 수를 넘지 않는다) */
let bad = 0;
if (!OUTSIDE && band < B.length) { console.log(R(`  ✗ 대전만으로는 끝 구간에 못 닿는다 (${band}/${B.length})`)); bad++; }
if (stuck) { console.log(R(`  ✗ 갇힌 구간 ${stuck}개`)); bad++; }
if (churn > B.length) { console.log(R(`  ✗ 경계에서 흔들린다 — 2판 이하 체류 ${churn}번`)); bad++; }
if (!OUTSIDE && flat > 3) console.log(`  · 처음 6판을 전승한 구간 ${flat}개 — 들어갈 때 이미 너무 세다`);
if (bad) process.exit(1);
console.log(G('  ✓ 구간이 실력을 따라간다 — 끝 구간 도달 · 갇힘 없음 · 경계 흔들림 없음'));
