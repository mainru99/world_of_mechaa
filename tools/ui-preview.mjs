/* Isolated UI review server. Never forwards requests or touches a real database.
 * node tools/ui-preview.mjs [port=8806]
 * Synthetic state is reset per server start and clearly identified in the page.
 */
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TERRITORY,SLOTS,MONSTER_TYPES,ROBOT_TYPES,CONST} from '../data/balance.js';
import {battleView} from '../js/ui/battle.js';
import {codexView,codexActivatable,codexRewards,codexTitles} from '../js/codex.js';
import {computeStats,power} from '../js/stats.js';
import {rollPart,rollPull,PULL_CUR} from '../js/gacha.js';
import {periodOf,periodEnd,refreshCost,rollShop,slotSig,shardNeed,shardKey,bagView} from '../js/shop.js';
import {mulberry32} from '../js/sim.js';
import {weekOf,weekEnd,trialOf,runTrial,TRIAL_WIN_BASE,trialWon} from '../js/trial.js';
import {raidOf,raidSeeds,runRaid,raidReward,raidDaily} from '../js/raid.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.argv[2]||8806);
// Explicit opt-in for disposable in-memory animation tests. No real API or DB.
const samplePulls=process.argv.includes('--sample-pulls');
// Opt-in disposable expedition cycle for UI verification. The three-second timer
// is deliberately shorter than production and never reaches a real API/DB.
const sampleDispatch=process.argv.includes('--sample-dispatch');
const sampleArchive=process.argv.includes('--sample-archive');
const sampleLogin=process.argv.includes('--sample-login');
const sampleLoginPullRetry=process.argv.includes('--sample-login-pull-retry');
const sampleShop=process.argv.includes('--sample-shop');
const sampleChallenge=process.argv.includes('--sample-challenge');
const sampleChallengeDelay=process.argv.includes('--sample-challenge-delay');
let previewFailPull=false;
let previewIdentity=sampleLogin?null:{id:'preview',guest:false,loginId:'지휘관_01'};
const previewToken='ui-preview-only';
let previewRev=1001;
const rng=mulberry32(20260920);
let nextId=0;
const parts=Array.from({length:12},(_,i)=>rollPart(32,rng,`preview-part-${++nextId}`,i<4?'SSR':'SR',SLOTS[i%4]));
const robots=['ignis','ranger','azure','mule','bastion'].map((type,i)=>({uid:`preview-robot-${i}`,type,level:i<2?32:24,exp:0,fat:i===1?12:0,fatAt:Date.now(),skillLv:2,slots:Object.fromEntries(SLOTS.map((slot,j)=>[slot,i<2?parts[i*4+j].uid:null]))}));
const state={v:2,credits:12460,cores:128,scrap:8320,robots,parts,sel:0,squad:robots.slice(0,2).map(x=>x.uid),stat:{wins:48,losses:12,pulls:80},campaign:'',items:{},presets:[]};
const sampleNewType=Object.keys(ROBOT_TYPES).find(type=>!robots.some(r=>r.type===type));
if(sampleShop){state.credits=250000;state.items[shardKey('ranger')]=shardNeed('ranger');state.items[shardKey(sampleNewType)]=Math.max(1,Math.floor(shardNeed(sampleNewType)*.55));}
let sampleShopState={p:periodOf(Date.now()),n:0,lv:32,b:[]};
const sampleShopView=()=>{const now=Date.now();if(sampleShopState.p!==periodOf(now))sampleShopState={p:periodOf(now),n:0,lv:32,b:[]};return {ok:true,server_now:now,endsAt:periodEnd(sampleShopState.p),stock:rollShop('preview',sampleShopState).map(x=>({...x,sold:sampleShopState.b.includes(x.i),sig:slotSig(x)})),refresh:refreshCost(sampleShopState.n,sampleShopState.lv),refreshed:sampleShopState.n,lv:sampleShopState.lv,items:state.items,bag:bagView(state.items,state.robots.map(r=>r.type)),credits:state.credits,cores:state.cores,scrap:state.scrap};};
const sampleNames=['화염선','서리날','검은별','새벽','철의창','푸른빛','황혼','정찰자','굉음','유성','북극성','지휘관_01','백야','선회','지평선','파도','적월','잔광','폭풍','등대','섬광','청동','산맥'];
const sampleRank=sampleNames.map((nickname,i)=>({rank:i+1,nickname,rating:2100-i*28,wins:i===11?48:90-i*3,losses:i===11?12:14+i*2,me:i===11,title:null}));
let challengeWeek=weekOf(Date.now()),sampleTrialMe=null,sampleRaidMe=null,sampleRaidTries=0,sampleRaidDamage=0;
const challengeTrialView=()=>({ok:true,week:challengeWeek,endsAt:weekEnd(challengeWeek),winBase:TRIAL_WIN_BASE,trial:trialOf(challengeWeek),top:sampleNames.slice(0,8).map((nickname,i)=>({rank:i+1,nickname,type:robots[i%robots.length].type,score:600000-i*55000,me:false})).concat(sampleTrialMe?[{...sampleTrialMe,nickname:'지휘관_01',me:true}]:[]),me:sampleTrialMe,total:8+(sampleTrialMe?1:0)});
const challengeRaidView=()=>{const r=raidOf(challengeWeek),base=Math.round(r.maxHp*.62),left=Math.max(0,r.maxHp-base-sampleRaidDamage);return {ok:true,week:r.week,endsAt:weekEnd(r.week),boss:r.boss,name:MONSTER_TYPES[r.boss].name,role:MONSTER_TYPES[r.boss].role,level:r.level,battleHp:r.battleHp,maxHp:r.maxHp,dealt:base+sampleRaidDamage,left,killed:!left,killer:!left?'지휘관_01':null,daily:raidDaily(),triesLeft:Math.max(0,raidDaily()-sampleRaidTries),me:sampleRaidMe,top:sampleNames.slice(0,8).map((nickname,i)=>({rank:i+1,nickname,damage:140000-i*14000,best:16000-i*1100,me:false})).concat(sampleRaidMe?[{...sampleRaidMe,rank:9,nickname:'지휘관_01',me:true}]:[]),joined:8+(sampleRaidMe?1:0)};};
const sampleMonsters=Object.keys(MONSTER_TYPES).filter(id=>MONSTER_TYPES[id].rarity==='C').slice(0,3);
const sampleCodex={ms:Object.fromEntries(sampleMonsters.map(id=>[id,30])),mk:Object.fromEntries(sampleMonsters.map(id=>[id,20])),r:{ignis:1,ranger:1},p:{},a:{['m:'+sampleMonsters[0]]:1},rf:{},c:{},t:null};
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
  // Isolated presentation fixture, no combat API or production route.
  if(url.pathname==='/__battle-layout'){
   const unit=rb=>({type:rb.type,level:rb.level,stats:computeStats(rb,parts),power:power(rb,parts)});
   const boss={type:Object.values(MONSTER_TYPES).find(t=>t.rarity==='BOSS').id,level:42,slots:{},fat:0};
   const view=battleView({allies:robots.slice(0,2).map(unit),enemies:[unit(boss)],playerName:'아군 편성 예시',playerMeta:'2기 배치 검수',enemyName:'보스 배치 예시',enemyMeta:'실제 전투 연결 전',brief:'<p>2:1 화면 배치 전용 예시입니다. 전투 엔진에 연결되지 않았습니다.</p>',costLabel:'검수 예시',rewardLabel:'보상 없음',actions:'<button class="bv-launch" disabled>배치 미리보기</button>'}).replace(/onclick="[^"]*"/g,'disabled');
   const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ROWAR · 2:1 배치 검수</title><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="themes/ui-v2.css"><link rel="stylesheet" href="themes/battle-v2.css"></head><body class="ui-v2"><div id="app"><div class="ui-preview-ribbon">2:1 배치 전용 검수 · 전투 엔진 미연결 / 운영과 무관</div><main><section class="screen active" id="sc-battle">${view}</section></main></div></body></html>`;
   res.writeHead(200,{'content-type':mime['.html'],'cache-control':'no-store'});res.end(html);return;
  }
  if(url.pathname.startsWith('/api/')){
   let raw='';for await(const c of req){raw+=c;if(raw.length>16384){json(res,413,{error:'too large'});return;}}
   let body={};try{body=raw?JSON.parse(raw):{};}catch{json(res,400,{error:'invalid json'});return;}
   if(url.pathname==='/api/health'){json(res,200,{ok:true,preview:true,schema_version:21});return;}
   if(sampleLogin&&url.pathname==='/api/auth/guest'&&req.method==='POST'){
    previewIdentity={id:'preview-guest',guest:true,loginId:null};json(res,200,{ok:true,token:previewToken});return;
   }
   if(sampleLogin&&url.pathname==='/api/auth/login'&&req.method==='POST'){
    if(body.login_id!=='tester'||body.password!=='password123'){json(res,401,{error:'아이디 또는 비밀번호가 맞지 않습니다'});return;}
    previewIdentity={id:'preview-member',guest:false,loginId:'tester'};
    previewFailPull=sampleLoginPullRetry;
    json(res,200,{ok:true,token:previewToken,account_id:previewIdentity.id,login_id:previewIdentity.loginId});return;
   }
   if(sampleLogin&&url.pathname==='/api/auth/register'&&req.method==='POST'){
    if(!previewIdentity?.guest||!req.headers.authorization){json(res,401,{error:'게스트 계정이 필요합니다'});return;}
    if(!/^[A-Za-z0-9_]{4,20}$/.test(body.login_id||'')||(body.password||'').length<8){json(res,400,{error:'아이디 또는 비밀번호 형식을 확인하세요'});return;}
    previewIdentity={id:'preview-guest',guest:false,loginId:body.login_id};
    json(res,200,{ok:true,login_id:previewIdentity.loginId});return;
   }
   if(sampleLogin&&url.pathname==='/api/auth/logout'&&req.method==='POST'){
    previewIdentity=null;json(res,200,{ok:true});return;
   }
   if(url.pathname==='/api/me'){
    if(sampleLogin&&(!previewIdentity||req.headers.authorization!==`Bearer ${previewToken}`)){json(res,401,{error:'not signed in'});return;}
    json(res,200,{ok:true,account_id:previewIdentity.id,guest:previewIdentity.guest,login_id:previewIdentity.loginId});return;
   }
   if(url.pathname==='/api/state'&&req.method==='GET'){
    if(sampleLogin&&(!previewIdentity||req.headers.authorization!==`Bearer ${previewToken}`)){json(res,401,{error:'not signed in'});return;}
    if(previewFailPull){previewFailPull=false;json(res,503,{error:'sample state retry'});return;}
    json(res,200,{ok:true,rev:previewRev,nickname:previewIdentity.loginId||'게스트',rating:1480,state,server_now:Date.now(),band:{i:2,pts:1},items:state.items,presets:[],...(sampleArchive?{codex:sampleCodex}:{})});return;
   }
   if(sampleArchive&&url.pathname==='/api/ranking'&&req.method==='GET'){
    json(res,200,{ok:true,top:sampleRank,me:{...sampleRank[11],rank:12,live:false},total:sampleRank.length,ranked_at:Date.now()-120000});return;
   }
   if(sampleArchive&&url.pathname==='/api/codex'){
    if(req.method==='GET'){json(res,200,{ok:true,codex:sampleCodex});return;}
    const view=()=>codexView(sampleCodex,state.robots,state.parts,'preview');
    if(body.action==='activate'){
     const act=codexActivatable(view(),body.keys==='all'?null:body.keys);
     if(!act.list.length||state.credits<act.total.cr||state.cores<act.total.co){json(res,400,{error:'not enough',need:act.total});return;}
     for(const x of act.list)sampleCodex.a[x.key]=1;
     state.credits-=act.total.cr;state.cores-=act.total.co;
     json(res,200,{ok:true,activated:act.list.map(x=>x.key),spent:act.total,credits:state.credits,cores:state.cores,rev:++previewRev});return;
    }
    if(body.action==='claim'){
     const due=codexRewards(view());
     if(!due.items.length){json(res,400,{error:'nothing to claim'});return;}
     for(const x of due.items)sampleCodex.c[x.key]=1;
     for(const key of due.refundKeys)sampleCodex.rf[key]=1;
     state.credits+=due.total.cr;state.cores+=due.total.co;
     json(res,200,{ok:true,claimed:due.items,refunded:due.refundKeys.length,total:due.total,credits:state.credits,cores:state.cores,rev:++previewRev});return;
    }
    if(body.action==='title'){
     const id=body.id||null;
     if(id&&!codexTitles(view()).some(x=>x.id===id&&x.got)){json(res,400,{error:'title locked'});return;}
     sampleCodex.t=id;json(res,200,{ok:true,title:id});return;
    }
   }
   if(sampleShop&&url.pathname==='/api/shop'){
    if(req.method==='GET'){json(res,200,sampleShopView());return;}
    const current=sampleShopView();
    if(body.action==='buy'){
     const x=current.stock.find(s=>s.i===body.slot);
     if(!x||x.sold||x.sig!==body.sig){json(res,409,{error:'stock changed'});return;}
     if(state.credits<x.price){json(res,400,{error:'not enough credits',need:x.price});return;}
     state.credits-=x.price;sampleShopState.b.push(x.i);
     if(x.kind==='part')state.parts.push(x.part);
     if(x.kind==='shard')state.items[shardKey(x.type)]=(state.items[shardKey(x.type)]||0)+x.qty;
     if(x.kind==='scrap')state.scrap+=x.qty;
     if(x.kind==='core')state.cores+=x.qty;
     json(res,200,{...sampleShopView(),bought:x,rev:++previewRev});return;
    }
    if(body.action==='refresh'){
     if(state.credits<current.refresh){json(res,400,{error:'not enough credits',need:current.refresh});return;}
     state.credits-=current.refresh;sampleShopState={...sampleShopState,n:sampleShopState.n+1,b:[]};
     json(res,200,{...sampleShopView(),spent:current.refresh,rev:++previewRev});return;
    }
    if(body.action==='assemble'){
     const type=body.type,need=shardNeed(type),have=state.items[shardKey(type)]||0;
     if(!ROBOT_TYPES[type]||!need||have<need){json(res,400,{error:'not enough shards',need,have});return;}
     state.items[shardKey(type)]=have-need;if(!state.items[shardKey(type)])delete state.items[shardKey(type)];
     const dupe=state.robots.some(r=>r.type===type),gain=dupe?CONST.DUPE_GAIN[ROBOT_TYPES[type].rarity]:null;
     let uid=null;if(dupe){state.credits+=gain.cr;state.scrap+=gain.sc;state.cores+=gain.co;}else{uid=`preview-shop-${++nextId}`;state.robots.push({uid,type,level:1,exp:0,fat:0,skillLv:0,slots:Object.fromEntries(SLOTS.map(s=>[s,null]))});}
     json(res,200,{...sampleShopView(),assembled:{type,uid,dupe,gain},rev:++previewRev});return;
    }
    json(res,400,{error:'unknown action'});return;
   }
   if(sampleChallenge&&['/api/trial','/api/raid'].includes(url.pathname)){
    if(sampleChallengeDelay)await new Promise(r=>setTimeout(r,1500));
    const week=weekOf(Date.now());if(week!==challengeWeek){challengeWeek=week;sampleTrialMe=sampleRaidMe=null;sampleRaidTries=sampleRaidDamage=0;}
    const raid=url.pathname==='/api/raid',view=raid?challengeRaidView:challengeTrialView;
    if(req.method==='GET'){json(res,200,view());return;}
    if(req.method!=='POST'){json(res,405,{error:'method not allowed'});return;}
    if(!raid){
     const robot=state.robots[state.sel],stats=computeStats(robot,state.parts),t=trialOf(challengeWeek),out=runTrial(stats,t,'none');
     const best=Math.max(sampleTrialMe?.score||0,out.score);
     sampleTrialMe={score:best,type:robot.type,power:power(robot,state.parts),tries:(sampleTrialMe?.tries||0)+1,rank:1+challengeTrialView().top.filter(x=>!x.me&&x.score>=best).length};
     json(res,200,{...view(),score:out.score,win:trialWon(out.score),robot,parts:state.parts,stats,foe:out.foe});return;
    }
    const before=view();if(!before.triesLeft||before.killed){json(res,400,{error:before.killed?'raid already down':'no tries left'});return;}
    const rules=raidOf(challengeWeek),team=state.squad.map(uid=>state.robots.find(r=>r.uid===uid)).filter(Boolean),mechs=team.map(robot=>({uid:robot.uid,type:robot.type,level:robot.level,name:ROBOT_TYPES[robot.type].name,power:power(robot,state.parts),stats:computeStats(robot,state.parts)}));
    const seeds=raidSeeds(challengeWeek,1,++sampleRaidTries,mechs.length),out=runRaid(mechs,rules,seeds),damage=Math.min(before.left,out.damage),reward=raidReward(damage,rules.baseHp,32);
    sampleRaidDamage+=damage;sampleRaidMe={damage:sampleRaidDamage,best:Math.max(sampleRaidMe?.best||0,damage),tries:sampleRaidTries};state.credits+=reward.cr;state.scrap+=reward.sc;
    json(res,200,{...view(),damage,raw:out.damage,reward,kill:damage>=before.left,credits:state.credits,scrap:state.scrap,mechs,seeds,tries:sampleRaidTries,foe:{type:rules.boss,level:rules.level,stats:rules.stats}});return;
   }
   if(samplePulls&&url.pathname==='/api/pull'&&req.method==='POST'){
    const count=body.count,currency=body.cur,config=PULL_CUR[currency];
    if(![1,10].includes(count)||!config){json(res,400,{error:'invalid sample request'});return;}
    const wallet=currency==='credit'?'credits':'cores';
    if(state[wallet]<count*config.cost){json(res,400,{error:'not enough '+wallet});return;}
    state[wallet]-=count*config.cost;
    const owned=new Set(state.robots.map(r=>r.type)),results=[];
    for(let i=0;i<count;i++){
     const r=rollPull(owned,32,rng,()=>`preview-reward-${++nextId}`,currency);
     if(r.kind==='robot'){r.uid=`preview-robot-${++nextId}`;owned.add(r.type);state.robots.push({uid:r.uid,type:r.type,level:1,exp:0,fat:0,skillLv:0,slots:Object.fromEntries(SLOTS.map(s=>[s,null]))});}
     else if(r.kind==='part')state.parts.push(r.part);
     else if(r.kind==='dupe'){state.credits+=r.gain.cr;state.cores+=r.gain.co;state.scrap+=r.gain.sc;}
     else if(r.kind==='core')state.cores+=r.n;
     else if(r.kind==='credit')state.credits+=r.cr;
     else if(r.kind==='scrap')state.scrap+=r.n;
     results.push(r);
    }
    state.stat.pulls+=count;
    json(res,200,{ok:true,rev:++previewRev,results,credits:state.credits,cores:state.cores,scrap:state.scrap});return;
   }
   if(sampleDispatch&&url.pathname==='/api/expedition'&&req.method==='POST'){
    if(body.action==='send'){
     const robot=state.robots.find(r=>r.uid===body.robotUid);
     if(!robot||!['SHORT','LONG','DEEP'].includes(body.tier)||state.expd||state.robots.length<2){json(res,400,{error:'invalid sample dispatch'});return;}
     state.expd={tier:body.tier,uid:robot.uid,level:robot.level,endsAt:Date.now()+3000};
     state.squad=state.squad.filter(uid=>uid!==robot.uid);
     if(!state.squad.length)state.squad=[state.robots.find(r=>r.uid!==robot.uid).uid];
     json(res,200,{ok:true,rev:++previewRev,endsAt:state.expd.endsAt,squadChanged:true});return;
    }
    if(body.action==='claim'){
     if(!state.expd||Date.now()<state.expd.endsAt){json(res,400,{error:'sample expedition not ready'});return;}
     const cr=200,sc=40;state.credits+=cr;state.scrap+=sc;state.expd=null;
     json(res,200,{ok:true,rev:++previewRev,player:{credits:state.credits,cores:state.cores,scrap:state.scrap},reward:{cr,sc,core:0,part:null}});return;
    }
   }
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
   const bootstrap=`<script>${sampleLogin?"localStorage.removeItem('rowar.session');":"localStorage.setItem('rowar.session','ui-preview-only');"}localStorage.setItem('rowar.mig_closed','1');localStorage.setItem('rowar.rev','1000');localStorage.setItem('rowar.save.v2',${JSON.stringify(seed)});</script>`;
   content=content.toString().replace('<body class="ui-v2"',`${bootstrap}<body class="ui-v2"`).replace('<div id="app">',`<div id="app"><div class="ui-preview-ribbon">${sampleChallenge?'샘플 주간 도전 검수 · 가상 기록/재화 / 운영 계정과 무관합니다':sampleLogin?'샘플 로그인 검수 · 가상 계정 / tester · password123 / 운영 계정과 무관합니다':sampleArchive?'샘플 랭킹·도감 검수 · 가상 기록 / 운영 계정과 무관합니다':sampleDispatch?'샘플 파견 검수 · 가상 재화 / 3초 원정 / 운영 계정과 무관합니다':samplePulls?'샘플 뽑기 검수 · 가상 재화 / 운영 계정과 무관합니다':sampleShop?'샘플 보급 상점 검수 · 가상 진열/재화 / 운영 계정과 무관합니다':'로컬 디자인 미리보기 · 예시 계정 / 운영 데이터와 연결되지 않습니다'}</div>`);
  }
  res.writeHead(200,{'content-type':mime[extname(file)],'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(content);
 }catch(e){res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`ROWAR isolated UI preview http://127.0.0.1:${port} · synthetic account · ${sampleChallenge?'in-memory sample challenge enabled':sampleLogin?'in-memory sample login enabled':sampleArchive?'in-memory sample archive enabled':sampleDispatch?'in-memory sample expedition enabled':samplePulls?'in-memory sample pulls enabled':sampleShop?'in-memory sample shop enabled':'spending/claiming disabled'}`));
