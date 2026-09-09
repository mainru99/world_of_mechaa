/* 기체가 같은 등급 몬스터를 상대로 공평한가 (50% 여야 한다).

   표본이 작으면 정상 몬스터가 이상치로 보인다. 예전 판수(칸당 20~24판)로는
   95% 구간이 ±8%p 를 넘어 기준(45~55%)을 가릴 수 없었다 — 구간이 기준보다 넓으면
   그 표는 아무것도 말해 주지 않는다. 판수를 올리고 구간을 함께 적는다.
   다르게 재려면 node tools/mon.mjs 8000 */
import { ROBOT_TYPES, MONSTER_TYPES, ROBOT_RARITY } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
import { pct, pm, outside, argN } from './stat.mjs';

const N=argN(2000);                 // 한 쌍당 판수
const LO=0.45, HI=0.55;             // 구간이 통째로 이 밖이면 손봐야 한다

const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
const byR={}; for(const r of ROBOT_RARITY) byR[r.k]=Object.keys(ROBOT_TYPES).filter(i=>ROBOT_TYPES[i].rarity===r.k);
const MbyR={}; for(const [i,t] of Object.entries(MONSTER_TYPES)) (MbyR[t.rarity]=MbyR[t.rarity]||[]).push(i);
let S=17; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
/* 스탯은 판마다 같다. 판수를 크게 올렸으므로 한 번만 계산해 둔다 */
const ST={}; const st=(t,lv)=>ST[t+lv]||(ST[t+lv]=computeStats(rb(t,lv)));
/* 비율이 아니라 이긴 '판수' 를 돌려준다 — 신뢰구간을 내려면 횟수가 있어야 한다 */
function duel(a,b,lv,n){ const A=st(a,lv),B=st(b,lv); let k=0;
  for(let s=0;s<n;s++){ const ev=simulate(makeUnit('P',a,A),makeUnit('E',b,B),ns());
    if(ev[ev.length-1].winner==='P') k++; } return k; }

console.log(`같은 등급·같은 레벨에서 기체가 몬스터를 상대로 (50% 여야 공평 · 한 쌍 ${N}판 · ± 는 95% 구간의 반폭)`);
console.log('등급\tLv.10\tLv.30\tLv.50');
for(const r of ROBOT_RARITY){
  if(!MbyR[r.k]) continue;
  const row=[10,30,50].map(lv=>{
    let k=0,n=0;
    for(const p of byR[r.k]) for(const m of MbyR[r.k]){ k+=duel(p,m,lv,N); n+=N; }
    return pm(k,n)+(outside(k,n,LO,HI)?'*':'');
  });
  console.log(r.k+'\t'+row.join('\t'));
}
console.log(`* 는 구간이 통째로 ${(LO*100).toFixed(0)}~${(HI*100).toFixed(0)}% 밖이라는 뜻이다. 그 표시가 없으면 값이 기준을 벗어나 보여도 잡음이다.`);

console.log('\n몬스터별 (같은 등급 기체 상대, Lv.30)');
for(const k of Object.keys(MONSTER_TYPES)){
  const r=MONSTER_TYPES[k].rarity;
  if(r==='BOSS'||!byR[r]) continue;      // 보스는 만렙 콘텐츠라 같은 레벨로 재면 뜻이 없다
  let w=0,n=0;
  for(const p of byR[r]){ w+=duel(p,k,30,N); n+=N; }
  console.log(`${MONSTER_TYPES[k].name}\t${r}\t기체 승률 ${pct(w,n)}${outside(w,n,LO,HI)?'\t← 기준 밖':''}`);
}
