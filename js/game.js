/* ==================================================================
 * ROWAR - 상태 · 화면 · 게임 루프 (UI 개편 ChatGPT 담당 · CONTRACT.md 참조)
 *   루프: 뽑기 -> 기체 육성(레벨/파츠) -> 상대 매칭 -> 자동 대전 -> 파밍
 *   저장: localStorage (rowar.save.v2)
 *
 * 데이터는 data/balance.js, 스탯 계산은 js/stats.js, 전투는 js/sim.js 에 있다.
 * 이 파일만 DOM 을 만진다 — 나머지는 서버(Worker)에서도 그대로 import 된다.
 * ================================================================== */
import { ROBOT_TYPES, MONSTER_TYPES, ROBOT_RARITY,
         SLOTS, SLOT_STATS, PART_NAMES, RARITY, STAT_ROLL, CONST,
         AFFIXES, TERRITORY, TERRAIN, PART_BASES } from '../data/balance.js';
import { shardNeed, shardKey, bagView } from './shop.js';
import { parsePresets, presetCheck, PRESET_MAX, NAME_MAX } from './preset.js';
import { parseCodex, codexView, codexRewards, codexTitles, codexActivatable, codexNext, actCost,
         titleName, GROUPS, GROUP_KO } from './codex.js';
import { RR, RIDX, ROBOT_IDS, COMBAT_TYPES, BY_RARITY, MONSTER_BY_RARITY, rarOf } from './units.js';
import { isPct, fatOf, serviceCost, sortieCost, findPart, partStat, partMods, gainExp, addFat, decayFat, fatNextMs, fatRecoverMs, atkRange,
         setKeyOf, setCounts, setActive,
         skillCost, skillRate, skillMax, skillMul,
         expNeed, battleExp, lvCost, enhCost, enhRate, enhMax,
         computeStats as _computeStats, power as _power } from './stats.js';
import { mulberry32, makeUnit, simulate } from './sim.js';
import { runBreach, rarAllowed, applyTerrain, maxRounds } from './breach.js';
import { weekOf, weekEnd, TRIAL_WIN_BASE, trialOf, runTrial, trialWon, foeStats } from './trial.js';
import { raidOf, runRaid, raidSeeds, raidLeft } from './raid.js';
import { runJoint, jointOf, traitLines, traitFit, AIM_KO, JOINT } from './joint.js';
import { damageTable, insight1, insightJoint, eventLines } from './insight.js';
import { SPEAKERS, openingOf, closingOf, scriptOf, artPath } from '../data/story.js';
import { FRONT_CHAPTERS, FRONT_CELLS, readProgress, writeProgress, clearedCount, cellIndex, cellOpen,
         lockedGates, buildLines, rewardOf, unlockedBy, frontView } from './front.js';
import * as net from './net.js';
import { rollPull, rollPart as _rollPart, autoScrapValue, scrapGain, PULL_CUR,
         fuseCheck, fuseCost, fuseUpRate, nextRarity } from './gacha.js';
import { makeOpponent as _makeOpponent, pickTactic, bandStart, bandGoal, huntWeekView, huntResetAt } from './rewards.js';
import { sprite, preloadSprites } from './sprites.js?v=20260912-hangar10-recovery';
import { createIgnisRain } from './ignis-rain.js?v=20260913-ignis-rain1';
import { icon, emblem } from './ui/icons.js';
import { dispatchView, dispatchMissions, expeditionEstimate, expeditionProgress } from './ui/dispatch.js';
import { rankShell, rankingView } from './ui/ranking.js';
import { trialChallengeView, raidChallengeView, challengeMessage } from './ui/challenge.js';
import { frontCampaignView, frontStoryView, frontResultView } from './ui/front.js';
import { createModal } from './ui/modal.js';
import { guideView, operationMenu, commonMessage } from './ui/common.js';
import { battleView, BATTLE_MODES } from './ui/battle.js';
import { territoryView, territoryResultView, bindTerritory } from './ui/territory.js';
import { recruitmentPool, recruitmentView, recruitmentRates, recruitmentCatalog, percentText } from './ui/recruitment.js';

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

/* 스킬의 '틀' 을 딱지로 바꾼다. 설명은 문장이라 훑어지지 않는데, 상대를 보고 고르려면
   무엇이 통하고 무엇이 안 통하는지가 먼저 눈에 들어와야 한다.
   처음 30종의 스킬은 이 다섯 조합뿐이었다. 세트 03(2026-09-21)이 특화기술 여섯을 더했다 — 금빛 테두리 딱지. */
function fxTags(type){
  const sk=(COMBAT_TYPES[type]||{}).skill, f=(sk&&sk.fx)||{}, t=[];
  if(f.hits>1)     t.push(['hit', f.hits+'연격']);
  if(f.noMiss)     t.push(['nom', '회피 불가']);
  if(f.ignoreDef)  t.push(['pen', '방어 관통']);
  if(f.alwaysCrit) t.push(['crt', '확정 치명']);
  if(f.drain)      t.push(['drn', '흡혈']);
  /* 특화기술 */
  if(f.shield)     t.push(['sp fx-shd', '방벽']);
  if(f.repair)     t.push(['sp fx-rep', '수리']);
  if(f.mark)       t.push(['sp fx-mrk', '표적']);
  if(f.shred)      t.push(['sp fx-shr', '장갑 파쇄']);
  if(f.jam)        t.push(['sp fx-jam', '재밍']);
  if(f.execute)    t.push(['sp fx-exe', '마무리']);
  return t.map(x=>`<span class="tag fx-${x[0]}">${x[1]}</span>`).join(' ');
}


/* ------------------------------- 상태/저장 ------------------------------- */
const SAVE_KEY = 'rowar.save.v2';   // v1(로봇 3기 체제)은 로스터가 완전히 달라 호환되지 않는다
let S = null;
function emptySlots(){ return {WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}; }
function freshState(){         // 시작: 커먼 1기, Lv.1 — 나머지 기체는 뽑기로만 얻는다
  const u = uid();
  /* squad 는 이번에 데려갈 기체(최대 CONST.SQUAD_MAX 기)의 uid 목록.
     레벨·경험치는 기체마다 따로다 — 뽑아서 키우는 것이 이 게임의 보상이다. */
  return { v:2, credits:600, cores:12, scrap:30,
    robots:[{uid:u,type:pick(BY_RARITY.C),level:1,exp:0,fat:0,skillLv:0,slots:emptySlots()}],
    parts:[], sel:0, squad:[u], stat:{wins:0,losses:0,pulls:0},
    /* 전선 진행. 칸마다 한 글자다 — 서버의 player.campaign 과 같은 모양(016). */
    campaign:'' };
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
  /* 전선 진행. 옛 저장본에는 없다 — readProgress 가 빈 문자열도 '아직' 으로 읽는다. */
  if(typeof j.campaign !== 'string') j.campaign = '';
  const st = j.stat && typeof j.stat==='object' ? j.stat : {};
  j.stat = { wins:Math.max(0,num(st.wins,0)), losses:Math.max(0,num(st.losses,0)), pulls:Math.max(0,num(st.pulls,0)) };
  const partIds = new Set(j.parts.map(p=>p && p.uid).filter(Boolean));
  for(const rb of j.robots){
    rb.level=clamp(Math.round(num(rb.level,1)),1,MAXLV);
    rb.exp=Math.max(0,Math.round(num(rb.exp,0)));
    if(rb.fat==null && rb.dur!=null) rb.fat = clamp(100-num(rb.dur,100), 0, FAT_MAX);   // 예전 '내구도' 저장본 이관
    delete rb.dur; rb.fat = fatOf(rb); decayFat(rb);      // 껐던 동안의 자연 회복 정산
    rb.skillLv = clamp(Math.round(num(rb.skillLv,0)), 0, CONST.SKILL_UP.max);   // 예전 저장본에는 없다
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
  if(_gateNeedsPull)return;             // 새 계정의 상태를 못 받았다면 이전 계정 자료를 쓰지 않는다
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
const rollPart = level => _rollPart(level, R, uid);
const autoScrap = p => autoScrapValue(p.rarity);
/* 판정 결과 하나를 상태에 반영한다. 서버가 판정한 결과도 같은 함수로 적용하므로
   '누가 굴렸든' 반영 방식은 한 곳뿐이다. */
function applyPull(res){
  if(!res) return null;
  /* 새 기체는 Lv.1 부터다. 키우는 과정이 뽑기의 보상이다. */
  /* uid 는 서버가 실제로 넣은 값을 쓴다. 여기서 새로 만들면 서버 행과 어긋나
     그 기체로는 편성·선택·정비·원정이 전부 'robot not found' 가 된다.
     res.uid 가 없는 것은 서버 없이 굴리는 경로뿐이라 그때만 만든다. */
  if(res.kind==='robot'){ S.robots.push({uid:res.uid||uid(),type:res.type,level:1,exp:0,fat:0,skillLv:0,slots:emptySlots()}); }
  else if(res.kind==='dupe'){ const g=res.gain; S.credits+=g.cr; S.scrap+=g.sc; S.cores+=g.co; }
  else if(res.kind==='core'){ S.cores+=res.n; }
  else if(res.kind==='credit'){ S.credits+=res.cr; }
  else if(res.kind==='part'){ addPart(res.part); }
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
  'max level':'최대 레벨입니다', 'max enhanced':'최대 강화입니다', 'max skill':'최대 강화입니다', 'already serviced':'이미 정비된 상태입니다',
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
  const rb=hangarRobot();
  const r=await srvHangar('equip',{robotUid:rb.uid, slot, partUid}); if(!r) return;
  for(const x of S.robots) for(const sl of SLOTS) if(x.slots[sl]===partUid) x.slots[sl]=null;
  rb.slots[slot]=partUid; commitLocal(); closeModal();
}
async function unequip(slot){
  const rb=hangarRobot();
  const r=await srvHangar('unequip',{robotUid:rb.uid, slot}); if(!r) return;
  rb.slots[slot]=null; commitLocal(); closeModal();
}
/* ── 빌드 프리셋 (5순위 I) ──────────────────────────────
   파츠 조합을 다섯 칸에 저장해 두고 한 번에 바꿔 끼운다. 계정에 붙는다(파츠가 계정 공용이라서).
   저장은 **지금 이 기체가 끼고 있는 것**을 서버가 읽어 적는다. 적용은 장착과 같은 규칙 —
   다른 기체가 끼고 있으면 떼어 오고, 분해해서 없는 파츠는 건너뛴다. */
const presetsNow = () => parsePresets(S.presets);
function presetBar(){
  const list = presetsNow();
  if(!list.some(Boolean)) return '';
  return `<div class="pset-bar">${list.map((x,i)=> x
    ? `<button class="pset-chip" onclick="ROWAR.applyPreset(${i})" title="이 기체에 입히기">${esc(x.n)}</button>` : '').join('')}</div>`;
}
function presetLines(x){
  const chk = presetCheck(x, S.parts);
  return SLOTS.map(sl=>{
    const u = x.s[sl], pt = u && findPart(u, S.parts);
    const v = !u ? '<i class="none">비움</i>'
      : chk.missing.includes(sl) ? '<i class="gone">분해됨 — 건너뜀</i>'
      : `${esc(pt.name)} ${rarTag(pt)}`;
    return `<div class="pset-ln"><b>${SLOT_KO[sl]}</b> ${v}</div>`;
  }).join('');
}
function openPresets(){
  const rb = hangarRobot(), list = presetsNow();
  const T = ROBOT_TYPES[rb.type];
  const rows = list.map((x,i)=>`<div class="pset-row">
      <div class="pset-h"><input class="ainput pset-name" aria-label="프리셋 ${i+1} 이름" id="psn${i}" maxlength="${NAME_MAX}" value="${esc(x ? x.n : `프리셋 ${i+1}`)}">
        ${x ? '' : '<span class="hint">빈 칸</span>'}</div>
      ${x ? `<div class="pset-lns">${presetLines(x)}</div>` : ''}
      <div class="row-btns">
        ${x ? `<button class="btn gold" onclick="ROWAR.applyPreset(${i})">${esc(T.name)}에 입히기</button>` : ''}
        <button class="btn" onclick="ROWAR.savePreset(${i})">${x ? '지금 장착으로 덮어쓰기' : '지금 장착 저장'}</button>
        ${x ? `<button class="btn ghost" onclick="ROWAR.deletePreset(${i})">삭제</button>` : ''}
      </div></div>`).join('');
  openModal(`<div class="mhead">빌드 프리셋 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="hint" style="margin-bottom:10px">지금 <b>${esc(T.name)}</b>이 끼고 있는 파츠를 저장하고, 어느 기체에든 한 번에 입힙니다.
      다른 기체가 끼고 있던 파츠는 떼어 옵니다.</div>
    <div class="pset-list">${rows}</div>`);
}
async function savePreset(i){
  const rb = hangarRobot();
  const name = ($('#psn'+i) || {}).value || '';
  const r = await srvHangar('presetSave', { i, robotUid: rb.uid, name }); if(!r) return;
  S.presets = r.presets; commitLocal(); openPresets();
  toast(`「${r.presets[i].n}」 저장`);
}
async function deletePreset(i){
  const r = await srvHangar('presetDelete', { i }); if(!r) return;
  S.presets = r.presets; commitLocal(); openPresets();
  toast('프리셋을 지웠습니다');
}
async function applyPreset(i){
  const rb = hangarRobot(), x = presetsNow()[i]; if(!x) return;
  const r = await srvHangar('presetApply', { i, robotUid: rb.uid }); if(!r) return;
  /* 서버가 끼운 그대로 받아 적는다 — 다른 기체에서 떼어 온 것까지 */
  for(const [sl,u] of Object.entries(r.applied || {})){
    for(const o of S.robots) for(const s2 of SLOTS) if(o.slots[s2]===u) o.slots[s2]=null;
    rb.slots[sl] = u;
  }
  for(const sl of (r.emptied || [])) rb.slots[sl] = null;
  closeModal(); commitLocal();
  const miss = (r.missing || []).map(sl=>SLOT_KO[sl]);
  toast(`「${x.n}」 입힘` + (miss.length ? ` · ${miss.join('·')} 은(는) 분해되어 건너뜀` : ''));
}

async function scrapPart(u){
  const p=findPart(u,S.parts); if(!p) return;
  const worn = S.robots.some(r=>Object.values(r.slots).includes(u));
  if(worn){ toast('장착 중인 파츠는 분해할 수 없습니다'); return; }
  /* 되돌릴 수 없으므로 한 번 묻는다. 강화한 파츠는 특히 실수하기 쉽다. */
  openModal(`<div class="mhead">파츠 분해 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="pchip ic">${partIco(p)}<div class="pn">${esc(p.name)} ${rarTag(p)}${setTag(p)}${affixTags(p)}</div>
      <div class="ps">${SLOT_KO[p.slot]}${partStatLine(p)}</div></div>
    <div class="hint" style="margin:10px 0;color:var(--bad)">분해하면 되돌릴 수 없습니다.</div>
    <div class="row-btns">
      <button class="btn big gold" onclick="ROWAR.doScrap('${u}')">분해 · 스크랩 +${fmt(scrapGain(p.rarity,p.enh))}</button>
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

/* ── 등급별 일괄 분해 ──────────────────────────────────────
   하나씩 누르는 것이 일이 되는 지점이 온다(파츠 수백 개). 등급을 골라 한 번에 치운다.

   되돌릴 수 없고 한 번에 수십 개가 사라지므로 **무엇이 사라지는지 세어서 보여 준다.**
   등급마다 개수와 받을 스크랩을 미리 적고, 누르는 순간이 아니라 그 앞에서 판단하게 한다.

   **강화한 것은 기본으로 남긴다.** 스크랩을 부어 둔 파츠를 등급이 낮다는 이유로 한 번에
   날리는 것이 이 기능의 가장 큰 사고다. 켜고 끌 수 있게 두되 기본값은 지키는 쪽이다. */
let bulkKeepEnh = true;
function invSpare(){ return S.parts.filter(p=> !S.robots.some(r=>Object.values(r.slots).includes(p.uid))); }
function bulkHit(rar){ return invSpare().filter(p=> p.rarity===rar && !(bulkKeepEnh && (p.enh|0)>0)); }

function bulkScrap(){
  const rows = RARITY.map(r=>r.k).map(k=>{
    const hit=bulkHit(k), gain=hit.reduce((t,p)=>t+scrapGain(p.rarity,p.enh),0);
    const held=invSpare().filter(p=>p.rarity===k).length, kept=held-hit.length;
    return `<div class="bulkrow">
      <div><span class="tag rar-${k}">${k}</span>
        <b>${hit.length}개</b>${kept?` <span class="dim">· 강화 ${kept}개 남김</span>`:''}</div>
      <button class="btn ${hit.length?'gold':''}" ${hit.length?'':'disabled'}
        onclick="ROWAR.doBulkScrap('${k}',${hit.length})">분해 +${fmt(gain)}</button></div>`;
  }).join('');
  openModal(`<div class="mhead">등급별 일괄 분해 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="hint">장착 중인 파츠는 세지 않습니다.</div>
    <label class="bulkchk"><input id="bulk-keep-enh" type="checkbox" ${bulkKeepEnh?'checked':''}
      onchange="ROWAR.setBulkKeepEnh(this.checked)"> 강화한 파츠는 남기기</label>
    ${rows}
    <div class="hint" style="margin-top:10px;color:var(--bad)">분해하면 되돌릴 수 없습니다.</div>
    <div class="row-btns"><button class="btn big" onclick="ROWAR.closeModal()">닫기</button></div>`);
}
const setBulkKeepEnh = v => { bulkKeepEnh=!!v; bulkScrap(); };

async function doBulkScrap(rar, expect){
  closeModal();
  /* expect 를 같이 보낸다. 화면이 센 수와 서버가 셀 수가 다르면(다른 창에서 장비를
     바꿨거나 한 경우) 서버가 아무것도 안 하고 되돌려 준다 — 조용히 다른 것을 지우지 않는다. */
  const r=await srvHangar('scrapBulk',{rarity:rar, keepEnhanced:bulkKeepEnh, expect}); if(!r) return;
  if(!r.count){ toast('분해할 파츠가 없습니다'); return; }
  const gone=new Set(r.removed);
  S.parts=S.parts.filter(p=>!gone.has(p.uid)); S.scrap=r.scrap;
  commitLocal(); renderWallet(); renderHangar();
  toast(`${rar} ${r.count}개 분해 · 스크랩 +${fmt(r.gain)}`);
}

/* 스킬 강화. 성공 판정은 서버가 한다 — 클라가 굴리면 될 때까지 다시 보내면 그만이다.
   실패해도 재화는 나가므로, 결과를 분명히 알려 준다. */
async function skillUp(){
  const rb=hangarRobot(); if(!rb) return;
  const slv=rb.skillLv|0;
  if(slv>=skillMax()){ toast('최대 강화입니다'); return; }
  const r=await srvHangar('skillup',{robotUid:rb.uid}); if(!r) return;
  rb.skillLv=r.skillLv; S.credits=r.credits; S.scrap=r.scrap;
  commitLocal(); renderWallet(); renderHangar();
  toast(r.success ? `스킬 강화 성공 · +${r.skillLv}` : `강화 실패 · +${r.skillLv} 그대로 (성공률 ${Math.round(r.rate*100)}%)`);
}

async function enhancePart(u){
  const p=findPart(u,S.parts); if(!p) return;
  const was=p.enh|0;
  const r=await srvHangar('enhance',{partUid:u}); if(!r) return;
  p.enh=r.enh; S.scrap=r.scrap; commitLocal();
  /* 실패해도 단계는 그대로다. 그래도 **말은 해 줘야 한다** — 스크랩만 줄고 아무 말이
     없으면 눌린 건지 아닌지 모른다. 다음 확률을 같이 적어 다시 누를지 고르게 한다. */
  if(r.failed) toast(`${p.name} 강화 실패 · 스크랩 −${fmt(r.cost)} (다음도 ${Math.round(enhRate(was)*100)}%)`);
  else toast(`${p.name} +${p.enh}`);
}
async function service(){
  const rb=hangarRobot();
  const r=await srvHangar('service',{robotUid:rb.uid}); if(!r) return;
  S.credits=r.credits; rb.fat=0; rb.fatAt=Date.now(); commitLocal();
  toast(ROBOT_TYPES[rb.type].name+' 정비 완료');
}
async function levelUp(){
  const rb=hangarRobot();
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
/* 점령전에서만 배경에 그 칸의 지형 그림을 깐다.
   지도 카드(.tnode)는 이미 지형 그림을 쓰는데, 정작 들어가서 싸우는 화면은
   어느 칸이든 같은 야간작전 배경이었다 — 칸을 고른 것이 화면에 남지 않았다.
   씬이 바뀔 때마다 같이 붙였다 떼므로 다른 화면으로 새지 않는다. */
let _sceneTerrain = null;
function setScene(name){
  document.body.dataset.scene = name;
  if(_sceneTerrain) document.body.dataset.terrain = _sceneTerrain;
  else delete document.body.dataset.terrain;
}
function setTerrain(t){ _sceneTerrain = t || null; setScene(document.body.dataset.scene || 'hangar'); }
/* 대전 화면을 앞으로 꺼낸다. go('battle') 과 달리 **다시 그리지 않는다** —
   대전은 자체 흐름(찾기 → 발견 → 아레나 → 결과)이라, 여기서 renderBattleHome 을 부르면
   방금 만든 화면이 날아간다. bg 를 주면 배경만 따로 바꾼다(재생 중에는 콕핏 배경).

   예전에는 이 자리에서 setScene() 만 불렀는데 그건 **배경만** 바꾼다. 대전 탭에서
   들어오면 sc-battle 이 이미 active 라 우연히 동작했지만, 토벌 탭에서 누르면
   sc-hunt 가 active 인 채여서 상대 카드가 '보이지 않는 화면 뒤'에 그려졌다.
   '토벌이 눌리기만 하고 아무 일도 안 일어난다'의 정체가 이것이다. */
function toBattle(bg, navAs){
  if(cur!=='battle') window.scrollTo({top:0,left:0,behavior:'instant'});
  const returnBar=$('#ui-return'); if(returnBar) returnBar.hidden=true;
  cur = 'battle';
  setScene(bg || 'battle');
  document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active', s.id==='sc-battle'));
  /* 탭 표시는 **어디서 들어왔는지**를 가리켜야 한다. 전선의 대사와 전투는 이 화면을
     빌려 쓸 뿐인데, 그대로 두면 새 계정의 첫 화면이 '대전' 을 가리킨다 —
     아직 열리지도 않은 탭이다. navAs 를 주면 그 탭에 불이 남는다. */
  const lit = navAs || 'battle';
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active', b.dataset.s===lit));
  document.querySelector('.nav-more')?.classList.toggle('active',['gacha','hunt','trial','rank'].includes(lit));
}
/* 격납고를 떠나면 '새 파츠' 표를 지운다 — 인벤토리를 볼 기회가 한 번 있었다는 뜻이다.
   계속 반짝이게 두면 그 반짝임이 곧 배경이 되어 아무것도 알려 주지 못한다. */
function go(scr){ if(!['home','hangar','gacha','battle','rank','trial','hunt','terr'].includes(scr)) return;
  stopScript();
  if(scr!==cur) window.scrollTo({top:0,left:0,behavior:'instant'});
  if(scr!=='rank') ++_rankEpoch;
  ++_challengeEpoch;
  if(cur==='hangar' && scr!=='hangar') seenFresh();
  if(scr!=='terr') _terrRequest++;
  _battleRequest++; // Invalidate a pending opponent search, even on battle -> battle.
  const returnBar=$('#ui-return'); if(returnBar) returnBar.hidden=!(scr==='hangar' && _returnToTerritory);
  cur=scr; _sceneTerrain=null; setScene(scr); document.querySelectorAll('.screen').forEach(s=>s.classList.toggle('active',s.id==='sc-'+scr));
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.s===scr));
  renderWallet();
  document.querySelector('.nav-more')?.classList.toggle('active',['gacha','hunt','trial','rank'].includes(scr));
  if(scr==='home') renderHome();
  else if(scr==='hangar') renderHangar();
  else if(scr==='gacha') renderGacha();
  else if(scr==='battle') renderBattleHome();     // 대전은 여기서만 처음부터 그린다
  else if(scr==='rank') renderRank();
  else if(scr==='trial') renderTrial();
  else if(scr==='hunt') renderHunt();
  else if(scr==='terr') renderTerrHome(); }
function uiGo(scr){closeModal();go(scr);}
function uiMore(){openModal(operationMenu());}

function renderHome(){
  const rb=selRobot()||S.robots[0], t=ROBOT_TYPES[rb.type];
  const p=livePending();
  $('#sc-home').innerHTML=`<div class="ui-pagehead"><div><span class="ui-eyebrow">COMMAND CENTER</span><h1>지휘실</h1><p>다음 전장은 당신의 선택에서 시작됩니다.</p></div><button class="ui-text-button" onclick="ROWAR.guide()">${icon('help')} 작전 안내</button></div>
  <div class="ui-home"><section class="ui-surface ui-home-unit"><div class="ui-section-label">선봉 기체 <small>VANGUARD</small></div><div class="sprite" data-t="${t.rarity}">${sprite(rb.type,false)}</div><h2>${esc(t.name)}</h2><p>Lv.${rb.level} · ${esc(t.role||'')} · ${t.rarity}</p><p>전투력 ${fmt(power(rb))}</p><button class="btn" onclick="ROWAR.go('hangar')">기체 정비 ${icon('chevron')}</button></section>
  <section class="ui-surface ui-home-map"><span class="ui-eyebrow">YOUR NEXT OBJECTIVE</span><h2>전장을 지배할<br>다음 한 수.</h2><p>기체를 정비하고, 방어선을 돌파하세요.<br>확보한 거점이 새로운 전력을 만듭니다.</p><button class="btn ui-primary" onclick="ROWAR.enterTerritory()">작전 지도 열기 ${icon('arrow')}</button></section>
  <section class="ui-surface ui-home-brief"><h3>작전 브리핑</h3><button onclick="ROWAR.enterFront()">${icon('battle')}<span><b>전선 이어하기</b><small>지휘관의 다음 이야기를 확인하세요</small></span></button><button onclick="ROWAR.go('hunt')">${icon('clock')}<span><b>원정 현황</b><small>${S.expd?(S.expd.endsAt>Date.now()?'귀환까지 '+dur(S.expd.endsAt-Date.now()):'귀환 완료 · 보상 수령 가능'):'기체를 보내 성장 재료를 확보하세요'}</small></span></button><button onclick="ROWAR.enterTerritory()">${icon('terr')}<span><b>점령 현황</b><small>${p?p.mine+'개 거점 · 크레딧 '+fmt(p.cr)+' 누적':'세계 지도를 열어 거점을 확인하세요'}</small></span></button><button onclick="ROWAR.go('trial')">${icon('rank')}<span><b>이번 주의 도전</b><small>주간 시련 · 공동 보스 레이드</small></span></button></section></div>
  <div class="ui-shortcuts">${[['hangar','격납고','나만의 전력을 완성한다','backgrounds/hangar'],['gacha','뽑기','새로운 기체와 파츠를 만난다','backgrounds/gacha'],['battle','대전','상대를 읽고 전술을 선택한다','backgrounds/battle-industrial-ruins'],['hunt','파견','더 강한 내일을 준비한다','terrain/furnace']].map(([id,name,desc,art])=>`<button style="background-image:url('assets/${art}.webp')" onclick="ROWAR.go('${id}')"><b>${name}</b><span>${desc}</span></button>`).join('')}</div>`;
}

/* 하단 티커 — 시간이 흐르는 것들만 모아 늘 보이게 한다.
   화면을 옮겨 다니지 않아도 '지금 무엇이 익어 가는지' 알 수 있어야 한다.
   **서버에 묻지 않는다** — 원정은 저장본, 점령은 지도 캐시, 피로는 계산이라
   이미 들고 있는 값뿐이다. 요청 수가 곧 무료 한도인 구조라 그렇다. */
/* 티커 전용 시계. dur() 은 '3시간 20분' 처럼 읽기 좋게 뭉치는데, 티커에 그걸 쓰면
   1초마다 다시 그려도 몇 분 동안 같은 글자라 **멈춰 있는 것처럼 보인다.** 초까지 센다. */
function clock(ms){
  let s=Math.max(0,Math.floor(ms/1000));
  const h=Math.floor(s/3600); s-=h*3600;
  const m=Math.floor(s/60);   s-=m*60;
  const p=n=>String(n).padStart(2,'0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
/* 지금 이 순간의 점령 수입. 서버가 준 것은 지도를 받아 온 '그때' 의 값이라,
   그대로 두면 1분(TERR_TTL)마다 계단으로 뛴다. 서버가 준 누적 시간(income.h)에
   **받아 온 뒤 흐른 시간만** 더한다 — 기준을 서버에 두고 증분만 클라가 세므로
   시계가 어긋나도 값이 튀지 않는다. 계산식은 서버 pendingIncome 과 같다. */
function livePending(){
  if(!_terr || !_terr.nodes) return null;
  const el=Date.now()-_terrAt, cap=CONST.TERR.INCOME_CAP_H;
  let cr=0, sc=0, core=0, full=true, mine=0;
  for(const n of _terr.nodes){
    if(n.owner!=='me') continue;
    mine++;
    const d=NODE_BY[n.id];
    if(!d || !n.income){ full=false; continue; }   // 알 수 없으면 '가득' 이라고 말하지 않는다
    const h=Math.min(cap, (n.income.h||0)+el/3600000);
    if(h<cap) full=false;
    cr+=Math.floor((d.crH||0)*h); sc+=Math.floor((d.scH||0)*h); core+=Math.floor((d.coreH||0)*h);
  }
  return { mine, cr, sc, core, full:mine>0&&full };
}

let _tickHtml='';
function renderTicker(){
  const el=$('#ticker'); if(!el) return;
  const rb=selRobot(), out=[];

  if(S.expd){
    const left=S.expd.endsAt-Date.now();
    out.push(left>0 ? `<div class="tk"><i class="dot b"></i>원정 귀환까지 <b>${clock(left)}</b></div>`
                    : `<div class="tk"><i class="dot g"></i><b>원정 귀환 완료</b> · 파견에서 받으세요</div>`);
  }
  const p=livePending();
  if(p && p.mine) out.push(`<div class="tk"><i class="dot y"></i>점령지 <b>${p.mine}칸</b>${
    (p.cr||p.sc||p.core)?` · 쌓인 수입 <b>${fmt(p.cr)}</b>`:''}${
    p.full?` <span class="warn">가득 — 받아 가세요</span>`:''}</div>`);
  const fat=rb?fatOf(rb):0;
  out.push(fat
    ? `<div class="tk"><i class="dot g"></i>${ROBOT_TYPES[rb.type].name} 피로 <b>${fat}</b> · 다음 회복까지 <b>${clock(fatNextMs(rb))}</b></div>`
    : `<div class="tk"><i class="dot g"></i>편성 기체 <b>피로 없음</b></div>`);
  if(!net.state.online) out.push(`<div class="tk off">서버에 연결되지 않았습니다</div>`);

  const html = out.join('') + '<div class="sp"></div>'
    + `<div class="tk off">전적 ${S.stat.wins}승 ${S.stat.losses}패</div>`
    + `<div class="tk off">${net.state.online ? '진행 상황은 서버에 저장됩니다' : '진행은 이 브라우저에 저장됩니다'}</div>`;
  /* 1초마다 불리므로 달라진 게 없으면 DOM 을 건드리지 않는다. 움직일 것이 하나도
     없는 계정에서는 문자열 하나 만드는 것이 전부다. */
  if(html===_tickHtml) return;
  _tickHtml=html; el.innerHTML=html;
}

/* 재화가 움직이는 자리마다 불린다 — 새 파츠 점도 여기에 얹는다.
   파츠를 얻는 다섯 길(뽑기·대전·파견·점령·합성)이 전부 이 함수를 지난다. */
function renderWallet(){ $('#w-credit').textContent=fmt(S.credits); $('#w-core').textContent=fmt(S.cores); $('#w-scrap').textContent=fmt(S.scrap); navDot(); renderTicker(); }
/* 대전 화면은 자체 흐름(상대 찾기 → 발견 → 아레나 → 결과)을 갖는다.
   여기서 renderBattleHome() 을 부르면 재생 중인 전투나 방금 뜬 결과 화면이 날아간다.
   그래서 renderAll 은 대전 화면을 건드리지 않는다. 대전 화면은 go() 가 그린다. */
function renderAll(){ renderWallet(); if(cur==='home')renderHome(); else if(cur==='hangar')renderHangar(); else if(cur==='gacha')renderGacha(); else if(cur==='terr')renderTerrHome(); else if(cur==='hunt')renderHunt(); else if(cur==='rank')renderRank(); }
const modalController=createModal($('#modal'));
function openModal(html){shield();modalController.open(html);}
function closeModal(){modalController.close();}

function rarTag(p){ return `<span class="tag rar-${p.rarity}">${p.rarity}${p.enh?` +${p.enh}`:''}</span>`; }
/* 파츠 그림 — assets/parts/<베이스>.png (128×128 투명, assets/parts/README.md).
   **등급은 그림에 없다** — 테두리 색으로 친다(.pico.r-SR). 그래서 84장이 아니라 21장이다.
   베이스 그림이 없으면(베이스가 없는 옛 저장본, 그림이 아직 없는 새 베이스) 슬롯 그림으로 떨어진다.
   크기 — xs 22 (글줄 안) · sm 38 (목록 칩) · md 56 (장착 칸·상점) · lg 120 (뽑기·합성 결과) */
const PART_ICON_V = '?v=20260919';
const slotIconSrc = sl => `assets/parts/slot-${String(sl || 'weapon').toLowerCase()}.png${PART_ICON_V}`;
function partIco(p, size){
  const sl = p && p.slot;
  const src = p && p.base ? `assets/parts/${p.base}.png${PART_ICON_V}` : slotIconSrc(sl);
  return `<span class="pico ${size || 'sm'}${p && p.rarity ? ' r-' + p.rarity : ''}"><img src="${src}" alt="" decoding="async"
    onerror="this.onerror=null;this.src='${slotIconSrc(sl)}'"></span>`;
}
/* 빈 칸 — 슬롯 그림을 흐리게. 무엇을 끼우는 칸인지 글자 없이 읽힌다 */
const slotIco = (sl, size) => `<span class="pico ${size || 'sm'} vac"><img src="${slotIconSrc(sl)}" alt="" decoding="async"></span>`;
/* 계열 딱지. 계열은 파츠 이름에서 나오므로 이미 가진 파츠에도 그대로 붙는다.
   이것이 안 보이면 세트는 '우연히 걸리는 것' 이 되어 모으는 재미가 생기지 않는다. */
function setTag(p){ const k=setKeyOf(p); if(!k) return '';
  const S=CONST.PART_SET[k]; return `<span class="tag set-${k}">${S.ko}</span>`; }
/* 강화 단계 — 숫자를 읽지 않아도 한눈에 보이게 테두리를 바꾼다.
   0~4 그대로 · 5~8 조금 두껍게 · 9 이상 은은하게 돈다.
   (최대는 CONST.ENH_MAX. 지금 10 이고, 늘리면 아래 기준도 같이 봐야 한다) */
const enhClass = p => { const e=p.enh|0; return e>=9?' enh-hi':(e>=5?' enh-mid':''); };

/* 세트 현황 — 몇 개 모았고 무엇이 걸렸는지. 진행 중인 계열까지 보여 준다.
   '2/4' 를 봐야 '하나만 더 맞추면' 이라는 다음 목표가 생긴다. */
const BONUS_KO = { hp:'체력', atk:'공격력', def:'방어력', spd:'속도', crit:'치명타', eva:'회피', spread:'공격 구간' };
/* 세트 보너스는 1.5% · 2.5%p 처럼 소수 자리가 뜻을 갖는다. 반올림해 버리면
   1.5% 가 '+1%', 2.5%p 가 '+3%p' 로 나와 화면이 값과 다른 말을 한다.
   소수 첫째 자리까지 적되 .0 은 떼어 '+5%' 처럼 깔끔하게 둔다. */
const pctText = d => { const t=(Math.abs(d)<10 ? d.toFixed(1) : d.toFixed(0)).replace(/\.0$/,'');
  return (d>=0?'+':'')+t; };
function bonusText(b){
  const out=[];
  if(b.mul) for(const k in b.mul) out.push(`${BONUS_KO[k]||k} ${pctText((b.mul[k]-1)*100)}%`);
  if(b.add) for(const k in b.add) out.push(`${BONUS_KO[k]||k} ${pctText(b.add[k]*100)}%p`);
  return out.join(' · ');
}
function setPanel(rb){
  if(!CONST.PART_SET) return '';
  const cnt=setCounts(rb, S.parts);
  const keys=Object.keys(cnt).filter(k=>cnt[k]>0);
  if(!keys.length) return `<div class="setbox none">세트 없음 <small>같은 계열 파츠를 2개 맞추면 효과가 붙습니다</small></div>`;
  return `<div class="setbox">${keys.map(k=>{
    const S2=CONST.PART_SET[k], n=cnt[k];
    return `<div class="setrow">
      <span class="tag set-${k}">${S2.ko}</span><b class="setn">${n}/4</b>
      ${[2,4].map(t=>{ const on=n>=t, b=S2['p'+t];
        return b?`<span class="setb${on?' on':''}">${t}세트 ${bonusText(b)}</span>`:''; }).join('')}
    </div>`; }).join('')}</div>`;
}
/* 파츠 한 줄. 세 가지를 다르게 보여 준다.
     상승  그대로
     대가  붉게 (−) — 이 파츠를 낄지 말지의 근거
     구간  금색 (±) — 좋고 나쁨이 아니라 성향이다. 약자는 넓히고 강자는 좁힌다. */
/* 옵션은 한 줄에 하나씩 적는다. 페널티를 빨간 취소선으로 두었더니 '적용되지 않는
   옵션'처럼 보였다. 색과 취소선을 빼고 부호(+/−)로만 구분한다 — 구간도 같은 색이다. */
/* 파츠 한 개의 옵션 줄.

   `compact` 는 인벤토리용이다. 파츠 개편으로 한 파츠가 스탯 5~7개에 구간·고유 효과까지
   달게 되면서, 한 줄에 하나씩 쌓으면 칩 하나가 **300px** 이 됐다(실측). 파츠 300개면
   14화면을 긁어야 한다. 인벤토리에서 하는 일은 '어느 것을 버릴까' 라서 숫자를 정독하지
   않는다 — 가로로 이어 붙여 한 줄로 만든다.

   대신 **고유 효과는 압축해도 줄을 지킨다.** 그건 수치가 아니라 전투 규칙이라
   `공격 +79` 옆에 붙여 놓으면 같은 종류로 읽힌다.

   정독하는 자리(장착 슬롯 고르기)는 `compact` 없이 부른다 — 거기서는 비교가 일이다. */
function partStatLine(p, compact){
  const ps=partStat(p), out=[];
  for(const k in ps){
    const v=ps[k], t=isPct(k)?(Math.abs(v)*100).toFixed(1)+'%':String(Math.abs(Math.round(v)));
    /* 반올림해서 0 이 되는 것은 아예 안 적는다. 베이스의 대가와 인챈트의 상승이
       서로 지워지면 '속도 +0' 같은 줄이 생기는데, 없는 옵션을 있는 것처럼 보이게 한다. */
    if(t==='0' || t==='0.0%') continue;
    const name = k==='spread' ? '구간' : STAT_LABEL[k];
    out.push({ neg:v<0, s:`${name} ${v<0?'−':'+'}${t}` });
  }
  /* 새 파츠의 구간은 더하기가 아니라 곱하기라 '±몇 %' 로 적으면 거짓말이 된다.
     좁히는지 넓히는지를 말로 붙인다 — ×0.86 만 보고 좋은지 나쁜지 알기 어렵다. */
  const m=partMods(p);
  if(m.range!==1) out.push({ neg:false,
    s:`구간 ×${m.range.toFixed(2)} <span class="dim">(${m.range<1?'좁아짐':'넓어짐'})</span>` });
  const fx = fxLines(m.fx);
  if(compact){
    const line = out.map(o=>`<span class="st${o.neg?' neg':''}">${o.s}</span>`).join('<i class="sep">·</i>');
    return `<div class="pstat inline">${line}</div>`
         + fx.map(t=>`<div class="pstat fxline">${t}</div>`).join('');
  }
  return out.map(o=>`<div class="pstat">${o.s}</div>`).join('')
       + fx.map(t=>`<div class="pstat fxline">${t}</div>`).join(''); }

/* 고유 효과는 수치가 아니라 **전투 규칙**이다. '관통 +8' 처럼 스탯과 같은 모양으로
   적으면 다른 옵션과 더해지는 값처럼 보인다. 언제 무엇이 일어나는지를 문장으로 적는다. */
function fxLines(fx){
  const o=[];
  if(fx.pen)      o.push(`타격 ${(fx.pen*100).toFixed(0)}% 확률로 방어 ${((fx.penAmt!=null?fx.penAmt:0.5)*100).toFixed(0)}% 무시`);
  if(fx.stackSpd) o.push(`때릴수록 느려짐 — 최대 −${(Math.abs(fx.stackSpd)*(fx.stackMax||0)*100).toFixed(0)}%`);
  if(fx.regen)    o.push(`회피한 다음 턴에 내구 ${(fx.regen*100).toFixed(1)}% 회복`);
  return o; }

/* 인챈트 딱지. 티어를 로마자 그대로 둔다 — I~IV 넉 칸이라 숫자로 바꿔 봐야 더 읽기
   쉬워지지 않고, 같은 [고속] 이라도 티어가 다르면 다른 물건이라는 것이 바로 보인다.
   옛 파츠는 인챈트가 없으므로 아무것도 안 나온다. */
function affixTags(p){
  if(!p || !Array.isArray(p.affixes) || !p.affixes.length) return '';
  return p.affixes.map(a=>{ const A=AFFIXES[a.id];
    return A ? `<span class="tag aff aff-${a.tier}">${A.ko} ${a.tier}</span>` : ''; }).join(''); }
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

/* ── 새로 얻은 파츠 ────────────────────────────────────────────
   파츠는 뽑기·대전·파견·점령·합성 다섯 군데서 들어온다. 인벤토리는 수백 개짜리
   격자라, 그 안에서 **무엇이 방금 늘었는지**가 안 보이면 새 파츠는 사실상 없는 것이
   된다(정렬을 '최신' 으로 바꿔 놓고 있어야만 보였다).

   그래서 들어오는 길을 `addPart` 하나로 모으고, 거기서 표를 남긴다.
   표는 **서버에 보내지 않는다** — '내가 봤는가' 는 이 브라우저의 사정이지 계정의
   상태가 아니다. 격납고를 떠날 때 지운다. 인벤토리를 한 번 본 뒤에도 계속 반짝이면
   그 반짝임은 곧 배경이 된다. */
const NEW_KEY = 'rowar.new.v1';
let _fresh = new Set();
try{ _fresh = new Set(JSON.parse(localStorage.getItem(NEW_KEY) || '[]')); }catch(e){}
const saveFresh = () => { try{ localStorage.setItem(NEW_KEY, JSON.stringify([..._fresh])); }catch(e){} };
/* 파츠가 상태에 들어오는 **유일한 문**. 여기를 지나지 않으면 새 표가 안 붙는다. */
function addPart(p){ if(!p) return p; S.parts.push(p); _fresh.add(p.uid); saveFresh(); return p; }
const isFresh = u => _fresh.has(u);
const freshCount = () => S.parts.reduce((n,p)=> n + (_fresh.has(p.uid)?1:0), 0);
/* 분해·합성으로 사라진 uid 가 표에 남으면 개수가 영영 안 맞는다. */
function pruneFresh(){
  if(!_fresh.size) return;
  const have = new Set(S.parts.map(p=>p.uid));
  let cut = false;
  for(const u of [..._fresh]) if(!have.has(u)){ _fresh.delete(u); cut = true; }
  if(cut) saveFresh();
}
function seenFresh(){ if(_fresh.size){ _fresh.clear(); saveFresh(); navDot(); } }
const freshTag = u => isFresh(u) ? '<span class="tag newt">NEW</span>' : '';
/* 격납고 탭에 점을 찍는다 — 다른 화면에서 파츠를 얻어도 어디로 가야 할지 보인다. */
function navDot(){
  const b = document.querySelector('.nav button[data-s="hangar"]');
  if(b) b.classList.toggle('hasnew', freshCount() > 0);
}

/* ── 인벤토리 거르기·정렬 ──────────────────────────────────────
   파츠가 수백 개가 되면 '전부 한 줄로 늘어놓기' 가 성립하지 않는다.
   저장하지 않는다 — 화면을 떠났다 오면 전체로 돌아온다. 걸러 둔 것을 잊고
   "파츠가 사라졌다" 고 여기는 것이 거르기를 못 쓰는 것보다 나쁘다. */
const INV_PAGE = 60;
const invF = { slot:'', rar:'', fresh:'', sort:'new', limit:INV_PAGE };
const RAR_ORDER = { C:0, R:1, SR:2, SSR:3 };
const invMatch = p => (!invF.slot || p.slot===invF.slot) && (!invF.rar || p.rarity===invF.rar)
  && (!invF.fresh || isFresh(p.uid));
function sortInv(list){
  const a=[...list];
  if(invF.sort==='rar') a.sort((x,y)=> (RAR_ORDER[y.rarity]-RAR_ORDER[x.rarity]) || (y.enh|0)-(x.enh|0));
  else if(invF.sort==='enh') a.sort((x,y)=> ((y.enh|0)-(x.enh|0)) || (RAR_ORDER[y.rarity]-RAR_ORDER[x.rarity]));
  else a.reverse();                       /* 최신 — S.parts 는 얻은 순서다 */
  return a;
}
/* 거르개를 건드리면 몇 개까지 보고 있었는지는 잊는다. 무장으로 좁혀 놓고
   '60개 더 보기' 를 그대로 물려받으면 몇 개가 남았는지 감이 안 온다. */
function setInvF(k,v){
  invF[k]= invF[k]===v && k!=='sort' ? '' : v;
  invF.limit=INV_PAGE; renderHangar();
}
const invMore = () => { invF.limit += INV_PAGE; renderHangar(); };

/* 거르개. 같은 칸을 다시 누르면 풀린다 — 끄는 법을 따로 찾게 만들지 않는다.
   숫자를 칸마다 적어 둔다. 눌러 보고 0 개인 것을 아는 것과 누르기 전에 아는 것은 다르다. */
function invBar(all){
  const n = f => all.filter(f).length;
  const chip = (k,v,label,cnt)=>`<button class="fchip${invF[k]===v?' on':''}"
      onclick="ROWAR.setInvF('${k}','${v}')">${label}${cnt!=null?`<small>${cnt}</small>`:''}</button>`;
  const slots = SLOTS.map(s=>chip('slot',s,SLOT_KO[s],n(p=>p.slot===s))).join('');
  const rars  = RARITY.map(r=>r.k).filter(k=>n(p=>p.rarity===k))
                  .map(k=>`<button class="fchip rar-${k}${invF.rar===k?' on':''}"
                      onclick="ROWAR.setInvF('rar','${k}')">${k}<small>${n(p=>p.rarity===k)}</small></button>`).join('');
  const sorts = [['new','최신'],['rar','등급'],['enh','강화']]
                  .map(([v,l])=>`<button class="fchip${invF.sort===v?' on':''}"
                      onclick="ROWAR.setInvF('sort','${v}')">${l}</button>`).join('');
  /* 새것 거르개는 새 파츠가 있을 때만 나온다. 늘 있으면 0 개짜리 칸이 하나 더 는다. */
  const nf = freshCount();
  const freshChip = nf ? `<div class="fgrp"><button class="fchip newf${invF.fresh?' on':''}"
      onclick="ROWAR.setInvF('fresh','1')">새것<small>${nf}</small></button></div>` : '';
  return `<div class="invbar">
    ${freshChip}
    <div class="fgrp">${slots}</div>
    <div class="fgrp">${rars}</div>
    <div class="fgrp"><span class="flab">정렬</span>${sorts}</div>
    <button class="btn bulkb" ${all.length?'':'disabled'} onclick="ROWAR.bulkScrap()">등급별 일괄 분해</button>
  </div>`;
}

/* ------------------------------- 격납고 화면 ------------------------------- */
/* Inspection is local UI state. S.sel remains the server-backed battle vanguard. */
let hangarUid=null, hangarTab='info', hangarSort='power', hangarInventory=false;
function hangarRobot(){return S.robots.find(r=>r.uid===hangarUid)||selRobot();}
function inspectRobot(i){
  if(!S.robots[i]) return;
  hangarUid=S.robots[i].uid; renderHangar();
}
function cycleHangar(dir){
  const i=S.robots.indexOf(hangarRobot());
  inspectRobot((i+dir+S.robots.length)%S.robots.length);
}
function setHangarTab(tab){
  if(!['info','gear','tune'].includes(tab))return;
  hangarTab=tab;renderHangar();
  if(matchMedia('(max-width:700px)').matches)$('#hv-dock')?.scrollIntoView({block:'start'});
  $('#hv-tab-'+tab)?.focus({preventScroll:true});
}
function setHangarSort(value){hangarSort=['power','level','rarity'].includes(value)?value:'power';renderHangar();$('#sc-hangar select')?.focus({preventScroll:true});}
function openHangarInventory(){
  hangarInventory=true;renderHangar();$('#hv-inventory')?.scrollIntoView({block:'start'});
}
function renderHangar(){
  const rosterScroll=$('.hv-roster-list')?.scrollTop||0;
  pruneFresh(); navDot();
  const rb=hangarRobot(), T=ROBOT_TYPES[rb.type], st=computeStats(rb), ri=S.robots.indexOf(rb);
  const lead=selRobot();
  const status=r=>S.expd?.uid===r.uid?'원정 중':r.uid===lead.uid?'선봉':S.squad.includes(r.uid)?'예비':'대기';
  const rank={C:0,UC:1,R:2,UQ:3,EP:4};
  const sorted=S.robots.map((r,i)=>({r,i})).sort((a,b)=>hangarSort==='level'?b.r.level-a.r.level:hangarSort==='rarity'?rank[rarOf(b.r.type)]-rank[rarOf(a.r.type)]:power(b.r)-power(a.r));
  const roster=sorted.map(({r,i})=>`<button class="hv-unit ${r.uid===rb.uid?'selected':''}" aria-pressed="${r.uid===rb.uid}" onclick="ROWAR.inspectRobot(${i})" data-robot="${esc(r.uid)}">
    <span class="hv-unit-art">${sprite(r.type,false)}</span><span class="hv-unit-copy"><small>Lv.${r.level} <em>${status(r)}</em></small><b>${esc(ROBOT_TYPES[r.type].name)}</b><span>전투력 ${fmt(power(r))}</span></span><strong class="rr-${rarOf(r.type)}">${rarOf(r.type)}</strong></button>`).join('');
  const thumbstrip=S.robots.map((r,i)=>`<button class="hv-thumb ${r.uid===rb.uid?'selected':''}" onclick="ROWAR.inspectRobot(${i})" aria-label="${esc(ROBOT_TYPES[r.type].name)} 살펴보기" aria-pressed="${r.uid===rb.uid}">${sprite(r.type,false)}<small>${status(r)}</small></button>`).join('');
  const slotsHtml=SLOTS.map(slot=>{const p=findPart(rb.slots[slot],S.parts);return `<button class="hv-slot ${p?'filled':''}" onclick="ROWAR.openSlot('${slot}')" aria-label="${SLOT_KO[slot]} ${p?esc(p.name):'빈 슬롯'} 장비 변경">
    <span class="hv-slot-icon">${p?partIco(p,'sm'):slotIco(slot,'sm')}</span><span class="hv-slot-kind">${SLOT_KO[slot]}</span><span class="hv-slot-copy"><b>${p?esc(p.name):'장착할 파츠 선택'}</b><small>${p?`${p.rarity} · 강화 +${p.enh||0}`:'비어 있음'}</small></span>${icon('chevron')}</button>`;}).join('');
  const invAll = S.parts.filter(p=> !S.robots.some(r=>Object.values(r.slots).includes(p.uid)));
  /* 다 그리지 않는다. 칩 폭을 어떻게 잡아도 300개는 1만 픽셀이 넘고(실측), 그만한 DOM 을
     매 렌더마다 새로 만든다. 거르개·정렬이 있으니 찾는 것은 앞쪽에 오게 만들 수 있다. */
  const invHit = sortInv(invAll.filter(invMatch));
  const invParts = invHit.slice(0, invF.limit);
  /* 뽑기가 더 이상 일반 파츠를 자동으로 없애지 않으므로, 치우는 일은 여기서 한다.
     칩 전체는 강화, 오른쪽 아래 작은 버튼이 분해다 — 분해는 되돌릴 수 없어 따로 눌러야 한다. */
  const inv = invParts.length? invParts.map(p=>`<div class="pchip ic${enhClass(p)}${isFresh(p.uid)?' fresh':''}" onclick="ROWAR.enhance('${p.uid}')" title="클릭: 강화 — 스크랩 ${enhCost(p.enh||0)} · 성공 ${Math.round(enhRate(p.enh||0)*100)}%">
      ${partIco(p)}<div class="pn">${freshTag(p.uid)}${esc(p.name)} ${rarTag(p)}${setTag(p)}${affixTags(p)}</div><div class="ps"><b class="slotk">${SLOT_KO[p.slot]}</b>${partStatLine(p,true)}</div>
      <div class="pfoot"><span class="ps" style="color:var(--gold)">강화 ${fmt(enhCost(p.enh||0))}${(p.enh|0)>=enhMax()?'':` <span style="color:var(--dim)">${Math.round(enhRate(p.enh||0)*100)}%</span>`}</span>
        <button class="scrapb" onclick="event.stopPropagation();ROWAR.scrapPart('${p.uid}')"
          title="분해하면 되돌릴 수 없습니다">분해 +${fmt(scrapGain(p.rarity,p.enh))}</button></div></div>`).join('')
    : `<div class="empty">${invAll.length?'거른 조건에 맞는 파츠가 없습니다.':'보유한 여분 파츠가 없습니다. 뽑기나 대전으로 획득하세요.'}</div>`;
  const invMoreBtn = invHit.length>invParts.length
    ? `<button class="btn invmore" onclick="ROWAR.invMore()">${fmt(invHit.length-invParts.length)}개 더 보기</button>` : '';

  const cost=lvCost(rb.level), fat=fatOf(rb), scost=serviceCost(rb);
  const slv=rb.skillLv|0, sk=skillCost(slv), range=atkRange(st);
  const values={hp:fmt(st.hp),atk:`${fmt(range[0])}–${fmt(range[1])}`,def:fmt(st.def),spd:fmt(st.spd),crit:`${(st.crit*100).toFixed(0)}%`,eva:`${(st.eva*100).toFixed(0)}%`};
  const statIcons={hp:'heart',atk:'battle',def:'shield',spd:'speed',crit:'target',eva:'evasion'};
  const stats=`<div class="hv-power"><span>전투력</span><strong>${icon('battle')}${fmt(power(rb))}</strong></div><dl class="hv-stats">${Object.entries(values).map(([k,v])=>`<div><dt>${icon(statIcons[k])}${STAT_LABEL[k]}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  const gear=`<section class="hv-equipment"><div class="hv-section-head"><h3>장착 장비</h3><button class="ui-text-button" onclick="ROWAR.openHangarInventory()">보관함 ${icon('chevron')}</button></div><div class="hv-slots">${slotsHtml}</div></section>`;
  const tune=`<div class="hv-tune"><h3>기체 정비</h3><div class="hv-condition"><b>피로 ${fat} / ${FAT_MAX}</b><span>${fat?`최대 내구 −${fat}%`:'정상 가동'}</span></div><p class="hint">${fat?`자연 회복 · 다음 1까지 ${dur(fatNextMs(rb))}`:'최상의 상태로 출격할 수 있습니다.'}</p><div class="hv-maintenance">
    <button class="btn" ${(rb.level>=MAXLV||!net.state.online||S.credits<cost)?'disabled':''} onclick="ROWAR.levelUp()">${rb.level>=MAXLV?'최대 레벨':`즉시 레벨업 <small>${fmt(cost)} 크레딧</small>`}</button>
    <button class="btn" ${scost>0&&net.state.online&&S.credits>=scost?'':'disabled'} onclick="ROWAR.service()">${scost>0?`피로 정비 <small>${fmt(scost)} 크레딧</small>`:'정비 완료'}</button></div>
    <section class="hv-skill">          <b>스킬 · ${T.skill.name}${slv?` <span class="tag" style="color:var(--acc2);border-color:#2a6b7a">+${slv}</span>`:''}</b>
          <div class="fxrow">${fxTags(rb.type)}</div>
          <p>${T.skill.desc}</p>
          ${slv?`<p style="color:var(--acc2)">강화로 위력 <b>×${skillMul(slv).toFixed(2)}</b></p>`:''}
          ${slv>=skillMax()
            ? `<p style="color:var(--gold)">최대 강화입니다.</p>`
            : `<div class="skup">
                 <div class="skrow"><span>다음 단계</span><b>+${slv} → +${slv+1}</b></div>
                 <div class="skrow"><span>성공 확률</span><b class="${skillRate(slv)<0.5?'bad':''}">${Math.round(skillRate(slv)*100)}%</b></div>
                 <div class="skrow"><span>비용</span><b>크레딧 ${fmt(sk.cr)} · 스크랩 ${fmt(sk.sc)}</b></div>
                 <button class="btn big" style="margin-top:9px"
                   ${(!net.state.online||S.credits<sk.cr||S.scrap<sk.sc)?'disabled':''}
                   onclick="ROWAR.skillUp()">스킬 강화</button>
                 <div class="hint" style="margin-top:6px;color:var(--bad)">실패해도 재화는 돌아오지 않습니다.</div>
               </div>`}
</section>
    <section class="hv-equipped-tune"><h3>장착 파츠 강화</h3>${SLOTS.map(slot=>{const p=findPart(rb.slots[slot],S.parts);return p?`<button class="hv-enhance" onclick="ROWAR.enhance('${p.uid}')" ${!net.state.online||S.scrap<enhCost(p.enh||0)||(p.enh|0)>=enhMax()?'disabled':''}>${partIco(p,'xs')}<span><b>${esc(p.name)} +${p.enh||0}</b><small>${(p.enh|0)>=enhMax()?'최대 강화':`스크랩 ${fmt(enhCost(p.enh||0))} · 성공 ${Math.round(enhRate(p.enh||0)*100)}%`}</small></span>${icon('chevron')}</button>`:'';}).join('')||'<p class="hint">장착한 파츠가 없습니다.</p>'}<p class="hint">강화 실패 시에도 재화는 소모됩니다.</p></section></div>`;
  const detail=hangarTab==='info'?`${stats}${gear}<details class="hv-details"><summary>기체 특성 · 스킬</summary><p>${esc(T.role)}</p><b>${esc(T.skill.name)}${slv?' +'+slv:''}</b><div class="fxrow">${fxTags(rb.type)}</div><p>${esc(T.skill.desc)}</p><p>공격력 변동 폭 ±${Math.round(st.spread*100)}% · 피로 ${fat}/${FAT_MAX}${fat?` · 최대 내구 −${fat}%`:''}</p></details>`:hangarTab==='gear'?`${gear}<div class="hv-build"><h3>빌드 프리셋</h3>${presetBar()||'<p class="hint">현재 장착 조합을 저장해 빠르게 교체하세요.</p>'}<button class="btn" onclick="ROWAR.openPresets()">프리셋 관리</button>${setPanel(rb)}</div>`:tune;
  const inventory=`<details class="hv-inventory ui-surface" id="hv-inventory" ${hangarInventory?'open':''}><summary>파츠 보관함 <span>${invAll.length}개 ${icon('chevron')}</span></summary><div class="hv-inventory-body"><div class="hv-section-head"><span class="hint">${invHit.length}개 표시 · 파츠를 눌러 강화 · 장착은 장비 슬롯에서</span><button class="btn" onclick="ROWAR.openFuse()">파츠 합성</button></div>${invBar(invAll)}<div class="inv">${inv}</div>${invMoreBtn}</div></details>`;
  $('#sc-hangar').innerHTML=`<div class="ui-pagehead hv-pagehead"><div><span class="ui-eyebrow">HANGAR / MECH MANAGEMENT</span><h1>격납고</h1><p>기체를 완성하고, 다음 전장을 준비하세요.</p></div><span class="hv-squad-count">출전 편성 <b>${S.squad.length} / ${SQUAD_MAX}</b></span></div>
    <div class="hv-layout">
      <aside class="hv-roster ui-surface"><div class="hv-roster-head"><h2>보유 기체 <small>${S.robots.length}</small></h2><select aria-label="기체 정렬" onchange="ROWAR.setHangarSort(this.value)">${[['power','전투력 순'],['level','레벨 순'],['rarity','등급 순']].map(([k,v])=>`<option value="${k}" ${hangarSort===k?'selected':''}>${v}</option>`).join('')}</select></div><div class="hv-roster-list">${roster}</div><button class="hv-acquire" onclick="ROWAR.go('gacha')"><span>＋</span><span><b>새 기체 획득</b><small>더 넓은 전술을 준비하세요.</small></span></button></aside>
      <section class="hv-center"><div class="hg-stage hv-stage"><div class="hv-stage-top"><span>UNIT / ${String(ri+1).padStart(2,'0')}</span><span>${status(rb)} · Lv.${rb.level}</span></div><div class="hg-hero" data-t="${T.rarity}">${sprite(rb.type,false,{idle:true})}</div><button class="hv-cycle prev" onclick="ROWAR.cycleHangar(-1)" aria-label="이전 기체">${icon('chevron')}</button><button class="hv-cycle next" onclick="ROWAR.cycleHangar(1)" aria-label="다음 기체">${icon('chevron')}</button><div class="hv-caption"><span class="ui-eyebrow">${esc(T.role)}</span><h2>${esc(T.name)}</h2><div><span class="hv-rarity rr-${T.rarity}">${RR[T.rarity].ko} / ${T.rarity}</span><span class="hv-status">${status(rb)}</span></div><p>${esc(T.skill.name)} <span>· SKILL +${slv}</span></p></div><button class="hv-inspect" onclick="ROWAR.openRobot(${ri})" aria-label="${esc(T.name)} 상세 정보">${icon('expand')}</button></div><div class="hv-strip">${thumbstrip}</div></section>
      <aside class="hv-dock ui-surface" id="hv-dock" data-tab="${hangarTab}"><div class="hv-tabs" role="tablist" aria-label="기체 관리">${[['info','기체 정보'],['gear','장비'],['tune','튜닝']].map(([k,v])=>`<button role="tab" id="hv-tab-${k}" aria-controls="hv-pane" aria-selected="${hangarTab===k}" onclick="ROWAR.setHangarTab('${k}')">${v}</button>`).join('')}<button onclick="ROWAR.openPresets()">프리셋</button></div><div class="hv-profile"><span class="hv-profile-icon">${emblem}</span><div><small>Lv.${rb.level} · ${status(rb)}</small><b>${esc(T.name)}</b><div class="hv-exp"><i style="width:${rb.level>=MAXLV?100:clamp((rb.exp||0)/expNeed(rb.level)*100,0,100)}%"></i></div><small class="hv-exp-label">${rb.level>=MAXLV?'MAX LEVEL':`${fmt(rb.exp||0)} / ${fmt(expNeed(rb.level))} EXP`}</small></div></div><div id="hv-pane" role="tabpanel" aria-labelledby="hv-tab-${hangarTab}">${detail}</div><div class="hv-actions"><button class="btn" onclick="ROWAR.openRobot(${ri})">편성 관리</button><button class="btn" onclick="ROWAR.setHangarTab('gear')">장비 변경</button><button class="btn gold" onclick="ROWAR.setHangarTab('tune')">튜닝 / 강화</button></div>${!net.state.online?'<p class="hv-offline">서버 연결 후 장착·강화·정비를 사용할 수 있습니다.</p>':''}</aside>
    </div>${inventory}`;
  $('.hv-roster-list').scrollTop=rosterScroll;
  $('#hv-inventory').ontoggle=e=>{if(e.currentTarget.isConnected)hangarInventory=e.currentTarget.open;};
  $('.hv-tabs').onkeydown=e=>{
    if(e.target.getAttribute('role')!=='tab')return;
    const keys=['info','gear','tune'],i=keys.indexOf(hangarTab);
    const next=e.key==='ArrowRight'?(i+1)%3:e.key==='ArrowLeft'?(i+2)%3:e.key==='Home'?0:e.key==='End'?2:-1;
    if(next>=0){e.preventDefault();setHangarTab(keys[next]);}
  };
}
/* ── 파츠 합성 ────────────────────────────────────────────
   같은 칸·같은 등급 파츠 셋을 하나로 합친다. **재료가 결과 베이스를 정한다** —
   셋이 모두 같은 베이스면 그 베이스가 확정으로 나오고, 섞여 있으면 셋 중 하나다.

   그래서 화면이 반드시 보여 줘야 하는 것이 '지금 고른 셋이면 무엇이 나오는가' 다.
   확정인지 아닌지를 고르는 도중에 알려 주지 않으면, 세트를 노리는 사람이 뭘 모으고
   있는지 알 수 없다. 규칙은 서버와 **같은 함수**(fuseCheck)를 쓴다.

   되돌릴 수 없으므로 마지막 버튼에만 실제 동작을 건다. 고르는 동안에는 아무 일도
   일어나지 않는다. */
let _fuseSel = [], _fuseHide = 0;
function openFuse(){
  _fuseSel = _fuseSel.filter(u => findPart(u, S.parts));   // 그 사이 사라진 것 정리
  drawFuse();
}
function fuseToggle(u){
  const i = _fuseSel.indexOf(u);
  if(i >= 0) _fuseSel.splice(i, 1);
  else if(_fuseSel.length < (CONST.FUSE?.need || 3)) _fuseSel.push(u);
  /* 모달을 통째로 다시 그리지 않는다 — 아래 syncFuse 주석 참고 */
  if($('#fusegrid')) syncFuse(); else drawFuse();
}
const fuseSel = () => _fuseSel.map(u => findPart(u, S.parts)).filter(Boolean);
/* 첫 장이 칸과 등급을 정한다. 서버도 같은 규칙(fuseCheck)을 쓴다. */
const fuseFits = (p, lock) => !lock || (p.slot === lock.slot && p.rarity === lock.rarity);

/* 하나를 고르면 **같은 칸·같은 등급만 남기고 나머지가 차례로 빠져나간다.**
   예전에는 흐리게만 두었는데, 파츠가 수십 개면 흐린 것들 사이에서 고를 것을 다시
   찾아야 했다. 지금은 남은 것만 보이므로 두 번째·세 번째 장이 바로 눈에 든다.

   여기서 모달을 다시 그리지 않는 이유가 그것이다 — 다시 그리면 빠지는 것이
   '처음부터 없던 것' 이 되어 움직임이 없다. 무엇이 걸러졌는지는 나가는 모습으로만 안다. */
function syncFuse(){
  const grid = $('#fusegrid');
  if(!grid) return drawFuse();
  const lock = fuseSel()[0] || null;
  clearTimeout(_fuseHide);
  let out = 0;
  grid.querySelectorAll('.fusec').forEach(el => {
    const p = findPart(el.dataset.uid, S.parts);
    if(!p) return;
    el.classList.toggle('on', _fuseSel.includes(p.uid));
    el.setAttribute('aria-pressed',String(_fuseSel.includes(p.uid)));
    el.disabled=!fuseFits(p,lock);
    if(!fuseFits(p, lock)){
      el.style.setProperty('--i', out++);   // 한꺼번에 사라지면 뭐가 빠졌는지 안 보인다. 차례로 뺀다
      el.classList.add('gone');
    } else if(el.classList.contains('gone')){
      el.classList.remove('done');          // 자리를 먼저 돌려주고
      void el.offsetWidth;                  // 한 프레임 뒤에 되돌아오는 것이 보이게 한다
      el.classList.remove('gone');
    }
  });
  /* 다 빠져나간 뒤에야 자리를 접는다. 접는 것이 먼저면 나가는 모습이 안 보인다. */
  if(out) _fuseHide = setTimeout(() => {
    const g = $('#fusegrid');
    if(g) g.querySelectorAll('.fusec.gone').forEach(el => el.classList.add('done'));
  }, 240 + out * 16);
  paintFuse();
}
function paintFuse(){
  const f = fuseInfo(), a = $('#fusefore'), b = $('#fusebtn');
  if(a) a.innerHTML = f.fore;
  if(b) b.innerHTML = f.btn;
}

/* 결과 예고 — 확정 베이스인지, 등급이 오를 확률이 얼마인지 */
function fuseInfo(){
  const need = CONST.FUSE?.need || 3;
  const sel = fuseSel(), lock = sel[0] || null;
  let fore = `<div class="hint">같은 칸·같은 등급으로 <b>${need}개</b>를 고르세요.</div>`;
  let btn  = `<button class="btn big" disabled>${need}개를 고르세요 (${sel.length}/${need})</button>`;
  const bad = sel.length === need ? fuseCheck(sel) : null;
  if(sel.length === need && !bad){
    const rar = sel[0].rarity, cost = fuseCost(rar), up = fuseUpRate(rar);
    const bases = sel.map(p => p.base).filter(Boolean);
    const same  = bases.length === need && bases.every(b => b === bases[0]);
    const poor  = S.scrap < cost;
    fore = `<div class="fpv">
      <div><span>결과 칸</span><b>${SLOT_KO[sel[0].slot]}</b></div>
      <div><span>베이스</span><b class="${same?'good':''}">${same
        ? `${esc(sel[0].name)} 확정`
        : `고른 ${need}개 중 하나 (${sel.map(p=>esc(p.name)).join(' · ')})`}</b></div>
      <div><span>등급</span><b>${rar}${up>0
        ? ` → <span style="color:var(--gold)">${nextRarity(rar)} ${Math.round(up*100)}%</span>`
        : ' (더 오를 등급 없음)'}</b></div>
      <div><span>인챈트</span><b>새로 굴립니다</b></div>
      <div><span>비용</span><b class="${poor?'bad':''}">스크랩 ${fmt(cost)}</b></div>
    </div>
    ${same?'':`<div class="hint">같은 베이스로 ${need}개를 맞추면 <b>그 베이스가 확정</b>으로 나옵니다 — 세트를 맞추는 길입니다.</div>`}
    <div class="hint" style="color:var(--bad)">재료 ${need}개는 사라집니다. 되돌릴 수 없습니다.</div>`;
    btn = `<button class="btn big gold" ${(poor||!net.state.online)?'disabled':''} onclick="ROWAR.doFuse()">
      ${poor?`스크랩 부족 (${fmt(cost)} 필요)`:`합성 · 스크랩 ${fmt(cost)}`}</button>`;
  } else if(bad){
    fore = `<div class="hint" style="color:var(--bad)">${esc(bad)}</div>`;
  } else if(lock){
    /* 고르는 중 — 무엇으로 좁혀졌는지와 몇 개가 남았는지. 걸러진 것들이 사라져 버리므로
       '왜 안 보이나' 에 대한 답이 화면에 남아 있어야 한다. */
    fore = `<div class="fpv">
      <div><span>고르는 중</span><b>${SLOT_KO[lock.slot]} · ${lock.rarity}</b></div>
      <div><span>남은 개수</span><b>${need - sel.length}개 더</b></div>
    </div>
    <div class="hint">같은 칸·같은 등급만 남겼습니다 · 고른 것을 다시 누르면 전부 돌아옵니다.</div>`;
  }
  return { fore, btn };
}

function drawFuse(){
  const worn = new Set(S.robots.flatMap(r => Object.values(r.slots)).filter(Boolean));
  const ord = { WEAPON:0, FRAME:1, BOOSTER:2, CORE:3 };
  /* 칸·등급으로 묶어 둔다. 걸러지고 남는 것들이 원래 이웃이라 빠져나간 뒤에도 줄이 흐트러지지 않는다. */
  const pool = S.parts.filter(p => !worn.has(p.uid)).sort((x,y)=>
    (ord[x.slot]-ord[y.slot]) || (RAR_ORDER[y.rarity]-RAR_ORDER[x.rarity]) || ((y.enh|0)-(x.enh|0)));
  const f = fuseInfo();
  const chips = pool.length ? pool.map((p,i)=>
    `<button type="button" aria-pressed="${_fuseSel.includes(p.uid)}" class="pchip ic fusec${_fuseSel.includes(p.uid)?' on':''}${enhClass(p)}${isFresh(p.uid)?' fresh':''}"
      data-uid="${p.uid}" style="--i:${i}" onclick="ROWAR.fuseToggle('${p.uid}')">
      ${partIco(p)}<div class="pn">${freshTag(p.uid)}${esc(p.name)} ${rarTag(p)}${setTag(p)}</div>
      <div class="ps">${SLOT_KO[p.slot]}${p.enh?` · +${p.enh}`:''}</div></button>`).join('')
    : `<div class="empty">합성할 수 있는 파츠가 없습니다. 끼고 있는 파츠는 재료가 될 수 없습니다.</div>`;

  openModal(`<div class="mhead">파츠 합성 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div id="fusefore">${f.fore}</div>
    <div class="inv finv" id="fusegrid">${chips}</div>
    <div id="fusebtn">${f.btn}</div>`);
  if(_fuseSel.length) syncFuse();     // 다시 열었을 때 고른 것이 남아 있으면 바로 걸러 준다
}
async function doFuse(){
  const need = CONST.FUSE?.need || 3;
  const sel = _fuseSel.map(u => findPart(u, S.parts)).filter(Boolean);
  if(sel.length !== need || fuseCheck(sel)) return;
  const r = await srvHangar('fuse', { uids: sel.map(p => p.uid) });
  if(!r) return;
  /* 서버가 확정한 것만 받아 적는다. 무엇이 나올지 클라가 굴리지 않는다. */
  const gone = new Set(r.used || sel.map(p => p.uid));
  S.parts = S.parts.filter(p => !gone.has(p.uid));
  if(r.part) addPart(r.part);
  S.scrap = r.scrap;
  _fuseSel = [];
  commitLocal(); renderWallet(); renderHangar();
  fuseResult(r, sel);
}
/* 합성 결과 — **무엇이 나왔는지 보여 준다.**
   예전에는 토스트 한 줄이었다. 되돌릴 수 없는 작업의 결과가 3초 뒤에 사라지는 글자
   한 줄이면, 태운 재료가 무엇이 됐는지(인챈트·계열·구간) 영영 알 수 없다.
   등급 색으로 빛을 내는 것은 뽑기 캡슐과 같은 규칙이다 — 결과의 무게를 색으로 먼저 안다. */
function fuseResult(r, mats){
  const p = r.part;
  if(!p){ closeModal(); toast('합성했습니다'); return; }
  const head = r.up ? '등급 상승!' : (r.guaranteed ? '베이스 확정' : '합성 완료');
  openModal(`<div class="mhead">${head} <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="fres" data-r="${p.rarity}">
      <div class="fresb"></div>
      <div class="pchip ic fresp${enhClass(p)}">
        ${partIco(p)}<div class="pn">${esc(p.name)} ${rarTag(p)}${setTag(p)}${affixTags(p)}</div>
        <div class="ps"><b class="slotk">${SLOT_KO[p.slot]}</b>${partStatLine(p,true)}</div>
      </div>
    </div>
    <div class="fpv">
      <div><span>재료</span><b>${mats.map(m=>esc(m.name)).join(' · ')}</b></div>
      <div><span>등급</span><b class="${r.up?'good':''}">${mats[0].rarity}${r.up?` → ${p.rarity}`:' 유지'}</b></div>
      <div><span>남은 스크랩</span><b>${fmt(S.scrap)}</b></div>
    </div>
    <div class="hint">인벤토리에서 <span class="tag newt">NEW</span> 로 표시됩니다.</div>
    <div class="row-btns">
      <button class="btn" onclick="ROWAR.closeModal()">확인</button>
      <button class="btn big gold" onclick="ROWAR.openFuse()">계속 합성</button>
    </div>`);
}

/* ── 기체 프리뷰 ──────────────────────────────────────────
   로스터 카드를 누르면 **'이게 어떤 기체인가' 를 보여 준다.**

   예전에는 카드를 누르는 것이 곧 편성이었다. 보려고 눌렀는데 편성이 바뀌고,
   상대를 잡아 둔 상태였다면 그 상대까지 놓쳤다(toggleSquad 가 _pendingOpp 를 버린다).
   **보는 것과 바꾸는 것을 갈라 둔다** — 편성은 카드의 편성 단추와 이 창의 단추로만
   바뀐다. 선봉 바꾸기는 여기와 장면 위의 편성 아이콘(.sqm) 둘 다에 남겨 둔다. */
function openRobot(i){
  const r = S.robots[i]; if(!r) return;
  const T = ROBOT_TYPES[r.type], st = computeStats(r), fat = fatOf(r);
  const inSq = S.squad.includes(r.uid);
  const isSel = S.robots[S.sel] && S.robots[S.sel].uid === r.uid;
  const slots = SLOTS.map(sl => { const u = r.slots[sl], p = u && findPart(u, S.parts);
    return `<div class="rpslot${p?' filled':''}"><b>${SLOT_KO[sl]}</b>${p
      ? `<span>${partIco(p,'xs')} ${esc(p.name)} ${rarTag(p)}${setTag(p)}</span>`
      : `<span class="dimt">${slotIco(sl,'xs')} 비어 있음</span>`}</div>`; }).join('');
  openModal(`<div class="mhead">${esc(T.name)} <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="rprev">
      <div class="sprite" data-t="${T.rarity}">${sprite(r.type,false)}</div>
      <div>
        <div class="rname">${esc(T.name)} ${robRarTag(r.type)} <span class="lv">Lv.${r.level}</span></div>
        <div class="rrole">${esc(T.role)} · 전투력 ${fmt(power(r))}</div>
        <div class="trterr">${inSq ? (isSel ? '편성 · 선봉' : '편성 · 예비') : '편성 밖'}${
          fat ? ` · 피로 ${fat} / ${FAT_MAX}` : ' · 피로 없음'}</div>
      </div>
    </div>
    ${['hp','atk','def','spd','crit','eva'].map(k=>statBar(k, st[k],
        k==='hp'?st.hpFull:null, k==='atk'?atkRange(st):null)).join('')}
    <div class="dh" style="margin-top:10px">장착</div>
    <div class="rpslots">${slots}</div>
    <div class="dcard skillcard" style="margin-top:10px">
      <b>스킬 · ${T.skill.name}${r.skillLv?` <span class="tag" style="color:var(--acc2);border-color:#2a6b7a">+${r.skillLv}</span>`:''}</b>
      <div class="fxrow">${fxTags(r.type)}</div>
      <p>${T.skill.desc}</p>
    </div>
    <div class="row-btns" style="margin-top:12px">
      ${inSq && !isSel
        ? `<button class="btn big gold" onclick="ROWAR.closeModal();ROWAR.selectRobot(${i})">선봉으로</button>` : ''}
      <button class="btn big${inSq?'':' gold'}"
        onclick="ROWAR.closeModal();ROWAR.toggleSquad('${r.uid}')">${inSq?'편성 해제':'편성하기'}</button>
    </div>
    ${inSq?'':`<div class="hint" style="margin-top:8px">편성한 <b>${SQUAD_MAX}기</b>만 출전합니다.</div>`}`);
}

function openSlot(slot){
  const rb=hangarRobot(); const equippedHere=rb.slots[slot];
  const list=S.parts.filter(p=>p.slot===slot);
  const rows = list.length? list.map(p=>{ const equipped = S.robots.some(r=>Object.values(r.slots).includes(p.uid));
    const onMe = equippedHere===p.uid;
    return `<div class="pchip ic${enhClass(p)}${isFresh(p.uid)?' fresh':''}" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      ${partIco(p)}<div><div class="pn">${freshTag(p.uid)}${esc(p.name)} ${rarTag(p)}${setTag(p)}${affixTags(p)}</div><div class="ps">${partStatLine(p)}</div>
      ${equipped&&!onMe?`<div class="ps" style="color:var(--bad)">다른 기체 장착중</div>`:''}</div>
      <button class="btn ${onMe?'danger':''}" style="padding:8px 12px;font-size:13px"
        onclick="ROWAR.${onMe?`unequip('${slot}')`:`equip('${slot}','${p.uid}')`}">${onMe?'해제':'장착'}</button>
    </div>`; }).join('') : `<div class="empty">이 슬롯(${SLOT_KO[slot]})에 맞는 파츠가 없습니다.</div>`;
  openModal(`<div class="mhead">${SLOT_KO[slot]} 슬롯 · 파츠 선택 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>${rows}`);
}

/* ------------------------------- 뽑기 화면 ------------------------------- */
/* 지금 보고 있는 뽑기 창구. 코어와 크레딧이 확률표를 따로 쓴다. */
let gCur = 'core', _pullPending=null;
const gFeatured={core:'ignis',credit:'azure'};
const setGacha = c => { if(_pullPending)return; gCur = PULL_CUR[c] ? c : 'core'; renderGacha(); };
function setRecruitmentHero(id){
  if(_pullPending||!recruitmentPool(gCur).robots.some(r=>r.id===id))return;
  gFeatured[gCur]=id;renderGacha();
}
function openRecruitmentRates(){
  openModal(`<div class="mhead">획득 확률 <button class="mx" onclick="ROWAR.closeModal()" aria-label="닫기">✕</button></div>${recruitmentRates(gCur)}`);
}
function openRecruitmentPool(){
  openModal(`<div class="mhead">등장 기체 <button class="mx" onclick="ROWAR.closeModal()" aria-label="닫기">✕</button></div>${recruitmentCatalog(gCur,S.robots.map(r=>r.type))}`);
}
function openRecruitmentDetails(id){
  const robot=recruitmentPool(gCur).robots.find(r=>r.id===id);if(!robot)return;
  openModal(`<div class="mhead">기체 상세 <button class="mx" onclick="ROWAR.closeModal()" aria-label="닫기">✕</button></div><div class="gv-unit-detail">${sprite(id,false)}<span class="rr-${robot.rarity}">${RR[robot.rarity].ko} / ${robot.rarity}</span><h2>${esc(robot.name)}</h2><p>${esc(robot.role)}</p><b>${esc(robot.skill.name)}</b><p>${esc(robot.skill.desc)}</p><p>1회 뽑기 등장 확률 <strong>${percentText(robot.percent)}</strong></p><small>${S.robots.some(r=>r.type===id)?'보유 중 · 중복 획득 시 자원으로 전환':'미보유 기체'}</small></div><button class="btn big" onclick="ROWAR.openRecruitmentPool()">전체 등장 기체</button>`);
}

function gachaStageHtml(){
  const core = gCur === 'core';
  const mode = core ? 'core' : 'credit';
  const title = core ? 'CORE VAULT' : 'CREDIT VAULT';
  const state = core ? '코어 동기화 대기' : '크레딧 변환 대기';
  const sparks = Array.from({length:14},(_,i)=>`<i style="--spark:${i}"></i>`).join('');
  return `<div class="gacha-stage ${mode}" id="stage" role="img" aria-label="${core?'코어':'크레딧'} 캡슐 대기 중">
    <div class="gacha-grid" aria-hidden="true"></div>
    <div class="gacha-beam beam-a" aria-hidden="true"></div>
    <div class="gacha-beam beam-b" aria-hidden="true"></div>
    <div class="gacha-orbit orbit-a" aria-hidden="true"></div>
    <div class="gacha-orbit orbit-b" aria-hidden="true"></div>
    <div class="capsule-rig" aria-hidden="true">
      <div class="capsule-aura"></div>
      <div class="capsule-heart"><span></span></div>
      <div class="capsule-half capsule-top"><img src="assets/gacha/core-capsule.png" alt="" draggable="false"></div>
      <div class="capsule-half capsule-bottom"><img src="assets/gacha/core-capsule.png" alt="" draggable="false"></div>
      <div class="capsule-lock"></div>
    </div>
    <div class="gacha-plinth" aria-hidden="true"><i></i><b></b><i></i></div>
    <div class="gacha-sparks" aria-hidden="true">${sparks}</div>
    <div class="gacha-readout"><b>${title}</b><span>${state}</span></div>
  </div>`;
}

/* ── 상점 · 보관함 (2026-09-18 사용자 지시) ─────────────────
   뽑기 화면을 세 갈래로 나눈다 — 뽑기(그대로) · 상점(주기마다 바뀌는 진열) · 보관함(기체 조각).
   진열·값·조각 수는 **서버가 js/shop.js 로 정한다.** 화면은 받은 진열을 그리고 누른 칸의
   서명(sig)을 함께 보낸다 — 주기가 넘어가 진열이 바뀐 뒤 옛 화면으로 누르면 서버가 거절한다. */
let _gTab = 'pull', _shop = null, _shopAt = 0, _shopOwner = null, _shopPending = false, _shopViewSeq = 0;
const SHOP_TTL = 60000;
function setShopTab(k){ if(_pullPending)return; _gTab = ['pull','shop','bag'].includes(k) ? k : 'pull'; renderGacha(); }
function shopTabs(){
  const bagN = Object.entries(S.items||{}).filter(([k,v])=>k.startsWith('shard:') && v>0 &&
    v >= shardNeed(k.slice(6))).length;
  return `<nav class="gv-section-tabs" aria-label="뽑기와 보급">
    <button class="${_gTab==='pull'?'on':''}" ${_gTab==='pull'?'aria-current="page"':''} onclick="ROWAR.setShopTab('pull')">${icon('gacha')} 뽑기</button>
    <button class="${_gTab==='shop'?'on':''}" ${_gTab==='shop'?'aria-current="page"':''} onclick="ROWAR.setShopTab('shop')">${icon('refresh')} 보급 상점</button>
    <button class="${_gTab==='bag'?'on':''}" ${_gTab==='bag'?'aria-current="page"':''} onclick="ROWAR.setShopTab('bag')">${icon('hangar')} 기체 조각${bagN?` <i class="cxdot">${bagN}</i>`:''}</button>
  </nav>`;
}
const leftTxt = ms => { const m = Math.max(0, Math.ceil(ms/60000)); return m>=60 ? `${Math.floor(m/60)}시간 ${m%60}분` : `${m}분`; };

/* 서버가 확정한 재화·보관함을 받아 적는다 — 상점 쪽 동작이 같이 쓴다. */
function shopApply(r){
  _shop = r; _shopAt = Date.now(); _shopOwner = net.state.accountId;
  S.credits = r.credits; S.cores = r.cores; S.scrap = r.scrap; S.items = r.items || {};
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){}
  net.cancelSync();
  renderWallet();
}

async function renderShop(){
  const el = $('#sc-gacha');
  const wrap = inner => `${shopTabs()}<div class="sv-page">${inner}</div>`;
  const message = (title,body,retry=false) => wrap(`<div class="sv-message ui-surface"><span class="ui-eyebrow">SUPPLY DEPOT</span><h2>${title}</h2><p>${body}</p>${retry?'<button class="btn" onclick="ROWAR.setShopTab(\'shop\')">다시 불러오기</button>':''}</div>`);
  if(!net.state.online){ el.innerHTML = message('상점에 연결할 수 없습니다','진열과 구매는 서버 연결 중에만 이용할 수 있습니다.'); return; }
  if(_shopOwner!==net.state.accountId){ _shop=null; _shopAt=0; }
  const stale = !_shop || Date.now()-_shopAt > SHOP_TTL || (_shop.endsAt && Date.now() >= _shop.endsAt);
  if(stale){
    const owner=S, account=net.state.accountId, seq=++_shopViewSeq;
    el.innerHTML = message('진열을 불러오는 중','이번 주기의 상품과 가격을 확인하고 있습니다.');
    let r;try{r=await net.shop();}catch(e){r={error:'연결 오류'};}
    if(_gTab!=='shop'||cur!=='gacha'||S!==owner||net.state.accountId!==account||seq!==_shopViewSeq) return;
    if(r && !r.error) shopApply(r);
    else { el.innerHTML = message('진열을 불러오지 못했습니다',`연결을 확인한 뒤 다시 시도해 주세요.${r&&r.error?' · '+esc(r.error):''}`,true); return; }
  }
  const sh = _shop;
  const left = Math.max(0,sh.endsAt - Date.now());
  const sold = sh.stock.filter(x=>x.sold).length;
  const card = x => {
    const afford = S.credits >= x.price;
    let art='', name='', sub='', kind='';
    if(x.kind==='part'){
      art = partIco(x.part,'md'); kind='파츠';
      name = `${esc(x.part.name)} ${rarTag(x.part)}`;
      sub = `Lv.${x.part.lv||sh.lv} · 격납고 파츠함에 보관`;
    } else if(x.kind==='shard'){
      const T = ROBOT_TYPES[x.type], have = (S.items||{})[shardKey(x.type)]|0, need = shardNeed(x.type);
      art = sprite(x.type,false); kind='기체 조각';
      name = `${esc(T.name)} 조각 ×${x.qty} ${robRarTag(x.type)}`;
      sub = `보유 ${have} / 조립 ${need}${S.robots.some(r=>r.type===x.type)?' · 중복 조립은 자원 전환':''}`;
    } else if(x.kind==='scrap'){
      art = icon('hangar'); kind='강화 재료'; name = `스크랩 ×${x.qty}`; sub = '기체와 파츠 강화에 사용';
    } else {
      art = icon('gacha'); kind='희귀 재화'; name = `코어 ×${x.qty}`; sub = '코어 캡슐에 사용';
    }
    return `<article class="sv-item ${x.sold?'sold':''} sv-${x.kind}">
      <div class="sv-item-top"><span>0${x.i+1} / ${kind}</span>${x.sold?'<b>판매 완료</b>':''}</div>
      <div class="sv-art">${art}</div>
      <div class="sv-item-copy"><h3>${name}</h3><p>${sub}</p></div>
      <button class="btn sv-action ${x.kind==='core'?'gold':''}" ${x.sold||!afford||_shopPending?'disabled':''}
        onclick="ROWAR.shopBuy(${x.i})">${x.sold?'판매 완료':!afford?'크레딧 부족':`${fmt(x.price)} 크레딧`}</button>
    </article>`;
  };
  el.innerHTML = wrap(`
    <header class="sv-hero"><span class="ui-eyebrow">SUPPLY DEPOT / LIVE STOCK</span><h1>보급 상점</h1><p>필요한 파츠와 재료를 확보하고, 기체 조각을 모아 전력을 확장하세요.</p><div class="sv-hero-meta"><span>다음 진열까지 <b>${leftTxt(left)}</b></span><span>Lv.${sh.lv} 기준 가격</span></div></header>
    <div class="sv-layout"><section class="sv-stock ui-surface"><div class="sv-section-head"><div><span class="ui-eyebrow">CURRENT SELECTION</span><h2>이번 진열</h2></div><span>${sh.stock.length-sold} / ${sh.stock.length}개 구매 가능</span></div><div class="sv-grid">${sh.stock.map(card).join('')}</div></section>
      <aside class="sv-side"><div class="sv-refresh ui-surface"><span class="ui-eyebrow">STOCK CONTROL</span><h2>진열 갱신</h2><p>시간이 지나면 자동으로 바뀝니다. 지금 바꾸면 현재 진열은 사라지고 갱신 비용이 차감됩니다.</p><div class="sv-fact"><span>이번 주기 갱신</span><b>${sh.refreshed}회</b></div><div class="sv-fact"><span>다음 갱신 비용</span><b>${fmt(sh.refresh)} 크레딧</b></div><button class="btn sv-action" ${S.credits<sh.refresh||_shopPending?'disabled':''} onclick="ROWAR.shopRefresh()">${S.credits<sh.refresh?'크레딧 부족':'지금 진열 바꾸기'}</button></div>
      <div class="sv-note ui-surface"><h3>진열 안내</h3><p>상품마다 등장 종류를 따로 추첨합니다. 파츠 ${CONST.SHOP.kind.part}% · 기체 조각 ${CONST.SHOP.kind.shard}% · 스크랩 ${CONST.SHOP.kind.scrap}% · 코어 ${CONST.SHOP.kind.core}%.</p><p>상품의 등급은 종류 안에서 다시 결정됩니다. 갱신할수록 이번 주기의 비용이 오릅니다.</p><button class="ui-text-button" onclick="ROWAR.setShopTab('bag')">기체 조각 보관함 ${icon('chevron')}</button></div></aside></div>`);
}

async function renderBag(){
  const el = $('#sc-gacha');
  const bag = bagView(S.items||{}, S.robots.map(r=>r.type));
  const ready = bag.filter(b=>b.ready).length;
  const collected = bag.reduce((n,b)=>n+b.have,0);
  const row = b => {
    const T = ROBOT_TYPES[b.type], pct = Math.min(100, Math.round(b.have/b.need*100));
    const gain=CONST.DUPE_GAIN[T.rarity]||{cr:0,sc:0,co:0};
    return `<article class="sv-bag-card ${b.ready?'ready':''}"><div class="sv-bag-art">${sprite(b.type,false)}</div><div class="sv-bag-copy"><div class="sv-bag-title">${robRarTag(b.type)}<h3>${esc(T.name)}</h3></div><div class="sv-progress"><span>조립 진행</span><b>${b.have} / ${b.need}</b><div role="progressbar" aria-label="${esc(T.name)} 조각" aria-valuenow="${Math.min(b.have,b.need)}" aria-valuemin="0" aria-valuemax="${b.need}"><i style="width:${pct}%"></i></div></div>${b.owned?`<p>보유 기체 · 조립 시 크레딧 ${fmt(gain.cr)}, 스크랩 ${fmt(gain.sc)}${gain.co?`, 코어 ${fmt(gain.co)}`:''} 획득</p>`:'<p>미보유 기체 · 조립하면 격납고에 추가됩니다.</p>'}</div><button class="btn sv-action ${b.ready?'gold':''}" ${b.ready&&net.state.online&&!_shopPending?'':'disabled'} onclick="ROWAR.shopAssemble('${b.type}')">${b.ready?'조립하기':'조각 부족'}</button></article>`;
  };
  el.innerHTML = `${shopTabs()}<div class="sv-page"><header class="sv-hero sv-bag-hero"><span class="ui-eyebrow">SUPPLY DEPOT / COLLECTION</span><h1>기체 조각 보관함</h1><p>모은 조각을 확인하고, 기준 수량이 되면 기체를 조립하세요.</p><div class="sv-hero-meta"><span>보유 조각 <b>${fmt(collected)}개</b></span><span>조립 가능 <b>${ready}기</b></span></div></header><div class="sv-layout"><section class="sv-stock ui-surface"><div class="sv-section-head"><div><span class="ui-eyebrow">COLLECTED SHARDS</span><h2>보유 목록</h2></div><span>${bag.length}종</span></div>${bag.length?`<div class="sv-bag-grid">${bag.map(row).join('')}</div>`:`<div class="sv-empty"><h3>아직 모은 조각이 없습니다</h3><p>보급 상점의 기체 조각을 구매하면 이곳에 표시됩니다.</p><button class="btn" onclick="ROWAR.setShopTab('shop')">상점 살펴보기</button></div>`}</section><aside class="sv-side"><div class="sv-note ui-surface"><h3>조립 기준</h3><div class="sv-need-list">${Object.entries(CONST.SHARD_NEED).map(([k,v])=>`<div><span>${k}</span><b>${v}개</b></div>`).join('')}</div><p>이미 보유한 기체를 조립하면 기체 대신 등급에 맞는 자원을 받습니다.</p><button class="ui-text-button" onclick="ROWAR.setShopTab('shop')">보급 상점 ${icon('chevron')}</button></div></aside></div></div>`;
}

async function shopBuy(i){
  if(_shopPending||!net.state.online)return;
  const x = _shop && _shop.stock.find(s=>s.i===i);
  if(!x||x.sold||S.credits<x.price||_shopOwner!==net.state.accountId) return;
  const owner=S,account=net.state.accountId;_shopPending=true;
  $('#sc-gacha').querySelectorAll('.sv-action').forEach(b=>b.disabled=true);
  let r;
  try{ r = await net.shop('buy', { slot: i, sig: x.sig }); }
  catch(e){r={error:'연결 오류'};}
  finally{ _shopPending=false; }
  if(S!==owner||net.state.accountId!==account)return;
  if(!r || r.error){
    if(r && r.status===409){ _shopAt=0; if(cur==='gacha')renderGacha(); toast('진열이 바뀌었습니다 — 다시 확인해 주세요'); return; }
    if(cur==='gacha')renderGacha();toast(r && r.error==='not enough credits' ? `크레딧이 모자랍니다 · 필요 ${fmt(r.need)}` : '사지 못했습니다'+(r&&r.error?' · '+r.error:'')); return;
  }
  if(r.bought.kind==='part') addPart(r.bought.part);
  shopApply(r); if(cur==='gacha')renderGacha();
  const b = r.bought;
  toast(b.kind==='part' ? `${b.part.name} (${b.rarity}) 구입 — 격납고 파츠함에 들어갔습니다`
      : b.kind==='shard' ? `${ROBOT_TYPES[b.type].name} 조각 ×${b.qty} — 보관함에 들어갔습니다`
      : b.kind==='scrap' ? `스크랩 +${b.qty}` : `코어 +${b.qty}`);
}
async function shopRefresh(){
  if(_shopPending||!net.state.online||!_shop||S.credits<_shop.refresh||_shopOwner!==net.state.accountId)return;
  const owner=S,account=net.state.accountId;_shopPending=true;
  $('#sc-gacha').querySelectorAll('.sv-action').forEach(b=>b.disabled=true);
  let r;
  try{ r = await net.shop('refresh'); }
  catch(e){r={error:'연결 오류'};}
  finally{ _shopPending=false; }
  if(S!==owner||net.state.accountId!==account)return;
  if(!r || r.error){ toast('새로 굴리지 못했습니다'+(r&&r.error?' · '+r.error:'')); if(r&&r.status===409)_shopAt=0; if(cur==='gacha')renderGacha(); return; }
  shopApply(r); if(cur==='gacha')renderGacha();
  toast(`진열을 새로 굴렸습니다 · −${fmt(r.spent)} 크레딧`);
}
async function shopAssemble(type){
  if(_shopPending||!net.state.online||!bagView(S.items||{},S.robots.map(r=>r.type)).some(b=>b.type===type&&b.ready))return;
  const owner=S,account=net.state.accountId;_shopPending=true;
  $('#sc-gacha').querySelectorAll('.sv-action').forEach(b=>b.disabled=true);
  let r;
  try{ r = await net.shop('assemble', { type }); }
  catch(e){r={error:'연결 오류'};}
  finally{ _shopPending=false; }
  if(S!==owner||net.state.accountId!==account)return;
  if(!r || r.error){ toast('조립하지 못했습니다'+(r&&r.error?' · '+r.error:'')); if(cur==='gacha')renderGacha();return; }
  const a = r.assembled;
  if(!a.dupe) S.robots.push({uid:a.uid,type:a.type,level:1,exp:0,fat:0,skillLv:0,slots:emptySlots()});
  shopApply(r); if(cur==='gacha')renderGacha();
  toast(a.dupe ? `${ROBOT_TYPES[type].name} — 이미 가진 기체라 자원으로 바뀌었습니다 (크레딧 +${fmt(a.gain.cr)} · 스크랩 +${a.gain.sc}${a.gain.co?` · 코어 +${a.gain.co}`:''})`
               : `${ROBOT_TYPES[type].name} 조립 완료! 격납고에 들어갔습니다`);
}

function renderGacha(){
  if(_pullPending)return;
  if(_gTab==='shop') return renderShop();
  if(_gTab==='bag') return renderBag();
  $('#sc-gacha').innerHTML=recruitmentView({currency:gCur,featured:gFeatured[gCur],cores:S.cores,credits:S.credits,online:net.state.online,stageHtml:gachaStageHtml()});
}

/* 뽑기는 서버가 판정한다.
   클라가 "이런 게 나왔다"고 보내는 것을 받지 않기 때문에, 클라 코드를 고쳐도
   결과를 조작할 수 없다. 대신 연결이 없으면 뽑을 수 없다 — 오프라인에서 로컬로
   굴리게 두면 끊고 굴린 뒤 올리면 그만이라 서버 판정의 의미가 사라진다. */
async function doPull(count){
  if(_pullPending||![1,10].includes(count))return;
  const currency=gCur, C=PULL_CUR[currency]||PULL_CUR.core;
  const have=currency==='credit'?S.credits:S.cores;
  if(have<C.cost*count){toast(C.ko+'가 부족합니다');return;}
  if(!net.state.online){toast('뽑기는 서버 연결이 필요합니다');return;}
  const owner=S,account=net.state.accountId,token={};_pullPending=token;
  const stage=$('#stage'),animation=$('.gv-animation');
  const actions=$('.gv-actions');
  if(actions){actions.setAttribute('aria-busy','true');actions.querySelectorAll('button').forEach(b=>b.disabled=true);}
  const reduced=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const stillOwner=()=>S===owner&&net.state.accountId===account;
  try{
    if(animation)animation.hidden=false;
    stage?.scrollIntoView({block:'nearest'});
    stage?.classList.add('charging');
    const started=performance.now();
    const r=await net.pullServer(count,currency);
    await sleep(Math.max(0,(reduced?120:760)-(performance.now()-started)));
    if(!stillOwner())return;
    if(!r||r.error){toast(!r?'뽑기는 서버 연결이 필요합니다':r.error==='not enough cores'?'코어가 부족합니다':r.error==='not enough credits'?'크레딧이 부족합니다':'뽑기 실패: '+r.error);return;}
    stage?.classList.remove('charging');
    stage?.classList.add('rolling','prize-'+bestPrize(r.results));
    await sleep(reduced?100:520);
    stage?.classList.remove('rolling');stage?.classList.add('opening');
    await sleep(reduced?120:700);
    if(!stillOwner())return;
    // Completed server rewards survive navigation; only the result modal is scene-scoped.
    for(const res of r.results)applyPull(res);
    S.credits=r.credits;S.cores=r.cores;S.scrap=r.scrap;
    S.stat.pulls+=r.results.length;
    try{localStorage.setItem(SAVE_KEY,JSON.stringify(S));}catch(e){}
    net.cancelSync();renderWallet();
    _pullPending=null;
    if(cur==='gacha'&&_gTab==='pull'){renderGacha();showReveal(r.results);}
    else{renderAll();toast('뽑기 완료 · 획득한 보상을 보관했습니다');}
  }finally{
    stage?.classList.remove('charging','rolling','opening');
    if(animation)animation.hidden=true;
    if(_pullPending===token)_pullPending=null;
    if(cur==='gacha'&&_gTab==='pull'&&(!stillOwner()||actions?.isConnected))renderGacha();
  }
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
  if(res.kind==='scrap') return `<div class="pchip ic">${partIco(res.part)}<div class="pn">${esc(res.part.name)} <span class="tag rar-${res.part.rarity}">${res.part.rarity}</span></div><div class="ps" style="color:var(--sub)">자동 분해 → 스크랩 +${res.n}</div></div>`;
  const p=res.part; return `<div class="pchip ic${enhClass(p)}">${partIco(p)}<div class="pn">${esc(p.name)} ${rarTag(p)}${setTag(p)}${affixTags(p)}</div><div class="ps">${SLOT_KO[p.slot]}${partStatLine(p)}</div></div>`;
}
function showReveal(results){
  const best=results.reduce((a,b)=> rankOf(b)>rankOf(a)?b:a, results[0]);
  const heroType = (best.kind==='robot'||best.kind==='dupe')? best.type : null;
  const hero = heroType ? `<div class="sprite" data-t="${rarOf(heroType)}">${sprite(heroType,false)}</div>`
             : best.kind==='part'   ? bigPartArt(best.part)
             : best.kind==='scrap'  ? currencyArt('scrap')
             : best.kind==='core'   ? currencyArt('core')
             : best.kind==='credit' ? currencyArt('credit')
                                    : bigIconArt('✕','var(--dim)');
  const list = results.length>1? `<div class="inv" style="max-height:150px;overflow:auto;width:100%">${results.map(revealCardHtml).join('')}</div>` : revealCardHtml(results[0]);
  openModal(`<div class="mhead">뽑기 결과 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <div class="reveal-hero">${hero}</div>${list}
    <button class="btn big" style="margin-top:12px" onclick="ROWAR.closeModal()">확인</button>`);
  renderGacha();
}
/* ── 개방 빛깔 ─────────────────────────────────────────────
   캡슐이 열릴 때 나오는 빛은 **그 판에서 나온 가장 높은 등급**의 색이다.

   여기에 아래 rankOf 를 쓰면 안 된다. 그건 결과 모달의 '주인공 그림' 을 고르는
   순서라 파츠만 1~4 라는 다른 눈금을 쓴다. 그래서 **SSR 파츠(4)가 크레딧(20)
   에게도 졌다** — 10연차에 크레딧이 하나만 섞이면 빛이 그쪽 색으로 갔다.
   등급끼리 견주는 자리에는 등급 눈금을 따로 둔다. */
/* 크레딧(GOLD)은 등급이 없지만 **언커먼과 레어 사이**로 친다(2026-09-19 사용자 지시). 전에는 C 바로 위(1)였다.
   파츠와 기체의 등급은 **드문 정도**로 맞췄다 — 파츠 SR 상위 18% ≈ 기체 UQ 11% 바로 아래, SSR 4% ≈ EP 3%.
   코어는 등급이 없고 뽑기 한 번 값이라 UQ 로 둔다(예전 그대로). */
const PRIZE_RANK = { C:0, UC:2, GOLD:2.5, R:3, SR:4, UQ:5, SSR:6, EP:6 };
function prizeOf(res){
  if(res.kind==='robot' || res.kind==='dupe') return rarOf(res.type);
  if(res.kind==='part')   return res.part.rarity;
  if(res.kind==='core')   return 'UQ';
  if(res.kind==='credit') return 'GOLD';
  return 'C';                       // 꽝 · 자동 분해
}
function bestPrize(results){
  return (results||[]).reduce((a,r)=>{
    const k = prizeOf(r);
    return (PRIZE_RANK[k]||0) > (PRIZE_RANK[a]||0) ? k : a;
  }, 'C');
}

/* 결과 창의 '주인공 그림' — **그 판에서 등급이 가장 높은 것**(2026-09-19 사용자 지시).
   전에는 종류로 먼저 갈랐다(새 기체 > 중복 > 코어 > 크레딧 > 스크랩 > 파츠) — 파츠가 맨 아래라,
   10연차에 SSR 파츠와 크레딧 200 이 같이 나오면 큰 그림이 동전이었다. 파츠 그림이 생기며 눈에 띄었다.
   이제 캡슐 빛깔과 **같은 눈금(PRIZE_RANK)** 으로 견준다 — 빛은 금색인데 그림은 동전인 일이 없다.
   등급이 같으면 새 기체 > 중복 기체 > 파츠 > 코어 > 크레딧 > 자동 분해 순이다. 꽝은 늘 맨 아래. */
const KIND_TIE = { robot:5, dupe:4, part:3, core:2, credit:1, scrap:0 };
function rankOf(res){
  if(!res || res.kind==='bust') return -1;
  return (PRIZE_RANK[prizeOf(res)] || 0) * 10 + (KIND_TIE[res.kind] || 0);
}
function currencyArt(kind){
  return `<img class="currency-art" src="assets/ui/coin-${kind}.png" alt="" width="120" height="120">`; }
function bigIconArt(ch,col){
  return `<div style="width:120px;height:120px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:46px;color:${col};background:radial-gradient(circle at 40% 30%,#233a63,#0c1220);border:2px solid ${col}">${ch}</div>`; }
/* 예전엔 120px 칸에 슬롯 이름 첫 글자('무')를 크게 찍었다. 파츠 그림이 생겨 그 자리에 그림을 둔다 */
function bigPartArt(p){ return partIco(p, 'lg'); }

/* ------------------------------- 대전 ------------------------------- */
/* 고른 전술. 판이 바뀌어도 그대로 두어 '늘 쓰는 전술'을 다시 고르지 않아도 되게 한다.
   기본은 균형(none)이라, 아무것도 건드리지 않으면 예전과 똑같이 싸운다. */
let _tactic='none';
function setTactic(k){ if(!CONST.TACTIC || !CONST.TACTIC[k]) return; _tactic=k;
  document.querySelectorAll('#sc-battle .tacbtn[data-k]').forEach(b=>{b.classList.toggle('on', b.dataset.k===k);b.setAttribute('aria-pressed',String(b.dataset.k===k));}); }
const tacKo = k => (CONST.TACTIC && CONST.TACTIC[k] && CONST.TACTIC[k].ko) || '균형';

let _pendingOpp=null, _battleRobot=null, battleSpeed=1;   // 기본은 등속. 빠르게 보고 싶으면 x2~x8 로 올린다
let _battleMode='arena', _battleRequest=0, _battleFindOpts;
function battleUnit(rb,parts){return {type:rb.type,level:rb.level,stats:computeStats(rb,parts),power:power(rb,parts)};}
function battleIdentity(){return {playerName:net.state.loginId||net.state.accountId||'지휘관',playerMeta:`${S.stat.wins}승 ${S.stat.losses}패`};}
function setBattleMode(mode){
  if(!BATTLE_MODES[mode])return;
  _battleMode=mode; _battleRequest++;
  toBattle();
  renderBattleHome();
}
function battleRetry(practice=false){
  if(practice)return practiceFind();
  const opp=_pendingOpp;
  if(opp?.mode==='duel')return findMatch({mode:'duel',target:opp.target||_duelTarget,pick:opp.pick});
  if(opp?.mode==='hunt'||opp?.tier)return findMatch({mode:'hunt',tier:opp.tier});
  return findMatch();
}
function renderBattleHome(searching=false){
  const rb=selRobot(),on=net.state.online,cost=sortieCost(rb),poor=S.credits<cost;
  const practice=_battleMode==='practice',duel=_battleMode==='duel';
  const brief=practice?'가상 상대와 전술을 시험하세요. 경험치·재화·피로도·전적은 변하지 않습니다.':duel?'이름으로 상대의 등록 기체를 찾습니다. 출격비·보상·레이팅 변동이 없는 친선전입니다.':!on?'서버 연결을 확인해 주세요. 연습 대전은 연결 없이도 이용할 수 있습니다.':poor?'비상 출격 · 비용 없이 전투하며 보상은 크레딧만 지급됩니다.':'플레이어를 우선 매칭합니다. 상대가 없으면 훈련 기체 또는 몬스터를 만납니다.';
  const input=duel&&!searching?`<div class="bv-duel-input"><label for="duelNick">상대 이름</label><input id="duelNick" class="duelin" placeholder="GUEST-0002" maxlength="24" value="${esc(_duelTarget||'')}" autocomplete="off" spellcheck="false" onkeydown="if(event.key==='Enter'){event.preventDefault();ROWAR.duelFind()}"></div>`:'';
  const action=practice?'practiceFind':duel?'duelFind':'findMatch';
  $('#sc-battle').innerHTML=battleView({mode:_battleMode,allies:[battleUnit(rb)],...battleIdentity(),searching,
    brief:`<p>${brief}</p>`,costLabel:practice||duel||poor?'무료':fmt(cost)+' 크레딧',rewardLabel:practice||duel?'보상 없음':poor?'크레딧':'상대·승패에 따라 결정',
    actions:input+`<button class="bv-launch" onclick="ROWAR.${action}()" ${searching||(!on&&!practice)?'disabled':''}>${searching?'탐색 중':practice?'연습 상대 찾기':'상대 찾기'} ${icon('chevron')}</button>`});
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
/* 대전 몬스터 구간과 승급 점수. 서버가 정본이다 — 불러올 때와 몬스터 판이 끝날 때 받아 적는다.
   i 가 null 이면 아직 안 잡힌 계정이고, 서버와 같은 규칙(bandStart)으로 레이팅에서 자리를 본다. */
let _band = { i:null, pts:0 };
function takeBand(b){ if(b && typeof b==='object') _band = { i: b.i ?? b.to ?? _band.i, pts: b.pts|0 }; }
function myBand(){ return bandStart(_band.i, myRating()); }
const RANK_TTL = 90000;
/* 캐시를 버릴 때 페이지도 되돌린다 — 순위가 움직였으면 다시 '내가 있는 쪽'을 열어야 한다 */
function dropRankCache(){ _rankCache=null; _rankAt=0; _rankPage=null; }

/* 한 페이지에 몇 줄. 50줄을 한 번에 깔면 훑는 것이 아니라 스크롤이 된다. */
const RANK_PAGE = 10;
let _rankPage = null;                 // null = 아직 안 정함 → 내가 있는 페이지로 연다
function rankPage(n){ _rankPage = Math.max(0, n|0); renderRank(); }

/* ── 주간 시련 ────────────────────────────────────────────
   파밍으로 만든 빌드를 **시험할 자리**다. 아레나는 매번 상대가 다르고 보상이 걸려
   있어서 '이 조합이 나은가' 를 견줄 수 없다. 여기서는 상대가 일주일 내내 고정이다.

   그래서 점수가 **결정적**이다 — 같은 빌드로 다시 눌러도 같은 점수다. 점수를 올리는
   유일한 길이 빌드를 바꾸는 것이다. 그 대신 출격비도 피로도도 횟수 제한도 없다.

   규칙(js/trial.js)은 서버와 공유한다. 여기서는 **판정하지 않는다** — 서버가 낸
   점수를 받아 적고, 재생만 같은 함수로 다시 돌린다. */
let _trial=null, _trialAt=0, _trialOwner=null;
let _raid=null, _raidAt=0, _raidOwner=null;
let _trialTab='trial', _challengeEpoch=0, _challengeAction=null;
const TRIAL_TTL=30000, RAID_TTL=20000;
function dropTrialCache(){ _trial=null; _trialAt=0; }
function dropRaidCache(){ _raid=null; _raidAt=0; }
const challengeOwner=()=>({state:S,account:net.state.accountId});
const sameChallengeOwner=o=>o?.state===S&&o.account===net.state.accountId;
const challengePending=()=>sameChallengeOwner(_challengeAction);
const challengeVisible=(epoch,owner,mode)=>epoch===_challengeEpoch&&sameChallengeOwner(owner)&&cur==='trial'&&_trialTab===mode;
function trialLead(){
  const selected=selRobot(),ids=S.squad||[];
  return selected&&(!ids.length||ids.includes(selected.uid))?selected:S.robots.find(r=>ids.includes(r.uid))||S.robots[0];
}
function raidTeam(){
  const ids=S.squad||[],selected=selRobot(),team=[];
  if(selected&&ids.includes(selected.uid))team.push(selected);
  for(const id of ids){const r=S.robots.find(x=>x.uid===id);if(r&&!team.includes(r))team.push(r);}
  if(!team.length&&S.robots[0])team.push(S.robots[0]);
  return team.slice(0,2);
}
function setTrialTab(k){ _trialTab=k==='raid'?'raid':'trial'; renderTrial(); }
async function renderTrial(){ return loadChallenge(_trialTab); }
async function renderRaid(){ return loadChallenge('raid'); }
async function loadChallenge(mode){
  const el=$('#sc-trial'),owner=challengeOwner(),epoch=++_challengeEpoch,raid=mode==='raid';
  setTerrain(null);
  const name=raid?'보스 레이드':'주간 시련';
  if(!net.state.online){el.innerHTML=challengeMessage(mode,'서버 연결이 필요합니다',`${name}의 주간 기록은 서버에서 관리됩니다. 연결 후 다시 불러오세요.`,{retry:true});return;}
  const cache=raid?_raid:_trial,at=raid?_raidAt:_trialAt,cacheOwner=raid?_raidOwner:_trialOwner;
  const fresh=cache&&sameChallengeOwner(cacheOwner)&&Date.now()-at<(raid?RAID_TTL:TRIAL_TTL)&&Date.now()<cache.endsAt;
  if(!fresh)el.innerHTML=challengeMessage(mode,`이번 주 ${raid?'보스를':'시련을'} 불러오는 중`, '상대와 도전 기록을 확인하고 있습니다.',{loading:true});
  let r;try{r=fresh?cache:await (raid?net.raid(false):net.trial(false));}catch{r=null;}
  if(!challengeVisible(epoch,owner,mode))return;
  if(!r||r.error){el.innerHTML=challengeMessage(mode,'불러오지 못했습니다',r?.error||'연결을 확인한 뒤 다시 시도하세요.',{retry:true});return;}
  if(raid){_raid=r;_raidAt=Date.now();_raidOwner=owner;drawRaid(r);}
  else{_trial=r;_trialAt=Date.now();_trialOwner=owner;drawTrial(r);}
}
function drawTrial(r){
  setTerrain(r.trial.terrain);
  const robot=trialLead();
  $('#sc-trial').innerHTML=trialChallengeView(r,{robot,power:robot?power(robot):0,pending:challengePending()});
}
function drawRaid(r){
  setTerrain(null);
  $('#sc-trial').innerHTML=raidChallengeView(r,{team:raidTeam().map(m=>({...m,power:power(m)})),pending:challengePending()});
}

/* One action per account; a completed server reward survives navigation, but an
   old response cannot start playback or overwrite another account's state. */
async function raidRunGo(){
  if(challengePending()||_trialTab!=='raid'||(cur!=='trial'&&!(cur==='battle'&&_jctx===raidPrep)))return;
  if(!net.state.online){toast('보스 레이드는 서버 연결이 필요합니다');return;}
  const token=challengeOwner(),request=_battleRequest;
  ++_challengeEpoch;
  const active=()=>sameChallengeOwner(token)&&request===_battleRequest&&_trialTab==='raid'&&(cur==='trial'||cur==='battle');
  _challengeAction=token;if(_raid&&sameChallengeOwner(_raidOwner))drawRaid(_raid);
  const button=cur==='battle'?$('#sc-battle .bv-launch'):null,label=button?.innerHTML;
  if(button){button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='교전 요청 중…';}
  try{
    const r=await net.raid(true,jointReq());
    if(!sameChallengeOwner(token))return;
    if(!r||r.error){
      if(active())toast(r?.error==='no tries left'?'오늘 도전을 다 썼습니다':r?.error==='raid already down'?'이번 주 보스는 이미 쓰러졌습니다':'공격 요청에 실패했습니다');
      dropRaidCache();return;
    }
    _raid=r;_raidAt=Date.now();_raidOwner=token;
    S.credits=r.credits;S.scrap=r.scrap;commitLocal();renderWallet();
    if(!active()){toast(`레이드 기록 완료 · 피해 ${fmt(r.damage)} · 크레딧 +${fmt(r.reward.cr)}`);return;}
    beginReplay();
    const team=r.mechs.map(m=>({name:ROBOT_TYPES[m.type].name,type:m.type,stats:m.stats,tactic:m.tactic||'none'})),foe=r.foe;
    const out=runRaid(team,{boss:foe.type,level:foe.level,stats:foe.stats,battleHp:r.battleHp,aim:foe.aim,traits:foe.traits},r.seeds);
    renderJointArena(team,foe.type,r.name,`보스 레이드 · ${r.name}`,'none','trial');
    if(!active())return;
    await bossEntrance();
    if(!active())return;
    if(!await playJoint(out.events,out.team,out.boss,active)||!active())return;
    _fight=fightJoint(out.events,team,{name:r.name,type:foe.type,stats:foe.stats,tactic:'none',traits:foe.traits||[]},r.seeds[0],foe.aim,false,true);
    renderRaidResult(r);
  }catch{if(sameChallengeOwner(token)){dropRaidCache();toast('공격 요청을 확인하지 못했습니다. 최신 기록을 다시 확인하세요.');}}
  finally{if(button?.isConnected){button.disabled=false;button.removeAttribute('aria-busy');button.innerHTML=label;}if(_challengeAction===token){_challengeAction=null;if(sameChallengeOwner(token)&&cur==='trial')renderTrial();}}
}
function renderRaidResult(r){
  shield();toBattle(null,'trial');
  $('#sc-battle').innerHTML=`<section class="tv-result ui-surface"><span class="ui-eyebrow">RAID REPORT</span><h2>${r.kill?'보스 격파':'공동 체력에 피해 반영'}</h2><p>${esc(r.name)} · 오늘 남은 도전 ${r.triesLeft} / ${r.daily}</p><div class="tv-result-grid"><div><span>이번에 반영된 피해</span><b>${fmt(r.damage)}</b></div><div><span>내 누적 피해</span><b>${fmt(r.me?.damage??r.damage)}</b></div><div><span>공동 보스 남은 체력</span><b>${r.killed?'격파됨':fmt(r.left)}</b></div></div>${r.raw>r.damage?`<p>공동 체력보다 많은 피해를 입혀, 남아 있던 ${fmt(r.damage)}만 반영했습니다.</p>`:''}<div class="tv-result-reward"><span>획득 보상</span><b>크레딧 +${fmt(r.reward.cr)}</b><b>스크랩 +${fmt(r.reward.sc)}</b></div><div class="row-btns"><button class="btn gold" onclick="ROWAR.go('trial')">레이드로 돌아가기</button><button class="btn" onclick="ROWAR.go('hangar')">출격 편성 확인</button></div></section>`;
  $('#sc-battle').insertAdjacentHTML('beforeend',analysisSlot());fillAnalysis();
}
async function trialRunGo(){
  if(challengePending()||cur!=='trial'||_trialTab!=='trial')return;
  if(!net.state.online){toast('주간 시련은 서버 연결이 필요합니다');return;}
  const token=challengeOwner(),epoch=++_challengeEpoch;
  _challengeAction=token;if(_trial&&sameChallengeOwner(_trialOwner))drawTrial(_trial);
  try{
    const r=await net.trial(true);
    if(!sameChallengeOwner(token))return;
    if(!r||r.error){toast('시련 요청에 실패했습니다');dropTrialCache();return;}
    _trial={...r,endsAt:weekEnd(r.week),winBase:TRIAL_WIN_BASE};_trialAt=Date.now();_trialOwner=token;
    if(!challengeVisible(epoch,token,'trial')){toast(`시련 기록 완료 · ${fmt(r.score)}점`);return;}
    beginReplay();
    const replayRequest=_battleRequest;
    const out=runTrial(r.stats,r.trial,'none'),M=MONSTER_TYPES[r.trial.type]||{};
    renderArena(r.robot.type,r.trial.type,ROBOT_TYPES[r.robot.type].name,M.name||r.trial.type,`주간 시련 · ${(TERRAIN[r.trial.terrain]||{}).ko||r.trial.terrain}`,null,null,'trial');
    if(arenaGone())return;
    const P=makeUnit('나',r.robot.type,out.mine),E=makeUnit(M.name||r.trial.type,r.trial.type,out.foe);
    if(!await playBattle(out.ev,P,E,{}))return;
    if(!sameChallengeOwner(token)||replayRequest!==_battleRequest||arenaGone())return;
    renderTrialResult(r);
  }catch{if(sameChallengeOwner(token)){dropTrialCache();toast('시련 요청을 확인하지 못했습니다. 최신 기록을 다시 확인하세요.');}}
  finally{if(_challengeAction===token){_challengeAction=null;if(sameChallengeOwner(token)&&cur==='trial')renderTrial();}}
}
function renderTrialResult(r){
  shield();toBattle(null,'trial');
  const best=r.me?.score??r.score;
  $('#sc-battle').innerHTML=`<section class="tv-result ui-surface"><span class="ui-eyebrow">TRIAL REPORT</span><h2>${r.win?'시련 클리어':'시련 기록 완료'}</h2><p>${r.win?'상대를 넘어선 빌드입니다.':'이번 빌드가 남긴 피해를 점수로 기록했습니다.'}</p><div class="tv-result-grid"><div><span>이번 점수</span><b>${fmt(r.score)}</b></div><div><span>내 최고 기록</span><b>${fmt(best)}</b></div><div><span>현재 순위</span><b>${r.me?.rank?`${r.me.rank} / ${fmt(r.total)}`:'—'}</b></div></div>${r.score<best?'<p>최고 기록은 유지됩니다. 낮은 점수로 이전 기록이 지워지지 않습니다.</p>':''}<p>같은 빌드에서는 결과가 같습니다. 기체나 파츠를 바꿔 다시 도전해 보세요.</p><div class="row-btns"><button class="btn gold" onclick="ROWAR.go('trial')">시련으로 돌아가기</button><button class="btn" onclick="ROWAR.go('hangar')">격납고에서 빌드 변경</button></div></section>`;
}

/* 랭킹 화면은 두 갈래다 — 순위와 도감. 칭호가 순위표에 뜨므로 한자리에 둔다. */
let _rankTab = 'rank';
let _rankEpoch = 0;
function setRankTab(k){ _rankTab = k==='codex' ? 'codex' : 'rank'; ++_rankEpoch; renderRank(); }
function rankWrap(inner){ return rankShell(_rankTab,inner,codexDueBadge()); }

async function renderRank(){
  if(_rankTab==='codex') return renderCodex();
  const el=$('#sc-rank');
  const request=++_rankEpoch,account=net.state.accountId,wrap=rankWrap;
  if(!net.state.online){
    el.innerHTML = wrap('<div class="rv-message">랭킹은 서버 연결이 필요합니다.</div>');
    return;
  }
  const fresh = _rankCache && (Date.now()-_rankAt) < RANK_TTL;
  if(!fresh) el.innerHTML = wrap('<div class="rv-message"><div class="spinner"></div><b>순위를 불러오는 중...</b></div>');

  const r = fresh ? _rankCache : await net.ranking();
  if(request!==_rankEpoch||cur!=='rank'||_rankTab!=='rank'||account!==net.state.accountId)return;
  if(r && !r.error){ _rankCache=r; _rankAt=Date.now(); }
  if(!r || r.error){
    el.innerHTML = wrap(`<div class="rv-message">순위를 불러오지 못했습니다${r&&r.error?' · '+esc(r.error):''}</div>`);
    return;
  }
  const list = r.top || [];
  const pages = Math.max(1, Math.ceil(Math.max(0,list.length-3) / RANK_PAGE));
  if(_rankPage === null){
    const mi = list.slice(3).findIndex(t=>t.me);
    _rankPage = mi >= 0 ? Math.floor(mi / RANK_PAGE) : 0;
  }
  _rankPage = Math.min(_rankPage, pages-1);
  el.innerHTML = wrap(rankingView(r,{page:_rankPage,pageSize:RANK_PAGE,titleName}));
}

/* ── 도감 ────────────────────────────────────────────────
   모은다 → 재화를 내고 활성화한다 → 이정표에 닿으면 활성화에 쓴 것을 돌려받는다(+칭호).
   **규칙은 js/codex.js 한 곳**이다 — 서버가 비용을 받고 돌려줄 때도 같은 함수로 센다.
   원본(몬스터 기록·활성화·받은 것·칭호)만 서버에서 받고, 기체·파츠는 이미 들고 있는 S 를 쓴다.

   못 만난 칸은 **실루엣 + 등급 + ?** 로 둔다(사용자 지시). 모양과 등급이 보이면
   '저 자리에 무언가 있다' 가 목표가 된다. 이름·능력치는 가린다. */
let _codexRaw = null, _codexAt = 0, _codexGroup = 'monster';
const CODEX_TTL = 60000;
/* 계정 번호가 몬스터 단계(3·4단계 확률)의 씨앗이다 — 같은 계정은 어느 기기에서 봐도 같은 단계 */
function codexNow(){ return codexView(_codexRaw || {}, S.robots || [], S.parts || [], net.state.accountId || 0); }
/* 탭 머리의 숫자 — 받을 이정표 + 켤 수 있는 칸. 원본을 아직 안 받았으면 안 띄운다. */
function codexDueBadge(){
  if(!_codexRaw) return '';
  const v = codexNow();
  const n = codexRewards(v).items.length + codexActivatable(v).list.length;
  return n ? ` <i class="cxdot">${n}</i>` : '';
}
function setCodexGroup(g){ _codexGroup = GROUPS.includes(g) ? g : 'monster'; renderCodex(); }
const costTxt = c => [c.cr?`${fmt(c.cr)} 크레딧`:'', c.co?`코어 ${c.co}`:''].filter(Boolean).join(' · ');

async function renderCodex(){
  const el=$('#sc-rank');
  const request=++_rankEpoch,account=net.state.accountId,wrap=rankWrap;
  if(!net.state.online){
    el.innerHTML = wrap('<div class="rv-message">도감은 서버 연결이 필요합니다. 처치 기록은 서버에 저장됩니다.</div>');
    return;
  }
  if(!_codexRaw || Date.now()-_codexAt > CODEX_TTL){
    if(!_codexRaw) el.innerHTML = wrap('<div class="rv-message"><div class="spinner"></div><b>도감을 펼치는 중...</b></div>');
    const r = await net.codex();
    if(request!==_rankEpoch||cur!=='rank'||_rankTab!=='codex'||account!==net.state.accountId)return;
    if(r && !r.error){ _codexRaw = r.codex; _codexAt = Date.now(); }
    if(!_codexRaw){
      el.innerHTML = wrap(`<div class="rv-message">도감을 불러오지 못했습니다${r&&r.error?' · '+esc(r.error):''}</div>`);
      return;
    }
  }
  const v = codexNow(), due = codexRewards(v), act = codexActivatable(v), titles = codexTitles(v), cx = parseCodex(_codexRaw);
  const G = [['monster','몬스터','👾'],['robot','기체','🤖'],['part','파츠','🔩']];
  const bar = g => { const c=v.count[g]; const pct=Math.round(c.on/c.total*100);
    return `<div class="cxbar"><b>${c.on}</b><span>/ ${c.total}${c.got>c.on?` · 모음 ${c.got}`:''}</span><i style="width:${pct}%"></i></div>`; };

  /* 넘은 이정표 — 활성화에 쓴 것을 돌려받는다.
     **얼마를 돌려받는지는 받기 전에 알리지 않는다**(사용자 결정 2026-09-18 — 모르고 받으면 기분이 좋다).
     금액은 '받기' 를 누른 뒤의 알림(codexClaim 의 toast)에서만 보인다. */
  const dueHtml = due.items.length ? `
    <div class="cxdue">
      <div><b>이정표 ${due.items.length}개 달성</b>
        <div class="hint">${due.items.map(x=>esc(x.label)+(x.title?` · 칭호 「${esc(titleName(x.title))}」`:'')).join(' / ')}</div></div>
      <button class="btn gold" onclick="ROWAR.codexClaim()">받기</button>
    </div>` : '';
  /* 켤 수 있는 칸 — 전부 한 번에. 한 칸씩은 카드의 버튼으로 켠다. */
  const affordAll = S.credits >= act.total.cr && S.cores >= act.total.co;
  const actHtml = act.list.length ? `
    <div class="cxact">
      <div><b>활성화 대기 ${act.list.length}칸</b> <span>${costTxt(act.total)}</span>
        <div class="hint">모은 칸은 활성화해야 이정표에 셉니다.</div></div>
      <button class="btn" ${affordAll?'':'disabled'} onclick="ROWAR.codexActivate('all')">${affordAll?'모두 활성화':'재화 부족'}</button>
    </div>` : '';

  /* 칭호는 이름만 보인다 — 무엇을 해야 얻는지는 밝히지 않는다(얻는 순간이 발견이 되게).
     아직 못 얻은 칭호는 이름이 깨진 신호처럼 흔들린다. --d 로 칭호마다 흔들리는 때를 엇갈린다 —
     한꺼번에 흔들리면 화면 전체가 떨린다. */
  const tHtml = titles.map((t, i) => {
    const on = cx.t === t.id;
    return t.got
      ? `<button class="cxt got${on?' on':''}" onclick="ROWAR.codexTitle('${on?'':t.id}')" title="${on?'떼기':'달기'}">${esc(t.name)}${on?' ✓':''}</button>`
      : `<span class="cxt lock"><span class="gl" data-t="${esc(t.name)}" style="--d:${(i*0.73%3.2).toFixed(2)}s"><span class="gm">${esc(t.name)}</span></span></span>`;
  }).join('');

  const tabs = G.map(([g,ko,em]) => `<button class="gtab ${_codexGroup===g?'on':''}" aria-pressed="${_codexGroup===g}" onclick="ROWAR.setCodexGroup('${g}')">
      <em>${em}</em> ${ko}${bar(g)}</button>`).join('');

  /* 다음 이정표 — 몇 칸 더 켜면 닿나. 이게 이 화면의 목표다.
     돌려받는 금액과 칭호 이름은 적지 않는다 — 둘 다 닿은 뒤에 알게 한다. */
  const nx = codexNext(v, _codexGroup);
  const nextHtml = nx ? `<div class="cxnext">다음 이정표 <b>${GROUP_KO[_codexGroup]} ${nx.n}칸</b> · ${nx.left}칸 남음
      ${nx.title?' · 새 칭호':''}</div>`
    : `<div class="cxnext">${GROUP_KO[_codexGroup]} 이정표를 모두 넘었습니다</div>`;

  /* 칸의 아래줄 — 모았으면 활성화 버튼, 켰으면 표시, 못 모았으면 ? */
  const foot = x => x.on ? '<span class="cxon">활성</span>'
    : x.got ? `<button class="cxbtn" onclick="ROWAR.codexActivate('${x.key}')" title="${costTxt(x.cost)}">활성화 · ${costTxt(x.cost)}</button>`
    : '';
  const cls = x => x.on ? 'done' : x.got ? 'got' : 'unk';

  let body = '';
  if(_codexGroup==='monster'){
    /* 몬스터는 단계가 있다(js/codex.js monTier). 모으기 전에는 '처치 3 / 5' 로 문턱까지 남은 수를,
       활성화한 뒤에는 단계와 다음 목표를 적는다. 3·4단계는 문턱을 넘은 뒤 처치마다 확률이라 '기회' 로만 적는다.
       테두리 색은 **활성화한 카드에만** — 켜야 도감에 오른 것이다(2 동 · 3 은 · 4 금). */
    const monT1 = r => ((CONST.CODEX.mon || {})[r] || { t: [1] }).t[0];
    const tierFoot = m => {
      if(!m.on) return foot(m);
      const nx = m.next;
      /* 카드가 좁다(모바일 70px 남짓) — 한 줄에 들어가게 짧게 */
      const sub = !nx ? '최고 단계'
        : nx.chance ? `처치마다 ${m.tier+1}단계 기회`
        : `${m.tier+1}단계 ${fmt(m.kills)}/${fmt(nx.need)}`;
      return `<div class="cxtier"><b>${m.tier}단계</b><i>${'◆'.repeat(m.tier)}${'◇'.repeat(Math.max(0,4-m.tier))}</i><span>${sub}</span></div>`;
    };
    body = `<div class="cxgrid">${v.monsters.map(m => {
      const T = MONSTER_TYPES[m.id];
      const known = m.seen > 0;
      const need = m.next && !m.got ? m.next.need : 0;
      const state = need ? (known ? `처치 ${fmt(m.kills)} / ${fmt(need)}` : '?')
        : m.kills ? `처치 ${fmt(m.kills)}` : known ? '만났다 · 미처치' : '?';
      return `<div class="cxc ${known && !m.got ? 'seen' : cls(m)}${m.on && m.tier >= 2 ? ' t' + m.tier : ''}" data-t="${m.rarity}">
        <div class="cxs">${sprite(m.id,false)}${known?'':'<i class="q">?</i>'}</div>
        <div class="cxn">${known?esc(T.name):'???'}</div>
        <div class="cxm"><span class="tag ${m.rarity==='BOSS'?'monster-tag':'rr-'+m.rarity}">${m.rarity}</span> ${state}</div>
        ${tierFoot(m)}
      </div>`; }).join('')}</div>
      <div class="hint">같은 몬스터를 <b>여러 번 이겨야</b> 모입니다(보통 ${monT1('C')}번 · 에픽 ${monT1('EP')}번 · 보스 ${monT1('BOSS')}번). 대전·파견·전선·점령·시련·레이드 어디서든 됩니다.
        활성화한 뒤에도 더 잡을수록 <b>단계</b>가 올라 카드 테두리가 바뀝니다 — 2단계 동 · 3단계 은 · 4단계 금. 3·4단계는 운도 따릅니다.</div>`;
  } else if(_codexGroup==='robot'){
    body = `<div class="cxgrid">${v.robots.map(r => {
      const T = ROBOT_TYPES[r.id];
      return `<div class="cxc ${cls(r)}" data-t="${r.rarity}">
        <div class="cxs">${sprite(r.id,false)}${r.got?'':'<i class="q">?</i>'}</div>
        <div class="cxn">${r.got?esc(T.name):'???'}</div>
        <div class="cxm"><span class="tag rr-${r.rarity}">${r.rarity}</span> ${r.got?esc(T.role.split('·')[0].trim()):'?'}</div>
        ${foot(r)}
      </div>`; }).join('')}</div>
      <div class="hint">한 번이라도 가져 본 기체는 분해해도 도감에 남습니다.</div>`;
  } else {
    /* 파츠는 21종 × 4등급 표. 칸 하나가 곧 활성화 버튼이다. */
    const RARS = RARITY.map(r=>r.k);
    const bySlot = {};
    for(const p of v.parts){ ((bySlot[p.slot] ||= {})[p.base] ||= {})[p.rarity] = p; }
    const td = p => p.on ? `<td class="on" title="활성">●</td>`
      : p.got ? `<td class="got"><button onclick="ROWAR.codexActivate('${p.key}')" title="활성화 · ${costTxt(p.cost)}">○</button></td>`
      : `<td class="off">?</td>`;
    body = `<table class="cxpt"><thead><tr><th>파츠</th>${RARS.map(r=>`<th><span class="tag rar-${r}">${r}</span></th>`).join('')}</tr></thead><tbody>
      ${SLOTS.map(sl => `<tr class="sl"><td colspan="${RARS.length+1}">${SLOT_KO[sl]}</td></tr>` +
        Object.entries(bySlot[sl]||{}).map(([b,row]) => {
          const any = RARS.some(r=>row[r] && row[r].got);
          /* 모은 줄은 파츠 그림, 못 모은 줄은 흐린 슬롯 그림 — 진짜 그림을 먼저 보여 주면 이름을 가린 뜻이 없다 */
          return `<tr><td class="pb">${any?partIco({base:b, slot:sl},'xs'):slotIco(sl,'xs')} ${any?esc(PART_BASES[b].ko):'???'}</td>${RARS.map(r => td(row[r])).join('')}</tr>`; }).join('')
      ).join('')}
      </tbody></table>
      <div class="hint">● 활성 · ○ 모았음(눌러서 활성화) · ? 아직. 활성화 값 — ${RARS.map(r=>`${r} ${costTxt(actCost('part', r))}`).join(' / ')}</div>`;
  }

  const totalOn=GROUPS.reduce((n,g)=>n+v.count[g].on,0),total=GROUPS.reduce((n,g)=>n+v.count[g].total,0);
  el.innerHTML = wrap(`<section class="cv-hero"><span>ARCHIVE · COLLECTION</span><h2>전장의 모든 흔적</h2><p>만난 적, 지휘한 기체, 획득한 파츠를 기록하고 활성화하세요.</p></section>
    <div class="cv-summary">${G.map(([g,ko])=>`<div><span>${ko}</span><b>${v.count[g].on} / ${v.count[g].total}</b><small>활성화한 기록</small></div>`).join('')}</div>
    <div class="cv-actions">${dueHtml}${actHtml}</div>
    <div class="cv-layout"><div class="cv-main"><div class="cv-tabs" role="group" aria-label="도감 종류">${tabs}</div><section class="cv-catalog" aria-label="${GROUP_KO[_codexGroup]} 도감">${nextHtml}${body}</section></div>
    <aside class="cv-side"><section class="cv-titles"><span class="rv-eyebrow">HONORS</span><h3>칭호</h3><p>획득한 칭호를 달면 순위표의 이름 옆에 표시됩니다. 전체 ${totalOn} / ${total}칸 활성화.</p><div class="cxts">${tHtml}</div></section></aside></div>`);
}

/* 서버가 확정한 재화를 받아 적는다 — 도감 쪽 세 동작이 같이 쓴다. */
function codexApply(r){
  S.credits = r.credits; S.cores = r.cores;
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){}
  net.cancelSync();
  renderWallet();
}
async function codexRetry(r, what){
  if(r && r.status===409){ _codexAt = 0; if(cur==='rank'&&_rankTab==='codex')await renderCodex(); toast('기록이 방금 바뀌었습니다 — 다시 눌러 주세요'); return true; }
  if(r && r.error==='not enough'){ toast(`재화가 모자랍니다 · 필요 ${costTxt(r.need||{})}`); return true; }
  toast(what+(r&&r.error?' · '+r.error:'')); return true;
}
async function codexActivate(key){
  const account=net.state.accountId,state=S;
  const r = await net.codex('activate', { keys: key==='all' ? 'all' : [key] });
  if(account!==net.state.accountId||state!==S)return;
  if(!r || r.error) return codexRetry(r, '활성화하지 못했습니다');
  codexApply(r);
  const cx = parseCodex(_codexRaw); for(const k of r.activated) cx.a[k]=1; _codexRaw = cx;
  if(cur==='rank'&&_rankTab==='codex')renderCodex();
  const due = codexRewards(codexNow()).items.length;
  toast(`${r.activated.length}칸 활성화 · ${costTxt(r.spent)}` + (due?` · 이정표 ${due}개 달성 — 받기를 누르세요`:''));
}
async function codexClaim(){
  const account=net.state.accountId,state=S;
  const r = await net.codex('claim');
  if(account!==net.state.accountId||state!==S)return;
  if(!r || r.error) return codexRetry(r, '받지 못했습니다');
  codexApply(r);
  const cx = parseCodex(_codexRaw);
  for(const x of r.claimed) cx.c[x.key]=1;
  _codexRaw = cx; _codexAt = 0;                  // 돌려받은 칸 표시(rf)는 서버에서 다시 받는다
  if(cur==='rank'&&_rankTab==='codex')await renderCodex();
  const t = r.claimed.filter(x=>x.title).map(x=>titleName(x.title)).filter(Boolean);
  toast(`이정표 ${r.claimed.length}개 · ${costTxt(r.total)||'환급 없음'} 돌려받음` + (t.length?` · 칭호 「${t.join('」「')}」 열림`:''));
}
async function codexTitle(id){
  const account=net.state.accountId,state=S;
  const r = await net.codex('title', { id: id || null });
  if(account!==net.state.accountId||state!==S)return;
  if(!r || r.error){ toast('칭호를 바꾸지 못했습니다'+(r&&r.error?' · '+r.error:'')); return; }
  const cx = parseCodex(_codexRaw); cx.t = r.title; _codexRaw = cx;
  dropRankCache();                               // 순위표에 뜨는 칭호가 바뀌었다
  if(cur==='rank'&&_rankTab==='codex')renderCodex();
  toast(r.title ? `칭호 「${titleName(r.title)}」 을(를) 달았습니다` : '칭호를 뗐습니다');
}

/* 상대는 서버가 고른다. 상대 레벨이 보상에 들어가므로 클라가 고르게 두면
   만렙 상대만 잡아 경험치를 부풀릴 수 있다. */
async function findMatch(opts){
  toBattle(null,opts?.mode==='hunt'?'hunt':'battle');
  const request=++_battleRequest,account=net.state.accountId,state=S;
  _battleFindOpts=opts?{...opts}:undefined;
  _battleMode=opts?.mode==='duel'?'duel':'arena';
  renderBattleHome(true);

  if(!net.state.online){ renderBattleHome(); toast('대전은 서버 연결이 필요합니다'); return; }
  const [r] = await Promise.all([net.battleFind(opts), sleep(1000)]);   // 연출용 최소 대기
  if(request!==_battleRequest||cur!=='battle'||account!==net.state.accountId||state!==S)return;
  if(!r || r.error){
    if(r && r.need!=null){ go('hunt'); toast(`크레딧이 모자랍니다 · 필요 ${fmt(r.need)} / 보유 ${fmt(r.have)}`); return; }
    if(r && r.error==='hunt limit'){ go('hunt'); toast(`이번 주 ${HUNT_KO[r.tier]||''} 토벌 한도를 다 썼습니다 · ${huntResetTxt(r.resetAt)}`); return; }
    renderBattleHome();
    toast(r && r.error==='target is self' ? '자기 자신과는 붙을 수 없습니다'
      : r && r.error==='target not found'
        ? `'${esc(r.target||'')}' 을(를) 찾을 수 없습니다 — 이름이 정확한지, 그 사람이 한 번이라도 접속했는지 확인하세요`
        : '상대를 찾지 못했습니다'+(r&&r.error?': '+r.error:'')); return;
  }

  setPending(r.opponent, r.cost, r.rescue, r.tier, r.mode, r);
  showOpponent(_pendingOpp);
}

function setPending(o, cost, rescue, tier, mode, duel){
  _pendingOpp = o ? { kind:o.kind, callsign:o.callsign, rating:o.rating,
    robot:{ uid:'E', type:o.type, level:o.level, skillLv:o.skillLv|0, fat:0, slots:o.slots },
    parts:o.parts, bench:o.bench||[], band:o.band||null, bandTotal:o.bandTotal||null, bandGoal:o.bandGoal||null,
    cost:cost|0, rescue:!!rescue, tier:tier||null, mode:mode||null,
    joint:o.joint||null,                 // 합동전(토벌 보스) — 조준과 요구 조건. 있으면 편성 화면이 뜬다
    /* 지목 대전이면 상대 편성 목록과 지금 고른 칸을 함께 들고 다닌다 —
       상대 카드에서 바로 다른 기체로 바꿔 끼울 수 있어야 하기 때문이다. */
    choices:(duel&&duel.choices)||null, pick:(duel&&duel.pick)|0, target:(duel&&duel.target)||null } : null;
}

/* ── 지목 대전 ── 닉네임으로 특정 상대를 부른다.
   서버가 친선전으로 처리한다(출격비·보상·레이팅 없음). 여기서는 이름만 넘긴다 —
   못 찾으면 서버가 404 를 주고, 그때 다른 상대로 바꾸지 않고 그대로 알린다.
   조용히 아무나 붙여 주면 '누구와 붙었는지'가 달라져 기능이 거짓말을 한다. */
let _duelTarget=null;
async function duelFind(){
  const el=$('#duelNick'), nick=((el&&el.value)||'').trim();
  if(!nick){ toast('상대 이름을 입력하세요'); if(el) el.focus(); return; }
  _duelTarget=nick;
  await findMatch({ mode:'duel', target:nick, pick:0 });
}
/* 상대 카드에서 편성의 다른 기체로 바꿔 끼운다. 서버가 상대를 다시 잡아 주므로
   시드도 새로 나온다 — 같은 기체를 다시 고르면 같은 판이 아니라 새 판이다. */
async function duelPick(i){
  const t=(_pendingOpp && _pendingOpp.target) || _duelTarget;
  if(!t) return;
  if(_pendingOpp && (_pendingOpp.pick|0)===(i|0)) return;   // 이미 고른 칸이면 요청을 쓰지 않는다
  await findMatch({ mode:'duel', target:t, pick:i|0 });
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
let _dispatchFilter='all',_dispatchTab='missions',_dispatchSelected='exped:SHORT',_dispatchUid=null,_dispatchPending=null,_dispatchWeekReset=0;
function dispatchRobot(){
  return S.robots.find(r=>r.uid===_dispatchUid&&r.uid!==S.expd?.uid)
    || S.robots.find(r=>!S.squad.includes(r.uid)&&r.uid!==S.expd?.uid)
    || selRobot();
}
function dispatchOptions(){
  const boss=jointLead();
  return dispatchMissions({expeditionLevel:dispatchRobot().level,huntLevel:selRobot().level,sortieCost:sortieCost(selRobot()),bossLevel:boss.level,bossCost:sortieCost(boss),credits:S.credits,weekly:huntNow()});
}
function renderDispatch(){
  const missions=dispatchOptions();
  if(!missions.some(m=>m.key===_dispatchSelected))_dispatchSelected=missions[0].key;
  const selected=missions.find(m=>m.key===_dispatchSelected),rb=selected.kind==='exped'?dispatchRobot():selected.tier==='BOSS'?jointLead():selRobot();
  _dispatchWeekReset=huntNow().resetAt;
  $('#sc-hunt').innerHTML=dispatchView({missions,selected:_dispatchSelected,filter:_dispatchFilter,tab:_dispatchTab,robot:rb,robotPower:power(rb),inSquad:S.squad.includes(rb.uid),
    expedition:S.expd,expeditionRobot:S.robots.find(r=>r.uid===S.expd?.uid),online:net.state.online,pending:!!_dispatchPending,canSend:S.robots.length>1&&rb.uid!==S.expd?.uid,weeklyReset:huntResetTxt(_dispatchWeekReset)});
}
function setDispatchFilter(filter){
  if(!['all','exped','hunt'].includes(filter))return;
  _dispatchFilter=filter;_dispatchTab='missions';
  if(filter!=='all'&&!_dispatchSelected.startsWith(filter+':'))_dispatchSelected=dispatchOptions().find(m=>m.kind===filter).key;
  renderHunt();
}
function setDispatchTab(tab){if(!['missions','status'].includes(tab))return;_dispatchTab=tab;renderHunt();}
function setDispatchMission(kind,tier){
  const key=kind+':'+tier;if(!dispatchOptions().some(m=>m.key===key))return;
  _dispatchSelected=key;_dispatchTab='missions';renderHunt();
  if(window.matchMedia('(max-width:700px)').matches)$('#dv-preparation')?.scrollIntoView({block:'nearest',behavior:'auto'});
}
function pickDispatchRobot(){
  if(_dispatchPending)return;
  const tier=_dispatchSelected.split(':')[1];if(!CONST.EXPED[tier])return;
  const cards=S.robots.filter(r=>r.uid!==S.expd?.uid).map(r=>{
    const rw=expeditionEstimate(tier,r.level);
    return `<button onclick="ROWAR.selectDispatchRobot('${esc(r.uid)}')">${sprite(r.type,false)}<span><b>${esc(ROBOT_TYPES[r.type].name)} · Lv.${r.level}</b><small>크레딧 ${fmt(rw.cr)} · 스크랩 ${fmt(rw.sc)}</small><em>${S.squad.includes(r.uid)?'편성 중 · 보내면 편성에서 제외':'대기 기체'}</em></span>${icon('chevron')}</button>`;
  }).join('');
  openModal(`<div class="mhead">파견 기체 선택<button class="mx" onclick="ROWAR.closeModal()" aria-label="닫기">×</button></div><p class="hint">기체를 고른 뒤 파견 시작을 눌러 출발합니다.</p><div class="dv-picker">${cards}</div>`);
}
function selectDispatchRobot(uid){
  if(_dispatchPending||!S.robots.some(r=>r.uid===uid&&r.uid!==S.expd?.uid))return;
  _dispatchUid=uid;closeModal();renderHunt();
}
async function launchDispatch(){
  if(!net.state.online){toast('서버 연결이 필요합니다');return;}
  if(_dispatchPending)return;
  const m=dispatchOptions().find(x=>x.key===_dispatchSelected);if(!m)return;
  if(m.kind==='exped')return sendExped(m.tier,dispatchRobot().uid);
  if(m.blocked){toast(m.blocked);return;}
  return hunt(m.tier);
}
async function dispatchRequest(action,args){
  const token={account:net.state.accountId,state:S};_dispatchPending=token;
  if(cur==='hunt')renderHunt();
  try{
    const result=await net.expedition(action,args);
    return token.account===net.state.accountId&&token.state===S?result:null;
  }finally{
    if(_dispatchPending===token){_dispatchPending=null;if(cur==='hunt')renderHunt();}
  }
}
function tickDispatch(){
  if(cur!=='hunt')return;
  if(_dispatchWeekReset!==huntNow().resetAt){renderHunt();return;}
  const p=expeditionProgress(S.expd);if(!p)return;
  const label=$('#dv-countdown'),fill=$('#dv-progress-fill'),button=$('#dv-claim'),status=$('#dv-progress-label');
  if(label)label.textContent=p.done?'수령 가능':p.clock;
  if(status)status.textContent=p.done?'귀환 완료':'귀환까지';
  if(fill){fill.style.width=p.percent+'%';fill.parentElement.setAttribute('aria-valuenow',String(Math.floor(p.percent)));}
  if(button){button.disabled=!p.done||!net.state.online||!!_dispatchPending;button.textContent=_dispatchPending?'요청 처리 중':p.done?'보상 받기':'원정 진행 중';}
}
function expedReward(tier, lv){
  return expeditionEstimate(tier,lv);
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
    <div class="hint"><b>보낸 기체는 그동안 출격할 수 없습니다</b> · 한 번에 한 기 · 위 수치는 Lv.${selRobot().level} 기준</div>
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
  if(_dispatchPending||!net.state.online||!CONST.EXPED[tier])return;
  if(S.expd){toast('이미 원정 중인 기체가 있습니다');return;}
  if(S.robots.length<2){toast('출격할 기체를 한 기 이상 남겨야 합니다');return;}
  if(!S.robots.some(x=>x.uid===uid))return;
  closeModal();
  const r=await dispatchRequest('send',{tier, robotUid:uid});
  if(!r) return;
  if(r.error){ toast(ERR_KO[r.error]||('실패: '+r.error)); return; }
  const rb=S.robots.find(x=>x.uid===uid);
  S.expd={ tier, level:rb?rb.level:1, endsAt:r.endsAt, uid, ready:false };
  S.squad=S.squad.filter(u=>u!==uid);
  if(!S.squad.length){ const alt=S.robots.filter(x=>x.uid!==uid).sort((a,b)=>b.level-a.level)[0]; if(alt) S.squad=[alt.uid]; }
  if(!S.squad.includes(S.robots[S.sel].uid)) S.sel=S.robots.findIndex(x=>x.uid===S.squad[0]);
  _pendingOpp=null;                       // 서버가 잡아 둔 상대를 놓았다
  commitLocal(); if(cur==='hunt')renderHunt();else renderAll();
  toast(CONST.EXPED[tier].ko+' 출발 · '+CONST.EXPED[tier].h+'시간 뒤 귀환');
}
async function claimExped(){
  if(_dispatchPending||!net.state.online||!S.expd||S.expd.endsAt>Date.now())return;
  const r=await dispatchRequest('claim',{});
  if(!r) return;
  if(r.error){ toast(ERR_KO[r.error]||('실패: '+r.error)); return; }
  S.credits=r.player.credits; S.cores=r.player.cores; S.scrap=r.player.scrap;
  if(r.reward.part) addPart(r.reward.part);
  S.expd=null; commitLocal(); if(cur==='hunt')renderHunt();else renderAll(); renderWallet();
  const g=[`크레딧 +${fmt(r.reward.cr)}`,`스크랩 +${fmt(r.reward.sc)}`];
  if(r.reward.core) g.push(`코어 +${r.reward.core}`);
  if(r.reward.part) g.push(`파츠 ${r.reward.part.name}`);
  toast('원정 귀환 · '+g.join(' · '));
}

function renderHunt(){
  if(document.body.classList.contains('ui-v2'))return renderDispatch();
  const rb=selRobot();
  if(!net.state.online){
    $('#sc-hunt').innerHTML = `<div class="hx">${renderExped()}
      <div class="panel"><h2 class="title" style="margin-top:0">토벌</h2>
        <div class="hint">토벌은 서버 연결이 필요합니다. 보상을 서버가 판정합니다.</div></div></div>`;
    return;
  }
  const hw = huntNow();
  const rows = Object.keys(CONST.HUNT).map(t=>{
    /* 보스는 합동전 — 출격비와 보스 레벨을 편성 중 높은 레벨 기체에 맞춘다(서버와 같은 규칙) */
    const base = t==='BOSS' ? jointLead() : rb;
    const H=CONST.HUNT[t], cost=Math.ceil(sortieCost(base)*H.costX);
    /* 주간 한도(UQ · EP · BOSS). 다 쓰면 줄을 잠근다 — 서버도 막지만 누르고 나서 알면 헛걸음이다 */
    const wk = hw.tiers[t], out = !!(wk && wk.used >= wk.cap), poor = S.credits<cost || out;
    /* 상대 레벨 상한은 MAXLV 가 아니라 MAXLV+OPP_LV_OVER 다(js/rewards.js 의 oppLvMax) — 보스가 Lv.60 으로 보였다 */
    const lv=Math.max(1,Math.min(MAXLV+(CONST.OPP_LV_OVER||0), base.level+H.lv));
    /* 보스는 무엇이 나오는지 밝히지 않는다. 나머지 등급은 이름을 보고 상성을 준비하는
       것이 판단인데, 보스까지 미리 알면 마지막 관문이 그냥 한 줄 더 비싼 사냥터가 된다. */
    const names = t==='BOSS' ? '??? · 합동전 — 편성 두 기가 함께 싸웁니다'
      : (MONSTER_BY_RARITY[t]||[]).map(id=>MONSTER_TYPES[id].name).join(' · ');
    return `<button class="hunt-row${poor?' poor':''}${wk?' cap':''}" ${poor?'disabled':''} onclick="ROWAR.hunt('${t}')">
      <!-- 등급 색은 .rr-* 다. .rar-* 는 파츠 등급(C/R/SR/SSR)이라 UC·UQ·EP 규칙이 아예 없어,
           정예·초희귀·전설 세 줄만 색 없이 회색으로 떴다. -->
      <div class="ht"><span class="tag rr-${t}">${HUNT_KO[t]}</span>
        <b>Lv.${lv}</b></div>
      <div class="hn${t==='BOSS'?' unknown':''}">${names}</div>
      <div class="hd">스크랩 ×${H.scX} · 파츠 ${Math.round(H.partP*100)}%${H.coreP?` · 코어 ${Math.round(H.coreP*100)}%`:''}</div>
      ${wk ? `<div class="hw${out?' out':''}">이번 주 ${wk.used} / ${wk.cap}</div>` : ''}
      <div class="hc ${S.credits<cost?'bad':''}">${fmt(cost)}</div>
    </button>`;
  }).join('');
  /* 넓은 화면에서는 원정과 토벌을 나란히 둔다. 한 단으로 쌓으면 1,280px 짜리 줄에
     딱지와 이름만 왼쪽에 붙고 가운데가 통째로 빈다. 900px 미만에서는 예전처럼 쌓인다. */
  $('#sc-hunt').innerHTML = `<div class="hx">${renderExped()}
    <div class="panel">
      <h2 class="title" style="margin-top:0">토벌 · 사냥터</h2>
      <div class="hint"><b>스크랩과 파츠</b>를 얻습니다 · 크레딧은 적고 <b>경험치는 거의 없으며</b> 순위는 오르지 않습니다 · 등급이 높을수록 강합니다</div>
      <div class="hunt-list" style="margin-top:10px">${rows}</div>
      <div class="hint" style="margin-top:8px">출전 · ${ROBOT_TYPES[rb.type].name} Lv.${rb.level} · 보유 ${fmt(S.credits)} 크레딧</div>
      <div class="hint">${Object.keys(hw.tiers).map(t=>HUNT_KO[t]).join(' · ')} 토벌은 주마다 들어갈 수 있는 횟수가 정해져 있습니다 · ${huntResetTxt(hw.resetAt)}</div>
    </div></div>`;
}
function hunt(tier){ return findMatch({ mode:'hunt', tier }); }

/* 토벌 주간 입장 수. 서버가 state · 전투 응답에 실어 보낸다(huntWeekView).
   받은 것이 지난주 것이면(초기화 시각을 넘겼으면) 0 으로 본다 — 일요일 0시를 넘겨 켜 둔 화면도 맞게. */
let _huntWk = null;
function huntNow(){
  const now = Date.now();
  if(_huntWk && _huntWk.resetAt > now) return _huntWk;
  return huntWeekView(null, now);
}
function huntResetTxt(at){
  const ms = Math.max(0, (at || huntResetAt(Date.now())) - Date.now());
  const h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
  return `일요일 0시에 풀립니다(${d ? `${d}일 ${h % 24}시간` : h ? `${h}시간` : `${Math.max(1, Math.ceil(ms / 60000))}분`} 뒤)`;
}

/* '한 판 더' — 서버가 직전 응답에 다음 상대를 실어 보내므로 왕복이 필요 없다.
   (예전에는 여기서 findMatch 를 불러 한 판마다 요청을 두 번 썼다)
   미리 받은 게 없거나 만료됐으면 그때만 다시 찾는다. */
function nextMatch(){
  if(!_pendingOpp) return findMatch(_battleFindOpts);
  toBattle(null,_pendingOpp.mode==='hunt'?'hunt':'battle');
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
  const o=_makeOpponent(owned, my.level, R, ()=>'E'+uid(), false, myRating(), myBand());
  const rb={uid:'E'+uid(), type:o.type, level:o.level, skillLv:o.skillLv|0, slots:o.slots};
  return {kind:o.kind==='monster'?'monster':'robot', robot:rb, parts:o.parts, callsign:o.callsign,
          band:o.band||null, bandTotal:(CONST.MON_BAND||[]).length||null,
          bandGoal:o.kind==='monster'?bandGoal(myBand(), _band.pts):null};
}
/* 상대 카드.
   전투력만 보여 주면 '이길지 질지'만 알 뿐 **무엇을 바꿀지**를 알 수 없다.
   방어·회피·속도를 내 값과 나란히 놓고, 상대 스킬도 함께 보여 준다.
   그래야 편성한 두 기 중 무엇을 낼지, 어떤 파츠를 낄지가 판단이 된다. */
function showOpponent(opp, practice){
  if(opp.joint && !practice) return showJoint(opp);   // 토벌 보스는 합동전 편성 화면(2026-09-21)
  shield();
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

  const mode=practice?'practice':opp.mode==='duel'?'duel':'arena';
  _battleMode=mode;
  const tactics=`<div class="tacwrap"><div class="tachead">전술 지시 <small>상대의 스킬을 보고 고르세요</small></div><div class="tacrow">${Object.entries(CONST.TACTIC||{}).map(([k,t])=>`<button class="btn tacbtn${k===_tactic?' on':''}" data-k="${k}" aria-pressed="${k===_tactic}" onclick="ROWAR.setTactic('${k}')"><b>${t.ko}</b><span>${t.desc||''}</span></button>`).join('')}</div></div>`;
  const choices=opp.mode==='duel'&&opp.choices?.length>1?`<div class="tacwrap"><div class="tachead">상대 편성 <small>대결할 기체를 선택하세요</small></div><div class="tacrow">${opp.choices.map(c=>{
    const CT=COMBAT_TYPES[c.type]; if(!CT)return '';
    return `<button class="btn tacbtn${c.i===opp.pick?' on':''}" aria-pressed="${c.i===opp.pick}" onclick="ROWAR.duelPick(${c.i|0})"><b>${CT.name} · Lv.${c.level}</b><span>전투력 ${fmt(c.power)}</span></button>`;
  }).join('')}</div></div>`:'';
  const intel=`<details class="bv-intel"><summary>기체 분석 · 스킬과 장비 비교</summary><div class="oppstats">${['def','eva','spd'].map(cmp).join('')}</div>${oppGear(opp)}<div class="monster-skill"><strong>${T.skill.name}</strong><span class="fxrow">${fxTags(opp.robot.type)}</span><span>${T.skill.desc}</span></div><div class="my-skill"><strong>내 스킬 · ${COMBAT_TYPES[my.type].skill.name}</strong><span class="fxrow">${fxTags(my.type)}</span><span>${COMBAT_TYPES[my.type].skill.desc}</span></div></details>`;
  const brief=practice?'연습 대전 · 경험치·재화·피로도·전적은 변하지 않습니다.':opp.mode==='duel'?'친선 대전 · 출격비·보상·전적·레이팅 변동이 없습니다.':opp.rescue?'비상 출격 · 출격비 없이 전투합니다. 보상은 크레딧만 지급됩니다.':opp.tier?`토벌 ${HUNT_KO[opp.tier]||opp.tier} · 상대를 확인하고 전술을 선택하세요.`:'기체와 전술을 확인하세요. 전투는 자동으로 진행됩니다.';
  $('#sc-battle').innerHTML=battleView({mode,allies:[battleUnit(my)],enemies:[battleUnit(opp.robot,opp.parts||[])],...battleIdentity(),
    enemyName:opp.callsign,enemyMeta:`${monster?'몬스터 · 위험도 '+T.rarity:opp.kind==='player'?'플레이어':'훈련 기체'}${opp.band?' · 구간 '+opp.band+'/'+(opp.bandTotal||12):''}`,
    brief:`<p>${esc(brief)}</p>${bandLine(opp.bandGoal)}`,costLabel:practice||opp.mode==='duel'||opp.rescue?'무료':fmt(opp.cost)+' 크레딧',rewardLabel:practice||opp.mode==='duel'?'보상 없음':opp.rescue?'크레딧':'상대·승패에 따라 결정',
    actions:`<button class="bv-launch" onclick="ROWAR.${practice?'practiceStart':'startBattle'}()">전투 시작 ${icon('chevron')}</button><button class="btn ghost" onclick="ROWAR.battleRetry(${!!practice})">다시 찾기</button>`,
    details:relayPreview(opp,practice)+choices+tactics+(notes.length?`<div class="oppnote">${notes.map(n=>`<div>· ${n}</div>`).join('')}</div>`:'')+intel});
}
function relayPreview(opp,practice){
  const own=jointBase().map(u=>S.robots.find(r=>r.uid===u)).filter(Boolean);
  if(practice||!CONST.RELAY.on||opp.mode==='hunt'||own.length<2||!opp.bench?.length)return '';
  const foe=opp.bench[0],rb=own[1];
  return `<section class="bv-relay ui-surface"><h3>교대 대전 · 양쪽 2기</h3><p>선봉이 격추되면 예비가 이어서 싸웁니다. 위 전력 비교는 선봉 기준입니다. 예비 전술은 선봉의 전술을 따릅니다.</p><div><span>${sprite(rb.type,false)}<b>우리 예비 · ${esc(ROBOT_TYPES[rb.type].name)} · Lv.${rb.level}</b></span><span>${sprite(foe.type,false)}<b>상대 예비 · ${esc(foe.name||COMBAT_TYPES[foe.type]?.name||foe.type)} · Lv.${foe.level}</b></span></div></section>`;
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
  _battleRequest++;
  toBattle();
  const o=makeOpponent();
  _practiceOpp={ ...o, rating:null, seed:(Math.random()*0xffffffff)>>>0 };
  showOpponent(_practiceOpp, true);
}

async function practiceStart(){
  beginReplay();
  const opp=_practiceOpp; if(!opp) return;
  const my=selRobot(); _battleRobot=my;

  /* 지금 피로도 그대로 싸운다(전투에 영향이 있으니까). 다만 늘리지는 않는다. */
  /* 상대 전술은 서버와 **같은 함수·같은 시드 섞기**로 뽑는다. 규칙이 한 곳에만 있어야
     연습과 실전이 다른 게임이 되지 않는다. */
  const tacE=pickTactic(opp.robot.type, mulberry32(((opp.seed>>>0) ^ 0x9e3779b9)>>>0));
  const P=makeUnit(ROBOT_TYPES[my.type].name, my.type, computeStats(my), _tactic);
  const E=makeUnit(opp.callsign, opp.robot.type, computeStats(opp.robot, opp.parts), tacE);
  const events=simulate(P,E,opp.seed);
  const statP=computeStats(my), statE=computeStats(opp.robot, opp.parts);
  renderArena(my.type, opp.robot.type, P.name, E.name, null, _tactic, tacE);

  if(rarOf(opp.robot.type)==='BOSS') await bossEntrance();
  const winner = await playBattle(events,P,E);
  if(!winner) return;
  _fight=fight1(events, P, E, statP, statE, _tactic, tacE, opp.seed, events[events.length-1].winner==='P');
  renderPracticeResult(events[events.length-1].winner==='P', P, E);
}

function renderPracticeResult(win,P,E){
  shield();
  toBattle();
  $('#sc-battle').innerHTML = `
    <div class="panel result bv-result">
      <div class="big ${win?'win':'lose'}">${win?'VICTORY':'DEFEAT'}</div>
      <div class="hint">${esc(P.name)} vs ${esc(E.name)}</div><div class="bv-result-art">${sprite(P.type,true)}<span>VS</span>${sprite(E.type,false)}</div>
      <div class="reward"><div class="r" style="color:var(--dim)">연습 대전 · 보상 없음</div>
        <div class="r" style="color:var(--dim)">경험치·크레딧·파츠·피로도·전적이 그대로입니다</div></div>
      <div class="row-btns">
        <button class="btn big gold" onclick="ROWAR.practiceFind()">한 판 더</button>
        <button class="btn big ghost" onclick="ROWAR.go('hangar')">격납고</button>
      </div>
      ${analysisSlot()}
    </div>`;
  fillAnalysis();
}


/* 승패와 보상은 서버가 확정한다. 클라는 서버가 준 시드와 스탯으로 같은 전투를
   다시 돌려 애니메이션만 재생한다 — 결정적 시뮬이라 결과가 반드시 일치한다.
   각자 계산하면 피로도 정산 시점 차이 등으로 어긋나므로 스탯도 서버 것을 쓴다. */
async function requestBattleStart(tactic,options){
  const button=$('#sc-battle .bv-launch'),html=button?.innerHTML;
  if(button){button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='전투 준비 중…';}
  try{return await net.battleStart(tactic,options);}
  finally{if(button?.isConnected){button.disabled=false;button.removeAttribute('aria-busy');button.innerHTML=html;}}
}
/* Keep navigation settlement outside the result/insight insertion point shared with main.
   Only an interrupted replay is settled here; a normal replay uses the existing result path. */
async function playBattleForAccount(events,P,E,r,my,account,state,request){
  const winner=await playBattle(events,P,E);
  if(account!==net.state.accountId||state!==S)return null;
  if(!winner||request!==_battleRequest||cur!=='battle'){
    applyServerBattle(r,my);renderAll();return null;
  }
  return winner;
}
async function startBattle(){
  beginReplay();
  const opp=_pendingOpp; if(!opp) return;
  if(!net.state.online){ toast('대전은 서버 연결이 필요합니다'); return; }
  if(opp.joint) return startJointBattle(opp);

  const my=selRobot(),account=net.state.accountId,state=S,request=_battleRequest; _battleRobot=my;
  const r=await requestBattleStart(_tactic);
  if(account!==net.state.accountId||state!==S)return;
  const left=request!==_battleRequest||cur!=='battle';
  if(!r || r.error){
    if(left)return;
    /* 미리 잡아 둔 상대는 10분이 지나면 서버가 무효로 돌린다.
       결과 화면에 오래 머물다 '한 판 더'를 누른 경우가 여기 걸린다 — 막다른 길로 두지 않는다. */
    /* 출격비가 모자라면 다시 찾는다 — 서버가 그때 비상 출격을 잡아 준다. */
    if(r && /expired|no pending|already started|not enough credits/i.test(r.error||'')){ _pendingOpp=null; return findMatch(_battleFindOpts); }
    toast('전투를 시작하지 못했습니다'+(r&&r.error?': '+r.error:'')); return;
  }
  setPending(r.next && r.next.opponent, r.next && r.next.cost, r.next && r.next.rescue, r.next && r.next.tier, r.next && r.next.mode, r.next);
  if(left){applyServerBattle(r,my);renderAll();return;}

  /* 출격비는 **지금** 깎는다. 서버는 이미 걷었는데 화면은 전투가 끝나야 반영돼서,
     싸우는 내내 없는 크레딧이 지갑에 남아 있었다.
     보상은 여기서 건드리지 않는다 — 미리 반영하면 재생하기도 전에 승패가 새어 나간다.
     끝나면 applyServerBattle 이 서버가 확정한 값으로 덮어쓴다. */
  if(r.cost){ S.credits=Math.max(0, S.credits-r.cost); renderWallet(); }

  /* 재생은 **서버가 확정한 전술**로 한다. 내가 고른 값을 그대로 쓰면, 서버가 흰 목록에서
     떨어뜨렸을 때 화면과 판정이 갈린다. */
  const P=makeUnit(r.nameP, my.type, r.statP, r.tacticP);
  const E=makeUnit(r.opponent.callsign, r.opponent.type, r.statE, r.tacticE);
  const rl=r.relay;
  const events=rl?simulate(P,E,r.seed,{P:[makeUnit(rl.nameP2,rl.typeP2,rl.statP2,rl.tacticP2)],E:[makeUnit(rl.nameE2,rl.typeE2,rl.statE2,rl.tacticE2)]}):simulate(P,E,r.seed);
  renderArena(my.type, r.opponent.type, P.name, E.name, null, r.tacticP, r.tacticE,opp.mode==='hunt'?'hunt':'battle');

  /* **재생이 끝날 때까지 기다린다.** 예전에는 여기서 바로 함수가 끝나, 재생이 도는 동안
     전투 시작을 또 누를 수 있었다(문지기가 이미 풀린 뒤라 막지 못한다). */
  if(rarOf(r.opponent.type)==='BOSS') await bossEntrance();
  const winner = await playBattleForAccount(events,P,E,r,my,account,state,request);
  if(!winner) return;                            // 중간에 나갔으면 화면만 접는다(보상은 이미 서버에 반영됨)
  applyServerBattle(r, my);
  _fight=fight1(events, P, E, r.statP, r.statE, r.tacticP, r.tacticE, r.seed, r.win);
  renderResult(r.win, _lastReward, P, E, opp);
}

/* 서버가 확정한 결과를 로컬 상태에 받아 적는다. 클라가 계산하지 않는다.
   (점령전은 applyTerrAttack 이 재생 전에 불려 출격비가 바로 반영된다 —
    대전만 재생이 끝난 뒤에 반영돼서, 거기만 출격비를 따로 먼저 깎아 준다) */
let _lastReward=null;
function applyServerBattle(r, rb){
  S.credits=r.player.credits; S.cores=r.player.cores; S.scrap=r.player.scrap;
  S.stat.wins=r.player.wins; S.stat.losses=r.player.losses;
  rb.level=r.robot.level; rb.exp=r.robot.exp; rb.fat=r.robot.fat; rb.fatAt=r.robot.fatAt;
  if(r.reward.part) addPart(r.reward.part);
  /* 교대 전투(동결 예외) — 둘째 기체가 나왔으면 그 기체도 받아 적고, 결과 창은 합동전처럼 기체마다 한 줄 */
  const r2=r.relay&&r.relay.robot2, rb2=r2&&S.robots.find(x=>x.uid===r2.uid);
  if(rb2){ rb2.level=r2.level; rb2.exp=r2.exp; rb2.fat=r2.fat; rb2.fatAt=r2.fatAt; }
  _lastReward={ win:r.win, cr:r.reward.cr, sc:r.reward.sc, core:r.reward.core, part:r.reward.part,
                robots: rb2 ? [{name:ROBOT_TYPES[rb.type].name, lv:r.reward.lv, fat:r.reward.fat},
                               {name:ROBOT_TYPES[rb2.type].name, lv:r2.lv, fat:r2.fatGain}] : null,
                lv:r.reward.lv, fat:r.reward.fat, rname:ROBOT_TYPES[rb.type].name,
                ratingDelta:r.ratingDelta||0, cost:r.cost||0, rescue:!!r.rescue, duel:r.mode==='duel',
                band:r.band||null, hunt: r.mode==='hunt' ? { tier:r.tier, done:!!r.huntDone } : null };
  if(r.hunt) _huntWk = r.hunt;
  if(r.band) takeBand(r.band);
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
    if(R()<0.09){ const p=rollPart(enemyLv); autoSc=autoScrap(p);      // 예전 0.35 의 약 1/4
      if(autoSc){ S.scrap+=autoSc; } else { part=p; addPart(p); } }
    sc+=autoSc;
    S.stat.wins++; save(); return {win,cr,sc,core,part,lv,fat,rname}; }
  const cr=40+ri(0,20), sc=6; S.credits+=cr; S.scrap+=sc; S.stat.losses++; save();
  return {win,cr,sc,core:0,part:null,lv,fat,rname};
}

/* 구간 목표 한 줄 — '승급까지 3승 · 강등까지 2패'.
   구간제의 약속은 '이기면 오른다' 이고, 그게 보여야 파밍에 방향이 생긴다. */
function bandText(g){
  if(!g) return '';
  const up = g.up==null ? '끝 구간' : `승급까지 ${g.up}승`;
  const dn = g.down==null ? '' : ` · 강등까지 ${g.down}패`;
  return `구간 ${g.band}/${g.total} · ${up}${dn}`;
}
function bandLine(g){
  if(!g) return '';
  const S_ = CONST.MON_BAND_STEP || {up:5, down:3};
  /* 점수를 칸으로 그린다. 왼쪽이 강등 쪽, 오른쪽이 승급 쪽이다. */
  const cells=[];
  /* 강등이 없는 첫 구간은 왼쪽 칸을, 승급이 없는 끝 구간은 오른쪽 칸을 안 그린다 */
  for(let k=(g.down==null?0:-S_.down+1);k<=(g.up==null?0:S_.up-1);k++)
    cells.push(`<i class="${k===0?'z ':''}${(g.pts>0&&k>0&&k<=g.pts)?'on':(g.pts<0&&k<0&&k>=g.pts)?'neg':''}"></i>`);
  return `<div class="bandgoal"><span class="bgm">${cells.join('')}</span>${bandText(g)}</div>`;
}

/* ---- 대전 아레나 & 재생 ---- */
/* 상대가 낀 파츠를 보여 준다(2026-09-18 사용자 지시).
   **"저렇게 강한 것도 있구나" 를 알게 하는 자리다.** 몬스터가 파츠를 끼게 되면서
   생긴 칸인데, 플레이어 상대에게도 똑같이 뜬다 — 예전에는 아무에게도 안 보였다.
   여기 뜨는 파츠가 곧 다음 목표가 된다. */
function oppGear(opp){
  const list = (opp.parts || []).filter(Boolean);
  if(!list.length) return '';
  const mine = new Set(Object.values(selRobot().slots || {}).filter(Boolean));
  const myBy = {};
  for(const u of mine){ const p = findPart(u, S.parts); if(p) myBy[p.slot] = p; }
  return `<div class="oppgear">
    <div class="ogl">상대 장착 <span>내 것과 나란히</span></div>
    <div class="ogrow">${list.map(p=>{
      const m = myBy[p.slot];
      /* 같은 칸의 내 파츠와 견준다. 숫자가 아니라 '위/아래' 만 — 고르기 전에
         알아야 할 것은 '내가 밀리는 칸이 어디인가' 뿐이다. */
      const up = m && (RAR_ORDER[p.rarity] > RAR_ORDER[m.rarity]
                    || (p.rarity===m.rarity && (p.enh|0) > (m.enh|0)));
      return `<span class="ogp${enhClass(p)}${up?' over':''}">
        <b>${SLOT_KO[p.slot]}</b> ${partIco(p,'xs')} ${esc(p.name)} ${rarTag(p)}
        ${m ? `<i>내 ${m.rarity}${m.enh?'+'+m.enh:''}</i>` : '<i class="none">내 칸 비었음</i>'}
      </span>`; }).join('')}</div>
  </div>`;
}

/* 전투가 시작되면 **양쪽 전술을 드러낸다.** 고르기 전에는 숨기고 시작하면 보여 주는 것이
   핵심이다 — 안 보여 주면 무엇이 통했는지 영영 알 수 없어 다음 판이 나아지지 않는다. */
function renderArena(pType,eType,pName,eName,label,tacP,tacE,navAs){
  const tac=(t,side)=> (t&&t!=='none') ? `<em class="tacmark ${side}">${tacKo(t)}</em>` : '';
  shield();
  toBattle('arena',navAs);              // 전투 재생 동안만 콕핏 HUD
  $('#sc-battle').innerHTML = `
    <!-- 속도 버튼을 제목 줄로 올린다. 예전에는 전투 기록 아래, 즉 **직전 화면의
         '전투 시작'이 있던 자리**에 있었다. 연타하면 남은 클릭이 그대로 여기 꽂혀
         배속이 저 혼자 x4 까지 뛰었다 — 같은 자리에 다른 뜻의 버튼을 두지 않는다. -->
    <div class="arena-head">
      <h2 class="title" style="margin:0">${label || (MONSTER_TYPES[eType]?'몬스터 대전':'자동 대전')}</h2>
      <button class="btn ghost spd" id="spdbtn" onclick="ROWAR.toggleSpeed()">속도 x${battleSpeed}</button>
      <button class="btn ghost spd" id="skipbtn" onclick="ROWAR.skipReplay()">건너뛰기</button>
    </div>
    <div class="arena bv-arena" id="arena">
      <div class="grid"></div><div class="vs">VS</div>
      <div class="hpwrap p"><div class="nm"><span>${pName}</span>${tac(tacP,'p')}<small id="hpn-p"></small></div>
        <div class="hpbar" id="hp-p"><i></i></div><div class="spbar" id="sp-p"><i></i></div></div>
      <div class="hpwrap e"><div class="nm"><small id="hpn-e"></small>${tac(tacE,'e')}<span>${eName}</span></div>
        <div class="hpbar" id="hp-e"><i></i></div><div class="spbar" id="sp-e"><i></i></div></div>
      <div class="fighter left" id="fighter-p">${sprite(pType,true)}</div>
      <div class="fighter right${rarOf(eType)==='BOSS'?' big':''}" id="fighter-e">${sprite(eType,false)}</div>
      <div class="flash" id="flash"></div>
      <div class="skillbanner" id="skillbanner"></div>
    </div>
    <div class="blog" id="blog"></div>`;
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
async function lunge(side){ const el=AR('#fighter-'+side); if(!el) return; el.classList.add(side[0]==='p'?'lungeL':'lungeR'); await sleep(110/battleSpeed); el.classList.remove('lungeL','lungeR'); }
function floatDmg(side,text,cls){ const host=AR('#fighter-'+side); if(!host) return; const d=document.createElement('div'); d.className='dmg '+cls; d.textContent=text; d.style.left=(side[0]==='p'?'30px':'70px'); d.style.top='24px'; host.appendChild(d); setTimeout(()=>d.remove(),1000); }
function banner(txt){ const b=AR('#skillbanner'); if(!b) return; b.textContent=txt; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
function blog(html){ const l=document.getElementById('blog'); if(!l) return; const d=document.createElement('div'); d.innerHTML=html; l.appendChild(d); l.scrollTop=l.scrollHeight; }
async function playBattle(events,P,E,o){
  const arena=document.getElementById('arena');
  // 화면을 숨기거나 새 아레나로 바꾼 뒤에는 이전 재생이 HP·결과를 쓰지 않는다.
  const stopped=()=>cur!=='battle'||!arena||!arena.isConnected||document.getElementById('arena')!==arena;
  if(stopped()) return null;
  const rain=(P.type==='ignis'||E.type==='ignis')?createIgnisRain(arena):null;
  let rainSkill=null;
  /* 지금 서 있는 기체 — 교대 전투(swap 사건)에서 바뀐다(2026-09-25 · 동결 예외). 교대가 없으면 P · E 그대로다 */
  const cu0={p:{name:P.name,max:P.maxhp,type:P.type}, e:{name:E.name,max:E.maxhp,type:E.type}}, cu={...cu0};
  const mx=k=>cu[k].max;
  const nameOf=s=> s==='P'?`<span class="k">${cu.p.name}</span>`:`<span style="color:var(--bad);font-weight:700">${cu.e.name}</span>`;
  const swapIn=(x,draw)=>{ const k=x.side==='P'?'p':'e'; cu[k]={name:x.name,max:x.maxhp,type:x.type};
    if(draw){ const f=AR('#fighter-'+k); if(f) f.innerHTML=sprite(x.type,k==='p');
      const nm=AR('.hpwrap.'+k+' .nm span'); if(nm) nm.textContent=x.name; }
    setHP(k,x.hp,x.maxhp); setSP(k,0); };
  try{
    /* 아레나는 simulate 가 끝난 뒤에 재생하므로 P.hp 가 이미 최종값이다 — 그래서 만땅으로 시작한다.
       점령전은 방어선 사이에 체력이 이어지므로 '들어갈 때의 값'을 따로 받는다. */
    setHP('p', o&&o.pHp!=null?o.pHp:P.maxhp, P.maxhp);
    setHP('e', o&&o.eHp!=null?o.eHp:E.maxhp, E.maxhp);
    setSP('p', (o&&o.pSp)||0); setSP('e', (o&&o.eSp)||0);
    blog(`전투 개시! <b>${P.name}</b> vs <b>${E.name}</b>`);
    const sl=ms=>sleep(ms/battleSpeed);
    /* 건너뛰기 — 남은 이벤트를 애니메이션 없이 한 번에 반영하고 끝낸다.
       마지막 체력·게이지를 그대로 그려 두므로 화면이 결과와 어긋나지 않는다. */
    const finishNow=(from)=>{
      if(!from){ cu.p=cu0.p; cu.e=cu0.e; }               // 처음부터 다시 그린다 — 교대 전 기체부터
      for(let k=from;k<events.length;k++){ const x=events[k];
        if(x.t==='turn') setSP(x.side==='P'?'p':'e', x.sp);
        else if(x.t==='jam') setSP(x.dside==='P'?'p':'e', x.sp);
        else if(x.t==='heal') setHP(x.side==='P'?'p':'e', x.hp, mx(x.side==='P'?'p':'e'));
        else if(x.t==='hit' && !x.miss) setHP(x.dside==='P'?'p':'e', x.thp, mx(x.dside==='P'?'p':'e'));
        else if(x.t==='swap') swapIn(x,true);
      }
      blog('<b>건너뜀</b> — 결과는 그대로입니다');
      const last=events[events.length-1];
      return stopped()?null:((last&&last.t==='end')?last.winner:'P');
    };
    /* 실시간 재생(2026-09-21) — 사건마다 정해 둔 시각까지만 기다린다. 동작(돌진)은 기다리지 않아서
       두 기체의 행동이 가까우면 겹쳐 움직인다. 기다림은 지금 배속으로 나눈다(도중에 배속을 바꿔도 바로 먹는다) */
    const tl=battleTimeline(events);
    let clock=0;
    const until=async t=>{ const w=t-clock; clock=Math.max(clock,t); if(w>0) await sl(w); };
    await sl(400);
    for(let i=0;i<events.length;i++){
      const e=events[i];
      if(e.t!=='end') await until(tl[i]);
      if(stopped()) return null;                 // 보상 판정은 서버에 있으며 화면 재생만 중단한다.
      if(_skipReplay) return finishNow(0);   // 처음부터 다시 그린다 — 몇 번 그려도 결과는 같다
      if(e.t==='turn'){ rainSkill=null; setSP(e.side==='P'?'p':'e', e.sp); continue; }
      if(e.t==='swap'){ rainSkill=null; swapIn(e,true); banner('교대!'); blog(`교대 — ${nameOf(e.side)} 출격`); continue; }
      if(e.t==='skill'){
        rainSkill=null;
        if(rain&&cu[e.side==='P'?'p':'e'].type==='ignis'){
          rainSkill={side:e.side,index:0,left:COMBAT_TYPES.ignis.skill.fx.hits};
          rain.cast(e.side==='P'?'p':'e');
        }
        banner(e.name); blog(`${nameOf(e.side)} 스킬 <b>${e.name}</b>!`); continue;
      }
      if(e.t==='heal'){ const hS=e.side==='P'?'p':'e';
        setHP(hS, e.hp, mx(hS)); floatDmg(hS,'+'+e.amt,'heal');
        blog(`${nameOf(e.side)} 체력 <span class="h">+${e.amt}</span> ${e.src==='repair'?'수리':'흡수'}`); continue; }
      /* 특화기술 — 방벽 · 표적 · 재밍 (js/sim.js afterSkill) */
      if(e.t==='shield'){ const k=e.side==='P'?'p':'e'; floatDmg(k,'방벽 '+e.amt,'heal');
        blog(`${nameOf(e.side)} <span class="h">방벽 ${e.amt}</span>`); continue; }
      if(e.t==='mark'){ blog(`${nameOf(e.side)} → ${nameOf(e.dside)} <span class="m">표적 +${Math.round(e.amt*100)}%</span>`); continue; }
      if(e.t==='jam'){ const k=e.dside==='P'?'p':'e'; setSP(k, e.sp); floatDmg(k,'JAM','miss');
        blog(`${nameOf(e.side)} 재밍 — ${nameOf(e.dside)} SP −${e.amt} · 행동 지연`); continue; }
      /* 흘려내기 — 친 쪽이 돌진했다가 튕겨 나간다. 흘린 쪽에 PARRY */
      if(e.t==='parry'){ const pS=e.side==='P'?'p':'e', aS=e.dside==='P'?'p':'e';
        lunge(aS);
        if(stopped()) return null;
        floatDmg(pS,'PARRY','parry'); shakeF(aS);
        blog(`${nameOf(e.side)} <span class="c">흘려내기!</span> ${nameOf(e.dside)} 의 공격을 흘리고 · ${nameOf(e.dside)} 행동 지연`);
        continue; }
      if(e.t==='hit'){
        const aS=e.side==='P'?'p':'e', dS=e.dside==='P'?'p':'e';
        // sim 의 스킬 타격은 같은 턴에 연속으로 나온다. 평타로 효과가 이어지지 않게 경계를 지킨다.
        const isRain=!!rainSkill&&rainSkill.side===e.side;
        if(isRain){
          const index=rainSkill.index++;
          if(--rainSkill.left<=0) rainSkill=null;
          await rain.strike(aS,{miss:!!e.miss,index,speed:battleSpeed});
        }else{ rainSkill=null; lunge(aS); }   // 돌진은 기다리지 않는다 — 다른 기체의 행동과 겹쳐 보이게
        if(stopped()) return null;
        if(e.miss){ floatDmg(dS,'MISS','miss'); blog(`${nameOf(e.side)} 의 공격을 ${nameOf(e.dside)} 이(가) <span class="m">회피!</span>`); }
        else{ if(!isRain) flash(); shakeF(dS); floatDmg(dS,(e.crit?'CRIT ':'')+e.dmg,e.crit?'crit':'norm');
          setHP(dS,e.thp, mx(dS));
          blog(`${nameOf(e.side)} → ${nameOf(e.dside)} ${e.crit?'<span class="c">치명타 </span>':''}<b>${e.dmg}</b> 피해${e.absorb?` <span class="m">(방벽 −${e.absorb})</span>`:''}`); }
        continue;
      }
      if(e.t==='end'){ await until(tl[i]); await sl(300); return stopped()?null:e.winner; }
    }
    return stopped()?null:'P';
  }finally{
    if(rain) rain.dispose();
  }
}

/* ── 실시간 재생 시간표 (2026-09-21 · 사용자 결정) ──────────────────
   예전 재생은 사건을 하나씩 순서대로 틀어, 속도대로 따로 움직이는 전투가 '주고받기' 로 보였다.
   이제 사건마다 **보여 줄 시각(ms, 배속 1)** 을 정한다.
     · 행동의 시작 — 계산이 'turn' 에 적어 둔 at(흐른 시간)에 비례. 행동 사이 평균이 TL.gap 이 되게 늘린다
     · 한 행동 안의 사건 — 그 뒤로 TL.step 만큼씩 짧게 이어진다
   그래서 두 기체의 행동이 가까우면 겹쳐 보인다(돌진이 동시에 나간다). 빠른 기체는 더 자주 움직인다.
   **순서는 뒤집지 않는다** — 체력 막대가 계산 순서대로 움직여야 결과와 맞는다(TL.min 간격).
   at 이 없는 사건열(옛 기록 · 검사용)은 행동마다 TL.gap 씩 띄운다. 합동전(playJoint)도 이것을 쓴다. */
const TL = { gap: 520, min: 40,
  step: { start: 0, turn: 60, skill: 420, hit: 170, heal: 120, shield: 120, mark: 100, jam: 150, parry: 260, down: 220, trait: 320 } };
function battleTimeline(events){
  const ats=events.filter(e=>e.t==='turn'&&e.at!=null).map(e=>e.at);
  const avg=ats.length>1 ? (ats[ats.length-1]-ats[0])/(ats.length-1) : 0;
  const scale=avg>0 ? TL.gap/avg : 0, t0=ats.length ? ats[0] : 0;
  const out=[]; let base=0, off=0, prev=-Infinity, n=0;
  for(const e of events){
    if(e.t==='turn'){ base = (e.at!=null && scale) ? (e.at-t0)*scale : (n++ ? Math.max(prev+TL.min, base+TL.gap) : 0); off=0; }
    const t=Math.max(base+off, prev+TL.min);
    off += TL.step[e.t] != null ? TL.step[e.t] : 80;
    out.push(t); prev=t;
  }
  if(out.length && out[0]<0) out[0]=0;
  return out;
}
function renderResult(win,rw,P,E,opp){
  shield();
  toBattle(null,rw.hunt?'hunt':'battle');
  const rewards = [];
  if(rw.duel){
    rewards.push(`<div class="r" style="color:var(--acc2)">친선전 · 주고받은 것 없음</div>`);
    rewards.push(`<div class="r" style="color:var(--dim)">전적·레이팅·크레딧이 그대로입니다</div>`);
  }
  else if(rw.rescue) rewards.push(`<div class="r" style="color:var(--bad)">비상 출격 · 크레딧만 지급</div>`);
  else if(rw.cost) rewards.push(`<div class="r" style="color:var(--dim)">출격비 −${rw.cost}</div>`);
  if(!rw.duel){
    /* 합동전은 두 기가 각자 받는다 — 기체마다 한 줄 */
    if(rw.robots && rw.robots.length){
      for(const x of rw.robots){
        rewards.push(`<div class="r">${esc(x.name)} 경험치 +${x.lv.amt}${x.fat.add?` · <span style="color:var(--bad)">피로도 +${x.fat.add} (${x.fat.now} / ${FAT_MAX})</span>`:''}</div>`);
        if(x.lv.to>x.lv.from) rewards.push(`<div class="r" style="color:var(--good)">레벨 업!  ${esc(x.name)}  Lv.${x.lv.from} → Lv.${x.lv.to}</div>`);
      }
    } else {
      if(!rw.rescue) rewards.push(`<div class="r">경험치 +${rw.lv.amt}</div>`);
      if(rw.lv.to>rw.lv.from) rewards.push(`<div class="r" style="color:var(--good)">레벨 업!  ${rw.rname}  Lv.${rw.lv.from} → Lv.${rw.lv.to}</div>`);
    }
    rewards.push(`<div class="r">크레딧 +${rw.cr}</div>`);
    if(!rw.rescue) rewards.push(`<div class="r">스크랩 +${rw.sc}</div>`);
    if(rw.fat.add && !rw.robots) rewards.push(`<div class="r" style="color:var(--bad)">피로도 +${rw.fat.add}  (누적 ${rw.fat.now} / ${FAT_MAX})</div>`);
    if(rw.core) rewards.push(`<div class="r" style="color:var(--acc2)">코어 +${rw.core}</div>`);
    if(rw.part) rewards.push(`<div class="r">파츠: ${partIco(rw.part,'xs')} ${esc(rw.part.name)} <span class="tag rar-${rw.part.rarity}">${rw.part.rarity}</span></div>`);
    /* 토벌 주간 한도가 걸린 등급이면 이번 주 몇 번째인지 */
    const hwk = rw.hunt && huntNow().tiers[rw.hunt.tier];
    if(hwk) rewards.push(`<div class="r" style="color:${rw.hunt.done?'var(--gold)':'var(--dim)'}">이번 주 ${HUNT_KO[rw.hunt.tier]} 토벌 ${hwk.used} / ${hwk.cap}${
      rw.hunt.done ? ` · 다 썼습니다 — ${huntResetTxt(huntNow().resetAt)}` : ''}</div>`);
    /* 구간 승급·강등. 몬스터 판에서만 온다. 승급은 이 게임에서 가장 뚜렷한 '목표 달성' 이라
       맨 위에 크게 둔다. 그대로면 남은 승수만 조용히 적는다. */
    const b=rw.band;
    if(b && b.moved>0) rewards.unshift(`<div class="r bandup">구간 승급!  ${b.from} → <b>${b.to}</b> / ${b.total}</div>`);
    else if(b && b.moved<0) rewards.unshift(`<div class="r banddn">구간 강등  ${b.from} → ${b.to} / ${b.total} · 이 구간에서 다시 쌓으면 돌아갑니다</div>`);
    else if(b) rewards.push(`<div class="r" style="color:var(--dim)">${bandText(b)}</div>`);
  }
  $('#sc-battle').innerHTML = `
    <div class="panel result bv-result">
      <div class="big ${win?'win':'lose'}">${win?'VICTORY':'DEFEAT'}</div>
      <div class="hint">${esc(P.name)} vs ${esc(E.name)}</div><div class="bv-result-art">${sprite(P.type,true)}<span>VS</span>${sprite(E.type,false)}</div>
      <div class="reward">${rewards.join('')}</div>
      <div class="row-btns">
        ${rw.hunt && rw.hunt.done
          /* 이번 판으로 그 등급의 주간 한도를 다 썼다 — 서버가 다음 상대를 안 잡았다. '한 판 더' 를 두면 아레나로 빠진다 */
          ? `<button class="btn big gold" onclick="ROWAR.go('hunt')">사냥터로</button>`
          : `<button class="btn big gold" onclick="ROWAR.nextMatch()">한 판 더</button>`}
        ${rw.hunt&&!rw.hunt.done?'<button class="btn big ghost" onclick="ROWAR.go(\'hunt\')">사냥터로</button>':''}
        <button class="btn big ghost" onclick="ROWAR.go('hangar')">격납고</button>
      </div>
      ${analysisSlot()}
    </div>`;
  fillAnalysis();
  renderWallet();
}
function toggleSpeed(){ battleSpeed = battleSpeed>=8?1:battleSpeed*2; const b=$('#spdbtn'); if(b)b.textContent='속도 x'+battleSpeed; }

/* ── 건너뛰기 ─────────────────────────────────────────────
   **결과는 이미 서버가 정했다.** 재생은 그것을 보여 주는 일일 뿐이라, 건너뛰어도
   달라지는 것이 하나도 없다. 그래서 건너뛰기를 둘 수 있다.

   레이드 보스가 단단해지면서(CONST.RAID.bossX) 한 판이 300타를 넘게 됐다 —
   속도 x8 로도 십여 초다. 편성 둘이 차례로 들어가는 판은 그 두 배다.
   깃발은 재생 한 묶음(레이드는 두 판)에 걸리고, 다음 재생이 시작될 때 내려간다. */
let _skipReplay = false;
const skipReplay = () => { _skipReplay = true; const b=$('#skipbtn'); if(b) b.textContent='건너뛰는 중'; };
const beginReplay = () => { _skipReplay = false; };

/* ------------------------------- 전투 분석 ------------------------------- */
/* 2026-09-21 · 사용자 결정 — 결과 창에 **딜표**(평타 · 스킬 · 치명 · 흘려내기)와 **승패 요인**을 붙인다(js/insight.js).
   딜표는 사건에서 정확히 세므로 바로 그린다. 승패 요인은 같은 판을 조건만 바꿔 다시 돌려 추정하므로
   창을 먼저 띄우고 조금 뒤에 채운다(결과 창을 늦추지 않는다). 전선 · 점령은 여러 판이 이어져 딜표만 합산한다. */
let _fight=null;                           // 방금 끝난 판 — 결과 창이 한 번 쓰고 비운다

const fightRow=(T,k,name,mine)=>({ name, mine, r:T[k]||{normal:0,nHits:0,skill:0,sHits:0,crit:0,miss:0,parry:0,parried:0,heal:0,absorbed:0,total:0} });
/* 1:1 — 서버가 준 스탯 · 전술 · 시드 그대로 */
function fight1(events, P, E, statP, statE, tacP, tacE, seed, win){
  const T=damageTable(events);
  return { kind:'1v1', T, rows:[fightRow(T,'P0',P.name,true), fightRow(T,'E0',E.name,false)],
    spec:{ P:{name:P.name,type:P.type,stats:statP,tactic:tacP||'none'}, E:{name:E.name,type:E.type,stats:statE,tactic:tacE||'none'}, seed, win } };
}
function fightJoint(events, team, boss, seed, aim, win, raid){
  const T=damageTable(events);
  return { kind: raid ? 'raid' : 'joint', T,
    rows:[...team.map((m,i)=>fightRow(T,'P'+i,`${i===0?'전위':'후위'} · ${m.name}`,true)), fightRow(T,'E0',boss.name,false)],
    spec:{ team:team.map(m=>({name:m.name,type:m.type,stats:m.stats,tactic:m.tactic||'none'})),
      boss:{name:boss.name,type:boss.type,stats:boss.stats,tactic:boss.tactic||'none',traits:boss.traits||[]},
      aim, seed, win, raid:!!raid, maxTurns: raid ? ((CONST.RAID||{}).turns||600) : undefined } };
}
/* 전선 · 점령 — 방어선마다 한 판. 서버가 준 입력으로 같은 판을 다시 돌려 기체 · 방어선별로 더한다 */
function fightBreach(r){
  if(!r || !r.mechs || !r.lines || !r.seeds) return null;
  const out=runBreach({ mechs:r.mechs, lines:r.lines, seeds:r.seeds, hpLeft:r.hpLeft0 });
  const acc={}, add=(k,name,mine,x)=>{ const a=(acc[k] ||= { name, mine, r:{normal:0,nHits:0,skill:0,sHits:0,crit:0,miss:0,parry:0,parried:0,heal:0,absorbed:0,total:0} });
    if(x) for(const f in a.r) a.r[f]+=x[f]||0; };
  for(const rd of out.rounds){
    const T=damageTable(rd.events), M=r.mechs[rd.mi], L=r.lines[rd.li];
    add('M'+rd.mi, M.name, true, T.P0); add('L'+rd.li, `방어선 ${rd.li+1} · ${L.name}`, false, T.E0);
  }
  const T={}; Object.values(acc).forEach((a,i)=>{ T[(a.mine?'P':'E')+i]={...a.r, side:a.mine?'P':'E'}; });
  return { kind:'breach', T, rows:Object.values(acc), spec:null };
}

function dmgTableHtml(rows){
  const max=Math.max(1,...rows.map(x=>x.r.total));
  const n=v=>fmt(Math.round(v));
  return `<div class="dmgwrap"><table class="dmgtab">
    <thead><tr><th>기체</th><th>평타</th><th>스킬</th><th>합계</th><th class="c-crit">치명</th><th>흘려내기</th></tr></thead>
    <tbody>${rows.map(({name,mine,r})=>{
      const sub=[r.heal?`회복 ${n(r.heal)}`:'', r.absorbed?`방벽 ${n(r.absorbed)}`:'', r.miss?`빗나감 ${r.miss}`:''].filter(Boolean).join(' · ');
      return `<tr class="${mine?'mine':'foe'}">
        <td>${esc(name)}${sub?`<span class="sub">${sub}</span>`:''}</td>
        <td>${n(r.normal)}<small>×${r.nHits}</small></td>
        <td>${n(r.skill)}<small>×${r.sHits}</small></td>
        <td class="tot"><b>${n(r.total)}</b><i class="bar" style="width:${Math.round(r.total/max*100)}%"></i></td>
        <td class="c-crit">${r.crit}</td>
        <td>${r.parry}<small>/ −${r.parried}</small></td></tr>`; }).join('')}</tbody></table></div>`;
}
/* 결과 창에 넣는 칸. 딜표와 바로 셀 수 있는 줄은 지금, 추정은 fillAnalysis 가 채운다 */
function analysisSlot(){
  const f=_fight; if(!f) return '';
  const now=eventLines(f.T, r=>r.side==='P');
  return `<div class="anal">
    <h4>전투 분석</h4>
    <ul class="insl" id="anal-lines">${now.map(l=>`<li class="k-${l.k}">${esc(l.text)}</li>`).join('')}${
      f.spec ? `<li class="k-wait" id="anal-wait">같은 조건으로 다시 돌려 보는 중…</li>` : ''}</ul>
    <h4>딜표 <small>평타 · 스킬 피해(×타격 수) · 흘려내기 성공 / 당함</small></h4>
    ${dmgTableHtml(f.rows)}
  </div>`;
}
function fillAnalysis(){
  const f=_fight; _fight=null;
  if(!f || !f.spec) return;
  const wait=$('#anal-wait'),owner=S,account=net.state.accountId,request=_battleRequest;
  /* 한 틱 쉬고 돈다 — 결과 창이 먼저 그려지게 */
  setTimeout(()=>{
    if(!wait || !wait.isConnected || $('#anal-wait')!==wait || S!==owner || net.state.accountId!==account || _battleRequest!==request) return;
    let res; try{ res = f.kind==='1v1' ? insight1(f.spec) : insightJoint(f.spec); }catch(e){ wait.remove(); return; }
    wait.outerHTML = res.lines.map(l=>`<li class="k-${l.k}">${esc(l.text)}</li>`).join('');
  }, 60);
}

/* ------------------------------- 합동전 ------------------------------- */
/* 2026-09-21 · 사용자 결정. 토벌 보스와 레이드는 편성 두 기가 **한꺼번에** 싸운다(js/joint.js).
   전투 직전에 **자리(전위·후위)와 기체별 전술**을 고른다 — 이 묶음이 그 화면과 재생이다.
   고른 값은 서버가 걸러서 받고(jointOrder · jointTactics), 재생은 **서버가 돌려준 값**으로 한다.
   ※ UI 개편 브랜치(codex/ui-rebuild)와 합칠 때 이 묶음은 통째로 옮기면 된다 — CONTRACT.md 참고. */
let _jform = { order: [], tac: {} };     // 고른 자리와 전술. 판을 넘겨도 기억한다
let _jctx = null;                        // 지금 열린 편성 화면을 다시 그리는 함수

/* 기본 자리 — 서버와 같은 규칙: 선봉(편성 안이면)이 먼저, 그다음 편성 순서 */
function jointBase(){
  const sel = selRobot();
  const sq = (S.squad && S.squad.length) ? S.squad.filter(u=>S.robots.some(r=>r.uid===u)) : [sel.uid];
  const lead = sq.includes(sel.uid) ? sel.uid : (sq[0] || sel.uid);
  return [lead, ...sq.filter(u=>u!==lead)].slice(0, 2);
}
/* 합동전의 기준 기체 — 편성 중 레벨이 가장 높은 쪽. 서버가 출격비와 보스 레벨을 여기에 맞춘다 */
function jointLead(){
  const rbs = jointBase().map(u=>S.robots.find(r=>r.uid===u)).filter(Boolean);
  return rbs.reduce((a,b)=> b.level>a.level ? b : a, rbs[0] || selRobot());
}
function jointForm(){
  const base = jointBase();
  const order = _jform.order.filter(u=>base.includes(u));
  for(const u of base) if(!order.includes(u)) order.push(u);
  _jform.order = order.slice(0, 2);
  for(const u of _jform.order) if(!(CONST.TACTIC||{})[_jform.tac[u]]) _jform.tac[u] = 'none';
  return _jform;
}
function jointSwap(){ const f=jointForm(); if(f.order.length<2) return; f.order=[f.order[1], f.order[0]]; if(_jctx) _jctx(); }
function jointTac(u,k){ if(!(CONST.TACTIC||{})[k]) return; jointForm().tac[u]=k; if(_jctx) _jctx(); }
const jointReq = () => { const f=jointForm(); return { order:f.order.slice(), tactics:{ ...f.tac } }; };

/* 보스 칸 — 조준과 요구 조건. 답까지 적는다(사용자 결정: '관통 추천' 까지 보여 준다) */
function jointBossHtml(type, level, joint, callsign){
  const T=COMBAT_TYPES[type], J=(joint && joint.aim) ? joint : jointOf(type);
  const tl=traitLines(J.traits);
  const aimTxt = { front:'스킬도 <b>전위</b>를 노립니다',
                   back:'스킬이 <b>후위</b>를 노립니다 — 후위도 버텨야 합니다',
                   all:`스킬이 <b>둘 다</b> 맞힙니다(한 기에 ${Math.round((JOINT().aoe||1)*100)}%씩)` }[J.aim] || '';
  return `<div class="oppcard jboss">
      <div class="sprite" data-t="${T.rarity}" style="height:130px">${sprite(type,false)}</div>
      <div>
        <div class="rname">${esc(callsign||T.name)} <span class="tag monster-tag">보스</span></div>
        <div class="rrole">${T.role} · Lv.${level}</div>
        <div class="jaim"><span class="tag jaimtag">${AIM_KO[J.aim]||''}</span> ${aimTxt}</div>
      </div>
    </div>
    <div class="monster-skill"><strong>${T.skill.name}</strong> <span class="fxrow">${fxTags(type)}</span><span>${T.skill.desc}</span></div>
    ${tl.length ? `<div class="jreq"><div class="jreqh">요구 조건</div>${tl.map(t=>`<div class="jtr">
        <span class="tag jtrtag">${t.ko}</span><span>${t.desc}</span><b>→ ${t.answer}</b></div>`).join('')}</div>` : ''}`;
}

/* 편성 칸 하나 — 자리 설명 · 기체 · 요구 조건에 맞는가(✓/✗) · 전술 */
function jointSlotHtml(u, i, traits){
  const rb=S.robots.find(r=>r.uid===u); if(!rb) return '';
  const T=ROBOT_TYPES[rb.type], tac=jointForm().tac[u]||'none';
  const fits = (traits||[]).map(k=>{ const v=traitFit(rb.type,k,tac); if(v==null) return '';
    return `<span class="tag jfit ${v?'ok':'no'}">${v?'✓':'✗'} ${CONST.TRAIT[k].ko}</span>`; }).filter(Boolean).join(' ');
  const pos = i===0 ? ['전위','보스의 평타를 받습니다']
                    : ['후위',`공격력 +${Math.round(((JOINT().backAtk||1)-1)*100)}% · 평타를 받지 않습니다`];
  return `<div class="jslot ${i===0?'front':'back'}">
    <div class="jpos"><b>${pos[0]}</b><span>${pos[1]}</span></div>
    <div class="jrb">
      <div class="sprite" data-t="${T.rarity}">${sprite(rb.type,true)}</div>
      <div class="jinfo">
        <div class="rname">${T.name} <span class="lv">Lv.${rb.level}</span> ${robRarTag(rb.type)}</div>
        <div class="rrole">${T.role} · 전투력 ${fmt(power(rb))} · 피로도 ${fatOf(rb)}</div>
        <div class="fxrow">${fxTags(rb.type)}</div>
        ${fits ? `<div class="jfits">${fits}</div>` : ''}
      </div>
    </div>
    <div class="jtac">${Object.keys(CONST.TACTIC||{}).map(k=>`<button class="btn tacbtn sm${k===tac?' on':''}"
        title="${esc(CONST.TACTIC[k].desc||'')}" onclick="ROWAR.jointTac('${u}','${k}')"><b>${CONST.TACTIC[k].ko}</b></button>`).join('')}</div>
  </div>`;
}
function jointFormHtml(traits){
  const f=jointForm();
  return `<div class="jform">
    <div class="tachead">합동전 편성 <small>자리와 기체별 전술을 고르세요</small></div>
    ${jointSlotHtml(f.order[0],0,traits)}
    ${f.order.length>1
      ? `<button class="btn ghost jswap" onclick="ROWAR.jointSwap()">⇅ 자리 바꾸기</button>${jointSlotHtml(f.order[1],1,traits)}`
      : `<div class="hint jone">편성에 기체가 한 기뿐입니다 — 격납고에서 한 기를 더 편성하면 둘이 함께 싸웁니다</div>`}
  </div>`;
}

/* 토벌 보스 — 상대 카드 대신 이 화면이 뜬다 */
function showJoint(opp){
  shield();
  _jctx = () => showJoint(opp);
  const allies=jointForm().order.map(u=>battleUnit(S.robots.find(r=>r.uid===u)));
  $('#sc-battle').innerHTML=battleView({mode:'hunt',allies,enemies:[battleUnit(opp.robot,opp.parts||[])],...battleIdentity(),enemyName:opp.callsign,enemyMeta:'보스 토벌 · 동시 합동전',
    details:`<div class="jointprep">${jointBossHtml(opp.robot.type,opp.robot.level,opp.joint,opp.callsign)}${jointFormHtml(opp.joint.traits)}</div>`,
    brief:'<p>전위와 후위가 동시에 싸웁니다. 두 기 모두 피로도가 쌓이며 서버가 정한 자리·전술로 재생합니다.</p>',costLabel:fmt(opp.cost)+' 크레딧',rewardLabel:'토벌 보상',
    actions:`<button class="bv-launch" onclick="ROWAR.startBattle()">합동 출격 ${icon('chevron')}</button><button class="btn ghost" onclick="ROWAR.hunt('${opp.tier}')">다시 찾기</button>`});
}

/* 합동전 무대 — 왼쪽에 두 기(전위가 앞), 오른쪽에 보스 */
function renderJointArena(team, bType, bName, label, bossTac,navAs='hunt'){
  const tac=(t,side)=> (t&&t!=='none') ? `<em class="tacmark ${side}">${tacKo(t)}</em>` : '';
  shield();
  toBattle('arena',navAs);
  $('#sc-battle').innerHTML = `
    <div class="arena-head">
      <h2 class="title" style="margin:0">${label}</h2>
      <button class="btn ghost spd" id="spdbtn" onclick="ROWAR.toggleSpeed()">속도 x${battleSpeed}</button>
      <button class="btn ghost spd" id="skipbtn" onclick="ROWAR.skipReplay()">건너뛰기</button>
    </div>
    <div class="arena joint bv-joint-arena" id="arena">
      <div class="grid"></div>
      ${team.map((u,i)=>`<div class="hpwrap p p${i}"><div class="nm"><span>${i===0?'전위':'후위'} · ${esc(u.name)}</span>${tac(u.tactic,'p')}<small id="hpn-p${i}"></small></div>
        <div class="hpbar" id="hp-p${i}"><i></i></div><div class="spbar" id="sp-p${i}"><i></i></div></div>`).join('')}
      <div class="hpwrap e"><div class="nm"><small id="hpn-e"></small>${tac(bossTac,'e')}<span>${esc(bName)}</span></div>
        <div class="hpbar" id="hp-e"><i></i></div><div class="spbar" id="sp-e"><i></i></div></div>
      ${team.map((u,i)=>`<div class="fighter left jf${i}" id="fighter-p${i}">${sprite(u.type,true)}</div>`).join('')}
      <div class="fighter right big" id="fighter-e">${sprite(bType,false)}</div>
      <div class="flash" id="flash"></div>
      <div class="skillbanner" id="skillbanner"></div>
    </div>
    <div class="blog" id="blog"></div>`;
}

/* 후위 사격(2026-09-21 사용자 제보) — 후위도 돌진 연출(lunge)을 썼더니, 후위는 전위 **뒤 층**에 서 있어서
   앞으로 튀어나간 모습이 전위 그림에 가려 '가만히 있다' 로 보였다. 판정은 원래부터 둘 다 쳤다.
   후위는 제자리에서 반동하고 탄도 선을 쏜다 — 뒤에서 쏘는 기체라는 자리가 그림으로도 읽힌다. */
async function shoot(aK, dK){
  const ar=document.getElementById('arena'), a=AR('#fighter-'+aK), d=AR('#fighter-'+dK);
  if(!ar||!a||!d) return;
  const R=ar.getBoundingClientRect(), ra=a.getBoundingClientRect(), rd=d.getBoundingClientRect();
  const x1=ra.left+ra.width*0.72-R.left, y1=ra.top+ra.height*0.42-R.top;
  const x2=rd.left+rd.width*0.4-R.left,  y2=rd.top+rd.height*0.5-R.top;
  const t=document.createElement('div');
  t.className='tracer';
  t.style.cssText=`left:${x1}px;top:${y1}px;width:${Math.hypot(x2-x1,y2-y1)}px;transform:rotate(${Math.atan2(y2-y1,x2-x1)*180/Math.PI}deg)`;
  ar.appendChild(t);
  a.classList.add('firing');
  await sleep(150/battleSpeed);
  a.classList.remove('firing');
  setTimeout(()=>t.remove(), 260);
}

/* 재생 — playBattle 과 같은 흐름에 '누가(i)' 가 붙었다. team · boss 는 runJoint 가 만든 유닛이다 */
async function playJoint(events, team, boss,active=()=>true){
  const arena=document.getElementById('arena');
  const stopped=()=>!active()||cur!=='battle'||!arena||!arena.isConnected||document.getElementById('arena')!==arena;
  if(stopped()) return null;
  const key =(side,i)=> side==='E' ? 'e' : 'p'+(i|0);
  const unit=(side,i)=> side==='E' ? boss : team[i|0];
  const nm  =(side,i)=> side==='E' ? `<span style="color:var(--bad);font-weight:700">${esc(boss.name)}</span>`
                                   : `<span class="k">${esc(team[i|0].name)}</span>`;
  team.forEach((u,i)=>{ setHP('p'+i, u.maxhp, u.maxhp); setSP('p'+i, 0); });
  setHP('e', boss.maxhp, boss.maxhp); setSP('e', 0);
  blog(`합동전 개시! <b>${team.map(u=>esc(u.name)).join(' · ')}</b> vs <b>${esc(boss.name)}</b>`);
  const sl=ms=>sleep(ms/battleSpeed);
  const down=new Set();
  const finishNow=(from)=>{
    for(let k=from;k<events.length;k++){ const x=events[k];
      if(x.t==='turn') setSP(key(x.side,x.i), x.sp);
      else if(x.t==='jam') setSP(key(x.dside,x.di), x.sp);
      else if(x.t==='heal') setHP(key(x.side,x.i), x.hp, unit(x.side,x.i).maxhp);
      else if(x.t==='hit' && !x.miss) setHP(key(x.dside,x.di), x.thp, unit(x.dside,x.di).maxhp);
      else if(x.t==='down'){ const el=AR('#fighter-p'+x.i); if(el) el.classList.add('down'); }
    }
    blog('<b>건너뜀</b> — 결과는 그대로입니다');
    const last=events[events.length-1];
    return stopped()?null:((last&&last.t==='end')?last.winner:'E');
  };
  /* 실시간 재생 — playBattle 과 같은 시간표(battleTimeline). 전위 · 후위 · 보스가 각자의 박자로 움직인다 */
  const tl=battleTimeline(events);
  let clock=0;
  const until=async t=>{ const w=t-clock; clock=Math.max(clock,t); if(w>0) await sl(w); };
  const strike=(aK,dK,side,i)=>{ if(side==='P' && i===1) shoot(aK,dK); else lunge(aK); };   // 기다리지 않는다
  await sl(400);
  for(let ix=0;ix<events.length;ix++){
    const e=events[ix];
    if(e.t!=='end') await until(tl[ix]);
    if(stopped()) return null;
    if(_skipReplay) return finishNow(0);
    if(e.t==='turn'){ setSP(key(e.side,e.i), e.sp); continue; }
    if(e.t==='skill'){
      banner(e.name);
      blog(`${nm(e.side,e.i)} 스킬 <b>${esc(e.name)}</b>!${e.aim==='all'?' <span class="m">광역</span>':e.aim==='back'?' <span class="m">후위 저격</span>':''}`);
      continue;
    }
    if(e.t==='trait'){ banner('광폭화'); blog(`<b style="color:var(--bad)">${esc(boss.name)} 광폭화!</b> 공격력이 크게 오릅니다`); continue; }
    if(e.t==='parry'){
      const pK=key(e.side,e.i), aK=key(e.dside,e.di);
      strike(aK,pK,e.dside,e.di);
      if(stopped()) return null;
      floatDmg(pK,'PARRY','parry'); shakeF(aK);
      blog(`${nm(e.side,e.i)} <span class="c">흘려내기!</span> ${nm(e.dside,e.di)} 의 공격을 흘리고 · ${nm(e.dside,e.di)} 행동 지연`);
      continue;
    }
    if(e.t==='heal'){
      const k=key(e.side,e.i);
      setHP(k, e.hp, unit(e.side,e.i).maxhp); floatDmg(k,'+'+e.amt,'heal');
      blog(`${nm(e.side,e.i)} 체력 <span class="h">+${e.amt}</span> ${e.src==='regen'?'재생':e.src==='repair'?'수리':'흡수'}`);
      continue;
    }
    if(e.t==='shield'){ const k=key(e.side,e.i); floatDmg(k,'방벽 '+e.amt,'heal');
      blog(`${nm(e.side,e.i)} <span class="h">방벽 ${e.amt}</span>`); continue; }
    if(e.t==='mark'){ blog(`${nm(e.side,e.i)} → ${nm(e.dside,e.di)} <span class="m">표적 +${Math.round(e.amt*100)}%</span>`); continue; }
    if(e.t==='jam'){ const k=key(e.dside,e.di); setSP(k,e.sp); floatDmg(k,'JAM','miss');
      blog(`${nm(e.side,e.i)} 재밍 — ${nm(e.dside,e.di)} SP −${e.amt} · 행동 지연`); continue; }
    if(e.t==='down'){
      down.add(e.i);
      const el=AR('#fighter-p'+e.i); if(el) el.classList.add('down');
      const exposed = e.i===0 && team.length>1 && !down.has(1);
      blog(`<b style="color:var(--bad)">${e.i===0?'전위':'후위'} 격추</b> — ${nm('P',e.i)}${exposed?' · 이제 후위가 모든 공격을 받습니다':''}`);
      continue;
    }
    if(e.t==='hit'){
      const aK=key(e.side,e.i), dK=key(e.dside,e.di);
      strike(aK,dK,e.side,e.i);
      if(stopped()) return null;
      if(e.miss){ floatDmg(dK,'MISS','miss'); blog(`${nm(e.side,e.i)} 의 공격을 ${nm(e.dside,e.di)} 이(가) <span class="m">회피!</span>`); }
      else{
        flash(); shakeF(dK); floatDmg(dK,(e.crit?'CRIT ':'')+e.dmg, e.crit?'crit':'norm');
        setHP(dK, e.thp, unit(e.dside,e.di).maxhp);
        blog(`${nm(e.side,e.i)} → ${nm(e.dside,e.di)} ${e.crit?'<span class="c">치명타 </span>':''}<b>${e.dmg}</b> 피해${e.cut?` <span class="m">(역장 −${e.cut})</span>`:''}${e.absorb?` <span class="m">(방벽 −${e.absorb})</span>`:''}`);
      }
      continue;
    }
    if(e.t==='end'){ await until(tl[ix]); await sl(300); return stopped()?null:e.winner; }
  }
  return stopped()?null:'E';
}

/* 토벌 보스 출격 — 서버가 정한 자리·전술·스탯·시드로 재생하고, 두 기의 정산을 받아 적는다 */
async function startJointBattle(opp){
  const state=S,account=net.state.accountId,request=_battleRequest;
  const sameOwner=()=>S===state&&net.state.accountId===account;
  const active=()=>sameOwner()&&request===_battleRequest&&cur==='battle';
  const r=await requestBattleStart('none',jointReq());
  if(!sameOwner())return;
  if(!r || r.error){
    if(!active())return;
    if(r && /expired|no pending|already started|not enough credits/i.test(r.error||'')){ _pendingOpp=null; return hunt(opp.tier||'BOSS'); }
    toast('전투를 시작하지 못했습니다'+(r&&r.error?': '+r.error:'')); return;
  }
  setPending(r.next && r.next.opponent, r.next && r.next.cost, r.next && r.next.rescue, r.next && r.next.tier, r.next && r.next.mode,r.next);
  if(!active()){applyJointBattle(r);renderAll();return;}
  if(r.cost){ S.credits=Math.max(0, S.credits-r.cost); renderWallet(); }
  const res=runJoint({ seed:r.seed, aim:r.boss.aim, team:r.team,
    boss:{ name:r.boss.callsign, type:r.boss.type, stats:r.boss.stats, tactic:r.boss.tactic, traits:r.boss.traits } });
  renderJointArena(r.team, r.boss.type, r.boss.callsign, '토벌 보스 · 합동전', r.boss.tactic);
  await bossEntrance();
  if(!sameOwner())return;
  if(!active()){applyJointBattle(r);renderAll();return;}
  const w=await playJoint(res.events, res.team, res.boss,active);
  if(!sameOwner())return;
  applyJointBattle(r);
  if(!w||!active()){renderAll();return;}
  _fight=fightJoint(res.events, r.team, { name:r.boss.callsign, type:r.boss.type, stats:r.boss.stats, tactic:r.boss.tactic, traits:r.boss.traits },
                    r.seed, r.boss.aim, r.win, false);
  renderResult(r.win, _lastReward, { name:r.team.map(t=>t.name).join(' · ') }, { name:r.boss.callsign }, opp);
}
function applyJointBattle(r){
  const lead=S.robots.find(x=>x.uid===r.robot.uid) || selRobot();
  applyServerBattle(r, lead);
  for(const x of (r.robots||[])){
    const rb=S.robots.find(y=>y.uid===x.uid);
    if(rb){ rb.level=x.level; rb.exp=x.exp; rb.fat=x.fat; rb.fatAt=x.fatAt; }
  }
  _lastReward.robots=(r.reward.robots||[]).map(x=>({ ...x,
    name:(ROBOT_TYPES[(S.robots.find(y=>y.uid===x.uid)||{}).type]||{}).name||'' }));
  commitLocal();
}

/* 레이드 — '보스 공격' 을 누르면 먼저 이 편성 화면이 뜬다 */
function raidPrep(){
  const r=_raid; if(!r) return go('trial');
  if(challengePending())return;
  toBattle(null,'trial');
  shield();
  _jctx = raidPrep;
  const J = r.aim ? { aim:r.aim, traits:r.traits||[] } : jointOf(r.boss);
  const foe=raidOf(r.week).stats;
  $('#sc-battle').innerHTML=battleView({mode:'raid',allies:jointForm().order.map(u=>battleUnit(S.robots.find(m=>m.uid===u))),enemies:[{type:r.boss,level:r.level,stats:foe,power:0}],powerKnown:false,...battleIdentity(),enemyName:r.name,enemyMeta:'주간 레이드 · 동시 합동전',
    details:`<div class="jointprep">${jointBossHtml(r.boss,r.level,J,r.name)}${jointFormHtml(J.traits)}</div>`,
    brief:`<p>오늘 남은 도전 ${r.triesLeft} / ${r.daily} · 매번 가득 찬 보스 체력 ${fmt(r.battleHp)}에서 시작합니다. 피해만 공동 체력에 반영되며 피로도는 쌓이지 않습니다.</p>`,costLabel:'무료',rewardLabel:'반영 피해에 따른 보상',
    actions:`<button class="bv-launch" ${r.triesLeft>0&&!r.killed?'':'disabled'} onclick="ROWAR.raidRun()">보스 공격 ${icon('chevron')}</button><button class="btn ghost" onclick="ROWAR.go('trial')">레이드로 돌아가기</button>`});
}

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

/* ── 대사 재생 ────────────────────────────────────────────
   칸에 들어가기 전과 이긴 뒤에 대사가 흐른다. 이게 없으면 전투 다섯 판일 뿐이다.

   규칙 셋.
     ① **한 번에 한 줄.** 원작이 짧게 끊어 가고, 그 호흡이 이 이야기의 말투다.
        여러 줄을 한꺼번에 띄우면 읽는 사람이 어디를 보는지 모른다.
     ② **누르면 넘어간다.** 자동 재생은 읽는 속도가 사람마다 다르다는 것을 무시한다.
        글자는 흘러나오되(타자 효과) 누르면 그 줄이 즉시 끝난다.
     ③ **건너뛸 수 있다.** 다시 하는 사람에게 같은 대사를 강제하면 그게 벌이 된다.
        한 번 본 칸은 아예 안 틀어 준다(cellSeen).

   화면을 떠나면 약속이 풀린다 — 그래야 재생 중 탭을 옮겨도 갇히지 않는다. */
const SPEAK_MS = 18;                       // 글자 하나당. 빠르게 — 읽는 것이 목적이다
let _scriptAbort = null;

/* 이미 본 칸은 before 를 건너뛴다. 진행 문자열과 따로 두는 이유 —
   '깼다' 와 '봤다' 는 다르다. 지고 나온 사람도 대사는 본 것이다. */
const seenKey = 'rowar.seen.v1';
function cellSeen(id, when){
  try{ return (JSON.parse(localStorage.getItem(seenKey)) || {})[id + ':' + when] === 1; }
  catch(e){ return false; }
}
function markSeen(id, when){
  try{
    const m = JSON.parse(localStorage.getItem(seenKey)) || {};
    m[id + ':' + when] = 1;
    localStorage.setItem(seenKey, JSON.stringify(m));
  }catch(e){}
}

function speakerHtml(s){
  const sp = SPEAKERS[s];
  if(!sp || !sp.ko) return '';
  return `<div class="spk ${sp.kind}${sp.hostile ? ' foe' : ''}">${esc(sp.ko)}${
    sp.note ? `<small>${esc(sp.note)}</small>` : ''}</div>`;
}

/* 대사 한 묶음을 끝까지 재생한다. 돌려주는 값: 끝까지 봤으면 true, 화면을 떠났으면 false. */
/* 대사 구간 사이를 넘어가는 '지금 걸린 그림'. before → 전투 → after 가 각각 다른
   playScript 라, 여기 두지 않으면 구간이 바뀔 때마다 그림이 사라진다. */
let _storyArt = null;
function stopScript(){
  const ac=_scriptAbort;
  if(!ac) return;
  ac.stop=true; ac.next?.();
}
async function playScript(beats,title,endLabel){
  if(!beats?.length) return true;
  stopScript();
  const ac={stop:false,skip:false,next:null}; _scriptAbort=ac;
  toBattle(null,'terr');
  $('#sc-battle').innerHTML=frontStoryView(title,endLabel);
  const view=$('#storyView'),lineEl=$('#storyLine'),spkEl=$('#storySpk'),
    nEl=$('#storyN'),goEl=$('#storyGo'),nextEl=$('#storyNext'),
    artEl=$('#storyArt'),artImg=$('#storyArtImg'),readingEl=$('#storyReading');
  const live=()=>!ac.stop && _scriptAbort===ac && cur==='battle' && view.isConnected && $('#storyView')===view;
  let artKey=_storyArt;
  if(artKey){artImg.src=artPath(artKey);artEl.hidden=false;}
  const setArt=key=>{
    if(key===undefined||key===artKey)return;
    artKey=_storyArt=key;
    const src=artPath(key);
    if(!src){artEl.hidden=true;artImg.removeAttribute('src');return;}
    const pre=new Image();
    pre.onload=()=>{if(!live()||artKey!==key)return;artImg.src=src;artEl.hidden=false;};
    pre.onerror=()=>{if(!live()||artKey!==key)return;artEl.hidden=true;artImg.removeAttribute('src');};
    pre.src=src;
  };
  const prefetch=from=>{
    for(let j=from;j<beats.length;j++)if(beats[j].art&&beats[j].art!==artKey){new Image().src=artPath(beats[j].art);return;}
  };
  const advance=()=>ac.next?.();
  view.addEventListener('click',e=>{if(!e.target.closest('button'))advance();});
  nextEl.addEventListener('click',advance);goEl.addEventListener('click',advance);
  $('#storySkip').addEventListener('click',()=>{ac.skip=true;advance();});
  $('#storyExit').addEventListener('click',enterFront);
  nextEl.focus({preventScroll:true});
  try{
    for(let bi=0;bi<beats.length;bi++){
      if(!live()||ac.skip)break;
      const b=beats[bi],last=bi===beats.length-1;
      nEl.textContent=`${bi+1} / ${beats.length}`;
      if(b.bg)setTerrain(b.bg);setArt(b.art);prefetch(bi+1);
      spkEl.innerHTML=speakerHtml(b.s);
      const sp=SPEAKERS[b.s];
      lineEl.className='story-line'+(sp?.kind==='system'?' sys':'')+(sp?.hostile?' foe':'')+(!b.s||sp?.kind==='narr'?' narr':'');
      lineEl.textContent='';readingEl.textContent='';nextEl.hidden=false;goEl.hidden=true;
      const text=b.t;
      await new Promise(resolve=>{
        let i=0,done=false;
        const finish=()=>{if(done)return;done=true;clearInterval(timer);lineEl.textContent=text;resolve();};
        const timer=setInterval(()=>{
          if(!live()||ac.skip){finish();return;}
          i+=2;lineEl.textContent=text.slice(0,i);if(i>=text.length)finish();
        },SPEAK_MS);
        ac.next=finish;
        if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)finish();
      });
      if(!live()||ac.skip)break;
      readingEl.textContent=(sp?.ko?sp.ko+' · ':'')+text;
      nextEl.hidden=last;goEl.hidden=!last;
      /* Move keyboard focus only from the button that has just become hidden. */
      if(last&&document.activeElement===nextEl)goEl.focus({preventScroll:true});
      await new Promise(resolve=>{ac.next=resolve;});
    }
    return live();
  }finally{if(_scriptAbort===ac)_scriptAbort=null;}
}

/* ------------------------------- 전선 화면 ------------------------------- */
/* 점령이 *지키는 땅* 이라면 전선은 *미는 선* 이다. 한 줄기로 이어지는 진행이고,
   **새 계정이 처음 보는 화면**이다(DESIGN.md F장).

   ── 오프라인에서도 돈다 ──────────────────────────────
   다른 모드와 다르다. 대전·뽑기·시련은 서버가 없으면 아예 막는데 전선은 막으면 안 된다 —
   연결이 끊겼다고 **게임을 시작조차 못 하는** 화면이 되기 때문이다.
   규칙(js/front.js)이 클라와 서버 양쪽에 같은 파일로 있으므로, 서버가 있으면 서버가
   판정하고 없으면 같은 함수로 여기서 돌린 뒤 로컬 저장에 적는다. */
let _frontTab = 'front';
function setFrontTab(k){ _frontTab = (k === 'terr') ? 'terr' : 'front'; go('terr'); }
function renderTerrHome(){ return _frontTab === 'terr' ? renderTerr() : renderFront(); }

/* 진행은 로컬 저장에 둔다. 서버가 있으면 서버 값으로 덮어쓴다 —
   어느 쪽이든 **읽는 자리는 한 곳**이라 화면이 둘로 갈리지 않는다. */
const frontProg = () => readProgress(S.campaign);
const myMaxLv = () => Math.max(1, ...S.robots.map(r => r.level | 0), 1);

/* 장 고르기. 기본은 **지금 밀고 있는 장** — 아직 안 깬 칸 중 열린 첫 칸이 있는 장이다.
   다 깼으면 마지막 장. 앞 장을 다 깨야 다음 장의 첫 칸이 열리므로(cellOpen) 장에 따로 잠금을 달지 않는다. */
let _frontCh = null;
const _frontIntroAttempted=new Set();
let _frontCell=null;
function setFrontCh(id){
  const ch=frontView(frontProg(),myMaxLv()).find(x=>x.id===id);
  if(!ch?.cells[0].open)return;
  _frontCh=id;_frontCell=null;renderFront();
}
let _frontReady=false;
const playedAccount=()=>((S.stat?.wins|0)+(S.stat?.losses|0)>0)||frontProg().some(v=>v>0);
function frontAfterState(){
  _frontReady=true;_frontCh=null;_frontCell=null;
  for(const ch of frontView(frontProg(),myMaxLv()))if(ch.cells.some(c=>c.cleared))markSeen(ch.id,'open');
  if(cur!=='terr')return;
  if(document.body.classList.contains('gated')&&playedAccount()){go('home');return;}
  renderTerrHome();
}
function currentChapter(view){
  const live = view.find(ch => ch.cells.some(c => c.open && !c.cleared));
  return (live || view[view.length - 1]).id;
}
function chapterOfCell(id){ return FRONT_CHAPTERS.find(ch => ch.cells.some(c => c.id === id)) || null; }

function frontTeam(){
  const selected=selRobot();
  if(!net.state.online)return selected?[selected]:[];
  let list=(S.squad?.length?S.squad:[selected?.uid]).map(u=>S.robots.find(r=>r.uid===u)).filter(r=>r&&S.expd?.uid!==r.uid);
  const i=list.findIndex(r=>r.uid===selected?.uid);
  if(i>0)list.unshift(list.splice(i,1)[0]);
  return list.slice(0,2);
}
function renderFront(){
  const view=frontView(frontProg(),myMaxLv());
  if(!_frontCh||!view.some(v=>v.id===_frontCh&&v.cells[0].open))_frontCh=currentChapter(view);
  const ch=view.find(v=>v.id===_frontCh);
  if(_frontReady&&!cellSeen(ch.id,'open')&&!_frontIntroAttempted.has(ch.id)){
    const op=openingOf(ch.id);
    if(op){
      _frontIntroAttempted.add(ch.id);
      const owner=S,account=net.state.accountId,request=_battleRequest;
      playScript(op,`${ch.no}장 ${ch.ko}`,'전선으로').then(ok=>{
        if(!ok||S!==owner||net.state.accountId!==account||request!==_battleRequest)return;
        markSeen(ch.id,'open');go('terr');
      });return;
    }
  }
  const selected=ch.cells.find(c=>c.id===_frontCell&&c.open)||ch.cells.find(c=>c.open&&!c.cleared)||[...ch.cells].reverse().find(c=>c.open);
  _frontCell=selected?.id||null;
  $('#sc-terr').innerHTML=frontCampaignView({chapters:view,chapter:ch,selected,
    team:frontTeam().map(rb=>({...rb,power:power(rb),fat:fatOf(rb)})),
    gates:lockedGates(frontProg(),myMaxLv()),online:net.state.online});
}

/* 장을 처음부터 다시 — **이야기만** 되감는다(2026-09-19 사용자 지시: "다시 시작할 경우 얻는 이익은 없다").
   진행(player.campaign)은 건드리지 않는다. 진행을 지우면 첫 클리어 보상이 다시 나가고,
   그걸 막으려면 '보상 받음' 을 따로 적는 칸이 서버에 하나 더 있어야 한다.
   대신 '봤다' 표(rowar.seen.v1)에서 이 장의 것만 지운다 — 장 도입이 곧바로 다시 흐르고,
   깬 칸에 다시 들어가면 싸우기 전후 대사가 다시 나온다. 깬 칸은 원래 보상이 0 이다. */
function restartCh(id){
  const ch = FRONT_CHAPTERS.find(x => x.id === id); if(!ch) return;
  openModal(`<div class="mhead">${ch.no}장 ${esc(ch.ko)} · 처음부터 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
    <p class="fstory">장 도입부터 이야기를 다시 봅니다. 칸에 들어가면 싸우기 전후의 대사도 다시 나옵니다.</p>
    <div class="hint" style="margin-bottom:14px">깬 칸은 그대로 남습니다. 다시 깨도 첫 클리어 보상은 없습니다.</div>
    <div class="row-btns">
      <button class="btn big gold" onclick="ROWAR.restartChGo('${ch.id}')">다시 보기</button>
      <button class="btn big ghost" onclick="ROWAR.closeModal()">그만두기</button></div>`);
}
function restartChGo(id){
  const ch = FRONT_CHAPTERS.find(x => x.id === id); if(!ch) return;
  const keys = [ch.id + ':open', ch.id + ':close', ...ch.cells.flatMap(c => [c.id + ':before', c.id + ':after'])];
  try{
    const m = JSON.parse(localStorage.getItem(seenKey)) || {};
    for(const k of keys) delete m[k];
    localStorage.setItem(seenKey, JSON.stringify(m));
  }catch(e){}
  _frontIntroAttempted.delete(ch.id);
  _storyArt = null;                        // 앞 장면의 그림을 이어받지 않는다 — 첫 줄부터 새로
  closeModal();
  _frontCh = id;
  renderFront();                           // 도입을 안 본 상태가 됐으므로 곧바로 도입이 흐른다
}

/* Selection changes the briefing; only the explicit launch button starts a sortie. */
function openCell(id){
  if(!cellOpen(frontProg(),cellIndex(id))){toast('앞 칸을 먼저 깨야 합니다');return;}
  _frontCh=chapterOfCell(id)?.id;_frontCell=id;renderFront();
  const title=$('#frontDetailTitle');
  if(window.matchMedia('(max-width:700px)').matches){
    $('#frontDetail')?.scrollIntoView({block:'start',behavior:'instant'});
    title?.focus({preventScroll:true});
  }
}

async function runCell(id){
  closeModal();
  const c=FRONT_CELLS.find(x=>x.id===id);if(!c)return;
  if(!cellOpen(frontProg(),cellIndex(id))){toast('앞 칸을 먼저 깨야 합니다');return;}
  if(!frontTeam().length){toast('출전 가능한 기체가 없습니다');return;}
  const owner=S,account=net.state.accountId,request=_battleRequest,online=net.state.online;
  const sameOwner=()=>S===owner&&net.state.accountId===account;
  const active=()=>sameOwner()&&request===_battleRequest&&cur==='battle';
  _frontCh=chapterOfCell(id)?.id;_frontCell=id;setTerrain(c.terrain);
  const pre=scriptOf(id,'before');
  if(pre&&!cellSeen(id,'before')){
    const ok=await playScript(pre,c.ko,'출격');
    if(!ok||!active())return;
    markSeen(id,'before');
  }
  toBattle(null,'terr');
  $('#sc-battle').innerHTML=`<div class="fv-empty ui-surface" role="status"><div class="spinner"></div>${esc(c.ko)} · 전선 진입 중…</div>`;
  /* A request can succeed after navigation. Save its authoritative result for this
     account, but never reopen the replay or transplant it into another account. */
  let r=online?await net.front(id):null;
  if(!sameOwner())return;
  if(r?.error||online&&!r){
    if(active()){toast(ERR_KO[r?.error]||r?.error||'전선 결과를 받지 못했습니다');go('terr');}return;
  }
  if(!r){if(!active())return;r=runCellLocal(c);}
  applyFront(r);
  if(!active()){if(cur==='terr'&&_frontTab==='front')renderFront();return;}
  if(!await replayBreach(r,c.ko,active)||!active())return;
  if(r.win){
    const post=scriptOf(id,'after');
    if(post&&!cellSeen(id,'after')){
      const seen=await playScript(post,c.ko,'전과 확인');
      if(!seen||!active())return;markSeen(id,'after');
    }
    const chp=chapterOfCell(id);
    if(chp&&chp.cells.at(-1).id===id&&!cellSeen(chp.id,'close')){
      const close=closingOf(chp.id);
      if(close){const ok=await playScript(close,`${chp.no}장 ${chp.ko}`,'다음으로');if(!ok||!active())return;markSeen(chp.id,'close');}
    }
  }
  if(active())renderFrontResult(r,c);
}

/* 오프라인 판정. 서버(server/front.js)와 **같은 함수들**을 쓴다 —
   식이 두 벌이 되면 온라인과 오프라인의 결과가 갈린다. */
function runCellLocal(c){
  const i = cellIndex(c.id), prog = frontProg();
  const already = prog[i] > 0;
  const rb = selRobot();
  const mechs = [{ name: ROBOT_TYPES[rb.type].name, type: rb.type, uid: rb.uid, level: rb.level,
                   stats: applyTerrain(computeStats(rb, S.parts), c.terrain) }];
  const lines = buildLines(c);
  const seeds = Array.from({ length: maxRounds(lines.length, mechs.length) },
                           () => (Math.random() * 4294967296) >>> 0);
  const out = runBreach({ mechs, lines, seeds });

  const perLine = Math.max(1, Math.round(battleExp(c.lv) * (CONST.TERR.EXP_LINE || 0.55)));
  const won = out.rounds.filter(x => x.win).length, tried = out.rounds.length;
  const amt = perLine * won + Math.round(perLine * 0.30) * (tried - won);
  const lv = gainExp(rb, amt);
  const add = addFat(rb, out.downed ? (CONST.TERR.FAT_DOWN || 11) : (CONST.TERR.FAT_LIVE || 4));

  const gain = out.win ? rewardOf(c, already) : null;
  const unlocked = out.win ? unlockedBy(c, prog, myMaxLv()) : null;
  let part = null, campaign = S.campaign;
  if(gain){
    if(gain.part) part = rollPart(Math.max(1, rb.level | 0), Math.random,
                                  'f' + Date.now().toString(36) + i, gain.part);
    const next = prog.slice(); next[i] = 1; campaign = writeProgress(next);
  }
  return { ok: true, local: true, win: out.win, cell: c.id, first: !!gain,
           mechs, lines, seeds, cleared: out.cleared, downed: out.downed,
           exp: [{ uid: rb.uid, amt, from: lv.from, to: lv.to, exp: rb.exp }],
           fat: [{ uid: rb.uid, add, now: fatOf(rb), fatAt: rb.fatAt }],
           gain: gain ? { ...gain, part } : null, unlocked,
           credits: S.credits + (gain ? gain.credits : 0),
           scrap: S.scrap + (gain ? gain.scrap : 0), campaign };
}

/* 결과를 로컬에 받아 적는다. 온라인이면 서버가 이미 확정한 값이다. */
function applyFront(r){
  S.credits = r.credits; S.scrap = r.scrap; S.campaign = r.campaign;
  for(const e of (r.exp || [])){ const rb = S.robots.find(x => x.uid === e.uid);
    if(rb){ rb.level = e.to; if(e.exp != null) rb.exp = e.exp; } }
  for(const f of (r.fat || [])){ const rb = S.robots.find(x => x.uid === f.uid);
    if(rb){ rb.fat = f.now; if(f.fatAt != null) rb.fatAt = f.fatAt; } }
  if(r.gain && r.gain.part) addPart(r.gain.part);
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){}
  if(!r.local) net.cancelSync();          // 서버가 이미 최신이다
  renderWallet();
}

function renderFrontResult(r, c){
  shield(); toBattle(null, 'terr');
  const lines = [];
  if(r.win && r.first && r.gain){
    if(r.gain.credits) lines.push(`<div class="r">크레딧 <b>+${fmt(r.gain.credits)}</b></div>`);
    if(r.gain.scrap) lines.push(`<div class="r">스크랩 <b>+${fmt(r.gain.scrap)}</b></div>`);
    if(r.gain.part) lines.push(`<div class="r" style="color:var(--gold)">파츠 <b>${esc(r.gain.part.name)}</b> 획득</div>`);
  }else if(r.win){
    lines.push(`<div class="r" style="color:var(--dim)">이미 깬 칸이라 보상은 없습니다</div>`);
  }else{
    lines.push(`<div class="r">방어선 <b>${r.cleared}</b>겹 돌파</div>`);
    lines.push(`<div class="r" style="color:var(--dim)">다시 가면 방어선은 가득 찬 상태로 돌아옵니다</div>`);
  }
  for(const e of (r.exp || [])){ const rb = S.robots.find(x => x.uid === e.uid); if(!rb || !e.amt) continue;
    lines.push(`<div class="r">${ROBOT_TYPES[rb.type].name} 경험치 <b>+${fmt(e.amt)}</b>${
      e.to > e.from ? ` · <b style="color:var(--gold)">Lv.${e.from}→${e.to}</b>` : ''}</div>`); }
  for(const f of (r.fat || [])){ const rb = S.robots.find(x => x.uid === f.uid); if(!rb || !f.add) continue;
    lines.push(`<div class="r" style="color:var(--bad)">${ROBOT_TYPES[rb.type].name} 피로도 +${f.add} (${f.now})</div>`); }

  _fight=fightBreach(r);
  $('#sc-battle').innerHTML=frontResultView(r,c,{rewards:lines.join(''),repair:frontFixHtml((r.fat||[]).map(f=>f.uid))})+analysisSlot();
  fillAnalysis();
}

/* 전선 결과에서 바로 정비 — 방금 싸운 기체만(편성 두 기가 같이 나간다).
   격납고까지 돌아가 기체마다 정비를 누르고 다시 전역 탭으로 오는 길이 길어서,
   곧장 다음 칸으로 가고 싶은 사람이 지친 채로 나가게 됐다(2026-09-19 사용자 지시 — "수리하기").
   이름은 게임 안에서 쓰는 '정비' 그대로다. 서버 동작도 격납고의 정비와 같은 것 하나다. */
function frontFixHtml(uids){
  const rbs = uids.map(u => S.robots.find(x => x.uid === u)).filter(Boolean);
  const cost = rbs.reduce((a, rb) => a + serviceCost(rb), 0);
  const dis = cost <= 0 || !net.state.online || S.credits < cost;
  const label = cost <= 0 ? '정비 완료' : !net.state.online ? '정비 · 서버 연결 필요' : S.credits < cost ? `정비 · 크레딧 ${fmt(cost)} 필요` : `정비하기 · 크레딧 ${fmt(cost)}`;
  return `<button class="btn big" id="frontFix" ${dis ? 'disabled' : ''}
    ${cost > 0 && S.credits < cost ? 'title="크레딧이 부족합니다"' : ''}
    onclick="ROWAR.frontFix('${uids.map(esc).join(',')}')">${label}</button>`;
}
async function frontFix(list){
  const owner=S,account=net.state.accountId,button=$('#frontFix');
  const sameOwner=()=>S===owner&&net.state.accountId===account;
  const uids = [...new Set(String(list || '').split(',').filter(Boolean))];
  let spent = 0, n = 0;
  for(const u of uids){
    const rb = S.robots.find(x => x.uid === u);
    if(!rb || serviceCost(rb) <= 0) continue;
    if(!sameOwner())return;
    const r = await srvHangar('service', { robotUid: u }); if(!sameOwner())return; if(!r) break;   // 실패는 srvHangar 가 알린다
    S.credits = r.credits; rb.fat = 0; rb.fatAt = Date.now(); spent += r.cost | 0; n++;
  }
  if(n){ commitLocal(); toast(`${n}기 정비 완료 · 크레딧 −${fmt(spent)}`); }
  const b = $('#frontFix'); if(b&&b===button) b.outerHTML = frontFixHtml(uids);
}

async function renderTerr(){
  const request=++_terrRequest, accountId=net.state.accountId;
  const el=$('#sc-terr');
  const wrap = inner => `<div class="ui-pagehead"><div><span class="ui-eyebrow">TERRITORY CONTROL</span><h1>점령</h1></div></div>${inner}`;
  if(!net.state.online){
    el.innerHTML = wrap(commonMessage({title:'서버 연결이 필요합니다',description:'점령 지도는 모든 플레이어가 공유합니다. 서버 연결 후 거점을 확인할 수 있습니다.'}));
    return;
  }
  const fresh = _terr && (Date.now()-_terrAt) < TERR_TTL;
  if(!fresh) el.innerHTML = wrap(commonMessage({title:'작전 지도를 불러오는 중',description:'거점과 방어선 현황을 확인하고 있습니다.',loading:true}));

  const r = fresh ? _terr : await net.territory('view');
  if(request!==_terrRequest || accountId!==net.state.accountId) return;
  if(r && !r.error){ _terr=r; if(!fresh) _terrAt=Date.now(); }
  /* 기다리는 사이 '전선' 탭으로 갔거나 화면을 떠났으면 그리지 않는다 — 안 막으면 늦게 온
     지도가 전선 화면을 덮는다(도감·순위에서 났던 것과 같은 모양). 받은 지도는 위에서 캐시했다. */
  if(_frontTab !== 'terr' || cur !== 'terr') return;
  if(!r || r.error){
    el.innerHTML = wrap(commonMessage({title:'지도를 불러오지 못했습니다',description:r?.error||'서버 응답을 받지 못했습니다. 잠시 후 다시 시도하세요.',action:true}));
    return;
  }
  drawTerr(r);
}

/* 남은 보호 시간(ms). 서버가 준 끝 시각을 그대로 쓴다 — 클라 시계로 세면 늦추거나 당길 수 있다. */
function protLeft(node){
  if(!node || !node.protectUntil) return 0;
  return Math.max(0, node.protectUntil - Date.now());
}

let _territorySelected = 'n01', _territoryFilter='all', _returnToTerritory=false, _terrRequest=0;
function enterTerritory(){ _frontTab='terr'; go('terr'); }
function enterFront(){ _frontTab='front'; go('terr'); }
function prepareTerritory(){ _returnToTerritory=true; hangarUid=null; hangarTab='info'; go('hangar'); }
function returnTerritory(){ _returnToTerritory=false; enterTerritory(); }
const _territoryViewport={zoom:1,left:0,top:0};
function drawTerr(r){
  const squad=S.squad.map(u=>S.robots.find(rb=>rb.uid===u)).filter(Boolean);
  const lead=selRobot(); squad.sort((a,b)=>(b.uid===lead?.uid?1:0)-(a.uid===lead?.uid?1:0));
  const squadHtml=squad.map((rb,i)=>`<div class="tc-squad-card">${sprite(rb.type,false)}<span><small>${i===0?'선봉':'예비'}</small><b>${esc(ROBOT_TYPES[rb.type].name)}</b><em>Lv.${rb.level} · 피로 ${fatOf(rb)}</em></span></div>`).join('');
  const el=$('#sc-terr');
  el.innerHTML=territoryView({data:r, selectedId:_territorySelected, filter:_territoryFilter, squadHtml});
  bindTerritory(el,{
    view:_territoryViewport,
    select:id=>{
      openNode(id);
      const detail=$('#tc-detail'); detail?.focus({preventScroll:true});
      if(matchMedia('(max-width:700px)').matches) detail?.scrollIntoView({block:'start'});
    },
    filter:value=>{_territoryFilter=value;drawTerr(r);},
    refresh:()=>{dropTerrCache();renderTerr();}
  });
  openNode(_territorySelected);
}
function showTerritoryDetail(id,html){
  const detail=$('#tc-detail');
  if(cur!=='terr'||_frontTab!=='terr'||!detail){openModal(html);return;}
  _territorySelected=id;
  const n=NODE_BY[id], st=_terr?.nodes.find(x=>x.id===id)||{};
  document.querySelectorAll('#sc-terr [data-node]').forEach(el=>{
    const on=el.dataset.node===id; el.classList.toggle('selected',on);el.setAttribute('aria-pressed',String(on));
  });
  document.querySelectorAll('#sc-terr [data-region]').forEach(el=>el.classList.toggle('selected',el.dataset.region===id));
  const content=document.createElement('div'); content.innerHTML=html;
  content.querySelector('.mhead')?.remove();
  const table=content.querySelector('.tdet');
  if(table){ const extra=document.createElement('details');extra.innerHTML='<summary>거점 정보 자세히</summary>';extra.append(table);content.append(extra);}
  const lines=content.querySelector('.tlines');
  if(lines){
    if(lines.previousElementSibling?.classList.contains('hint')) lines.previousElementSibling.remove();
    const extra=document.createElement('details');extra.innerHTML=`<summary>방어선 ${st.lines||n.mon.length}겹 확인</summary>`;lines.before(extra);extra.append(lines);
  }
  const own=st.owner==='me'?'내 점령지':st.owner==='other'?'다른 지휘관 · '+esc(st.ownerName||'지휘관'):'몬스터 주둔';
  detail.innerHTML=`<div class="ui-section-label">선택 거점 <small>REGION INFO</small></div>
    <div class="tc-detail-image"><img src="assets/terrain/${n.terrain}.webp" alt="${esc(TERRAIN[n.terrain]?.ko||'지형')}"><span>SECTOR ${id.slice(1)} · ${n.rar}</span></div>
    <h2>${esc(n.ko)}</h2><p class="tc-detail-owner ${st.owner==='me'?'mine':st.owner==='other'?'enemy':''}">${own}${protLeft(st)>0?' · 보호 중':''}</p>
    <dl class="tc-specs"><div><dt>방어 전력</dt><dd>${fmt(st.pw||0)}</dd></div><div><dt>수입 / 시간</dt><dd>${fmt(n.crH)} 크레딧 · ${fmt(n.scH)} 스크랩</dd></div><div><dt>편성 제한</dt><dd>${n.maxRar?esc(n.maxRar)+' 이하':'등급 제한 없음'}</dd></div></dl>
    ${content.innerHTML}<button class="btn tc-prep" onclick="ROWAR.prepareTerritory()">${icon('hangar')} 기체 정비 · 편성 변경</button>`;
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
  showTerritoryDetail(id, `<div class="mhead">${n.ko} <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
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
      ? `<div class="hint" style="margin-top:10px;color:var(--bad)">🔒 <b>Lv.${n.minLv} 이상</b>이어야 들어갑니다 · 기체를 더 키우세요</div>`
      : mine
      ? `<div class="hint" style="margin-top:10px;color:var(--gold)">이미 내 점령지입니다. 수입은 지도에서 한꺼번에 받습니다.${
          prot?`<br>지금은 <b>보호 중</b>입니다 — ${dur(prot)} 뒤에 풀립니다.`:''}</div>`
      : !ok.length
        ? `<div class="hint" style="margin-top:10px;color:var(--bad)">편성 제한에 걸려 데려갈 기체가 없습니다. 격납고에서 편성을 바꾸세요.</div>`
        : prot
          /* 보호 중 — 보통 공격은 아예 막고, 코어를 내는 강행만 남긴다.
             강행은 방어선이 두꺼워지므로 무엇이 늘어나는지 버튼 위에 적는다. */
          ? `<div class="hint" style="margin:10px 0 4px;color:var(--gold)">🛡 점령 직후 <b>보호 중</b> · ${dur(prot)} 남음</div>
             <div class="hint" style="color:var(--bad)">지금 치려면 <b>강행</b>해야 합니다 · 코어 ${CONST.TERR.RAID_CORE}개 · 몬스터 뒤에 <b>${esc(s.ownerName||'점령자')}의 편성 ${CONST.SQUAD_MAX}기</b>가 더 붙습니다</div>
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
  if(!n)return;
  const owner=S,account=net.state.accountId,request=_battleRequest;
  const sameOwner=()=>S===owner&&net.state.accountId===account;
  const active=()=>sameOwner()&&request===_battleRequest&&cur==='battle';
  _territorySelected=id;
  setTerrain(n && n.terrain);      // 이 칸의 지형이 전투 배경이 된다
  toBattle(null, 'terr');
  $('#sc-battle').innerHTML=commonMessage({title:`${n.ko} · ${raid?'강행 진입':'진입'} 중`,description:raid?'점령자의 편성까지 확인하고 있습니다.':'방어선을 확인하고 있습니다.',loading:true});
  const [r]=await Promise.all([net.territory('attack',{node:id, raid:!!raid}), sleep(700)]);
  if(!sameOwner())return;
  if(!r || r.error){
    if(!active())return;
    /* 보호 거절은 남은 시간을 함께 준다. 그냥 '실패'라고만 하면 왜 막혔는지 알 수 없다. */
    if(r && r.error==='locked')
      toast(`Lv.${r.minLv??n.minLv} 이상이어야 들어갈 수 있습니다${r.myLv!=null?` (지금 Lv.${r.myLv})`:''}`);
    else if(r && r.error==='protected' && r.protectUntil)
      toast(`점령 직후 보호 중입니다 · ${dur(Math.max(0,r.protectUntil-Date.now()))} 남음`);
    else toast(ERR_KO[r&&r.error]||('공격하지 못했습니다'+(r&&r.error?': '+r.error:'')));
    dropTerrCache(); enterTerritory(); return;
  }
  dropTerrCache();
  applyTerrAttack(r);
  if(!active()){if(cur==='terr'&&_frontTab==='terr')renderTerr();return;}
  await playBreach(r,active);   // 재생이 끝날 때까지 문지기를 붙든다
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
async function playBreach(r,active=()=>true){
  const ok = await replayBreach(r, (NODE_BY[r.node] || {}).ko || '점령지',active);
  if(ok&&active()) renderBreachResult(r);
}

/* 방어선 재생만 하는 부분. 점령전과 전선이 같이 쓴다 — 결과 화면은 서로 다르지만
   '여러 겹을 이어서 친다' 는 재생 규칙은 하나여야 한다.
   돌려주는 값: 끝까지 재생했으면 true, 화면을 떠났으면 false. */
async function replayBreach(r, label,active=()=>true){
  beginReplay();
  const out=runBreach({ mechs:r.mechs, lines:r.lines, seeds:r.seeds, hpLeft:r.hpLeft0 });
  const total=r.lines.length;

  for(let i=0;i<out.rounds.length;i++){
    if(!active()||cur!=='battle')return false;
    const rd=out.rounds[i];
    const M=r.mechs[rd.mi], L=r.lines[rd.li];
    const P=makeUnit(M.name,M.type,M.stats); P.hp=rd.pHp; P.sp=rd.pSp;
    const E=makeUnit(L.name,L.type,L.stats); E.hp=rd.eHp; E.sp=rd.eSp;

    renderArena(M.type,L.type,M.name,L.name, `${label} · 방어선 ${rd.li+1}/${total}`,null,null,'terr');
    if(arenaGone()) return false;
    /* 두 번째 기체가 들어오는 순간이 이 규칙의 핵심이라 말로도 한 줄 남긴다. */
    if(i>0 && rd.mi!==out.rounds[i-1].mi)
      blog(`<b style="color:var(--bad)">선봉 격추</b> — <span class="k">${M.name}</span> 투입`);
    else if(i>0)
      blog(`<b class="k">방어선 ${rd.li} 돌파</b> — 체력 ${Math.round(rd.pHp)} 로 이어서 진입`);

    if(rarOf(L.type)==='BOSS') await bossEntrance();
    if(!active()||arenaGone())return false;
    const w=await playBattle(rd.events,P,E,{ pHp:rd.pHp, eHp:rd.eHp, pSp:rd.pSp, eSp:rd.eSp });
    if(!w) return false;                 // 화면을 떠났다. 보상은 이미 반영됨
    await sleep(320/battleSpeed);
    if(!active()||arenaGone())return false;
  }
  return active();
}

function renderBreachResult(r){
  shield();
  toBattle(null, 'terr');
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

  _fight=fightBreach(r);
  $('#sc-battle').innerHTML=territoryResultView(r,node,lines.join(''))+analysisSlot();
  fillAnalysis();
}

async function claimTerr(){
  const owner=S,account=net.state.accountId;
  const r=await net.territory('claim');
  if(S!==owner||account!==net.state.accountId)return;
  if(!r) return;
  if(r.error){ toast(ERR_KO[r.error]||('실패: '+r.error)); return; }
  S.credits=r.player.credits; S.scrap=r.player.scrap;
  if(r.player.cores!=null) S.cores=r.player.cores;
  commitLocal(); dropTerrCache(); renderWallet();
  if(cur==='terr'&&_frontTab==='terr')renderTerr();
  toast(`점령지 ${r.nodes}칸 · 크레딧 +${fmt(r.cr)} · 스크랩 +${fmt(r.sc)}${r.core?` · 코어 +${r.core}`:''}`);
}

/* ── 화면이 바뀐 직후의 클릭 막기 ────────────────────────
   전투 시작을 따다닥 누르면 첫 클릭으로 아레나가 그려지고, **그 자리에 있던 버튼이
   다른 버튼으로 바뀐다.** 남은 클릭은 새로 온 버튼에 그대로 꽂힌다 — 실측에서
   전투 시작 자리가 속도 버튼이 되어 배속이 x1→x2→x4 로 뛰었다.
   "전투 시작을 여러 번 누르면 뭔가 움직인다"의 정체가 이것이다.

   서버 요청이 겹치는 것은 아래 guard 가 막지만, 이건 성격이 다르다 —
   **이미 손을 뗀 클릭이 엉뚱한 버튼에 도착하는 것**이라 막을 자리도 다르다.
   화면을 갈아 끼운 직후 잠깐 클릭을 흘려보낸다. 사람이 새 화면을 보고 누르는 데는
   그보다 오래 걸리므로, 일부러 누르는 것은 막히지 않는다. */
const CLICK_SHIELD_MS = 600;
let _shieldUntil = 0;
const shield = (ms = CLICK_SHIELD_MS) => { _shieldUntil = Date.now() + ms; };
document.addEventListener('click', e => {
  // Keyboard activation targets a focused control intentionally.
  // Keep the pointer transition shield and the API action guards intact.
  if(e.detail===0) return;
  if (Date.now() >= _shieldUntil) return;
  e.stopPropagation(); e.preventDefault();
}, true);

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
const _cool = new Map();
function guard(fn, coolMs = 0){
  return async function(...a){
    /* 하나가 도는 동안 들어온 것은 버린다. 끝난 뒤에도 coolMs 동안은 다시 받지 않는다 —
       동작이 짧게 끝나는 조작(상대 찾기 같은)은 그 사이에 남은 클릭이 도착할 수 있다. */
    const key = fn.name || String(_cool.size);
    if(_busy || Date.now() < (_cool.get(key) || 0)) return;
    _busy = true;
    document.body.classList.add('busy');
    /* 예외를 반드시 드러낸다. 예전에는 그냥 던졌는데, onclick 에서 부르는 async 함수라
       'unhandled rejection' 으로 콘솔에만 남고 화면에는 아무 일도 안 일어났다.
       레이드 재생이 그렇게 죽어서 '횟수는 줄었는데 창이 안 뜬다' 로 보였다.
       조용히 실패하는 것보다 틀린 것이 보이는 편이 낫다. */
    try { return await fn.apply(this, a); }
    catch(e){ console.error(e); toast('오류가 났습니다 · ' + ((e && e.message) || e)); }
    finally {
      _busy = false;
      if(coolMs) _cool.set(key, Date.now() + coolMs);
      document.body.classList.remove('busy');
    }
  };
}
/* 속도 토글·화면 이동·모달 닫기는 문지기를 지나지 않는다 —
   전투가 재생되는 동안에도 눌러야 하는 것들이다. */

window.ROWAR = {
  enterTerritory, enterFront, prepareTerritory, returnTerritory, uiMore, uiGo,
  inspectRobot, cycleHangar, setHangarTab, setHangarSort, openHangarInventory,
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
  levelUp: guard(levelUp), service: guard(service), frontFix: guard(frontFix), enhance: guard(enhancePart), skillUp: guard(skillUp),
  equip: guard(equip), unequip: guard(unequip), doScrap: guard(doScrap),
  openPresets, savePreset: guard(savePreset, 600), deletePreset: guard(deletePreset, 600), applyPreset: guard(applyPreset, 600),
  openSlot, openRobot, closeModal, setGacha, scrapPart, toggleSpeed, skipReplay, pickExped, openNode, guide,
  setInvF, invMore, bulkScrap, setBulkKeepEnh, doBulkScrap: guard(doBulkScrap, 1000),
  setFrontTab, setFrontCh, restartCh, restartChGo, openCell, runCell: guard(runCell, 1000),
  openFuse, fuseToggle, doFuse: guard(doFuse, 1000),
  trialRun: guard(trialRunGo, 1000),
  setTrialTab, raidRun: guard(raidRunGo, 1000), raidPrep,
  jointSwap, jointTac,
  pull1: guard(pull1), pull10: guard(pull10),
  findMatch: guard(findMatch, 1000), nextMatch: guard(nextMatch, 1000), startBattle: guard(startBattle, 1000),
  duelFind: guard(duelFind, 1000), duelPick: guard(duelPick, 1000), rankPage,
  setRankTab, setCodexGroup, codexClaim: guard(codexClaim, 1000), codexTitle: guard(codexTitle, 800),
  codexActivate: guard(codexActivate, 600),
  setRecruitmentHero, openRecruitmentRates, openRecruitmentPool, openRecruitmentDetails,
  setShopTab, shopBuy: guard(shopBuy, 600), shopRefresh: guard(shopRefresh, 800), shopAssemble: guard(shopAssemble, 800),
  practiceFind: guard(practiceFind, 1000), practiceStart: guard(practiceStart, 1000), hunt: guard(hunt, 1000),
  setTactic, setBattleMode, battleRetry: guard(battleRetry, 1000),
  sendExped: guard(sendExped), claimExped: guard(claimExped),
  setDispatchFilter,setDispatchTab,setDispatchMission,pickDispatchRobot,selectDispatchRobot,launchDispatch:guard(launchDispatch),
  attackTerr: guard(attackTerr, 1000), raidTerr: guard(raidTerr, 1000), claimTerr: guard(claimTerr),
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
      ? '접근 정보가 이 브라우저에 묶인 게스트 계정입니다. 눌러서 정식 계정으로 만드세요.'
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
     · 그 밖 → 올린다
   끝나면 — 받았든 올렸든 실패했든 — 전선을 서버 상태로 다시 정한다(frontAfterState · 2026-09-24) */
async function syncOnConnect(){
  try{ await syncOnConnectInner(); }
  finally{ frontAfterState(); }
}
async function syncOnConnectInner(){
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
    takeBand(remote.band);
    if(remote.codex) _codexRaw = remote.codex;
    if(remote.hunt) _huntWk = remote.hunt;
    S.items = remote.items || {};
    S.presets = parsePresets(remote.presets);
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

/* 안내 내용과 수치는 js/ui/common.js에서 현행 공유 규칙을 읽는다. */
function guide(topic='start'){openModal(guideView(topic));}

/* 계정 화면 — 게스트면 승격/로그인, 정식이면 로그아웃 */
function accountScreen(){
  const s=net.state;
  /* 아직 계정이 없는 사람(needGuest)도 여기 들어와야 한다 — 가입과 로그인이 여기 있다.
     가입은 net.register 가 필요하면 그 자리에서 게스트를 만들어 올린다. */
  if(!s.online && !s.needGuest){ toast('서버에 연결되지 않았습니다'); return; }
  if(s.needGuest){
    openModal(`<div class="mhead">계정 <button class="mx" onclick="ROWAR.closeModal()">✕</button></div>
      <div class="acctbox">
        <p class="hint">아직 계정을 만들지 않았습니다. <b>시작하기</b>를 누르면 게스트로 시작하고,
          아래에서 바로 정식 계정을 만들 수도 있습니다.</p>
        <div class="asec">
          <div class="atitle">정식 계정 만들기</div>
          <label class="cv-input-label" for="rg-id">가입 아이디</label>
          <input id="rg-id" class="ainput" placeholder="아이디 (영문·숫자·밑줄 4~20자)" maxlength="20" autocomplete="username">
          <label class="cv-input-label" for="rg-pw">가입 비밀번호</label>
          <input id="rg-pw" class="ainput" type="password" placeholder="비밀번호 (8자 이상)" autocomplete="new-password">
          <button class="btn big gold" onclick="ROWAR.doRegister()">정식 계정으로 만들기</button>
        </div>
        <div class="asec">
          <div class="atitle">이미 계정이 있다면</div>
          <label class="cv-input-label" for="lg-id">로그인 아이디</label>
          <input id="lg-id" class="ainput" placeholder="아이디" maxlength="20" autocomplete="username">
          <label class="cv-input-label" for="lg-pw">로그인 비밀번호</label>
          <input id="lg-pw" class="ainput" type="password" placeholder="비밀번호" autocomplete="current-password">
          <button class="btn big" onclick="ROWAR.doLogin()">로그인</button>
        </div>
      </div>`);
    return;
  }

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
      <p class="hint" style="color:var(--gold)">지금은 <b>게스트 #${String(s.accountId).padStart(4,'0')}</b> · 접근 정보가 이 브라우저에 묶여 있습니다. 데이터를 지우면 같은 게스트로 접속할 수 없습니다</p>

      <div class="asec">
        <div class="atitle">정식 계정 만들기</div>
        <p class="hint">지금까지의 진행 상황을 그대로 이어받습니다</p>
        <label class="cv-input-label" for="rg-id">가입 아이디</label>
          <input id="rg-id" class="ainput" placeholder="아이디 (영문·숫자·밑줄 4~20자)" maxlength="20" autocomplete="username">
        <label class="cv-input-label" for="rg-pw">가입 비밀번호</label>
          <input id="rg-pw" class="ainput" type="password" placeholder="비밀번호 (8자 이상)" autocomplete="new-password">
        <button class="btn big gold" onclick="ROWAR.doRegister()">정식 계정으로 만들기</button>
      </div>

      <div class="asec">
        <div class="atitle">이미 계정이 있다면</div>
        <p class="hint" style="color:var(--bad)">로그인하면 그 계정을 따릅니다 · <b>지금 게스트 계정의 진행 상황은 더 이상 보이지 않습니다</b></p>
        <label class="cv-input-label" for="lg-id">로그인 아이디</label>
          <input id="lg-id" class="ainput" placeholder="아이디" maxlength="20" autocomplete="username">
        <label class="cv-input-label" for="lg-pw">로그인 비밀번호</label>
          <input id="lg-pw" class="ainput" type="password" placeholder="비밀번호" autocomplete="current-password">
        <button class="btn big" onclick="ROWAR.doLogin()">로그인</button>
      </div>
    </div>`);
}

async function doRegister(){
  const id=$('#rg-id').value.trim(), pw=$('#rg-pw').value;
  const r=await net.register(id, pw);
  if(r.error){ renderAcct();renderGate();toast(r.error); return; }
  /* 신규 계정도 서버 저장본을 받아야 한다. 대문에서 바로 가입하면 게스트 생성과
     정식 전환이 연달아 일어나므로, 로컬 초기 기체를 새 계정의 것으로 오인하지 않는다. */
  if(await afterLogin(r)===false){closeModal();return;}
  closeModal();
  toast('정식 계정이 되었습니다 · '+r.loginId);
}
/* 로그인 뒤에 할 일. 대문의 로그인 칸과 계정 창이 **같은 함수**를 쓴다 —
   두 벌로 두면 한쪽만 고쳐지는 날이 온다. */
let _gateNeedsPull=false;
async function afterLogin(r){
  stopScript();_storyArt=null;_frontCh=null;_frontCell=null;_frontIntroAttempted.clear();
  _frontReady=false;_jform={order:[],tac:{}};_jctx=null;_fight=null;
  _dispatchUid=null;_dispatchPending=null;_dispatchTab='missions';_dispatchFilter='all';_dispatchSelected='exped:SHORT';
  ++_rankEpoch;_rankTab='rank';_rankPage=null;_codexRaw=null;_codexAt=0;_codexGroup='monster';
  ++_battleRequest; _pendingOpp=null; _practiceOpp=null; _battleFindOpts=undefined; _duelTarget=null; _battleMode='arena';
  hangarUid=null; hangarTab='info'; hangarInventory=false;
  ++_terrRequest; dropTerrCache(); dropRankCache();
  _territorySelected='n01'; _territoryFilter='all'; _returnToTerritory=false;
  Object.assign(_territoryViewport,{zoom:1,left:0,top:0});
  const remote=await net.pull();                 // 그 계정의 진행상황으로 갈아탄다
  if(!remote){
    /* 인증만 성공하고 상태 다운로드가 실패한 경우 이전 계정 S를 새 계정으로 저장/표시하지 않는다.
       대문에서 다시 누르면 이 계정의 상태를 재요청한다. */
    _gateNeedsPull=true;
    setGateVisible(true);
    renderGate();toast('계정 기록을 불러오지 못했습니다 · 시작하기로 다시 시도하세요');
    return false;
  }
  _gateNeedsPull=false;
  S=normalize(remote.state); takeBand(remote.band); if(remote.codex) _codexRaw=remote.codex;
  S.items=remote.items||{}; S.presets=parsePresets(remote.presets); save(); net.cancelSync();
  renderAcct(); renderGate(); renderAll();
  frontAfterState();                             // 그 계정의 진행으로 전선을 다시 정한다(2026-09-24)
  toast(r.loginId+' 으로 로그인했습니다');
}
async function doLogin(){
  const id=$('#lg-id').value.trim(), pw=$('#lg-pw').value;
  const r=await net.login(id, pw);
  if(r.error){ toast(r.error); return; }
  await afterLogin(r);closeModal();
}
async function doLogout(){
  stopScript();++_battleRequest;
  await net.logout();
  closeModal();
  localStorage.removeItem(SAVE_KEY);             // 남의 기기에 진행상황을 남기지 않는다
  location.reload();
}

/* ── 대문 ──────────────────────────────────────────────
   시작을 누르기 전까지 게임 화면을 가린다. 접속 상태에 따라 문구가 바뀐다. */
function setGateVisible(open){
  $('#gate').classList.toggle('hide',!open);
  document.body.classList.toggle('gated',open);
  $('#app').inert=open;
}
function renderGate(){
  const el=$('#gate-who'); if(!el) return;
  const s=net.state;
  const toggle=$('#gate-login-toggle');
  const saveNote=$('#gate-save-note');
  if(toggle)toggle.textContent=s.online&&!s.guest?'계정 관리':'계정 · 로그인';
  if(saveNote)saveNote.textContent=_gateNeedsPull?'계정 기록을 받을 때까지 게임을 열지 않습니다.':!s.checkedAt?'연결 상태를 확인하고 있습니다.':s.needGuest?'시작하면 게스트 계정을 만들고 진행을 서버에 저장합니다.':s.online?(s.guest?'게스트 기록은 이 브라우저에 연결됩니다.':'진행 상황은 서버에 저장됩니다.'):'오프라인 진행은 이 브라우저에 저장됩니다.';
  if(_gateNeedsPull){ el.textContent='계정 기록을 불러오지 못했습니다. 시작하기로 다시 시도하세요'; el.className='gate-who off'; }
  else if(!s.checkedAt){ el.textContent='연결 상태를 확인하는 중입니다'; el.className='gate-who off'; }
  else if(s.needGuest){ el.textContent='시작하면 게스트로 접속합니다 · 브라우저를 지우면 복구할 수 없습니다'; el.className='gate-who guest'; }
  else if(!s.online){ el.textContent='오프라인 · 서버에 연결하지 못했습니다'; el.className='gate-who off'; }
  else if(s.guest){ el.textContent='게스트 #'+String(s.accountId).padStart(4,'0')+' · 이 브라우저에서만 이어집니다'; el.className='gate-who guest'; }
  else { el.textContent=s.loginId+' 님으로 접속했습니다'; el.className='gate-who on'; }
}
/* 대문을 연다. **게스트 계정이 여기서 처음 만들어진다.**
   예전에는 화면을 여는 것만으로 만들어졌다 — 구경만 하고 떠난 사람 몫까지
   account·player·robot·arena_entry 행이 쌓였다. 계정은 '시작한 사람' 에게만 준다. */
async function openGate(){
  const g=$('#gate'); if(!g) return;
  if(_gateAuthPending)return;
  if(_gateNeedsPull){
    const btn=$('#gate-start');btn.disabled=true;btn.textContent='기록 불러오는 중…';
    try{if(await afterLogin({loginId:net.state.loginId})===false)return;}
    finally{btn.disabled=false;btn.innerHTML='시작하기 <span aria-hidden="true">›</span>';}
  }
  if(net.state.needGuest){
    const btn=$('#gate-start'), was=btn && btn.textContent;
    if(btn){ btn.disabled=true; btn.textContent='접속 중...'; }
    try{
      await net.connect({ create:true });
      renderAcct(); renderGate();
      if(net.state.online) await syncOnConnect();
      renderAll();
    }catch(e){ console.error(e); }
    if(btn){ btn.disabled=false; btn.textContent=was||'시작하기'; }
    /* 접속에 실패해도 문은 연다 — 오프라인으로도 놀 수 있는 게 이 게임의 규칙이다.
       그때는 동기화가 없었으니 이 브라우저 저장본이 곧 정본이다 — 전선 도입을 틀어도 된다(2026-09-24) */
    if(!_frontReady) frontAfterState();
  }
  setGateVisible(false);
}
let _gateAuthPending=false;
function initGate(){
  setGateVisible(true);
  $('#gate-start').addEventListener('click', openGate);
  /* 대문을 닫지 않는다. 계정 창은 대문 위에 뜨고, 닫으면 다시 대문으로 돌아온다.
     로그인/가입을 마쳐도 '시작하기'를 누르기 전까지는 게임에 들어가지 않는다. */
  $('#gate-login-toggle').addEventListener('click',()=>{
    if(net.state.online&&!net.state.guest)return accountScreen();
    const form=$('#gate-login'),opened=!form.hidden;
    form.hidden=opened;$('#gate-login-toggle').setAttribute('aria-expanded',String(!opened));
    if(!opened)$('#gate-id').focus();
  });
  $('#gate-acct').addEventListener('click', accountScreen);
  /* 대문에서 바로 로그인. 성공하면 문을 열고 들어간다 — 로그인은 곧 '시작' 이다. */
  $('#gate-login').addEventListener('submit', async e => {
    e.preventDefault();
    if(_gateAuthPending)return;
    const id = $('#gate-id').value.trim(), pw = $('#gate-pw').value;
    if(!id || !pw){ toast('아이디와 비밀번호를 넣으세요'); return; }
    const btn = $('#gate-in');_gateAuthPending=true;btn.disabled=true;btn.textContent='로그인 중...';
    try{
      const r=await net.login(id,pw);
      if(r.error){toast(r.error);return;}
      $('#gate-pw').value='';
      if(await afterLogin(r))setGateVisible(false);
    }catch(err){console.error(err);toast('로그인을 마치지 못했습니다 · 다시 시도하세요');}
    finally{_gateAuthPending=false;btn.disabled=false;btn.textContent='로그인';}
  });
  renderGate();
}

function boot(){
  document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
  document.querySelectorAll('[data-emblem]').forEach(el=>el.innerHTML=emblem);
  preloadSprites();
  initGate();
  /* 재화 숫자/계정명과 화면 폭에 따라 지갑이 줄바꿈돼도 고정 탭이 가려지지 않는다. */
  const topbar = document.querySelector('.topbar');
  const fitNav = () => document.documentElement.style.setProperty('--topbar-height', `${Math.ceil(topbar.getBoundingClientRect().height)}px`);
  fitNav();
  new ResizeObserver(fitNav).observe(topbar);
  S=load(); save();          // 첫 실행이면 시작 기체를 바로 확정해 저장한다
  /* 화면 이동은 data-s 가 있는 단추만. 레일 아래의 '?'(.rhelp)도 .nav 안의 단추라, 예전에는 go(undefined) 가 불려
     모든 화면이 꺼진 채 설명 창만 떴다 — 창을 닫으면 빈 화면이었다(2026-09-19). */
  document.querySelectorAll('.nav button[data-s]').forEach(b=> b.addEventListener('click',()=>b.hasAttribute('data-territory-entry')?enterTerritory():go(b.dataset.s)));
  /* ── 첫 화면 (F장 §3) ────────────────────────────────
     **전투를 한 번도 안 한 계정은 격납고가 아니라 전선으로 보낸다.**
     운영 32계정 중 **21계정(66%)이 한 판도 안 싸우고 떠났다** — 기체 1기, Lv.1,
     시작 크레딧 600 이 그대로였다. 가입하고 격납고를 본 다음 나간 것이다.
     격납고는 '무엇을 할지 아는 사람' 의 화면이다. 처음 온 사람에게는 고를 것만 스물이다.

     판단 기준이 `wins + losses === 0` 하나라 **새 컬럼이 필요 없고**, 한 판이라도
     해 본 계정은 UI 개편의 지휘실로 간다. */
  const untouched = !S.stat || (S.stat.wins | 0) + (S.stat.losses | 0) === 0;
  go(untouched ? 'terr' : 'home');

  /* 게스트 계정 연결과 동기화는 화면을 막지 않는다. 실패해도 localStorage 로 계속 논다.
     **계정을 새로 만들지는 않는다**(create:false) — 이미 토큰이 있는 사람만 이어서 붙는다.
     처음 온 사람의 계정은 '시작하기' 가 만든다(openGate). */
  net.connect({ create:false }).then(async ok=>{
    renderAcct(); renderGate();
    if(ok) await syncOnConnect();
    renderAll();   // 접속 전에 그려 둔 화면에는 '오프라인' 안내가 남아 있다
  }).catch(()=>{ renderAcct(); renderGate(); });

  /* 탭을 닫기 전에 남은 변경을 밀어 넣는다. visibilitychange 가 더 확실하게 불린다. */
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState==='hidden'&&!_gateNeedsPull) net.flush(()=>S);
  });
}
// type="module" 은 defer 라 이미 파싱이 끝나 있을 수 있다
/* 두 박자로 돈다.
     매초   — 티커. 귀환·회복 카운트다운과 점령 수입이 실제로 흐르게 한다.
              피로도 정산도 여기서 한다. 20초에 한 번만 정산하면 카운트다운이
              0:00 에 닿고도 최대 20초를 그대로 서 있다.
     20초   — 격납고·파견 같은 무거운 화면. 매초 다시 그리면 기체 30기와 파츠
              수십 개를 초마다 새로 만들게 된다.
   탭이 숨겨져 있으면 아무것도 하지 않는다. decayFat 은 경과 시간으로 계산하므로
   돌아왔을 때 한 번에 따라잡는다. 모달이 열려 있으면 무거운 화면은 건드리지 않는다. */
let _slowAt = 0, _fatChanged = 0;
setInterval(()=>{
  if(!S || document.hidden || _gateNeedsPull) return;
  /* 이번 초에 실제로 깎인 만큼만 저장한다. 누적값(_fatChanged)으로 판단하면
     한 번 회복된 뒤 20초 동안 매초 저장하게 된다. */
  let changed = 0;
  for(const rb of S.robots) changed += decayFat(rb);
  if(changed){ save(); _fatChanged += changed; }
  renderTicker();
  tickDispatch();

  const now = Date.now();
  if(now - _slowAt < 20000) return;
  _slowAt = now;
  if(document.querySelector('#modal.on, .modal.on')) return;   // 모달을 보고 있으면 건드리지 않는다
  if(_fatChanged) renderWallet();
  if(cur==='hangar' && (_fatChanged || S.robots.some(r=>fatOf(r)>0))) renderHangar();
  // Dispatch clock updates in place above; never replace a focused mission/claim button on a timer.
  _fatChanged = 0;
}, 1000);

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
