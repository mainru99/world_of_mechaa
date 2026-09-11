import { ROBOT_TYPES, ROBOT_RARITY, RARITY, SLOTS, SLOT_STATS, STAT_ROLL } from '../data/balance.js';
import { computeStats, power, isPct } from '../js/stats.js';
import { rollPart } from '../js/gacha.js';
import { makeUnit, simulate } from '../js/sim.js';
const byR={}; for(const r of ROBOT_RARITY) byR[r.k]=Object.keys(ROBOT_TYPES).filter(i=>ROBOT_TYPES[i].rarity===r.k);
let S=211; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const rnd=()=>ns()/4294967296;
const pick=a=>a[Math.floor(rnd()*a.length)];
const rf=(a,b)=>rnd()*(b-a)+a;
const wRar=()=>{ let t=RARITY.reduce((s,r)=>s+r.w,0), x=rnd()*t; for(const r of RARITY){ if((x-=r.w)<=0) return r.k; } return 'C'; };
/* 파츠는 **게임의 rollPart 를 그대로 쓴다.**
   예전에는 도구마다 따로 만들었는데, 그 코드가 대가(SLOT_COST)와 구간(spread)이
   생기기 전 것이라 상승분만 굴렸다. 그래서 파츠가 순수 이득으로 잡혀 값이 부풀려졌다. */
function mkPart(slot,rarK,level,uid,enh=0){
  const p=rollPart(level, rnd, uid, rarK, slot);
  p.enh=enh; return p;
}
/* mode: null=없음, 'drop'=자연 분포, 'C'/'R'/'SR'/'SSR'=고정등급 */
function kit(mode,level,enh=0){
  if(!mode) return null;
  const parts=[],slots={WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}; let i=0;
  for(const s of SLOTS){ const k=mode==='drop'?wRar():mode; const p=mkPart(s,k,level,'p'+(i++),enh); parts.push(p); slots[s]=p.uid; }
  return {parts,slots};
}
const rb=(t,l,k)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:k?k.slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
function fight(aT,aL,aM,aE,bT,bL,bM,bE,n){ let w=0;
  for(let i=0;i<n;i++){ const ka=kit(aM,aL,aE), kb=kit(bM,bL,bE);
    const P=makeUnit('P',aT,computeStats(rb(aT,aL,ka),ka?ka.parts:[]));
    const E=makeUnit('E',bT,computeStats(rb(bT,bL,kb),kb?kb.parts:[]));
    if(simulate(P,E,ns()).slice(-1)[0].winner==='P') w++; } return w/n; }
function grp(ak,aL,aM,aE,bk,bL,bM,bE,per=10){ let a=0,c=0;
  for(const x of byR[ak]) for(const y of byR[bk]){ a+=fight(x,aL,aM,aE,y,bL,bM,bE,per); c++; } return a/c; }
const KS=ROBOT_RARITY.map(r=>r.k);

console.log('== ③ 양쪽 다 자연 분포 파츠를 낀 상태에서의 등급 사다리 (Lv.30) ==');
console.log('\t'+KS.join('\t'));
for(const a of KS) console.log(a+'\t'+KS.map(b=>(grp(a,30,'drop',0,b,30,'drop',0)*100).toFixed(0)).join('\t'));

console.log('\n== ④ 파츠가 등급을 뒤집나 (Lv.30) ==');
const cases=[
  ['커먼 + SR 풀장착','C','SR',0,'에픽 + 없음','EP',null,0],
  ['커먼 + SR 풀장착','C','SR',0,'에픽 + 자연분포','EP','drop',0],
  ['커먼 + SSR 풀장착','C','SSR',0,'에픽 + 자연분포','EP','drop',0],
  ['커먼 + SSR +10','C','SSR',10,'에픽 + 자연분포','EP','drop',0],
  ['커먼 + 자연분포','C','drop',0,'에픽 + 없음','EP',null,0],
];
for(const [n1,k1,m1,e1,n2,k2,m2,e2] of cases)
  console.log(`${n1.padEnd(18)} vs ${n2.padEnd(16)} → ${(grp(k1,30,m1,e1,k2,30,m2,e2)*100).toFixed(0)}%`);

console.log('\n== ⑤ 파츠 품질 차이만으로 갈리는 승률 (같은 등급·같은 레벨 Lv.30) ==');
console.log('내 파츠 \ 상대\t없음\tC\t자연분포\tR\tSR\tSSR');
for(const mine of [null,'C','drop','R','SR','SSR']){
  const row=[null,'C','drop','R','SR','SSR'].map(opp=>{ let a=0,c=0;
    for(const t of Object.keys(ROBOT_TYPES)){ a+=fight(t,30,mine,0,t,30,opp,0,8); c++; }
    return (a/c*100).toFixed(0); });
  console.log((mine||'없음')+'\t\t'+row.join('\t'));
}
