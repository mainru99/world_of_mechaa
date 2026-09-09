import { ROBOT_TYPES, MONSTER_TYPES, ROBOT_RARITY, CONST } from '../data/balance.js';
import { computeStats, power, atkRange } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
import { makeHuntTarget } from '../js/rewards.js';
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

/* 상대 레벨은 실제 토벌이 쓰는 함수에서 그대로 받는다. 여기서 다시 계산하면
   상한이 어긋난다 — 예전에는 60 으로 잘라 두었는데 실제 makeHuntTarget 은
   MAXLV + OPP_LV_OVER(= 90)까지 올린다. 그래서 표가 실제와 다른 난이도를 보여 줬다. */
const huntLv=(k,plv)=>{ const t=makeHuntTarget(k,plv,()=>0,()=>'x'); return t?t.level:plv; };

console.log('== ① 토벌 등급별 승률 (레어 기체 Lv.30 기준) ==');
console.log('등급\t상대Lv\t승률\t출격비배수');
for(const k of ['C','UC','R','UQ','EP','BOSS']){
  const H=CONST.HUNT[k], lv=huntLv(k,30);
  console.log(`${k}\t${lv}\t${(grpWin(byR.R,30,MbyR[k],lv)*100).toFixed(0)}%\tx${H.costX}`);
}
/* 보스는 만렙에서 만나는 콘텐츠다. Lv.30 줄만 보면 실제로 마주치는 벽을 못 본다 —
   만렙에게는 상한까지 올라간 Lv.90 보스가 나온다. 여기 기체는 파츠가 없으므로
   0% 가 정상이다. 장비를 갖춘 승률은 ChatGPT 가 따로 잰다. */
{
  /* 이 줄은 나중에 붙였다. 시드를 그냥 쓰면 아래 ②~⑥ 의 난수열이 통째로 밀려
     예전 기록과 비교할 수 없게 된다(실제로 ③ 이 51.3% → 50.2% 로 움직였다).
     재고 나서 시드를 되돌린다. */
  const keep=_sd;
  const lv=huntLv('BOSS',CONST.MAXLV);
  console.log(`BOSS\t${lv}\t${(grpWin(byR.R,CONST.MAXLV,MbyR.BOSS,lv)*100).toFixed(0)}%\tx${CONST.HUNT.BOSS.costX}\t← 만렙 Lv.${CONST.MAXLV} 기준 (파츠 없음)`);
  _sd=keep;
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
