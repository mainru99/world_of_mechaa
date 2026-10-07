// Consume authoritative events, not a second simulation. Slot IDs stay intact
// even when a board has holes. This reducer is also exercised without the DOM.
export function replayState(fight){
 const units={P:[],E:[]};
 for(const [side,team] of [['P',fight.me.team],['E',fight.opponent.team]])
  units[side]=team.map(m=>m?{hp:m.stats.hp,maxhp:m.stats.hp,sp:0,shield:Math.round(m.shield||0)}:null);
 return {units,log:[],active:null};
}
export function applyReplayEvent(state,e){
 const self=state.units[e.side]?.[e.i],target=state.units[e.dside]?.[e.di];
 const log=s=>{state.log.push(s);if(state.log.length>12)state.log.shift();};
 const who=e.side==='P'?'아군':'상대';
 if(e.t==='turn'&&self){self.sp=e.sp;state.active=e.side+e.i;}
 if(e.t==='skill'){if(self)self.sp=0;log(`${who} ${e.i+1}번 · ${e.name}`);}
 if(e.t==='hit'&&target){target.hp=e.thp;if(e.absorb)target.shield=Math.max(0,target.shield-e.absorb);log(`${who} ${e.i+1}번 → ${e.dside==='P'?'아군':'상대'} ${e.di+1}번 · ${e.miss?'회피':(e.crit?'치명 ':'')+e.dmg+' 피해'}${e.absorb?' (방벽 '+e.absorb+' 흡수)':''}`);}
 if(e.t==='heal'&&self){self.hp=e.hp;log(`${who} ${e.i+1}번 · 내구 +${e.amt}`);}
 if(e.t==='shield'&&self){self.shield=e.now;log(`${who} ${e.i+1}번 · 방벽 +${e.amt}`);}
 if(e.t==='jam'&&target)target.sp=e.sp;
 if(e.t==='mark')log('표적 효과 적용');
 if(e.t==='parry')log(`${who} · 흘려내기`);
 if(e.t==='heat'){for(const h of e.hits||[]){const u=state.units[h.side]?.[h.i];if(u)u.hp=h.thp;}log(`과열 ${e.n}단계 · 양쪽 내구 감소`);}
 if(e.t==='down'&&self){self.hp=0;log(`${who} ${e.i+1}번 격파`);}
 if(e.t==='end'){state.active=null;log(`${e.winner==='P'?'아군 승리':'상대 승리'} · ${e.by==='time'?'잔여 내구 판정':'전멸'}`);}
 return state;
}
