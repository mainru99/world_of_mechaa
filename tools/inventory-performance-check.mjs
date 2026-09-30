import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {partWindow,PART_PAGE} from '../js/ui/part-window.js';
import {preloadSprites,assetPath,sprite} from '../js/sprites.js';
import {MONSTER_IDS} from '../js/units.js';
const source=readFileSync(new URL('../js/game.js',import.meta.url),'utf8');
function fn(name){const a=source.indexOf(`function ${name}(`),e=source.indexOf('\n}',a);assert.ok(a>=0&&e>=0);return source.slice(a,e+2);}
const parts=Array.from({length:1000},(_,i)=>({uid:`p${i}`,name:i===0?'最初 <무장>':'검수 무장',rarity:i%2?'SR':'R',enh:i%10,slot:'WEAPON'}));
const invF={slot:'',rar:'',fresh:'',sort:'new',query:'',page:0};
const state={parts,robots:[{slots:{WEAPON:'p999'}},{slots:{WEAPON:'p998'}}]};
let html='',focused='',scrolls=0;
const c=vm.createContext({S:state,invF,INV_PAGE:60,partWindow,RAR_ORDER:{R:1,SR:2},SLOTS:['WEAPON'],SLOT_KO:{WEAPON:'무장'},RARITY:[{k:'R'},{k:'SR'}],
 fmt:String,esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),isFresh:u=>u==='p0',freshCount:()=>1,
 enhClass:()=>'',enhCost:()=>10,enhRate:()=>1,enhMax:()=>10,scrapGain:()=>5,partIco:()=>'',freshTag:()=>'',rarTag:()=>'',setTag:()=>'',affixTags:()=>'',partStatLine:()=>'',loadout:{badge:()=>''},
 $:sel=>({disabled:sel==='#inv-next'&&invF.page===16,focus:()=>focused=sel,scrollIntoView:()=>scrolls++,querySelectorAll:()=>[]})});
const begin=source.indexOf('  const worn=new Set(',source.indexOf('function renderHangar('));
const end=source.indexOf('  const cost=lvCost(',begin);
assert.ok(begin>=0&&end>begin);
// Actual inventory generation from renderHangar, not a duplicate algorithm.
const matchAt=source.indexOf('const invMatch =');
vm.runInContext([source.slice(matchAt,source.indexOf(';',matchAt)+1),fn('sortInv'),fn('invBar'),fn('setInvF'),fn('invSearch'),fn('invPage'),`function renderHangar(){${source.slice(begin,end)}return invPager+'<div>'+inv+'</div>';}`].join('\n'),c);
const seen=new Set();
for(let page=0;page<17;page++){
 invF.page=page;html=c.renderHangar();
 const uids=[...html.matchAll(/data-part="(p\d+)"/g)].map(m=>m[1]);
 assert.ok(uids.length<=60);uids.forEach(uid=>seen.add(uid));
 assert.ok(!uids.includes('p999')&&!uids.includes('p998'),'worn parts excluded across all pages');
}
assert.equal(seen.size,998,'every spare UID reachable exactly through the paged pool');
invF.sort='enh';assert.equal(c.sortInv(parts)[0].enh,9);invF.sort='rar';assert.equal(c.sortInv(parts)[0].rarity,'SR');assert.equal(c.sortInv(parts)[0].enh,9);invF.sort='new';
invF.page=16;c.invPage(1);assert.equal(invF.page,16);assert.equal(focused,'#inv-position');assert.equal(scrolls,1);
c.invSearch('最初 R +0');html=c.renderHangar();assert.equal(invF.page,0);assert.match(html,/data-part="p0"/);assert.equal((html.match(/data-part=/g)||[]).length,1);assert.equal(focused,'#inv-query');
assert.match(html,/&lt;무장&gt;/);assert.match(html,/<button type="button" class="inv-enhance" onclick="ROWAR.enhance\('p0'\)/,'native keyboard button targets exact UID');
assert.match(html,/ROWAR.scrapPart\('p0'\)/,'scrap remains a separate action');
c.setInvF('rar','SR');html=c.renderHangar();assert.doesNotMatch(html,/data-part=/,'search and rarity apply together');
c.setInvF('rar','SR');c.invSearch('');assert.equal(invF.rar,'');
invF.page=16;state.parts=parts.slice(0,5);html=c.renderHangar();assert.equal(invF.page,0,'page clamps after server removes parts');assert.equal((html.match(/data-part=/g)||[]).length,5);
assert.equal(partWindow(parts).rows.length,PART_PAGE,'equip/fuse stay at 24');assert.equal(partWindow(parts,'',99,60).page,16);
const requested=[],previousImage=globalThis.Image;
try{
 globalThis.Image=class {set src(v){requested.push(v);}};
 preloadSprites();assert.equal(requested.length,0,'no all-unit warmup by default');
 preloadSprites(['ignis','ranger','ignis',undefined,'missing']);
 assert.deepEqual(requested,[assetPath('ignis'),assetPath('ranger')]);
 preloadSprites([MONSTER_IDS[0]]);assert.equal(requested.at(-1),assetPath(MONSTER_IDS[0]));
 assert.ok(!requested.some(p=>p.includes('undefined')||p.includes('missing')));
}finally{if(previousImage===undefined)delete globalThis.Image;else globalThis.Image=previousImage;}
assert.ok(!sprite('ignis',false).includes('.webp'));assert.ok(sprite('ignis',false,{idle:true}).includes('ignis-idle-10f.webp'));
console.log('Inventory/performance passed: 1,000 parts, every spare UID reachable, 60-card cap, combined full-pool search, equipped exclusion, removal clamp, native UID buttons, focus, 24-card equip/fuse unchanged, selective sprite preload/static-idle contract.');
