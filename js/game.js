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
import { isPct, fatOf, serviceCost, findPart, partStat, gainExp, addFat,
         expNeed, battleExp, lvCost, enhCost,
         computeStats as _computeStats, power as _power } from './stats.js';
import { mulberry32, makeUnit, simulate } from './sim.js';
import { sprite, preloadSprites } from './sprites.js';

const { MAXLV, PULL_COST, ATK_SCALE, FAT_MAX, DUPE_GAIN } = CONST;
const ROBOT_APPEAR = PULL_TABLE.find(t=>t.k==='robot').w/100;   // 화면 표기는 뽑기 표에서 파생
const PULL_KO = { robot:'로봇', core:'코어', credit:'크레딧', part:'파츠', bust:'꽝' };
const SLOT_KO = {WEAPON:'무장',FRAME:'프레임',BOOSTER:'부스터',CORE:'코어'};
const STAT_LABEL = { hp:'내구', atk:'공격', def:'방어', spd:'속도', crit:'치명', eva:'회피' };
const STAT_MAX   = { hp:1500, atk:68, def:280, spd:140, crit:.75, eva:.6 };  // atk 는 ATK_SCALE 적용 후 기준

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
function robRarTag(type){ const r=RR[rarOf(type)]; return `<span class="tag rr-${r.k}">${r.ko}</span>`; }


/* ------------------------------- 상태/저장 ------------------------------- */
const SAVE_KEY = 'rowar.save.v2';   // v1(로봇 3기 체제)은 로스터가 완전히 달라 호환되지 않는다
let S = null;
function emptySlots(){ return {WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}; }
function freshState(){         // 시작: 커먼 1기, Lv.1 — 나머지 기체는 뽑기로만 얻는다
  return { v:2, credits:600, cores:12, scrap:30,
    robots:[{uid:uid(),type:pick(BY_RARITY.C),level:1,exp:0,fat:0,slots:emptySlots()}],
    parts:[], sel:0, stat:{wins:0,losses:0,pulls:0} };
}
function normalize(j){         // 저장본에 빠진 필드 보정
  j.robots = j.robots.filter(rb=>ROBOT_TYPES[rb.type]);
  if(!j.robots.length) return freshState();
  for(const rb of j.robots){ rb.level=clamp(rb.level|0,1,MAXLV); rb.exp=Math.max(0,rb.exp|0);
    if(rb.fat==null && rb.dur!=null) rb.fat = clamp(100-rb.dur, 0, FAT_MAX);   // 예전 '내구도' 저장본 이관
    delete rb.dur; rb.fat = fatOf(rb); }
  j.sel = clamp(j.sel|0, 0, j.robots.length-1); j.v = 2; return j;
}
function load(){
  try{ localStorage.removeItem('rowar.save.v1'); }catch(e){}      // 옛 저장본 정리
  try{ const j=JSON.parse(localStorage.getItem(SAVE_KEY)); if(j&&j.robots&&j.robots.length) return normalize(j); }catch(e){}
  return freshState();
}
function save(){ try{ localStorage.setItem(SAVE_KEY,JSON.stringify(S)); }catch(e){} }

/* ------------------------------- 스탯 계산 ------------------------------- */
/* computeStats / power 는 js/stats.js 의 순수 함수다. 여기서는 기본 parts 로 S.parts 를
   채워 주는 얇은 래퍼만 두어, 아래 호출부를 원래 형태 그대로 유지한다. */
const computeStats = (robot, parts) => _computeStats(robot, parts || S.parts);
const power        = (robot, parts) => _power(robot, parts || S.parts);
const overallLevel = ()=> Math.max(1, ...S.robots.map(r=>r.level));

/* ------------------------------- 파츠/뽑기 ------------------------------- */
function genPart(level){
  const slot=pick(SLOTS), rar=weighted(RARITY), lvScale=1+(level||1)*0.03, stats={};
  for(let i=0;i<rar.n;i++){ const st=pick(SLOT_STATS[slot]); const [a,b]=STAT_ROLL[st];
    let v=rf(a,b)*rar.mul; if(!isPct(st)) v=Math.round(v*lvScale);
    stats[st]=(stats[st]||0)+v; }
  for(const k in stats) if(isPct(k)) stats[k]=Math.round(stats[k]*1000)/1000;
  return { uid:uid(), slot, name:pick(PART_NAMES[slot]), rarity:rar.k, ko:rar.ko, stats, enh:0 };
}
function pull(){
  if(S.cores<PULL_COST){ toast('코어가 부족합니다'); return null; }
  S.cores-=PULL_COST; S.stat.pulls++;
  const kind=weighted(PULL_TABLE).k; let res;
  if(kind==='robot'){ const type=pick(BY_RARITY[weighted(ROBOT_RARITY).k]);
    if(S.robots.some(r=>r.type===type)){ const g=DUPE_GAIN[rarOf(type)];
      S.credits+=g.cr; S.scrap+=g.sc; S.cores+=g.co; res={kind:'dupe',type,gain:g}; }
    else { const rb={uid:uid(),type,level:1,exp:0,fat:0,slots:emptySlots()}; S.robots.push(rb); res={kind:'robot',type}; }
  }
  else if(kind==='core'){ S.cores+=1; res={kind:'core',n:1}; }
  else if(kind==='credit'){ const cr=140+overallLevel()*12+ri(0,90); S.credits+=cr; res={kind:'credit',cr}; }
  else if(kind==='part'){ const p=genPart(overallLevel()); S.parts.push(p); res={kind:'part',part:p}; }
  else { res={kind:'bust'}; }
  save(); return res;
}

/* ------------------------------- 장착/육성 ------------------------------- */
function selRobot(){ return S.robots[S.sel]; }
function equip(slot,partUid){ for(const rb of S.robots) for(const sl of SLOTS) if(rb.slots[sl]===partUid) rb.slots[sl]=null; selRobot().slots[slot]=partUid; save(); renderAll(); closeModal(); }
function unequip(slot){ selRobot().slots[slot]=null; save(); renderAll(); closeModal(); }
function enhancePart(u){ const p=findPart(u,S.parts); if(!p) return; if((p.enh||0)>=10){toast('최대 강화입니다');return;} const c=enhCost(p.enh||0); if(S.scrap<c){toast('스크랩이 부족합니다');return;} S.scrap-=c; p.enh=(p.enh||0)+1; save(); renderAll(); toast(p.name+' +'+p.enh); }
function service(){               // 크레딧으로 피로도 0 복구
  const rb=selRobot(), c=serviceCost(rb);
  if(c<=0){ toast('이미 정비된 상태입니다'); return; }
  if(S.credits<c){ toast('크레딧이 부족합니다'); return; }
  S.credits-=c; rb.fat=0; save(); renderAll(); toast(ROBOT_TYPES[rb.type].name+' 정비 완료'); }
function levelUp(){               // 크레딧으로 즉시 1레벨(진행 중인 경험치는 소모된다)
  const rb=selRobot(); if(rb.level>=MAXLV){toast('최대 레벨입니다');return;}
  const c=lvCost(rb.level); if(S.credits<c){toast('크레딧이 부족합니다');return;}
  S.credits-=c; rb.level++; rb.exp=0; save(); renderAll(); toast(ROBOT_TYPES[rb.type].name+' Lv.'+rb.level); }

/* ------------------------------- UI 기본 ------------------------------- */
let cur='hangar', toastT;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('on'),1600); }
function go(scr){ cur=scr; document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id==='sc-'+scr));
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.s===scr));
  renderAll(); }
function renderWallet(){ $('#w-credit').textContent=fmt(S.credits); $('#w-core').textContent=fmt(S.cores); $('#w-scrap').textContent=fmt(S.scrap); }
function renderAll(){ renderWallet(); if(cur==='hangar')renderHangar(); else if(cur==='gacha')renderGacha(); else if(cur==='battle')renderBattleHome(); }
function openModal(html){ const m=$('#modal'); m.innerHTML=`<div class="modal-card">${html}</div>`; m.classList.add('on'); m.onclick=e=>{ if(e.target===m) closeModal(); }; }
function closeModal(){ $('#modal').classList.remove('on'); $('#modal').innerHTML=''; }

function rarTag(p){ return `<span class="tag rar-${p.rarity}">${p.rarity}${p.enh?` +${p.enh}`:''}</span>`; }
function partStatLine(p){ const ps=partStat(p); return Object.keys(ps).map(k=> `${STAT_LABEL[k]} +${isPct(k)?(ps[k]*100).toFixed(1)+'%':Math.round(ps[k])}`).join(' · '); }
function statBar(k,v,full){       // full 을 주면 깎여나간 만큼을 붉게 겹쳐 보여준다
  const pct=clamp(v/STAT_MAX[k]*100,0,100), val=isPct(k)?(v*100).toFixed(0)+'%':fmt(v);
  const dmg = full!=null && full>v;
  const ghost = dmg? `<u style="width:${clamp(full/STAT_MAX[k]*100,0,100)}%"></u>` : '';
  const lost  = dmg? ` <s>-${fmt(full-v)}</s>` : '';
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
            ${['hp','atk','def','spd','crit','eva'].map(k=>statBar(k,st[k], k==='hp'?st.hpFull:null)).join('')}
          </div>
          <div class="stat fat"><div class="row"><b>피로도</b>
              <span class="${fat?'worn':''}">${fat} / ${FAT_MAX}${fat?` <s>최대 내구 −${fat}%</s>`:''}</span></div>
            <div class="bar"><i style="width:${fat/FAT_MAX*100}%"></i></div></div>
          <div class="skill"><b>스킬 · ${T.skill.name}</b><p>${T.skill.desc}</p></div>
          <div class="row-btns" style="margin-top:10px">
            <button class="btn big" ${rb.level>=MAXLV?'disabled':''} onclick="ROWAR.levelUp()">
              ${rb.level>=MAXLV?'최대 레벨':`즉시 레벨업 (크레딧 ${fmt(cost)})`}</button>
            <button class="btn big ${scost>0?'gold':''}" ${scost>0?'':'disabled'} onclick="ROWAR.service()">
              ${scost>0?`정비 (크레딧 ${fmt(scost)})`:'정비 완료'}</button>
          </div>
          <div class="hint" style="margin-top:6px">대전에 출전하면 경험치를 얻어 자동으로 레벨업합니다.
            대신 피로도가 쌓여 최대 내구(체력)가 줄어듭니다. 등급별 단가로 정비하세요.</div>
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
    <span class="tag rar-C">일반 52%</span><span class="tag rar-R">정밀 30%</span>
    <span class="tag rar-SR">시제 14%</span><span class="tag rar-SSR">초월 4%</span></div>`;
  $('#sc-gacha').innerHTML = `
    <h2 class="title">뽑기 · 코어 캡슐</h2>
    <div class="panel">
      <div class="gacha-stage" id="stage"><div class="ray" style="opacity:.35"></div><div class="capsule"></div></div>
      ${rate}
      <div class="row-btns" style="margin-top:12px">
        <button class="btn gold big" onclick="ROWAR.pull1()" ${S.cores<1?'disabled':''}>1회 뽑기 (코어 1)</button>
        <button class="btn big" onclick="ROWAR.pull10()" ${S.cores<10?'disabled':''}>10회 뽑기 (코어 10)</button>
      </div>
      <div class="hint" style="margin-top:8px">코어는 대전 승리로 조금씩 얻습니다.
        로봇은 ${ROBOT_RARITY.length}등급 ${ROBOT_IDS.length}종이며, 이미 가진 기체가 나오면 등급에 맞춰 자원으로 분해됩니다.</div>
    </div>`;
}
async function pull1(){
  if(S.cores<1){toast('코어가 부족합니다');return;}
  const stage=$('#stage'); stage.classList.add('rolling');
  const res=pull(); renderWallet();
  await sleep(650); stage.classList.remove('rolling');
  showReveal([res]);
}
async function pull10(){
  if(S.cores<10){toast('코어가 부족합니다');return;}
  const stage=$('#stage'); stage.classList.add('rolling');
  const results=[]; for(let i=0;i<10;i++){ const r=pull(); if(r) results.push(r); }
  renderWallet(); await sleep(650); stage.classList.remove('rolling');
  showReveal(results);
}
function revealCardHtml(res){
  if(res.kind==='robot') return `<div class="pchip" style="border-color:var(--acc)"><div class="pn" style="color:var(--acc2)">신규 로봇! ${ROBOT_TYPES[res.type].name} ${robRarTag(res.type)}</div><div class="ps">${ROBOT_TYPES[res.type].role}</div></div>`;
  if(res.kind==='dupe'){ const g=res.gain||DUPE_GAIN[rarOf(res.type)];
    return `<div class="pchip"><div class="pn">${ROBOT_TYPES[res.type].name} ${robRarTag(res.type)} (중복)</div><div class="ps" style="color:var(--gold)">분해 → 크레딧 +${g.cr}, 스크랩 +${g.sc}${g.co?`, 코어 +${g.co}`:''}</div></div>`; }
  if(res.kind==='core') return `<div class="pchip" style="border-color:var(--acc2)"><div class="pn" style="color:var(--acc2)">코어 +${res.n}</div><div class="ps">뽑기를 한 번 더 돌릴 수 있습니다</div></div>`;
  if(res.kind==='credit') return `<div class="pchip"><div class="pn" style="color:var(--gold)">크레딧 +${fmt(res.cr)}</div><div class="ps">레벨업·정비에 쓰세요</div></div>`;
  if(res.kind==='bust') return `<div class="pchip" style="opacity:.6"><div class="pn" style="color:var(--dim)">꽝</div><div class="ps">아무것도 나오지 않았습니다</div></div>`;
  const p=res.part; return `<div class="pchip"><div class="pn">${p.name} ${rarTag(p)}</div><div class="ps">${SLOT_KO[p.slot]} · ${partStatLine(p)}</div></div>`;
}
function showReveal(results){
  const best=results.reduce((a,b)=> rankOf(b)>rankOf(a)?b:a, results[0]);
  const heroType = (best.kind==='robot'||best.kind==='dupe')? best.type : null;
  const hero = heroType ? `<div class="sprite" data-t="${rarOf(heroType)}">${sprite(heroType,false)}</div>`
             : best.kind==='part'   ? bigPartArt(best.part)
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
      <button class="btn big" style="margin-top:12px" onclick="ROWAR.findMatch()">상대 찾기</button>
      <div class="hint" style="margin-top:8px">전적 · ${S.stat.wins}승 ${S.stat.losses}패
        <span style="color:var(--dim)"> · (지금은 서버 대신 로컬에서 상대를 생성하는 임시 매칭입니다)</span></div>
    </div>`;
}
function findMatch(){
  $('#sc-battle').innerHTML = `<h2 class="title">대전</h2><div class="panel"><div class="mm">
    <div class="spinner"></div><div style="font-weight:800">상대를 검색하는 중...</div>
    <div class="hint">상대 로봇과 야생 몬스터의 신호를 탐색합니다.</div></div></div>`;
  setTimeout(()=>{ _pendingOpp=makeOpponent(); showOpponent(_pendingOpp); }, 1200);
}
function oppType(byRarity=BY_RARITY){                       // 내가 가진 최고 등급보다 한 단계 위까지만 만난다
  const best=Math.max(...S.robots.map(r=>RIDX[rarOf(r.type)]));
  const pool=ROBOT_RARITY.filter(r=>RIDX[r.k]<=Math.min(4,best+1));
  return pick(byRarity[weighted(pool).k]);
}
function makeOpponent(){
  const monster=R()<CONST.MONSTER_RATE;
  const myLv=selRobot().level, type=oppType(monster?MONSTER_BY_RARITY:BY_RARITY), lv=clamp(myLv+ri(-2,2),1,MAXLV);
  const rb={uid:'E'+uid(),type,level:lv,slots:emptySlots()}, parts=[];
  // 몬스터는 고유 스탯/성장률로 싸우며 소유 기체나 파츠를 생성하지 않는다.
  if(monster) return {kind:'monster',robot:rb,parts,callsign:MONSTER_TYPES[type].name};
  const np=ri(0,2);
  for(let i=0;i<np;i++){ const p=genPart(lv); parts.push(p); rb.slots[p.slot]=p.uid; }
  const callsign=pick(['NOVA','RAZE','ORCA','KITE','VULT','ZERO','ONYX','HELM','SABLE','ARC','GEIST','ROOK'])+'-'+ri(10,99);
  return {kind:'robot',robot:rb,parts,callsign};
}
function showOpponent(opp){
  const T=COMBAT_TYPES[opp.robot.type], monster=!!MONSTER_TYPES[opp.robot.type];
  $('#sc-battle').innerHTML = `
    <h2 class="title">${monster?'몬스터 출현':'상대 발견'}</h2>
    <div class="panel">
      <div class="oppcard">
        <div class="sprite" data-t="${T.rarity}" style="height:120px">${sprite(opp.robot.type,false)}</div>
        <div>
          <div class="rname">${opp.callsign} ${monster?'<span class="tag monster-tag">몬스터</span>':robRarTag(opp.robot.type)}</div>
          <div class="rrole">${monster?'위험도 '+T.rarity:T.name} · ${T.role} · Lv.${opp.robot.level}</div>
          <div style="margin-top:6px;font-weight:800;color:var(--bad)">전투력 ${fmt(power(opp.robot,opp.parts))}</div>
        </div>
      </div>
      ${monster?`<div class="monster-skill"><strong>${T.skill.name}</strong><span>${T.skill.desc}</span></div>`:''}
      <div class="row-btns" style="margin-top:12px">
        <button class="btn big gold" onclick="ROWAR.startBattle()">전투 시작</button>
        <button class="btn ghost" onclick="ROWAR.findMatch()">다시 찾기</button>
      </div>
    </div>`;
}


function startBattle(){
  const opp=_pendingOpp; if(!opp) return;
  const my=selRobot(); _battleRobot=my;          // 전투 중 기체를 바꿔도 보상은 출전 기체에게
  const P=makeUnit(ROBOT_TYPES[my.type].name,my.type,computeStats(my));
  const E=makeUnit(opp.callsign,opp.robot.type,computeStats(opp.robot,opp.parts));
  const seed=(Date.now()^Math.floor(R()*1e9))>>>0;
  const events=simulate(P,E,seed);   // P,E 의 hp/sp 는 여기서 소진됨(재생은 maxhp/name 만 사용)
  renderArena(my.type,opp.robot.type,P.name,E.name);
  playBattle(events,P,E).then(winner=>{
    if(!winner) return;                          // 중간에 나갔으면 결과/보상 없이 조용히 종료
    const rw=battleRewards(winner==='P',opp.robot.level);
    renderResult(winner==='P',rw,P,E,opp);
  });
}
function battleRewards(win,enemyLv){
  const rb=_battleRobot||selRobot(), rname=ROBOT_TYPES[rb.type].name;
  const lv=gainExp(rb, win? battleExp(enemyLv) : Math.round(battleExp(enemyLv)*0.35));
  const fat={add:addFat(rb, win? 3+ri(0,2) : 7+ri(0,3)), now:fatOf(rb)};
  if(win){ const cr=120+enemyLv*14+ri(0,40), sc=18+ri(0,14); S.credits+=cr; S.scrap+=sc;
    let core=0,part=null; if(R()<0.20){core=1;S.cores++;} if(R()<0.09){part=genPart(enemyLv);S.parts.push(part);}   // 예전 0.35 의 약 1/4
    S.stat.wins++; save(); return {win,cr,sc,core,part,lv,fat,rname}; }
  const cr=40+ri(0,20), sc=6; S.credits+=cr; S.scrap+=sc; S.stat.losses++; save();
  return {win,cr,sc,core:0,part:null,lv,fat,rname};
}

/* ---- 대전 아레나 & 재생 ---- */
function renderArena(pType,eType,pName,eName){
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
function flash(){ const f=AR('#flash'); if(!f) return; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
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
  const rewards = [ `<div class="r">경험치 +${rw.lv.amt}</div>` ];
  if(rw.lv.to>rw.lv.from) rewards.push(`<div class="r" style="color:var(--good)">레벨 업!  ${rw.rname}  Lv.${rw.lv.from} → Lv.${rw.lv.to}</div>`);
  rewards.push(`<div class="r">크레딧 +${rw.cr}</div>`, `<div class="r">스크랩 +${rw.sc}</div>`);
  if(rw.fat.add) rewards.push(`<div class="r" style="color:var(--bad)">피로도 +${rw.fat.add}  (누적 ${rw.fat.now} / ${FAT_MAX})</div>`);
  if(rw.core) rewards.push(`<div class="r" style="color:var(--acc2)">코어 +${rw.core}</div>`);
  if(rw.part) rewards.push(`<div class="r">파츠: ${rw.part.name} <span class="tag rar-${rw.part.rarity}">${rw.part.rarity}</span></div>`);
  $('#sc-battle').innerHTML = `
    <div class="panel result">
      <div class="big ${win?'win':'lose'}">${win?'VICTORY':'DEFEAT'}</div>
      <div class="hint">${P.name} vs ${E.name}</div>
      <div class="reward">${rewards.join('')}</div>
      <div class="row-btns">
        <button class="btn big gold" onclick="ROWAR.findMatch()">한 판 더</button>
        <button class="btn big ghost" onclick="ROWAR.go('hangar')">격납고</button>
      </div>
    </div>`;
  renderWallet();
}
function toggleSpeed(){ battleSpeed = battleSpeed>=8?1:battleSpeed*2; const b=$('#spdbtn'); if(b)b.textContent='속도 x'+battleSpeed; }

/* ------------------------------- 초기화/공개 ------------------------------- */
function resetSave(){ if(confirm('정말 초기화할까요? 모든 진행이 삭제됩니다.')){ S=freshState(); save(); go('hangar'); toast('초기화 완료'); } }
window.ROWAR = {
  go, selectRobot:(i)=>{ S.sel=i; save(); renderHangar(); }, levelUp, service, openSlot, equip, unequip, enhance:enhancePart, closeModal,
  pull1, pull10, findMatch, startBattle, toggleSpeed, reset:resetSave
};
function boot(){
  preloadSprites();
  S=load(); save();          // 첫 실행이면 시작 기체를 바로 확정해 저장한다
  document.querySelectorAll('.nav button').forEach(b=> b.addEventListener('click',()=>go(b.dataset.s)));
  go('hangar');
}
// type="module" 은 defer 라 이미 파싱이 끝나 있을 수 있다
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
