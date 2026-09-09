/* 파츠 세트(CONST.PART_SET)를 재는 도구.

   성공 조건은 하나다 — **세트가 수치를 이기면 안 된다.**
   좋은 파츠를 버리고 세트를 맞추는 것이 늘 정답이면, 선택이 하나 생긴 것이 아니라
   정답이 하나 바뀐 것뿐이다. ③이 그것을 직접 판정한다.

   세트 효과만 떼어 보기 위해 **같은 파츠를 굴려 이름만 바꾼다.** 수치는 한 글자도
   다르지 않고 계열만 달라지므로, 승률 차이는 전부 세트에서 온 것이다.

   판수는 명령줄에서: node tools/set.mjs 3000 */
import { ROBOT_TYPES, RARITY, SLOTS, PART_NAMES, CONST } from '../data/balance.js';
import { computeStats, setCounts } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
import { genPart } from '../js/gacha.js';
import { pct, pm, argN } from './stat.mjs';

const N=argN(1500);
const LV=30;
const KEYS=Object.keys(CONST.PART_SET||{});
if(!KEYS.length){ console.log('CONST.PART_SET 이 없습니다.'); process.exit(0); }

const T=Object.keys(ROBOT_TYPES);
let S=23; const ns=()=>((S=Math.imul(S,1103515245)+12345|0)>>>0);
const rnd=()=>{ let x=ns(); return x/4294967296; };
const rb=(t,slots)=>({uid:'x',type:t,level:LV,exp:0,fat:0,slots});

/* 어느 계열에도 안 들어간 이름 — 대조군이다 */
const PLAIN={};
for(const slot of SLOTS){
  const used=new Set(KEYS.map(k=>CONST.PART_SET[k].names[slot]));
  PLAIN[slot]=PART_NAMES[slot].find(n=>!used.has(n));
}

/* 네 칸을 같은 등급으로 채운다. setKey 를 주면 이름만 그 계열로 바꾼다.
   pieces 를 주면 그 개수만큼만 계열로 하고 나머지는 무계열이다. */
function loadout(rar, setKey, pieces){
  const parts=[], slots={};
  const n=pieces==null?4:pieces;
  SLOTS.forEach((slot,i)=>{
    const p=genPart(LV, rnd, 's'+slot, rar, slot);
    p.name = (setKey && i<n) ? CONST.PART_SET[setKey].names[slot] : PLAIN[slot];
    parts.push(p); slots[slot]=p.uid;
  });
  return { parts, slots };
}

/* 거울 대결. 양쪽 다 같은 등급 파츠를 새로 굴린다 — 세트 말고는 기댓값이 같다 */
function duel(type, mine, theirs, n){
  let k=0;
  for(let i=0;i<n;i++){
    const A=loadout(mine.rar, mine.set, mine.pieces);
    const B=loadout(theirs.rar, theirs.set, theirs.pieces);
    const sa=computeStats(rb(type,A.slots), A.parts);
    const sb=computeStats(rb(type,B.slots), B.parts);
    const ev=simulate(makeUnit('P',type,sa), makeUnit('E',type,sb), ns());
    if(ev[ev.length-1].winner==='P') k++;
  }
  return k;
}
function all(mine, theirs){
  let k=0,n=0;
  for(const t of T){ k+=duel(t,mine,theirs,N); n+=N; }
  return {k,n};
}

console.log(`파츠 세트 측정 · Lv.${LV} 거울 대결 · 한 칸 ${N*T.length}판\n`);

/* ── ① 세트가 얼마나 세나 (같은 등급, 이름만 다름) ───────────────── */
console.log('== ① 같은 등급에서 세트만 갖췄을 때 (상대는 무계열) ==');
console.log('등급\t' + KEYS.map(k=>CONST.PART_SET[k].ko+' 2세트').join('\t') + '\t' + KEYS.map(k=>CONST.PART_SET[k].ko+' 4세트').join('\t'));
for(const r of RARITY.map(x=>x.k)){
  const row=[];
  for(const k of KEYS) row.push(pm(...Object.values(all({rar:r,set:k,pieces:2},{rar:r,set:null})) ));
  for(const k of KEYS) row.push(pm(...Object.values(all({rar:r,set:k,pieces:4},{rar:r,set:null})) ));
  console.log(r+'\t'+row.join('\t'));
}

/* ── ② 우연히 걸릴 확률 ─────────────────────────────────────────
   이름은 균등하게 뽑힌다. 2세트가 저절로 걸리는 일이 흔하면 '모으는 재미'가 없고,
   너무 드물면 아무도 4세트를 못 본다. */
console.log('\n== ② 아무렇게나 낀 네 칸에 세트가 걸릴 확률 ==');
{
  const trials=200000; let two=0, four=0;
  for(let i=0;i<trials;i++){
    const parts=[], slots={};
    for(const slot of SLOTS){ const p=genPart(LV,rnd,'r'+slot,'C',slot); parts.push(p); slots[slot]=p.uid; }
    const c=setCounts({slots}, parts), m=Math.max(0,...Object.values(c));
    if(m>=2) two++; if(m>=4) four++;
  }
  console.log(`  2세트 이상 ${(two/trials*100).toFixed(1)}% · 4세트 ${(four/trials*100).toFixed(3)}%`);
  console.log('  (4세트를 보려면 네 칸을 일부러 맞춰야 한다 — 그래서 만렙 뒤의 목표가 된다)');
}

/* ── ③ 세트가 수치를 이기나 ────────────────────────────────────
   **이 게임의 답이 바뀌는지**를 보는 자리다. 낮은 등급으로 세트를 맞춘 쪽이
   한 등급 위의 무계열을 이기면 안 된다 — 그러면 좋은 파츠를 줍는 의미가 없어진다. */
console.log('\n== ③ 세트가 수치를 이기나 (아래 등급 4세트 vs 위 등급 무계열) ==');
const order=RARITY.map(x=>x.k);
let broke=0;
for(let i=0;i<order.length-1;i++){
  const lo=order[i], hi=order[i+1];
  for(const k of KEYS){
    const r=all({rar:lo,set:k,pieces:4},{rar:hi,set:null});
    const w=r.k/r.n;
    const bad=w>0.5;
    if(bad) broke++;
    console.log(`  ${CONST.PART_SET[k].ko} ${lo} 4세트 vs ${hi} 무계열\t${pct(r.k,r.n)}${bad?'\t← 세트가 이겼다':''}`);
  }
}
console.log(broke ? `\n  ✗ ${broke}건에서 세트가 등급을 이겼다. 좋은 파츠를 주울 이유가 사라진다.`
                  : '\n  ✓ 세트로는 등급을 못 이긴다. 세트는 덤이지 지름길이 아니다.');
