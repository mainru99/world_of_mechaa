/* spread(공격력 구간)가 실제로 승패를 움직이는가.
   움직이지 않으면 파츠로 옮겨도 장식일 뿐이다. */
import { ROBOT_TYPES } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
let S=41; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
const IDS=Object.keys(ROBOT_TYPES);
/* 내 구간폭만 바꿔 가며, 전력차가 있는 판에서 승률이 어떻게 변하나 */
function wr(mySp,oppSp,atkMul,n=2500){
  let w=0;
  for(let i=0;i<n;i++){
    const t=IDS[i%IDS.length];
    const P=makeUnit('P',t,computeStats(rb(t,30))), E=makeUnit('E',t,computeStats(rb(t,30)));
    P.spread=mySp; E.spread=oppSp; P.atk=Math.round(P.atk*atkMul);
    if(simulate(P,E,ns()).slice(-1)[0].winner==='P') w++;
  }
  return w/n;
}
console.log('내 구간폭에 따른 승률 (상대는 ±20% 고정)');
console.log('상황\t\t±10%\t±20%\t±34%\t±50%\t넓힘 효과');
for(const [ko,mul] of [['크게 불리 x0.85',0.85],['불리 x0.93',0.93],['대등 x1.00',1.00],['유리 x1.07',1.07],['크게 유리 x1.15',1.15]]){
  const v=[0.10,0.20,0.34,0.50].map(sp=>wr(sp,0.20,mul));
  const d=((v[3]-v[0])*100).toFixed(1);
  console.log(`${ko}\t${v.map(x=>(x*100).toFixed(1)+'%').join('\t')}\t${d>0?'+':''}${d}%p`);
}
console.log('\n한 판 타격 수(구간이 평균으로 뭉개지는 정도의 근거)');
let h=0,n=0;
for(const t of IDS){ for(let s=0;s<10;s++){ const ev=simulate(makeUnit('P',t,computeStats(rb(t,30))),makeUnit('E',t,computeStats(rb(t,30))),ns()); h+=ev.filter(e=>e.t==='hit').length; n++; } }
console.log('  평균', (h/n).toFixed(1), '타 · 구간 ±34% 는 총피해로는 약 ±'+(34/Math.sqrt(h/n)).toFixed(1)+'% 로 줄어든다');
