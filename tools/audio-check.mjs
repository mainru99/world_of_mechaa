import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {createAudio,audioPrefs,AUDIO_NAMES,AUDIO_KEY} from '../js/audio.js';
import {createCombatAudio,shotSound,COMBAT_SOUNDS} from '../js/audio-events.js';
import {audioSettingsView,audioStatus} from '../js/ui/audio-settings.js';

const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
function surface(){const events=new Map();return {hidden:false,addEventListener:(n,f)=>{if(!events.has(n))events.set(n,new Set());events.get(n).add(f);},removeEventListener:(n,f)=>events.get(n)?.delete(f),emit:(n,e={})=>{for(const f of events.get(n)||[])f(e);},events};}
function fixture({fetch,decode,stored}={}){
 let clock=1000,created=0;const sources=[],requests=[],storage=new Map(stored?[[AUDIO_KEY,stored]]:[]),doc=surface(),win=surface();
 const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){}});
 const context={state:'suspended',currentTime:5,destination:{},createGain:()=>({gain:param(),connect(){},disconnect(){}}),createDynamicsCompressor:()=>({threshold:param(),knee:param(),ratio:param(),connect(){}}),
  async resume(){this.state='running';},async close(){this.state='closed';},decodeAudioData:decode||async function(){return {duration:4};},
  createBufferSource:()=>{const source={playbackRate:param(),connect(){},disconnect(){},start(){this.started=true;},stop(at){this.stops=(this.stops||0)+1;this.stopAt=at;}};sources.push(source);return source;}};
 const audio=createAudio({document:doc,window:win,storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},contextFactory:()=>{created++;return context;},now:()=>clock,
  fetch:async url=>{requests.push(String(url));return fetch?fetch(url):{ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};}});
 return {audio,doc,win,context,sources,requests,storage,created:()=>created,advance:n=>clock+=n};
}
assert.equal(AUDIO_NAMES.length,31);assert.equal(new Set(AUDIO_NAMES).size,31);
assert.deepEqual(audioPrefs(null),{volume:.45,muted:false});assert.equal(audioPrefs({volume:9}).volume,1);assert.equal(audioPrefs({volume:-1}).volume,0);
assert.equal(audioPrefs({volume:'0.8',muted:'true'}).volume,.45);assert.equal(audioPrefs({volume:NaN}).volume,.45);
assert.deepEqual(audioPrefs({volume:.3,muted:true}),{volume:.3,muted:true});
// 2026-10-08 용량 정리 — 게임에는 MP3(128kbps · tools/sfx_encode.sh)만 싣는다. 원본 WAV 는 proto/juice/sfx 에 그대로 남는다.
const files=(await readdir(new URL('../assets/sfx/',import.meta.url))).filter(n=>/\.(mp3|wav)$/.test(n)).sort();
assert.deepEqual(files,AUDIO_NAMES.map(n=>n+'.mp3').sort(),'only encoded MP3s ship');
let total=0,source=0;
for(const name of AUDIO_NAMES){
 const data=await readFile(new URL('../assets/sfx/'+name+'.mp3',import.meta.url)),original=await readFile(new URL('../proto/juice/sfx/'+name+'.wav',import.meta.url));
 assert.ok(data.toString('ascii',0,3)==='ID3'||(data[0]===0xff&&(data[1]&0xe0)===0xe0),name+' is MPEG audio');
 assert.equal(original.toString('ascii',0,4),'RIFF',name+' original WAV preserved');
 assert.ok(data.length<original.length/4,name+' is compressed');total+=data.length;source+=original.length;
}
{
 const f=fixture();await f.audio.preload(AUDIO_NAMES);assert.equal(await f.audio.play('ui_click'),false);assert.equal(f.created(),0);assert.equal(f.requests.length,0,'no autoplay/downloads before input');
 f.audio.bind();f.doc.emit('pointerdown',{isTrusted:false});await flush();assert.equal(f.created(),0);
 f.doc.emit('keydown',{isTrusted:true,repeat:true});await flush();assert.equal(f.created(),0);
 f.doc.emit('pointerdown',{isTrusted:true});await flush();assert.equal(f.created(),1);assert.equal(f.audio.state().ready,true);
 await f.audio.preload(['ui_click']);assert.equal(await f.audio.play('ui_click'),true);assert.equal(await f.audio.play('ui_click'),false,'cooldown');
 f.advance(100);await f.audio.play('ui_click');assert.equal(f.requests.filter(u=>u.endsWith('ui_click.mp3')).length,1,'decode/cache reused');
 f.audio.setVolume(.72);f.audio.setMuted(true);assert.equal(JSON.parse(f.storage.get(AUDIO_KEY)).volume,.72);assert.equal(await f.audio.play('win'),false);
 f.audio.setMuted(false);f.audio.setVolume(0);assert.equal(await f.audio.play('win'),false);f.audio.setVolume(2);assert.equal(f.audio.state().volume,1);
 f.audio.setVolume(NaN);assert.equal(f.audio.state().volume,1);
 const restored=fixture({stored:f.storage.get(AUDIO_KEY)});assert.equal(restored.audio.state().volume,1);assert.equal(fixture({stored:'malformed'}).audio.state().volume,.45);
 f.audio.bind();assert.equal(f.doc.events.get('pointerdown').size,1,'binding is idempotent');
 f.audio.dispose();assert.equal(f.doc.events.get('pointerdown').size,0);assert.equal(await f.audio.play('win'),false);assert.equal(f.context.state,'closed');
}
for(const cause of ['scope','all','mute','zero','hidden','pagehide','dispose','late']){
 const gate=defer(),f=fixture({fetch:()=>gate.promise});await f.audio.unlock();f.audio.bind();
 const playing=f.audio.play('win',{scope:'battle'});
 if(cause==='scope')f.audio.stop('battle');if(cause==='all')f.audio.stopAll();
 if(cause==='mute'){f.audio.setMuted(true);f.audio.setMuted(false);}
 if(cause==='zero'){f.audio.setVolume(0);f.audio.setVolume(.45);}
 if(cause==='hidden'){f.doc.hidden=true;f.doc.emit('visibilitychange');f.doc.hidden=false;}
 if(cause==='pagehide')f.win.emit('pagehide');if(cause==='dispose')f.audio.dispose();if(cause==='late')f.advance(221);
 gate.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});assert.equal(await playing,false,cause+' cancels pending loading');assert.equal(f.sources.length,0);
}
{
 let attempts=0;const f=fixture({fetch:async()=>{attempts++;return {ok:false};}});await f.audio.unlock();
 assert.equal(await f.audio.play('win'),false);assert.equal(await f.audio.play('win'),false);assert.equal(attempts,1);assert.equal(f.audio.state().failed,true);
 const d=fixture({decode:async()=>{throw new Error('invalid WAV');}});await d.audio.unlock();assert.equal(await d.audio.play('win'),false);
 const unsupported=createAudio({contextFactory:()=>null});assert.equal(await unsupported.unlock(),false);assert.equal(unsupported.state().unsupported,true);
 const denied=createAudio({contextFactory:()=>{throw new Error('blocked');}});assert.equal(await denied.unlock(),false);
 const resumed=fixture();resumed.context.resume=async()=>{throw Error('denied');};assert.equal(await resumed.audio.unlock(),false);assert.equal(await resumed.audio.play('win'),false);
 assert.equal(await f.audio.play('../raw/other'),false);
}
{
 const f=fixture();await f.audio.unlock();await f.audio.preload(AUDIO_NAMES);
 for(const name of AUDIO_NAMES.slice(0,11))assert.equal(await f.audio.play(name,{scope:'battle'}),true);
 assert.equal(f.sources.filter(s=>s.stops===1).length,8,'only eight voices remain active');
 const last=f.sources.at(-1);last.onended();assert.doesNotThrow(()=>last.onended(),'onended cleanup idempotent');
 f.doc.hidden=true;f.audio.bind();f.doc.emit('visibilitychange');assert.ok(f.sources.every(s=>s.stops>=1));
}
{
 const gates=[],f=fixture({fetch:()=>{const g=defer();gates.push(g);return g.promise;}});await f.audio.unlock();
 const loading=f.audio.preload(AUDIO_NAMES);await flush();assert.equal(gates.length,4,'at most four concurrent downloads');
 let released=0;while(released<AUDIO_NAMES.length){const to=gates.length;for(;released<to;released++)gates[released].resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});await flush();}
 await loading;assert.equal(f.requests.length,31);
}
assert.equal(shotSound('hydra_g'),'shot_gatling');assert.equal(shotSound('hydra_s'),'shot_sniper');assert.equal(shotSound('bastion'),'shot_missile');assert.equal(shotSound('nimbus_c'),'beam_fire');assert.equal(shotSound('howitzer'),'shot_shell');assert.equal(shotSound('azure'),null);
{
 const f=fixture();await f.audio.unlock();await f.audio.preload(COMBAT_SOUNDS);
 const battle=createCombatAudio(f.audio,{unit:side=>({type:side==='P'?'ranger':'azure',maxhp:1000})});
 battle.event({t:'hit',side:'P',dside:'E',dmg:30,thp:970});assert.equal(f.sources.length,2,'shot and contact');
 f.audio.setMuted(true);battle.event({t:'heal',side:'P'});assert.equal(f.sources.length,2);
 f.audio.setMuted(false);battle.event({t:'heal',side:'P'});assert.equal(f.sources.length,3,'unmute resumes subsequent battle events');
 battle.stop();battle.event({t:'skill',side:'P'});assert.equal(f.sources.length,3,'stopped replay never restarts');
}
{
 const played=[],versions=new Map();const mock={stop:s=>versions.set(s,(versions.get(s)||0)+1),ticket:s=>({scope:s,v:versions.get(s)||0}),current:t=>t.v===(versions.get(t.scope)||0),preload:async()=>[],play:(n,c)=>{played.push([n,c]);}};
 let active=true;const battle=createCombatAudio(mock,{active:()=>active,unit:()=>({type:'azure',maxhp:1000})});
 for(const e of [{t:'turn'},{t:'skill'},{t:'hit',dmg:200,thp:0,dside:'E'},{t:'down',side:'E'},{t:'parry'},{t:'heal'},{t:'shield'},{t:'swap',side:'E'},{t:'hit',miss:true},{t:'hit',crit:true,dmg:20,thp:10},{t:'end',winner:'P'}])battle.event(e);
 assert.equal(played.filter(([n])=>n==='explosion').length,1,'KO hit/down deduplicated');
 for(const name of ['windup','skill_charge','hit_heavy_a','explosion','parry','heal','shield','land','miss','crit','win'])assert.ok(played.some(([n])=>n===name),name);
 const count=played.length;active=false;battle.event({t:'hit',dmg:100});assert.equal(played.length,count,'inactive screen silent');
}
const html=audioSettingsView({volume:.45,muted:true});assert.match(html,/효과음 음소거/);assert.match(html,/45%/);assert.match(html,/type="range"/);assert.match(html,/aria-live="polite"/);assert.match(audioStatus({muted:true}),/꺼져/);

// Real production handlers: failed requests are silent, authoritative RNG
// failure gets enh_fail, and a navigation-invalidated response keeps its reward.
const game=await readFile(new URL('../js/game.js',import.meta.url),'utf8');
function fn(name){const p=game.indexOf(`async function ${name}(`);assert.ok(p>=0);return game.slice(p,game.indexOf('\n}',p)+2);}
const fxStub={enhance:()=>({ready:Promise.resolve(),strike:async()=>{},result(){},cancel(){}}),levelUp(){},wallet(){},rewardLines(){}};
for(const result of [null,{failed:true,enh:3,scrap:99,cost:1},{failed:false,enh:4,scrap:99}]){
 const f=fixture();await f.audio.unlock();await f.audio.preload(['enh_charge','anvil_hit','enh_success','enh_fail']);const part={uid:'p',enh:3,name:'sample'};
 const c=vm.createContext({audio:f.audio,growthFx:fxStub,enhAnchor:()=>null,findPart:()=>part,S:{parts:[part]},srvHangar:async()=>result,commitLocal(){},toast(){},fmt:String,enhRate:()=>.5});
 vm.runInContext(fn('enhancePart'),c);await c.enhancePart('p');
 assert.equal(f.sources.length,result?3:1);assert.equal(part.enh,result?.enh??3);
}
{
 const gate=defer(),f=fixture();await f.audio.unlock();await f.audio.preload(['levelup']);const rb={uid:'one',type:'azure',level:3};
 const c=vm.createContext({audio:f.audio,growthFx:fxStub,cur:'hangar',document:{querySelector:()=>null},computeStats:()=>({}),hangarRobot:()=>rb,srvHangar:()=>gate.promise,S:{credits:9},commitLocal(){},toast(){},ROBOT_TYPES:{azure:{name:'AZURE'}}});
 vm.runInContext(fn('levelUp'),c);const run=c.levelUp();f.audio.stopAll();gate.resolve({credits:1,level:4});await run;
 assert.equal(rb.level,4);assert.equal(f.sources.length,0,'navigation retains committed level but suppresses stale sound');
}
assert.match(game,/audio\.stopAll\(\);stopBattleAudio\(\)/);assert.match(game,/net,audio,openModal:openBrawlModal/);
// Exercise the actual two production replay loops, not just the mapper. The
// fake DOM keeps the same arena identity and supplies only display primitives.
for(const player of ['playBattle','playJoint'])for(const mode of ['normal','skip','navigate']){
 const f=fixture();await f.audio.unlock();await f.audio.preload(COMBAT_SOUNDS);
 const arena={isConnected:true},events=[{t:'turn',side:'P',i:0,sp:5},{t:'skill',side:'P',i:0,name:'sample'},
  {t:'hit',side:'P',i:0,dside:'E',di:0,dmg:80,thp:920},{t:'heal',side:'P',i:0,hp:950,amt:20},
  {t:'shield',side:'P',i:0,amt:10},{t:'hit',side:'E',i:0,dside:'P',di:0,miss:true},
  {t:'hit',side:'P',i:0,dside:'E',di:0,crit:true,dmg:100,thp:820},{t:'end',winner:'P'}];
 const P={name:'AZURE',type:'azure',hp:1000,maxhp:1000},E={name:'RANGER',type:'ranger',hp:1000,maxhp:1000};
 let sleeps=0,navigationVoices=0;const shown=[];
 const c=vm.createContext({audio:f.audio,createCombatAudio,createBattleFx:()=>null,cur:'battle',battleSpeed:1,_skipReplay:mode==='skip',document:{getElementById:()=>arena},
  createIgnisRain:()=>null,COMBAT_TYPES:{},AR:()=>null,sprite:()=>'',battleTimeline:ev=>ev.map((_,i)=>i*180),
  setHP:(...a)=>shown.push(['hp',...a]),setSP(){},blog(){},banner(){},flash(){},shakeF(){},floatDmg(){},lunge(){},shoot(){},esc:String,
  sleep:async ms=>{f.advance(ms);if(mode==='navigate'&&++sleeps===2){navigationVoices=f.sources.length;c.cur='hangar';}}});
 vm.runInContext(fn(player),c);
 const result=player==='playBattle'?await c.playBattle(events,P,E,{}):await c.playJoint(events,[P],E);
 assert.equal(result,mode==='navigate'?null:'P',player+' retains result/abandonment behavior');
 if(mode==='normal'){assert.ok(f.sources.length>0);assert.ok(shown.some(x=>x[2]===820),'authoritative HP still displayed');}
  else if(mode==='skip')assert.equal(f.sources.length,0,player+' skip does not start old sounds');
  else{assert.equal(f.sources.length,navigationVoices,player+' never starts another sound after navigation');assert.ok(f.sources.every(s=>s.stops>=2),'prior combat voices stopped in finally');}
}
console.log(`Audio checks passed: ${AUDIO_NAMES.length} MP3s (${total} bytes, WAV originals ${source} bytes preserved); preferences, no autoplay, lazy/cache/concurrency, failures, voice cap, lifecycle cancellation, mute/unmute, combat mapping, growth server-result hooks, accessible settings.`);
