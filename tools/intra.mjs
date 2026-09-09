/* 같은 등급 안에서 기체끼리 얼마나 벌어져 있나.

   표본이 작으면 정상 기체가 이상치로 보인다. 예전 판수(한 쌍 60판)로는 한 기체당
   95% 구간이 ±5.7%p 였는데, 기준(35~65%)을 가리기에는 그 폭이 너무 넓다.
   실제로 Ranger 가 이상치로 보고됐다가 6,000판에서 58.9% 로 정상이었다.
   그래서 판수를 올리고 구간을 함께 적는다. 다르게 재려면 node tools/intra.mjs 8000 */
import { ROBOT_TYPES, ROBOT_RARITY } from '../data/balance.js';
import { computeStats, power } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
import { pct, outside, ties, argN } from './stat.mjs';

const N=argN(2000);                 // 한 쌍당 판수
const LO=0.35, HI=0.65;             // 구간이 통째로 이 밖이면 손봐야 한다

const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
const byR={}; for(const r of ROBOT_RARITY) byR[r.k]=Object.keys(ROBOT_TYPES).filter(i=>ROBOT_TYPES[i].rarity===r.k);
let S=5; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
/* 스탯은 판마다 같다. 판수를 크게 올렸으므로 한 번만 계산해 둔다
   (makeUnit 이 값을 복사해 가므로 같은 객체를 넘겨도 판끼리 섞이지 않는다) */
const ST={}; const st=(t,lv)=>ST[t+lv]||(ST[t+lv]=computeStats(rb(t,lv)));
/* 비율이 아니라 이긴 '판수' 를 돌려준다 — 신뢰구간을 내려면 횟수가 있어야 한다 */
function duel(a,b,lv,n){ const A=st(a,lv),B=st(b,lv); let k=0;
  for(let s=0;s<n;s++){ const ev=simulate(makeUnit('P',a,A),makeUnit('E',b,B),ns());
    if(ev[ev.length-1].winner==='P') k++; } return k; }

console.log(`== 같은 등급 안에서의 편차 (Lv.30 · 한 쌍 ${N}판 · [ ] 는 95% 신뢰구간) ==`);
console.log(`표는 승률순이다. 정렬은 잡음을 위아래 끝으로 밀어 올리므로 맨 줄이 실제보다 극단으로 보인다.`);
console.log(`구간이 통째로 ${(LO*100).toFixed(0)}~${(HI*100).toFixed(0)}% 밖일 때만 '기준 밖' 을 붙인다 — 그 표시가 없으면 손댈 근거가 없다.\n`);
console.log('등급\t기체\t전투력\t같은등급 상대 승률');
for(const r of ROBOT_RARITY){
  const rows=byR[r.k].map(t=>{
    let k=0,n=0;
    for(const o of byR[r.k]) if(o!==t){ k+=duel(t,o,30,N); n+=N; }
    return {t, p:power(rb(t,30)), k, n};
  }).sort((x,y)=>y.k/y.n-x.k/x.n);
  for(const x of rows)
    console.log(`${r.k}\t${ROBOT_TYPES[x.t].name}\t${x.p}\t${pct(x.k,x.n)}${outside(x.k,x.n,LO,HI)?'\t← 기준 밖':''}`);
  const ps=rows.map(x=>x.p), ws=rows.map(x=>x.k/x.n);
  console.log(`  → 전투력 편차 ${(Math.max(...ps)/Math.min(...ps)*100-100).toFixed(0)}% · 승률 ${(Math.min(...ws)*100).toFixed(1)}~${(Math.max(...ws)*100).toFixed(1)}% · 기준 밖 ${rows.filter(x=>outside(x.k,x.n,LO,HI)).length}기체`);
}

/* 전투력이 승패를 얼마나 잘 맞히나 (같은 등급 안).
   구간이 50% 를 물면 우열을 말할 수 없는 쌍이다. 그런 쌍까지 '틀렸다' 로 세면
   실제로 대등한 두 기체가 예측 실패로 잡혀 전투력 공식이 억울하게 나빠 보인다. */
let ok=0,tot=0,tie=0;
for(const r of ROBOT_RARITY) for(const a of byR[r.k]) for(const b of byR[r.k]) if(a<b){
  const k=duel(a,b,30,N);
  if(ties(k,N)){ tie++; continue; }
  const pa=power(rb(a,30)), pb=power(rb(b,30));
  if((pa>pb)===(k/N>0.5)) ok++;
  tot++;
}
console.log(`\n같은 등급 안에서 전투력이 승패를 맞힌 비율: ${tot?(ok/tot*100).toFixed(0):'—'}% (${ok}/${tot})`);
console.log(`  대등해서 우열을 가릴 수 없는 ${tie}쌍은 뺐다 (구간이 50% 를 문다)`);
