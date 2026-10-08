// Display-only audio. No autoplay, synthetic fallback, game state or API writes.
export const AUDIO_KEY='rowar.audio.v1';
export const AUDIO_NAMES=Object.freeze(('hit_light_a hit_light_b hit_heavy_a hit_heavy_b crit miss parry windup shot_sniper shot_shell shot_missile shot_gatling beam_charge beam_fire skill_charge explosion land heal shield win lose ui_click ui_confirm anvil_hit enh_success enh_fail enh_charge levelup coin_tick reward_claim rare_reveal').split(' '));
const names=new Set(AUDIO_NAMES);
const limits={ui_click:[.35,.22,85],ui_confirm:[.5,.45,100],windup:[.25,.25,120],shot_gatling:[.4,.25,120],skill_charge:[.4,.42,180],beam_charge:[.45,.42,180],beam_fire:[.55,.8,120],crit:[.65,1,140],explosion:[.65,1.8,180],win:[.7,3,500],lose:[.6,2.5,500],enh_charge:[.4,2.5,300],anvil_hit:[.6,.5,150],enh_success:[.7,2.5,400],enh_fail:[.6,2,400],levelup:[.7,2.5,400],coin_tick:[.45,.3,150],reward_claim:[.6,1.7,250],rare_reveal:[.7,3,500]};
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
export function audioPrefs(value){
 return {volume:typeof value?.volume==='number'&&Number.isFinite(value.volume)?clamp(value.volume,0,1):.45,muted:value?.muted===true};
}
export function createAudio(options={}){
 const doc=options.document??globalThis.document,win=options.window??globalThis.window;
 const factory=options.contextFactory??(()=>{const C=globalThis.AudioContext||globalThis.webkitAudioContext;return C?new C():null;});
 const fetcher=options.fetch??globalThis.fetch,now=options.now??(()=>Date.now());
 let storage;try{storage=options.storage??globalThis.localStorage;}catch{}
 let prefs;try{prefs=audioPrefs(JSON.parse(storage?.getItem(AUDIO_KEY)||'null'));}catch{prefs=audioPrefs(null);}
 let ctx=null,master=null,unlocking=null,epoch=0,disposed=false,unsupported=false,failed=false;
 const buffers=new Map(),loading=new Map(),scopes=new Map(),voices=new Set(),cooldowns=new Map(),listeners=new Set();
 const queue=[];let downloads=0;
 const hidden=()=>!!doc?.hidden;
 const state=()=>({...prefs,ready:ctx?.state==='running',unsupported,failed});
 const notify=()=>{for(const fn of listeners)try{fn(state());}catch{}};
 const scopeVersion=scope=>scopes.get(scope)||0;
 const ticket=(scope='ui')=>({scope,epoch,version:scopeVersion(scope)});
 const current=t=>!disposed&&!hidden()&&!!t&&t.version===scopeVersion(t.scope);
 const valid=t=>current(t)&&t.epoch===epoch;
 function halt(v){try{v.source.stop();}catch{}v.clean();}
 function stop(scope){scopes.set(scope,scopeVersion(scope)+1);for(const v of [...voices])if(v.scope===scope)halt(v);}
 function stopAll(){epoch++;for(const v of [...voices])halt(v);cooldowns.clear();}
 function save(){try{storage?.setItem(AUDIO_KEY,JSON.stringify(prefs));}catch{}notify();}
 function setVolume(value){if(!Number.isFinite(Number(value)))return;prefs.volume=clamp(Number(value),0,1);if(master)master.gain.setValueAtTime(prefs.muted?0:prefs.volume,ctx.currentTime);if(!prefs.volume)stopAll();save();}
 function setMuted(value){prefs.muted=!!value;if(master)master.gain.setValueAtTime(prefs.muted?0:prefs.volume,ctx.currentTime);if(prefs.muted)stopAll();save();}
 async function unlock(){
  if(disposed||hidden()||unsupported)return false;
  if(unlocking)return unlocking;
  try{
   if(!ctx){ctx=factory();if(!ctx){unsupported=true;notify();return false;}
    master=ctx.createGain();master.gain.value=prefs.muted?0:prefs.volume;
    const compressor=ctx.createDynamicsCompressor();compressor.threshold.value=-16;compressor.knee.value=12;compressor.ratio.value=5;
    master.connect(compressor);compressor.connect(ctx.destination);
   }
   if(ctx.state==='running'){notify();return true;}
   unlocking=Promise.resolve(ctx.resume()).then(()=>{notify();return ctx.state==='running';}).catch(()=>{notify();return false;}).finally(()=>{unlocking=null;});
   return unlocking;
  }catch{unsupported=true;notify();return false;}
 }
 function pump(){
  while(downloads<4&&queue.length){const job=queue.shift();downloads++;
   Promise.resolve().then(job.run).then(job.resolve,()=>job.resolve(null)).finally(()=>{downloads--;pump();});
  }
 }
 function load(name){
  if(!names.has(name)||!ctx||disposed)return Promise.resolve(null);
  if(buffers.has(name))return Promise.resolve(buffers.get(name));
  if(loading.has(name))return loading.get(name);
  const promise=new Promise(resolve=>{queue.push({resolve,run:async()=>{
   if(disposed)return null;
   const response=await fetcher(new URL('../assets/sfx/'+name+'.wav',import.meta.url));
   if(!response.ok)throw new Error('sound unavailable');
   const buffer=await ctx.decodeAudioData(await response.arrayBuffer());
   if(!disposed)buffers.set(name,buffer);return buffer;
  }});pump();}).then(buffer=>{if(!buffer){failed=true;notify();}return buffer;});
  // A failed asset remains silent for this session; no repeated 404/decode loop.
  loading.set(name,promise);return promise;
 }
 function preload(list){if(!ctx||prefs.muted||!prefs.volume||hidden()||disposed)return Promise.resolve([]);return Promise.all(list.map(load));}
 async function play(name,config={}){
  const scope=config.scope||'ui',t=config.ticket||ticket(scope),started=now();
  if(!names.has(name)||!valid(t)||t.scope!==scope||prefs.muted||!prefs.volume||ctx?.state!=='running')return false;
  const buffer=buffers.get(name)||await load(name);
  if(!buffer||!valid(t)||prefs.muted||!prefs.volume||ctx?.state!=='running'||now()-started>(config.ttl??220))return false;
  const [baseGain,max,cooldown]=limits[name]||[.55,1.1,85],key=scope+':'+name;
  if(now()-(cooldowns.get(key)??-Infinity)<cooldown)return false;
  const priority=config.priority??(scope==='battle'||scope==='brawl'?1:2);
  if(voices.size>=8){const oldest=[...voices].sort((a,b)=>a.priority-b.priority)[0];if(oldest.priority>priority)return false;halt(oldest);}
  let voice=null;
  try{
   const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;
   const rate=clamp(Number(config.rate)||1,.5,2);source.playbackRate.value=rate;
   const duration=Math.min(buffer.duration/rate,clamp(Number(config.max)||max,.05,5));
   const level=baseGain*clamp(Number.isFinite(config.gain)?config.gain:1,0,1.5),at=ctx.currentTime;
   gain.gain.setValueAtTime(level,at);gain.gain.setValueAtTime(level,at+Math.max(0,duration-.06));gain.gain.linearRampToValueAtTime(0,at+duration);
   source.connect(gain);gain.connect(master);
   const v={source,scope,priority,clean:()=>{voices.delete(v);try{source.disconnect();gain.disconnect();}catch{}}};
   voice=v;
   voices.add(v);source.onended=v.clean;cooldowns.set(key,now());source.start();source.stop(at+duration);return true;
  }catch{if(voice)halt(voice);return false;}
 }
 let unbind=()=>{};
 function bind(){
  unbind();
  const gesture=e=>{if(e.isTrusted&&!e.repeat)void unlock().then(ok=>{if(ok)void preload(['ui_click','ui_confirm']);});};
  const click=e=>{if(!e.isTrusted||e.target?.closest?.('[data-audio-silent]'))return;
   const button=e.target?.closest?.('button,[role="button"],summary');
   if(button&&!button.disabled&&!button.closest('[inert]'))void play('ui_click');
  };
  const hide=()=>{if(hidden())stopAll();},pagehide=()=>{stopAll();};
  doc?.addEventListener('pointerdown',gesture,true);doc?.addEventListener('keydown',gesture,true);doc?.addEventListener('click',click);doc?.addEventListener('visibilitychange',hide);win?.addEventListener('pagehide',pagehide);
  unbind=()=>{doc?.removeEventListener('pointerdown',gesture,true);doc?.removeEventListener('keydown',gesture,true);doc?.removeEventListener('click',click);doc?.removeEventListener('visibilitychange',hide);win?.removeEventListener('pagehide',pagehide);};
  return unbind;
 }
 function dispose(){if(disposed)return;disposed=true;stopAll();unbind();listeners.clear();buffers.clear();try{void Promise.resolve(ctx?.close()).catch(()=>{});}catch{}}
 return {state,unlock,bind,play,preload,ticket,valid,current,stop,stopAll,setVolume,setMuted,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},dispose};
}
