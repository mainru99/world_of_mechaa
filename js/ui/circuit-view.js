import {ROBOT_TYPES,CONST} from '../../data/balance.js';
import {CIRCUIT_THEMES} from '../../data/circuit.js';
import {CIRCUIT_LAYOUT} from '../../data/circuit_layout.js';
import {constellation,themesOf,blockOf,circuitFx,circuitResetCost} from '../circuit.js';
import {traitPoints,computeStats,power} from '../stats.js';
import {escapeHtml as esc} from './icons.js';
const names={hp:'내구',atk:'공격',def:'방어',spd:'속도',crit:'치명',eva:'회피',skill:'스킬 피해',pen:'관통 확률',regen:'턴 회복',accel:'공격 시 가속'};
const fmt=n=>Math.round(n).toLocaleString('ko-KR');
export function circuitEffects(fx){
  return Object.entries(fx).map(([k,v])=>`<li class="${v<0?'cv-minus':'cv-plus'}"><span>${names[k]||esc(k)}</span><b>${v<0?'−':'+'}${(Math.abs(v)*100).toFixed(2)}${['crit','eva','pen'].includes(k)?'%p':'%'}</b></li>`).join('');
}
export function circuitView({robot,parts,draft=[],selected='A1',rcores,online,pending=false,notice=''}){
  const T=ROBOT_TYPES[robot.type],saved=robot.circuit||[],taken=[...new Set([...saved,...draft])],points=traitPoints(robot.level);
  if(!CIRCUIT_LAYOUT[robot.type])return `<div class="mhead">코어 서킷</div><p>이 기체의 코어 서킷은 준비 중입니다.</p>`;
  const stars=constellation(robot.type),star=stars.find(s=>s.id===selected)||stars[0],id=star.id;
  const added=draft.includes(id),has=saved.includes(id),why=blockOf(robot.type,taken,id,points);
  const newer=taken.length!==saved.length,prev=computeStats(robot,parts),next=computeStats({...robot,circuit:taken},parts);
  const stats=['hp','atk','def','spd','crit','eva'].map(k=>{const val=n=>['crit','eva'].includes(k)?(n*100).toFixed(1)+'%':fmt(n);return `<div><dt>${names[k]}</dt><dd>${val(prev[k])}${newer?` <span>→ ${val(next[k])}</span>`:''}</dd></div>`;}).join('');
  const branches=themesOf(robot.type).map((th,bi)=>{const br='ABCD'[bi];return `<section class="cv-branch"><h4>${br} · ${CIRCUIT_THEMES[th].ko}</h4><div>${stars.filter(s=>s.br===br).map(s=>`<button id="cv-list-${s.id.replace('*','n')}" class="${draft.includes(s.id)?'draft':saved.includes(s.id)?'taken':''} ${id===s.id?'selected':''}" aria-label="${s.id} ${s.notable?'전문 별 ':''}${taken.includes(s.id)?'선택됨':blockOf(robot.type,taken,s.id,points)?'잠김':'선택 가능'}" aria-pressed="${id===s.id}" onclick="ROWAR.circuitSelect('${s.id}')">${s.notable?'★':s.i}</button>`).join('')}</div></section>`;}).join('');
  return `<div class="mhead">${esc(T.name)} · 코어 서킷</div><div class="cv-app">
    <header class="cv-head"><div><span class="ui-eyebrow">CORE CIRCUIT / ${T.rarity}</span><h3>${esc(T.name)} <small>Lv.${robot.level}</small></h3><p>네 갈래의 선택으로 기체의 역할을 완성하세요.</p></div><div class="cv-points"><b>${Math.max(0,points-taken.length)}</b><span>남은 포인트 / ${points}<small>저장 ${saved.length} · 미저장 ${draft.length}</small></span></div></header>
    ${notice?`<p class="cv-notice" role="status">${esc(notice)}</p>`:''}
    <div class="cc-layout"><section class="cv-map-panel"><div class="cv-board"><svg id="cv-svg" viewBox="0 0 520 430" aria-label="${esc(T.name)} 코어 서킷 별자리"></svg></div><p class="cv-map-help">별을 누르면 효과를 확인합니다. 좁은 화면에서는 별자리 판을 좌우로 이동할 수 있습니다.</p><div class="cv-legend"><span>● 저장됨</span><span class="cv-draft">● 미저장 선택</span><span>◉ 선택 가능</span><span>○ 잠김</span><span>★ 전문 별</span><span class="cv-minus">● 감소 효과</span></div><div class="cv-branches">${branches}</div></section>
    <aside class="cc-side"><section class="cv-selected"><span class="ui-eyebrow">${star.br} / ${CIRCUIT_THEMES[star.theme].ko}</span><h3>${id} ${star.notable?'전문 별':'특성'}</h3>${star.notable?`<p>${esc(star.text)}</p>`:`<ul class="cv-fx">${circuitEffects(star.fx)}</ul>`}<p class="cv-status">${has?'이미 저장된 별입니다. 비우기로만 되돌릴 수 있습니다.':added?'아직 저장하지 않은 선택입니다.':why||'포인트 1개로 선택할 수 있습니다.'}</p><button class="btn big" id="cv-toggle" onclick="ROWAR.circuitDraft()" ${pending||has||(!added&&why)?'disabled':''}>${added?'이 선택 되돌리기':'이 별 선택 · 1포인트'}</button><p class="hint">${star.notable?'갈래 1~8을 먼저 선택하고 1포인트를 더 사용합니다.':'이전 별부터 순서대로 선택합니다. 저장 전에는 갈래 끝 선택부터 되돌릴 수 있습니다.'}</p></section>
    <section><h4>현재 → 저장 후 능력치</h4><dl class="cv-stats">${stats}<div><dt>전투력</dt><dd>${fmt(power(robot,parts))}${newer?` <span>→ ${fmt(power({...robot,circuit:taken},parts))}</span>`:''}</dd></div></dl><p class="hint">장비·피로를 포함한 값입니다. 저장 후 전투에 적용됩니다.</p></section><section><h4>선택한 서킷 효과 합계</h4><ul class="cv-fx">${circuitEffects(circuitFx(robot.type,taken))||'<li>선택한 별이 없습니다.</li>'}</ul></section></aside></div>
    <footer class="cv-footer"><p>${online?'선택한 별은 저장 버튼으로 확정됩니다.':'오프라인에서는 확인만 할 수 있습니다.'}<br><small>비우기 비용: 정제 코어 ${circuitResetCost()} · 보유 ${rcores??'확인 중'}</small></p><div><button class="btn" onclick="ROWAR.openRefine()">코어 정제</button><button class="btn ghost" onclick="ROWAR.circuitDiscard()" ${!draft.length||pending?'disabled':''}>미저장 선택 취소</button><button class="btn ghost" onclick="ROWAR.circuitResetAsk()" ${!online||!saved.length||pending||rcores==null||rcores<circuitResetCost()?'disabled':''}>서킷 비우기</button><button class="btn big gold" id="cv-save" onclick="ROWAR.circuitSave()" ${!online||!draft.length||pending?'disabled':''}>${pending?'서버 확인 중…':`선택한 ${draft.length}개 저장`}</button></div></footer></div>`;
}
export function refineView({cores,rcores,pending=false,online,notice='',back=false}){
  const need=CONST.REFINE.need,max=Math.min(999,Math.floor(cores/need));
  return `<div class="mhead">코어 정제</div><div class="cv-refine"><span class="ui-eyebrow">CORE REFINERY</span><h3>더 정밀한 전력을 위한 자원</h3><p>코어 ${need}개를 정제 코어 1개로 합칩니다. 정제 코어는 서킷 비우기와 정제 코어 캡슐에 사용합니다.</p><dl class="cv-stats"><div><dt>보유 코어</dt><dd>${fmt(cores)}</dd></div><div><dt>보유 정제 코어</dt><dd>${rcores??'확인 중'}</dd></div></dl><label for="cv-refine-n">만들 정제 코어 수</label><input id="cv-refine-n" class="ainput" type="number" min="1" max="${Math.max(1,max)}" step="1" value="1" ${pending?'disabled':''} oninput="ROWAR.refineEstimate()"><p id="cv-refine-cost">코어 ${need}개 사용 → 정제 코어 1개</p><p class="cv-notice" role="status">${esc(notice)}</p><div class="row-btns">${back?'<button class="btn ghost" onclick="ROWAR.circuitReturn()">서킷으로 돌아가기</button>':''}<button class="btn big gold" id="cv-refine-submit" onclick="ROWAR.refineSubmit()" ${pending||!online||max<1?'disabled':''}>${pending?'정제 중…':'코어 정제하기'}</button></div></div>`;
}
