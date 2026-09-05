/* ==================================================================
 * ROWAR - 상태 · 화면 · 게임 루프 (Claude 담당 · CONTRACT.md 참조)
 *   루프: 뽑기 -> 기체 육성(레벨/파츠) -> 상대 매칭 -> 자동 대전 -> 파밍
 *   저장: localStorage (rowar.save.v2)
 *
 * 데이터는 data/balance.js, 스탯 계산은 js/stats.js, 전투는 js/sim.js 에 있다.
 * 이 파일만 DOM 을 만진다 — 나머지는 서버(Worker)에서도 그대로 import 된다.
 * ================================================================== */
import { ROBOT_TYPES, MONSTER_TYPES, ROBOT_RARITY, PULL_TABLE,
         SLOTS, SLOT_STATS, PART_NAMES, RARITY, STAT_ROLL, CONST } from '../data/balance.js';
import { RR, RIDX, ROBOT_IDS, COMBAT_TYPES, BY_RARITY, MONSTER_BY_RARITY, rarOf } from './units.js';
import { isPct, fatOf, serviceCost, sortieCost, findPart, partStat, gainExp, addFat, decayFat, fatNextMs, fatRecoverMs, atkRange,
         expNeed, battleExp, lvCost, enhCost,
         computeStats as _computeStats, power as _power } from './stats.js';
import { mulberry32, makeUnit, simulate } from './sim.js';
import * as net from './net.js';
import { rollPull, genPart as _genPart, autoScrapValue } from './gacha.js';
import { makeOpponent as _makeOpponent } from './rewards.js';
import { sprite, preloadSprites } from './sprites.js';

const { MAXLV, PULL_COST, ATK_SCALE, FAT_MAX, DUPE_GAIN } = CONST;
const ROBOT_APPEAR = PULL_TABLE.find(t=>t.k==='robot').w/100;   // 화면 표기는 뽑기 표에서 파생
const PULL_KO = { robot:'로봇', core:'코어', credit:'크레딧', part:'파츠', bust:'꽝' };
const SLOT_KO = {WEAPON:'무장',FRAME:'프레임',BOOSTER:'부스터',CORE:'코어'};
const STAT_LABEL = { hp:'내구', atk:'공격', def:'방어', spd:'속도', crit:'치명', eva:'회피' };
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
  return { v:2, credits:600, cores:12, scrap:30,
    robots:[{uid:uid(),type:pick(BY_RARITY.C),level:1,exp:0,fat:0,slots:emptySlots()}],
    parts:[], sel:0, stat:{wins:0,losses:0,pulls:0} };
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
  j.sel = clamp(Math.round(num(j.sel,0)), 0, j.robots.length-1); j.v = 2; return j;
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
  if(res.kind==='robot'){ S.robots.push({uid:uid(),type:res.type,level:1,exp:0,fat:0,slots:emptySlots()}); }
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
const ERR_KO = { 'not enough credits':'크레딧이 부족합니다', 'not enough scrap':'스크랩이 부족합니다',
  'max level':'최대 레벨입니다', 'max enhanced':'최대 강화입니다', 'already serviced':'이미 정비된 상태입니다',
  'slot mismatch':'그 슬롯에 넣을 수 없는 파츠입니다', 'part not found':'파츠를 찾을 수 없습니다' };

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

/* ------------------------------- UI 기본 ------------------------------- */
let cur='hangar', toastT;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'),1600); }
/* 배경 연출은 body[data-scene] 하나로 갈린다.
   hangar/gacha = 격납고, battle = 야간작전, arena = 콕핏 HUD */
function setScene(name){ document.body.dataset.scene = name; }
function go(scr){ cur=scr; setScene(scr); document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id==='sc-'+scr));
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.s===scr));
  renderWallet();
  if(scr==='hangar') renderHangar();
  else if(scr==='gacha') renderGacha();
  else if(scr==='battle') renderBattleHome();     // 대전은 여기서만 처음부터 그린다
  else if(scr==='rank') renderRank();
  else if(scr==='hunt') renderHunt(); }
function renderWallet(){ $('#w-credit').textContent=fmt(S.credits); $('#w-core').textContent=fmt(S.cores); $('#w-scrap').textContent=fmt(S.scrap); }
/* 대전 화면은 자체 흐름(상대 찾기 → 발견 → 아레나 → 결과)을 갖는다.
   여기서 renderBattleHome() 을 부르면 재생 중인 전투나 방금 뜬 결과 화면이 날아간다.
   그래서 renderAll 은 대전 화면을 건드리지 않는다. 대전 화면은 go() 가 그린다. */
function renderAll(){ renderWallet(); if(cur==='hangar')renderHangar(); else if(cur==='gacha')renderGacha(); }
function openModal(html){ const m=$('#modal'); m.innerHTML=`<div class="modal-card">${html}</div>`; m.classList.add('on'); m.onclick=e=>{ if(e.target===m) closeModal(); }; }
function closeModal(){ $('#modal').classList.remove('on'); $('#modal').innerHTML=''; }

function rarTag(p){ return `<span class="tag rar-${p.rarity}">${p.rarity}${p.enh?` +${p.enh}`:''}</span>`; }
function partStatLine(p){ const ps=partStat(p); return Object.keys(ps).map(k=> `${STAT_LABEL[k]} +${isPct(k)?(ps[k]*100).toFixed(1)+'%':Math.round(ps[k])}`).join(' · '); }
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
    return `<div class="rcard ${i===S.sel?'sel':''}" data-t="${t.rarity}" onclick="ROWAR.selectRobot(${i})">
      <span class="badge">Lv.${r.level}</span>
      <span class="badge rt rr-${t.rarity}">${RR[t.rarity].ko}</span>
      <div class="sprite" data-t="${t.rarity}">${sprite(r.type,false)}</div>
      <div class="rn">${t.name}</div><div class="rl">전투력 ${fmt(power(r))}</div>
      ${fatOf(r)?`<div class="rd">피로 ${fatOf(r)}</div>`:''}</div>`; }).join('');
  const slotsHtml = SLOTS.map(slot=>{ const u=rb.slots[slot]; const p=u&&findPart(u,S.parts);
    return `<div class="slot ${p?'filled':''}" onclick="ROWAR.openSlot('${slot}')">
      <div class="sl">${SLOT_KO[slot]}</div>
      ${p?`<div class="pn">${p.name}</div><div class="pp">${rarTag(p)}</div>`:`<div class="pn" style="color:var(--dim)">+ 장착</div>`}</div>`; }).join('');
  const invParts = S.parts.filter(p=> !S.robots.some(r=>Object.values(r.slots).includes(p.uid)));
  const inv = invParts.length? invParts.map(p=>`<div class="pchip" onclick="ROWAR.enhance('${p.uid}')" title="클릭: 강화(스크랩 ${enhCost(p.enh||0)})">
      <div class="pn">${p.name} ${rarTag(p)}</div><div class="ps">${SLOT_KO[p.slot]} · ${partStatLine(p)}</div>
      <div class="ps" style="color:var(--gold)">클릭 → 강화 (스크랩 ${enhCost(p.enh||0)})</div></div>`).join('')
    : `<div class="empty">보유한 여분 파츠가 없습니다. 뽑기나 대전으로 획득하세요.</div>`;
  const cost=lvCost(rb.level), fat=fatOf(rb), scost=serviceCost(rb);
  $('#sc-hangar').innerHTML = `
    <h2 class="title">격납고 · 보유 로봇 ${S.robots.length}기</h2>
    <div class="panel"><div class="roster">${roster}</div></div>
    <div class="panel">
      <div class="detail">
        <div><div class="sprite" data-t="${T.rarity}">${sprite(rb.type,false)}</div></div>
        <div>
          <div class="rname">${T.name} ${robRarTag(rb.type)} <span class="lv">Lv.${rb.level}</span></div>
          <div class="rrole">${T.role} · 전투력 ${fmt(power(rb))}</div>
          <div class="stat exp"><div class="row"><b>EXP</b><span>${
            rb.level>=MAXLV?'MAX':`${fmt(rb.exp||0)} / ${fmt(expNeed(rb.level))}`}</span></div>
            <div class="bar"><i style="width:${rb.level>=MAXLV?100:clamp((rb.exp||0)/expNeed(rb.level)*100,0,100)}%"></i></div></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 14px;margin-top:6px">
            ${['hp','atk','def','spd','crit','eva'].map(k=>statBar(k,st[k],
                k==='hp'?st.hpFull:null, k==='atk'?atkRange(st):null)).join('')}
          </div>
          <div class="hint" style="margin-top:2px">공격력은 매 타격마다 위 구간 안에서 정해집니다 ·
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
      <div class="hint">파츠를 클릭하면 <b>강화</b>됩니다(스크랩 소모). 장착은 위의 슬롯을 눌러 선택하세요.</div>
      <div class="inv">${inv}</div>
    </div>`;
}
function openSlot(slot){
  const rb=selRobot(); const equippedHere=rb.slots[slot];
  const list=S.parts.filter(p=>p.slot===slot);
  const rows = list.length? list.map(p=>{ const equipped = S.robots.some(r=>Object.values(r.slots).includes(p.uid));
    const onMe = equippedHere===p.uid;
    return `<div class="pchip" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div><div class="pn">${p.name} ${rarTag(p)}</div><div class="ps">${partStatLine(p)}</div>
      ${equipped&&!onMe?`<div class="ps" style="color:var(--bad)">다른 기체 장착중</div>`:''}</div>
      <button class="btn ${onMe?'danger':''}" style="padding:8px 12px;font-size:13px"
        onclick="ROWAR.${onMe?`unequip('${slot}')`:`equip('${slot}','${p.uid}')`}">${onMe?'해제':'장착'}</button>
    </div>`; }).join('') : `<div class="empty">이 슬롯(${SLOT_KO[slot]})에 맞는 파츠가 없습니다.</div>`;
  openModal(`<div class="mhead">${SLOT_KO[slot]} 슬롯 · 파츠 선택 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>${rows}`);
}

/* ------------------------------- 뽑기 화면 ------------------------------- */
function renderGacha(){
  const wsum=ROBOT_RARITY.reduce((s,r)=>s+r.w,0);
  const tipCol={bust:'var(--dim)',core:'var(--acc2)',credit:'var(--gold)',robot:'var(--acc2)',part:'var(--sub)'};
  const rate=`<div class="rates">
    ${PULL_TABLE.map(t=>`<span class="tag" style="color:${tipCol[t.k]}">${PULL_KO[t.k]} ${t.w}%</span>`).join('')}</div>
    <div class="rates" style="margin-top:6px">
    <span class="tag" style="color:var(--sub)">로봇 등급</span>
    ${ROBOT_RARITY.map(r=>`<span class="tag rr-${r.k}">${r.ko} ${(ROBOT_APPEAR*r.w/wsum*100).toFixed(2)}%</span>`).join('')}</div>
    <div class="rates" style="margin-top:6px">
    <span class="tag" style="color:var(--sub)">파츠 등급</span>
    <span class="tag" style="color:var(--dim)">일반은 자동 분해</span>
    <span class="tag rar-C">일반 52%</span><span class="tag rar-R">정밀 30%</span>
    <span class="tag rar-SR">시제 14%</span><span class="tag rar-SSR">초월 4%</span></div>`;
  $('#sc-gacha').innerHTML = `
    <h2 class="title">뽑기 · 코어 캡슐</h2>
    <div class="panel">
      <div class="gacha-stage" id="stage"><div class="ray" style="opacity:.35"></div><div class="capsule"></div></div>
      ${rate}
      <div class="row-btns" style="margin-top:12px">
        <button class="btn gold big" onclick="ROWAR.pull1()" ${(S.cores<1||!net.state.online)?'disabled':''}>1회 뽑기 (코어 1)</button>
        <button class="btn big" onclick="ROWAR.pull10()" ${(S.cores<10||!net.state.online)?'disabled':''}>10회 뽑기 (코어 10)</button>
      </div>
      ${net.state.online?'':'<div class="hint" style="margin-top:8px;color:var(--bad)">서버에 연결되지 않아 뽑기를 할 수 없습니다. 뽑기 결과는 서버가 판정합니다.</div>'}
      <div class="hint" style="margin-top:8px">코어는 대전 승리로 조금씩 얻습니다.
        로봇은 ${ROBOT_RARITY.length}등급 ${ROBOT_IDS.length}종이며, 이미 가진 기체가 나오면 등급에 맞춰 자원으로 분해됩니다.</div>
    </div>`;
}
/* 뽑기는 서버가 판정한다.
   클라가 "이런 게 나왔다"고 보내는 것을 받지 않기 때문에, 클라 코드를 고쳐도
   결과를 조작할 수 없다. 대신 연결이 없으면 뽑을 수 없다 — 오프라인에서 로컬로
   굴리게 두면 끊고 굴린 뒤 올리면 그만이라 서버 판정의 의미가 사라진다. */
async function doPull(count){
  if(S.cores<count){ toast('코어가 부족합니다'); return; }
  if(!net.state.online){ toast('뽑기는 서버 연결이 필요합니다'); return; }

  const stage=$('#stage'); stage.classList.add('rolling');
  const r = await net.pullServer(count);
  await sleep(650); stage.classList.remove('rolling');

  if(!r){ toast('뽑기는 서버 연결이 필요합니다'); return; }
  if(r.error){ toast(r.error==='not enough cores' ? '코어가 부족합니다' : '뽑기 실패: '+r.error); return; }

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
  if(res.kind==='scrap') return `<div class="pchip"><div class="pn">${res.part.name} <span class="tag rar-${res.part.rarity}">${res.part.rarity}</span></div><div class="ps" style="color:var(--sub)">자동 분해 → 스크랩 +${res.n}</div></div>`;
  const p=res.part; return `<div class="pchip"><div class="pn">${p.name} ${rarTag(p)}</div><div class="ps">${SLOT_KO[p.slot]} · ${partStatLine(p)}</div></div>`;
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
let _pendingOpp=null, _battleRobot=null, battleSpeed=2;   // 공격력 너프로 턴이 길어져 기본 x2
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
          <div class="hint">출전 기체는 격납고에서 선택한 로봇입니다.</div>
        </div>
      </div>
      <div class="hint" style="margin-top:10px">상대 로봇 또는 야생 몬스터와 대전합니다. 몬스터는 대전에서만 출현합니다.</div>
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
        <span style="color:var(--dim)"> · (지금은 서버 대신 로컬에서 상대를 생성하는 임시 매칭입니다)</span></div>
    </div>`;
}
/* ------------------------------- 랭킹 ------------------------------- */
/* 순위는 서버 크론이 미리 계산해 둔 값을 받아 오기만 한다.
   여기서 세면 하위권일수록 거의 전원을 읽어 무료 한도가 마른다. */
async function renderRank(){
  const el=$('#sc-rank');
  const wrap = inner => `<h2 class="title">랭킹</h2>${inner}`;
  if(!net.state.online){
    el.innerHTML = wrap(`<div class="panel"><div class="hint">랭킹은 서버 연결이 필요합니다.</div></div>`);
    return;
  }
  el.innerHTML = wrap(`<div class="panel"><div class="mm"><div class="spinner"></div>
    <div style="font-weight:800">순위를 불러오는 중...</div></div></div>`);

  const r=await net.ranking();
  if(!r || r.error){
    el.innerHTML = wrap(`<div class="panel"><div class="hint">순위를 불러오지 못했습니다${r&&r.error?' · '+r.error:''}</div></div>`);
    return;
  }

  const me=r.me;
  const myRank = me.rank==null ? '집계 중' : me.rank+'위';
  const when = r.ranked_at ? new Date(r.ranked_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '아직 없음';

  const rows = r.top.map(t=>`
    <tr class="${t.me?'mine':''}">
      <td class="rk">${t.rank}</td>
      <td class="nm">${t.nickname}${t.me?' <span class="tag">나</span>':''}</td>
      <td class="rt">${fmt(t.rating)}</td>
      <td class="wl">${t.wins}승 ${t.losses}패</td>
    </tr>`).join('');

  el.innerHTML = wrap(`
    <div class="panel myrank">
      <div><div class="hint">내 순위</div><div class="big">${myRank}</div></div>
      <div><div class="hint">레이팅</div><div class="big">${fmt(me.rating)}</div></div>
      <div><div class="hint">전적</div><div class="big">${me.wins}승 ${me.losses}패</div></div>
    </div>
    <div class="panel">
      <table class="rank"><tbody>${rows||'<tr><td class="hint">아직 아무도 없습니다.</td></tr>'}</tbody></table>
      <div class="hint" style="margin-top:8px">
        ${when} 집계 기준 · 전체 ${fmt(r.total)}명${me.live?' · 내 순위는 방금 계산한 값':''}
      </div>
    </div>`);
}

/* 상대는 서버가 고른다. 상대 레벨이 보상에 들어가므로 클라가 고르게 두면
   만렙 상대만 잡아 경험치를 부풀릴 수 있다. */
async function findMatch(opts){
  setScene('battle');
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
/* 파밍 자리. 아레나는 크레딧과 레이팅, 토벌은 스크랩과 파츠를 준다.
   등급이 곧 관문이다 — 비용이 오르고 상대 레벨도 올라간다.
   BOSS 는 내 레벨 +12 라, 잡히기 시작하면 파밍 효율이 가장 좋다. */
const HUNT_KO = { C:'일반', UC:'정예', R:'희귀', UQ:'초희귀', EP:'전설', BOSS:'보스' };
function renderHunt(){
  const rb=selRobot();
  if(!net.state.online){
    $('#sc-hunt').innerHTML = `<h2 class="title">토벌</h2>
      <div class="panel"><div class="hint">토벌은 서버 연결이 필요합니다. 보상을 서버가 판정합니다.</div></div>`;
    return;
  }
  const rows = Object.keys(CONST.HUNT).map(t=>{
    const H=CONST.HUNT[t], cost=Math.ceil(sortieCost(rb)*H.costX), poor=S.credits<cost;
    const lv=Math.max(1,Math.min(MAXLV, rb.level+H.lv));
    const names=(MONSTER_BY_RARITY[t]||[]).map(id=>MONSTER_TYPES[id].name).join(' · ');
    return `<button class="hunt-row${poor?' poor':''}" ${poor?'disabled':''} onclick="ROWAR.hunt('${t}')">
      <div class="ht"><span class="tag rar-${t==='BOSS'?'SSR':t}">${HUNT_KO[t]}</span>
        <b>Lv.${lv}</b></div>
      <div class="hn">${names}</div>
      <div class="hd">스크랩 ×${H.scX} · 파츠 ${Math.round(H.partP*100)}%${H.coreP?` · 코어 ${Math.round(H.coreP*100)}%`:''}</div>
      <div class="hc ${poor?'bad':''}">${fmt(cost)}</div>
    </button>`;
  }).join('');
  $('#sc-hunt').innerHTML = `<h2 class="title">토벌 · 사냥터</h2>
    <div class="panel">
      <div class="hint">몬스터를 사냥해 <b>스크랩과 파츠</b>를 캡니다. 크레딧은 아레나의 절반이 안 되고,
        레이팅은 움직이지 않습니다. 등급이 높을수록 비싸고 상대가 강합니다.</div>
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
  setScene('battle');
  showOpponent(_pendingOpp);
}
/* 연습 대전의 상대. 예전에는 여기에 상대 생성 규칙이 따로 한 벌 있었는데,
   서버가 js/rewards.js 의 규칙으로 옮겨 간 뒤로 둘이 갈라져 있었다 —
   연습에서는 아직 ±2 레벨에 등급 보정도 없어서, 같은 화면인데 다른 게임을 하고 있었다.
   서버와 같은 함수를 부른다. 규칙이 한 곳에만 있어야 갈라지지 않는다. */
function makeOpponent(){
  const my=selRobot();
  const owned=[...new Set(S.robots.map(r=>rarOf(r.type)))];
  const wornUids=Object.values(my.slots||{}).filter(Boolean);
  const worn=S.parts.filter(p=>wornUids.includes(p.uid));
  const o=_makeOpponent(owned, my.level, R, ()=>'E'+uid(), false, worn);
  const rb={uid:'E'+uid(), type:o.type, level:o.level, slots:o.slots};
  return {kind:o.kind==='monster'?'monster':'robot', robot:rb, parts:o.parts, callsign:o.callsign};
}
function showOpponent(opp, practice){
  const T=COMBAT_TYPES[opp.robot.type], monster=!!MONSTER_TYPES[opp.robot.type];
  $('#sc-battle').innerHTML = `
    <h2 class="title">${monster?'몬스터 출현':(opp.kind==='player'?'플레이어 발견':'상대 발견')}</h2>
    <div class="panel">
      <div class="oppcard">
        <div class="sprite" data-t="${T.rarity}" style="height:120px">${sprite(opp.robot.type,false)}</div>
        <div>
          <div class="rname">${opp.callsign} ${monster?'<span class="tag monster-tag">몬스터</span>':robRarTag(opp.robot.type)}${
            opp.kind==='player'?' <span class="tag" style="color:var(--acc2)">플레이어</span>':''}</div>
          <div class="rrole">${monster?'위험도 '+T.rarity:T.name} · ${T.role} · Lv.${opp.robot.level}${
            opp.kind==='player'&&opp.rating!=null?' · 레이팅 '+opp.rating:''}</div>
          <div style="margin-top:6px;font-weight:800;color:var(--bad)">전투력 ${fmt(power(opp.robot,opp.parts))}</div>
        </div>
      </div>
      ${monster?`<div class="monster-skill"><strong>${T.skill.name}</strong><span>${T.skill.desc}</span></div>`:''}
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
 * **아무것도 얻지 못한다** — 경험치·크레딧·파츠·피로도·전적·레이팅이 하나도 안 움직인다.
 * 그래야 '끊고 굴린 뒤 올리기'라는 길이 아예 생기지 않는다.
 * (지금은 PUT /api/state 도 닫혀 있지만, 여기서 상태를 안 건드리는 것이 더 확실하다)
 *
 * 상대 생성은 클라의 makeOpponent 를 쓴다 — 서버 판정으로 옮기면서 안 쓰게 된 코드다.
 * 보상이 없으니 상대를 클라가 고르든 말든 부풀릴 것이 없다. */
let _practiceOpp=null;

function practiceFind(){
  setScene('battle');
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

  playBattle(events,P,E).then(winner=>{
    if(!winner) return;
    renderPracticeResult(events[events.length-1].winner==='P', P, E);
  });
}

function renderPracticeResult(win,P,E){
  setScene('battle');
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
    if(r && /expired|no pending|not enough credits/i.test(r.error||'')){ _pendingOpp=null; return findMatch(); }
    toast('전투를 시작하지 못했습니다'+(r&&r.error?': '+r.error:'')); return;
  }
  setPending(r.next && r.next.opponent, r.next && r.next.cost, r.next && r.next.rescue, r.next && r.next.tier);

  const P=makeUnit(r.nameP, my.type, r.statP);
  const E=makeUnit(r.opponent.callsign, r.opponent.type, r.statE);
  const events=simulate(P,E,r.seed);
  renderArena(my.type, r.opponent.type, P.name, E.name);

  playBattle(events,P,E).then(winner=>{
    if(!winner) return;                          // 중간에 나갔으면 화면만 접는다(보상은 이미 서버에 반영됨)
    applyServerBattle(r, my);
    renderResult(r.win, _lastReward, P, E, opp);
  });
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
function renderArena(pType,eType,pName,eName){
  setScene('arena');                    // 전투 재생 동안만 콕핏 HUD
  $('#sc-battle').innerHTML = `
    <h2 class="title">${MONSTER_TYPES[eType]?'몬스터 대전':'자동 대전'}</h2>
    <div class="arena" id="arena">
      <div class="grid"></div><div class="vs">VS</div>
      <div class="hpwrap p"><div class="nm"><span>${pName}</span><small id="hpn-p"></small></div>
        <div class="hpbar" id="hp-p"><i></i></div><div class="spbar" id="sp-p"><i></i></div></div>
      <div class="hpwrap e"><div class="nm"><small id="hpn-e"></small><span>${eName}</span></div>
        <div class="hpbar" id="hp-e"><i></i></div><div class="spbar" id="sp-e"><i></i></div></div>
      <div class="fighter left" id="fighter-p">${sprite(pType,true)}</div>
      <div class="fighter right" id="fighter-e">${sprite(eType,false)}</div>
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
function shakeF(side){ const el=AR('#fighter-'+side); if(!el) return; el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
async function lunge(side){ const el=AR('#fighter-'+side); if(!el) return; el.classList.add(side==='p'?'lungeL':'lungeR'); await sleep(110/battleSpeed); el.classList.remove('lungeL','lungeR'); }
function floatDmg(side,text,cls){ const host=AR('#fighter-'+side); if(!host) return; const d=document.createElement('div'); d.className='dmg '+cls; d.textContent=text; d.style.left=(side==='p'?'30px':'70px'); d.style.top='24px'; host.appendChild(d); setTimeout(()=>d.remove(),1000); }
function banner(txt){ const b=AR('#skillbanner'); if(!b) return; b.textContent=txt; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
function blog(html){ const l=document.getElementById('blog'); if(!l) return; const d=document.createElement('div'); d.innerHTML=html; l.appendChild(d); l.scrollTop=l.scrollHeight; }
async function playBattle(events,P,E){
  const nameOf=s=> s==='P'?`<span class="k">${P.name}</span>`:`<span style="color:var(--bad);font-weight:700">${E.name}</span>`;
  setHP('p',P.maxhp,P.maxhp); setHP('e',E.maxhp,E.maxhp); setSP('p',0); setSP('e',0);
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
  setScene('battle');                   // 전투가 끝나면 야간작전으로 돌아온다
  const rewards = [];
  if(rw.rescue) rewards.push(`<div class="r" style="color:var(--bad)">비상 출격 · 크레딧만 지급</div>`);
  else if(rw.cost) rewards.push(`<div class="r" style="color:var(--dim)">출격비 −${rw.cost}</div>`);
  if(!rw.rescue) rewards.push(`<div class="r">경험치 +${rw.lv.amt}</div>`);
  if(rw.lv.to>rw.lv.from) rewards.push(`<div class="r" style="color:var(--good)">레벨 업!  ${rw.rname}  Lv.${rw.lv.from} → Lv.${rw.lv.to}</div>`);
  rewards.push(`<div class="r">크레딧 +${rw.cr}</div>`);
  if(!rw.rescue) rewards.push(`<div class="r">스크랩 +${rw.sc}</div>`);
  if(rw.ratingDelta) rewards.push(`<div class="r" style="color:var(--acc2)">레이팅 ${rw.ratingDelta>0?'+':''}${rw.ratingDelta}</div>`);
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
function resetSave(){ if(confirm('정말 초기화할까요? 모든 진행이 삭제됩니다.')){ S=freshState(); save(); go('hangar'); toast('초기화 완료'); } }
window.ROWAR = {
  go,
  selectRobot:async(i)=>{ S.sel=i; renderHangar();
    const rb=S.robots[i];
    if(net.state.online && rb) await net.hangar('select',{robotUid:rb.uid});
    try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){} net.cancelSync(); },
  levelUp, service, openSlot, equip, unequip, enhance:enhancePart, closeModal,
  pull1, pull10, findMatch, nextMatch, startBattle, practiceFind, practiceStart, hunt, toggleSpeed, reset:resetSave,
  account:accountScreen, doRegister, doLogin, logout:doLogout,
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
    el.dataset.tip='서버에 연결하지 못했습니다. 진행상황은 이 브라우저에만 저장됩니다.'
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

  if(remote.rev === 0){                     // 서버는 아직 빈 계정 — 내 진행을 올린다
    const r = await net.push(S);
    if(r && r.ok) toast('진행상황을 서버에 올렸습니다');
    return;
  }
  if(remote.rev > known || known < 0){      // 서버가 더 최신 — 내려받는다
    S = normalize(remote.state);
    save();
    net.cancelSync();                        // 방금 받은 걸 도로 올릴 필요는 없다
    renderAll();
    toast('서버에서 진행상황을 불러왔습니다');
    return;
  }
  await net.push(S);
}

/* 계정 화면 — 게스트면 승격/로그인, 정식이면 로그아웃 */
function accountScreen(){
  const s=net.state;
  if(!s.online){ toast('서버에 연결되지 않았습니다'); return; }

  if(!s.guest){
    openModal(`<div class="mhead">계정 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
      <div class="acctbox">
        <div class="arow"><b>아이디</b><span>${s.loginId}</span></div>
        <div class="arow"><b>계정 번호</b><span>#${String(s.accountId).padStart(4,'0')}</span></div>
        <p class="hint">다른 기기에서도 이 아이디로 로그인하면 진행상황이 이어집니다.</p>
        <button class="btn big" style="margin-top:10px" onclick="ROWAR.logout()">로그아웃</button>
      </div>`);
    return;
  }

  openModal(`<div class="mhead">계정 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="acctbox">
      <p class="hint" style="color:var(--gold)">지금은 <b>게스트 #${String(s.accountId).padStart(4,'0')}</b> 입니다.
        진행상황이 이 브라우저에만 묶여 있어, 브라우저 데이터를 지우면 계정을 잃습니다.</p>

      <div class="asec">
        <div class="atitle">정식 계정 만들기</div>
        <p class="hint">지금 진행상황을 그대로 가지고 갑니다. 새로 시작하지 않습니다.</p>
        <input id="rg-id" class="ainput" placeholder="아이디 (영문·숫자·밑줄 4~20자)" maxlength="20" autocomplete="username">
        <input id="rg-pw" class="ainput" type="password" placeholder="비밀번호 (8자 이상)" autocomplete="new-password">
        <button class="btn big gold" onclick="ROWAR.doRegister()">정식 계정으로 만들기</button>
      </div>

      <div class="asec">
        <div class="atitle">이미 계정이 있다면</div>
        <p class="hint" style="color:var(--bad)">로그인하면 그 계정의 진행상황을 따릅니다.
          지금 이 게스트 진행은 이 브라우저에서 더 이상 보이지 않습니다.</p>
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
  else if(s.guest){ el.textContent='게스트 #'+String(s.accountId).padStart(4,'0')+' 로 시작합니다'; el.className='gate-who guest'; }
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
}, 20000);

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
