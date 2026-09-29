import {ROBOT_TYPES} from '../../data/balance.js';
import {LINEAGE,LINEAGE_SIBS} from '../lineage.js';
import {escapeHtml as esc} from './icons.js';
import {assetPath} from '../sprites.js';

// Presentation order from the approved lineage draft. Rules/edges stay shared.
const ORDER={
 C:['mule','dune','rust','scarab','grit','chalk','husk','mortar','lens','static'],
 UC:['ranger','vanguard','bastion','kestrel','tracer','mantis','swift','shrike','patch'],
 R:['azure','glacier','tempest','cobalt','howitzer','lancer','vega','orbit','pike','quake','cipher','aegis','zephyr','longbow','anvil','verdict','polaris','vesper'],
 UQ:['wraith','oracle','specter','umbra','hex','halo','zealot','nebula','salvo','sentry','osprey','aquila','paladin','auger','halberd','quasar','gyre','ronin','nimbus_c','nimbus_f','goliath_s','goliath_r','goliath_c','goliath_v','hydra_s','hydra_g'],
 EP:['seraph','nemesis','tyrant','atlas','auric','ignis','sovereign','behemoth','solaris','monarch','lionheart','shogun','revenant']
};
export const RARITIES=Object.keys(ORDER);
export const statusLabel={owned:'보유',open:'목표 가능',locked:'선행 조건',gacha:'뽑기 입구'};
export function graphLayout(){
 const cols=RARITIES.map(r=>[...new Set([...ORDER[r],...Object.keys(ROBOT_TYPES)])].filter(id=>ROBOT_TYPES[id]?.rarity===r&&!ROBOT_TYPES[id].story));
 const max=Math.max(...cols.map(c=>c.length)),pos={};
 cols.forEach((ids,c)=>ids.forEach((id,i)=>pos[id]={x:20+c*232,y:64+(max-ids.length)*39+i*78}));
 return {pos,cols,width:1140,height:82+max*78,nodeWidth:180,nodeHeight:64};
}
export function relatedTypes(id){
 const out=new Set([id]);
 const visit=(type,dir,seen=new Set())=>{if(seen.has(type))return;seen.add(type);
  for(const edge of LINEAGE)if(edge[dir]===type){const other=edge[1-dir];out.add(other);visit(other,dir,seen);}};
 visit(id,1);visit(id,0);
 for(const [a,b] of LINEAGE_SIBS)if(a===id||b===id){out.add(a);out.add(b);visit(a,1);visit(b,0);}
 return out;
}
export function graphView({states,selected,goal,need,match}){
 const L=graphLayout(),on=relatedTypes(selected);
 const edges=LINEAGE.map(([a,b,reason])=>{const A=L.pos[a],B=L.pos[b];if(!A||!B)return '';
  const x=A.x+L.nodeWidth,y=A.y+32,m=(x+B.x)/2;
  return `<path class="dg-edge ${on.has(a)&&on.has(b)?'on':''}" data-from="${a}" data-to="${b}" d="M${x},${y} C${m},${y} ${m},${B.y+32} ${B.x},${B.y+32}"><title>${esc(ROBOT_TYPES[a].name)} → ${esc(ROBOT_TYPES[b].name)} · ${esc(reason)}</title></path>`;}).join('');
 const siblings=LINEAGE_SIBS.map(([a,b,reason])=>{const A=L.pos[a],B=L.pos[b];if(!A||!B)return '';
  const x=A.x+L.nodeWidth-16;
  return `<path class="dg-edge dg-sibling ${on.has(a)&&on.has(b)?'on':''}" data-from="${a}" data-to="${b}" d="M${x},${A.y+L.nodeHeight} C${x+24},${A.y+80} ${x+24},${B.y-16} ${x},${B.y}"><title>${esc(reason)}</title></path>`;}).join('');
 const heads=RARITIES.map((r,i)=>`<div class="dg-col rr-${r}" style="left:${20+i*232}px">${r} <small>${L.cols[i].length}기 · 조각 ${need(r)}개</small></div>`).join('');
 const nodes=Object.entries(L.pos).map(([id,p])=>{const T=ROBOT_TYPES[id],s=states[id],tags=s.parents.length>1?`모두 ${s.parents.length}기`:s.std?'표준형 필요':statusLabel[s.state];
  return `<button type="button" id="dg-node-${id}" class="dg-node ${id===selected?'selected':''} ${on.has(id)?'related':''} ${match(id)?'':'filtered'}" data-state="${s.state}" style="left:${p.x}px;top:${p.y}px" aria-pressed="${id===selected}" onclick="ROWAR.developmentSelect('${id}')" aria-label="${esc(T.name)} ${T.rarity} ${statusLabel[s.state]}"><img src="${assetPath(id)}" alt="" loading="lazy"><span><b>${esc(T.name)}</b><small>${esc(T.role)}</small><em>${goal===id?'현재 목표':tags}</em></span><strong class="rr-${T.rarity}">${T.rarity}</strong></button>`;}).join('');
 return `<div class="dg-map" id="dg-map" tabindex="0" aria-label="등급별 개발 계보도, 상하좌우로 이동 가능"><div class="dg-board" style="width:${L.width}px;height:${L.height}px"><div class="dg-columns">${heads}</div><svg aria-hidden="true" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">${edges}${siblings}</svg>${nodes}</div></div><p class="dg-map-help">실선: 선행 기체 · 점선: 표준형에서 분화 · 선택한 기체의 계보가 강조됩니다. 검색·표시 조건에 맞는 기체를 밝게 표시합니다.</p>`;
}
