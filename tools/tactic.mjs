/* 전술 지시(CONST.TACTIC)를 재는 도구.

   이 기능의 성공 조건은 하나뿐이다 — **어느 하나가 늘 낫지 않을 것.**
   하나가 모든 상황에서 1등이면 그것은 선택이 아니라 정답이고, 정답은 곧 없는 것과 같다.

   ## 한 조건만 재면 놓친다

   처음에는 **Lv.30 맨몸 스킬 +0** 하나만 쟀다. 그 조건에서 값을 맞춰 놓고 통과했다고
   적었는데, 후반 조건에서 방어가 전 행 1등이 되는 것을 ChatGPT 가 잡아냈다.

   무엇이 뒤집는지 다시 재 보니 **레벨**이었다:

     Lv.30 맨몸 +0    → 3가지로 갈림
     Lv.30 맨몸 +10   → 3가지로 갈림   (강화만으로는 안 뒤집힌다)
     Lv.60 맨몸 +10   → **전부 방어**  ✗
     Lv.60 SSR+10 +10 → 2가지로 갈림   (장비가 도로 벌려 준다)

   레벨이 오르면 방어력도 함께 올라 피해 공식(atk × 100/(100+def))이 한 대의 위력을
   깎는다. 판이 길어지고, 길어진 만큼 **스킬이 차지하는 몫**이 커진다. 전술의 두 손잡이가
   바로 그 몫을 건드리므로(`sp` = 몇 번 쓰나, `takenSkill` = 얼마나 맞나) 조건마다
   값이 달라진다. 그래서 여기서는 **레벨 × 강화 × 장비를 격자로 훑는다.**

   거울 대결로만 잰다. 양쪽이 같은 기체·같은 레벨·같은 강화·같은 장비라
   **전술 말고는 다른 것이 없다.**
   만렙 판은 방어력이 높아 한 판이 길다. 기본값에서 1분 안팎 걸리고, 판수를 올리면
   그만큼 늘어난다. 값을 확정하기 전 마지막 확인에는 node tools/tactic.mjs 2000 을 쓸 것.
   판수는 명령줄에서 바꾼다: node tools/tactic.mjs 2000 */
import { ROBOT_TYPES, CONST, SLOTS } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate, mulberry32 } from '../js/sim.js';
import { pickTactic } from '../js/rewards.js';
import { genPart } from '../js/gacha.js';
import { pm, argN } from './stat.mjs';

/* 후보 값을 파일을 고치지 않고 시험한다 — tools/play.mjs 의 ROWAR_* 와 같은 방식이다.
   data/balance.js 는 ChatGPT 담당이고 둘이 동시에 만질 때가 있어서, 재 보는 것만으로는
   파일을 건드리지 않는 길이 있어야 한다.

     ROWAR_TACTIC='{"guard":{"atk":0.81,"takenSkill":0.60}}' node tools/tactic.mjs

   준 열쇠만 덮어쓴다. 나머지는 파일 값 그대로다. */
const OVERRIDE=process.env.ROWAR_TACTIC ? JSON.parse(process.env.ROWAR_TACTIC) : null;
if(OVERRIDE) for(const k in OVERRIDE){
  if(!CONST.TACTIC[k]){ console.error(`모르는 전술: ${k}`); process.exit(2); }
  Object.assign(CONST.TACTIC[k], OVERRIDE[k]);
}

const N=argN(600);
const KEYS=Object.keys(CONST.TACTIC||{});
const KO=k=>CONST.TACTIC[k].ko;
const TYPES=Object.keys(ROBOT_TYPES);
const MAXS=(CONST.SKILL_UP && CONST.SKILL_UP.max) || 10;
const MAXLV=CONST.MAXLV || 60;

/* 재는 조건들. 초반(Lv.30 맨몸)부터 끝판(만렙·최종 장비·만강화)까지 —
   **하나라도 지배 전략이 나오면 실패다.** 그 조건에 이른 사람에게는 고를 것이 없어진다. */
const CONDITIONS=[
  { ko:`Lv.30 맨몸 +0`,            lv:30,    skill:0,             gear:null  },
  { ko:`Lv.30 맨몸 +${MAXS}`,      lv:30,    skill:MAXS,          gear:null  },
  { ko:`Lv.${MAXLV} 맨몸 +0`,      lv:MAXLV, skill:0,             gear:null  },
  { ko:`Lv.${MAXLV} 맨몸 +${MAXS}`, lv:MAXLV, skill:MAXS,         gear:null  },
  { ko:`Lv.${MAXLV} SSR+10 +${MAXS}`, lv:MAXLV, skill:MAXS,       gear:'SSR' },
];

/* 상대의 스킬 틀 — pickTactic 이 쓰는 분류와 같아야 표가 뜻을 갖는다 */
const shapeOf=t=>{ const fx=((ROBOT_TYPES[t].skill)||{}).fx||{};
  return fx.noMiss?'회피 불가':(fx.hits>1?'다단히트':(fx.ignoreDef?'방어 관통':'단순')); };
const SHAPES=['회피 불가','다단히트','방어 관통','단순'];

let S=11; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const EMPTY={WEAPON:null,FRAME:null,BOOSTER:null,CORE:null};

/* 장비는 **따로 고정된 난수**로 만든다. 전투 난수열에서 뽑으면 조건마다 장비가 달라져
   조건끼리 비교할 수 없다. 양쪽이 같은 장비를 쓰므로 세트도 서로 상쇄된다. */
function makeGear(rar, lv){
  let g=987654321; const r=()=>((g=Math.imul(g,1103515245)+12345|0)>>>0)/4294967296;
  const parts=[], slots={};
  for(const slot of SLOTS){ const p=genPart(lv, r, 'g'+slot, rar, slot); p.enh=10; parts.push(p); slots[slot]=p.uid; }
  return { parts, slots };
}
const GEAR={};
const gearOf=(rar,lv)=> rar ? (GEAR[rar+lv] || (GEAR[rar+lv]=makeGear(rar,lv))) : { parts:[], slots:EMPTY };

const ST={};
function statOf(type, c){
  const key=type+'@'+c.ko;
  if(ST[key]) return ST[key];
  const g=gearOf(c.gear, c.lv);
  return ST[key]=computeStats(
    { uid:'x', type, level:c.lv, exp:0, fat:0, skillLv:c.skill, slots:g.slots }, g.parts);
}

/* 거울 대결. 이긴 판수를 돌려준다 — 신뢰구간을 내려면 비율이 아니라 횟수가 필요하다.
   oppTac 이 null 이면 상대는 자기 틀의 기울기(TACTIC_BIAS)대로 고른다. 실제 게임과 같다. */
function duel(type, myTac, oppTac, n, c){
  const s=statOf(type,c); let k=0;
  for(let i=0;i<n;i++){
    const seed=ns();
    const e=oppTac || pickTactic(type, mulberry32((seed ^ 0x9e3779b9)>>>0));
    const ev=simulate(makeUnit('P',type,s,myTac), makeUnit('E',type,s,e), seed);
    if(ev[ev.length-1].winner==='P') k++;
  }
  return k;
}
/* 한 조건에서 '상대 틀별 최선' 을 낸다 */
function bestByShape(c, print){
  const best={};
  if(print){ console.log(`== ① 내 전술별 승률 — ${c.ko} (상대는 기울기대로 고른다) ==`);
             console.log('상대 틀\t'+KEYS.map(KO).join('\t')+'\t최선'); }
  for(const sh of SHAPES){
    const list=TYPES.filter(t=>shapeOf(t)===sh); if(!list.length) continue;
    const row=KEYS.map(k=>{ let w=0,n=0; for(const t of list){ w+=duel(t,k,null,N,c); n+=N; } return {k,w,n}; });
    const top=row.reduce((a,b)=>b.w/b.n>a.w/a.n?b:a);
    best[sh]={ top:top.k, row };          // 행을 통째로 남긴다 — ④ 가 이걸 다시 쓴다(전투를 두 번 돌리지 않는다)
    if(print) console.log(sh+'\t'+row.map(r=>pm(r.w,r.n)).join('\t')+'\t'+KO(top.k));
  }
  if(print) console.log('');
  return best;
}

console.log(`전술 측정 · 거울 대결 · 한 칸 ${N}판 · 50% 가 기준선`);
console.log(`조건 ${CONDITIONS.length}가지를 훑는다 — 초반부터 끝판까지 (양쪽 조건은 늘 같다)\n`);

if(OVERRIDE) console.log(`⚠ ROWAR_TACTIC 으로 값을 덮어썼다 — 파일 값이 아니다: ${process.env.ROWAR_TACTIC}\n`);

const RESULT={};
for(const c of CONDITIONS) RESULT[c.ko]=bestByShape(c, true);

/* ── ② 전술 대 전술 ────────────────────────────────────────────────
   상대 전술을 고정해 정면으로 맞붙인다. 가위바위보가 있는지 여기서 보인다.
   양 끝 조건만 본다 — 가운데는 ① 이 이미 말해 준다. */
for(const c of [CONDITIONS[0], CONDITIONS[CONDITIONS.length-1]]){
  console.log(`== ② 전술 대 전술 · ${c.ko} (전 기체 평균 · 세로가 나, 가로가 상대) ==`);
  console.log('나\\상대\t'+KEYS.map(KO).join('\t'));
  const per=Math.max(1,Math.round(N/5));
  for(const a of KEYS){
    console.log(KO(a)+'\t'+KEYS.map(b=>{ let w=0,n=0;
      for(const t of TYPES){ w+=duel(t,a,b,per,c); n+=per; }
      return pm(w,n); }).join('\t'));
  }
  console.log('');
}

/* ── ③ 지배 전략 점검 ──────────────────────────────────────────────
   **모든 조건에서** 통과해야 한다. 한 조건이라도 한 전술이 전 행을 쓸면 실패다. */
console.log('== ③ 지배 전략 점검 (조건마다) ==');
let fail=0;
for(const c of CONDITIONS){
  const best=RESULT[c.ko];
  const winners=[...new Set(Object.keys(best).map(sh=>best[sh].top))];
  const line=Object.keys(best).map(sh=>`${sh}→${KO(best[sh].top)}`).join(' · ');
  if(winners.length<=1){ fail++; console.log(`  ${c.ko.padEnd(18)}✗ 모두 '${KO(winners[0])}'  (${line})`); }
  else console.log(`  ${c.ko.padEnd(18)}✓ ${winners.length}가지 — ${winners.map(KO).join(' · ')}  (${line})`);
}
console.log(fail
  ? `\n  ✗ ${fail}개 조건에서 지배 전략이 나왔다. 그 조건에 이른 플레이어에게는 고를 것이 없다.`
  : '\n  ✓ 모든 조건에서 상대에 따라 최선이 갈린다.');

/* ── ④ 균형과 얼마나 다른가 ────────────────────────────────────────
   차이가 너무 작으면 아무도 안 고르고, 너무 크면 전투가 아니라 전술만 남는다.
   ① 에서 이미 잰 값을 다시 쓰므로 여기서는 전투를 더 돌리지 않는다. */
console.log('\n== ④ 균형(none) 대비 진폭 ==');
const iNone=KEYS.indexOf('none');
for(const c of CONDITIONS){
  console.log(`  ── ${c.ko} ──`);
  const best=RESULT[c.ko];
  for(const sh of SHAPES){
    const e=best[sh]; if(!e) continue;
    const base=e.row[iNone].w/e.row[iNone].n;
    console.log(`    ${sh}\t`+e.row.filter((_,i)=>i!==iNone).map(r=>{
      const d=(r.w/r.n-base)*100;
      return `${KO(r.k)} ${d>=0?'+':''}${d.toFixed(1)}%p`; }).join(' · '));
  }
}

process.exit(fail?1:0);
