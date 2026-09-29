import {ROBOT_TYPES} from '../../data/balance.js';
import {RARS,SYN,synthCheck} from '../shardsynth.js';
import {shardKey} from '../shop.js';
import {synthView,salvageView} from './shard-view.js';

// This controller never rolls rewards or subtracts materials. Writes are
// confirmed by server responses; an ambiguous write is read back, never retried.
export function createShardManager(ctx){
 const doc=ctx.document||document;
 let session=null,pending=null;
 const same=t=>!!t&&ctx.state()===t.owner&&ctx.net.state.accountId===t.account;
 const busy=()=>same(pending);
 const visible=()=>same(session)&&!!doc.querySelector('#modal[open] .sr-app');
 const snapshot=()=>JSON.stringify([ctx.state().items,ctx.state().credits,ctx.state().cores,ctx.state().scrap,ctx.state().robots.map(r=>[r.uid,r.type,r.level])]);
 const blocked=()=>busy()||ctx.blocked?.()||!ctx.net.state.online;
 function draw(notice=''){
  if(!visible())return;
  const body=doc.querySelector('.ui-modal-body'),scroll=body?.scrollTop||0,focus=doc.activeElement?.id;
  ctx.openModal((session.mode==='synth'?synthView:salvageView)({...session,state:ctx.state(),goal:ctx.goal().goal,masteryGoal:ctx.goal().goal,pending:busy()&&pending.kind==='write',loading:busy()&&pending.kind==='read',online:ctx.net.state.online,notice}));
  const fresh=doc.querySelector('.ui-modal-body');if(fresh)fresh.scrollTop=scroll;
  const input=focus?doc.getElementById(focus):null;input?.focus({preventScroll:true});
 }
 async function readState(token,wallet=false){
  const before=snapshot();let r;try{r=await ctx.net.growthState();}catch{}
  if(!same(token)||snapshot()!==before||!r?.state||!r.mastery)return false;
  token.owner.items={...(r.items||{})};
  if(wallet)for(const key of ['credits','cores','scrap'])token.owner[key]=r.state[key];
  ctx.onRemote(r);return true;
 }
 function commit(){ctx.commit();ctx.paint?.();}
 async function readRecord(token){
  let r;try{r=await ctx.net.salvage();}catch{}
  if(!same(token)||!r||r.error)return null;
  return r;
 }
 async function refresh(){
  if(!visible()||blocked())return;
  const token={owner:session.owner,account:session.account,session,kind:'read'};pending=token;session.confirm=false;draw();
  const checked=await readState(token,session.mode==='synth');
  const record=token.session.mode==='salvage'&&same(token)?await readRecord(token):null;
  if(!same(token)){if(pending===token)pending=null;return;}
  token.session.known=checked;
  if(token.session.mode==='salvage')token.session.record=record;
  if(pending===token)pending=null;commit();
  draw(checked&&(token.session.mode==='synth'||record)?'최신 서버 기록을 확인했습니다.':'기록을 확인하지 못했습니다. 연결을 확인하고 새로고침하세요.');
 }
 async function open(mode){
  if(busy()||ctx.blocked?.())return;
  const state=ctx.state();if(!state.robots.length)return;
  session={owner:state,account:ctx.net.state.accountId,mode,rar:'C',mats:{},uid:ctx.robot()?.uid||state.robots[0].uid,tier:0,record:null,known:false,confirm:false,result:null,returnTo:ctx.returnTo()};
  ctx.openModal((mode==='synth'?synthView:salvageView)({...session,state,goal:ctx.goal().goal,masteryGoal:ctx.goal().goal,online:ctx.net.state.online}));
  if(ctx.net.state.online)await refresh();else draw('서버 연결 후 최신 기록과 작전을 확인할 수 있습니다.');
 }
 const editable=()=>visible()&&!busy();
 function shardRarity(rar){if(!editable()||!RARS.slice(0,-1).includes(rar))return;session.rar=rar;session.mats={};session.confirm=false;session.result=null;draw();}
 function shardCount(id,value){
  if(!editable()||ROBOT_TYPES[id]?.rarity!==session.rar||ROBOT_TYPES[id].story)return;
  const n=Number(value),old=session.mats[id]||0,total=Object.values(session.mats).reduce((a,b)=>a+b,0),have=ctx.state().items?.[shardKey(id)]||0;
  session.confirm=false;session.result=null;
  if(value===''||!Number.isInteger(n)||n<0||n>have||total-old+n>SYN().max){draw(`0~${Math.min(have,SYN().max-total+old)} 사이의 정수로 선택하세요.`);return;}
  if(n)session.mats[id]=n;else delete session.mats[id];draw();
 }
 function shardReview(){if(!editable()||blocked()||!session.known)return;const check=synthCheck(session.mats,ctx.state().items);if(check.error||ctx.state().scrap<check.cost)return;session.confirm=true;draw();doc.getElementById('sr-synth-submit')?.focus({preventScroll:true});}
 function shardCancel(){if(!editable())return;session.confirm=false;draw();}
 function salvageRobot(uid){if(!editable()||!ctx.state().robots.some(r=>r.uid===uid))return;session.uid=uid;session.confirm=false;draw();}
 function salvageTier(tier){if(!editable()||!session.record?.tiers.some(t=>t.tier===tier))return;session.tier=tier;session.confirm=false;draw();}
 function salvageReview(){if(!editable()||blocked()||!session.known||!session.record?.goal||session.record.left<1)return;session.confirm=true;draw();doc.getElementById('sr-salvage-submit')?.focus({preventScroll:true});}
 async function shardSubmit(){
  if(!editable()||blocked()||session.mode!=='synth'||!session.confirm||!session.known)return;
  const mats={...session.mats},check=synthCheck(mats,ctx.state().items);if(check.error||ctx.state().scrap<check.cost)return;
  const token={owner:session.owner,account:session.account,session,kind:'write'};pending=token;draw();
  let r;try{r=await ctx.net.synthesize(mats);}catch{}
  if(!same(token)){if(pending===token)pending=null;return;}
  const success=!!r?.synth&&!r.error;
  if(success){ctx.applyShop(r);token.session.result=r.synth;token.session.mats={};}
  else token.session.known=await readState(token,true);
  if(!same(token)){if(pending===token)pending=null;return;}
  token.session.confirm=false;
  if(pending===token)pending=null;commit();
  const notice=success?`${ROBOT_TYPES[r.synth.type].name} 조각 ${r.synth.qty}개 · 서버 합성 완료.`:'합성 결과를 확인하지 못했습니다. 조각과 스크랩을 새로고침해 확인하세요. 같은 요청은 자동 재전송하지 않습니다.';
  if(visible()){
   draw(notice);
   if(success){const report=doc.querySelector('.sr-synth-result');report?.scrollIntoView({block:'start',behavior:'instant'});report?.focus({preventScroll:true});}
  }else ctx.toast(notice);
 }
 async function salvageSubmit(){
  if(!editable()||blocked()||session.mode!=='salvage'||!session.confirm||!session.known||!session.record?.goal||session.record.left<1)return;
  if(!ctx.state().robots.some(r=>r.uid===session.uid))return;
  const token={owner:session.owner,account:session.account,session,kind:'write'};pending=token;draw();
  const latest=await readRecord(token);
  if(!same(token)){if(pending===token)pending=null;return;}
  if(!latest||latest.day!==session.record.day||latest.goal?.type!==session.record.goal.type||latest.left<1){
   token.session.record=latest;token.session.confirm=false;if(pending===token)pending=null;
   draw('출격 조건이 바뀌었거나 확인되지 않았습니다. 최신 대상과 횟수를 확인하고 준비하세요.');return;
  }
  let r;try{r=await ctx.net.salvage({tier:session.tier,uid:session.uid});}catch{}
  if(!same(token)){if(pending===token)pending=null;return;}
  const success=!!r?.robot&&!r.error;
  if(success){token.session.result=r;token.session.record={...token.session.record,left:r.left,goal:r.goal};}
  const checked=await readState(token);
  const record=!success&&same(token)?await readRecord(token):null;
  if(!same(token)){if(pending===token)pending=null;return;}
  if(!success)token.session.record=record;
  token.session.confirm=false;token.session.known=checked;
  if(pending===token)pending=null;commit();
  if(success&&visible()){
   const returnTo=token.session.returnTo;
   ctx.closeModal();await ctx.replay(r,returnTo,()=>same(token),checked);
  }else{
   const message=success?`회수 작전 기록 완료 · 조각 +${r.got} · 남은 ${r.left}회.`:r?.error==='no tries left'?'오늘 출격을 다 사용했습니다. 새 횟수는 한국 시간 09:00에 시작됩니다.':r?.error==='no goal'?'회수할 수 있는 C~R 목표가 없습니다.':'출격 기록을 확인하지 못했습니다. 최신 횟수와 조각을 확인하세요. 같은 출격은 자동 재전송하지 않습니다.';
   if(visible())draw(message);else ctx.toast(message);
  }
 }
 return {busy,actions:{openShardSynth:()=>open('synth'),openSalvage:()=>open('salvage'),shardRefresh:refresh,shardRarity,shardCount,shardReview,shardCancel,shardSubmit,salvageRobot,salvageTier,salvageReview,salvageSubmit}};
}
