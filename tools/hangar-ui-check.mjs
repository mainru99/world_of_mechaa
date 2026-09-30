/* The UI may inspect a reserve unit without changing the battle vanguard.
 * Exercise the actual game handlers with a fake API: all writes must target
 * the inspected UID, including when inspection changes while a request waits.
 */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../js/game.js',import.meta.url),'utf8');
function fn(name){
  const match=new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match,`handler exists: ${name}`);
  const at=match.index, lineEnd=source.indexOf('\n',at);
  if(source.slice(at,lineEnd).trimEnd().endsWith('}'))return source.slice(at,lineEnd);
  return source.slice(at,source.indexOf('\n}',at)+2);
}
const makeRobot=uid=>({uid,type:uid,level:10,skillLv:1,fat:9,slots:{WEAPON:null,FRAME:null,BOOSTER:null,CORE:null}});
const robots=[makeRobot('lead'),makeRobot('reserve')], calls=[];
let reply={}, pending=null;
const ctx=vm.createContext({
  S:{robots,sel:0,squad:['lead'],credits:900,scrap:800,parts:[],presets:[]},
  hangarUid:null,hangarTab:'info',hangarInventory:false,
  selRobot:()=>robots[0],SLOTS:['WEAPON','FRAME','BOOSTER','CORE'],
  ROBOT_TYPES:{lead:{name:'LEAD'},reserve:{name:'RESERVE'}},
  srvHangar:async(action,args)=>{calls.push({action,args});return pending?await pending:reply;},
  renderHangar(){},renderWallet(){},commitLocal(){},closeModal(){},toast(){},
  skillMax:()=>10,skillRate:()=>.5,skillCost:()=>({cr:10,sc:5}),
  presetsNow:()=>[{n:'sample'}],parsePresets:x=>x,
  openPresets(){},SLOT_KO:{WEAPON:'무장'},
  $:()=>({value:'build',focus(){},scrollIntoView(){}}),
  matchMedia:()=>({matches:false}),Date,
});
const names=['hangarRobot','inspectRobot','cycleHangar','setHangarTab','skillUp','service','levelUp'];
vm.runInContext(names.map(fn).join('\n'),ctx);
ctx.inspectRobot(1);
assert.equal(ctx.hangarUid,'reserve');assert.equal(ctx.S.sel,0);assert.deepEqual(ctx.S.squad,['lead']);
ctx.cycleHangar(1);assert.equal(ctx.hangarUid,'lead');ctx.inspectRobot(1);
ctx.setHangarTab('tune');assert.equal(ctx.hangarTab,'tune');
assert.equal(ctx.S.sel,0);

reply={skillLv:2,credits:850,scrap:790,success:true};await ctx.skillUp();assert.equal(robots[1].skillLv,2);
reply={credits:820};await ctx.service();assert.equal(robots[1].fat,0);assert.equal(robots[0].fat,9);
let finish;
pending=new Promise(resolve=>{finish=resolve;});
const upgrading=ctx.levelUp();ctx.inspectRobot(0);
finish({credits:750,level:11,exp:0});await upgrading;
assert.equal(robots[1].level,11,'response applies to captured target');assert.equal(robots[0].level,10);
assert.ok(calls.every(x=>x.args.robotUid==='reserve'),'every mutation targets inspected unit');
assert.equal(ctx.S.sel,0);assert.deepEqual(ctx.S.squad,['lead']);

// Closed/stale inspection IDs must resolve safely after an account/state replacement.
ctx.hangarUid='removed';assert.equal(ctx.hangarRobot().uid,'lead');
const render=fn('renderHangar');
assert.match(render,/sprite\(rb.type,false,\{idle:true\}\)/);
assert.match(render,/ROWAR.inspectRobot/);
assert.doesNotMatch(render,/onclick="ROWAR.selectRobot/);
console.log('Hangar UI passed: inspection/cycling/tabs preserve vanguard and squad; skill/service/level-up target inspected UID; delayed level-up target; stale selection fallback; idle hero contract.');

// Equipment and presets moved into the server-aware controller; retain their
// captured-UID, rejection and transfer coverage against the actual server.
await import('./loadout-ui-check.mjs');
