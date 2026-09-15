/* Independent power calibration: never fit the model to the parts under test.
 * Paired directions and disjoint seeds keep balance tuning out of the control.
 */
import { PART_BASES } from '../data/balance.js';
import { computeStats, powerOf } from '../js/stats.js';
import { makeUnit, simulate } from '../js/sim.js';
export function calibratePartPower() {
const TYPES=['mule','ranger','azure'],LV=40;
function wr(type,a,b,n,offset){let w=0,capped=0;for(let i=0;i<n;i++){const seed=(i*7919+offset)>>>0;let P=makeUnit('P',type,a),E=makeUnit('E',type,b),ev=simulate(P,E,seed);w+=ev.at(-1).winner==='P';capped+=P.hp>0&&E.hp>0;P=makeUnit('P',type,b);E=makeUnit('E',type,a);ev=simulate(P,E,seed);w+=ev.at(-1).winner==='E';capped+=P.hp>0&&E.hp>0;}return{wr:w/n/2*100,capped};}
// The control independently moves hp and atk by the same factor q. In powerOf
// the two factors multiply and their square root is q, giving the requested
// displayed-power difference without changing skill, haste, evasion, or FX.
function controlled(s,g){const q=1+g/100;return{...s,hp:s.hp*q,hpFull:s.hpFull*q,atk:s.atk*q};}
function lerpCurve(curve,x,from='gain',to='wr'){for(let i=1;i<curve.length;i++){const a=curve[i-1],b=curve[i];if(x<=b[from])return a[to]+(b[to]-a[to])*(x-a[from])/(b[from]-a[from]);}throw new Error('OUTSIDE_CALIBRATION '+x);}
const gains=[-15,-10,-7.5,-5,-3,-2,-1,0,1,2,3,5,7.5,10,15],calibration=[];
for(const type of TYPES){const bare=computeStats({type,level:LV,fat:0,skillLv:0,slots:{}},[]);const curve=gains.map(g=>{const s=controlled(bare,g);return{gain:(powerOf(s)/powerOf(bare)-1)*100,...wr(type,s,bare,5000,410003)}});let identifiable=curve.every((p,i)=>!i||p.wr>curve[i-1].wr)&&curve.every(p=>p.capped===0);const c0=curve.find(p=>Math.abs(p.gain)<.02);identifiable&&=Math.abs(c0.wr-50)<.01;const windowGain=Math.min(curve.at(-1).wr-c0.wr,c0.wr-curve[0].wr);calibration.push({type,curve,identifiable,windowGain,budget:windowGain/10,bare});}
const rows=[];
for(const id in PART_BASES){const B=PART_BASES[id],p={uid:'x',slot:B.slot,base:id,rarity:'C',ko:'일반',name:B.ko,affixes:[],seed:0,lv:LV,enh:0};const refs=[];for(const c of calibration){const mine=computeStats({type:c.type,level:LV,fat:0,skillLv:0,slots:{[B.slot]:'x'}},[p]),gain=(powerOf(mine)/powerOf(c.bare)-1)*100,actual=wr(c.type,mine,c.bare,2500,820007),predicted=lerpCurve(c.curve,gain);refs.push({type:c.type,gain,actual:actual.wr,predicted,err:actual.wr-predicted,equivalentGain:lerpCurve(c.curve,actual.wr,'wr','gain')});}rows.push({id,fx:!!B.fx,refs,err:refs.reduce((s,x)=>s+x.err,0)/3});}
const mae=rows.reduce((s,r)=>s+Math.abs(r.err),0)/rows.length;
const perRefMae=rows.flatMap(r=>r.refs).reduce((s,r)=>s+Math.abs(r.err),0)/(rows.length*3);
const avgPowerError=rows.flatMap(r=>r.refs).reduce((s,r)=>s+Math.abs(r.gain-r.equivalentGain),0)/(rows.length*3);
const fxRows=rows.filter(r=>r.fx),fxMean=fxRows.reduce((s,r)=>s+r.err,0)/fxRows.length;
const budget=calibration.reduce((s,c)=>s+c.budget,0)/3;
const identifiable=calibration.every(c=>c.identifiable);
const result={design:'Independent symmetric hp/atk control at the actual displayed power difference; paired directions, disjoint control and evaluated seeds. Window budget is measured from +/-15% controls, preserving one-tenth-window criterion.',calibration:calibration.map(({bare,...x})=>x),rows,summary:{identifiable,mae,perRefMae,avgPowerError,fxMean,budget,aggregatePass:identifiable&&mae<budget,perRefPass:identifiable&&perRefMae<budget,equivalentPowerPass:identifiable&&avgPowerError<1.5,fxPass:Math.abs(fxMean)<2}};

return result;
}
