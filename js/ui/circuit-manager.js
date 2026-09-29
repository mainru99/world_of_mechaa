import {blockOf,checkTaken,circuitResetWarn} from '../circuit.js';
import {traitPoints} from '../stats.js';
import {circuitView,refineView} from './circuit-view.js';
import {drawCircuitSvg} from './circuit-svg.js';
import {CONST} from '../../data/balance.js';

/* UI-owned orchestration. Drafts never enter game state before server success.
   Writes target the captured UID and survive navigation only for that account. */
export function createCircuitManager(ctx){
  let meta={account:null,rcores:null},session=null,pending=null;
  const doc=ctx.document||document;
  const same=t=>ctx.state()===t.owner&&ctx.net.state.accountId===t.account;
  const balance=()=>meta.account===ctx.net.state.accountId?meta.rcores:null;
  const busy=()=>!!pending&&same(pending);
  const blocked=()=>!!ctx.blocked?.();
  function adopt(remote){
    const account=ctx.net.state.accountId;
    if(session&&(session.account!==account||session.owner!==ctx.state()))session=null;
    if(pending&&(pending.account!==account||pending.owner!==ctx.state()))pending=null;
    meta={account,rcores:Number.isFinite(remote.rcores)?remote.rcores:null};
  }
  function wallet(){const el=doc.querySelector('#w-rcore');if(el)el.textContent=balance()??'—';}
  const rb=()=>session&&ctx.state().robots.find(r=>r.uid===session.uid);
  const visible=()=>!!session&&session.owner===ctx.state()&&session.account===ctx.net.state.accountId&&!!doc.querySelector('#modal[open] .cv-app');
  function draw(notice=''){
    const robot=rb();if(!robot||session.owner!==ctx.state()||session.account!==ctx.net.state.accountId)return;
    const focused=doc.activeElement?.id,svgFocus=doc.activeElement?.getAttribute?.('data-id');
    ctx.openModal(circuitView({robot,parts:ctx.state().parts,draft:session.draft,selected:session.selected,rcores:balance(),online:ctx.net.state.online,pending:!!pending,notice}));
    drawCircuitSvg(doc.querySelector('#cv-svg'),{type:robot.type,taken:[...(robot.circuit||[]),...session.draft],draft:session.draft,level:robot.level,selected:session.selected,onSelect:circuitSelect});
    if(svgFocus)doc.querySelector(`#cv-svg [data-id="${svgFocus}"]`)?.focus({preventScroll:true});
    else if(focused)doc.getElementById(focused)?.focus({preventScroll:true});
  }
  function openCircuit(){
    if(pending||blocked())return;
    const robot=ctx.robot();session={uid:robot.uid,owner:ctx.state(),account:ctx.net.state.accountId,draft:[],selected:'A1'};draw();
  }
  function circuitSelect(id){if(!visible()||pending)return;session.selected=id;draw();}
  function circuitDraft(){
    if(!visible()||pending)return;
    const robot=rb(),id=session.selected,i=session.draft.indexOf(id);
    if(i>=0){
      const next=session.draft.filter(x=>x!==id),why=checkTaken(robot.type,[...(robot.circuit||[]),...next],traitPoints(robot.level));
      if(why)return draw('갈래 끝의 선택부터 되돌려 주세요.');session.draft=next;
    }else{
      const why=blockOf(robot.type,[...(robot.circuit||[]),...session.draft],id,traitPoints(robot.level));
      if(why)return draw(why);session.draft.push(id);
    }
    draw();
  }
  function circuitDiscard(){if(visible()&&!pending){session.draft=[];draw('미저장 선택을 취소했습니다.');}}
  async function write(action){
    if(pending||blocked()||!ctx.net.state.online||!visible())return;
    const view=session,token={owner:ctx.state(),account:ctx.net.state.accountId},uid=view.uid,stars=[...view.draft];
    if(action==='take'&&!stars.length)return;
    pending=token;draw();let r;
    try{r=await ctx.net.circuit(action,uid,stars);}catch{r={error:'연결 오류'};}
    if(!same(token)){if(pending===token)pending=null;return;}
    if(!r||r.error){
      const message=r?.why||({'not enough rcores':'정제 코어가 부족합니다.','nothing to reset':'이미 비어 있는 서킷입니다.','circuit changed, retry':'다른 곳에서 서킷이 바뀌었습니다. 다시 열어 주세요.'}[r?.error])||'저장을 확인하지 못했습니다. 최신 기록을 다시 불러옵니다.';
      // Refresh after a rejection or ambiguous connection failure, never guess a deduction.
      let remote;try{remote=await ctx.net.pull();}catch{}
      if(!same(token)){if(pending===token)pending=null;return;}pending=null;
      if(remote?.state){Object.assign(token.owner,remote.state);token.owner.items=remote.items||{};adopt(remote);ctx.onRemote?.(remote);}
      ctx.commit();if(visible()&&session===view){view.draft=[];draw(message);}else ctx.toast(message);return;
    }
    pending=null;const robot=token.owner.robots.find(m=>m.uid===uid);
    if(robot)robot.circuit=[...r.taken];meta={account:token.account,rcores:r.rcores};view.draft=[];
    ctx.commit();wallet();if(visible()&&session===view)draw(action==='reset'?'서킷을 비웠습니다. 포인트를 다시 선택하세요.':'코어 서킷을 저장했습니다.');
    else ctx.toast('코어 서킷 처리가 완료되었습니다.');
  }
  const circuitSave=()=>write('take');
  function circuitResetAsk(){if(!visible()||pending)return;ctx.openModal(`<div class="mhead">코어 서킷 비우기</div><p>${circuitResetWarn()}</p><div class="row-btns"><button class="btn" onclick="ROWAR.circuitReturn()">취소</button><button class="btn gold" onclick="ROWAR.circuitResetConfirm()">정제 코어를 사용하고 비우기</button></div>`);}
  function circuitReturn(){if(session&&!pending)draw();}
  function circuitResetConfirm(){if(!session||pending)return;draw();return write('reset');}
  function openRefine(){if(pending||blocked())return;ctx.openModal(refineView({cores:ctx.state().cores,rcores:balance(),online:ctx.net.state.online,back:!!session}));}
  function refineEstimate(){
    const input=doc.querySelector('#cv-refine-n'),n=Number(input?.value),max=Math.min(999,Math.floor(ctx.state().cores/CONST.REFINE.need));
    const valid=Number.isInteger(n)&&n>=1&&n<=max;
    const text=doc.querySelector('#cv-refine-cost'),button=doc.querySelector('#cv-refine-submit');
    if(text)text.textContent=valid?`코어 ${n*CONST.REFINE.need}개 사용 → 정제 코어 ${n}개`:`1 ~ ${max}개의 정제 수량을 입력하세요.`;
    if(button)button.disabled=!valid||!!pending||!ctx.net.state.online;
    return valid?n:null;
  }
  async function refineSubmit(){
    if(pending||blocked()||!ctx.net.state.online)return;const n=refineEstimate();if(n==null)return;
    const token={owner:ctx.state(),account:ctx.net.state.accountId};pending=token;
    const button=doc.querySelector('#cv-refine-submit');if(button){button.disabled=true;button.textContent='정제 중…';}
    let r;try{r=await ctx.net.refine(n);}catch{r={error:'연결 오류'};}
    if(!same(token)){if(pending===token)pending=null;return;}
    let message;
    if(!r||r.error){message=r?.error==='not enough cores'?'코어가 부족합니다.':'정제를 확인하지 못했습니다. 최신 기록을 다시 확인하세요.';
      let remote;try{remote=await ctx.net.pull();}catch{}if(!same(token)){if(pending===token)pending=null;return;}
      if(remote?.state){token.owner.cores=remote.state.cores;adopt(remote);}
    }else{token.owner.cores=r.cores;meta={account:token.account,rcores:r.rcores};message=`정제 코어 ${r.made}개를 만들었습니다 · 코어 ${r.spent}개 사용`;}
    pending=null;ctx.commit();wallet();
    if(doc.querySelector('#modal[open] .cv-refine'))ctx.openModal(refineView({cores:token.owner.cores,rcores:balance(),online:ctx.net.state.online,notice:message,back:!!session}));else ctx.toast(message);
  }
  function setBalance(value){if(Number.isFinite(value))meta={account:ctx.net.state.accountId,rcores:value};}
  return {adopt,wallet,balance,setBalance,busy,actions:{openCircuit,circuitSelect,circuitDraft,circuitDiscard,circuitSave,circuitResetAsk,circuitResetConfirm,circuitReturn,openRefine,refineEstimate,refineSubmit}};
}
