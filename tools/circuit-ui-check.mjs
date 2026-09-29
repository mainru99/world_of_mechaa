import assert from 'node:assert/strict';
import {CIRCUIT_LAYOUT} from '../data/circuit_layout.js';
import {ROBOT_TYPES} from '../data/balance.js';
import {drawCircuitSvg} from '../js/ui/circuit-svg.js';
import {circuitView} from '../js/ui/circuit-view.js';
import {createCircuitManager} from '../js/ui/circuit-manager.js';
class El{
 constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.attrs={};this.children=[];this.handlers={};}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
 appendChild(e){this.children.push(e);}set textContent(v){this.children=[];this.text=v;}
 addEventListener(k,fn){this.handlers[k]=fn;}focus(){this.ownerDocument.activeElement=this;}
 get dataset(){return {id:this.attrs['data-id']};}
 querySelectorAll(sel){const out=[];const visit=e=>{for(const c of e.children){if(sel==='.star'&&c.attrs.class==='star')out.push(c);visit(c);}};visit(this);return out;}
}
function documentStub(){
 const doc={activeElement:null,html:'',createElementNS:(ns,tag)=>new El(tag,doc),getElementById:()=>null};
 doc.svg=new El('svg',doc);doc.wallet={};doc.input={value:'1'};doc.cost={};doc.submit={};
 doc.querySelector=s=>s==='#cv-svg'?doc.svg:s==='#w-rcore'?doc.wallet:s==='#cv-refine-n'?doc.input:s==='#cv-refine-cost'?doc.cost:s==='#cv-refine-submit'?doc.submit:
 s==='#modal[open] .cv-app'?doc.html.includes('class="cv-app"')?{}:null:s==='#modal[open] .cv-refine'?doc.html.includes('class="cv-refine"')?{}:null:null;
 return doc;
}
const snapshot=JSON.stringify(CIRCUIT_LAYOUT);
for(const [type,L] of Object.entries(CIRCUIT_LAYOUT)){
 const doc=documentStub();drawCircuitSvg(doc.svg,{type,taken:['A1'],level:60,selected:'A1',onSelect(){}});
 const nodes=doc.svg.querySelectorAll('.star');assert.equal(nodes.length,36,type);
 for(const node of nodes){const id=node.dataset.id,coords=L[id[0]][id.endsWith('*')?8:Number(id.slice(1))-1];
  assert.equal(Number(node.children.find(c=>c.tag==='circle').attrs.cx),coords[0]);assert.equal(Number(node.children.find(c=>c.tag==='circle').attrs.cy),coords[1]);}
 assert.equal(nodes[0].attrs['data-state'],'taken');
}
assert.equal(JSON.stringify(CIRCUIT_LAYOUT),snapshot,'all original/manual coordinates are immutable');
const robot=uid=>({uid,type:'ignis',level:32,exp:0,fat:0,slots:{},circuit:[]});
const defer=()=>{let resolve;return {p:new Promise(r=>resolve=r),resolve};};
function setup(){
 const doc=documentStub(),a=robot('a'),b={...robot('b'),type:'ranger'},owner={robots:[a,b],parts:[],cores:50,credits:100},post=defer(),events=[];
 let state=owner,inspected=a;
 const net={state:{accountId:'A',online:true},circuit:async(...args)=>{events.push(['request',...args]);return post.p;},refine:async n=>{events.push(['refine',n]);return post.p;},pull:async()=>null};
 const manager=createCircuitManager({document:doc,state:()=>state,robot:()=>inspected,net,openModal:html=>doc.html=html,commit:()=>events.push(['commit']),toast:m=>events.push(['toast',m])});
 manager.adopt({rcores:2});manager.actions.openCircuit();
 return {doc,a,b,owner,post,events,net,manager,A:manager.actions,changeState:()=>state={},inspectB:()=>inspected=b};
}
const answer={taken:['A1'],rcores:2};
for(const change of ['inspect','close','account','state',null]){
 const t=setup();t.A.circuitDraft();assert.equal(t.a.circuit.length,0,'draft is not saved state');
 const p=t.A.circuitSave();await t.A.circuitSave();assert.equal(t.events.filter(e=>e[0]==='request').length,1);
 if(change==='inspect')t.inspectB();if(change==='close')t.doc.html='';if(change==='account')t.net.state.accountId='B';if(change==='state')t.changeState();
 t.post.resolve(answer);await p;
 assert.equal(t.a.circuit.length,['account','state'].includes(change)?0:1);
 assert.equal(t.b.circuit.length,0,'saved target UID cannot drift to inspected unit');
 if(change==='close')assert.equal(t.doc.html,'','completion cannot reopen closed modal');
 assert.equal(t.events[0][2],'a');
}
{
 const t=setup();t.A.circuitSelect('A2');t.A.circuitDraft();assert.ok(t.doc.html.includes('미저장 0'),'cannot select a child before its parent');
 t.A.circuitSelect('A1');t.A.circuitDraft();t.A.circuitSelect('A2');t.A.circuitDraft();t.A.circuitSelect('A1');t.A.circuitDraft();
 assert.ok(t.doc.html.includes('갈래 끝의 선택부터'),'draft prerequisite cannot be removed under a child');
 t.A.circuitDiscard();assert.ok(t.doc.html.includes('미저장 선택을 취소'));
}
{
 const t=setup();t.a.circuit=['A1'];t.A.openCircuit();t.A.circuitResetAsk();assert.equal(t.events.length,0,'warning precedes reset');
 const p=t.A.circuitResetConfirm();t.post.resolve({taken:[],rcores:1,spent:1});await p;assert.deepEqual(t.a.circuit,[]);assert.equal(t.manager.balance(),1);
}
{
 const t=setup();t.A.openRefine();t.doc.input.value='1.5';await t.A.refineSubmit();assert.equal(t.events.length,0);
 t.doc.input.value='2';const p=t.A.refineSubmit();await t.A.refineSubmit();assert.equal(t.events.filter(e=>e[0]==='refine').length,1);
 t.post.resolve({cores:30,rcores:4,made:2,spent:20});await p;assert.equal(t.owner.cores,30);assert.equal(t.manager.balance(),4);
}
{
 const t=setup();t.A.openRefine();const p=t.A.refineSubmit();t.net.state.accountId='B';t.post.resolve({cores:40,rcores:3,made:1,spent:10});await p;
 assert.equal(t.owner.cores,50);assert.equal(t.manager.balance(),null,'new account never sees old refined balance');
}
{
 const t=setup();t.A.circuitDraft();const p=t.A.circuitSave();t.post.resolve({error:'bad stars',why:'포인트 부족'});await p;
 assert.equal(t.a.circuit.length,0);assert.equal(t.manager.busy(),false);assert.ok(t.doc.html.includes('포인트 부족'));
}
for(const action of ['circuit','refine']){
 const t=setup(),refresh=defer();t.net.pull=()=>refresh.p;
 if(action==='circuit')t.A.circuitDraft();else t.A.openRefine();
 const p=action==='circuit'?t.A.circuitSave():t.A.refineSubmit();t.post.resolve({error:'connection failed'});
 await Promise.resolve();await Promise.resolve();assert.equal(t.manager.busy(),true,'failure refresh must keep the write guard');
 await t.A.refineSubmit();assert.equal(t.events.filter(e=>e[0]==='request'||e[0]==='refine').length,1);
 refresh.resolve(null);await p;assert.equal(t.manager.busy(),false);
}
{
 const html=circuitView({robot:robot('a'),parts:[],draft:['A1'],selected:'A1',rcores:0,online:false});
 assert.ok(html.includes('오프라인에서는 확인만'));assert.ok(html.includes('→'));assert.ok(html.includes('미저장 1'));
 const oldName=ROBOT_TYPES.ignis.name;ROBOT_TYPES.ignis.name='<script>bad</script>';
 try{assert.ok(!circuitView({robot:robot('a'),parts:[],rcores:0,online:true}).includes('<script>'));}finally{ROBOT_TYPES.ignis.name=oldName;}
}
console.log('Circuit UI passed: all 76 approved layouts/36 nodes; immutable coordinates; draft prerequisites; captured UID; duplicate guards; navigation/account isolation; reset warning; refined currency authority; preview effects/escaping.');
