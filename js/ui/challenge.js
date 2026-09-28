/* Weekly challenge presentation only. The server owns scores, rewards and raid HP. */
import {ROBOT_TYPES,MONSTER_TYPES,TERRAIN} from '../../data/balance.js';
import {sprite} from '../sprites.js?v=20260912-hangar10-recovery';
import {icon,escapeHtml as esc} from './icons.js';

const fmt=n=>Math.max(0,Math.round(Number(n)||0)).toLocaleString('ko-KR');
const remaining=end=>{
 const minutes=Math.ceil(Math.max(0,(Number(end)||0)-Date.now())/60000),d=Math.floor(minutes/1440),h=Math.floor(minutes%1440/60),m=minutes%60;
 return d?`${d}일 ${h}시간`:`${h}시간 ${m}분`;
};
const modeName=mode=>mode==='raid'?'보스 레이드':'주간 시련';
const heading=mode=>`<header class="tv-heading"><div><span>WEEKLY OPERATIONS</span><h1>주간 도전</h1></div><p>준비한 기체로 기록을 세우고, 함께 거대한 적을 넘어뜨리세요.</p></header>`;
const navigation=mode=>`<nav class="tv-modes" aria-label="주간 도전 종류"><strong>작전 선택 <small>OPERATIONS</small></strong><button aria-current="${mode==='trial'?'page':'false'}" onclick="ROWAR.setTrialTab('trial')">${icon('rank')}<span>주간 시련<small>한 기체 · 횟수 제한 없음</small></span>${icon('chevron')}</button><button aria-current="${mode==='raid'?'page':'false'}" onclick="ROWAR.setTrialTab('raid')">${icon('battle')}<span>보스 레이드<small>순차 편성 · 하루 도전 제한</small></span>${icon('chevron')}</button><div class="tv-rail-art">ROWAR<br>WEEKLY</div></nav>`;
export const challengeShell=(mode,inner)=>`<div class="tv-page tv-${mode}">${heading(mode)}<div class="tv-shell">${navigation(mode)}<div class="tv-content">${inner}</div></div></div>`;
export const challengeMessage=(mode,title,message,{retry=false,loading=false}={})=>challengeShell(mode,`<section class="tv-message ui-surface" role="status"><span class="ui-eyebrow">${modeName(mode)}</span>${loading?'<div class="spinner" aria-hidden="true"></div>':''}<h2>${esc(title)}</h2><p>${esc(message)}</p>${retry?`<button class="btn" onclick="ROWAR.setTrialTab('${mode}')">다시 불러오기</button>`:''}</section>`);
const sectionTitle=(eyebrow,title,detail='')=>`<div class="tv-section-title"><div><span>${eyebrow}</span><h2>${title}</h2></div>${detail?`<small>${detail}</small>`:''}</div>`;
const unit=({type,level,power,role})=>{const T=ROBOT_TYPES[type]||{};return `<div class="tv-unit"><div class="tv-unit-art">${sprite(type,false)}</div><div><span>${esc(role)}</span><strong>${esc(T.name||type)}</strong><small>Lv.${fmt(level)} · 전투력 ${fmt(power)}</small></div></div>`;};
const rankTable=(rows,kind)=>{
 const raid=kind==='raid',headers=raid?'<th>순위</th><th>지휘관</th><th>누적 피해</th><th>한 판 최고</th>':'<th>순위</th><th>지휘관</th><th>기체</th><th>점수</th>';
 const items=rows.map(x=>`<tr class="${x.me?'mine':''}"><td>${fmt(x.rank)}</td><td>${esc(x.nickname)}${x.me?' <em>나</em>':''}</td><td>${raid?fmt(x.damage):x.type&&ROBOT_TYPES[x.type]?esc(ROBOT_TYPES[x.type].name):'—'}</td><td>${raid?fmt(x.best):fmt(x.score)}</td></tr>`).join('');
 return `<div class="tv-table-wrap"><table class="tv-table"><thead><tr>${headers}</tr></thead><tbody>${items||`<tr><td colspan="4" class="tv-empty">${raid?'아직 참가 기록이 없습니다.':'아직 시련 기록이 없습니다.'}</td></tr>`}</tbody></table></div>`;
};
const terrainArt=key=>Object.hasOwn(TERRAIN,key)?key:'ruins';

export function trialChallengeView(r,{robot,power,pending=false}){
 const t=r.trial||{},M=MONSTER_TYPES[t.type]||{},T=TERRAIN[t.terrain]||{},best=r.me?.score,win=best!=null&&best>=r.winBase;
 const terrain=terrainArt(t.terrain);
 const hero=`<section class="tv-hero tv-trial-hero" style="--tv-scene:url('assets/terrain/${terrain}.webp')"><div class="tv-hero-copy"><span class="tv-kicker">WEEKLY TRIAL · ${esc(T.ko||t.terrain||'지형')}</span><h2>${esc(M.name||t.type||'시련 상대')}</h2><p>${esc(M.role||'이번 주의 상대')} · Lv.${fmt(t.level)}</p><div class="tv-hero-chips"><span>종료까지 ${remaining(r.endsAt)}</span><span>같은 상대 · 같은 지형</span></div></div><div class="tv-foe-art">${sprite(t.type,false)}</div></section>`;
 const prep=`<section class="tv-prep ui-surface">${sectionTitle('SORTIE PREPARATION','출격 준비','선택한 기체 1기')}${robot?unit({type:robot.type,level:robot.level,power,role:'이번 시련 출전 기체'}):'<p class="tv-empty">출전 가능한 기체가 없습니다.</p>'}<div class="tv-facts"><div><span>내 최고 점수</span><b>${best==null?'기록 없음':fmt(best)}</b></div><div><span>현재 순위</span><b>${r.me?.rank?`${fmt(r.me.rank)} / ${fmt(r.total)}`:'—'}</b></div><div><span>결과</span><b>${best==null?'도전 전':win?'클리어':'피해 기록'}</b></div></div><div class="tv-cta"><button class="btn gold" ${!robot||pending?'disabled':''} onclick="ROWAR.trialRun()">${pending?'기록 처리 중…':'시련 도전'} ${icon('chevron')}</button><button class="ui-text-button" onclick="ROWAR.go('hangar')">기체·파츠 변경 ${icon('chevron')}</button></div><p class="tv-footnote">출격비·피로도·횟수 제한이 없습니다. 같은 빌드에서는 결과가 같으므로, 기록을 높이려면 기체나 파츠를 바꿔 보세요.</p></section>`;
 const terrainInfo=`<section class="tv-note ui-surface">${sectionTitle('BATTLEFIELD','이번 주 지형')}<div class="tv-terrain"><img src="assets/terrain/${terrain}.webp" alt=""><div><b>${esc(T.ko||t.terrain||'지형')}</b><span>${esc(T.desc||'지형 보정 없음')}</span></div></div><p>지형 보정은 아군과 상대 모두에게 적용됩니다. 이번 주에는 상대와 지형이 바뀌지 않습니다.</p></section>`;
 const leaderboard=`<section class="tv-board ui-surface">${sectionTitle('TRIAL LEADERBOARD','시련 순위',`${fmt(r.total)}명 기록`)}${rankTable(r.top||[],'trial')}</section>`;
 return challengeShell('trial',hero+`<div class="tv-columns"><div>${prep}${terrainInfo}</div>${leaderboard}</div>`);
}

export function raidChallengeView(r,{team=[],pending=false}){
 const pct=Math.max(0,Math.min(100,Math.round((Number(r.left)||0)/Math.max(1,r.maxHp)*100)));
 const can=Number(r.triesLeft)>0&&!r.killed,heat=r.killed?'down':pct<=15?'hot':pct<=45?'warm':'';
 const hero=`<section class="tv-hero tv-raid-hero"><div class="tv-hero-copy"><span class="tv-kicker">WEEKLY RAID · SHARED BOSS</span><h2>${esc(r.name||'보스')}</h2><p>${esc(r.role||'공동 보스')} · Lv.${fmt(r.level)}</p><div class="tv-hero-chips"><span>종료까지 ${remaining(r.endsAt)}</span><span>${r.killed?'이번 주 격파':`${fmt(r.joined)}명 참가`}</span></div></div><div class="tv-foe-art">${sprite(r.boss,false)}</div></section>`;
 const bar=`<section class="tv-health ui-surface ${heat}">${sectionTitle('SHARED PROGRESS','공동 보스 체력',r.killed?'격파 완료':'모든 지휘관이 함께 감소시킵니다')}<div class="tv-health-count"><span>${r.killed?'격파됨':'남은 체력'}</span><b>${fmt(r.left)} / ${fmt(r.maxHp)}</b></div><div class="tv-health-bar" role="progressbar" aria-label="공동 보스 남은 체력" aria-valuenow="${Math.min(Math.max(1,Number(r.maxHp)||1),Math.max(0,Number(r.left)||0))}" aria-valuemin="0" aria-valuemax="${Math.max(1,Number(r.maxHp)||1)}"><i style="width:${pct}%"></i></div><p>${r.killed?`이번 주 보스가 쓰러졌습니다${r.killer?` · 마지막 일격: ${esc(r.killer)}`:''}.`:`전투는 매번 체력이 가득 찬 보스와 시작합니다. 이번 전투에서 입힌 피해만 이 공동 체력에 반영됩니다.`}</p></section>`;
 const prep=`<section class="tv-prep ui-surface">${sectionTitle('RAID PREPARATION','출격 편성',`${team.length}/2기 · 선봉부터 순차 투입`)}<div class="tv-team">${team.length?team.map((m,i)=>unit({...m,role:i===0?'01 / 선봉':'02 / 예비'})).join(''):'<p class="tv-empty">출전 편성을 확인하세요.</p>'}</div><div class="tv-facts"><div><span>오늘 남은 도전</span><b>${fmt(r.triesLeft)} / ${fmt(r.daily)}</b></div><div><span>내 누적 피해</span><b>${fmt(r.me?.damage)}</b></div><div><span>한 판 최고</span><b>${r.me?fmt(r.me.best):'—'}</b></div></div><div class="tv-cta"><button class="btn gold" ${!can||pending||!team.length?'disabled':''} onclick="ROWAR.raidRun()">${pending?'교전 요청 중…':r.killed?'이번 주 격파':can?'보스 공격':'오늘 도전 소진'} ${icon('chevron')}</button><button class="ui-text-button" onclick="ROWAR.go('hangar')">편성 확인 ${icon('chevron')}</button></div><p class="tv-footnote">하루 ${fmt(r.daily)}회 도전할 수 있습니다. 선봉이 쓰러지면 예비가 이어서 공격합니다. 보상은 실제로 반영된 피해에 따라 정해집니다.</p></section>`;
 const note=`<section class="tv-note ui-surface">${sectionTitle('COMBAT RULE','전투와 공동 체력')}<div class="tv-note-facts"><div><span>한 판의 보스 체력</span><b>${fmt(r.battleHp)}</b></div><div><span>공동 체력</span><b>${fmt(r.maxHp)}</b></div></div><p>두 수치는 다릅니다. 한 판에서 보스를 직접 쓰러뜨리는 것이 아니라, 여러 지휘관의 피해를 모아 공동 체력을 깎습니다.</p></section>`;
 const leaderboard=`<section class="tv-board ui-surface">${sectionTitle('RAID CONTRIBUTORS','기여 순위',`${fmt(r.joined)}명 참가`)}${rankTable(r.top||[],'raid')}</section>`;
 return challengeShell('raid',hero+`<div class="tv-columns"><div>${bar}${prep}${note}</div>${leaderboard}</div>`);
}
