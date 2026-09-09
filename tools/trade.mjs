/* 공격과 방어의 교환비 — '공격력 1% 는 방어 몇 % 값인가'.

   전술(CONST.TACTIC)의 값을 잡을 때 이것을 모르면 반드시 틀린다. 실제로 두 번 틀렸다:
   sp 와 taken 만으로 주고받게 했더니 방어가 모든 상황에서 1등이었고, 고치자 돌격이 1등이었다.
   어림으로 맞추지 말고 여기서 재고 나서 값을 잡을 것.

   거울 대결(같은 기체·같은 레벨)에서 **내 쪽에만** 손잡이를 걸어 승률이 얼마나 움직이는지 본다.
   판수는 명령줄에서: node tools/trade.mjs 3000 */
import { ROBOT_TYPES, CONST } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
import { pm, argN } from './stat.mjs';

const N=argN(1200);
const T=Object.keys(ROBOT_TYPES);
const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
let S=7; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const ST={}; const st=t=>ST[t]||(ST[t]=computeStats(rb(t,30)));

function wr(mod){
  let k=0,n=0;
  for(const t of T){ const s=st(t);
    for(let i=0;i<N;i++){
      const P=makeUnit('P',t,s), E=makeUnit('E',t,s); mod(P);
      const ev=simulate(P,E,ns()); if(ev[ev.length-1].winner==='P') k++; n++; } }
  return {k,n};
}
const f=(a,b)=>{ const d=(a.k/a.n-b.k/b.n)*100; return (d>=0?'+':'')+d.toFixed(2)+'%p'; };

console.log(`거울 대결 Lv.30 · 한 칸 ${N*T.length}판 · 내 쪽에만 손잡이를 건다\n`);
const base=wr(()=>{});
console.log('손잡이\t값\t승률\t기준 대비');
console.log('없음\t—\t'+pm(base.k,base.n)+'\t—');

for(const d of [0.05,0.10,0.20]){
  const r=wr(P=>{ P.atk=Math.max(1,Math.round(P.atk*(1+d))); });
  console.log(`공격력\t+${(d*100)|0}%\t${pm(r.k,r.n)}\t${f(r,base)}`);
}
for(const d of [0.05,0.10,0.20]){
  const r=wr(P=>{ P.taken=1-d; });
  console.log(`받는피해\t-${(d*100)|0}%\t${pm(r.k,r.n)}\t${f(r,base)}`);
}
for(const d of [0.05,0.10]){
  const r=wr(P=>{ P.eva=Math.min(0.6,P.eva+d); });
  console.log(`회피\t+${(d*100)|0}%p\t${pm(r.k,r.n)}\t${f(r,base)}`);
}
for(const d of [0.60,0.80]){
  const r=wr(P=>{ P.takenSkill=d; });
  console.log(`스킬피해\t×${d}\t${pm(r.k,r.n)}\t${f(r,base)}`);
}

/* SP 는 연속 손잡이가 아니다 — 스킬 주기가 정수 턴이라 계단으로 움직인다.
   이것을 모르고 sp 를 0.05 씩 만지면 아무 일도 일어나지 않는다. */
console.log('\n== SP 손잡이는 계단이다 (턴당 +30 · 100 에서 스킬) ==');
console.log('sp\t스킬 주기\t승률\t기준 대비');
let last=null;
for(const sp of [0.60,0.67,0.75,0.85,1.00,1.10,1.20,1.40,1.50,1.70]){
  const turns=Math.ceil(100/(30*sp));
  const r=wr(P=>{ P.spGain=30*sp; });
  console.log(`${sp.toFixed(2)}\t${turns}턴${turns===last?' (그대로)':''}\t${pm(r.k,r.n)}\t${f(r,base)}`);
  last=turns;
}
console.log('\n같은 주기 안에서는 sp 를 아무리 만져도 승률이 움직이지 않는다.');
console.log('주기가 바뀌는 지점은 sp = 0.556 · 0.667 · 0.834 · 1.112 · 1.667 부근이다.');

/* 스킬이 평타 몇 대 값인지 — SP 손잡이의 세기를 정하는 값이다.
   1.8 배쯤이라고 어림했다가 틀렸다. 다단히트와 관통까지 넣으면 훨씬 크다. */
let sum=0,cnt=0;
for(const k of T){ const fx=(ROBOT_TYPES[k].skill||{}).fx||{};
  let v=(fx.mult||1)*(fx.hits||1);
  if(fx.ignoreDef) v*=1.35; if(fx.alwaysCrit) v*=1.25; if(fx.drain) v*=1.2; if(fx.noMiss) v*=1.08;
  sum+=v; cnt++; }
console.log(`\n스킬 한 방의 값어치 ≈ 평타 ${(sum/cnt).toFixed(2)}대 (관통·확정치명·흡혈을 어림해 얹은 값).`);
console.log(`그래서 주기 4턴→3턴이면 화력 +${(((3-1+sum/cnt)/3)/((4-1+sum/cnt)/4)*100-100).toFixed(1)}%, 4턴→5턴이면 ${(((5-1+sum/cnt)/5)/((4-1+sum/cnt)/4)*100-100).toFixed(1)}% 다.`);
