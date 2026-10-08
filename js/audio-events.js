import {COMBAT_TYPES} from './units.js';
export function shotSound(type){
 const role=COMBAT_TYPES[type]?.role||'';
 // Check the actual weapon before chassis words (HYDRA GATLING has a missile backpack).
 if(/개틀링/.test(role))return 'shot_gatling';
 if(/빔/.test(role))return 'beam_fire';
 if(/저격/.test(role))return 'shot_sniper';
 if(/포격/.test(role))return 'shot_shell';
 if(/미사일/.test(role))return 'shot_missile';
 return null;
}
export const COMBAT_SOUNDS=Object.freeze(['hit_light_a','hit_light_b','hit_heavy_a','hit_heavy_b','crit','miss','parry','windup','shot_sniper','shot_shell','shot_missile','shot_gatling','beam_charge','beam_fire','skill_charge','explosion','land','heal','shield','win','lose']);
export function createCombatAudio(audio,{scope='battle',active=()=>true,unit=()=>null}={}){
 audio.stop(scope);const token=audio.ticket(scope);void audio.preload(COMBAT_SOUNDS);
 let variant=0;const defeated=new Set();
 const play=(name,config={})=>{if(active()&&audio.current(token))void audio.play(name,{...config,scope});};
 function event(e){
  if(!e||!active()||!audio.current(token))return;
  const actor=unit(e.side,e.i),target=unit(e.dside,e.di),shot=shotSound(actor?.type);
  if(e.t==='skill')play(shot==='beam_fire'?'beam_charge':'skill_charge');
  else if(e.t==='hit'){
   if(shot)play(shot,{gain:.7});
   if(e.miss)play('miss');
   else{
    const intensity=Math.max(.25,Math.min(1.4,(Number(e.dmg)||0)/Math.max(1,Number(target?.maxhp)||1000)/.16));
    play(e.crit?'crit':`hit_${intensity>.85?'heavy':'light'}_${variant++%2?'b':'a'}`,{gain:.5+.45*intensity,rate:1.1-.15*intensity});
    if(e.absorb)play('shield',{gain:.4});
    const key=e.dside+':'+(e.di||0);
    if(e.thp<=0&&!defeated.has(key)){defeated.add(key);play('explosion');}
   }
  }else if(e.t==='turn'&&!shot)play('windup');
  else if(e.t==='parry')play('parry');
  else if(e.t==='heal')play('heal');
  else if(e.t==='shield')play('shield');
  else if(e.t==='swap'){defeated.delete(e.side+':'+(e.i||0));play('land');}
  else if(e.t==='down'){const key=e.side+':'+(e.i||0);if(!defeated.has(key)){defeated.add(key);play('explosion');}}
  else if(e.t==='end'){audio.stop(scope);/* Separate result ticket: cut off combat tails. */
   if(active())void audio.play(e.winner==='P'?'win':'lose',{scope:scope+'-result',priority:3});
  }
 }
 return {event,stop:()=>audio.stop(scope)};
}
