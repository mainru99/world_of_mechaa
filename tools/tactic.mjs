/* 전술 지시(CONST.TACTIC)를 재는 도구.

   이 기능의 성공 조건은 하나뿐이다 — **어느 하나가 늘 낫지 않을 것.**
   하나가 모든 상황에서 1등이면 그것은 선택이 아니라 정답이고, 정답은 곧 없는 것과 같다.
   그래서 아래 ①과 ③이 핵심이고 나머지는 참고다.

   거울 대결로만 잰다. 양쪽이 같은 기체·같은 레벨이라 **전술 말고는 다른 것이 없다.**
   판수는 명령줄에서 바꾼다: node tools/tactic.mjs 4000 */
import { ROBOT_TYPES, CONST } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate, mulberry32 } from '../js/sim.js';
import { pickTactic } from '../js/rewards.js';
import { pct, pm, argN } from './stat.mjs';

const N=argN(2000);
const KEYS=Object.keys(CONST.TACTIC||{});
const KO=k=>CONST.TACTIC[k].ko;
const TYPES=Object.keys(ROBOT_TYPES);

/* 상대의 스킬 틀 — pickTactic 이 쓰는 분류와 같아야 표가 뜻을 갖는다 */
const shapeOf=t=>{ const fx=((ROBOT_TYPES[t].skill)||{}).fx||{};
  return fx.noMiss?'회피 불가':(fx.hits>1?'다단히트':(fx.ignoreDef?'방어 관통':'단순')); };
const SHAPES=['회피 불가','다단히트','방어 관통','단순'];

const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
let S=11; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const ST={}; const st=t=>ST[t]||(ST[t]=computeStats(rb(t,30)));

/* 거울 대결. 이긴 판수를 돌려준다 — 신뢰구간을 내려면 비율이 아니라 횟수가 필요하다.
   oppTac 이 null 이면 상대는 자기 틀의 기울기(TACTIC_BIAS)대로 고른다. 실제 게임과 같다. */
function duel(type, myTac, oppTac, n){
  const s=st(type); let k=0;
  for(let i=0;i<n;i++){
    const seed=ns();
    const e=oppTac || pickTactic(type, mulberry32((seed ^ 0x9e3779b9)>>>0));
    const ev=simulate(makeUnit('P',type,s,myTac), makeUnit('E',type,s,e), seed);
    if(ev[ev.length-1].winner==='P') k++;
  }
  return k;
}

console.log(`전술 측정 · 거울 대결 Lv.30 · 한 칸 ${N}판 · 50% 가 기준선\n`);

/* ── ① 상대의 스킬 틀에 따라 최선이 바뀌는가 ─────────────────────────
   상대는 실제 게임처럼 자기 기울기대로 전술을 고른다. 행마다 1등이 달라야 한다. */
console.log('== ① 내 전술별 승률 — 상대의 스킬 틀에 따라 (상대는 기울기대로 고른다) ==');
console.log('상대 틀\t'+KEYS.map(KO).join('\t')+'\t최선');
const best={};
for(const sh of SHAPES){
  const list=TYPES.filter(t=>shapeOf(t)===sh);
  if(!list.length) continue;
  const row=KEYS.map(k=>{ let w=0,n=0; for(const t of list){ w+=duel(t,k,null,N); n+=N; } return {k,w,n}; });
  const top=row.reduce((a,b)=>b.w/b.n>a.w/a.n?b:a);
  best[sh]=top.k;
  console.log(sh+'\t'+row.map(r=>pm(r.w,r.n)).join('\t')+'\t'+KO(top.k));
}

/* ── ② 전술 대 전술 ────────────────────────────────────────────────
   상대 전술을 고정해 정면으로 맞붙인다. 가위바위보가 있는지 여기서 보인다. */
console.log('\n== ② 전술 대 전술 (전 기체 평균 · 세로가 나, 가로가 상대) ==');
console.log('나\\상대\t'+KEYS.map(KO).join('\t'));
for(const a of KEYS){
  const row=KEYS.map(b=>{ let w=0,n=0;
    for(const t of TYPES){ w+=duel(t,a,b,Math.max(1,Math.round(N/4))); n+=Math.max(1,Math.round(N/4)); }
    return pm(w,n); });
  console.log(KO(a)+'\t'+row.join('\t'));
}

/* ── ③ 지배 전략 점검 ──────────────────────────────────────────────
   ① 의 모든 행에서 1등인 전술이 있으면 실패다. 그 전술만 고르면 되기 때문이다. */
console.log('\n== ③ 지배 전략 점검 ==');
const winners=[...new Set(Object.values(best))];
for(const sh of Object.keys(best)) console.log(`  ${sh} → ${KO(best[sh])}`);
if(winners.length<=1)
  console.log(`\n  ✗ 실패 — 모든 상황에서 '${KO(winners[0])}' 가 1등이다. 선택이 아니라 정답이 된다.`);
else
  console.log(`\n  ✓ 상대에 따라 최선이 ${winners.length}가지로 갈린다 (${winners.map(KO).join(' · ')}).`);

/* ── ④ 균형과 얼마나 다른가 ────────────────────────────────────────
   차이가 너무 작으면 아무도 안 고르고, 너무 크면 전투가 아니라 전술만 남는다. */
console.log('\n== ④ 균형(none) 대비 진폭 ==');
for(const sh of SHAPES){
  const list=TYPES.filter(t=>shapeOf(t)===sh); if(!list.length) continue;
  const v=KEYS.map(k=>{ let w=0,n=0; for(const t of list){ w+=duel(t,k,null,N); n+=N; } return w/n; });
  const base=v[KEYS.indexOf('none')];
  console.log(`  ${sh}\t`+KEYS.filter(k=>k!=='none').map((k,i)=>{
    const d=(v[KEYS.indexOf(k)]-base)*100;
    return `${KO(k)} ${d>=0?'+':''}${d.toFixed(1)}%p`; }).join(' · '));
}
