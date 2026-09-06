import { ROBOT_TYPES, RARITY, SLOTS } from '../data/balance.js';
import { computeStats, partStat } from '../js/stats.js';
import { genPart } from '../js/gacha.js';
import { makeUnit, simulate } from '../js/sim.js';
let S=5; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const rnd=()=>ns()/4294967296;
const rb=(t,l,k)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:k?k.slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
/* 지정 등급 파츠 하나를 지정 슬롯에 */
function one(slot,rarK,lv){
  for(let i=0;i<400;i++){ const p=genPart(lv,rnd,'p'+i);
    if(p.slot===slot && p.rarity===rarK) return p; }
  return null;
}
console.log('== 파츠 예시 (Lv.30 · SR) ==');
for(const sl of SLOTS){ const p=one(sl,'SR',30);
  const ps=partStat(p);
  console.log(' ', sl.padEnd(8), Object.entries(ps).map(([k,v])=>`${k} ${v<0?'−':'+'}${Math.abs(v)<1?(Math.abs(v)*100).toFixed(1)+'%':Math.round(Math.abs(v))}`).join('  '));
}
console.log('\n== 대가가 선택을 만드는가 ==');
console.log('무장(속도를 깎는다)을 끼는 것이 상대에 따라 갈리는지 본다. Lv.30 glacier 기준.');
function fight(myParts, oppType, n=200){
  const slots={WEAPON:null,FRAME:null,BOOSTER:null,CORE:null};
  for(const p of myParts) slots[p.slot]=p.uid;
  let w=0;
  for(let i=0;i<n;i++){
    const P=makeUnit('P','glacier',computeStats({...rb('glacier',30),slots},myParts));
    const E=makeUnit('E',oppType,computeStats(rb(oppType,30)));
    if(simulate(P,E,ns()).slice(-1)[0].winner==='P') w++;
  }
  return w/n;
}
const wep=one('WEAPON','SR',30), frm=one('FRAME','SR',30);
console.log('  무장:', JSON.stringify(wep.stats), '  프레임:', JSON.stringify(frm.stats));
console.log('\n상대\t\t맨몸\t무장만\t프레임만\t둘다');
for(const [ko,t] of [['빠른 회피형(oracle)','oracle'],['느린 장갑형(vanguard)','vanguard'],['균형(azure)','azure']]){
  const a=fight([],t), b=fight([wep],t), c=fight([frm],t), d=fight([wep,frm],t);
  console.log(`${ko}\t${(a*100).toFixed(0)}%\t${(b*100).toFixed(0)}%\t${(c*100).toFixed(0)}%\t\t${(d*100).toFixed(0)}%`);
}
