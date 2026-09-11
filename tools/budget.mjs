/* 파츠 베이스가 **같은 예산 위에 있는가**를 잰다.

   개편 전에는 슬롯마다 강제 대가(SLOT_COST)가 있어서 "강한 장점에는 단점을"이
   구조로 지켜졌다. 베이스마다 수치를 손으로 적는 방식에서는 그 강제가 사라진다.
   실제로 설계안 초안을 그대로 재 보니 **같은 슬롯 안에서 22.2%p** 가 벌어졌다
   (레일건 74.0% · 브레이커 51.8%). 그러면 슬롯마다 정답이 하나씩 생겨서,
   이번 개편이 없애려던 상태로 되돌아간다.

   그래서 대가를 '굴림 규칙'에서 '설계 규칙 + 자동 검사'로 옮겼다. 이 파일이 검사다.

   재는 방법 — 전투력 공식(powerOf)은 공격 구간을 못 세므로 쓰지 않는다.
   맨몸 거울 대결(50%)에 **그 파츠 하나만** 끼우고 실제 시뮬을 돌린다.
   기체 셋으로 재서 한 기체에 맞춰 수치가 튜닝되는 것을 피한다.

   고유 효과(브레이커 관통·채프 스택)도 시뮬에 실제로 넣은 채로 잰다 — 그 둘은
   효과가 예산의 절반을 먹으므로 빼고 재면 수치를 잘못 잡는다.

   node tools/budget.mjs [판수]        기본 2500 (기체당). 정밀하게 보려면 8000 */
import { PART_BASES, AFFIXES, AFFIX_GROUPS, AFFIX_TIER, RARITY, SLOTS, CONST } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';

const N = Math.max(200, parseInt(process.argv[2] || '2500', 10));
const LV = 40;
/* 느린 기체·빠른 기체·중간을 섞는다. 속도가 승률에 강하게 작용하므로
   한 기체로만 재면 속도를 주는 파츠가 과대·과소평가된다. */
const REFS = ['mule', 'ranger', 'azure'];
const BAND = [58, 64];          // 한 파츠를 끼웠을 때의 목표 승률
const EMPTY = { WEAPON: null, FRAME: null, BOOSTER: null, CORE: null };
const STATS = ['hp', 'atk', 'def', 'spd', 'crit', 'eva'];

/* 4단계부터는 **실제 생성·계산 경로로** 잰다. 예전에는 여기서 베이스 스탯을 손으로
   얹었는데, 그러면 이 도구만 통과하고 게임 안에서는 다른 값이 되는 일이 생긴다.
   실제로 그랬다 — 손으로 얹을 때는 파츠 공격력에 ATK_SCALE(1.65)이 안 걸렸다.

   재는 조건은 그대로다. **C등급 · 인챈트 없음 · Lv.40** — 베이스 자체의 예산만 본다.
   인챈트가 얹힌 뒤의 폭은 4단계 검증(tools/partroll.mjs)에서 따로 본다. */
function basePart(id) {
  const b = PART_BASES[id];
  return { uid: 'b', slot: b.slot, base: id, rarity: 'C', ko: '일반', name: b.ko,
           affixes: [], seed: 0, lv: LV, enh: 0 };
}

function winRate(base) {
  let w = 0, n = 0;
  const part = base ? basePart(base) : null;
  const slots = part ? { ...EMPTY, [part.slot]: 'b' } : EMPTY;
  for (const t of REFS) {
    const rb = { type: t, level: LV, skillLv: 0, fat: 0, slots: EMPTY };
    const bare = computeStats(rb, []);
    const mine = part ? computeStats({ ...rb, slots }, [part]) : bare;
    for (let i = 0; i < N; i++) {
      const ev = simulate(makeUnit('P', t, mine), makeUnit('E', t, bare), i * 7919 + 13);
      if (ev[ev.length - 1].winner === 'P') w++;
      n++;
    }
  }
  return w / n * 100;
}

/* ── ① 데이터 정합성 (수치를 재기 전에 모양부터) ───────────── */
console.log('== ① 데이터 검사 ==');
{
  let bad = 0;
  const slotSet = new Set(SLOTS);
  const setKeys = new Set(Object.keys(CONST.PART_SET || {}));
  const grouped = new Set(Object.values(AFFIX_GROUPS).flat());
  for (const id in PART_BASES) {
    const b = PART_BASES[id];
    if (!slotSet.has(b.slot))              { console.log(`  ✗ ${id} 슬롯 '${b.slot}'`); bad++; }
    if (b.set && !setKeys.has(b.set))      { console.log(`  ✗ ${id} 세트 '${b.set}'`); bad++; }
    for (const k in b.stats) if (!STATS.includes(k)) { console.log(`  ✗ ${id} 스탯 '${k}'`); bad++; }
    if (b.range != null && (b.range < 0.65 || b.range > 1.45))
                                           { console.log(`  ✗ ${id} 구간 배수 ${b.range} 가 0.65~1.45 밖`); bad++; }
  }
  for (const id in AFFIXES) {
    const a = AFFIXES[id];
    if (a.slots !== '*' && (!Array.isArray(a.slots) || a.slots.some(s => !slotSet.has(s))))
                                           { console.log(`  ✗ ${id} slots`); bad++; }
    if (a.group && !AFFIX_GROUPS[a.group]) { console.log(`  ✗ ${id} 없는 그룹 '${a.group}'`); bad++; }
    if (a.group && !grouped.has(id))       { console.log(`  ✗ ${id} 가 AFFIX_GROUPS 목록에 없다`); bad++; }
    for (const k in (a.stats || {})) if (!STATS.includes(k)) { console.log(`  ✗ ${id} 스탯 '${k}'`); bad++; }
  }
  for (const g in AFFIX_GROUPS)
    for (const id of AFFIX_GROUPS[g]) if (!AFFIXES[id]) { console.log(`  ✗ 그룹 ${g} 의 '${id}' 가 없다`); bad++; }
  for (const r of RARITY) {
    if (!r.tiers) continue;
    const sum = Object.values(r.tiers).reduce((a, b) => a + b, 0);
    if (sum !== 100)                       { console.log(`  ✗ ${r.k} 티어 확률 합 ${sum}`); bad++; }
    for (const t in r.tiers) if (!AFFIX_TIER[t]) { console.log(`  ✗ ${r.k} 없는 티어 '${t}'`); bad++; }
  }
  console.log(bad ? `  ✗ ${bad}건` : '  ✓ 이상 없음');
  if (bad) process.exitCode = 1;
}

/* ── ② 슬롯마다 쓸 수 있는 인챈트가 충분한가 ──────────────── */
console.log('\n== ② 슬롯별 인챈트 폭 ==');
{
  const okIn = (id, sl) => AFFIXES[id].slots === '*' || AFFIXES[id].slots.includes(sl);
  const rows = [];
  for (const sl of SLOTS) {
    const pool = Object.keys(AFFIXES).filter(id => okIn(id, sl));
    let pairs = 0;
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      const gi = AFFIXES[pool[i]].group, gj = AFFIXES[pool[j]].group;
      if (gi && gi === gj) continue; pairs++;
    }
    rows.push({ sl, n: pool.length, pairs });
    console.log(`  ${sl.padEnd(8)} ${String(pool.length).padStart(2)}종 · 2개 조합 ${pairs}가지`);
  }
  /* 가장 좁은 슬롯이 가장 넓은 슬롯의 절반 밑으로 떨어지면, 그 슬롯은 먹어도
     비슷비슷해 보인다. 실제로 초안에서 부스터가 39 대 83 이었다. */
  const lo = Math.min(...rows.map(r => r.pairs)), hi = Math.max(...rows.map(r => r.pairs));
  console.log(lo * 2 >= hi ? `  ✓ 가장 좁은 슬롯이 가장 넓은 슬롯의 ${(lo / hi * 100).toFixed(0)}%`
                           : `  ✗ 편차가 크다 — ${lo} 대 ${hi} (절반 밑)`);
  if (lo * 2 < hi) process.exitCode = 1;
}

/* ── ③ 베이스 예산 ────────────────────────────────────────── */
console.log(`\n== ③ 베이스 예산 (Lv.${LV} · 기체 ${REFS.length}종 × ${N}판 = ${REFS.length * N}판/개) ==`);
const baseline = winRate(null);
console.log(`기준선(맨몸 거울) ${baseline.toFixed(1)}%  ·  목표 구간 ${BAND[0]}~${BAND[1]}%\n`);

const rows = [];
for (const id in PART_BASES) {
  const b = PART_BASES[id];
  rows.push({ id, ko: b.ko, slot: b.slot, set: b.set, fx: !!b.fx, wr: winRate(id) });
}
rows.sort((a, b) => b.wr - a.wr);

let out = 0;
console.log('승률\t판정\t슬롯\t세트\t이름');
for (const r of rows) {
  const lo = r.wr < BAND[0], hi = r.wr > BAND[1];
  if (lo || hi) out++;
  const mark = hi ? '↑높음' : lo ? '↓낮음' : '  ok ';
  console.log(`${r.wr.toFixed(1)}%\t${mark}\t${r.slot.slice(0,4)}\t${(r.set || '—').padEnd(9)}\t${r.ko}${r.fx ? '  (고유효과 포함)' : ''}`);
}

console.log('\n슬롯별 폭 — 슬롯 **안**의 폭이 중요하다. 네 칸은 어차피 다 채우므로');
console.log('슬롯 사이 차이는 덜 위험하지만, 슬롯 안이 벌어지면 정답이 하나로 굳는다.');
const by = {};
for (const r of rows) (by[r.slot] ??= []).push(r.wr);
for (const sl of SLOTS) {
  const v = by[sl] || [];
  if (!v.length) continue;
  const w = Math.max(...v) - Math.min(...v);
  console.log(`  ${sl.padEnd(8)} ${Math.min(...v).toFixed(1)} ~ ${Math.max(...v).toFixed(1)}%  (폭 ${w.toFixed(1)}%p)${w > 8 ? '  ✗ 너무 넓다' : ''}`);
}

const fxN = rows.filter(r => r.fx).length;
console.log(`\n${out ? `✗ ${out}/${rows.length} 개가 구간 밖이다 — 3단계에서 크기를 맞춘다` : `✓ ${rows.length}/${rows.length} 전부 구간 안`}`);
if (fxN) console.log(`※ ${fxN}개는 고유 효과(관통 확률·스택 감속)를 시뮬에 넣은 채로 잰 값이다.`);
if (out) process.exitCode = 1;
