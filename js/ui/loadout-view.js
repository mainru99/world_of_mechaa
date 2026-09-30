import {SLOTS,ROBOT_TYPES} from '../../data/balance.js';
import {NAME_MAX} from '../preset.js';
import {icon,escapeHtml as esc} from './icons.js';
import {boundRobot,robotName,loadoutSlots} from './loadout-model.js';
import {partWindow} from './part-window.js';
const KO={WEAPON:'무장',FRAME:'프레임',BOOSTER:'부스터',CORE:'코어'};
const n=v=>Number(v).toLocaleString('ko-KR');
export function bindingBadge(bind,state,uid){
 const owner=boundRobot(bind,uid);
 return owner?`<span class="lu-bound">${icon('lock')}${esc(robotName(state,owner))} 전용</span>`:'';
}
export function loadoutView(m){
 const {state,bind,robot,list,mode,slot,pending,known,notice,confirm,partMarkup}=m;
 const disabled=pending||!known||!m.online,dis=disabled?'disabled':'';
 const T=ROBOT_TYPES[robot.type];
 const head=`<div class="mhead">${mode==='presets'?'빌드 프리셋':mode==='unbind'?'파츠 귀속 해제':`${KO[slot]} 장비 선택`}</div>`;
 const profile=`<header class="lu-profile"><span class="ui-eyebrow">HANGAR / ${mode==='presets'?'BUILD ARCHIVE':'EQUIPMENT'}</span><h3>${esc(T.name)} <small>Lv.${robot.level}</small></h3><span class="lu-scope">${bind.on?'기체 전용 장비 · 기체별 프리셋':'공유 장비 · 계정 공용 프리셋'}</span></header>`;
 const status=`<p class="lu-status" role="status">${pending?'서버 기록을 확인하고 있습니다.':esc(notice||(!known?'서버 기록을 확인한 뒤 이용할 수 있습니다.':''))}</p>`;
 let body='';
 if(mode==='presets'){
  body=`<p class="lu-help">${bind.on?'이 기체의 장착 조합을 5칸에 보관합니다. 다른 기체 전용 파츠는 건너뜁니다.':'장착 조합을 계정 공용 5칸에 보관합니다. 적용하면 다른 기체의 장비를 가져옵니다.'} 비움은 현재 장비를 해제하고, 사라진 파츠의 칸은 그대로 둡니다.</p><div class="lu-presets">${list.map((x,i)=>{
   const slots=x?loadoutSlots(x,state,bind,robot.uid):[];
   return `<article class="lu-preset ${x?'':'lu-empty'}"><div class="lu-preset-head"><b>${String(i+1).padStart(2,'0')}</b><input id="lu-name-${i}" aria-label="프리셋 ${i+1} 이름" maxlength="${NAME_MAX}" value="${esc(m.names?.[i]??x?.n??`프리셋 ${i+1}`)}" ${dis} oninput="ROWAR.loadoutName(${i},this.value)"><small>${x?'저장됨':'빈 칸'}</small></div>${x?`<dl class="lu-slots">${slots.map(s=>`<div class="lu-slot-${s.status}"><dt>${KO[s.slot]}</dt><dd>${s.status==='empty'?'비움':s.status==='missing'?'없는 파츠 · 건너뜀':`${esc(s.part?.name||'파츠')} <small>${s.status==='bound'?`${esc(robotName(state,s.bound))} 전용 · 건너뜀`:s.part.rarity+' · +'+(s.part.enh||0)}</small>`}</dd></div>`).join('')}</dl>`:'<div class="lu-placeholder">현재 장착을 저장해<br>나만의 빌드를 준비하세요.</div>'}<div class="lu-buttons">${x?`<button class="btn gold" ${dis} onclick="ROWAR.applyPreset(${i})">빌드 적용</button>`:''}<button class="btn" ${dis} onclick="ROWAR.savePreset(${i})">${x?'현재 장착으로 덮어쓰기':'현재 장착 저장'}</button>${x?`<button class="ui-text-button" ${dis} onclick="ROWAR.deletePreset(${i})">삭제</button>`:''}</div></article>`;
  }).join('')}</div>`;
 }else if(mode==='slot'){
  const pool=state.parts.filter(p=>p.slot===slot).sort((a,b)=>Number(!!boundRobot(bind,a.uid)&&boundRobot(bind,a.uid)!==robot.uid)-Number(!!boundRobot(bind,b.uid)&&boundRobot(bind,b.uid)!==robot.uid));
  const window=partWindow(pool,m.query,m.page),parts=window.rows;
  body=`${bind.on?'<p class="lu-help">처음 장착한 파츠는 이 기체 전용이 됩니다. 장착 해제 후에도 귀속은 유지됩니다.</p>':'<p class="lu-help">다른 기체가 장착한 파츠를 선택하면 이 기체로 옮깁니다.</p>'}<div class="lu-parts">${parts.map(p=>{
   const bound=boundRobot(bind,p.uid),blocked=bound&&bound!==robot.uid,onMe=robot.slots[slot]===p.uid;
   const worn=state.robots.find(r=>Object.values(r.slots).includes(p.uid));
   return `<article class="lu-part ${blocked?'lu-other':''}">${partMarkup(p)}<div class="lu-part-meta">${bindingBadge(bind,state,p.uid)}${worn?`<small>${esc(robotName(state,worn.uid))} 장착 중</small>`:''}</div><div class="lu-buttons">${blocked?`<button class="btn" ${dis} onclick="ROWAR.openUnbind('${esc(p.uid)}')">귀속 풀기</button>`:`<button class="btn ${onMe?'':'gold'}" ${dis} onclick="ROWAR.${onMe?`unequip('${slot}')`:`equip('${slot}','${esc(p.uid)}')`}">${onMe?'장착 해제':bind.on&&!bound?'장착 · 귀속':'장착'}</button>`}${bound&&!blocked?`<button class="ui-text-button" ${dis} onclick="ROWAR.openUnbind('${esc(p.uid)}')">귀속 풀기</button>`:''}</div></article>`;
  }).join('')||'<p class="empty">검색 조건에 맞는 파츠가 없습니다.</p>'}</div>`;
  const pager=`<nav class="lu-pager" aria-label="장비 목록 페이지"><button id="lu-prev" class="btn" ${disabled||window.page===0?'disabled':''} onclick="ROWAR.loadoutPage(-1)">이전</button><span>${window.page+1} / ${window.pages} 페이지 · ${n(window.total)}개</span><button id="lu-next" class="btn" ${disabled||window.page+1===window.pages?'disabled':''} onclick="ROWAR.loadoutPage(1)">다음</button></nav>`;
  body=`<form class="lu-search" onsubmit="event.preventDefault();ROWAR.loadoutSearch(this.elements.query.value)"><label for="lu-query">파츠 검색</label><div><input id="lu-query" name="query" type="search" maxlength="80" value="${esc(m.query||'')}" placeholder="이름, 등급, 강화 수치" ${dis}><button class="btn" ${dis}>검색</button></div></form>${pager}${body}${pager.replace('id="lu-prev"','id="lu-prev-bottom"').replace('id="lu-next"','id="lu-next-bottom"')}`;
 }else{
  const p=state.parts.find(p=>p.uid===m.partUid),owner=p&&boundRobot(bind,p.uid),cost=bind.unbind;
  body=p?`<div class="lu-unbind">${partMarkup(p)}${bindingBadge(bind,state,p.uid)}<p>귀속을 풀면 다른 기체가 장착할 수 있습니다. 현재 장착은 유지됩니다.</p><dl><div><dt>해제 비용</dt><dd>정제 코어 ${cost===null?'확인 필요':n(cost)}</dd></div><div><dt>보유</dt><dd>정제 코어 ${n(m.rcores)}</dd></div></dl><p class="lu-help">다른 기체에 처음 장착하면 다시 그 기체 전용이 됩니다.</p><button class="btn big gold" ${disabled||!owner||cost===null||m.rcores<cost?'disabled':''} onclick="ROWAR.confirmUnbind()">${cost!==null&&m.rcores<cost?'정제 코어 부족':`귀속 해제 · 정제 코어 ${cost===null?'—':n(cost)}`}</button></div>`:'<p class="empty">파츠를 찾을 수 없습니다.</p>';
 }
 const confirmBox=confirm?`<aside class="lu-confirm" role="group" aria-label="프리셋 변경 확인"><b>${confirm.kind==='presetDelete'?'저장된 빌드를 삭제할까요?':'현재 장착으로 덮어쓸까요?'}</b><p>프리셋 ${confirm.i+1} · ${esc(list[confirm.i]?.n||'')} ${confirm.kind==='presetDelete'?' · 장착한 파츠는 유지됩니다.':''}</p><button class="btn gold" ${dis} onclick="ROWAR.confirmPreset()">${confirm.kind==='presetDelete'?'삭제 확정':'덮어쓰기 확정'}</button><button class="btn" ${pending?'disabled':''} onclick="ROWAR.cancelPreset()">취소</button></aside>`:'';
 return `${head}<section class="lu-app" data-robot="${esc(robot.uid)}">${profile}${status}${confirmBox}${body}<footer class="lu-footer"><button class="btn" ${pending?'disabled':''} onclick="ROWAR.refreshLoadout()">${icon('refresh')} 기록 새로고침</button><span>서버에서 확정된 장비를 사용합니다.</span></footer></section>`;
}
