import { ROBOT_TYPES, MONSTER_TYPES, ROBOT_RARITY } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
const byR={}; for(const r of ROBOT_RARITY) byR[r.k]=Object.keys(ROBOT_TYPES).filter(i=>ROBOT_TYPES[i].rarity===r.k);
const MbyR={}; for(const [i,t] of Object.entries(MONSTER_TYPES)) (MbyR[t.rarity]=MbyR[t.rarity]||[]).push(i);
let S=17; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
function w(a,b,lv,n=50){ let x=0; for(let s=0;s<n;s++){
  const ev=simulate(makeUnit('P',a,computeStats(rb(a,lv))),makeUnit('E',b,computeStats(rb(b,lv))),ns());
  if(ev[ev.length-1].winner==='P') x++; } return x/n; }
console.log('같은 등급·같은 레벨에서 기체가 몬스터를 상대로 (50% 여야 공평)');
console.log('등급\tLv.10\tLv.30\tLv.50');
for(const r of ROBOT_RARITY){
  if(!MbyR[r.k]) continue;
  const row=[10,30,50].map(lv=>{ let a=0,c=0;
    for(const p of byR[r.k]) for(const m of MbyR[r.k]){ a+=w(p,m,lv,20); c++; }
    return (a/c*100).toFixed(0)+'%'; });
  console.log(r.k+'\t'+row.join('\t'));
}
console.log('\n몬스터별 (같은 등급 기체 상대, Lv.30)');
for(const k of Object.keys(MONSTER_TYPES)){
  const r=MONSTER_TYPES[k].rarity; if(r==='BOSS') continue;
  let a=0,c=0; for(const p of byR[r]){ a+=w(p,k,30,24); c++; }
  console.log(`${MONSTER_TYPES[k].name}\t${r}\t기체 승률 ${(a/c*100).toFixed(0)}%`);
}
