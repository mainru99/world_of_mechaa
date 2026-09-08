/* ==================================================================
 * ROWAR - 상태 · 화면 · 게임 루프 (Claude 담당 · CONTRACT.md 참조)
 *   루프: 뽑기 -> 기체 육성(레벨/파츠) -> 상대 매칭 -> 자동 대전 -> 파밍
 *   저장: localStorage (rowar.save.v2)
 *
 * 데이터는 data/balance.js, 스탯 계산은 js/stats.js, 전투는 js/sim.js 에 있다.
 * 이 파일만 DOM 을 만진다 — 나머지는 서버(Worker)에서도 그대로 import 된다.
 * ================================================================== */
import { ROBOT_TYPES, MONSTER_TYPES, ROBOT_RARITY, ROBOT_RARITY_CR, PULL_TABLE, PULL_TABLE_CR,
         SLOTS, SLOT_STATS, PART_NAMES, RARITY, STAT_ROLL, CONST,
         TERRITORY, TERRAIN } from '../data/balance.js';
import { RR, RIDX, ROBOT_IDS, COMBAT_TYPES, BY_RARITY, MONSTER_BY_RARITY, rarOf } from './units.js';
import { isPct, fatOf, serviceCost, sortieCost, findPart, partStat, gainExp, addFat, decayFat, fatNextMs, fatRecoverMs, atkRange,
         expNeed, battleExp, lvCost, enhCost,
         computeStats as _computeStats, power as _power } from './stats.js';
import { mulberry32, makeUnit, simulate } from './sim.js';
import { runBreach, rarAllowed } from './breach.js';
import * as net from './net.js';
import { rollPull, genPart as _genPart, autoScrapValue, scrapValue, PULL_CUR } from './gacha.js';
import { makeOpponent as _makeOpponent } from './rewards.js';
import { sprite, preloadSprites } from './sprites.js';

const { MAXLV, PULL_COST, ATK_SCALE, FAT_MAX, DUPE_GAIN, SQUAD_MAX } = CONST;
const PULL_KO = { robot:'로봇', core:'코어', credit:'크레딧', part:'파츠', bust:'꽝' };
const SLOT_KO = {WEAPON:'무장',FRAME:'프레임',BOOSTER:'부스터',CORE:'코어'};
const STAT_LABEL = { hp:'내구', atk:'공격', def:'방어', spd:'속도', crit:'치명', eva:'회피', spread:'구간' };
/* 스탯 바의 상한 — 손으로 적어 두면 밸런스가 바뀔 때마다 어긋난다. 실제로 어긋나 있었다:
   상한이 내구 1500 인데 Lv.60 내구는 3900 이라, 중반부터는 바가 늘 꽉 차 아무것도 알려주지 않았다.
   그래서 기체 표에서 '최고 레벨 최댓값'을 뽑고 파츠 몫으로 35% 를 얹는다. */
const STAT_MAX = (() => {
  const m = { hp:0, atk:0, def:0, spd:0, crit:.75, eva:.6 };
  for (const T of Object.values(ROBOT_TYPES))
    for (const k of ['hp','atk','def','spd'])
      m[k] = Math.max(m[k], (T.base[k] + (T.grow[k]||0) * (MAXLV-1)) * (k==='atk' ? ATK_SCALE : 1));
  for (const k of ['hp','atk','def','spd']) m[k] = Math.round(m[k] * 1.35);
  return m;
})();

/* ------------------------------- 유틸 ------------------------------- */
const R = Math.random;
const ri = (a,b)=>Math.floor(R()*(b-a+1))+a;
const rf = (a,b)=>R()*(b-a)+a;
const pick = a => a[Math.floor(R()*a.length)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const fmt = n => Math.round(n).toLocaleString();
let _uid = Math.floor(R()*1e6);
const uid = () => (_uid++).toString(36);
function weighted(list){ let t=list.reduce((s,x)=>s+x.w,0), r=R()*t; for(const x of list){ if((r-=x.w)<=0) return x; } return list[list.length-1]; }
const $ = (s,r=document)=>r.querySelector(s);
function robRarTag(type){ const k=rarOf(type), r=RR[k];
  if(!r) return `<span class="tag">${k}</span>`;   // 봉인된 BOSS 등급 등, 표에 없는 등급도 죽지 않게
  return `<span class="tag rr-${r.k}">${r.ko}</span>`; }


/* ------------------------------- 상태/저장 ------------------------------- */
const SAVE_KEY = 'rowar.save.v2';   // v1(로봇 3기 체제)은 로스터가 완전히 달라 호환되지 않는다
let S = null;
function emptySlots(){ return {WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}; }
function freshState(){         // 시작: 커먼 1기, Lv.1 — 나머지 기체는 뽑기로만 얻는다
  const u = uid();
  /* squad 는 이번에 데려갈 기체(최대 CONST.SQUAD_MAX 기)의 uid 목록.
     레벨·경험치는 기체마다 따로다 — 뽑아서 키우는 것이 이 게임의 보상이다. */
  return { v:2, credits:600, cores:12, scrap:30,
    robots:[{uid:u,type:pick(BY_RARITY.C),level:1,exp:0,fat:0,slots:emptySlots()}],
    parts:[], sel:0, squad:[u], stat:{wins:0,losses:0,pulls:0} };
}
/* 저장본은 언제든 망가져 들어올 수 있다(다른 탭, 손수 편집, 예전 버전, 저장 중 오류).
   여기서 걸러내지 못하면 격납고가 통째로 렌더 실패해 '빈 화면 + 복구 불가'가 된다.
   그래서 모양이 어긋난 값은 버리지 말고 기본값으로 메운다. */
function num(v, dflt){ v = Number(v); return Number.isFinite(v) ? v : dflt; }
function normalize(j){         // 저장본에 빠진 필드 보정
  if(!Array.isArray(j.robots)) return freshState();
  j.robots = j.robots.filter(rb=>rb && ROBOT_TYPES[rb.type]);   // 몬스터·보스·미지의 id 는 소유 불가
  if(!j.robots.length) return freshState();
  if(!Array.isArray(j.parts)) j.parts = [];
  j.credits = Math.max(0, Math.round(num(j.credits, 0)));
  j.cores   = Math.max(0, Math.round(num(j.cores,   0)));
  j.scrap   = Math.max(0, Math.round(num(j.scrap,   0)));
  const st = j.stat && typeof j.stat==='object' ? j.stat : {};
  j.stat = { wins:Math.max(0,num(st.wins,0)), losses:Math.max(0,num(st.losses,0)), pulls:Math.max(0,num(st.pulls,0)) };
  const partIds = new Set(j.parts.map(p=>p && p.uid).filter(Boolean));
  for(const rb of j.robots){
    rb.level=clamp(Math.round(num(rb.level,1)),1,MAXLV);
    rb.exp=Math.max(0,Math.round(num(rb.exp,0)));
    if(rb.fat==null && rb.dur!=null) rb.fat = clamp(100-num(rb.dur,100), 0, FAT_MAX);   // 예전 '내구도' 저장본 이관
    delete rb.dur; rb.fat = fatOf(rb); decayFat(rb);      // 껐던 동안의 자연 회복 정산
    if(!rb.slots || typeof rb.slots!=='object') rb.slots = emptySlots();
    for(const sl of SLOTS){
      const u = rb.slots[sl];
      if(u && !partIds.has(u)) rb.slots[sl] = null;       // 사라진 파츠를 물고 있으면 놓아준다
      else if(u === undefined) rb.slots[sl] = null;
    }
  }
  /* 원정 — 서버가 준 그대로 들고 있는다. endsAt 은 서버 시각이라 클라가 남은 시간을 센다. */
  if(j.expd && !(j.expd.endsAt > 0)) j.expd = null;

  /* 편성 — 보유한 기체만, 중복 없이, 최대 SQUAD_MAX 기. 비면 첫 기체를 넣는다. */
  const own = new Set(j.robots.map(r=>r.uid));
  const seen = new Set();
  j.squad = (Array.isArray(j.squad)? j.squad : []).filter(u=>{
    if(!own.has(u) || seen.has(u)) return false; seen.add(u); return true; }).slice(0, SQUAD_MAX);
  if(!j.squad.length) j.squad = [j.robots[0].uid];

  /* 나갈 기체는 편성 안에 있어야 한다 */
  j.sel = clamp(Math.round(num(j.sel,0)), 0, j.robots.length-1);
  if(!j.squad.includes(j.robots[j.sel].uid)) j.sel = j.robots.findIndex(r=>r.uid===j.squad[0]);
  j.v = 2; return j;
}
function load(){
  try{ localStorage.removeItem('rowar.save.v1'); }catch(e){}      // 옛 저장본 정리
  try{ const j=JSON.parse(localStorage.getItem(SAVE_KEY)); if(j&&j.robots&&j.robots.length) return normalize(j); }catch(e){}
  return freshState();
}
function save(){
  try{ localStorage.setItem(SAVE_KEY,JSON.stringify(S)); }catch(e){}
  net.scheduleSync(()=>S);          // 실제 전송은 몇 초 뒤 한 번만. 오프라인이면 아무 일도 안 한다
}

/* ------------------------------- 스탯 계산 ------------------------------- */
/* computeStats / power 는 js/stats.js 의 순수 함수다. 여기서는 기본 parts 로 S.parts 를
   채워 주는 얇은 래퍼만 두어, 아래 호출부를 원래 형태 그대로 유지한다. */
const computeStats = (robot, parts) => _computeStats(robot, parts || S.parts);
const power        = (robot, parts) => _power(robot, parts || S.parts);
const overallLevel = ()=> Math.max(1, ...S.robots.map(r=>r.level));

/* ------------------------------- 파츠/뽑기 ------------------------------- */
/* 뽑기 판정은 js/gacha.js 로 옮겼다 — Worker 가 같은 파일을 import 해서 서버가 판정한다 */
const genPart = level => _genPart(level, R, uid);
const autoScrap = p => autoScrapValue(p.rarity);
/* 판정 결과 하나를 상태에 반영한다. 서버가 판정한 결과도 같은 함수로 적용하므로
   '누가 굴렸든' 반영 방식은 한 곳뿐이다. */
function applyPull(res){
  if(!res) return null;
  /* 새 기체는 Lv.1 부터다. 키우는 과정이 뽑기의 보상이다. */
  /* uid 는 서버가 실제로 넣은 값을 쓴다. 여기서 새로 만들면 서버 행과 어긋나
     그 기체로는 편성·선택·정비·원정이 전부 'robot not found' 가 된다.
     res.uid 가 없는 것은 서버 없이 굴리는 경로뿐이라 그때만 만든다. */
  if(res.kind==='robot'){ S.robots.push({uid:res.uid||uid(),type:res.type,level:1,exp:0,fat:0,slots:emptySlots()}); }
  else if(res.kind==='dupe'){ const g=res.gain; S.credits+=g.cr; S.scrap+=g.sc; S.cores+=g.co; }
  else if(res.kind==='core'){ S.cores+=res.n; }
  else if(res.kind==='credit'){ S.credits+=res.cr; }
  else if(res.kind==='part'){ S.parts.push(res.part); }
  else if(res.kind==='scrap'){ S.scrap+=res.n; }
  return res;
}
function pull(){
  if(S.cores<PULL_COST){ toast('코어가 부족합니다'); return null; }
  S.cores-=PULL_COST; S.stat.pulls++;
  const owned=new Set(S.robots.map(r=>r.type));
  const res=applyPull(rollPull(owned, overallLevel(), R, uid));
  save(); return res;
}

/* ------------------------------- 장착/육성 ------------------------------- */
function selRobot(){ return S.robots[S.sel]; }
/* 격납고 조작도 서버가 판정한다. 비용 계산과 가능 여부를 클라가 하면
   크레딧을 쓰지 않고 레벨을 올리는 식의 조작이 가능하다.
   클라는 '무엇을 하겠다'만 보내고, 확정된 값을 받아 적는다. */
/* 서버가 내는 오류를 사람 말로. 여기 없으면 영문이 그대로 화면에 뜬다 —
   서버에 새 오류를 더하면 여기도 함께 채울 것. */
const ERR_KO = { 'not enough credits':'크레딧이 부족합니다', 'not enough scrap':'스크랩이 부족합니다',
  'max level':'최대 레벨입니다', 'max enhanced':'최대 강화입니다', 'already serviced':'이미 정비된 상태입니다',
  'slot mismatch':'그 슬롯에 넣을 수 없는 파츠입니다', 'part not found':'파츠를 찾을 수 없습니다',
  'bad slot':'알 수 없는 슬롯입니다', 'robot not found':'그 기체를 찾을 수 없습니다',
  'not in squad':'출격 편성에 없는 기체입니다', 'squad cannot be empty':'최소 한 기는 편성해야 합니다',
  'no player':'계정 정보를 찾을 수 없습니다', 'unknown action':'알 수 없는 요청입니다',
  'expedition in progress':'이미 원정 중입니다', 'no expedition':'나가 있는 원정이 없습니다',
  'expedition not done':'아직 귀환 전입니다', 'no robot left':'남은 기체가 없어 보낼 수 없습니다',
  'part equipped':'장착 중인 파츠는 분해할 수 없습니다', 'cannot scrap':'분해할 수 없는 파츠입니다',
  'protected':'점령 직후 보호 중인 칸입니다', 'not protected':'보호 중인 칸이 아닙니다',
  'busy':'앞선 요청이 아직 처리 중입니다', 'expedition already claimed':'이미 받은 원정입니다',
  'battle already started':'이미 시작된 전투입니다',
  'locked':'아직 열리지 않은 칸입니다',
  'not enough cores':'코어가 부족합니다',
  'robot on expedition':'원정 나간 기체입니다', 'unknown expedition':'알 수 없는 원정입니다',
  'unknown node':'없는 칸입니다', 'already yours':'이미 내 점령지입니다',
  'squad blocked':'편성 제한에 걸려 데려갈 기체가 없습니다',
  'no territory':'점령한 칸이 없습니다', 'nothing to claim':'아직 쌓인 수입이 없습니다',
  'node has no defense':'칸 정보를 읽지 못했습니다',
  'no robot':'출격할 수 있는 기체가 없습니다' };

async function srvHangar(action, args){
  if(!net.state.online){ toast('격납고 조작은 서버 연결이 필요합니다'); return null; }
  const r = await net.hangar(action, args);
  if(!r){ toast('서버 연결이 필요합니다'); return null; }
  if(r.error){ toast(ERR_KO[r.error] || ('실패: '+r.error)); return null; }
  return r;
}
/* 서버가 확정한 뒤 로컬을 맞춘다. save() 로 되올리지 않도록 직접 쓴다. */
function commitLocal(){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){}
  net.cancelSync();
  renderAll();
}

async function equip(slot,partUid){
  const rb=selRobot();
  const r=await srvHangar('equip',{robotUid:rb.uid, slot, partUid}); if(!r) return;
  for(const x of S.robots) for(const sl of SLOTS) if(x.slots[sl]===partUid) x.slots[sl]=null;
  rb.slots[slot]=partUid; commitLocal(); closeModal();
}
async function unequip(slot){
  const rb=selRobot();
  const r=await srvHangar('unequip',{robotUid:rb.uid, slot}); if(!r) return;
  rb.slots[slot]=null; commitLocal(); closeModal();
}
/* 분해하면 받는 스크랩. 강화한 만큼 더 쳐 준다 — 서버(server/hangar.js)와 같은 식이어야
   화면의 숫자와 실제로 들어오는 값이 갈리지 않는다. */
const scrapGain = p => Math.round(scrapValue(p.rarity) * (1 + (p.enh||0) * 0.25));

async function scrapPart(u){
  const p=findPart(u,S.parts); if(!p) return;
  const worn = S.robots.some(r=>Object.values(r.slots).includes(u));
  if(worn){ toast('장착 중인 파츠는 분해할 수 없습니다'); return; }
  /* 되돌릴 수 없으므로 한 번 묻는다. 강화한 파츠는 특히 실수하기 쉽다. */
  openModal(`<div class="mhead">파츠 분해 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="pchip"><div class="pn">${esc(p.name)} ${rarTag(p)}</div>
      <div class="ps">${SLOT_KO[p.slot]}${partStatLine(p)}</div></div>
    <div class="hint" style="margin:10px 0;color:var(--bad)">분해하면 되돌릴 수 없습니다.</div>
    <div class="row-btns">
      <button class="btn big gold" onclick="ROWAR.doScrap('${u}')">분해 · 스크랩 +${fmt(scrapGain(p))}</button>
      <button class="btn big" onclick="ROWAR.closeModal()">그만두기</button></div>`);
}
async function doScrap(u){
  const p=findPart(u,S.parts); if(!p) return;
  closeModal();
  const r=await srvHangar('scrap',{partUid:u}); if(!r) return;
  S.parts=S.parts.filter(x=>x.uid!==u); S.scrap=r.scrap;
  commitLocal(); renderWallet(); renderHangar();
  toast(p.name+' 분해 · 스크랩 +'+fmt(r.gain));
}

async function enhancePart(u){
  const p=findPart(u,S.parts); if(!p) return;
  const r=await srvHangar('enhance',{partUid:u}); if(!r) return;
  p.enh=r.enh; S.scrap=r.scrap; commitLocal(); toast(p.name+' +'+p.enh);
}
async function service(){
  const rb=selRobot();
  const r=await srvHangar('service',{robotUid:rb.uid}); if(!r) return;
  S.credits=r.credits; rb.fat=0; rb.fatAt=Date.now(); commitLocal();
  toast(ROBOT_TYPES[rb.type].name+' 정비 완료');
}
async function levelUp(){
  const rb=selRobot();
  const r=await srvHangar('levelup',{robotUid:rb.uid}); if(!r) return;
  S.credits=r.credits; rb.level=r.level; rb.exp=0; commitLocal();
  toast(ROBOT_TYPES[rb.type].name+' Lv.'+rb.level);
}

/* 출격 편성에 넣고 뺀다. 상대를 잡아 둔 상태면 서버가 그 상대를 놓는다(dropped). */
async function toggleSquad(u){
  const has=S.squad.includes(u);
  let next = has ? S.squad.filter(x=>x!==u) : [...S.squad, u];
  if(!next.length){ toast('최소 한 기는 편성해야 합니다'); return; }
  if(next.length>SQUAD_MAX) next = [...S.squad.slice(1), u];   // 가장 오래된 것을 밀어낸다
  const r=await srvHangar('squad',{robotUids:next}); if(!r) return;
  S.squad = r.squad || next;
  if(!S.squad.includes(S.robots[S.sel].uid)) S.sel = S.robots.findIndex(x=>x.uid===S.squad[0]);
  _pendingOpp = null;                       // 서버가 놓았으므로 클라도 잊는다
  commitLocal(); renderHangar();
  toast(r.dropped ? '편성 변경 · 잡아 둔 상대를 놓았습니다' : '편성 변경');
}

/* ------------------------------- UI 기본 ------------------------------- */
let cur='hangar', toastT;
/* 데이터에서 온 글자를 화면(innerHTML)에 넣을 때는 반드시 이걸 거친다.
   지금은 서버가 주는 이름이 전부 안전한 모양이지만(닉네임은 GUEST-#### 이나
   영문·숫자·밑줄 아이디, 파츠 이름은 정해진 목록), 그 전제가 깨지는 순간 화면이 곧
   실행 통로가 된다. 값을 믿는 대신 넣는 자리에서 막는다. */
const esc = v => String(v == null ? '' : v)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'),1600); }
/* 배경 연출은 body[data-scene] 하나로 갈린다.
   hangar/gacha = 격납고, battle = 야간작전, arena = 콕핏 HUD */
function setScene(name){ document.body.dataset.scene = name; }
/* 대전 화면을 앞으로 꺼낸다. go('battle') 과 달리 **다시 그리지 않는다** —
   대전은 자체 흐름(찾기 → 발견 → 아레나 → 결과)이라, 여기서 renderBattleHome 을 부르면
   방금 만든 화면이 날아간다. bg 를 주면 배경만 따로 바꾼다(재생 중에는 콕핏 배경).

   예전에는 이 자리에서 setScene() 만 불렀는데 그건 **배경만** 바꾼다. 대전 탭에서
   들어오면 sc-battle 이 이미 active 라 우연히 동작했지만, 토벌 탭에서 누르면
   sc-hunt 가 active 인 채여서 상대 카드가 '보이지 않는 화면 뒤'에 그려졌다.
   '토벌이 눌리기만 하고 아무 일도 안 일어난다'의 정체가 이것이다. */
function toBattle(bg){
  cur = 'battle';
  setScene(bg || 'battle');
  document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active', s.id==='sc-battle'));
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active', b.dataset.s==='battle'));
}
function go(scr){ cur=scr; setScene(scr); document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id==='sc-'+scr));
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.s===scr));
  renderWallet();
  if(scr==='hangar') renderHangar();
  else if(scr==='gacha') renderGacha();
  else if(scr==='battle') renderBattleHome();     // 대전은 여기서만 처음부터 그린다
  else if(scr==='rank') renderRank();
  else if(scr==='hunt') renderHunt();
  else if(scr==='terr') renderTerr(); }
function renderWallet(){ $('#w-credit').textContent=fmt(S.credits); $('#w-core').textContent=fmt(S.cores); $('#w-scrap').textContent=fmt(S.scrap); }
/* 대전 화면은 자체 흐름(상대 찾기 → 발견 → 아레나 → 결과)을 갖는다.
   여기서 renderBattleHome() 을 부르면 재생 중인 전투나 방금 뜬 결과 화면이 날아간다.
   그래서 renderAll 은 대전 화면을 건드리지 않는다. 대전 화면은 go() 가 그린다. */
function renderAll(){ renderWallet(); if(cur==='hangar')renderHangar(); else if(cur==='gacha')renderGacha(); }
function openModal(html){ const m=$('#modal'); m.innerHTML=`<div class="modal-card">${html}</div>`; m.classList.add('on'); m.onclick=e=>{ if(e.target===m) closeModal(); }; }
function closeModal(){ $('#modal').classList.remove('on'); $('#modal').innerHTML=''; }

function rarTag(p){ return `<span class="tag rar-${p.rarity}">${p.rarity}${p.enh?` +${p.enh}`:''}</span>`; }
/* 파츠 한 줄. 세 가지를 다르게 보여 준다.
     상승  그대로
     대가  붉게 (−) — 이 파츠를 낄지 말지의 근거
     구간  금색 (±) — 좋고 나쁨이 아니라 성향이다. 약자는 넓히고 강자는 좁힌다. */
/* 옵션은 한 줄에 하나씩 적는다. 페널티를 빨간 취소선으로 두었더니 '적용되지 않는
   옵션'처럼 보였다. 색과 취소선을 빼고 부호(+/−)로만 구분한다 — 구간도 같은 색이다. */
function partStatLine(p){ const ps=partStat(p);
  return Object.keys(ps).map(k=>{
    const v=ps[k], t=isPct(k)?(Math.abs(v)*100).toFixed(1)+'%':Math.abs(Math.round(v));
    const sign = v<0 ? '−' : '+';
    const name = k==='spread' ? '구간' : STAT_LABEL[k];
    return `<div class="pstat">${name} ${sign}${t}</div>`;
  }).join(''); }
/* 12분 34초 / 1시간 20분 형태로. 회복 안내는 분 단위면 충분하다 */
function dur(ms){
  const s=Math.max(0,Math.round(ms/1000));
  if(s<60) return s+'초';
  const m=Math.round(s/60);
  if(m<60) return m+'분';
  return Math.floor(m/60)+'시간 '+(m%60?m%60+'분':'');
}
function statBar(k,v,full,range){  // full 을 주면 깎여나간 만큼을 붉게 겹쳐 보여준다
                                  // range 를 주면 숫자 대신 구간으로 쓴다(공격력)
  const dmg = full!=null && full>v;
  /* 깎였을 때 큰 숫자는 '원래 최대치'다. 바도 full 까지 그려 놓고 그중 붉은 부분이 손실이라
     "494 −222" 로 읽힌다. 현재 유효치(272)를 크게 쓰면 "272에서 222를 또 뺀다"로 오해된다. */
  const shown = dmg ? full : v;
  const pct=clamp(v/STAT_MAX[k]*100,0,100);
  /* 공격력은 고정값이 아니라 구간이다. 한 방의 위력은 매번 이 사이에서 정해진다. */
  const val=range ? `${fmt(range[0])}<span style="opacity:.55">~</span>${fmt(range[1])}`
                  : isPct(k)?(shown*100).toFixed(0)+'%':fmt(shown);
  const ghost = dmg? `<u style="width:${clamp(full/STAT_MAX[k]*100,0,100)}%"></u>` : '';
  const lost  = dmg? ` <s>−${fmt(full-v)}</s>` : '';
  return `<div class="stat"><div class="row"><b>${STAT_LABEL[k]}</b><span>${val}${lost}</span></div><div class="bar">${ghost}<i style="width:${pct}%"></i></div></div>`; }

/* ------------------------------- 격납고 화면 ------------------------------- */
function renderHangar(){
  const rb=selRobot(), T=ROBOT_TYPES[rb.type], st=computeStats(rb);
  const roster = S.robots.map((r,i)=>{ const t=ROBOT_TYPES[r.type];
    const inSq=S.squad.indexOf(r.uid), out=inSq>=0;
    return `<div class="rcard ${i===S.sel?'sel':''}${out?' squad':''}" data-t="${t.rarity}" onclick="ROWAR.selectRobot(${i})">
      <span class="badge">${out?(i===S.sel?'출격':'대기'):''} Lv.${r.level}</span>
      <span class="badge rt rr-${t.rarity}">${RR[t.rarity].ko}</span>
      <div class="sprite" data-t="${t.rarity}">${sprite(r.type,false)}</div>
      <div class="rn">${t.name}</div><div class="rl">전투력 ${fmt(power(r))}</div>
      ${fatOf(r)?`<div class="rd">피로 ${fatOf(r)}</div>`:''}
      <button class="sqbtn${out?' on':''}" onclick="event.stopPropagation();ROWAR.toggleSquad('${r.uid}')"
        >${out?'편성 해제':'편성'}</button></div>`; }).join('');
  const slotsHtml = SLOTS.map(slot=>{ const u=rb.slots[slot]; const p=u&&findPart(u,S.parts);
    return `<div class="slot ${p?'filled':''}" onclick="ROWAR.openSlot('${slot}')">
      <div class="sl">${SLOT_KO[slot]}</div>
      ${p?`<div class="pn">${esc(p.name)}</div><div class="pp">${rarTag(p)}</div>`:`<div class="pn" style="color:var(--dim)">+ 장착</div>`}</div>`; }).join('');
  const invParts = S.parts.filter(p=> !S.robots.some(r=>Object.values(r.slots).includes(p.uid)));
  /* 뽑기가 더 이상 일반 파츠를 자동으로 없애지 않으므로, 치우는 일은 여기서 한다.
     칩 전체는 강화, 오른쪽 아래 작은 버튼이 분해다 — 분해는 되돌릴 수 없어 따로 눌러야 한다. */
  const inv = invParts.length? invParts.map(p=>`<div class="pchip" onclick="ROWAR.enhance('${p.uid}')" title="클릭: 강화(스크랩 ${enhCost(p.enh||0)})">
      <div class="pn">${esc(p.name)} ${rarTag(p)}</div><div class="ps">${SLOT_KO[p.slot]}${partStatLine(p)}</div>
      <div class="pfoot"><span class="ps" style="color:var(--gold)">클릭 → 강화 (스크랩 ${enhCost(p.enh||0)})</span>
        <button class="scrapb" onclick="event.stopPropagation();ROWAR.scrapPart('${p.uid}')"
          title="분해하면 되돌릴 수 없습니다">분해 +${fmt(scrapGain(p))}</button></div></div>`).join('')
    : `<div class="empty">보유한 여분 파츠가 없습니다. 뽑기나 대전으로 획득하세요.</div>`;
  const cost=lvCost(rb.level), fat=fatOf(rb), scost=serviceCost(rb);
  $('#sc-hangar').innerHTML = `
    <h2 class="title">격납고 · 보유 로봇 ${S.robots.length}기</h2>
    <div class="panel">
      <div class="hint" style="margin-bottom:8px">기체마다 레벨이 따로 매겨집니다. 새로 뽑은 기체는 Lv.1부터 키웁니다.
        <b>한 번에 데려갈 수 있는 것은 ${SQUAD_MAX}기</b>이고,
        대전 상대를 찾아 둔 상태에서 편성을 바꾸면 <b>그 상대를 놓칩니다.</b></div>
      <div class="roster">${roster}</div></div>
    <div class="panel">
      <div class="detail">
        <div><div class="sprite" data-t="${T.rarity}">${sprite(rb.type,false)}</div></div>
        <div>
          <div class="rname">${T.name} ${robRarTag(rb.type)} <span class="lv">Lv.${rb.level}</span>${
            S.squad.includes(rb.uid)?'':' <span class="tag" style="color:var(--bad)">편성 밖</span>'}</div>
          <div class="rrole">${T.role} · 전투력 ${fmt(power(rb))}</div>
          <div class="stat exp"><div class="row"><b>EXP</b><span>${
            rb.level>=MAXLV?'MAX':`${fmt(rb.exp||0)} / ${fmt(expNeed(rb.level))}`}</span></div>
            <div class="bar"><i style="width:${rb.level>=MAXLV?100:clamp((rb.exp||0)/expNeed(rb.level)*100,0,100)}%"></i></div></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;margin-top:6px">
            ${['hp','atk','def','spd','crit','eva'].map(k=>statBar(k,st[k],
                k==='hp'?st.hpFull:null, k==='atk'?atkRange(st):null)).join('')}
          </div>
          <div class="hint" style="margin-top:2px">공격력은 타격할 때마다 위 구간 안에서 정해집니다 ·
            이 기체의 폭 <b>±${Math.round(st.spread*100)}%</b>${
              st.spread<=.16?' (정밀 — 거의 같은 수로 맞힙니다)'
            : st.spread>=.28?' (고화력 — 크게 흔들립니다)' : ''}</div>
          <div class="stat fat"><div class="row"><b>피로도</b>
              <span class="${fat?'worn':''}">${fat} / ${FAT_MAX}${fat?` <s>최대 내구 −${fat}%</s>`:''}</span></div>
            <div class="bar"><i style="width:${fat/FAT_MAX*100}%"></i></div>
            <div class="hint" style="margin-top:4px">${fat
              ? `자연 회복 중 · 다음 1까지 ${dur(fatNextMs(rb))}, 전부 풀리기까지 ${dur(fatNextMs(rb)+(fat-1)*fatRecoverMs(rb))}`
              : '피로 없음 · 정상 가동'}</div></div>
          <div class="skill"><b>스킬 · ${T.skill.name}</b><p>${T.skill.desc}</p></div>
          <div class="row-btns" style="margin-top:10px">
            <button class="btn big" ${(rb.level>=MAXLV||!net.state.online)?'disabled':''} onclick="ROWAR.levelUp()">
              ${rb.level>=MAXLV?'최대 레벨':`즉시 레벨업 (크레딧 ${fmt(cost)})`}</button>
            <button class="btn big ${scost>0?'gold':''}" ${(scost>0&&net.state.online)?'':'disabled'} onclick="ROWAR.service()">
              ${scost>0?`정비 (크레딧 ${fmt(scost)})`:'정비 완료'}</button>
          </div>
          ${net.state.online?'':'<div class="hint" style="margin-top:6px;color:var(--bad)">서버에 연결되지 않아 장착·강화·정비·레벨업을 할 수 없습니다.</div>'}
          <div class="hint" style="margin-top:6px">대전에 출전하면 경험치를 얻어 자동으로 레벨업합니다.
            대신 피로도가 쌓여 최대 내구(체력)가 줄어듭니다. 시간이 지나면 저절로 풀리고,
            급하면 크레딧으로 정비하세요. 레벨이 높은 기체일수록 자연 회복이 느립니다.</div>
        </div>
      </div>
      <div class="slots">${slotsHtml}</div>
    </div>
    <div class="panel">
      <h2 class="title" style="margin-top:0">파츠 인벤토리</h2>
      <div class="hint">파츠를 누르면 <b>강화</b>됩니다(스크랩을 씁니다). 장착하려면 위의 슬롯을 누르세요.
        쓰지 않을 파츠는 <b>분해</b>해 스크랩으로 바꿀 수 있습니다. 뽑기로 얻은 파츠는 자동으로 사라지지 않습니다.</div>
      <div class="inv">${inv}</div>
    </div>`;
}
function openSlot(slot){
  const rb=selRobot(); const equippedHere=rb.slots[slot];
  const list=S.parts.filter(p=>p.slot===slot);
  const rows = list.length? list.map(p=>{ const equipped = S.robots.some(r=>Object.values(r.slots).includes(p.uid));
    const onMe = equippedHere===p.uid;
    return `<div class="pchip" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div><div class="pn">${esc(p.name)} ${rarTag(p)}</div><div class="ps">${partStatLine(p)}</div>
      ${equipped&&!onMe?`<div class="ps" style="color:var(--bad)">다른 기체 장착중</div>`:''}</div>
      <button class="btn ${onMe?'danger':''}" style="padding:8px 12px;font-size:13px"
        onclick="ROWAR.${onMe?`unequip('${slot}')`:`equip('${slot}','${p.uid}')`}">${onMe?'해제':'장착'}</button>
    </div>`; }).join('') : `<div class="empty">이 슬롯(${SLOT_KO[slot]})에 맞는 파츠가 없습니다.</div>`;
  openModal(`<div class="mhead">${SLOT_KO[slot]} 슬롯 · 파츠 선택 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>${rows}`);
}

/* ------------------------------- 뽑기 화면 ------------------------------- */
/* 지금 보고 있는 뽑기 창구. 코어와 크레딧이 확률표를 따로 쓴다. */
let gCur = 'core';
const setGacha = c => { gCur = PULL_CUR[c] ? c : 'core'; renderGacha(); };

function renderGacha(){
  const C = PULL_CUR[gCur];
  const table = gCur==='credit' ? PULL_TABLE_CR : PULL_TABLE;
  const rars  = gCur==='credit' ? ROBOT_RARITY_CR : ROBOT_RARITY;
  const wsum  = rars.reduce((s,r)=>s+r.w,0);
  const appear = table.find(t=>t.k==='robot');
  const appearP = (appear?appear.w:0)/100;
  const partP = table.find(t=>t.k==='part');
  const tipCol={bust:'var(--dim)',core:'var(--acc2)',credit:'var(--gold)',robot:'var(--acc2)',part:'var(--sub)'};

  const have = gCur==='credit' ? S.credits : S.cores;
  const cost1 = C.cost, cost10 = C.cost*10;
  const unit = gCur==='credit' ? '크레딧' : '코어';

  const rate=`<div class="rates">
    ${table.map(t=>`<span class="tag" style="color:${tipCol[t.k]}">${PULL_KO[t.k]} ${t.w}%</span>`).join('')}</div>
    <div class="rates" style="margin-top:6px">
    <span class="tag" style="color:var(--sub)">로봇 등급</span>
    ${rars.map(r=>`<span class="tag rr-${r.k}">${r.ko} ${(appearP*r.w/wsum*100).toFixed(3)}%</span>`).join('')}</div>
    <div class="rates" style="margin-top:6px">
    <span class="tag" style="color:var(--sub)">파츠 등급</span>
    <span class="tag rar-C">일반 52%</span><span class="tag rar-R">정밀 30%</span>
    <span class="tag rar-SR">시제 14%</span><span class="tag rar-SSR">초월 4%</span></div>`;

  $('#sc-gacha').innerHTML = `
    <h2 class="title">뽑기</h2>
    <div class="panel">
      <div class="gtabs">
        <button class="gtab ${gCur==='core'?'on':''}"   onclick="ROWAR.setGacha('core')">코어 캡슐<span>코어 ${fmt(S.cores)}</span></button>
        <button class="gtab ${gCur==='credit'?'on':''}" onclick="ROWAR.setGacha('credit')">크레딧 캡슐<span>크레딧 ${fmt(S.credits)}</span></button>
      </div>
      <div class="gacha-stage" id="stage"><div class="ray" style="opacity:.35"></div><div class="capsule"></div></div>
      ${rate}
      <div class="row-btns" style="margin-top:12px">
        <button class="btn gold big" onclick="ROWAR.pull1()" ${(have<cost1||!net.state.online)?'disabled':''}>1회 뽑기 (${unit} ${fmt(cost1)})</button>
        <button class="btn big" onclick="ROWAR.pull10()" ${(have<cost10||!net.state.online)?'disabled':''}>10회 뽑기 (${unit} ${fmt(cost10)})</button>
      </div>
      ${net.state.online?'':'<div class="hint" style="margin-top:8px;color:var(--bad)">서버에 연결되지 않아 뽑기를 할 수 없습니다. 뽑기 결과는 서버가 판정합니다.</div>'}
      <div class="hint" style="margin-top:8px">${gCur==='credit'
        ? `크레딧은 대전·점령지에서 꾸준히 들어옵니다. 대신 <b>기체가 나올 확률이 코어보다 낮고</b>,
           나오더라도 낮은 등급으로 크게 쏠립니다. 코어가 마른 동안 돌리는 창구입니다.`
        : `코어는 대전 승리와 안쪽 점령지에서 조금씩 얻습니다.`}
        기체는 ${ROBOT_RARITY.length}등급 ${ROBOT_IDS.length}종이며, 이미 가진 기체가 나오면 등급에 맞춰 자원으로 분해됩니다.
        <b>뽑은 파츠는 자동으로 분해되지 않으니</b> 격납고에서 직접 정하세요.</div>
    </div>`;
}
/* 뽑기는 서버가 판정한다.
   클라가 "이런 게 나왔다"고 보내는 것을 받지 않기 때문에, 클라 코드를 고쳐도
   결과를 조작할 수 없다. 대신 연결이 없으면 뽑을 수 없다 — 오프라인에서 로컬로
   굴리게 두면 끊고 굴린 뒤 올리면 그만이라 서버 판정의 의미가 사라진다. */
async function doPull(count){
  const C = PULL_CUR[gCur] || PULL_CUR.core;
  const need = C.cost * count;
  const have = gCur==='credit' ? S.credits : S.cores;
  if(have < need){ toast((gCur==='credit'?'크레딧':'코어')+'가 부족합니다'); return; }
  if(!net.state.online){ toast('뽑기는 서버 연결이 필요합니다'); return; }

  const stage=$('#stage'); stage.classList.add('rolling');
  const r = await net.pullServer(count, gCur);
  await sleep(650); stage.classList.remove('rolling');

  if(!r){ toast('뽑기는 서버 연결이 필요합니다'); return; }
  if(r.error){ toast(r.error==='not enough cores' ? '코어가 부족합니다'
                   : r.error==='not enough credits' ? '크레딧이 부족합니다'
                   : '뽑기 실패: '+r.error); return; }

  /* 서버가 재화까지 확정해서 돌려준다. 클라는 그 값을 그대로 받아 적는다. */
  for(const res of r.results) applyPull(res);
  S.credits = r.credits; S.cores = r.cores; S.scrap = r.scrap;
  S.stat.pulls += r.results.length;
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){}   // save() 를 쓰면 곧바로 되올린다
  net.cancelSync();                                                     // 서버가 이미 최신이다
  renderWallet(); renderGacha();
  showReveal(r.results);
}
const pull1  = () => doPull(1);
const pull10 = () => doPull(10);
function revealCardHtml(res){
  if(res.kind==='robot') return `<div class="pchip" style="border-color:var(--acc)"><div class="pn" style="color:var(--acc2)">신규 로봇! ${ROBOT_TYPES[res.type].name} ${robRarTag(res.type)}</div><div class="ps">${ROBOT_TYPES[res.type].role}</div></div>`;
  if(res.kind==='dupe'){ const g=res.gain||DUPE_GAIN[rarOf(res.type)];
    return `<div class="pchip"><div class="pn">${ROBOT_TYPES[res.type].name} ${robRarTag(res.type)} (중복)</div><div class="ps" style="color:var(--gold)">분해 → 크레딧 +${g.cr}, 스크랩 +${g.sc}${g.co?`, 코어 +${g.co}`:''}</div></div>`; }
  if(res.kind==='core') return `<div class="pchip" style="border-color:var(--acc2)"><div class="pn" style="color:var(--acc2)">코어 +${res.n}</div><div class="ps">뽑기를 한 번 더 돌릴 수 있습니다</div></div>`;
  if(res.kind==='credit') return `<div class="pchip"><div class="pn" style="color:var(--gold)">크레딧 +${fmt(res.cr)}</div><div class="ps">레벨업·정비에 쓰세요</div></div>`;
  if(res.kind==='bust') return `<div class="pchip" style="opacity:.6"><div class="pn" style="color:var(--dim)">꽝</div><div class="ps">아무것도 나오지 않았습니다</div></div>`;
  if(res.kind==='scrap') return `<div class="pchip"><div class="pn">${esc(res.part.name)} <span class="tag rar-${res.part.rarity}">${res.part.rarity}</span></div><div class="ps" style="color:var(--sub)">자동 분해 → 스크랩 +${res.n}</div></div>`;
  const p=res.part; return `<div class="pchip"><div class="pn">${esc(p.name)} ${rarTag(p)}</div><div class="ps">${SLOT_KO[p.slot]}${partStatLine(p)}</div></div>`;
}
function showReveal(results){
  const best=results.reduce((a,b)=> rankOf(b)>rankOf(a)?b:a, results[0]);
  const heroType = (best.kind==='robot'||best.kind==='dupe')? best.type : null;
  const hero = heroType ? `<div class="sprite" data-t="${rarOf(heroType)}">${sprite(heroType,false)}</div>`
             : best.kind==='part'   ? bigPartArt(best.part)
             : best.kind==='scrap'  ? bigIconArt('♻','var(--sub)')
             : best.kind==='core'   ? bigIconArt('◆','var(--acc2)')
             : best.kind==='credit' ? bigIconArt('₡','var(--gold)')
                                    : bigIconArt('✕','var(--dim)');
  const list = results.length>1? `<div class="inv" style="max-height:150px;overflow:auto;width:100%">${results.map(revealCardHtml).join('')}</div>` : revealCardHtml(results[0]);
  openModal(`<div class="mhead">뽑기 결과 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="reveal-hero">${hero}</div>${list}
    <button class="btn big" style="margin-top:12px" onclick="ROWAR.closeModal()">확인</button>`);
  renderGacha();
}
function rankOf(res){ if(res.kind==='robot')return 200+RIDX[rarOf(res.type)];
  if(res.kind==='dupe')return 100+RIDX[rarOf(res.type)];
  if(res.kind==='core')return 60;
  if(res.kind==='credit')return 20;
  if(res.kind==='scrap')return 10;
  if(res.kind==='bust')return -1;
  return {C:1,R:2,SR:3,SSR:4}[res.part.rarity]||0; }
function bigIconArt(ch,col){
  return `<div style="width:120px;height:120px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:46px;color:${col};background:radial-gradient(circle at 40% 30%,#233a63,#0c1220);border:2px solid ${col}">${ch}</div>`; }
function bigPartArt(p){ const c={C:'#8a97b5',R:'#4aa3ff',SR:'#c07bff',SSR:'#ffb03a'}[p.rarity];
  return `<div style="width:120px;height:120px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:34px;color:${c};background:radial-gradient(circle at 40% 30%,#233a63,#0c1220);border:2px solid ${c}">${SLOT_KO[p.slot][0]}</div>`; }

/* ------------------------------- 대전 ------------------------------- */
let _pendingOpp=null, _battleRobot=null, battleSpeed=1;   // 기본은 등속. 빠르게 보고 싶으면 x2~x8 로 올린다
function renderBattleHome(){
  const rb=selRobot(), T=ROBOT_TYPES[rb.type];
  $('#sc-battle').innerHTML = `
    <h2 class="title">대전 · 상대 찾기</h2>
    <div class="panel">
      <div class="oppcard">
        <div class="sprite" data-t="${T.rarity}" style="height:120px">${sprite(rb.type,false)}</div>
        <div>
          <div class="rname">${T.name} ${robRarTag(rb.type)} <span class="lv">Lv.${rb.level}</span></div>
          <div class="rrole">${T.role}</div>
          <div style="margin-top:6px;font-weight:800;color:var(--gold)">전투력 ${fmt(power(rb))}</div>
          <div class="hint">출전 기체는 격납고에서 고른 기체입니다.</div>
        </div>
      </div>
      <div class="hint" style="margin-top:10px">다른 기체나 야생 몬스터를 상대합니다. 몬스터는 대전에서만 나타납니다.</div>
      ${net.state.online ? `<div class="hint" style="margin-top:6px">
        출격비 <b style="color:var(--gold)">${fmt(sortieCost(rb))} 크레딧</b>
        ${S.credits < sortieCost(rb)
          ? ` · <b style="color:var(--bad)">크레딧이 모자라 비상 출격으로 나갑니다</b>(보상은 크레딧만)`
          : ''}</div>` : ''}
      ${net.state.online
        ? `<button class="btn big" style="margin-top:12px" onclick="ROWAR.findMatch()">상대 찾기</button>`
        : `<button class="btn big" style="margin-top:12px" onclick="ROWAR.practiceFind()">연습 대전</button>
           <div class="hint" style="margin-top:8px">
             서버에 연결되지 않았습니다. <b>연습 대전</b>은 지금 편성으로 싸워 볼 수 있지만
             <b style="color:var(--bad)">아무것도 얻지 못합니다</b> — 경험치·크레딧·파츠·전적이 움직이지 않습니다.
             승패와 보상은 서버만 판정합니다.
           </div>`}
      <div class="hint" style="margin-top:8px">전적 · ${S.stat.wins}승 ${S.stat.losses}패
        <span style="color:var(--dim)"> · 상대와 승패는 서버가 정합니다</span></div>
    </div>`;
}
/* ------------------------------- 랭킹 ------------------------------- */
/* 순위는 서버 크론이 미리 계산해 둔 값을 받아 오기만 한다.
   여기서 세면 하위권일수록 거의 전원을 읽어 무료 한도가 마른다. */
/* 순위는 30분 크론이 미리 계산해 둔 값이다. 화면을 열 때마다 다시 부르면
   같은 답을 받으려고 요청만 쓴다(요청 수가 곧 무료 한도다). 잠깐 들고 있는다.
   전투로 내 레이팅이 움직였으면 캐시를 버린다 — 그때는 값이 실제로 달라진다. */
let _rankCache=null, _rankAt=0;
/* 내 레이팅. 랭킹을 한 번이라도 열었으면 그 값을, 아니면 시작값을 쓴다. */
function myRating(){
  const me = _rankCache && _rankCache.me;
  return (me && Number.isFinite(me.rating)) ? me.rating : 1000;
}
const RANK_TTL = 90000;
function dropRankCache(){ _rankCache=null; _rankAt=0; }

async function renderRank(){
  const el=$('#sc-rank');
  const wrap = inner => `<h2 class="title">랭킹</h2>${inner}`;
  if(!net.state.online){
    el.innerHTML = wrap(`<div class="panel"><div class="hint">랭킹은 서버 연결이 필요합니다.</div></div>`);
    return;
  }
  const fresh = _rankCache && (Date.now()-_rankAt) < RANK_TTL;
  if(!fresh) el.innerHTML = wrap(`<div class="panel"><div class="mm"><div class="spinner"></div>
    <div style="font-weight:800">순위를 불러오는 중...</div></div></div>`);

  const r = fresh ? _rankCache : await net.ranking();
  if(r && !r.error){ _rankCache=r; _rankAt=Date.now(); }
  if(!r || r.error){
    el.innerHTML = wrap(`<div class="panel"><div class="hint">순위를 불러오지 못했습니다${r&&r.error?' · '+esc(r.error):''}</div></div>`);
    return;
  }

  const me=r.me;
  const myRank = me.rank==null ? '집계 중' : me.rank+'위';
  const when = r.ranked_at ? (d=>`${d.getMonth()+1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`)(new Date(r.ranked_at)) : '아직 없음';

  /* 레이팅 숫자는 화면에 내지 않는다. 순위를 정하는 값이지만, 사용자가 볼 것은 순위와
     전적이면 충분하다 — 숫자가 보이면 그 숫자를 올리는 게 목적이 되어 버린다.
     (서버 응답에는 그대로 있다. 상대 장비를 이 값에 맞추므로 클라도 들고는 있어야 한다) */
  const wr = (w, l) => (w + l) ? Math.round(w / (w + l) * 100) + '%' : '—';
  const rows = r.top.map(t=>`
    <tr class="${t.me?'mine':''}">
      <td class="rk">${t.rank}</td>
      <td class="nm">${esc(t.nickname)}${t.me?' <span class="tag">나</span>':''}</td>
      <td class="rt">${wr(t.wins, t.losses)}</td>
      <td class="wl">${t.wins}승 ${t.losses}패</td>
    </tr>`).join('');

  el.innerHTML = wrap(`
    <div class="panel myrank">
      <div><div class="hint">내 순위</div><div class="big">${myRank}</div></div>
      <div><div class="hint">승률</div><div class="big">${wr(me.wins, me.losses)}</div></div>
      <div><div class="hint">전적</div><div class="big">${me.wins}승 ${me.losses}패</div></div>
    </div>
    <div class="panel">
      <table class="rank">
        <thead><tr><th class="rk">#</th><th class="nm">이름</th><th class="rt">승률</th><th class="wl">전적</th></tr></thead>
        <tbody>${rows||'<tr><td class="hint" colspan="4">아직 아무도 없습니다.</td></tr>'}</tbody></table>
      <div class="hint" style="margin-top:8px">
        ${when} 집계 기준 · 전체 ${fmt(r.total)}명${me.live?' · 내 순위는 방금 계산한 값':''}
      </div>
    </div>`);
}

/* 상대는 서버가 고른다. 상대 레벨이 보상에 들어가므로 클라가 고르게 두면
   만렙 상대만 잡아 경험치를 부풀릴 수 있다. */
async function findMatch(opts){
  toBattle();
  $('#sc-battle').innerHTML = `<h2 class="title">대전</h2><div class="panel"><div class="mm">
    <div class="spinner"></div><div style="font-weight:800">상대를 검색하는 중...</div>
    <div class="hint">상대 로봇과 야생 몬스터의 신호를 탐색합니다.</div></div></div>`;

  if(!net.state.online){ renderBattleHome(); toast('대전은 서버 연결이 필요합니다'); return; }
  const [r] = await Promise.all([net.battleFind(opts), sleep(1000)]);   // 연출용 최소 대기
  if(!r || r.error){
    if(r && r.need!=null){ go('hunt'); toast(`크레딧이 모자랍니다 · 필요 ${fmt(r.need)} / 보유 ${fmt(r.have)}`); return; }
    renderBattleHome(); toast('상대를 찾지 못했습니다'+(r&&r.error?': '+r.error:'')); return;
  }

  setPending(r.opponent, r.cost, r.rescue, r.tier);
  showOpponent(_pendingOpp);
}

function setPending(o, cost, rescue, tier){
  _pendingOpp = o ? { kind:o.kind, callsign:o.callsign, rating:o.rating,
    robot:{ uid:'E', type:o.type, level:o.level, fat:0, slots:o.slots },
    parts:o.parts, cost:cost|0, rescue:!!rescue, tier:tier||null } : null;
}

/* ------------------------------- 토벌 ------------------------------- */
/* 파밍 자리. 아레나는 크레딧과 순위, 토벌은 스크랩과 파츠를 준다.
   등급이 곧 관문이다 — 비용이 오르고 상대 레벨도 올라간다.
   BOSS 는 내 레벨 +12 라, 잡히기 시작하면 파밍 효율이 가장 좋다. */
/* 토벌 등급 이름. 예전에는 '일반·정예·희귀·초희귀·전설'로 따로 두었는데,
   같은 등급 코드(C·UC·R·UQ·EP)를 기체는 '커먼·언커먼·레어·유니크·에픽'으로 부르고 있어
   화면마다 다른 이름이 나왔다. 기체 쪽 이름에서 파생시켜 하나로 맞춘다. */
const HUNT_KO = { ...Object.fromEntries(ROBOT_RARITY.map(r=>[r.k, r.ko])), BOSS:'보스' };
/* ── 원정 ──────────────────────────────────────────────
   기체를 얼마간 내보내 두고 재화를 받아 온다. 보낸 기체는 그동안 못 싸운다 —
   편성이 두 기뿐이라 주력을 보내면 대전이 눈에 띄게 불편해진다. 그게 이 기능의 대가다.
   남은 시간은 서버가 준 endsAt 으로 여기서 센다. 진행을 물으러 서버에 가지 않는다. */
function expedReward(tier, lv){
  const T=CONST.EXPED[tier];
  return { cr: Math.round(T.crH*T.h*lv), sc: Math.round(T.scH*T.h*lv),
           coreP: T.coreP, partP: T.partP, h: T.h };
}
function renderExped(){
  if(!net.state.online)
    return `<div class="panel"><h2 class="title" style="margin-top:0">원정</h2>
      <div class="hint">원정은 서버 연결이 필요합니다. 보상을 서버가 판정합니다.</div></div>`;

  const e=S.expd;
  if(e){
    const T=CONST.EXPED[e.tier]||{}, rb=S.robots.find(r=>r.uid===e.uid);
    const left=e.endsAt-Date.now(), done=left<=0;
    const rw=expedReward(e.tier, e.level||1);
    return `<div class="panel expd ${done?'done':''}">
      <h2 class="title" style="margin-top:0">원정 · ${T.ko||e.tier}</h2>
      <div class="expd-row">
        <div>
          <div class="rname">${rb?ROBOT_TYPES[rb.type].name:'기체'} <span class="lv">Lv.${e.level}</span></div>
          <div class="rrole">${done?'귀환 완료':'귀환까지 '+dur(left)}</div>
        </div>
        <div class="expd-rw">크레딧 ${fmt(rw.cr)} · 스크랩 ${fmt(rw.sc)}${
          rw.coreP?` · 코어 ${Math.round(rw.coreP*100)}%`:''}${rw.partP?` · 파츠 ${Math.round(rw.partP*100)}%`:''}</div>
      </div>
      <button class="btn big ${done?'gold':''}" ${done?'':'disabled'} onclick="ROWAR.claimExped()"
        >${done?'보상 받기':'원정 중 — 이 기체는 출격할 수 없습니다'}</button>
    </div>`;
  }

  const rows=Object.keys(CONST.EXPED).map(t=>{
    const T=CONST.EXPED[t], rw=expedReward(t, selRobot().level);
    return `<button class="hunt-row" onclick="ROWAR.pickExped('${t}')">
      <div class="ht"><span class="tag" style="color:var(--acc2)">${T.ko}</span><b>${T.h}시간</b></div>
      <div class="hn">크레딧 ${fmt(rw.cr)} · 스크랩 ${fmt(rw.sc)}${
        T.coreP?` · 코어 ${Math.round(T.coreP*100)}%`:''}${T.partP?` · 파츠 ${Math.round(T.partP*100)}%`:''}</div>
      <div class="hd">보상은 보내는 기체의 레벨에 비례합니다</div>
    </button>`; }).join('');
  return `<div class="panel">
    <h2 class="title" style="margin-top:0">원정</h2>
    <div class="hint">기체 한 기를 정해진 시간 동안 내보내 재화를 받아 옵니다.
      <b>보낸 기체는 그동안 출격할 수 없으며, 한 번에 한 기만 내보낼 수 있습니다.</b>
      위 수치는 지금 고른 기체(Lv.${selRobot().level}) 기준이고, 보낼 기체는 다음 화면에서 고릅니다.</div>
    <div class="hunt-list" style="margin-top:10px">${rows}</div>
  </div>`;
}

/* 어느 기체를 보낼지 — 여기가 이 기능의 판단이다.
   보상이 레벨에 비례하므로 주력을 보내면 많이 받지만 그만큼 대전이 불편해진다. */
function pickExped(tier){
  const T=CONST.EXPED[tier];
  const list=S.robots.map(r=>{
    const rw=expedReward(tier, r.level), out=S.squad.includes(r.uid);
    return `<button class="pchip" style="width:100%;text-align:left" onclick="ROWAR.sendExped('${tier}','${r.uid}')">
      <div class="pn">${ROBOT_TYPES[r.type].name} <span class="lv">Lv.${r.level}</span>${
        out?' <span class="tag" style="color:var(--gold)">편성 중</span>':''}</div>
      <div class="ps">크레딧 ${fmt(rw.cr)} · 스크랩 ${fmt(rw.sc)}</div>
      ${out?'<div class="ps" style="color:var(--bad)">보내면 편성에서 빠집니다</div>':''}
    </button>`; }).join('');
  openModal(`<div class="mhead">${T.ko} · ${T.h}시간 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="hint" style="margin-bottom:8px">보낼 기체를 고르세요. 보상은 기체의 레벨에 비례합니다.</div>
    <div style="display:grid;gap:8px">${list}</div>`);
}
async function sendExped(tier, uid){
  closeModal();
  const r=await net.expedition('send',{tier, robotUid:uid});
  if(!r) return;
  if(r.error){ toast(ERR_KO[r.error]||('실패: '+r.error)); return; }
  const rb=S.robots.find(x=>x.uid===uid);
  S.expd={ tier, level:rb?rb.level:1, endsAt:r.endsAt, uid, ready:false };
  S.squad=S.squad.filter(u=>u!==uid);
  if(!S.squad.length){ const alt=S.robots.find(x=>x.uid!==uid); if(alt) S.squad=[alt.uid]; }
  if(!S.squad.includes(S.robots[S.sel].uid)) S.sel=S.robots.findIndex(x=>x.uid===S.squad[0]);
  _pendingOpp=null;                       // 서버가 잡아 둔 상대를 놓았다
  commitLocal(); renderHunt();
  toast(CONST.EXPED[tier].ko+' 출발 · '+CONST.EXPED[tier].h+'시간 뒤 귀환');
}
async function claimExped(){
  const r=await net.expedition('claim',{});
  if(!r) return;
  if(r.error){ toast(ERR_KO[r.error]||('실패: '+r.error)); return; }
  S.credits=r.player.credits; S.cores=r.player.cores; S.scrap=r.player.scrap;
  if(r.reward.part) S.parts.push(r.reward.part);
  S.expd=null; commitLocal(); renderHunt(); renderWallet();
  const g=[`크레딧 +${fmt(r.reward.cr)}`,`스크랩 +${fmt(r.reward.sc)}`];
  if(r.reward.core) g.push(`코어 +${r.reward.core}`);
  if(r.reward.part) g.push(`파츠 ${r.reward.part.name}`);
  toast('원정 귀환 · '+g.join(' · '));
}

function renderHunt(){
  const rb=selRobot();
  if(!net.state.online){
    $('#sc-hunt').innerHTML = `${renderExped()}<h2 class="title">토벌</h2>
      <div class="panel"><div class="hint">토벌은 서버 연결이 필요합니다. 보상을 서버가 판정합니다.</div></div>`;
    return;
  }
  const rows = Object.keys(CONST.HUNT).map(t=>{
    const H=CONST.HUNT[t], cost=Math.ceil(sortieCost(rb)*H.costX), poor=S.credits<cost;
    const lv=Math.max(1,Math.min(MAXLV, rb.level+H.lv));
    const names=(MONSTER_BY_RARITY[t]||[]).map(id=>MONSTER_TYPES[id].name).join(' · ');
    return `<button class="hunt-row${poor?' poor':''}" ${poor?'disabled':''} onclick="ROWAR.hunt('${t}')">
      <!-- 등급 색은 .rr-* 다. .rar-* 는 파츠 등급(C/R/SR/SSR)이라 UC·UQ·EP 규칙이 아예 없어,
           정예·초희귀·전설 세 줄만 색 없이 회색으로 떴다. -->
      <div class="ht"><span class="tag rr-${t}">${HUNT_KO[t]}</span>
        <b>Lv.${lv}</b></div>
      <div class="hn">${names}</div>
      <div class="hd">스크랩 ×${H.scX} · 파츠 ${Math.round(H.partP*100)}%${H.coreP?` · 코어 ${Math.round(H.coreP*100)}%`:''}</div>
      <div class="hc ${poor?'bad':''}">${fmt(cost)}</div>
    </button>`;
  }).join('');
  $('#sc-hunt').innerHTML = `${renderExped()}<h2 class="title">토벌 · 사냥터</h2>
    <div class="panel">
      <div class="hint">몬스터를 사냥해 <b>스크랩과 파츠</b>를 얻습니다. 크레딧은 대전의 절반에 못 미치고,
        순위에도 반영되지 않습니다. 등급이 높을수록 출격비가 비싸고 상대도 강합니다.</div>
      <div class="hunt-list" style="margin-top:10px">${rows}</div>
      <div class="hint" style="margin-top:8px">출전 · ${ROBOT_TYPES[rb.type].name} Lv.${rb.level} · 보유 ${fmt(S.credits)} 크레딧</div>
    </div>`;
}
function hunt(tier){ findMatch({ mode:'hunt', tier }); }

/* '한 판 더' — 서버가 직전 응답에 다음 상대를 실어 보내므로 왕복이 필요 없다.
   (예전에는 여기서 findMatch 를 불러 한 판마다 요청을 두 번 썼다)
   미리 받은 게 없거나 만료됐으면 그때만 다시 찾는다. */
function nextMatch(){
  if(!_pendingOpp) return findMatch();
  toBattle();
  showOpponent(_pendingOpp);
}
/* 연습 대전의 상대. 예전에는 여기에 상대 생성 규칙이 따로 한 벌 있었는데,
   서버가 js/rewards.js 의 규칙으로 옮겨 간 뒤로 둘이 갈라져 있었다 —
   연습에서는 아직 ±2 레벨에 등급 보정도 없어서, 같은 화면인데 다른 게임을 하고 있었다.
   서버와 같은 함수를 부른다. 규칙이 한 곳에만 있어야 갈라지지 않는다. */
function makeOpponent(){
  const my=selRobot();
  const owned=[...new Set(S.robots.map(r=>rarOf(r.type)))];
  /* 상대 장비는 **내 레이팅**에 맞춘다 — 내가 낀 파츠가 아니라.
     연습 대전이라 서버에 묻지 않고, 랭킹 화면이 받아 둔 값이 있으면 쓴다.
     없으면 시작 레이팅(1000)으로 본다. 규칙은 서버와 같은 함수(js/rewards.js)다. */
  const o=_makeOpponent(owned, my.level, R, ()=>'E'+uid(), false, myRating());
  const rb={uid:'E'+uid(), type:o.type, level:o.level, slots:o.slots};
  return {kind:o.kind==='monster'?'monster':'robot', robot:rb, parts:o.parts, callsign:o.callsign};
}
/* 상대 카드.
   전투력만 보여 주면 '이길지 질지'만 알 뿐 **무엇을 바꿀지**를 알 수 없다.
   방어·회피·속도를 내 값과 나란히 놓고, 상대 스킬도 함께 보여 준다.
   그래야 편성한 두 기 중 무엇을 낼지, 어떤 파츠를 낄지가 판단이 된다. */
function showOpponent(opp, practice){
  const T=COMBAT_TYPES[opp.robot.type], monster=!!MONSTER_TYPES[opp.robot.type];
  const my=selRobot(), myst=computeStats(my), est=computeStats(opp.robot, opp.parts||[]);
  const num=(k,v)=> isPct(k) ? (v*100).toFixed(0)+'%' : fmt(Math.round(v));
  /* 상대가 더 높은 값은 붉게, 내가 높으면 푸르게. 눈으로 훑어서 바로 읽히게 한다. */
  const cmp=k=>{ const a=est[k], b=myst[k], hi=a>b*1.02, lo=a<b*0.98;
    return `<div class="os"><b>${STAT_LABEL[k]}</b>
      <span class="${hi?'up':(lo?'dn':'')}">${num(k,a)}</span>
      <i>나 ${num(k,b)}</i></div>`; };

  /* 대항 관계를 한 줄로. 기체마다 다른 스킬이 여기서 의미를 갖는다. */
  const myFx=(COMBAT_TYPES[my.type].skill.fx)||{}, notes=[];
  if(est.eva >= myst.eva + 0.06)
    notes.push(myFx.noMiss ? '상대 회피가 높지만 <b>내 스킬은 빗나가지 않습니다</b>'
                           : '상대 <b>회피가 높습니다</b> — 빗나가지 않는 스킬이 유리합니다');
  if(est.def >= myst.def * 1.25)
    notes.push(myFx.ignoreDef ? '장갑이 두껍지만 <b>내 스킬이 관통합니다</b>'
                              : '<b>장갑이 두껍습니다</b> — 관통 스킬이 유리합니다');
  const myPow=power(my), oPow=power(opp.robot,opp.parts||[]);
  if(oPow > myPow*1.10) notes.push('전투력이 밀립니다 — 공격력 <b>구간이 넓은</b> 편성이 뒤집을 여지가 큽니다');
  else if(oPow < myPow*0.90) notes.push('전투력이 앞섭니다 — 구간이 <b>좁을수록</b> 확실합니다');

  $('#sc-battle').innerHTML = `
    <h2 class="title">${monster?'몬스터 출현':(opp.kind==='player'?'플레이어 발견':'상대 발견')}</h2>
    <div class="panel">
      <div class="oppcard">
        <div class="sprite" data-t="${T.rarity}" style="height:120px">${sprite(opp.robot.type,false)}</div>
        <div>
          <div class="rname">${esc(opp.callsign)} ${monster?'<span class="tag monster-tag">몬스터</span>':robRarTag(opp.robot.type)}${
            opp.kind==='player'?' <span class="tag" style="color:var(--acc2)">플레이어</span>':''}</div>
          <div class="rrole">${monster?'위험도 '+T.rarity:T.name} · ${T.role} · Lv.${opp.robot.level}</div>
          <div style="margin-top:6px;font-weight:800;color:var(--bad)">전투력 ${fmt(oPow)} <span style="color:var(--dim);font-weight:600">/ 나 ${fmt(myPow)}</span></div>
        </div>
      </div>
      <div class="oppstats">${['def','eva','spd'].map(cmp).join('')}</div>
      <div class="monster-skill"><strong>${T.skill.name}</strong><span>${T.skill.desc}</span></div>
      ${notes.length?`<div class="oppnote">${notes.map(n=>`<div>· ${n}</div>`).join('')}</div>`:''}
      ${practice
        ? '<div class="hint" style="margin-top:10px;color:var(--gold)">연습 대전 · 보상 없음</div>'
        : opp.rescue
          ? `<div class="hint" style="margin-top:10px;color:var(--bad)">비상 출격 · 출격비 없음 · 보상은 크레딧만</div>`
          : `<div class="hint" style="margin-top:10px">${opp.tier?`토벌 <b style="color:var(--acc2)">${HUNT_KO[opp.tier]||opp.tier}</b> · `:''}출격비 <b style="color:var(--gold)">${fmt(opp.cost)}</b> 크레딧</div>`}
      <div class="row-btns" style="margin-top:12px">
        <button class="btn big gold" onclick="ROWAR.${practice?'practiceStart':'startBattle'}()">전투 시작</button>
        <button class="btn ghost" onclick="ROWAR.${practice?'practiceFind':'findMatch'}()">다시 찾기</button>
      </div>
    </div>`;
}

/* ------------------------------- 연습 대전 ------------------------------- */
/* 서버가 없어도 게임을 보여 주기 위한 모드.
 * **아무것도 얻지 못한다** — 경험치·크레딧·파츠·피로도·전적·순위가 하나도 안 움직인다.
 * 그래야 '끊고 굴린 뒤 올리기'라는 길이 아예 생기지 않는다.
 * (지금은 PUT /api/state 도 닫혀 있지만, 여기서 상태를 안 건드리는 것이 더 확실하다)
 *
 * 상대 생성은 클라의 makeOpponent 를 쓴다 — 서버 판정으로 옮기면서 안 쓰게 된 코드다.
 * 보상이 없으니 상대를 클라가 고르든 말든 부풀릴 것이 없다. */
let _practiceOpp=null;

function practiceFind(){
  toBattle();
  const o=makeOpponent();
  _practiceOpp={ ...o, rating:null, seed:(Math.random()*0xffffffff)>>>0 };
  showOpponent(_practiceOpp, true);
}

async function practiceStart(){
  const opp=_practiceOpp; if(!opp) return;
  const my=selRobot(); _battleRobot=my;

  /* 지금 피로도 그대로 싸운다(전투에 영향이 있으니까). 다만 늘리지는 않는다. */
  const P=makeUnit(ROBOT_TYPES[my.type].name, my.type, computeStats(my));
  const E=makeUnit(opp.callsign, opp.robot.type, computeStats(opp.robot, opp.parts));
  const events=simulate(P,E,opp.seed);
  renderArena(my.type, opp.robot.type, P.name, E.name);

  if(rarOf(opp.robot.type)==='BOSS') await bossEntrance();
  const winner = await playBattle(events,P,E);
  if(!winner) return;
  renderPracticeResult(events[events.length-1].winner==='P', P, E);
}

function renderPracticeResult(win,P,E){
  toBattle();
  $('#sc-battle').innerHTML = `
    <div class="panel result">
      <div class="big ${win?'win':'lose'}">${win?'VICTORY':'DEFEAT'}</div>
      <div class="hint">${P.name} vs ${E.name}</div>
      <div class="reward"><div class="r" style="color:var(--dim)">연습 대전 · 보상 없음</div>
        <div class="r" style="color:var(--dim)">경험치·크레딧·파츠·피로도·전적이 그대로입니다</div></div>
      <div class="row-btns">
        <button class="btn big gold" onclick="ROWAR.practiceFind()">한 판 더</button>
        <button class="btn big ghost" onclick="ROWAR.go('hangar')">격납고</button>
      </div>
    </div>`;
}


/* 승패와 보상은 서버가 확정한다. 클라는 서버가 준 시드와 스탯으로 같은 전투를
   다시 돌려 애니메이션만 재생한다 — 결정적 시뮬이라 결과가 반드시 일치한다.
   각자 계산하면 피로도 정산 시점 차이 등으로 어긋나므로 스탯도 서버 것을 쓴다. */
async function startBattle(){
  const opp=_pendingOpp; if(!opp) return;
  if(!net.state.online){ toast('대전은 서버 연결이 필요합니다'); return; }

  const my=selRobot(); _battleRobot=my;
  const r=await net.battleStart();
  if(!r || r.error){
    /* 미리 잡아 둔 상대는 10분이 지나면 서버가 무효로 돌린다.
       결과 화면에 오래 머물다 '한 판 더'를 누른 경우가 여기 걸린다 — 막다른 길로 두지 않는다. */
    /* 출격비가 모자라면 다시 찾는다 — 서버가 그때 비상 출격을 잡아 준다. */
    if(r && /expired|no pending|already started|not enough credits/i.test(r.error||'')){ _pendingOpp=null; return findMatch(); }
    toast('전투를 시작하지 못했습니다'+(r&&r.error?': '+r.error:'')); return;
  }
  setPending(r.next && r.next.opponent, r.next && r.next.cost, r.next && r.next.rescue, r.next && r.next.tier);

  const P=makeUnit(r.nameP, my.type, r.statP);
  const E=makeUnit(r.opponent.callsign, r.opponent.type, r.statE);
  const events=simulate(P,E,r.seed);
  renderArena(my.type, r.opponent.type, P.name, E.name);

  /* **재생이 끝날 때까지 기다린다.** 예전에는 여기서 바로 함수가 끝나, 재생이 도는 동안
     전투 시작을 또 누를 수 있었다(문지기가 이미 풀린 뒤라 막지 못한다). */
  if(rarOf(r.opponent.type)==='BOSS') await bossEntrance();
  const winner = await playBattle(events,P,E);
  if(!winner) return;                            // 중간에 나갔으면 화면만 접는다(보상은 이미 서버에 반영됨)
  applyServerBattle(r, my);
  renderResult(r.win, _lastReward, P, E, opp);
}

/* 서버가 확정한 결과를 로컬 상태에 받아 적는다. 클라가 계산하지 않는다. */
let _lastReward=null;
function applyServerBattle(r, rb){
  S.credits=r.player.credits; S.cores=r.player.cores; S.scrap=r.player.scrap;
  S.stat.wins=r.player.wins; S.stat.losses=r.player.losses;
  rb.level=r.robot.level; rb.exp=r.robot.exp; rb.fat=r.robot.fat; rb.fatAt=r.robot.fatAt;
  if(r.reward.part) S.parts.push(r.reward.part);
  _lastReward={ win:r.win, cr:r.reward.cr, sc:r.reward.sc, core:r.reward.core, part:r.reward.part,
                lv:r.reward.lv, fat:r.reward.fat, rname:ROBOT_TYPES[rb.type].name,
                ratingDelta:r.ratingDelta||0, cost:r.cost||0, rescue:!!r.rescue };
  if(r.ratingDelta) dropRankCache();     // 내 순위가 실제로 움직였다
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){}
  net.cancelSync();                              // 서버가 이미 최신이다
  renderWallet();
}
/* 더 이상 쓰이지 않는다 — 보상은 서버(server/battle.js)가 확정한다.
   오프라인 연습 모드를 붙이게 되면 이 함수를 다시 쓸 수 있어 남겨 둔다. */
function battleRewards(win,enemyLv){
  const rb=_battleRobot||selRobot(), rname=ROBOT_TYPES[rb.type].name;
  const lv=gainExp(rb, win? battleExp(enemyLv) : Math.round(battleExp(enemyLv)*0.35));
  const fat={add:addFat(rb, win? 3+ri(0,2) : 7+ri(0,3)), now:fatOf(rb)};
  if(win){ const cr=120+enemyLv*14+ri(0,40); let sc=18+ri(0,14); S.credits+=cr; S.scrap+=sc;
    let core=0,part=null,autoSc=0; if(R()<0.20){core=1;S.cores++;}
    if(R()<0.09){ const p=genPart(enemyLv); autoSc=autoScrap(p);      // 예전 0.35 의 약 1/4
      if(autoSc){ S.scrap+=autoSc; } else { part=p; S.parts.push(p); } }
    sc+=autoSc;
    S.stat.wins++; save(); return {win,cr,sc,core,part,lv,fat,rname}; }
  const cr=40+ri(0,20), sc=6; S.credits+=cr; S.scrap+=sc; S.stat.losses++; save();
  return {win,cr,sc,core:0,part:null,lv,fat,rname};
}

/* ---- 대전 아레나 & 재생 ---- */
function renderArena(pType,eType,pName,eName,label){
  toBattle('arena');                    // 전투 재생 동안만 콕핏 HUD
  $('#sc-battle').innerHTML = `
    <h2 class="title">${label || (MONSTER_TYPES[eType]?'몬스터 대전':'자동 대전')}</h2>
    <div class="arena" id="arena">
      <div class="grid"></div><div class="vs">VS</div>
      <div class="hpwrap p"><div class="nm"><span>${pName}</span><small id="hpn-p"></small></div>
        <div class="hpbar" id="hp-p"><i></i></div><div class="spbar" id="sp-p"><i></i></div></div>
      <div class="hpwrap e"><div class="nm"><small id="hpn-e"></small><span>${eName}</span></div>
        <div class="hpbar" id="hp-e"><i></i></div><div class="spbar" id="sp-e"><i></i></div></div>
      <div class="fighter left" id="fighter-p">${sprite(pType,true)}</div>
      <div class="fighter right${rarOf(eType)==='BOSS'?' big':''}" id="fighter-e">${sprite(eType,false)}</div>
      <div class="flash" id="flash"></div>
      <div class="skillbanner" id="skillbanner"></div>
    </div>
    <div class="blog" id="blog"></div>
    <div class="row-btns" style="margin-top:10px">
      <button class="btn ghost" id="spdbtn" onclick="ROWAR.toggleSpeed()">속도 x${battleSpeed}</button>
    </div>`;
}
/* 재생 도중 사용자가 다른 화면으로 가면 아레나가 사라진다 → 모든 헬퍼는 없으면 조용히 무시 */
const AR = s => document.querySelector('#arena '+s);
const arenaGone = () => !document.getElementById('arena');
function setHP(side,hp,max){ const bar=AR('#hp-'+side); if(!bar) return; const pct=clamp(hp/max*100,0,100);
  bar.querySelector('i').style.width=pct+'%'; bar.classList.toggle('low',pct<30);
  const n=AR('#hpn-'+side); if(n) n.textContent=Math.max(0,Math.round(hp))+'/'+Math.round(max); }
function setSP(side,sp){ const i=AR('#sp-'+side+' i'); if(i) i.style.width=sp+'%'; }
/* 배속을 올려도 섬광이 초당 3회를 넘지 않게 막는다.
   x8 배속이면 타격 간격이 51ms 라 제한이 없으면 초당 19회까지 터진다(광과민성 위험). */
const FLASH_MIN_GAP = 340;
let _lastFlash = 0;
function flash(){
  const f=AR('#flash'); if(!f) return;
  const now = performance.now();
  if(now - _lastFlash < FLASH_MIN_GAP) return;
  _lastFlash = now;
  f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
}
/* 보스 등장.
   프레임 애니메이션을 붙여 봤다가 걷어냈다 — 아레나에서 기체는 제자리에 서 있어서
   걷기 순환이 '제자리걸음'으로 보였고, 원본 밀도가 낮아 정지 그림보다 흐렸다.
   대신 **등장하는 그 몇 초만** 움직인다. 그때는 실제로 걸어 들어오므로 자연스럽고,
   정지 그림을 그대로 쓰니 가장 선명한 순간이 첫인상이 된다. */
async function bossEntrance(){
  const host=AR('#fighter-e'); if(!host) return;
  const ar=document.querySelector('#arena');       // AR() 은 아레나 '안'을 찾는다
  host.classList.add('entering');
  for(let i=0;i<3;i++){                            // 무거운 발걸음 세 번
    await sleep(400/battleSpeed);
    if(arenaGone()) return;
    if(ar){ ar.classList.remove('quake'); void ar.offsetWidth; ar.classList.add('quake'); }
    flash();
  }
  await sleep(320/battleSpeed);
  if(!arenaGone()) host.classList.remove('entering');
}

function shakeF(side){ const el=AR('#fighter-'+side); if(!el) return; el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
async function lunge(side){ const el=AR('#fighter-'+side); if(!el) return; el.classList.add(side==='p'?'lungeL':'lungeR'); await sleep(110/battleSpeed); el.classList.remove('lungeL','lungeR'); }
function floatDmg(side,text,cls){ const host=AR('#fighter-'+side); if(!host) return; const d=document.createElement('div'); d.className='dmg '+cls; d.textContent=text; d.style.left=(side==='p'?'30px':'70px'); d.style.top='24px'; host.appendChild(d); setTimeout(()=>d.remove(),1000); }
function banner(txt){ const b=AR('#skillbanner'); if(!b) return; b.textContent=txt; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
function blog(html){ const l=document.getElementById('blog'); if(!l) return; const d=document.createElement('div'); d.innerHTML=html; l.appendChild(d); l.scrollTop=l.scrollHeight; }
async function playBattle(events,P,E,o){
  const nameOf=s=> s==='P'?`<span class="k">${P.name}</span>`:`<span style="color:var(--bad);font-weight:700">${E.name}</span>`;
  /* 아레나는 simulate 가 끝난 뒤에 재생하므로 P.hp 가 이미 최종값이다 — 그래서 만땅으로 시작한다.
     점령전은 방어선 사이에 체력이 이어지므로 '들어갈 때의 값'을 따로 받는다. */
  setHP('p', o&&o.pHp!=null?o.pHp:P.maxhp, P.maxhp);
  setHP('e', o&&o.eHp!=null?o.eHp:E.maxhp, E.maxhp);
  setSP('p', (o&&o.pSp)||0); setSP('e', (o&&o.eSp)||0);
  blog(`전투 개시! <b>${P.name}</b> vs <b>${E.name}</b>`);
  const sl=ms=>sleep(ms/battleSpeed);
  await sl(400);
  for(const e of events){
    if(arenaGone()) return null;                 // 화면을 떠났으면 재생 중단(보상 없음)
    if(e.t==='turn'){ setSP(e.side==='P'?'p':'e', e.sp); continue; }
    if(e.t==='skill'){ banner(e.name); blog(`${nameOf(e.side)} 스킬 <b>${e.name}</b>!`); await sl(520); continue; }
    if(e.t==='heal'){ const hS=e.side==='P'?'p':'e';
      setHP(hS, e.hp, hS==='p'?P.maxhp:E.maxhp); floatDmg(hS,'+'+e.amt,'heal');
      blog(`${nameOf(e.side)} 체력 <span class="h">+${e.amt}</span> 흡수`); await sl(260); continue; }
    if(e.t==='hit'){
      const aS=e.side==='P'?'p':'e', dS=e.dside==='P'?'p':'e';
      await lunge(aS);
      if(e.miss){ floatDmg(dS,'MISS','miss'); blog(`${nameOf(e.side)} 의 공격을 ${nameOf(e.dside)} 이(가) <span class="m">회피!</span>`); }
      else{ flash(); shakeF(dS); floatDmg(dS,(e.crit?'CRIT ':'')+e.dmg,e.crit?'crit':'norm');
        setHP(dS,e.thp, dS==='p'?P.maxhp:E.maxhp);
        blog(`${nameOf(e.side)} → ${nameOf(e.dside)} ${e.crit?'<span class="c">치명타 </span>':''}<b>${e.dmg}</b> 피해`); }
      await sl(300); continue;
    }
    if(e.t==='end'){ await sl(300); return e.winner; }
  }
  return 'P';
}
function renderResult(win,rw,P,E,opp){
  toBattle();                   // 전투가 끝나면 야간작전으로 돌아온다
  const rewards = [];
  if(rw.rescue) rewards.push(`<div class="r" style="color:var(--bad)">비상 출격 · 크레딧만 지급</div>`);
  else if(rw.cost) rewards.push(`<div class="r" style="color:var(--dim)">출격비 −${rw.cost}</div>`);
  if(!rw.rescue) rewards.push(`<div class="r">경험치 +${rw.lv.amt}</div>`);
  if(rw.lv.to>rw.lv.from) rewards.push(`<div class="r" style="color:var(--good)">레벨 업!  ${rw.rname}  Lv.${rw.lv.from} → Lv.${rw.lv.to}</div>`);
  rewards.push(`<div class="r">크레딧 +${rw.cr}</div>`);
  if(!rw.rescue) rewards.push(`<div class="r">스크랩 +${rw.sc}</div>`);
  if(rw.fat.add) rewards.push(`<div class="r" style="color:var(--bad)">피로도 +${rw.fat.add}  (누적 ${rw.fat.now} / ${FAT_MAX})</div>`);
  if(rw.core) rewards.push(`<div class="r" style="color:var(--acc2)">코어 +${rw.core}</div>`);
  if(rw.part) rewards.push(`<div class="r">파츠: ${rw.part.name} <span class="tag rar-${rw.part.rarity}">${rw.part.rarity}</span></div>`);
  $('#sc-battle').innerHTML = `
    <div class="panel result">
      <div class="big ${win?'win':'lose'}">${win?'VICTORY':'DEFEAT'}</div>
      <div class="hint">${P.name} vs ${E.name}</div>
      <div class="reward">${rewards.join('')}</div>
      <div class="row-btns">
        <button class="btn big gold" onclick="ROWAR.nextMatch()">한 판 더</button>
        <button class="btn big ghost" onclick="ROWAR.go('hangar')">격납고</button>
      </div>
    </div>`;
  renderWallet();
}
function toggleSpeed(){ battleSpeed = battleSpeed>=8?1:battleSpeed*2; const b=$('#spdbtn'); if(b)b.textContent='속도 x'+battleSpeed; }

/* ------------------------------- 초기화/공개 ------------------------------- */
/* resetSave() 가 있던 자리. 로컬 저장본만 비우는 함수였다.
   진행이 서버에 있는 지금은 그게 '초기화'가 아니라 '어긋내기'다 — 서버가 모르는
   기체를 든 채가 되어 장착·정비·레벨업·토벌이 전부 죽고, 새로고침하면 서버에서
   그대로 되돌아온다. 화면의 버튼과 함께 지웠다.
   정말로 처음부터 다시 하는 기능이 필요해지면 서버에 지우는 경로를 만들어야 한다
   (계정 삭제 후 재발급). 클라에서 지우는 것으로는 될 수 없다. */
/* ------------------------------ 점령전 ------------------------------
   지도는 서버에 하나뿐이다. 여기서는 그리고 보여 주기만 한다 — 판정은 전부 서버다.
   요청은 셋(view/attack/claim)뿐이고, 지도는 잠깐 들고 있는다. 화면을 열 때마다
   같은 답을 받으려고 요청을 쓰면 요청 수가 곧 무료 한도인 구조가 무너진다. */
const NODE_BY = Object.fromEntries(TERRITORY.map(n=>[n.id,n]));
const TERR_TTL = 60000;
let _terr=null, _terrAt=0;
function dropTerrCache(){ _terr=null; _terrAt=0; }

/* 방어선 하나하나의 남은 체력. 평균 막대 하나로 뭉치면 '두 겹 남았다'가 안 보인다. */
function linePips(hp){
  return `<div class="tpips">${(hp||[]).map(v=>{
    const p=Math.round(clamp(v,0,1)*100);
    return `<i class="${p<=0?'dead':(p<100?'hurt':'')}"><b style="height:${p}%"></b></i>`;
  }).join('')}</div>`;
}

async function renderTerr(){
  const el=$('#sc-terr');
  const wrap = inner => `<h2 class="title">점령전 · 세계 지도</h2>${inner}`;
  if(!net.state.online){
    el.innerHTML = wrap(`<div class="panel"><div class="hint">점령전은 서버 연결이 필요합니다.
      지도는 서버에 하나뿐이라 누가 어느 칸을 들고 있는지도 서버가 압니다.</div></div>`);
    return;
  }
  const fresh = _terr && (Date.now()-_terrAt) < TERR_TTL;
  if(!fresh) el.innerHTML = wrap(`<div class="panel"><div class="mm"><div class="spinner"></div>
    <div style="font-weight:800">지도를 불러오는 중...</div></div></div>`);

  const r = fresh ? _terr : await net.territory('view');
  if(r && !r.error){ _terr=r; _terrAt=Date.now(); }
  if(!r || r.error){
    el.innerHTML = wrap(`<div class="panel"><div class="hint">지도를 불러오지 못했습니다${r&&r.error?' · '+esc(r.error):''}</div></div>`);
    return;
  }
  drawTerr(r);
}

/* 남은 보호 시간(ms). 서버가 준 끝 시각을 그대로 쓴다 — 클라 시계로 세면 늦추거나 당길 수 있다. */
function protLeft(node){
  if(!node || !node.protectUntil) return 0;
  return Math.max(0, node.protectUntil - Date.now());
}

function drawTerr(r){
  const st = Object.fromEntries(r.nodes.map(n=>[n.id,n]));
  /* 내 편성 중 가장 센 기체를 기준으로 삼는다 — 돌파는 선봉이 얼마나 버티느냐로 갈린다. */
  const myPw = Math.max(1, ...S.squad.map(u=>S.robots.find(x=>x.uid===u)).filter(Boolean).map(x=>power(x)));
  /* row 1 이 안쪽, row 4 가 입구다. 위에서 아래로 그린다. */
  const cells = [...TERRITORY].sort((a,b)=> a.row-b.row || a.col-b.col).map(n=>{
    const s = st[n.id] || { owner:null, lines:n.mon.length, hp:[] };
    const TE = TERRAIN[n.terrain]||{};
    const own = s.owner==='me' ? 'mine' : (s.owner==='other' ? 'foe' : '');
    /* 칸 레벨은 서버가 준다 — 세계 평균 전투력만큼 얹혀 있어 데이터의 값과 다르다. */
    const lv = s.lv || n.lv;
    const prot = protLeft(s);
    const lock = !!s.locked;
    return `<button class="tnode ${own}${prot?' prot':''}${lock?' locked':''}" onclick="ROWAR.openNode('${n.id}')">
      <div class="tn-top"><span class="tag rr-${n.rar}">${n.rar==='BOSS'?'보스':(RR[n.rar]||{}).ko||n.rar}</span>
        <b>Lv.${lv}${lv>n.lv?`<em class="up"> +${lv-n.lv}</em>`:''}</b></div>
      <div class="tn-name">${n.ko}</div>
      <div class="tn-terr"><span>${TE.ko||''}</span>${n.maxRar?`<em>${n.maxRar}↓</em>`:''}</div>
      <div class="tn-pw ${s.pw>myPw*1.05?'hi':(s.pw<myPw*0.8?'lo':'')}">방어 ${fmt(s.pw||0)}</div>
      ${linePips(s.hp)}
      <div class="tn-own">${lock?`🔒 Lv.${s.minLv} 필요`
        : prot?`🛡 보호 ${dur(prot)}`
        : s.owner==='me' ? '내 점령지'
        : (s.owner==='other' ? esc(s.ownerName||'적') : `방어선 ${s.lines}`)}</div>
    </button>`;
  }).join('');

  const p=r.pending||{cr:0,sc:0,core:0};
  const has = p.cr>0 || p.sc>0 || (p.core||0)>0;
  const avg = (r.world&&r.world.avgPower)||0;
  $('#sc-terr').innerHTML = `<h2 class="title">점령전 · 세계 지도</h2>
    <div class="panel">
      <div class="trow">
        <div><div class="hint">점령</div><div class="big">${r.mine} / ${TERRITORY.length}</div></div>
        <div><div class="hint">쌓인 수입</div><div class="big" style="color:var(--gold)">${fmt(p.cr)}</div></div>
        <div><div class="hint">스크랩</div><div class="big">${fmt(p.sc)}</div></div>
        <div><div class="hint">코어</div><div class="big" style="color:var(--acc2)">${fmt(p.core||0)}</div></div>
      </div>
      <button class="btn big ${has?'gold':''}" ${has?'':'disabled'} onclick="ROWAR.claimTerr()"
        >${has?'수입 받기':'아직 쌓인 수입이 없습니다'}</button>
      <div class="hint" style="margin-top:6px">수입은 ${CONST.TERR.INCOME_CAP_H}시간치까지만 쌓입니다.
        <b>칸마다 나오는 재화가 다릅니다</b> — 크레딧이 두꺼운 칸, 스크랩이 두꺼운 칸,
        안쪽의 세 칸에서만 조금씩 나오는 코어.
        ${avg?`<br>지도 난이도는 <b>전체 플레이어 평균 전투력 ${fmt(avg)}</b>에 맞춰 올라가 있습니다.`:''}</div>
    </div>
    <div class="tmap">${cells}</div>
    <div class="panel"><div class="hint">
      칸을 누르면 방어선과 지형을 볼 수 있습니다. <b>한 칸은 방어선을 전부 뚫어야</b> 점령됩니다 —
      편성한 두 기가 <b>체력을 이어받은 채</b> 연속으로 싸우고, 둘 다 쓰러지면 실패합니다.
      실패해도 <b>깎아 둔 방어선은 남습니다</b>(시간이 지나면 스스로 회복).
      점령된 칸은 ${CONST.TERR.PROTECT_MIN}분간 <b>보호</b>됩니다 —
      코어 ${CONST.TERR.RAID_CORE}개를 내면 그 안에도 칠 수 있지만,
      그때는 <b>점령자의 편성 ${CONST.SQUAD_MAX}기가 방어선 뒤에 그대로 붙습니다</b>.
    </div></div>`;
}

/* 칸 상세. 여기서 '이 칸에 무엇을 데려갈까'가 정해진다 — 그래서 지형과 편성 제한을
   내 기체와 나란히 놓고 보여 준다. 상대 카드에서 하던 것과 같은 이유다. */
function openNode(id){
  const n=NODE_BY[id]; if(!n) return;
  const s=(_terr&&_terr.nodes.find(x=>x.id===id))||{owner:null,lines:n.mon.length,hp:[]};
  const TE=TERRAIN[n.terrain]||{};
  /* 여기서 쓰는 기준은 server/territory.js 의 attackNode 와 **같아야 한다.**
     서버는 '편성 제한을 통과한 첫 기체'로 출격비를 걷는다. 예전에 클라가 '지금 선택된
     기체'로 보여 줘서, 화면의 금액과 실제로 빠지는 금액이 달랐다(크레딧이 아슬아슬하면
     '부족' 판정까지 어긋난다). 원정 나간 기체도 서버가 빼므로 여기서도 뺀다. */
  const squad=S.squad.map(u=>S.robots.find(x=>x.uid===u))
                     .filter(x=>x && !(S.expd && S.expd.uid===x.uid));
  /* 선봉을 맨 앞으로 — server/territory.js 의 loadSquad 와 같은 순서여야 한다 */
  { const sel=selRobot(), i=sel?squad.findIndex(x=>x.uid===sel.uid):-1;
    if(i>0) squad.unshift(squad.splice(i,1)[0]); }
  const ok=squad.filter(x=>rarAllowed(rarOf(x.type), n.maxRar));
  const cost=ok.length?Math.ceil(sortieCost(ok[0])*CONST.TERR.COST_X):0;
  const myPw=Math.max(1, ...(ok.length?ok:squad).map(x=>power(x)));

  const lv = s.lv || n.lv;
  const prot = protLeft(s);
  const lock = !!s.locked;
  /* 해금 기준은 서버(server/territory.js unlockedBy)와 같아야 한다 — 편성의 최고 레벨 */
  const myTop = Math.max(1, ...S.squad.map(u=>S.robots.find(x=>x.uid===u)).filter(Boolean).map(x=>x.level));
  const defs=n.mon.map((t,i)=>{
    const M=COMBAT_TYPES[t]||{}, left=(s.hp&&s.hp[i]!=null)?s.hp[i]:1;
    return `<div class="tline"><span class="ti">${i+1}</span>
      <b>${M.name||t}</b><span class="lv">Lv.${lv}</span>
      <i class="${left<=0?'dead':''}">${left<=0?'무너짐':Math.round(left*100)+'%'}</i></div>`;
  }).join('') + (s.owner ? `<div class="tline foe"><span class="ti">${n.mon.length+1}</span>
      <b>${esc(s.ownerName||'주둔 기체')}</b><span class="lv">주둔</span><i>${
        (s.hp&&s.hp[n.mon.length]!=null)?Math.round(s.hp[n.mon.length]*100)+'%':'100%'}</i></div>` : '')
    /* 강행에서만 붙는 겹. 실제로 무엇을 더 만나는지 눌러 보기 전에 보여 준다. */
    + (prot && s.owner==='other' ? `<div class="tline foe raid"><span class="ti">+</span>
      <b>${esc(s.ownerName||'점령자')}의 편성 ${CONST.SQUAD_MAX}기</b><span class="lv">강행 시</span>
      <i class="bad">코어 ${CONST.TERR.RAID_CORE}</i></div>` : '');

  /* 편성 제한에 걸리는 기체를 미리 보여 준다. 눌러 보고 나서 거절당하면 늦다. */
  const roster=squad.map(x=>{
    const good=rarAllowed(rarOf(x.type), n.maxRar);
    /* 누가 먼저 나가는지가 이 규칙의 핵심이라 글자로 적는다 */
    const head=good && ok[0] && ok[0].uid===x.uid;
    return `<div class="tmech ${good?'':'no'}"><span class="th">${head?'선봉':'예비'}</span>${ROBOT_TYPES[x.type].name}
      <span class="lv">Lv.${x.level}</span> ${robRarTag(x.type)}
      ${good?`<i>피로 ${fatOf(x)}</i>`:'<i class="bad">편성 제한 초과</i>'}</div>`;
  }).join('') || '<div class="hint">편성된 기체가 없습니다.</div>';

  const mine = s.owner==='me';
  const poor = S.credits < cost;
  openModal(`<div class="mhead">${n.ko} <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="tdet">
      <div class="tdrow"><span>등급</span><b>${n.rar==='BOSS'?'보스':(RR[n.rar]||{}).ko||n.rar} · Lv.${lv}</b>
        ${lv>n.lv?`<i>기본 Lv.${n.lv} + 세계 난이도 ${lv-n.lv}</i>`:''}</div>
      <div class="tdrow"><span>지형</span><b>${TE.ko}</b> <i>${TE.desc||''}</i></div>
      <div class="tdrow"><span>전력</span><b class="${s.pw>myPw*1.05?'bad':''}">방어 ${fmt(s.pw||0)}</b>
        <i>내 최고 ${fmt(myPw)} · ${s.pw>myPw*1.05?'열세':(s.pw<myPw*0.8?'우세':'호각')}</i></div>
      <div class="tdrow"><span>수입</span><b>시간당 크레딧 ${fmt(n.crH)} · 스크랩 ${fmt(n.scH)}${
          n.coreH?` · 코어 ${n.coreH}`:''}</b>
        <i>${CONST.TERR.INCOME_CAP_H}시간을 채우면 크레딧 ${fmt(Math.floor(n.crH*CONST.TERR.INCOME_CAP_H))} · 스크랩 ${
          fmt(Math.floor(n.scH*CONST.TERR.INCOME_CAP_H))}${
          n.coreH?` · 코어 ${Math.floor(n.coreH*CONST.TERR.INCOME_CAP_H)}`:''}</i></div>
      <div class="tdrow"><span>점령 보너스</span><b>크레딧 ${fmt(n.crH*CONST.TERR.CAPTURE_H)} · 스크랩 ${fmt(n.scH*CONST.TERR.CAPTURE_H)}</b></div>
      ${n.maxRar?`<div class="tdrow"><span>편성 제한</span><b class="bad">${n.maxRar} 등급 이하만</b></div>`:''}
      ${n.minLv?`<div class="tdrow"><span>해금</span><b class="${lock?'bad':''}">Lv.${n.minLv} 이상</b>
        <i>${lock?`지금 편성 최고 Lv.${myTop}`:'열림'}</i></div>`:''}
    </div>
    <div class="hint" style="margin:10px 0 4px">방어선 — 순서대로 뚫습니다. 지형 보정은 <b>양쪽 모두</b>에 걸립니다.</div>
    <div class="tlines">${defs}</div>
    <div class="hint" style="margin:10px 0 4px">데려갈 기체 — 체력은 방어선 사이에 회복되지 않습니다.</div>
    <div class="tmechs">${roster}</div>
    ${lock
      ? `<div class="hint" style="margin-top:10px;color:var(--bad)">🔒 <b>Lv.${n.minLv} 이상</b>이어야 들어갈 수 있습니다.
          지금 출격 편성의 최고 레벨은 <b>Lv.${myTop}</b>입니다. 기체를 더 키우세요.</div>`
      : mine
      ? `<div class="hint" style="margin-top:10px;color:var(--gold)">이미 내 점령지입니다. 수입은 지도에서 한꺼번에 받습니다.${
          prot?`<br>지금은 <b>보호 중</b>입니다 — ${dur(prot)} 뒤에 풀립니다.`:''}</div>`
      : !ok.length
        ? `<div class="hint" style="margin-top:10px;color:var(--bad)">편성 제한에 걸려 데려갈 기체가 없습니다. 격납고에서 편성을 바꾸세요.</div>`
        : prot
          /* 보호 중 — 보통 공격은 아예 막고, 코어를 내는 강행만 남긴다.
             강행은 방어선이 두꺼워지므로 무엇이 늘어나는지 버튼 위에 적는다. */
          ? `<div class="hint" style="margin:10px 0 4px;color:var(--gold)">🛡 점령 직후 <b>보호 중</b> · ${dur(prot)} 남음</div>
             <div class="hint" style="color:var(--bad)">지금 치려면 <b>강행</b>해야 합니다.
               코어 ${CONST.TERR.RAID_CORE}개를 쓰고, 몬스터 뒤에
               <b>${esc(s.ownerName||'점령자')}의 편성 ${CONST.SQUAD_MAX}기</b>를 더 상대합니다.</div>
             <button class="btn big ${(poor||S.cores<CONST.TERR.RAID_CORE)?'':'gold'}"
               ${(poor||S.cores<CONST.TERR.RAID_CORE)?'disabled':''} onclick="ROWAR.raidTerr('${id}')"
               style="margin-top:8px">${
                 S.cores<CONST.TERR.RAID_CORE ? `코어 부족 (${CONST.TERR.RAID_CORE} 필요)`
                 : poor ? `크레딧 부족 (${fmt(cost)} 필요)`
                 : `강행 · 코어 ${CONST.TERR.RAID_CORE} + ${fmt(cost)} 크레딧`}</button>`
          : `<button class="btn big ${poor?'':'gold'}" ${poor?'disabled':''} onclick="ROWAR.attackTerr('${id}')"
             style="margin-top:12px">${poor?`크레딧 부족 (${fmt(cost)} 필요)`:`공격 · ${fmt(cost)} 크레딧`}</button>`}
  `);
}

/* raid=true 면 코어를 내고 보호를 뚫는다. 보내는 곳은 한 군데뿐이라 갈릴 일이 없다. */
async function attackTerr(id, raid){
  closeModal();
  if(!net.state.online){ toast('점령전은 서버 연결이 필요합니다'); return; }
  const n=NODE_BY[id];
  toBattle();
  $('#sc-battle').innerHTML = `<h2 class="title">점령전</h2><div class="panel"><div class="mm">
    <div class="spinner"></div><div style="font-weight:800">${n?n.ko:'점령지'} ${raid?'강행 진입':'진입'} 중...</div>
    <div class="hint">${raid?'점령자의 편성까지 확인하고 있습니다.':'방어선을 확인하고 있습니다.'}</div></div></div>`;
  const [r]=await Promise.all([net.territory('attack',{node:id, raid:!!raid}), sleep(700)]);
  if(!r || r.error){
    /* 보호 거절은 남은 시간을 함께 준다. 그냥 '실패'라고만 하면 왜 막혔는지 알 수 없다. */
    if(r && r.error==='locked')
      toast(`Lv.${r.minLv} 이상이어야 들어갈 수 있습니다 (지금 Lv.${r.myLv})`);
    else if(r && r.error==='protected' && r.protectUntil)
      toast(`점령 직후 보호 중입니다 · ${dur(Math.max(0,r.protectUntil-Date.now()))} 남음`);
    else toast(ERR_KO[r&&r.error]||('공격하지 못했습니다'+(r&&r.error?': '+r.error:'')));
    dropTerrCache(); go('terr'); return;
  }
  dropTerrCache();
  applyTerrAttack(r);
  await playBreach(r);   // 재생이 끝날 때까지 문지기를 붙든다
}
const raidTerr = id => attackTerr(id, true);

/* 서버가 확정한 결과를 로컬에 받아 적는다. 클라는 계산하지 않는다. */
function applyTerrAttack(r){
  S.credits=r.player.credits; S.cores=r.player.cores; S.scrap=r.player.scrap;
  for(const e of (r.reward.exp||[])){
    const rb=S.robots.find(x=>x.uid===e.uid);
    if(rb){ rb.level=e.to; if(e.exp!=null) rb.exp=e.exp; }
  }
  for(const f of (r.reward.fat||[])){
    const rb=S.robots.find(x=>x.uid===f.uid);
    if(rb){ rb.fat=f.now; if(f.fatAt!=null) rb.fatAt=f.fatAt; }
  }
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){}
  net.cancelSync();                 // 서버가 이미 최신이다
  renderWallet();
}

/* 돌파 재생.
   서버가 준 편성·방어선·시드로 **같은 함수를 다시 돌려** 판별을 그대로 얻는다.
   전투마다 결과를 따로 받아 오지 않는 이유가 이것이다 — 그러면 재생과 결과가 갈린다. */
async function playBreach(r){
  const out=runBreach({ mechs:r.mechs, lines:r.lines, seeds:r.seeds, hpLeft:r.hpLeft0 });
  const node=NODE_BY[r.node];
  const total=r.lines.length;

  for(let i=0;i<out.rounds.length;i++){
    const rd=out.rounds[i];
    const M=r.mechs[rd.mi], L=r.lines[rd.li];
    const P=makeUnit(M.name,M.type,M.stats); P.hp=rd.pHp; P.sp=rd.pSp;
    const E=makeUnit(L.name,L.type,L.stats); E.hp=rd.eHp; E.sp=rd.eSp;

    renderArena(M.type,L.type,M.name,L.name,
      `${node?node.ko:'점령지'} · 방어선 ${rd.li+1}/${total}`);
    if(arenaGone()) return;
    /* 두 번째 기체가 들어오는 순간이 이 규칙의 핵심이라 말로도 한 줄 남긴다. */
    if(i>0 && rd.mi!==out.rounds[i-1].mi)
      blog(`<b style="color:var(--bad)">선봉 격추</b> — <span class="k">${M.name}</span> 투입`);
    else if(i>0)
      blog(`<b class="k">방어선 ${rd.li} 돌파</b> — 체력 ${Math.round(rd.pHp)} 로 이어서 진입`);

    if(rarOf(L.type)==='BOSS') await bossEntrance();
    const w=await playBattle(rd.events,P,E,{ pHp:rd.pHp, eHp:rd.eHp, pSp:rd.pSp, eSp:rd.eSp });
    if(!w) return;                       // 화면을 떠났다. 보상은 이미 서버에 반영됨
    await sleep(320/battleSpeed);
  }
  renderBreachResult(r);
}

function renderBreachResult(r){
  toBattle();
  const node=NODE_BY[r.node];
  const rw=r.reward||{};
  const lines=[];
  if(r.win){
    if(rw.cr) lines.push(`<div class="r">점령 보너스 · 크레딧 <b>+${fmt(rw.cr)}</b></div>`);
    if(rw.sc) lines.push(`<div class="r">스크랩 <b>+${fmt(rw.sc)}</b></div>`);
    if(rw.core) lines.push(`<div class="r" style="color:var(--acc2)">코어 <b>+${rw.core}</b></div>`);
    lines.push(`<div class="r" style="color:var(--gold)">시간당 크레딧 ${fmt(node.crH)} · 스크랩 ${fmt(node.scH)} 이 쌓입니다</div>`);
  }else{
    const left=(r.hpLeft||[]).filter(v=>v>0).length;
    lines.push(`<div class="r">방어선 <b>${r.cleared}</b>겹 돌파 · <b>${left}</b>겹 남음</div>`);
    lines.push(`<div class="r" style="color:var(--dim)">깎아 둔 방어선은 남습니다 — 시간이 지나면 스스로 회복합니다</div>`);
  }
  for(const e of (rw.exp||[])){
    const rb=S.robots.find(x=>x.uid===e.uid); if(!rb||!e.amt) continue;
    lines.push(`<div class="r">${ROBOT_TYPES[rb.type].name} 경험치 <b>+${fmt(e.amt)}</b>${
      e.to>e.from?` · <b style="color:var(--gold)">Lv.${e.from}→${e.to}</b>`:''}</div>`);
  }
  for(const f of (rw.fat||[])){
    const rb=S.robots.find(x=>x.uid===f.uid); if(!rb||!f.add) continue;
    lines.push(`<div class="r" style="color:var(--bad)">${ROBOT_TYPES[rb.type].name} 피로도 +${f.add} (${f.now})</div>`);
  }
  lines.push(`<div class="r" style="color:var(--dim)">출격비 −${fmt(r.cost)} 크레딧</div>`);

  $('#sc-battle').innerHTML = `
    <div class="panel result">
      <div class="big ${r.win?'win':'lose'}">${r.win?'점령 성공':'돌파 실패'}</div>
      <div class="hint">${node?node.ko:''} · ${r.win?'이 칸은 이제 내 것입니다':'다음에 이어서 칠 수 있습니다'}</div>
      <div class="reward">${lines.join('')}</div>
      <div class="row-btns">
        <button class="btn big gold" onclick="ROWAR.go('terr')">지도로</button>
        <button class="btn big ghost" onclick="ROWAR.go('hangar')">격납고</button>
      </div>
    </div>`;
}

async function claimTerr(){
  const r=await net.territory('claim');
  if(!r) return;
  if(r.error){ toast(ERR_KO[r.error]||('실패: '+r.error)); return; }
  S.credits=r.player.credits; S.scrap=r.player.scrap;
  if(r.player.cores!=null) S.cores=r.player.cores;
  commitLocal(); dropTerrCache(); renderWallet(); renderTerr();
  toast(`점령지 ${r.nodes}칸 · 크레딧 +${fmt(r.cr)} · 스크랩 +${fmt(r.sc)}${r.core?` · 코어 +${r.core}`:''}`);
}

/* ── 겹쳐 도는 조작 막기 ──────────────────────────────────
   전투 시작을 여러 번 누르면 요청이 그 수만큼 서버로 나갔다. 서버는 각각을 진짜 전투로
   처리하므로 **출격비도 보상도 그 수만큼 중복**되고, 재생 루프도 여러 개가 같은 화면을
   돌려 '각자 세 번씩 때리는' 그림이 나온다. 실제로 제보된 버그다.

   그래서 서버로 나가거나 화면을 오래 물고 있는 조작은 전부 이 문지기를 지나게 한다.
   하나가 도는 동안 들어온 같은 종류의 호출은 **조용히 버린다** — 큐에 쌓으면 손을 뗀 뒤에
   밀린 것이 우수수 실행돼 같은 문제가 늦게 터진다.

   서버 쪽에도 따로 잠금을 걸어 두었다(server/battle.js 의 pending_match 선점).
   클라만 막으면 손댄 클라이언트에는 그대로 뚫린다. */
let _busy = false;
function guard(fn){
  return async function(...a){
    if(_busy) return;
    _busy = true;
    document.body.classList.add('busy');
    try { return await fn.apply(this, a); }
    finally { _busy = false; document.body.classList.remove('busy'); }
  };
}
/* 속도 토글·화면 이동·모달 닫기는 문지기를 지나지 않는다 —
   전투가 재생되는 동안에도 눌러야 하는 것들이다. */

window.ROWAR = {
  go,
  /* 나갈 기체 고르기 — 편성에 든 기체만. 편성 밖을 누르면 편성에 넣는 것으로 받아 준다. */
  selectRobot: guard(async(i)=>{ const rb=S.robots[i]; if(!rb) return;
    if(!S.squad.includes(rb.uid)) return toggleSquad(rb.uid);
    /* 이미 나가기로 되어 있는 기체를 또 누르면 서버에 보낼 것이 없다.
       예전에는 누를 때마다 보냈다 — 요청도, 아레나 재등록(쓰기)도 헛돌았다. */
    if(S.sel===i) return;
    S.sel=i; renderHangar();
    if(net.state.online) await net.hangar('select',{robotUid:rb.uid});
    try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){} net.cancelSync(); }),
  toggleSquad: guard(toggleSquad),
  levelUp: guard(levelUp), service: guard(service), enhance: guard(enhancePart),
  equip: guard(equip), unequip: guard(unequip), doScrap: guard(doScrap),
  openSlot, closeModal, setGacha, scrapPart, toggleSpeed, pickExped, openNode, guide,
  pull1: guard(pull1), pull10: guard(pull10),
  findMatch: guard(findMatch), nextMatch: guard(nextMatch), startBattle: guard(startBattle),
  practiceFind: guard(practiceFind), practiceStart: guard(practiceStart), hunt: guard(hunt),
  sendExped: guard(sendExped), claimExped: guard(claimExped),
  attackTerr: guard(attackTerr), raidTerr: guard(raidTerr), claimTerr: guard(claimTerr),
  account:accountScreen, doRegister: guard(doRegister), doLogin: guard(doLogin), logout:doLogout,
  net,                    // 콘솔에서 상태 확인용: ROWAR.net.state
  sync:()=>net.flush(()=>S)   // 수동으로 즉시 동기화
};
/* 접속 상태 칩. 서버에 못 붙어도 게임은 그대로 돌아가므로 조용히 표시만 한다.
   누르면 계정 화면이 열린다. */
function renderAcct(){
  const el=$('#acct'); if(!el) return;
  el.onclick = accountScreen;
  el.style.cursor='pointer';
  const s=net.state;
  if(s.online){
    el.textContent = s.guest ? ('게스트 #'+String(s.accountId).padStart(4,'0')) : s.loginId;
    el.dataset.tip = s.guest
      ? '이 브라우저에만 저장되는 게스트 계정입니다. 눌러서 정식 계정으로 만드세요.'
      : ('정식 계정 · '+s.loginId+' (눌러서 계정 관리)');
    el.className='coin acct '+(s.guest?'on guest':'on');
  } else {
    el.textContent='오프라인';
    el.dataset.tip='서버에 연결하지 못했습니다. 진행 상황은 이 브라우저에만 저장됩니다.'
      + (s.error?' ('+s.error+')':'');
    el.className='coin acct off';
  }
}

/* 접속 직후 한 번: 서버와 이 브라우저 중 어느 쪽을 따를지 정한다.
     · 서버 rev 0  = 한 번도 올린 적 없음 → 이 브라우저 저장본을 올린다(이관)
     · 서버 rev 가 내가 아는 것보다 큼 → 다른 곳에서 저장한 것이니 내려받는다
     · 그 밖 → 올린다 */
async function syncOnConnect(){
  /* 주의: net.pull() 이 내부에서 syncedRev 를 서버 값으로 갱신한다.
     그래서 '내가 알고 있던 rev' 는 반드시 pull 전에 읽어야 한다.
     뒤에서 읽으면 항상 서버와 같아져 '올리기'로 빠지고, 새 저장본이 서버를 덮어쓴다. */
  const known = net.syncedRev();
  const remote = await net.pull();
  if(!remote) return;

  /* 서버 것을 정본으로 삼는다. 뽑기·전투·격납고가 전부 서버 판정이라
     서버가 모르는 진행은 애초에 있을 수 없다. */
  const adopt = msg => {
    S = normalize(remote.state);
    save();
    net.cancelSync();                        // 방금 받은 걸 도로 올릴 필요는 없다
    renderAll();
    if(msg) toast(msg);
  };

  /* 올려 보고, 거절당하면 서버를 따른다.
     이관 문이 닫혀 있으면(서버 판정으로 넘어간 뒤의 기본값) 올리기는 늘 실패한다.
     예전에는 실패를 그냥 삼켜서, 클라는 제 저장본의 기체를 들고 서버는 제가 만든 기체를
     들고 영영 어긋났다. 그 상태에서는 격납고 API 가 전부 'robot not found' 다 —
     장착·정비·레벨업·토벌이 통째로 죽는다. 실패하는 길을 하나도 남기지 않는다. */
  const pushOrAdopt = async ok => {
    /* 이관이 막힌 걸 이미 아는 브라우저는 보내 봐야 403 이다. 바로 서버를 따른다.
       (이 한 줄이 없으면 브라우저마다 첫 부팅에서 요청 하나를 버린다) */
    if(net.migrationBlocked()) return adopt();
    const r = await net.push(S);
    if(r && r.ok){ if(ok) toast(ok); return; }
    adopt();
  };

  if(remote.rev === 0) return pushOrAdopt('진행 상황을 서버에 올렸습니다');   // 서버가 빈 계정 — 이관 시도
  if(remote.rev > known || known < 0) return adopt('서버에서 진행 상황을 불러왔습니다');
  return pushOrAdopt();
}

/* ── 게임 설명 ────────────────────────────────────────────
   규칙이 늘면서 '눌러 보기 전에는 모르는 것'이 많아졌다 — 특히 편성 두 기를 번갈아
   쓴다는 것, 파츠에 대가가 붙는다는 것, 점령전은 져도 남는다는 것.
   시뮬레이션에서도 교대를 안 하면 승률이 20%대로 주저앉는 것이 확인됐다.
   그래서 '조작법'이 아니라 **모르면 손해 보는 것**을 골라 적는다.

   숫자는 전부 CONST 에서 끌어온다. 글에 박아 두면 밸런스를 고칠 때마다 설명이 거짓이 된다. */
function guide(){
  const T = CONST.TERR, fatMin = CONST.FAT_RECOVER_MIN, fatLv = CONST.FAT_RECOVER_LV;
  const robotP = PULL_TABLE.find(t=>t.k==='robot').w;
  const robotCr = PULL_TABLE_CR.find(t=>t.k==='robot').w;
  const epCore = (robotP/100) * (ROBOT_RARITY.find(r=>r.k==='EP').w / ROBOT_RARITY.reduce((a,b)=>a+b.w,0)) * 100;
  const epCr   = (robotCr/100) * (ROBOT_RARITY_CR.find(r=>r.k==='EP').w / ROBOT_RARITY_CR.reduce((a,b)=>a+b.w,0)) * 100;

  const sec = (t, body) => `<div class="gsec"><div class="gh">${t}</div>${body}</div>`;

  openModal(`<div class="mhead">게임 설명 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
  <div class="guide">

    ${sec('한 줄로 말하면', `
      <p>기체를 뽑아 키운 뒤 전장으로 내보내는 게임입니다. 전투는 자동으로 진행되므로,
        플레이어가 할 일은 <b>어떤 기체를 데려가고 어떤 파츠를 장착할지 고르는 것</b>입니다.</p>`)}

    ${sec('격납고 — 한 번에 데려가는 기체는 ' + CONST.SQUAD_MAX + '기입니다', `
      <p>기체를 아무리 많이 보유해도 한 번에 데려갈 수 있는 것은 <b>${CONST.SQUAD_MAX}기</b>입니다.
        그중 <b>출격</b>으로 지정한 기체가 선봉으로 나섭니다.</p>
      <p class="gwarn">두 기를 <b>번갈아 출전시키는 것이 중요합니다.</b>
        한 기만 계속 내보내면 피로도가 쌓여 승률이 크게 떨어집니다.</p>`)}

    ${sec('피로도 — 가장 신경 써야 할 값입니다', `
      <p>전투를 치를 때마다 피로도가 쌓이고, 쌓인 만큼 <b>최대 내구가 줄어듭니다.</b>
        피로도가 최대치인 ${CONST.FAT_MAX}에 이르면 최대 내구가 ${CONST.FAT_MAX}% 줄어들어
        사실상 전투가 어렵습니다.</p>
      <p>피로도는 시간이 지나면 <b>저절로 회복됩니다.</b> 다만 레벨이 높을수록 회복이 느립니다
        (피로도 1을 회복하는 데 Lv.1은 ${fatMin.toFixed(1)}분,
        Lv.${CONST.MAXLV}은 ${(fatMin+CONST.MAXLV*fatLv).toFixed(1)}분이 걸립니다).
        급할 때는 크레딧을 들여 정비하고, 한 기가 쉬는 동안 다른 기체를 출전시키세요.</p>`)}

    ${sec('파츠 — 이점만 있는 파츠는 없습니다', `
      <p>파츠에는 능력치를 올려 주는 값과 <b>반드시 깎아 내리는 값(대가)</b>이 함께 붙습니다.
        무장과 코어는 속도를, 프레임은 회피를, 부스터는 방어를 깎습니다.</p>
      <p><b>구간</b>은 좋고 나쁨이 아니라 성향입니다. 구간이 넓으면 피해량이 크게 흔들려
        열세인 쪽에 유리하고, 좁으면 일정하게 들어가 우세한 쪽에 유리합니다.
        무장과 코어는 구간을 넓히고, 프레임과 부스터는 좁힙니다.</p>
      <p>강화하면 올려 주는 값과 함께 <b>대가도 같이 커집니다.</b> 그래서 가장 높은 등급을
        최대까지 강화한 조합이 언제나 정답은 아닙니다. 다른 파츠로 약점을 보완하세요.</p>`)}

    ${sec('대전 — 상대는 내 성적에 맞춰 나타납니다', `
      <p>출격비로 크레딧을 내고 싸웁니다. 크레딧이 부족하면 <b>비상 출격</b>으로 바뀌므로
        진행이 막히지는 않습니다. 다만 이때는 보상으로 크레딧만 받습니다.</p>
      <p>상대의 장비는 <b>내가 장착한 파츠가 아니라 내 성적</b>에 따라 정해집니다.
        좋은 파츠를 갖추면 <b>한동안 승리가 이어지고</b>, 승리가 쌓이면 순위가 오르는 대신
        상대도 그만큼 강해집니다.</p>`)}

    ${sec('파견 — 토벌과 원정', `
      <p><b>토벌</b>은 사냥할 등급을 직접 골라 몬스터와 싸웁니다.
        <b>스크랩과 파츠</b>가 주된 보상이고 크레딧은 적습니다.
        기체가 강해지면 낮은 등급은 손쉬운 사냥터가 되니 위 등급으로 올라가세요.</p>
      <p><b>원정</b>은 편성에 들지 않은 기체를 일정 시간 내보내 두었다가 보상을 받는 방식입니다.
        전투를 치르지 않으므로 <b>들인 시간에 견주면 효율이 가장 좋습니다.</b>
        쉬고 있는 기체는 원정을 보내 두세요.</p>`)}

    ${sec('점령전 — 실패해도 성과가 남습니다', `
      <p>세계 지도는 <b>서버에 하나뿐</b>이며, 모든 플레이어가 같은 지도를 두고 다툽니다.
        칸 하나는 여러 겹의 방어선으로 이루어져 있고, 이를 모두 뚫어야 점령됩니다.</p>
      <p>편성한 ${CONST.SQUAD_MAX}기가 <b>체력을 이어받은 채</b> 연이어 싸웁니다.
        방어선 사이에 회복이 없으므로, 목표가 '이기는 것'에서
        <b>'덜 소모하고 이기는 것'</b>으로 바뀝니다.</p>
      <p class="ggood">실패해도 <b>깎아 놓은 방어선은 그대로 남습니다.</b>
        며칠에 걸쳐 큰 칸을 공략하는 것이 정상입니다.
        다만 방어선은 시간당 ${Math.round(T.LINE_REGEN*100)}%씩 스스로 회복하니
        너무 오래 미루지는 마세요.</p>
      <p>칸마다 <b>해금 레벨</b>과 <b>편성 제한</b>이 있으며, 지형 보정은
        <b>양쪽 모두</b>에 적용됩니다. 점령된 칸은 ${T.PROTECT_MIN}분 동안 보호되고,
        코어 ${T.RAID_CORE}개를 쓰면 보호 중에도 공격할 수 있습니다.
        대신 점령자의 기체 ${CONST.SQUAD_MAX}기가 방어선 뒤에 더해집니다.</p>
      <p>수입은 칸마다 나오는 재화가 다릅니다. ${T.INCOME_CAP_H}시간치까지만 쌓이니
        하루에 한 번은 받는 것이 좋습니다.</p>`)}

    ${sec('뽑기 — 창구는 두 가지입니다', `
      <p><b>코어 캡슐</b>은 코어 ${CONST.PULL_COST}개를 씁니다.
        기체가 나올 확률은 ${robotP}%, 그중 에픽은 ${epCore.toFixed(2)}%입니다.<br>
        <b>크레딧 캡슐</b>은 ${fmt(CONST.PULL_CR_COST)} 크레딧을 씁니다.
        기체가 나올 확률은 ${robotCr}%, 그중 에픽은 ${epCr.toFixed(3)}%입니다.</p>
      <p>코어는 모으기 어렵고 크레딧은 꾸준히 들어옵니다.
        크레딧 캡슐은 코어가 떨어졌을 때 쓰는 창구입니다.</p>
      <p><b>뽑은 파츠는 자동으로 분해되지 않습니다.</b> 한번 장착해 보고
        쓰지 않겠다고 판단되면 격납고에서 직접 분해하세요.</p>`)}

    ${sec('계정 — 게스트 계정은 브라우저에 묶여 있습니다', `
      <p class="gwarn">게스트 계정은 <b>지금 쓰는 브라우저에만</b> 저장됩니다.
        브라우저 데이터를 지우거나 다른 기기에서 접속하면 <b>되찾을 수 없습니다.</b></p>
      <p>화면 위쪽의 계정 항목을 눌러 <b>정식 계정</b>을 만들어 두세요.
        지금까지의 진행 상황을 그대로 이어받습니다.</p>`)}

  </div>
  <button class="btn big" style="margin-top:12px" onclick="ROWAR.closeModal()">닫기</button>`);
}

/* 계정 화면 — 게스트면 승격/로그인, 정식이면 로그아웃 */
function accountScreen(){
  const s=net.state;
  if(!s.online){ toast('서버에 연결되지 않았습니다'); return; }

  if(!s.guest){
    openModal(`<div class="mhead">계정 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
      <div class="acctbox">
        <div class="arow"><b>아이디</b><span>${esc(s.loginId)}</span></div>
        <div class="arow"><b>계정 번호</b><span>#${String(s.accountId).padStart(4,'0')}</span></div>
        <p class="hint">다른 기기에서도 이 아이디로 로그인하면 진행 상황이 이어집니다.</p>
        <button class="btn big" style="margin-top:10px" onclick="ROWAR.logout()">로그아웃</button>
      </div>`);
    return;
  }

  openModal(`<div class="mhead">계정 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="acctbox">
      <p class="hint" style="color:var(--gold)">지금은 <b>게스트 #${String(s.accountId).padStart(4,'0')}</b>입니다.
        진행 상황이 이 브라우저에만 저장되어, 브라우저 데이터를 지우면 계정을 잃습니다.</p>

      <div class="asec">
        <div class="atitle">정식 계정 만들기</div>
        <p class="hint">지금까지의 진행 상황을 그대로 이어받습니다. 처음부터 다시 시작하지 않습니다.</p>
        <input id="rg-id" class="ainput" placeholder="아이디 (영문·숫자·밑줄 4~20자)" maxlength="20" autocomplete="username">
        <input id="rg-pw" class="ainput" type="password" placeholder="비밀번호 (8자 이상)" autocomplete="new-password">
        <button class="btn big gold" onclick="ROWAR.doRegister()">정식 계정으로 만들기</button>
      </div>

      <div class="asec">
        <div class="atitle">이미 계정이 있다면</div>
        <p class="hint" style="color:var(--bad)">로그인하면 그 계정의 진행 상황을 따릅니다.
          지금 이 게스트 계정의 진행 상황은 이 브라우저에서 더 이상 보이지 않습니다.</p>
        <input id="lg-id" class="ainput" placeholder="아이디" maxlength="20" autocomplete="username">
        <input id="lg-pw" class="ainput" type="password" placeholder="비밀번호" autocomplete="current-password">
        <button class="btn big" onclick="ROWAR.doLogin()">로그인</button>
      </div>
    </div>`);
}

async function doRegister(){
  const id=$('#rg-id').value.trim(), pw=$('#rg-pw').value;
  const r=await net.register(id, pw);
  if(r.error){ toast(r.error); return; }
  closeModal(); renderAcct(); renderGate();
  toast('정식 계정이 되었습니다 · '+r.loginId);
}
async function doLogin(){
  const id=$('#lg-id').value.trim(), pw=$('#lg-pw').value;
  const r=await net.login(id, pw);
  if(r.error){ toast(r.error); return; }
  closeModal();
  const remote=await net.pull();                 // 그 계정의 진행상황으로 갈아탄다
  if(remote){ S=normalize(remote.state); save(); net.cancelSync(); }
  renderAcct(); renderGate(); renderAll();
  toast(r.loginId+' 으로 로그인했습니다');
}
async function doLogout(){
  await net.logout();
  closeModal();
  localStorage.removeItem(SAVE_KEY);             // 남의 기기에 진행상황을 남기지 않는다
  location.reload();
}

/* ── 대문 ──────────────────────────────────────────────
   시작을 누르기 전까지 게임 화면을 가린다. 접속 상태에 따라 문구가 바뀐다. */
function renderGate(){
  const el=$('#gate-who'); if(!el) return;
  const s=net.state;
  if(!s.online){ el.textContent='오프라인 · 서버에 연결하지 못했습니다'; el.className='gate-who off'; }
  else if(s.guest){ el.textContent='게스트 #'+String(s.accountId).padStart(4,'0')+'로 시작합니다'; el.className='gate-who guest'; }
  else { el.textContent=s.loginId+' 님으로 접속했습니다'; el.className='gate-who on'; }
}
function openGate(){
  const g=$('#gate'); if(!g) return;
  g.classList.add('hide'); document.body.classList.remove('gated');
}
function initGate(){
  document.body.classList.add('gated');
  $('#gate-start').addEventListener('click', openGate);
  /* 대문을 닫지 않는다. 계정 창은 대문 위에 뜨고, 닫으면 다시 대문으로 돌아온다.
     로그인/가입을 마쳐도 '시작하기'를 누르기 전까지는 게임에 들어가지 않는다. */
  $('#gate-acct').addEventListener('click', accountScreen);
  renderGate();
}

function boot(){
  preloadSprites();
  initGate();
  S=load(); save();          // 첫 실행이면 시작 기체를 바로 확정해 저장한다
  document.querySelectorAll('.nav button').forEach(b=> b.addEventListener('click',()=>go(b.dataset.s)));
  go('hangar');

  /* 게스트 계정 연결과 동기화는 화면을 막지 않는다. 실패해도 localStorage 로 계속 논다. */
  net.connect().then(async ok=>{
    renderAcct(); renderGate();
    if(ok) await syncOnConnect();
    renderAll();   // 접속 전에 그려 둔 화면에는 '오프라인' 안내가 남아 있다
  }).catch(()=>{ renderAcct(); renderGate(); });

  /* 탭을 닫기 전에 남은 변경을 밀어 넣는다. visibilitychange 가 더 확실하게 불린다. */
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState==='hidden') net.flush(()=>S);
  });
}
// type="module" 은 defer 라 이미 파싱이 끝나 있을 수 있다
/* 피로도 자연 회복은 시간이 흐르면 진행된다. 20초마다 정산하고,
   실제로 회복됐거나 격납고를 보고 있으면(남은 시간 표시) 다시 그린다.
   모달이 열려 있으면 건드리지 않는다. */
setInterval(()=>{
  if(!S) return;
  let changed = 0;
  for(const rb of S.robots) changed += decayFat(rb);
  if(changed) save();
  const modalOpen = !!document.querySelector('#modal.on, .modal.on');
  if(modalOpen) return;                       // 모달을 보고 있으면 건드리지 않는다
  if(changed) renderWallet();
  if(cur==='hangar' && (changed || S.robots.some(r=>fatOf(r)>0))) renderHangar();
  if(cur==='hunt' && S.expd) renderHunt();     // 남은 시간만 다시 그린다. 서버에 묻지 않는다.
}, 20000);

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
