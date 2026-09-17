/* 대전 몬스터 구간표 설계 — 8구간 · 12구간을 짜고 실제로 돌려 본다.
 *
 * 사용자 지시: "티어나 계단별로 증가할 수 있도록 구간 안에서 스펙이 조절되게."
 *
 * ── 구간을 나누는 축 ──────────────────────────────────────
 * **레벨이 아니라 플레이 시간으로 나눈다.** 레벨은 뒤로 갈수록 비싸다 —
 * Lv.1→10 은 31판인데 Lv.50→60 은 122판이다(expNeed). 레벨을 똑같이 잘라 놓으면
 * 앞 구간은 몇 분, 뒷 구간은 몇 시간짜리가 된다.
 * 그래서 **누적 전투 수를 N 등분**해서 구간의 레벨 경계를 뽑는다.
 *
 * ── 구간 안에서 몬스터는 완전히 고정이다 ──────────────────
 * 지금은 `내 레벨 + 보정` 이라 내가 자라면 상대도 자란다(그래서 제자리걸음이다).
 * 구간제의 전부는 이 연결을 끊는 것이다. 구간 안에서 내 성장은 **온전히 남는다.**
 *
 * ── 장비 사다리는 절대 되돌리지 않는다 ────────────────────
 * 지금 RATING_GEAR 는 `4xR+4 → 2xSR+0` 처럼 개수를 줄이고 강화를 0 으로 되돌린다.
 * 강화는 단일 축 중 가장 크다(+0→+10 이 레벨 7.1 어치). 그걸 주기적으로 빼앗으니
 * 레이팅 2400 에서 승률이 33% 로 꺼졌다. 여기서는 세 축 전부 단조증가로만 짠다.
 *
 * node tools/bandplan.mjs          8구간·12구간 둘 다
 * node tools/bandplan.mjs 10       원하는 구간 수
 * node tools/bandplan.mjs --json   그래프용
 */
import { CONST, MONSTER_TYPES } from '../data/balance.js';
import { MONSTER_BY_RARITY } from '../js/units.js';
import { computeStats, expNeed, battleExp } from '../js/stats.js';
import { rollPart } from '../js/gacha.js';
import { makeUnit, simulate } from '../js/sim.js';

const ARG = process.argv.slice(2).filter(a => !a.startsWith('--'));
const JSON_OUT = process.argv.includes('--json');
const COUNTS = ARG.length ? ARG.map(Number) : [8, 12];

const EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const SLOTS = ['WEAPON', 'FRAME', 'BOOSTER', 'CORE'];
let sd = 20260918;
const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
let uc = 0; const uid = () => 'u' + (uc++);
const MY = 'azure';

/* ── 레벨 → 누적 전투 수. 구간을 시간으로 자르기 위한 자다. ── */
const CUM = [0];
for (let lv = 1; lv < CONST.MAXLV; lv++)
  CUM.push(CUM[lv - 1] + Math.ceil(expNeed(lv) / battleExp(lv)));
const battlesTo = lv => CUM[Math.min(CONST.MAXLV, Math.max(1, lv)) - 1];
const levelAt = b => { for (let lv = 1; lv <= CONST.MAXLV; lv++) if (CUM[lv - 1] >= b) return lv; return CONST.MAXLV; };

/* ── 장비 사다리. 구간 번호 → 그 구간을 **떠날 때** 갖췄을 장비.
      셋 다 단조증가다 — 되돌리지 않는 것이 이 설계의 핵심이다. ── */
function gearAt(t) {                      // t = 0..1 (진행도)
  const n   = t < 0.08 ? 0 : t < 0.16 ? 1 : t < 0.26 ? 2 : t < 0.38 ? 3 : 4;
  const rar = t < 0.22 ? 'C' : t < 0.48 ? 'R' : t < 0.75 ? 'SR' : 'SSR';
  const enh = Math.round(Math.max(0, (t - 0.12) / 0.88) * 10);
  return { n, rar, enh };
}
const gearKo = g => `${g.n}x${g.rar}+${g.enh}`;

/* 그 상태의 나. 파츠는 굴림이라 여러 벌 평균을 쓴다. */
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

/* 구간의 상대. 등급 풀에서 고른 몬스터들을 **고정 레벨**로 세운다. */
const poolOf = rar => (MONSTER_BY_RARITY[rar] || []).filter(k => MONSTER_TYPES[k].rarity !== 'BOSS');
function winVs(lv, g, foeLv, pool, ROLLS = 12, N = 60) {
  let w = 0, t = 0;
  for (let k = 0; k < ROLLS; k++) {
    const st = myStats(lv, g);
    for (let i = 0; i < N; i++) {
      const type = pool[Math.floor(rnd() * pool.length)] || 'enemy_reaper';
      const fs = computeStats({ type, level: foeLv, skillLv: 0, fat: 0, slots: EMPTY }, []);
      const ev = simulate(makeUnit('me', MY, st), makeUnit('f', type, fs),
                          (Math.floor(rnd() * 4294967296)) >>> 0);
      if (ev[ev.length - 1].winner === 'P') w++;
      t++;
    }
  }
  return w / t * 100;
}

const TARGET_IN = 45;                 // 구간에 막 들어왔을 때의 목표 승률
const FOE_MAX = CONST.MAXLV + (CONST.OPP_LV_OVER || 0);
/* 진입 승률이 목표에 닿는 상대 레벨을 이분 탐색한다. 승률은 레벨에 대해 단조감소다. */
function solveFoe(lv, g, pool, target) {
  let lo = 1, hi = FOE_MAX;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (winVs(lv, g, mid, pool, 6, 40) > target) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/* 등급 풀 — 진행도에 따라 올라간다. 보스는 넣지 않는다(파견 전용이다). */
function rarPool(t) {
  if (t < 0.18) return ['C'];
  if (t < 0.34) return ['C', 'UC'];
  if (t < 0.50) return ['UC', 'R'];
  if (t < 0.66) return ['R'];
  if (t < 0.80) return ['R', 'UQ'];
  if (t < 0.92) return ['UQ'];
  return ['UQ', 'EP'];
}

function plan(N) {
  const total = battlesTo(CONST.MAXLV);
  const bands = [];
  for (let i = 0; i < N; i++) {
    const lv0 = levelAt(Math.round(total * i / N));
    const lv1 = i === N - 1 ? CONST.MAXLV : levelAt(Math.round(total * (i + 1) / N)) - 1;
    const t0 = i / N, t1 = (i + 1) / N;
    const rars = rarPool((t0 + t1) / 2);
    const pool = rars.flatMap(poolOf);
    const gIn = gearAt(t0), gOut = gearAt(t1 - 0.001);
    /* **상대 레벨은 손으로 정하지 않고 역산한다.** 목표는 '진입 45%' 다.
       손으로 lv0+1 을 줘 봤더니 전 구간이 91~100% 였다 — 장비가 레벨 3~7 어치라
       내 레벨만 보고 세우면 상대가 한참 아래에 선다. 몬스터는 파츠를 못 끼므로
       그 몫을 레벨로 갚아야 하고, 얼마나 갚을지는 재서 정하는 것이 맞다. */
    const foeLv = solveFoe(lv0, gIn, pool, TARGET_IN);
    bands.push({ i: i + 1, lv0, lv1, foeLv, rars, pool,
                 gIn, gOut, battles: Math.round(total / N),
                 win0: winVs(lv0, gIn, foeLv, pool),
                 win1: winVs(lv1, gOut, foeLv, pool) });
  }
  return bands;
}

const out = {};
for (const N of COUNTS) {
  const b = plan(N);
  out[N] = b;
  if (JSON_OUT) continue;
  console.log(`\n═══ ${N}구간 ═══   (구간당 약 ${b[0].battles}판)\n`);
  console.log('구간  내 레벨   상대Lv  등급 풀      진입 장비     졸업 장비      진입    졸업   계단');
  b.forEach((x, i) => {
    const step = i === 0 ? '' : (x.win0 - b[i - 1].win1).toFixed(0) + '%p';
    console.log(
      String(x.i).padStart(3) +
      `  ${x.lv0}~${x.lv1}`.padEnd(10) +
      String(x.foeLv).padStart(5) + '   ' +
      x.rars.join('·').padEnd(11) +
      gearKo(x.gIn).padEnd(13) + gearKo(x.gOut).padEnd(14) +
      (x.win0.toFixed(0) + '%').padStart(6) + (x.win1.toFixed(0) + '%').padStart(7) +
      step.padStart(8));
  });
  const ins = b.map(x => x.win0), outs = b.map(x => x.win1);
  const steps = b.slice(1).map((x, i) => x.win0 - b[i].win1);
  console.log(`\n  진입 승률  평균 ${(ins.reduce((a, v) => a + v, 0) / ins.length).toFixed(0)}%` +
              `  (최저 ${Math.min(...ins).toFixed(0)}% · 최고 ${Math.max(...ins).toFixed(0)}%)`);
  console.log(`  졸업 승률  평균 ${(outs.reduce((a, v) => a + v, 0) / outs.length).toFixed(0)}%` +
              `  (최저 ${Math.min(...outs).toFixed(0)}% · 최고 ${Math.max(...outs).toFixed(0)}%)`);
  console.log(`  구간 계단  가장 큰 낙차 ${Math.min(...steps).toFixed(0)}%p`);
  console.log(`  막히는 구간(진입 25% 미만) ${ins.filter(v => v < 25).length}개` +
              ` · 싱거운 구간(졸업 98% 초과) ${outs.filter(v => v > 98).length}개`);
}
if (JSON_OUT) console.log(JSON.stringify(out, (k, v) => k === 'pool' ? undefined : v, 1));
