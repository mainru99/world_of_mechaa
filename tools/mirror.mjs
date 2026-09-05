import { ROBOT_TYPES, CONST } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
/* 완전히 같은 기체·같은 스탯끼리 붙인다. 공정하다면 50% 여야 한다. */
function mirror(t,mul,n=600){
  let w=0;
  for(let s=0;s<n;s++){
    const P=makeUnit('P',t,computeStats(rb(t,30))), E=makeUnit('E',t,computeStats(rb(t,30)));
    P.atk*=mul; E.atk*=mul;
    const ev=simulate(P,E,(s*2654435761)>>>0);
    if(ev[ev.length-1].winner==='P') w++;
  }
  return w/n;
}
console.log('거울 대결에서 선공(P)측 승률 — 50% 여야 공정하다');
console.log('기체\t현재(147타)\t짧은전투(22타)');
let s1=0,s2=0,n=0;
for(const t of ['mule','glacier','oracle','tempest','atlas','vanguard','azure','howitzer']){
  const a=mirror(t,1), b=mirror(t,5); s1+=a; s2+=b; n++;
  console.log(`${t}\t${(a*100).toFixed(1)}%\t${(b*100).toFixed(1)}%`);
}
console.log(`평균\t${(s1/n*100).toFixed(1)}%\t${(s2/n*100).toFixed(1)}%`);
