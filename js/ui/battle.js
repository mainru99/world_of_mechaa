/* Presentation only. Arrays support the two-allies / one-boss adapter;
 * this module never selects a squad, simulates combat or grants rewards. */
import {COMBAT_TYPES} from '../units.js';
import {sprite} from '../sprites.js?v=20260912-hangar10-recovery';
import {icon,escapeHtml as esc} from './icons.js';

export const BATTLE_MODES={
  arena:{name:'일반 대전',en:'ARENA MATCH',icon:'battle'},
  duel:{name:'친선 대전',en:'FRIENDLY MATCH',icon:'shield'},
};
const fmt=n=>Math.round(Number(n)||0).toLocaleString('ko-KR');
function unitCard(unit,side){
  const T=COMBAT_TYPES[unit.type],s=unit.stats;
  return `<article class="bv-unit" data-unit="${esc(unit.type)}">
    <div class="bv-unit-label"><b>${esc(T.rarity)}</b><span>Lv.${fmt(unit.level)}</span></div>
    <div class="bv-unit-art">${sprite(unit.type,side==='ally')}</div>
    <div class="bv-unit-caption"><strong>${esc(T.name)}</strong><small>${esc(T.role)}</small></div>
    <dl class="bv-stats">${[['공격',fmt(s.atk)],['방어',fmt(s.def)],['내구',fmt(s.hp)],['속도',fmt(s.spd)],['치명',Math.round(s.crit*100)+'%'],['회피',Math.round(s.eva*100)+'%']].map(([k,v])=>`<div><dt>${k}</dt><dd>${unit.statsKnown===false?'—':v}</dd></div>`).join('')}</dl>
  </article>`;
}
function team({units,side,name,meta,searching}){
  return `<section class="bv-team ${side}">
    <header class="bv-identity">${icon(side==='ally'?'shield':'target')}<div><small>${side==='ally'?'우리 부대':'상대 부대'}</small><strong>${esc(name)}</strong><span>${esc(meta)}</span></div></header>
    <div class="bv-team-heading"><h3>${side==='ally'?'출격 기체':'상대 기체'} <small>${units.length?units.length+'기':'미확인'}</small></h3>${side==='ally'?`<button class="ui-text-button" onclick="ROWAR.go('hangar')">격납고 ${icon('chevron')}</button>`:''}</div>
    <div class="bv-units" data-count="${units.length}">${units.length?units.map(u=>unitCard(u,side)).join(''):`<div class="bv-unknown" role="status"><div class="${searching?'spinner':'bv-radar'}">${searching?'':icon('target')}</div><strong>${searching?'상대 신호 탐색 중':'다음 상대를 기다립니다'}</strong><p>${searching?'잠시 후 상대 정보를 표시합니다.':'상대를 찾으면 기체와 전력을\n비교할 수 있습니다.'}</p></div>`}</div>
  </section>`;
}
export function battleView({mode='arena',allies,enemies=[],playerName,playerMeta,enemyName='신호 미확인',enemyMeta='매칭 대기',searching=false,brief='',actions='',details='',costLabel='',rewardLabel='',powerKnown=true,powerUnavailableLabel='레이드 전력은 별도 규칙'}){
  const operation=mode==='raid'?{en:'WEEKLY RAID',ko:'보스 레이드',poster:'BREAK<br>THE LIMIT.',desc:'함께 깎아내는 거대한 위협.',origin:'trial'}:mode==='hunt'?{en:'BOSS HUNT',ko:'보스 토벌',poster:'HUNT<br>AS A TEAM.',desc:'전위와 후위, 하나의 전술.',origin:'hunt'}:null;
  const rail=operation?`<div class="bv-rail-title"><b>${operation.en}</b><span>${operation.ko}</span></div><button class="bv-mode" onclick="ROWAR.go('${operation.origin}')">${icon('chevron')}<span><b>작전 목록으로</b><small>RETURN TO OPERATIONS</small></span></button>`:`<div class="bv-rail-title"><b>PVP BATTLE</b><span>대전</span></div><nav aria-label="대전 모드">${Object.entries(BATTLE_MODES).map(([key,m])=>`<button class="bv-mode ${mode===key?'selected':''}" aria-pressed="${mode===key}" onclick="ROWAR.setBattleMode('${key}')">${icon(m.icon)}<span><b>${m.name}</b><small>${m.en}</small></span>${icon('chevron')}</button>`).join('')}</nav>`;
  const a=allies.reduce((n,u)=>n+u.power,0),e=enemies.reduce((n,u)=>n+u.power,0);
  const ratio=powerKnown&&e?Math.max(5,Math.min(95,a/(a+e)*100)):50;
  const verdict=!powerKnown?esc(powerUnavailableLabel):!enemies.length?'상대 확인 후 비교':a>e*1.1?'아군 우세':e>a*1.1?'적군 우세':'접전 예상';
  return `<div class="bv-layout">
    <aside class="bv-rail">${rail}<div class="bv-poster"><strong>${operation?.poster||'FIGHT<br>FOR YOUR PRIDE.'}</strong><p>${operation?.desc||'당신의 기체, 당신의 전술.'}</p></div><div class="bv-links"><button onclick="ROWAR.go('hunt')">${icon('hunt')} 토벌 · 원정 ${icon('chevron')}</button><button onclick="ROWAR.go('trial')">${icon('trial')} 시련 · 레이드 ${icon('chevron')}</button></div></aside>
    <div class="bv-main"><div class="bv-matchup">
      ${team({units:allies,side:'ally',name:playerName,meta:playerMeta})}
      <div class="bv-versus" aria-hidden="true"><b>VS</b><span>${allies.length}:${enemies.length||1}</span></div>
      ${team({units:enemies,side:'enemy',name:enemyName,meta:enemyMeta,searching})}
    </div>
    <section class="bv-power" aria-label="전투력 비교"><div><small>아군 전투력</small><b>${powerKnown?fmt(a):'—'}</b></div><div class="bv-comparison"><span>전력 비교</span><div class="bv-power-track" style="--ally-share:${ratio}%"><i></i></div><small>${verdict}</small></div><div><small>적군 전투력</small><b>${powerKnown&&enemies.length?fmt(e):'—'}</b></div></section>
    ${details?`<div class="bv-details">${details}</div>`:''}
    <div class="bv-bottom"><section class="bv-brief"><div class="bv-battlefield" aria-hidden="true"></div><div><h3>${mode==='duel'?'친선 대결':'다음 전투를 준비하세요'}</h3><div>${brief}</div></div></section><section class="bv-deploy"><div class="bv-terms"><span>출격비 <b>${esc(costLabel)}</b></span><span>${esc(rewardLabel)}</span></div><div class="bv-actions">${actions}</div></section></div>
    </div></div>`;
}
