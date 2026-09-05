/* 파츠 한 세트는 레벨 몇 개 값인가 — 파츠 없는 상대를 몇 레벨 올려야 대등해지나 */
import { ROBOT_TYPES, RARITY, SLOTS, SLOT_STATS, STAT_ROLL, CONST } from '../data/balance.js';
import { computeStats, isPct } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
let S=911; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const rnd=()=>ns()/4294967296;
const pick=a=>a[Math.floor(rnd()*a.length)], rf=(a,b)=>rnd()*(b-a)+a;
function mkPart(slot,rarK,level,uid,enh){
  const rar=RARITY.find(r=>r.k===rarK), lv=1+(level||1)*0.03, st={};
  for(let i=0;i<rar.n;i++){ const k=pick(SLOT_STATS[slot]); const [a,b]=STAT_ROLL[k];
    let v=rf(a,b)*rar.mul; if(!isPct(k)) v=Math.round(v*lv); st[k]=(st[k]||0)+v; }
  for(const k in st) if(isPct(k)) st[k]=Math.round(st[k]*1000)/1000;
  return {uid,slot,name:'P',rarity:rarK,stats:st,enh};
}
function kit(rarK,level,enh,n){ const parts=[],slots={WEAPON:null,FRAME:null,BOOSTER:null,CORE:null};
  SLOTS.slice(0,n).forEach((s,i)=>{ const p=mkPart(s,rarK,level,'p'+i,enh); parts.push(p); slots[s]=p.uid; });
  return {parts,slots}; }
const bare=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
const IDS=Object.keys(ROBOT_TYPES);
function w(rarK,enh,n,myLv,oppLv,trials=10){ let a=0,c=0;
  for(const t of IDS){ let x=0;
    for(let i=0;i<trials;i++){ const k=kit(rarK,myLv,enh,n);
      const P=makeUnit('P',t,computeStats({...bare(t,myLv),slots:k.slots},k.parts));
      const E=makeUnit('E',t,computeStats(bare(t,oppLv)));
      if(simulate(P,E,ns()).slice(-1)[0].winner==='P') x++; }
    a+=x/trials; c++; }
  return a/c; }
console.log('파츠 세트 = 레벨 몇 개  (상대를 몇 레벨 올려야 반반이 되나)');
console.log('장비\t\tLv.15\tLv.30\tLv.60');
for(const [lab,rar,enh,n] of [['C 4개 +0','C',0,4],['R 4개 +0','R',0,4],['SR 4개 +0','SR',0,4],
                              ['SR 4개 +5','SR',5,4],['SSR 4개 +10','SSR',10,4],['R 2개 +0','R',0,2]]){
  const row=[15,30,60].map(lv=>{
    for(let d=0; d<=60; d++){ if(lv+d>60) return '>'+(60-lv);
      if(w(rar,enh,n,lv,lv+d)<0.5) return '+'+d; }
    return '?'; });
  console.log(`${lab.padEnd(14)}\t${row.join('\t')}`);
}
