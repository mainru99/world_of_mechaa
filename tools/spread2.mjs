/* 파츠로 구간을 움직였을 때 실제로 얼마나 갈리는지 */
import { SLOTS } from '../data/balance.js';
import { computeStats, partStat } from '../js/stats.js';
import { genPart } from '../js/gacha.js';
let S=13; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const rnd=()=>ns()/4294967296;
const bare=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
function pool(slot,rarK,lv,n){ const o=[]; for(let i=0;i<4000&&o.length<n;i++){ const p=genPart(lv,rnd,'p'+i); if(p.slot===slot&&p.rarity===rarK) o.push(p);} return o; }
console.log('== 파츠 예시 (Lv.30 · SR) — 대가를 키우고 구간을 붙인 뒤 ==');
for(const sl of SLOTS){ const p=pool(sl,'SR',30,1)[0]; const ps=partStat(p);
  console.log(' ',sl.padEnd(8), Object.entries(ps).map(([k,v])=>`${k} ${v<0?'−':'+'}${Math.abs(v)<1?(Math.abs(v)*100).toFixed(1)+'%':Math.round(Math.abs(v))}`).join('  '));
}
console.log('\n== 구간을 어디까지 밀 수 있나 (glacier 기본 ±25%) ==');
const wep=pool('WEAPON','SR',30,4), boo=pool('BOOSTER','SR',30,4);
function sp(parts){ const slots={WEAPON:null,FRAME:null,BOOSTER:null,CORE:null};
  for(const p of parts) slots[p.slot]=p.uid;
  return computeStats({...bare('glacier',30),slots},parts).spread; }
console.log('  맨몸           ±'+(sp([])*100).toFixed(0)+'%');
console.log('  무장(한방형)   ±'+(sp([wep[0]])*100).toFixed(0)+'%');
console.log('  부스터(안정형) ±'+(sp([boo[0]])*100).toFixed(0)+'%');
console.log('  무장+코어      ±'+(sp([wep[0],pool("CORE","SR",30,1)[0]])*100).toFixed(0)+'%  (코어는 구간을 안 건드린다)');
