import { ROBOT_TYPES, ROBOT_RARITY } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
const KS=ROBOT_RARITY.map(r=>r.k);
const byR={}; for(const k of KS) byR[k]=Object.keys(ROBOT_TYPES).filter(i=>ROBOT_TYPES[i].rarity===k);
let S=23; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
function gw(loK,loLv,hiK,hiLv,n=14){ let a=0,c=0;
  for(const p of byR[loK]) for(const o of byR[hiK]){ let w=0;
    for(let s=0;s<n;s++){ const ev=simulate(makeUnit('P',p,computeStats(rb(p,loLv))),makeUnit('E',o,computeStats(rb(o,hiLv))),ns()); if(ev[ev.length-1].winner==='P') w++; }
    a+=w/n; c++; } return a/c; }
console.log('커먼이 각 등급과 대등해지는 데 필요한 추가 레벨 — 기준 레벨을 바꿔 가며');
console.log('상대등급\t상대Lv.10\t상대Lv.30\t상대Lv.50');
for(const k of ['UC','R','UQ','EP']){
  const row=[10,30,50].map(base=>{
    for(let d=0; d<=30; d++) if(gw('C',base+d,k,base)>=0.5) return '+'+d;
    return '>30'; });
  console.log(k+'\t'+row.join('\t\t'));
}
