import { ROBOT_TYPES, MONSTER_TYPES, ROBOT_RARITY, CONST } from '../data/balance.js';
import { computeStats, power, atkRange } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
const rb=(t,l)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
const KS=ROBOT_RARITY.map(r=>r.k);
const byR={}; for(const k of KS) byR[k]=Object.keys(ROBOT_TYPES).filter(i=>ROBOT_TYPES[i].rarity===k);
const MbyR={}; for(const [i,t] of Object.entries(MONSTER_TYPES)) (MbyR[t.rarity]=MbyR[t.rarity]||[]).push(i);
/* 시드를 고정 집합으로 쓰면 기체마다 같은 난수열을 돌려 표본이 상관된다 —
   그것 때문에 거울 대결이 실제 50.4% 인데 54.5% 로 보였다. 매번 새 시드를 쓴다. */
let _sd=1; const nextSeed=()=>((_sd=Math.imul(_sd,1103515245)+12345|0)>>>0);
function wr(a,la,b,lb,per=40){ let w=0; for(let s=0;s<per;s++){
  const ev=simulate(makeUnit('P',a,computeStats(rb(a,la))),makeUnit('E',b,computeStats(rb(b,lb))),nextSeed());
  if(ev[ev.length-1].winner==='P') w++; } return w/per; }
function grpWin(A,la,B,lb,per=16){ let s=0,n=0; for(const a of A) for(const b of B){ s+=wr(a,la,b,lb,per); n++; } return s/n; }

console.log('== ① 토벌 등급별 승률 (레어 기체 Lv.30 기준) ==');
console.log('등급\t상대Lv\t승률\t출격비배수');
for(const k of ['C','UC','R','UQ','EP','BOSS']){
  const H=CONST.HUNT[k], lv=Math.max(1,Math.min(60,30+H.lv));
  console.log(`${k}\t${lv}\t${(grpWin(byR.R,30,MbyR[k],lv)*100).toFixed(0)}%\tx${H.costX}`);
}
console.log('\n== ② 한 판 길이 ==');
let h=0,n=0,turns=0;
for(const t of Object.keys(ROBOT_TYPES)) for(let s=0;s<12;s++){
  const ev=simulate(makeUnit('P',t,computeStats(rb(t,30))),makeUnit('E',t,computeStats(rb(t,30))),nextSeed());
  h+=ev.filter(e=>e.t==='hit').length; turns+=ev.filter(e=>e.t==='skill').length; n++; }
console.log(`평균 타격 ${(h/n).toFixed(1)}회 · 스킬 ${(turns/n).toFixed(1)}회 · 재생 약 ${((h/n*300+turns/n*520+700)/1000).toFixed(1)}초`);

console.log('\n== ③ 거울 대결 공정성 (50% 여야 한다) ==');
let m=0,mn=0;
for(const t of Object.keys(ROBOT_TYPES)){ m+=wr(t,30,t,30,80); mn++; }
console.log(`전 기체 평균 ${(m/mn*100).toFixed(1)}%`);

console.log('\n== ④ 등급 사다리 (같은 레벨 Lv.30) ==');
console.log('\t'+KS.join('\t'));
for(const a of KS) console.log([a,...KS.map(b=>(grpWin(byR[a],30,byR[b],30,10)*100).toFixed(0))].join('\t'));

console.log('\n== ⑤ 노력으로 따라잡기 — 커먼이 각 등급 Lv.30 과 대등해지는 레벨 ==');
for(const k of ['UC','R','UQ','EP']){
  let found='>60';
  for(let l=30;l<=60;l++){ if(grpWin(byR.C,l,byR[k],30,8)>=0.5){ found='Lv.'+l+` (+${l-30})`; break; } }
  console.log(`vs ${k} Lv.30\t${found}`);
}
console.log('\n== ⑥ 공격력 구간 예시 (Lv.30) ==');
for(const t of ['oracle','ranger','azure','mule','vanguard','howitzer']){
  const st=computeStats(rb(t,30));
  console.log(`${ROBOT_TYPES[t].name}\t±${Math.round(st.spread*100)}%\t${atkRange(st).join(' ~ ')}\t(${ROBOT_TYPES[t].role})`);
}
