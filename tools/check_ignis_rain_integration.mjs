import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=process.argv[2]||path.resolve(here,'..');
const gamePath=process.argv[3]||path.join(repo,'js/game.js');
const source=fs.readFileSync(gamePath,'utf8');
const begin=source.indexOf('async function playBattle(events,P,E,o){');
const end=source.indexOf('function renderResult(',begin);
assert(begin>0&&end>begin);
const playback=source.slice(begin,end);
const { COMBAT_TYPES }=await import(pathToFileURL(path.join(repo,'js/units.js')));
const { simulate, makeUnit }=await import(pathToFileURL(path.join(repo,'js/sim.js')));
const basic=(type='ignis')=>({type,name:type,maxhp:3000});
const hit=(side='P',miss=false)=>({t:'hit',side,dside:side==='P'?'E':'P',miss,crit:!miss,dmg:50,thp:2950});
const skill=(side='P',name='이그니스 레인')=>({t:'skill',side,name});
const finish={t:'end',winner:'P'};

async function run(events,P=basic(),E=basic('mule'),hooks={},speed=1){
  const calls=[];
  const state={arena:{isConnected:true},sleeps:0};
  // playBattle 은 모듈 바깥의 _skipReplay 를 읽는다. 잘라 온 조각에는 선언이 없으므로
  // 여기서 세워 준다 — 빠지면 ReferenceError 로 검사가 통째로 죽는다(실제로 그랬다).
  const ctx={COMBAT_TYPES,cur:'battle',battleSpeed:speed,_skipReplay:false,
    document:{getElementById:()=>state.arena},
    setHP:(...v)=>calls.push(['hp',...v]), setSP:(...v)=>calls.push(['sp',...v]),
    blog:v=>calls.push(['log',v]), banner:v=>calls.push(['banner',v]),
    shakeF:v=>calls.push(['shake',v]), floatDmg:(...v)=>calls.push(['float',...v]),
    flash:()=>calls.push(['flash']),
    sleep:async ms=>{ calls.push(['sleep',ms]); await hooks.sleep?.({ms,n:++state.sleeps,ctx,state,calls}); },
    lunge:async side=>{ calls.push(['lunge',side]); await hooks.lunge?.({ctx,state,calls}); },
    createIgnisRain:arena=>{
      assert.equal(arena,state.arena); calls.push(['create']);
      return {cast:side=>calls.push(['cast',side]),
        strike:async(side,options)=>{calls.push(['strike',side,options]); await hooks.strike?.({side,options,ctx,state,calls});},
        dispose:()=>calls.push(['dispose'])};
    }
  };
  vm.createContext(ctx);
  vm.runInContext(playback+'\nglobalThis.testPlay=playBattle;',ctx);
  const result=await ctx.testPlay(events,P,E);
  return {calls,result,ctx,state};
}
const of=(r,tag)=>r.calls.filter(c=>c[0]===tag);

// Both attacker directions, a miss between hits, and a normal attack immediately after the skill.
for(const side of ['P','E']){
  const casts=[skill(side),...Array.from({length:5},(_,i)=>hit(side,i===2)),{t:'turn',side,sp:30},hit(side),finish];
  const r=await run(casts,basic(side==='P'?'ignis':'mule'),basic(side==='E'?'ignis':'mule'));
  assert.equal(r.result,'P');
  assert.equal(of(r,'strike').length,5);
  assert.deepEqual(of(r,'strike').map(c=>c[1]),Array(5).fill(side.toLowerCase()));
  assert.deepEqual(of(r,'strike').map(c=>c[2].index),[0,1,2,3,4]);
  assert.equal(of(r,'strike')[2][2].miss,true);
  assert.equal(of(r,'lunge').length,1);
  assert.equal(of(r,'flash').length,1);
  assert.equal(of(r,'shake').length,5);
  assert.equal(of(r,'dispose').length,1);
}

// A matching translated name on another unit must not activate the Ignis effect.
const other=await run([skill('P'),hit(),finish],basic('mule'),basic('ignis'));
assert.equal(of(other,'strike').length,0);
assert.equal(of(other,'cast').length,0);
assert.equal(of(other,'lunge').length,1);
assert.equal(of(other,'flash').length,1);

// Turn boundaries, interrupted sequences, and the fifth hit cap cannot leak the effect onto normals.
for(const events of [
  [skill(),hit(),{t:'turn',side:'P',sp:30},hit(),finish],
  [skill(),hit(),hit('E'),hit(),finish],
  [skill(),hit(),skill('E','다른 스킬'),hit('E'),hit(),finish],
  [skill(),...Array.from({length:6},()=>hit()),finish]
]){
  const r=await run(events);
  assert.equal(of(r,'strike').length,events.length===8?5:1);
}

// Real deterministic sim sequences include short KO skills, misses, heals and both directions.
for(const types of [['ignis','mule'],['mule','ignis'],['ignis','ignis'],['mule','mule']]){
  for(const seed of [1,29,717]){
    const st={hp:1800,atk:92,def:140,spd:12,crit:.2,eva:.28,spread:.15};
    const P=makeUnit(types[0],types[0],st), E=makeUnit(types[1],types[1],{...st,spd:11});
    const events=simulate(P,E,seed);
    const snapshot=JSON.stringify(events);
    const r=await run(events,P,E);
    // 흘려내기(2026-09-21) — 친 쪽이 돌진했다 튕겨 나가므로 돌진 1 · 흔들림 1 이 더 붙는다
    let active=null, expected=0, ordinary=0, flashes=0, hits=0;
    for(const e of events){
      if(e.t==='parry'){ ordinary++; hits++; }
      if(e.t==='turn') active=null;
      if(e.t==='skill') active=(e.side==='P'?P:E).type==='ignis'?e.side:null;
      if(e.t==='hit'){
        if(active===e.side) expected++; else {ordinary++; if(!e.miss) flashes++;}
        if(!e.miss) hits++;
      }
    }
    assert.equal(r.result,events.at(-1).winner);
    assert.equal(of(r,'strike').length,expected);
    assert.equal(of(r,'lunge').length,ordinary);
    assert.equal(of(r,'flash').length,flashes);
    assert.equal(of(r,'shake').length,hits);
    assert.equal(JSON.stringify(events),snapshot,'Visual playback must not mutate battle events');
    assert.equal(of(r,'create').length,types.includes('ignis')?1:0);
    assert.equal(of(r,'dispose').length,types.includes('ignis')?1:0);
  }
}

// A speed change during the banner is used for subsequent strikes and waits.
const sped=await run([skill(),hit(),finish],basic(),basic('mule'),{
  // 실시간 재생(2026-09-21)부터 스킬 배너에 고정 520ms 대기가 없다 — 두 번째 기다림(타격 직전)에 배속을 바꾼다
  sleep:({n,ctx})=>{if(n===2)ctx.battleSpeed=4;}
});
assert.equal(of(sped,'strike')[0][2].speed,4);
assert(of(sped,'sleep').some(c=>c[1]===75));

// Leaving while asleep or awaiting an impact returns null and cannot update the new arena.
for(const mode of ['initial','banner','strike-hidden','strike-replaced','lunge-replaced','end']){
  const hooks={};
  const events=mode==='lunge-replaced'?[hit(),finish]:[skill(),hit(),finish];
  if(mode==='strike-hidden')hooks.strike=({ctx})=>{ctx.cur='hangar';};
  if(mode==='strike-replaced')hooks.strike=({state})=>{state.arena={isConnected:true};};
  if(mode==='lunge-replaced')hooks.lunge=({state})=>{state.arena={isConnected:true};};
  if(mode==='initial'||mode==='banner'||mode==='end')hooks.sleep=({n,ctx})=>{
    if(n===(mode==='initial'?1:mode==='banner'?2:4))ctx.cur='hangar';
  };
  const r=await run(events,basic(),basic('mule'),hooks);
  assert.equal(r.result,null,mode);
  assert.equal(of(r,'dispose').length,1,mode);
  if(mode!=='end')assert.equal(of(r,'hp').length,2,mode+' must not publish late damage');
}

// 건너뛰기 — 남은 재생을 접고도 최종 체력을 다 쓰고, 효과를 놓고, 승자를 그대로 돌려준다.
const skipped=await run([skill(),hit(),hit(),hit(),finish],basic(),basic('mule'),{
  sleep:({n,ctx})=>{if(n===3)ctx._skipReplay=true;}
});
assert.equal(skipped.result,'P','건너뛰어도 승자는 서버가 정한 그대로다');
assert.equal(of(skipped,'strike').length,1,'건너뛴 뒤로는 연출이 더 돌지 않는다');
assert.equal(of(skipped,'dispose').length,1,'건너뛰기도 finally 를 지나 효과를 놓는다');
assert.equal(of(skipped,'hp').length,6,'남은 타격의 최종 체력을 한 번에 그린다');
assert(of(skipped,'log').some(c=>String(c[1]).includes('건너뜀')));

// Unexpected rendering errors still release the effect owner.
let disposed=0;
const ctx={cur:'battle',document:{getElementById:()=>arena},createIgnisRain:()=>({dispose:()=>disposed++}),setHP:()=>{throw Error('fixture');}};
const arena={isConnected:true};
vm.createContext(ctx); vm.runInContext(playback+'\nglobalThis.testPlay=playBattle;',ctx);
await assert.rejects(ctx.testPlay([],basic(),basic('mule')),/fixture/);
assert.equal(disposed,1);

assert(source.includes("from './ignis-rain.js?v=20260913-ignis-rain1'"));
assert(source.includes('${sprite(pType,true)}')&&source.includes('${sprite(eType,false)}'));
assert.equal((source.match(/\{\s*idle:\s*true\s*\}/g)||[]).length,1,'Only the large hangar opts in to idle art');
console.log('Ignis Rain integration passed: 12 real sim streams; both sides; misses; normal and other skills; hit cap; 6 cancellation paths; skip; speed; cleanup; static battle sprites.');
