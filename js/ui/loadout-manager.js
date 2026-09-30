import {parsePresets} from '../preset.js';
import {bindingState,boundRobot,fuseBinding,robotName} from './loadout-model.js';
import {bindingBadge,loadoutView} from './loadout-view.js';
const KO={WEAPON:'무장',FRAME:'프레임',BOOSTER:'부스터',CORE:'코어'};
const errors={'offline':'서버 연결이 필요합니다.','part bound':'다른 기체 전용 파츠입니다. 귀속을 먼저 풀어 주세요.','not enough rcores':'정제 코어가 부족합니다.','not bound':'이미 귀속이 풀린 파츠입니다.','bind off':'현재는 귀속을 사용하지 않습니다.','robot not found':'기체 기록을 찾을 수 없습니다.','part not found':'파츠 기록을 찾을 수 없습니다.'};
export function createLoadoutManager(ctx){
 const doc=ctx.document||document;
 let meta=null,session=null,pending=null;
 const same=t=>!!t&&ctx.state()===t.owner&&ctx.net.state.accountId===t.account;
 const busy=()=>same(pending);
 const visible=t=>same(t)&&session===t.session&&!!doc.querySelector('#modal[open] .lu-app');
 const current=()=>same(meta)?meta.bind:bindingState(null);
 const list=uid=>parsePresets(current().on?current().presets[uid]:ctx.state().presets);
 const blocked=()=>busy()||ctx.blocked?.();
 const token=()=>({owner:session?.owner,account:session?.account,session});
 const snapshot=()=>JSON.stringify([ctx.state().parts,ctx.state().items,ctx.state().robots.map(r=>[r.uid,r.level,r.slots])]);
 function adopt(r){
  if(!r?.state)return;
  if(session&&!same(session))session=null;
  meta={owner:ctx.state(),account:ctx.net.state.accountId,bind:bindingState(r)};
  ctx.state().presets=parsePresets(r.presets);
 }
 function draw(notice=''){
  const t=token();if(!visible(t))return;
  const robot=t.owner.robots.find(r=>r.uid===session.uid);if(!robot)return;
  ctx.openModal(loadoutView({...session,state:t.owner,bind:current(),robot,list:list(robot.uid),pending:busy(),online:ctx.net.state.online,notice,rcores:ctx.balance(),partMarkup:ctx.partMarkup}));
 }
 async function read(t){
  const before=snapshot();let r;try{r=await ctx.net.growthState();}catch{}
  if(!same(t)||snapshot()!==before||!r?.state||typeof r.bind?.on!=='boolean')return false;
  // Read only equipment, never rewind combat progress, currencies or squad.
  t.owner.parts=r.state.parts||[];
  for(const robot of t.owner.robots){const row=r.state.robots.find(r=>r.uid===robot.uid);if(row)robot.slots={...row.slots};}
  if(r.items)t.owner.items={...r.items}; // GET can settle mastery rewards.
  adopt(r);ctx.onRemote?.(r);return true;
 }
 async function refresh(){
  if(blocked()||!same(session))return false;
  const t=token();pending=t;session.confirm=null;draw();
  const ok=await read(t);
  if(pending===t)pending=null;
  if(same(t)){t.session.known=ok;ctx.commit();if(visible(t))draw(ok?'최신 장비 기록을 확인했습니다.':'기록을 확인하지 못했습니다. 새로고침 후 다시 이용하세요.');}
  return ok;
 }
 async function open(mode,slot){
  if(blocked())return;
  const robot=ctx.robot();if(!robot)return;
  session={owner:ctx.state(),account:ctx.net.state.accountId,uid:robot.uid,mode,slot,known:false,names:{},confirm:null};
  // Opening is explicit; subsequent async draws must keep this session visible.
  ctx.openModal(loadoutView({...session,state:ctx.state(),bind:current(),robot,list:list(robot.uid),pending:true,online:ctx.net.state.online,rcores:ctx.balance(),partMarkup:ctx.partMarkup}));
  await refresh();
 }
 async function write(action,args,apply,message){
  if(blocked()||!same(session)||!session.known||!ctx.net.state.online)return;
  const t=token(),oldMode=current().on,oldCost=current().unbind,oldPreset=action.startsWith('preset')?JSON.stringify(list(session.uid)[args.i]):null;pending=t;draw();
  // Preflight rechecks mode/bindings after another device may have changed them.
  const checked=await read(t);
  if(!same(t)){if(pending===t)pending=null;return;}
  if(!checked){pending=null;t.session.known=false;draw('장비 기록을 확인하지 못해 요청하지 않았습니다.');return;}
  const robot=t.owner.robots.find(r=>r.uid===t.session.uid);
  if(!robot){pending=null;draw('기체를 찾을 수 없습니다.');return;}
  if(oldMode!==current().on||(action.startsWith('preset')&&oldPreset!==JSON.stringify(list(robot.uid)[args.i]))||(action==='unbind'&&(oldCost!==current().unbind||ctx.balance()<current().unbind||!boundRobot(current(),args.partUid)))){
   pending=null;t.session.confirm=null;ctx.commit();draw('장비 조건이 바뀌었습니다. 최신 기록을 확인하고 다시 선택하세요.');return;
  }
  if(action==='equip'){
   const bound=boundRobot(current(),args.partUid);
   if(bound&&bound!==robot.uid){pending=null;ctx.commit();draw(errors['part bound']);return;}
  }
  // Cancel before sending if the confirmation was dismissed during preflight.
  if(!visible(t)){pending=null;ctx.commit();return;}
  let r;try{r=await ctx.net.hangar(action,{...args,robotUid:robot.uid});}catch{}
  if(!same(t)){if(pending===t)pending=null;return;}
  if(r?.ok){apply(r,robot);t.session.confirm=null;t.session.names={};}
  else{
   // No automatic retry of a possibly consumed write. Read back instead.
   t.session.known=await read(t);
  }
  if(pending===t)pending=null;
  ctx.commit();
  const notice=r?.ok?message(r):errors[r?.error]||'확정 응답을 받지 못했습니다. 최신 기록을 확인하고 다시 이용하세요.';
  if(visible(t))draw(notice);else ctx.toast(notice);
 }
 function requestPreset(kind,i){
  if(blocked()||!session?.known||session.mode!=='presets'||!Number.isInteger(i)||i<0||i>=5)return;
  const name=session.names[i]??doc.getElementById(`lu-name-${i}`)?.value??list(session.uid)[i]?.n??'';
  if(kind==='presetDelete'||list(session.uid)[i]){session.confirm={kind,i,name};draw();}
  else return save(i,name);
 }
 const save=(i,name)=>write('presetSave',{i,name},r=>{
  if(current().on)current().presets[session.uid]=parsePresets(r.presets);
  else ctx.state().presets=parsePresets(r.presets);
 },r=>`「${r.presets[i].n}」 저장했습니다.`);
 const remove=i=>write('presetDelete',{i},r=>{
  if(current().on)current().presets[session.uid]=parsePresets(r.presets);
  else ctx.state().presets=parsePresets(r.presets);
 },()=> '저장된 빌드를 삭제했습니다.');
 async function applyPreset(i){
  if(session?.mode!=='presets'||!list(session.uid)[i])return;
  const x=list(session.uid)[i];
  await write('presetApply',{i},(r,robot)=>{
   for(const [slot,u] of Object.entries(r.applied||{})){
    for(const other of ctx.state().robots)for(const s of Object.keys(other.slots))if(other.slots[s]===u)other.slots[s]=null;
    robot.slots[slot]=u;if(current().on)current().parts[u]=robot.uid;
   }
   for(const s of r.emptied||[])robot.slots[s]=null;
  },r=>{
   const bound=new Set(r.bound||[]),skipped=Object.entries(x.s).filter(([,u])=>bound.has(u)).map(([s])=>KO[s]);
   const missing=(r.missing||[]).filter(s=>!bound.has(x.s[s])).map(s=>KO[s]);
   return `「${x.n}」 적용했습니다.${skipped.length?` 다른 기체 전용: ${skipped.join('·')} 건너뜀.`:''}${missing.length?` 없는 파츠: ${missing.join('·')} 건너뜀.`:''}`;
  });
 }
 const actions={
  openPresets:()=>open('presets'),openSlot:s=>Object.hasOwn(KO,s)?open('slot',s):undefined,
  refreshLoadout:refresh,loadoutName:(i,v)=>{if(session&&!busy())session.names[i]=v;},
  savePreset:i=>requestPreset('presetSave',i),deletePreset:i=>requestPreset('presetDelete',i),applyPreset,
  confirmPreset:()=>{const c=session?.confirm;if(!c||blocked())return;return c.kind==='presetDelete'?remove(c.i):save(c.i,c.name);},
  cancelPreset:()=>{if(session&&!busy()){session.confirm=null;draw();}},
  equip:(slot,partUid)=>session?.mode==='slot'&&session.slot===slot?write('equip',{slot,partUid},(r,robot)=>{
   for(const other of ctx.state().robots)for(const s of Object.keys(other.slots))if(other.slots[s]===partUid)other.slots[s]=null;
   robot.slots[slot]=partUid;if(current().on&&r.bound)current().parts[partUid]=r.bound;
  },()=> '장착했습니다.'):undefined,
  unequip:slot=>session?.mode==='slot'&&session.slot===slot?write('unequip',{slot},(_,robot)=>{robot.slots[slot]=null;},()=> '장착을 해제했습니다.'+(current().on?' 귀속된 파츠는 전용 상태를 유지합니다.':'')):undefined,
  openUnbind:uid=>{
   if(blocked()||!session||!boundRobot(current(),uid))return;
   session.mode='unbind';session.partUid=uid;draw();
  },
  confirmUnbind:()=>{
   if(session?.mode!=='unbind'||!current().on||current().unbind===null||ctx.balance()<current().unbind)return;
   return write('unbind',{partUid:session.partUid},r=>{delete current().parts[r.uid];ctx.setBalance(r.rcores);},r=>`귀속을 해제했습니다. 정제 코어 ${r.spent}개 사용.`);
  }
 };
 async function refreshBinding(){
  const owner=ctx.state(),account=ctx.net.state.accountId,before=snapshot();let r;try{r=await ctx.net.growthState();}catch{}
  if(owner!==ctx.state()||account!==ctx.net.state.accountId||before!==snapshot()||typeof r?.bind?.on!=='boolean')return false;
  if(r.items)owner.items={...r.items};adopt(r);ctx.onRemote?.(r);return true;
 }
 return {actions,adopt,busy,list,refreshBinding,binding:current,mode:()=>current().on,badge:u=>bindingBadge(current(),ctx.state(),u),bound:u=>boundRobot(current(),u),fuse:uids=>fuseBinding(current(),uids),boundName:u=>robotName(ctx.state(),u),inherit:(r,uids)=>{
  // fuse POST omits bound: remove consumed labels and confirm the result by GET.
  for(const u of r.used||uids)delete current().parts[u];
 }};
}
