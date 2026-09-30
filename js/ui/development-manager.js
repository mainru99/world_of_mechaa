import {ROBOT_TYPES} from '../../data/balance.js';
import {goalOk} from '../mastery.js';
import {developmentVisibility} from './development-visibility.js';
import {parentsOf,siblingStd} from '../lineage.js';
import {developmentView,goalCard,masteryReward} from './development-view.js';

// Only metadata/items from /state are adopted here. A read must never rewind a
// battle, squad, equipment or currency snapshot. No local mastery settlement.
export function createDevelopmentManager(ctx){
 const doc=ctx.document||document;
 let meta={account:null,owner:null,goal:null,known:false},session=null,pending=null,resultSeq=0;
 const same=t=>ctx.state()===t.owner&&ctx.net.state.accountId===t.account;
 const busy=()=>!!pending&&same(pending);
 const visible=()=>session&&same(session)&&!!doc.querySelector('#modal[open] .dg-app');
 const snapshot=()=>JSON.stringify([ctx.state().items,ctx.state().robots.map(r=>[r.uid,r.type,r.level])]);
 const info=()=>same(meta)?meta:{goal:null,known:false};
 function adopt(remote){
  if(session&&!same(session))session=null;
  if(pending&&!same(pending))pending=null;
  meta={account:ctx.net.state.accountId,owner:ctx.state(),goal:remote.mastery?.goal||null,known:!!remote.mastery};
 }
 const card=()=>goalCard({state:ctx.state(),...info()});
 function paintCards(){for(const el of doc.querySelectorAll('[data-development-card]'))el.outerHTML=card();}
 function draw(notice='',focusTarget=false){
  if(!visible())return;
  const oldMap=doc.getElementById('dg-map'),scroll=oldMap?{left:oldMap.scrollLeft,top:oldMap.scrollTop}:null;
  const listTop=doc.querySelector('.dg-candidates')?.scrollTop||0;
  const focused=doc.activeElement?.id,selection=doc.activeElement?.selectionStart;
  ctx.openModal(developmentView({state:ctx.state(),...info(),...session,online:ctx.net.state.online,pending:busy(),loading:!!pending&&pending.kind==='read',notice}));
  const map=doc.getElementById('dg-map');
  const list=doc.querySelector('.dg-candidates');if(list)list.scrollTop=listTop;
  if(map&&scroll){map.scrollLeft=scroll.left;map.scrollTop=scroll.top;}
  const node=focusTarget&&doc.getElementById(`dg-node-${session.selected}`);
  // Center only the graph scroller; scrollIntoView also jumps the outer dialog.
  if(map&&node){
   const parents=[...parentsOf(session.selected),siblingStd(session.selected)].filter(Boolean).map(id=>doc.getElementById(`dg-node-${id}`)).filter(Boolean);
   const top=Math.min(node.offsetTop,...parents.map(p=>p.offsetTop)),bottom=Math.max(node.offsetTop+node.offsetHeight,...parents.map(p=>p.offsetTop+p.offsetHeight));
   map.scrollTop=Math.max(0,bottom-top<=map.clientHeight-96?(top+bottom-map.clientHeight)/2:node.offsetTop-(map.clientHeight-node.offsetHeight)/2);
   if(node.offsetLeft<map.scrollLeft)map.scrollLeft=Math.max(0,node.offsetLeft-16);
   else if(node.offsetLeft+node.offsetWidth>map.scrollLeft+map.clientWidth)map.scrollLeft=node.offsetLeft+node.offsetWidth-map.clientWidth+16;
  }
  const input=focused?doc.getElementById(focused):null;input?.focus({preventScroll:true});
  if(focused==='dg-query'&&selection!=null)try{input?.setSelectionRange(selection,selection);}catch{}
 }
 async function read(token){
  const before=snapshot();let r;try{r=await ctx.net.growthState();}catch{}
  if(!same(token))return null;
  if(!r?.mastery||snapshot()!==before)return null;
  token.owner.items={...(r.items||{})};adopt(r);ctx.onRemote?.(r);
  return r.mastery;
 }
 async function refresh(){
  if(busy()||ctx.blocked?.()||!ctx.net.state.online)return;
  const token={owner:ctx.state(),account:ctx.net.state.accountId,kind:'read'};pending=token;draw();
  const report=await read(token);
  if(!same(token)){if(pending===token)pending=null;return;}
  if(pending===token)pending=null;
  ctx.commit();
  const message=report?report.got?`${ROBOT_TYPES[report.goal]?.name||'목표'} 조각 +${report.got} · 서버에서 정산했습니다.`:'최신 개발 목표와 조각을 확인했습니다.':'기록을 확인하지 못했습니다. 연결을 확인하고 다시 불러오세요.';
  if(visible()){if(!session.selected)session.selected=info().goal||'mule';draw(message,true);}else if(report?.got)ctx.toast(message);
 }
 async function openDevelopment(type){
  if(busy()||ctx.blocked?.())return;
  const owned=ctx.state().robots.map(r=>r.type),base=info().goal||owned[0]||'mule';
  const selected=developmentVisibility(owned,base,info().goal)(type)?type:base;
  session={owner:ctx.state(),account:ctx.net.state.accountId,selected,mode:ctx.mobile?.()?'list':'map',filter:'all',query:''};
  // First open has no old dg-app; establish it, then use the guarded replacement.
  ctx.openModal(developmentView({state:ctx.state(),...info(),...session,online:ctx.net.state.online}));
  if(ctx.net.state.online)await refresh();else draw('오프라인 · 마지막 기체/조각 기록을 표시합니다.',true);
 }
 function developmentSelect(type){
  if(!visible()||!developmentVisibility(ctx.state().robots.map(r=>r.type),session.selected,info().goal)(type))return;session.selected=type;draw();
  if(ctx.mobile?.()){const detail=doc.querySelector('.dg-detail');detail?.scrollIntoView({block:'start',behavior:'instant'});detail?.querySelector('h3')?.focus({preventScroll:true});}
 }
 function developmentMode(mode){if(!visible()||!['map','list'].includes(mode))return;session.mode=mode;draw('',true);}
 function developmentFilter(filter){if(!visible()||!['all','open','owned','locked','gacha'].includes(filter))return;session.filter=filter;draw();}
 function developmentSearch(query){if(!visible())return;session.query=String(query).slice(0,80);draw();}
 async function developmentGoal(){
  if(!visible()||busy()||ctx.blocked?.()||!ctx.net.state.online||!info().known)return;
  const type=session.selected;
  if(type===info().goal||!goalOk(type,ctx.state().robots.map(r=>r.type)))return;
  const token={owner:ctx.state(),account:ctx.net.state.accountId,kind:'write'};pending=token;draw();
  // Settle earned levels to the OLD goal before changing where future shards go.
  const before=await read(token);
  if(!same(token)){if(pending===token)pending=null;return;}
  if(!before){pending=null;ctx.commit();const message='기존 목표의 정산을 확인하지 못해 목표를 변경하지 않았습니다. 다시 시도하세요.';if(visible())draw(message);else ctx.toast(message);return;}
  if(!goalOk(type,token.owner.robots.map(r=>r.type))){pending=null;ctx.commit();const message='선택한 기체의 보유 조건이 바뀌었습니다. 다시 확인하세요.';if(visible())draw(message);else ctx.toast(message);return;}
  const posting=snapshot();
  let answer;try{answer=await ctx.net.setDevelopmentGoal(type);}catch{}
  if(!same(token)){if(pending===token)pending=null;return;}
  const ok=answer&&!answer.error&&answer.goal===type;
  if(ok){
   meta={owner:token.owner,account:token.account,goal:type,known:true};
   // Goal POST can settle additional OLD-goal earnings atomically. Keep the
   // confirmed items if follow-up GET fails, but never rewind newer local items.
   if(answer.mastery&&answer.items&&snapshot()===posting){token.owner.items={...answer.items};adopt(answer);}
  }
  // A failed/ambiguous POST is also reconciled; never speculate about success.
  const after=await read(token);
  if(!same(token)){if(pending===token)pending=null;return;}
  if(pending===token)pending=null;ctx.commit();paintCards();
  const earned=[before,ok?answer.settled:null].filter(r=>r?.got).map(r=>`${ROBOT_TYPES[r.goal]?.name||'이전 목표'} 조각 +${r.got}`).join(' · ');
  const message=ok?`${ROBOT_TYPES[type].name} 개발 목표 저장${after?' 완료':' 완료 · 조각 조회는 다시 확인하세요'}. 이미 모은 조각은 유지됩니다.${earned?` ${earned} 정산했습니다.`:''}`:
   after?.goal===type?`${ROBOT_TYPES[type].name} 목표가 서버에 저장된 것을 확인했습니다.`:answer?.error==='bad goal'?'이 기체는 목표로 선택할 수 없습니다. 보유 조건을 확인하세요.':'목표 저장을 확인하지 못했습니다. 새로고침으로 서버 기록을 확인하세요.';
  if(visible())draw(message);else ctx.toast(message);
 }
 function rewardSlot(target){return target?.growthId?`<div class="dg-reward" data-growth-result="${target.growthId}" role="status">${masteryReward(target.mastery)}</div>`:'';}
 async function settleFor(target){
  if(!ctx.net.state.online)return;
  target.growthId=++resultSeq;target.mastery=null;
  if(busy()){target.mastery={error:true};return;}
  const token={owner:ctx.state(),account:ctx.net.state.accountId,kind:'read'};pending=token;
  const report=await read(token);
  if(!same(token)){if(pending===token)pending=null;return;}
  if(pending===token)pending=null;
  target.mastery=report||{error:true};
  ctx.commit();
  const el=doc.querySelector(`[data-growth-result="${target.growthId}"]`);if(el)el.innerHTML=masteryReward(target.mastery);
  if(report?.got)ctx.toast(`${ROBOT_TYPES[report.goal]?.name||'개발 목표'} 조각 +${report.got}`);
  if(visible())draw();
 }
 return {adopt,card,busy,info,paintCards,settleFor,rewardSlot,actions:{openDevelopment,developmentSelect,developmentMode,developmentFilter,developmentSearch,developmentGoal,developmentRefresh:refresh}};
}
