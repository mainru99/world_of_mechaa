import {parsePresets,presetCheck} from '../preset.js';
import {SLOTS,ROBOT_TYPES} from '../../data/balance.js';

// bind.parts uses public UIDs, never DB ids. Mode comes from the server,
// so previewing an enabled response does not enable the shared feature switch.
export function bindingState(remote){
 const b=remote?.bind;
 return {on:b?.on===true,unbind:Number.isInteger(b?.unbind)&&b.unbind>=0?b.unbind:null,
  parts:b?.on===true?{...(b.parts||{})}:{},presets:b?.on===true?Object.fromEntries(Object.entries(b.presets||{}).map(([u,p])=>[u,parsePresets(p)])):{}};
}
export function boundRobot(bind,uid){return bind.on?bind.parts[uid]||null:null;}
export function robotName(state,uid){const r=state.robots.find(r=>r.uid===uid);return r?ROBOT_TYPES[r.type]?.name||'기체':'다른 기체';}
export function fuseBinding(bind,uids){
 const owners=[...new Set(uids.map(u=>boundRobot(bind,u)).filter(Boolean))];
 return {ok:owners.length<=1,bound:owners[0]||null};
}
export function loadoutSlots(preset,state,bind,uid){
 const chk=presetCheck(preset,state.parts);
 return SLOTS.map(slot=>{
  const partUid=preset.s[slot],part=state.parts.find(p=>p.uid===partUid);
  const bound=boundRobot(bind,partUid),blocked=!!bound&&bound!==uid;
  return {slot,partUid,part,bound,status:!partUid?'empty':blocked?'bound':chk.missing.includes(slot)?'missing':'ready'};
 });
}
