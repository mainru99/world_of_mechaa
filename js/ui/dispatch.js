/* Dispatch presentation: one timed expedition, or an immediate hunt.
 * No API requests, inventory changes or additional mission rules live here. */
import {CONST,ROBOT_TYPES,MONSTER_TYPES,ROBOT_RARITY} from '../../data/balance.js';
import {MONSTER_BY_RARITY} from '../units.js';
import {sprite} from '../sprites.js?v=20260912-hangar10-recovery';
import {icon,escapeHtml as esc} from './icons.js';
const fmt=n=>Math.round(n||0).toLocaleString('ko-KR');
const rarityNames={...Object.fromEntries(ROBOT_RARITY.map(r=>[r.k,r.ko])),BOSS:'보스'};
const terrain={SHORT:'canyon',LONG:'highland',DEEP:'ruins',C:'plain',UC:'canyon',R:'highland',UQ:'storm',EP:'furnace',BOSS:'ruins'};
export function expeditionEstimate(tier,level){
 const t=CONST.EXPED[tier];
 return {cr:Math.round(t.crH*t.h*level),sc:Math.round(t.scH*t.h*level),coreP:t.coreP,partP:t.partP,h:t.h};
}
export function expeditionProgress(expd,now=Date.now()){
 if(!expd)return null;
 const duration=(CONST.EXPED[expd.tier]?.h||1)*3600000,left=Math.max(0,expd.endsAt-now);
 const seconds=Math.ceil(left/1000);
 return {done:left===0,left,percent:Math.max(0,Math.min(100,(1-left/duration)*100)),clock:[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':')};
}
export function dispatchMissions({expeditionLevel,huntLevel,sortieCost,bossLevel=huntLevel,bossCost=sortieCost,credits,weekly}){
 const expeditions=Object.entries(CONST.EXPED).map(([tier,t])=>({key:'exped:'+tier,kind:'exped',tier,name:t.ko,terrain:terrain[tier],time:t.h+'시간',level:expeditionLevel,reward:expeditionEstimate(tier,expeditionLevel),cost:0}));
 const hunts=Object.entries(CONST.HUNT).map(([tier,t])=>{
  const cap=weekly.tiers[tier],cost=Math.ceil((tier==='BOSS'?bossCost:sortieCost)*t.costX),used=cap?.used||0;
  return {key:'hunt:'+tier,kind:'hunt',tier,name:rarityNames[tier]+' 토벌',terrain:terrain[tier],time:'즉시 전투',level:Math.max(1,Math.min(CONST.MAXLV+(CONST.OPP_LV_OVER||0),(tier==='BOSS'?bossLevel:huntLevel)+t.lv)),cost,cap:cap?.cap,used,
   blocked:cap&&used>=cap.cap?'이번 주 한도 소진':credits<cost?'크레딧 부족':'',
   names:tier==='BOSS'?'보스 신호 · 동시 합동전 · 자리와 전술은 상대 확인 후 선택':(MONSTER_BY_RARITY[tier]||[]).map(id=>MONSTER_TYPES[id].name).join(' · '),reward:{scX:t.scX,partP:t.partP,coreP:t.coreP}};
 });
 return [...expeditions,...hunts];
}
const rewardToken=(kind,label)=>`<span class="dv-reward"><img src="assets/ui/coin-${kind}.webp" alt="" aria-hidden="true"><b>${label}</b></span>`;
function rewards(m){
 const r=m.reward;
 return `<div class="dv-rewards">${m.kind==='exped'?rewardToken('credit',fmt(r.cr))+rewardToken('scrap',fmt(r.sc)):rewardToken('scrap','스크랩 ×'+r.scX)}${r.coreP?rewardToken('core',Math.round(r.coreP*100)+'%'):''}${r.partP?`<span class="dv-reward">${icon('gacha')}<b>파츠 ${Math.round(r.partP*100)}%</b></span>`:''}</div>`;
}
export function dispatchView({missions,selected,filter='all',tab='missions',robot,robotPower,inSquad,expedition,expeditionRobot,online,pending=false,canSend,weeklyReset,now=Date.now()}){
 const m=missions.find(x=>x.key===selected)||missions[0],T=ROBOT_TYPES[robot.type],progress=expeditionProgress(expedition,now);
 const visible=missions.filter(x=>filter==='all'||x.kind===filter);
 const blocked=!online?'서버 연결 필요':pending?'요청 처리 중':m.kind==='hunt'?m.blocked:expedition?'원정 진행 중':!canSend?'남길 기체가 필요합니다':'';
 const filters=[['all','전체 임무','more'],['exped','자원 원정','clock'],['hunt','토벌 작전','battle']];
 return `<div class="dv-page ${tab==='status'?'dv-show-status':''}">
 <header class="dv-heading"><div><span>DETACHMENT</span><h1>파견 임무 목록</h1></div><p>기체를 보내 자원을 확보하고, 다음 전투를 준비하세요.</p></header>
 <div class="dv-mobile-tabs"><button aria-pressed="${tab==='missions'}" onclick="ROWAR.setDispatchTab('missions')">임무 목록</button><button aria-pressed="${tab==='status'}" onclick="ROWAR.setDispatchTab('status')">진행 현황 ${expedition?'1':'0'}/1</button></div>
 ${!online?'<div class="dv-notice" role="status">서버 연결이 필요합니다. 임무와 보상은 확인할 수 있으며 출발·수령은 연결 후 가능합니다.</div>':''}
 <div class="dv-board"><nav class="dv-filters" aria-label="파견 임무 종류">${filters.map(([id,name,symbol])=>`<button aria-pressed="${filter===id}" onclick="ROWAR.setDispatchFilter('${id}')">${icon(symbol)}${name}<span>${id==='all'?missions.length:missions.filter(x=>x.kind===id).length}</span></button>`).join('')}<div class="dv-rail-note">${icon('shield')}<p>원정은 시간형 임무<br>토벌은 즉시 전투</p></div></nav>
 <section class="dv-missions" aria-label="임무 목록"><div class="dv-columns" aria-hidden="true"><span>임무 / 지역</span><span>소요 시간</span><span>기준 레벨</span><span>주요 보상</span><span>작전</span></div><div class="dv-mission-list">${visible.map(row=>`<button class="dv-mission ${row.key===m.key?'selected':''}" aria-pressed="${row.key===m.key}" onclick="ROWAR.setDispatchMission('${row.kind}','${row.tier}')"><span class="dv-mission-name"><img class="dv-landscape" src="assets/terrain/${row.terrain}.webp" alt=""><span><b>${row.name}</b><small>${row.kind==='exped'?'자원 수집 · 기체 1기':row.cap?`토벌 · 이번 주 ${Math.max(0,row.cap-row.used)}/${row.cap}회 남음`:'토벌 · 횟수 제한 없음'}</small></span></span><span class="dv-time">${icon('clock')}${row.time}</span><span class="dv-level">${row.kind==='exped'?'기체':'상대'} Lv.${row.level}</span>${rewards(row)}<span class="dv-select">${row.blocked||'임무 선택'}${icon('chevron')}</span></button>`).join('')}</div></section></div>
 <div class="dv-bottom"><section class="dv-preparation" id="dv-preparation"><div class="dv-section-title"><h2>${m.kind==='exped'?'파견 기체 선택':'토벌 출격 준비'}</h2><span>${m.name} · ${m.time}</span></div><div class="dv-prep-body"><div class="dv-unit">${sprite(robot.type,false)}<span>Lv.${robot.level} · ${T.rarity}</span></div><div class="dv-unit-info"><strong>${esc(T.name)}</strong><small>${esc(T.role)}</small><span>전투력 <b>${fmt(robotPower)}</b></span>${m.kind==='exped'?`<button class="btn ghost" onclick="ROWAR.pickDispatchRobot()" ${pending?'disabled':''}>기체 변경 ${icon('chevron')}</button>`:`<button class="btn ghost" onclick="ROWAR.go('hangar')">선봉 변경 ${icon('chevron')}</button>`}</div><div class="dv-launch-area">${rewards(m)}<span class="dv-cost">${m.kind==='exped'?`선택 기체 Lv.${robot.level} 기준 · 출발 비용 없음`:`출격비 ${fmt(m.cost)} 크레딧`}</span><button class="dv-launch" id="dv-launch" ${blocked?'disabled':''} onclick="ROWAR.launchDispatch()">${blocked|| (m.kind==='exped'?'파견 시작':'토벌 상대 찾기')}${icon('chevron')}</button></div></div><p class="dv-warning">${m.kind==='exped'?(inSquad?'편성 중인 기체입니다. 보내면 편성에서 빠지고 수령 전까지 출격할 수 없습니다.':'보낸 기체는 보상 수령 전까지 출격할 수 없습니다. 한 번에 한 기만 보낼 수 있습니다.'):'스크랩·파츠 확보 작전입니다. 경험치는 매우 적으며 순위는 오르지 않습니다.'}</p>${m.kind==='hunt'?`<p class="dv-foes">${esc(m.names)}</p><p class="dv-footnote">${esc(weeklyReset)} · 상위 등급 한도는 전투 시작 시 사용됩니다.</p>`:'<p class="dv-footnote">코어·파츠의 %는 획득 확률입니다. 보상은 출발 당시 레벨 기준이며 서버가 확정합니다.</p>'}</section>
 <section class="dv-status" aria-label="진행 중인 파견"><div class="dv-section-title"><h2>진행 중인 파견</h2><span>${expedition?'1':'0'}/1</span></div>${expedition?`<div class="dv-active"><img class="dv-landscape" src="assets/terrain/${terrain[expedition.tier]||'ruins'}.webp" alt=""><div><b>${esc(CONST.EXPED[expedition.tier]?.ko||'원정')}</b><span>${expeditionRobot?esc(ROBOT_TYPES[expeditionRobot.type].name):'파견 기체'} · Lv.${expedition.level}</span></div></div><div class="dv-countdown"><span id="dv-progress-label">${progress.done?'귀환 완료':'귀환까지'}</span><b id="dv-countdown">${progress.done?'수령 가능':progress.clock}</b></div><div class="dv-progress" role="progressbar" aria-label="원정 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(progress.percent)}"><i id="dv-progress-fill" style="width:${progress.percent}%"></i></div>${rewards({kind:'exped',reward:expeditionEstimate(expedition.tier,expedition.level||1)})}<button id="dv-claim" class="dv-launch" ${!progress.done||!online||pending?'disabled':''} onclick="ROWAR.claimExped()">${pending?'요청 처리 중':progress.done?'보상 받기':'원정 진행 중'}</button><p class="dv-footnote">수령 후 기체를 다시 편성할 수 있습니다.</p>`:`<div class="dv-empty">${icon('clock')}<strong>출발을 기다리고 있습니다</strong><p>임무와 기체를 선택해<br>첫 원정을 보내세요.</p></div>`}</section></div></div>`;
}
