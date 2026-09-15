/* Full loadouts, real round-robin leaders, disjoint validation seeds and both sides.
 * 4242 preserves budget.mjs's historical sample. The other seeds are holdouts.
 */
import fs from 'node:fs';
import { PART_BASES as B,AFFIXES as A,AFFIX_GROUPS,SLOTS } from '../data/balance.js';
import { computeStats,powerOf } from '../js/stats.js';
import { makeUnit,simulate,mulberry32 } from '../js/sim.js';
const groups=Object.fromEntries(Object.entries(AFFIX_GROUPS).flatMap(([g,ids])=>ids.map(id=>[id,g])));
const by=Object.fromEntries(SLOTS.map(s=>[s,Object.keys(B).filter(k=>B[k].slot===s)]));
function generate(seed,type){const r=mulberry32(seed);return Array.from({length:70},(_,id)=>{
 const ps=SLOTS.map(slot=>{const base=by[slot][Math.floor(r()*by[slot].length)],pool=Object.keys(A).filter(k=>A[k].slots==='*'||A[k].slots.includes(slot));
  const affixes=[],used=new Set,gs=new Set;let guard=0;
  while(affixes.length<2&&guard++<200){const k=pool[Math.floor(r()*pool.length)];if(used.has(k)||(groups[k]&&gs.has(groups[k])))continue;
   used.add(k);if(groups[k])gs.add(groups[k]);affixes.push({id:k,tier:['II','III','IV'][Math.floor(r()*3)]});}
  if(affixes.length!==2)throw Error('affix pool exhausted');
  return {uid:slot,slot,base,rarity:'SSR',affixes,seed:Math.floor(r()*4e9),lv:60,enh:10};});
 const st=computeStats({type,level:60,fat:0,skillLv:0,slots:Object.fromEntries(SLOTS.map(s=>[s,s]))},ps);
 return {id,ps,st,power:powerOf(st)};
});}
let capped=0,battles=0;
function duel(a,b,type,n,offset){let w=0;for(let i=0;i<n;i++)for(const reverse of [false,true]){
 const P=makeUnit('P',type,reverse?b:a),E=makeUnit('E',type,reverse?a:b),ev=simulate(P,E,(i*7919+offset)>>>0);
 w+=ev.at(-1).winner===(reverse?'E':'P');capped+=P.hp>0&&E.hp>0;battles++;
}return w/n/2*100;}
const reports=[];
const cases=process.argv.includes('--quick')?[['ranger',4242]]:[['ranger',4242],['ranger',90917],['ranger',271828],['mule',4242],['azure',4242]];
for(const [type,seed] of cases){
 const list=generate(seed,type),sums=list.map(()=>0);
 for(let i=0;i<70;i++)for(let j=i+1;j<70;j++){const w=duel(list[i].st,list[j].st,type,60,1789+i*65537+j*1301);sums[i]+=w;sums[j]+=100-w;}
 const leaders=sums.map((s,id)=>({id,mean:s/69})).sort((a,b)=>b.mean-a.mean).slice(0,3);
 const spread=Math.max(...list.map(x=>x.power))/Math.min(...list.map(x=>x.power));
 const opponents=leaders.map(leader=>{const ws=list.map(x=>({id:x.id,wr:duel(x.st,list[leader.id].st,type,1200,940001+seed)})).sort((a,b)=>a.wr-b.wr);
  return {...leader,good:ws.filter(x=>x.wr>=35).length,dead:ws.filter(x=>x.wr<20).length,min:ws[0].wr,median:ws[34].wr,ws};});
 const pass=spread<=1.15&&opponents.every(x=>x.good>=35&&x.dead<=10);
 const report={type,seed,spread,pass,opponents};reports.push(report);
 console.log(JSON.stringify({...report,opponents:opponents.map(({ws,...o})=>o)}));
}
const result={battles,capped,pass:!capped&&reports.every(r=>r.pass),reports};
const dest=process.argv.find(x=>x.startsWith('--out='))?.slice(6);
if(dest)fs.writeFileSync(dest,JSON.stringify(result,null,2));
console.log(`battles=${battles}; capped=${capped}; all samples pass=${result.pass}`);
process.exitCode=result.pass?0:1;
