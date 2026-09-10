/* 게임이 실제로 만들어 주는 상대와 붙어 본다 — 새 플레이어 경험 점검 */
import { ROBOT_TYPES, ROBOT_RARITY, CONST } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
import { makeOpponent } from '../js/rewards.js';
import { mulberry32 } from '../js/sim.js';
const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
const byR={}; for(const r of ROBOT_RARITY) byR[r.k]=Object.keys(ROBOT_TYPES).filter(i=>ROBOT_TYPES[i].rarity===r.k);
let S=29; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
function play(myType, myLv, owned, n){
  let w=0, seq=0;
  for(let i=0;i<n;i++){
    const rnd=mulberry32(ns());
    const opp=makeOpponent(owned, myLv, rnd, ()=>'u'+(seq++), false, 0);  // 이 시험 플레이어는 파츠가 없다
    const P=makeUnit('P',myType,computeStats(rb(myType,myLv)));
    const E=makeUnit('E',opp.type,computeStats({type:opp.type,level:opp.level,skillLv:opp.skillLv|0,
                                                fat:0,slots:opp.slots},opp.parts));
    const ev=simulate(P,E,ns());
    if(ev[ev.length-1].winner==='P') w++;
  }
  return w/n;
}
console.log('생성 상대와의 승률 — 50% 근처가 건강하다');
console.log('내 기체\t보유등급\tLv.1\tLv.15\tLv.30\tLv.60');
for(const [k,owned] of [['C',['C']],['UC',['C','UC']],['R',['C','UC','R']],['UQ',['C','UC','R','UQ']],['EP',['C','UC','R','UQ','EP']]]){
  const row=[1,15,30,60].map(lv=>{
    let a=0; for(const t of byR[k]) a+=play(t,lv,owned,120);
    return (a/byR[k].length*100).toFixed(0)+'%';
  });
  console.log(`${k}\t${owned.join(',')}\t${row.join('\t')}`);
}
