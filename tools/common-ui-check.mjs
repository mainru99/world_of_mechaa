import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {CONST} from '../data/balance.js';
import {fatRecoverMs} from '../js/stats.js';
import {raidDaily} from '../js/raid.js';
import {PRESET_MAX} from '../js/preset.js';
import {recruitmentPool,percentText} from '../js/ui/recruitment.js';
import {guideSections,guideView,commonMessage} from '../js/ui/common.js';
import {createModal} from '../js/ui/modal.js';

{
 const events={},locks=new Set(['ui-modal-open']);let closeCount=0,clearCount=0;
 const root={open:true,classList:{remove(){}},
  ownerDocument:{documentElement:{classList:{remove:key=>locks.delete(key)}}},
  addEventListener:(name,fn)=>{events[name]=fn;},
  close(){this.open=false;closeCount++;},replaceChildren(){clearCount++;}};
 const modal=createModal(root);modal.close();
 assert.equal(locks.size,0,'closing must release scrolling synchronously');
 assert.equal(clearCount,1);
 modal.close();assert.equal(closeCount,1,'closing an already closed view is harmless');
 root.open=true;events.close();
 assert.equal(clearCount,1,'a queued old close event must not clear the reopened view');
 let canceled=false;events.cancel({preventDefault(){canceled=true;}});
 assert.equal(canceled,true);assert.equal(root.open,false);
}

const sections=guideSections(),by=id=>sections.find(x=>x.id===id).body;
assert.equal(new Set(sections.map(x=>x.id)).size,sections.length);
for(const kind of ['core','credit','rcore']){
 const pool=recruitmentPool(kind),ep=pool.rarities.find(r=>r.k==='EP').percent;
 assert.ok(by('recruitment').includes(percentText(ep)));
 assert.ok(by('recruitment').includes(percentText(pool.robotPercent)));
}
assert.ok(by('recruitment').includes('전체 뽑기 1회 기준'));
assert.ok(by('recruitment').includes('등급 보장이나 천장은 없습니다'));
assert.ok(by('fatigue').includes((fatRecoverMs({level:1})/60000).toFixed(2)));
assert.ok(by('fatigue').includes((fatRecoverMs({level:CONST.MAXLV})/60000).toFixed(2)));
assert.ok(guideSections({on:false,unbind:1}).find(x=>x.id==='parts').body.includes(`공용 <b>${PRESET_MAX}개`));
assert.ok(by('parts').includes(`기체마다 프리셋 <b>${PRESET_MAX}개`));
assert.ok(by('parts').includes('기체 전용'));
assert.ok(!by('parts').includes('대가가 함께 커'));
assert.ok(by('challenge').includes(`<b>${raidDaily()}회`));
assert.ok(by('hangar').includes('선봉 1기'));
assert.ok(by('hangar').includes('순차 출전'));
assert.ok(by('dispatch').includes('편성 중인 기체도'));
assert.ok(by('territory').includes('기체끼리 내구를 주고받지는 않습니다'));
assert.ok(by('account').includes('진행도 서버에 저장'));
assert.ok(guideView('does-not-exist').includes('aria-current="page" onclick="ROWAR.guide(\'start\')"'));
assert.ok(!guideView('<img src=x onerror=1>').includes('<img src=x'));
assert.ok(commonMessage({title:'<img>',description:'<script>'}).includes('&lt;script&gt;'));

const source=await readFile(new URL('../js/game.js',import.meta.url),'utf8');
{
 let handler;
 const c=vm.createContext({_shieldUntil:Date.now()+60000,document:{addEventListener:(type,fn)=>{handler=fn;}}});
 const start=source.indexOf("document.addEventListener('click', e => {"),end=source.indexOf('\n}, true);',start);
 vm.runInContext(source.slice(start,end+'\n}, true);'.length),c);
 const event=detail=>({detail,blocked:false,stopPropagation(){this.blocked=true;},preventDefault(){this.blocked=true;}});
 const pointer=event(1);handler(pointer);assert.equal(pointer.blocked,true);
 const keyboard=event(0);handler(keyboard);assert.equal(keyboard.blocked,false,'explicit keyboard activation survives transitions');
 c._shieldUntil=0;const normal=event(1);handler(normal);assert.equal(normal.blocked,false);
}
function fn(name){
 const start=source.indexOf(`function ${name}(`),end=source.indexOf('\n}',start);
 assert.ok(start>=0&&end>=0,name);
 return source.slice(source.slice(start-6,start)==='async '?start-6:start,end+2);
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function territory(pending){
 const el={innerHTML:''},draws=[];
 const c=vm.createContext({commonMessage,_terrRequest:0,net:{state:{online:true,accountId:'a'},territory:()=>pending},
  $:()=>el,_terr:null,_terrAt:0,TERR_TTL:60000,_frontTab:'terr',cur:'terr',drawTerr:x=>draws.push(x)});
 vm.runInContext(fn('renderTerr'),c);return {c,el,draws};
}
{
 const t=territory(Promise.resolve(null));t.c.net.state.online=false;
 await t.c.renderTerr();assert.ok(t.el.innerHTML.includes('서버 연결이 필요합니다'));
}
{
 const d=deferred(),t=territory(d.promise),run=t.c.renderTerr();
 assert.ok(t.el.innerHTML.includes('role="status"'));
 d.resolve({error:'<bad-response>'});await run;
 assert.ok(t.el.innerHTML.includes('&lt;bad-response&gt;'));
 assert.ok(t.el.innerHTML.includes('ROWAR.enterTerritory()'));
}
for(const change of ['account','screen','tab']){
 const d=deferred(),t=territory(d.promise),run=t.c.renderTerr();
 if(change==='account')t.c.net.state.accountId='b';
 if(change==='screen')t.c.cur='hangar';
 if(change==='tab')t.c._frontTab='front';
 t.el.innerHTML='new-view';d.resolve({nodes:[]});await run;
 assert.equal(t.el.innerHTML,'new-view');assert.equal(t.draws.length,0);
}
{
 const parts=[{uid:'a',slot:'WEAPON',rarity:'SR'},{uid:'b',slot:'FRAME',rarity:'SR'}];
 const elements=parts.map(p=>({dataset:{uid:p.uid},disabled:false,attrs:{},
  style:{setProperty(){}},classList:{toggle(){},add(){},contains:()=>false},
  setAttribute(k,v){this.attrs[k]=v;}}));
 const grid={querySelectorAll:()=>elements};
 const c=vm.createContext({$:()=>grid,S:{parts},_fuseSel:['a'],_fuseHide:0,
  findPart:(u,ps)=>ps.find(p=>p.uid===u),fuseSel:()=>[parts[0]],
  fuseFits:(p,lock)=>p.slot===lock.slot&&p.rarity===lock.rarity,
  clearTimeout(){},setTimeout(){return 1;},paintFuse(){}});
 vm.runInContext(fn('syncFuse'),c);c.syncFuse();
 assert.equal(elements[0].attrs['aria-pressed'],'true');
 assert.equal(elements[0].disabled,false);
 assert.equal(elements[1].disabled,true,'filtered-out materials must not remain keyboard actionable');
}
console.log('Common UI passed: guide matches live probabilities/fatigue/mode limits; no fake guarantees; escaped errors; territory loading/retry and late response isolation.');
