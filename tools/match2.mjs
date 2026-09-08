/* 파츠를 낀 상태에서 '게임이 실제로 붙여 주는 상대'와의 승률 — node tools/match2.mjs [레이팅]
   tools/match.mjs 는 맨몸 기준이다. 이쪽이 실제 플레이에 가깝다.

   상대의 장비는 **내 레이팅**을 따라온다(2026-09-08 부터). 그래서 이 표가 답하는 질문은
   '같은 성적대에서 장비가 좋아지면 이기는가' 다 — **위에서 아래로 갈수록 올라가야 한다.**
   예전에는 상대가 내 장비를 그대로 따라와서, 좋은 파츠를 낄수록 오히려 내려갔다
   (커먼 Lv.15: 맨몸 54% → R 4개 33%). 그 문제를 잡았는지 여기서 본다. */
import { ROBOT_TYPES, ROBOT_RARITY, SLOTS } from '../data/balance.js';
import { computeStats } from '../js/stats.js';
import { makeUnit, simulate, mulberry32 } from '../js/sim.js';
import { makeOpponent } from '../js/rewards.js';
import { genPart } from '../js/gacha.js';
const byR={}; for(const r of ROBOT_RARITY) byR[r.k]=Object.keys(ROBOT_TYPES).filter(i=>ROBOT_TYPES[i].rarity===r.k);
const RATING=parseInt(process.argv[2]||'1000',10);   // 이 성적대에서 잰다
let S=307; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const rnd=()=>ns()/4294967296;
/* 파츠는 **게임의 genPart 를 그대로 쓴다.**
   예전에는 여기서 따로 만들었는데, 그 함수가 대가(SLOT_COST)와 구간(spread)을 빼먹었다.
   대가가 붙기 전에 쓴 코드가 그대로 남아 있었던 것이다. 그래서 내 파츠만 순수 이득이 되고
   상대 파츠(genPart)에는 대가가 붙어, 승률이 실제보다 크게 부풀려 나왔다
   (커먼 보유 Lv.15 · R 4개 실측 69% → 실제 규칙으로는 그보다 훨씬 낮다). */
function mkPart(slot,rarK,level,uid,enh){
  const p=genPart(level, rnd, uid, rarK, slot);
  p.enh=enh; return p;
}
function kit(rarK,level,enh,n){
  const parts=[],slots={WEAPON:null,FRAME:null,BOOSTER:null,CORE:null};
  SLOTS.slice(0,n).forEach((s,i)=>{ const p=mkPart(s,rarK,level,'p'+i,enh); parts.push(p); slots[s]=p.uid; });
  return {parts,slots};
}
function run(myK,lv,rarK,enh,n,owned,trials){
  let w=0,seq=0;
  for(const t of byR[myK]) for(let i=0;i<trials;i++){
    const k=kit(rarK,lv,enh,n);
    const me={uid:'x',type:t,level:lv,exp:0,fat:0,slots:k.slots};
    const r=mulberry32(ns());
    const opp=makeOpponent(owned, lv, r, ()=>'u'+(seq++), false, RATING);
    const P=makeUnit('P',t,computeStats(me,k.parts));
    const E=makeUnit('E',opp.type,computeStats({type:opp.type,level:opp.level,fat:0,slots:opp.slots},opp.parts));
    if(simulate(P,E,ns()).slice(-1)[0].winner==='P') w++;
  }
  return w/(byR[myK].length*trials);
}
console.log(`생성 상대와의 승률 — 내 파츠 상태별 (레이팅 ${RATING} 고정)`);
console.log('같은 성적대라면 장비가 좋아질수록 승률이 올라가야 한다 — 그게 장비의 보상이다');
console.log('내 장비\t\t\tC보유 Lv.15\tR보유 Lv.30\tEP보유 Lv.60');
const rows=[
  ['맨몸','C',0,0],['C 2개 +0','C',0,2],['자연분포급 R 4개 +0','R',0,4],
  ['SR 4개 +3','SR',3,4],['SSR 4개 +10','SSR',10,4],
];
for(const [lab,rar,enh,n] of rows){
  const a=(run('C',15,rar,enh,n,['C'],40)*100).toFixed(0);
  const b=(run('R',30,rar,enh,n,['C','UC','R'],40)*100).toFixed(0);
  const c=(run('EP',60,rar,enh,n,['C','UC','R','UQ','EP'],40)*100).toFixed(0);
  console.log(`${lab.padEnd(20)}\t${a}%\t\t${b}%\t\t${c}%`);
}
