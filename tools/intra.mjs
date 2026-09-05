import { ROBOT_TYPES, ROBOT_RARITY } from '../data/balance.js';
import { computeStats, power } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
const byR={}; for(const r of ROBOT_RARITY) byR[r.k]=Object.keys(ROBOT_TYPES).filter(i=>ROBOT_TYPES[i].rarity===r.k);
let S=5; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
function w(a,b,lv,n=60){ let x=0; for(let s=0;s<n;s++){
  const ev=simulate(makeUnit('P',a,computeStats(rb(a,lv))),makeUnit('E',b,computeStats(rb(b,lv))),ns());
  if(ev[ev.length-1].winner==='P') x++; } return x/n; }
console.log('== 같은 등급 안에서의 편차 (Lv.30) ==');
console.log('등급\t기체\t전투력\t같은등급 상대 승률');
for(const r of ROBOT_RARITY){
  const rows=byR[r.k].map(t=>{
    let a=0; for(const o of byR[r.k]) if(o!==t) a+=w(t,o,30);
    return {t, p:power(rb(t,30)), wr:a/(byR[r.k].length-1)};
  }).sort((x,y)=>y.wr-x.wr);
  for(const x of rows) console.log(`${r.k}\t${ROBOT_TYPES[x.t].name}\t${x.p}\t${(x.wr*100).toFixed(0)}%`);
  const ps=rows.map(x=>x.p);
  console.log(`  → 전투력 편차 ${(Math.max(...ps)/Math.min(...ps)*100-100).toFixed(0)}% · 승률 ${(Math.min(...rows.map(x=>x.wr))*100).toFixed(0)}~${(Math.max(...rows.map(x=>x.wr))*100).toFixed(0)}%`);
}
/* 전투력이 승률을 얼마나 잘 맞히나 (같은 등급 안) */
let ok=0,tot=0;
for(const r of ROBOT_RARITY) for(const a of byR[r.k]) for(const b of byR[r.k]) if(a!==b){
  const pa=power(rb(a,30)), pb=power(rb(b,30));
  if((pa>pb)===(w(a,b,30,30)>0.5)) ok++; tot++;
}
console.log(`\n같은 등급 안에서 전투력이 승패를 맞힌 비율: ${(ok/tot*100).toFixed(0)}%`);
