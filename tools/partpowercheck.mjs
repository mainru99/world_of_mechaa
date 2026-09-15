import assert from 'node:assert/strict';
import {CONST} from '../data/balance.js';
import {powerOf} from '../js/stats.js';
const bare={hp:4800,atk:1100,def:420,spd:390,crit:.17,eva:.18};
const original=s=>Math.round(Math.sqrt(s.atk*(1+s.crit*(CONST.CRIT_MULT-1))*s.spd*
  (1+CONST.SKILL_POWER_SHARE*((s.skillMul||1)-1))*s.hp*(1+s.def/100)/Math.max(.4,1-s.eva))*.115);
for(const skillMul of [1,1.15,1.3])for(const spd of [10,390,1500]){
 const s={...bare,skillMul,spd};
 assert.equal(powerOf(s),original(s),'non-stack and old snapshots stay identical');
 assert.equal(powerOf({...s,stackSpd:-.008,stackMax:0}),original(s));
 assert.equal(powerOf({...s,stackSpd:-.008,stackMax:5}),original({...s,spd:spd*.96}));
}
assert.equal(powerOf({...bare,spd:1,stackSpd:-1,stackMax:5}),original({...bare,spd:1}));
console.log('Sustained-speed display checks passed; no-FX and old snapshot power unchanged.');
