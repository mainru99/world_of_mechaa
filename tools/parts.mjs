/* 파츠를 낀 상태에서 밸런스가 어떻게 달라지나.
   지금까지의 측정은 전부 맨몸이었다 — 실제 플레이는 파츠를 낀다. */
import { ROBOT_TYPES, ROBOT_RARITY, RARITY, SLOTS, SLOT_STATS, STAT_ROLL, CONST } from '../data/balance.js';
import { computeStats, power, isPct } from '../js/stats.js';
import { genPart } from '../js/gacha.js';
import { makeUnit, simulate } from '../js/sim.js';
const byR={}; for(const r of ROBOT_RARITY) byR[r.k]=Object.keys(ROBOT_TYPES).filter(i=>ROBOT_TYPES[i].rarity===r.k);
let S=131; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const rnd=()=>ns()/4294967296;
const pick=a=>a[Math.floor(rnd()*a.length)];
const rf=(a,b)=>rnd()*(b-a)+a;

/* genPart 와 같은 규칙. 등급만 지정한다. */
/* 파츠는 **게임의 genPart 를 그대로 쓴다.**
   예전에는 도구마다 따로 만들었는데, 그 코드가 대가(SLOT_COST)와 구간(spread)이
   생기기 전 것이라 상승분만 굴렸다. 그래서 파츠가 순수 이득으로 잡혀 값이 부풀려졌다. */
function mkPart(slot, rarK, level, uid, enh=0){
  const p=genPart(level, rnd, uid, rarK, slot);
  p.enh=enh; return p;
}
/* 4슬롯 풀장착 */
function kit(rarK, level, enh=0){
  const parts=[], slots={WEAPON:null,FRAME:null,BOOSTER:null,CORE:null};
  let i=0;
  for(const s of SLOTS){ const p=mkPart(s,rarK,level,'p'+(i++),enh); parts.push(p); slots[s]=p.uid; }
  return {parts, slots};
}
const rb=(t,l,k)=>({uid:'x',type:t,level:l,exp:0,fat:0,slots:k?k.slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
function fight(aT,aL,aK,bT,bL,bK,n){
  let w=0;
  for(let i=0;i<n;i++){
    const ka=aK?kit(aK,aL):null, kb=bK?kit(bK,bL):null;
    const P=makeUnit('P',aT,computeStats(rb(aT,aL,ka), ka?ka.parts:[]));
    const E=makeUnit('E',bT,computeStats(rb(bT,bL,kb), kb?kb.parts:[]));
    if(simulate(P,E,ns()).slice(-1)[0].winner==='P') w++;
  }
  return w/n;
}
function grp(aK_,aL,aP,bK_,bL,bP,per=12){ let a=0,c=0;
  for(const x of byR[aK_]) for(const y of byR[bK_]){ a+=fight(x,aL,aP,y,bL,bP,per); c++; } return a/c; }

console.log('== ① 같은 기체·같은 레벨, 한쪽만 파츠 풀장착 → 낀 쪽 승률 ==');
console.log('파츠등급\tLv.1\tLv.15\tLv.30\tLv.60');
for(const k of ['C','R','SR','SSR']){
  const row=[1,15,30,60].map(lv=>{ let a=0,c=0;
    for(const t of Object.keys(ROBOT_TYPES)){ a+=fight(t,lv,k,t,lv,null,10); c++; }
    return (a/c*100).toFixed(0)+'%'; });
  console.log(`${k}\t${row.join('\t')}`);
}
console.log('\n== ② 파츠 한 세트가 전투력에 더하는 비율 ==');
console.log('파츠등급\tLv.1\tLv.30\tLv.60');
for(const k of ['C','R','SR','SSR']){
  const row=[1,30,60].map(lv=>{ let a=0,c=0;
    for(const t of Object.keys(ROBOT_TYPES)){ const ki=kit(k,lv);
      a += power(rb(t,lv,ki),ki.parts)/power(rb(t,lv)); c++; }
    return '+'+((a/c-1)*100).toFixed(0)+'%'; });
  console.log(`${k}\t${row.join('\t')}`);
}
