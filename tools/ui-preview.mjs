/* Isolated UI review server. Never forwards requests or touches a real database.
 * node tools/ui-preview.mjs [port=8806]
 * Synthetic state is reset per server start and clearly identified in the page.
 */
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TERRITORY,SLOTS} from '../data/balance.js';
import {rollPart} from '../js/gacha.js';
import {mulberry32} from '../js/sim.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.argv[2]||8806);
const rng=mulberry32(20260920);
let nextId=0;
const parts=Array.from({length:12},(_,i)=>rollPart(32,rng,`preview-part-${++nextId}`,i<4?'SSR':'SR',SLOTS[i%4]));
const robots=['ignis','ranger','azure','mule','bastion'].map((type,i)=>({uid:`preview-robot-${i}`,type,level:i<2?32:24,exp:0,fat:i===1?12:0,fatAt:Date.now(),skillLv:2,slots:Object.fromEntries(SLOTS.map((slot,j)=>[slot,i<2?parts[i*4+j].uid:null]))}));
const state={v:2,credits:12460,cores:128,scrap:8320,robots,parts,sel:0,squad:robots.slice(0,2).map(x=>x.uid),stat:{wins:48,losses:12,pulls:80},campaign:'',items:{},presets:[]};
const nodes=TERRITORY.map((n,i)=>{
  const owner=[0,3,6].includes(i)?'me':[1,4,7,8].includes(i)?'other':null;
  return {id:n.id,owner,ownerName:owner==='me'?'지휘관_01':owner?'ARES':null,lines:n.mon.length+(owner?1:0),hp:Array.from({length:n.mon.length+(owner?1:0)},(_,j)=>i===5?(j===0?0:.72):1),pw:1700+n.lv*140,lv:n.lv,minLv:n.minLv,locked:n.minLv>32,protectUntil:i===4?Date.now()+45*60000:null,...(owner==='me'?{income:{cr:n.crH*4,sc:n.scH*4,core:0,h:4}}:{})};
});
let pending={cr:0,sc:0,core:0};for(const n of nodes)if(n.owner==='me'){pending.cr+=n.income.cr;pending.sc+=n.income.sc;}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
const json=(res,code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/')){
   let raw='';for await(const c of req){raw+=c;if(raw.length>16384){json(res,413,{error:'too large'});return;}}
   let body={};try{body=raw?JSON.parse(raw):{};}catch{json(res,400,{error:'invalid json'});return;}
   if(url.pathname==='/api/health'){json(res,200,{ok:true,preview:true,schema_version:21});return;}
   if(url.pathname==='/api/me'){json(res,200,{ok:true,account_id:'preview',guest:false,login_id:'지휘관_01'});return;}
   if(url.pathname==='/api/state'&&req.method==='GET'){json(res,200,{ok:true,rev:1001,nickname:'지휘관_01',rating:1480,state,server_now:Date.now(),band:{i:2,pts:1},items:{},presets:[]});return;}
   if(url.pathname==='/api/territory'&&body.action==='view'){json(res,200,{ok:true,nodes,mine:3,pending,world:{avgPower:8500},myLv:32,at:Date.now()});return;}
   json(res,403,{error:'로컬 디자인 미리보기에서는 재화를 사용하거나 보상을 수령하지 않습니다'});return;
  }
  const name=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
  const allowed=name==='/index.html'||name==='/style.css'||/^\/(assets|js|data|themes)\//.test(name);
  const file=resolve(root,'.'+name);
  if(!allowed||!file.startsWith(root+sep)||!mime[extname(file)]||!(await stat(file)).isFile()){res.writeHead(404);res.end('Not found');return;}
  let content=await readFile(file);
  if(name==='/index.html'){
   const seed=JSON.stringify(state).replaceAll('<','\\u003c');
   const bootstrap=`<script>localStorage.setItem('rowar.session','ui-preview-only');localStorage.setItem('rowar.mig_closed','1');localStorage.setItem('rowar.rev','1000');localStorage.setItem('rowar.save.v2',${JSON.stringify(seed)});</script>`;
   content=content.toString().replace('<body class="ui-v2"',`${bootstrap}<body class="ui-v2"`).replace('<div id="app">','<div id="app"><div class="ui-preview-ribbon">로컬 디자인 미리보기 · 예시 계정 / 운영 데이터와 연결되지 않습니다</div>');
  }
  res.writeHead(200,{'content-type':mime[extname(file)],'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(content);
 }catch(e){res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`ROWAR isolated UI preview http://127.0.0.1:${port} · synthetic account · spending/claiming disabled`));
