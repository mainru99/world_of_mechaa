import { ROBOT_TYPES, CONST } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
let S=9; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const IDS=Object.keys(ROBOT_TYPES);
function w(dl,base,n=40){ let a=0,c=0;
  for(const t of IDS){ let x=0;
    for(let s=0;s<n;s++){ const ev=simulate(makeUnit('P',t,computeStats(rb(t,base+dl))),makeUnit('E',t,computeStats(rb(t,base))),ns()); if(ev[ev.length-1].winner==='P') x++; }
    a+=x/n; c++; }
  return a/c; }
console.log('같은 기체끼리 레벨 차이만 두었을 때의 승률');
console.log('레벨차\tLv.10기준\tLv.30기준\tLv.50기준');
for(const d of [0,1,2,3,4,6,8])
  console.log(`+${d}\t${(w(d,10)*100).toFixed(0)}%\t\t${(w(d,30)*100).toFixed(0)}%\t\t${(w(d,50)*100).toFixed(0)}%`);
console.log('\n공격력만 몇 % 앞설 때의 승률 (Lv.30)');
function wa(mul,n=40){ let a=0,c=0;
  for(const t of IDS){ let x=0;
    for(let s=0;s<n;s++){ const P=makeUnit('P',t,computeStats(rb(t,30))), E=makeUnit('E',t,computeStats(rb(t,30)));
      P.atk=Math.round(P.atk*mul);
      const ev=simulate(P,E,ns()); if(ev[ev.length-1].winner==='P') x++; }
    a+=x/n; c++; }
  return a/c; }
for(const m of [1.00,1.03,1.06,1.10,1.20]) console.log(`x${m.toFixed(2)}\t${(wa(m)*100).toFixed(0)}%`);
