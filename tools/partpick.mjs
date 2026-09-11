/* 같은 슬롯의 파츠 여러 개를 놓고, 상대에 따라 '가장 좋은 것'이 달라지는지 본다.
   달라지지 않으면 대가는 그냥 너프이고, 달라지면 결정이 생긴 것이다. */
import { SLOTS } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { rollPart } from '../js/gacha.js';
import { makeUnit, simulate } from '../js/sim.js';
let S=77; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const rnd=()=>ns()/4294967296;
const bare=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
function pool(slot,rarK,lv,n){ const out=[];
  for(let i=0;i<3000 && out.length<n;i++){ const p=rollPart(lv,rnd,'p'+i); if(p.slot===slot&&p.rarity===rarK) out.push(p); }
  return out; }
function wr(myType,part,oppType,n=260){
  const slots={WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}; slots[part.slot]=part.uid;
  let w=0;
  for(let i=0;i<n;i++){
    const P=makeUnit('P',myType,computeStats({...bare(myType,30),slots},[part]));
    const E=makeUnit('E',oppType,computeStats(bare(oppType,30)));
    if(simulate(P,E,ns()).slice(-1)[0].winner==='P') w++;
  }
  return w/n; }
const OPP=[['빠른 회피형 oracle','oracle'],['느린 장갑형 vanguard','vanguard']];
for(const slot of ['WEAPON','BOOSTER']){
  const ps=pool(slot,'SR',30,6);
  console.log(`\n== ${slot} SR 6종 · glacier(Lv.30)로 착용 ==`);
  console.log('파츠'.padEnd(34)+OPP.map(o=>o[0]).join('\t'));
  const rows=ps.map(p=>{
    const desc=Object.entries(p.stats).map(([k,v])=>`${k}${v<0?'':'+'}${Math.abs(v)<1?(v*100).toFixed(0)+'%':Math.round(v)}`).join(' ');
    return { desc, w: OPP.map(o=>wr('glacier',p,o[1])) };
  });
  for(const r of rows) console.log(r.desc.padEnd(34)+r.w.map(x=>(x*100).toFixed(0)+'%').join('\t\t'));
  const best0=rows.indexOf(rows.reduce((a,b)=>b.w[0]>a.w[0]?b:a));
  const best1=rows.indexOf(rows.reduce((a,b)=>b.w[1]>a.w[1]?b:a));
  console.log(best0===best1 ? '  → 상대가 달라도 최선이 같다 (결정 없음)'
                            : `  → 최선이 갈린다: 회피형엔 ${best0+1}번, 장갑형엔 ${best1+1}번 (결정 생김)`);
}
