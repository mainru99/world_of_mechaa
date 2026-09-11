import { SLOTS } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { rollPart } from '../js/gacha.js';
import { makeUnit, simulate } from '../js/sim.js';
let S=13; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const rnd=()=>ns()/4294967296;
const bare=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
function pool(slot,rarK,lv,n){ const o=[]; for(let i=0;i<6000&&o.length<n;i++){ const p=rollPart(lv,rnd,slot+i); if(p.slot===slot&&p.rarity===rarK) o.push(p);} return o; }
const kit=parts=>{ const slots={WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}; for(const p of parts) slots[p.slot]=p.uid; return slots; };
const st=parts=>computeStats({...bare('glacier',30),slots:kit(parts)},parts);
const W=pool('WEAPON','SR',30,2), C=pool('CORE','SR',30,2), F=pool('FRAME','SR',30,2), B=pool('BOOSTER','SR',30,2);
console.log('== 빌드별 공격력 구간 (glacier 기본 ±25% · SR 파츠) ==');
const builds=[['맨몸',[]],['화력계 (무장+코어)',[W[0],C[0]]],['안정계 (프레임+부스터)',[F[0],B[0]]],
              ['섞음 (무장+부스터)',[W[0],B[0]]],['풀장착 화력 치중',[W[0],C[0],F[0],B[0]]]];
for(const [ko,ps] of builds){ const s=st(ps);
  console.log(`  ${ko.padEnd(22)} ±${(s.spread*100).toFixed(0)}%   공격 ${s.atk} 내구 ${s.hp} 속도 ${s.spd}`); }

console.log('\n== 그 폭이 승패를 얼마나 움직이나 (같은 스탯, 구간만 다르게) ==');
function wr(mySp,atkMul,n=3000){ let w=0;
  for(let i=0;i<n;i++){ const P=makeUnit('P','glacier',computeStats(bare('glacier',30)));
    const E=makeUnit('E','glacier',computeStats(bare('glacier',30)));
    P.spread=mySp; E.spread=0.25; P.atk=Math.round(P.atk*atkMul);
    if(simulate(P,E,ns()).slice(-1)[0].winner==='P') w++; } return w/n; }
const lo=st([F[0],B[0]]).spread, hi=st([W[0],C[0]]).spread;
console.log(`  안정계 ±${(lo*100).toFixed(0)}% vs 화력계 ±${(hi*100).toFixed(0)}%`);
console.log('상황\t\t안정계\t화력계\t차이');
for(const [ko,mul] of [['크게 불리 x0.85',0.85],['대등 x1.00',1.00],['크게 유리 x1.15',1.15]]){
  const a=wr(lo,mul), b=wr(hi,mul);
  console.log(`${ko}\t${(a*100).toFixed(1)}%\t${(b*100).toFixed(1)}%\t${((b-a)*100>0?'+':'')}${((b-a)*100).toFixed(1)}%p`);
}
