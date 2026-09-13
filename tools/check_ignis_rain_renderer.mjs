import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const modulePath=process.argv[2]||path.resolve(here,'../js/ignis-rain.js');
const moduleUrl=pathToFileURL(modulePath).href;
const atlas={naturalWidth:1254,naturalHeight:1254};

function context(){
  const calls=[];
  let state={x:0,y:0,mirror:false,alpha:1};
  const stack=[];
  return {calls,
    save(){stack.push({...state});},restore(){state=stack.pop();},
    translate(x,y){state.x+=x;state.y+=y;},scale(x){state.mirror=x<0;},
    set globalAlpha(alpha){assert(Number.isFinite(alpha)&&alpha>=0&&alpha<=1);state.alpha=alpha;},
    drawImage(image,sx,sy,sw,sh,dx,dy,dw,dh){
      assert.equal(image.naturalWidth,1254); assert.equal(sw,627); assert.equal(sh,627);
      for(const v of [state.x,state.y,dx,dy,dw,dh])assert(Number.isInteger(v));
      calls.push({cell:sx/627+2*sy/627,...state,dx,dy,dw,dh});
    },
    clearRect(){calls.push({clear:true});},beginPath(){},rect(){},clip(){},imageSmoothingEnabled:true};
}

const {drawIgnisVolley}=await import(moduleUrl+'?pure');
for(const speed of [1,2,4,8]){
  for(const age of [0,10,25,50,80,109,110,140,180,250,410,466,600]){
    for(const miss of [false,true]){
      const left=context(),right=context();
      drawIgnisVolley(left,atlas,{age,side:'p',index:2,speed,x:180,y:80,miss});
      drawIgnisVolley(right,atlas,{age,side:'e',index:2,speed,x:180,y:80,miss});
      assert.equal(left.calls.length,right.calls.length);
      left.calls.forEach((a,i)=>{
        const b=right.calls[i];
        assert.equal(a.x+b.x,360); assert.equal(a.y,b.y);
        assert.equal(a.cell,b.cell); assert.equal(a.mirror,false); assert.equal(b.mirror,true);
      });
      if(speed>=4)assert(left.calls.length<=1);
      if(miss)assert(left.calls.every(c=>c.cell===0));
    }
  }
}
for(const age of [0,109,110,160,310,411]){
  const ctx=context();
  drawIgnisVolley(ctx,atlas,{age,speed:1,reduced:true,x:180,y:80});
  assert(ctx.calls.every(c=>c.cell===3));
  assert(ctx.calls.length<=1);
}
const quiet=context();
drawIgnisVolley(quiet,atlas,{age:111,speed:1,quiet:true,x:180,y:80});
assert(!quiet.calls.some(c=>c.cell===1));
const missing=context();
drawIgnisVolley(missing,null,{age:110,x:180,y:80});
assert.equal(missing.calls.length,0);

// A minimal fake clock exercises pending promises and animation ownership without
// borrowing any page globals or requiring live combat / account changes.
async function environment({imageFails=false,canvasFails=false,reduced=false}={}){
  let now=0,id=0,loads=0,disconnects=0,removes=0;
  const timers=new Map(),frames=new Map(),ctx=context();
  const arena={isConnected:true,clientWidth:374,clientHeight:260,
    querySelector(s){if(s==='#flash')return {};return s.includes('fighter')?{offsetLeft:s.includes('-p')?6:192,offsetWidth:176,offsetTop:52,offsetHeight:190}:null;},
    querySelectorAll(){return [{offsetTop:10,offsetHeight:40}];},insertBefore(c){arena.canvas=c;}};
  globalThis.window={matchMedia:()=>({matches:reduced})};
  globalThis.Image=class{naturalWidth=1254;naturalHeight=1254;
    set src(value){loads++;queueMicrotask(()=>imageFails?this.onerror():this.onload());}};
  globalThis.document={createElement:()=>({width:300,height:150,style:{},setAttribute(){},getContext:()=>canvasFails?null:ctx,remove(){removes++;}})};
  globalThis.performance={now:()=>now};
  globalThis.ResizeObserver=class{observe(){}disconnect(){disconnects++;}};
  globalThis.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};
  globalThis.cancelAnimationFrame=key=>frames.delete(key);
  globalThis.setTimeout=(fn,delay)=>{timers.set(++id,{fn,due:now+delay});return id;};
  globalThis.clearTimeout=key=>timers.delete(key);
  const mod=await import(moduleUrl+'?fixture='+Math.random());
  const advance=async time=>{
    now=time;
    for(const [key,entry] of [...timers])if(entry.due<=now){timers.delete(key);entry.fn();}
    const batch=[...frames];frames.clear();
    for(const [,fn] of batch)fn(now);
    await Promise.resolve();await Promise.resolve();
  };
  const fx=mod.createIgnisRain(arena);
  await Promise.resolve();await Promise.resolve();
  return {fx,arena,ctx,timers,frames,advance,mod,
    counts:()=>({loads,disconnects,removes})};
}

for(const speed of [1,2,4,8]){
  const e=await environment();
  let settled=false;
  const p=e.fx.strike('p',{index:1,speed}).then(()=>settled=true);
  await e.advance(110/speed-.01);assert.equal(settled,false);
  await e.advance(110/speed);await p;assert.equal(settled,true);
  await e.advance(1000);assert.equal(e.frames.size,0);assert.equal(e.timers.size,0);
  assert.equal(e.ctx.imageSmoothingEnabled,false);
  assert.equal(e.arena.canvas.width,187);assert.equal(e.arena.canvas.height,130);
  e.fx.dispose();assert.equal(e.counts().disconnects,1);
}
for(const kind of ['dispose','removed']){
  const e=await environment();
  const p=e.fx.strike('e');
  if(kind==='dispose')e.fx.dispose();
  else{e.arena.isConnected=false;await e.advance(1);}
  await p;
  assert.equal(e.frames.size,0);assert.equal(e.timers.size,0);
  assert.equal(e.counts().removes,1);assert.equal(e.counts().disconnects,1);
  e.fx.dispose();assert.equal(e.counts().removes,1,'Idempotent cleanup');
  await e.fx.strike('p');assert.equal(e.frames.size,0);assert.equal(e.timers.size,0);
}
for(const kind of ['imageFails','canvasFails']){
  const e=await environment({[kind]:true});
  let settled=false;
  const p=e.fx.strike('p').then(()=>settled=true);
  await e.advance(109);assert.equal(settled,false);
  await e.advance(110);await p;assert.equal(settled,true);
  assert.equal(e.ctx.calls.filter(c=>!c.clear).length,0);
  e.fx.dispose();assert.equal(e.frames.size,0);assert.equal(e.timers.size,0);
  if(kind==='imageFails'){await e.mod.loadIgnisRainAtlas();assert.equal(e.counts().loads,2,'Failed images may retry next battle');}
}
const reduced=await environment({reduced:true});
reduced.fx.cast('p');await reduced.advance(60);
assert.equal(reduced.ctx.calls.filter(c=>!c.clear).length,0);
const p=reduced.fx.strike('p');await reduced.advance(180);await p;
assert(reduced.ctx.calls.filter(c=>!c.clear).every(c=>c.cell===3));
reduced.fx.dispose();

console.log('Ignis Rain renderer passed: mirrored integer draw placement; misses; reduced/quiet mode; x1/x2/x4/x8 timing; expiry; resize; early disposal/removal; image/canvas failure without blocking battle.');
