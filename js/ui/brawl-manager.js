import {act} from '../brawl.js';
import {brawlView,brawlPhase} from './brawl-view.js';
import {replayState,applyReplayEvent} from './brawl-replay.js';
import {createCombatAudio} from '../audio-events.js';
import {playBrawlStage} from './brawl-stage.js';

const ERRORS={'offline':'서버에 연결되어 있지 않습니다.','brawl off':'운영 서버에서 아직 난투가 열리지 않았습니다.','gold':'난투 골드가 부족합니다.','full':'전투 배치와 대기석이 가득 찼습니다.','limit':'이 기체의 보유 한도에 도달했습니다.','empty board':'전투 배치에 최소 한 기체가 필요합니다.','empty slot':'빈 자리입니다.','no tickets':'남은 대여권이 부족합니다.','bad rental':'대여 목록이 바뀌었습니다. 다시 골라 주세요.','bad deck':'출전 목록을 다시 확인해 주세요.','deck too big':'대여와 보유 기체를 합친 출전 한도를 넘었습니다.','stale rev':'다른 창에서 기록이 바뀌었습니다. 최신 런을 불러왔습니다.','run active':'이미 진행 중인 런이 있습니다. 최신 런을 불러왔습니다.','no run':'이미 마감된 런입니다. 최신 기록을 확인했습니다.','state changed, retry':'서버 기록이 바뀌었습니다. 최신 기록을 확인했습니다.'};
export function createBrawlManager(ctx){
 const doc=ctx.document||document;
 const timer=ctx.setTimeout||setTimeout,cancel=ctx.clearTimeout||clearTimeout;
 let session=null,pending=null,replayTimer=null,replayAudio=null,stageRun=null;
 const same=t=>!!t&&ctx.state()===t.owner&&ctx.net.state.accountId===t.account;
 const busy=()=>same(pending);
 const visible=()=>same(session)&&!!doc.querySelector('#modal[open] .br-app');
 const blocked=()=>busy()||ctx.blocked?.()||!ctx.net.state.online;
 const walletSnapshot=()=>JSON.stringify([ctx.state().credits,ctx.state().scrap,ctx.state().cores,ctx.state().items]);
 function stopReplay(){if(replayTimer!=null)cancel(replayTimer);replayTimer=null;if(stageRun)stageRun.stop=true;stageRun=null;replayAudio?.stop();replayAudio=null;ctx.audio?.stop('brawl-result');}
 /* 무대 재생(2026-10-08) — 진짜 화면 · 움직임 허용일 때만. 아니면(움직임 줄이기 · 검사) 옛 글자 판 재생 */
 const canStage=()=>typeof document!=='undefined'&&doc===document&&typeof matchMedia==='function'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
 function draw(notice){
  if(!visible())return;
  if(notice!==undefined)session.notice=notice;
  const phase=doc.querySelector('.br-app')?.dataset?.brawlPhase;
  const scroll=phase===brawlPhase(session)?doc.querySelector('.ui-modal-body')?.scrollTop||0:0;
  ctx.openModal(brawlView({...session,pending:busy(),online:ctx.net.state.online}));
  const body=doc.querySelector('.ui-modal-body');if(body)body.scrollTop=scroll;
 }
 async function wallet(token){
  const before=walletSnapshot();let r;try{r=await ctx.net.growthState();}catch{}
  if(!same(token)||walletSnapshot()!==before||!r?.state)return false;
  for(const k of ['credits','scrap','cores'])token.owner[k]=r.state[k];
  token.owner.items={...(r.items||r.state.items||{})};ctx.onRemote?.(r);ctx.commit();ctx.paint?.();return true;
 }
 function adopt(s,r){
  s.record=r;s.known=true;s.selected=null;s.sellConfirm=false;s.quitConfirm=false;
  s.rentals=s.rentals.filter(t=>r.offers?.includes(t)).slice(0,r.tickets||0);
  s.deck=s.deck.filter(t=>r.deckFrom?.includes(t)).slice(0,Math.max(0,(r.deckCap||0)-s.rentals.length));
 }
 async function read(token){
  let r;try{r=await ctx.net.brawl();}catch{}
  if(!same(token)||session!==token.session)return false;
  if(!r||r.error){token.session.known=false;return false;}
  adopt(token.session,r);return true;
 }
 async function refresh(){
  if(!visible())return;
  if(!ctx.net.state.online)return draw(ERRORS.offline);
  if(blocked())return;
  stopReplay();const s=session,t={owner:s.owner,account:s.account,session:s};pending=t;s.known=false;draw('');
  const readOk=await read(t);const paid=s.fight?.done||s.walletUnknown;
  const walletOk=paid&&same(t)?await wallet(t):false;
  if(!same(t)||session!==s){if(pending===t)pending=null;return;}
  if(paid){s.walletKnown=walletOk;s.walletUnknown=!walletOk;}
  if(!s.fight)s.phase='workshop';if(s.phase==='rank'){s.phase=s.beforeRank||'workshop';s.rank=null;}
  if(pending===t)pending=null;draw(readOk?'최신 서버 기록을 확인했습니다.':'서버 기록을 확인하지 못했습니다. 새로고침 후 다시 시도하세요.');
 }
 async function open(){
  if(busy()||ctx.blocked?.())return;
  stopReplay();session={owner:ctx.state(),account:ctx.net.state.accountId,record:null,known:false,deck:[],rentals:[],phase:'workshop',selected:null,fight:null,rank:null,notice:'',speed:1};
  ctx.openModal(brawlView({...session,online:ctx.net.state.online}));
  if(ctx.net.state.online)await refresh();else draw(ERRORS.offline);
 }
 const editable=()=>visible()&&!blocked()&&session.known&&session.phase==='workshop';
 async function write(body){
  if(!editable())return;
  if(!session.record?.on||(body.action==='start'&&session.record.run))return;
  const s=session,t={owner:s.owner,account:s.account,session:s};pending=t;s.sellConfirm=false;s.quitConfirm=false;draw('');
  let r;try{r=await ctx.net.brawl(body);}catch{}
  if(!same(t)||session!==s){if(pending===t)pending=null;return;}
  if(!r||r.error){
   s.known=false;
   // Unknown writes and revision conflicts are reconciled by GET. Never replay
   // the write: start may have consumed tickets, fight may have granted rewards.
   const synced=await read(t);
   if(!same(t)||session!==s){if(pending===t)pending=null;return;}
   if(body.action==='fight'||body.action==='quit'){s.walletKnown=await wallet(t);s.walletUnknown=!s.walletKnown;}
   if(!same(t)||session!==s){if(pending===t)pending=null;return;}
   if(pending===t)pending=null;
   draw((ERRORS[r?.error]||'요청 결과를 확정하지 못했습니다. 요청은 반복하지 않았습니다.')+(synced?' 최신 서버 기록을 확인했습니다.':' 새로고침으로 기록을 확인해야 다시 진행할 수 있습니다.'));return;
  }
  s.selected=null;s.record={...s.record,run:r.run||null};
  if(body.action==='start'){s.record.tickets=r.tickets;s.record.rewardLeft=false;s.record.runsToday++;}
  if(r.done){s.walletKnown=await wallet(t);s.walletUnknown=!s.walletKnown;}
  if(!same(t)||session!==s){if(pending===t)pending=null;return;}
  if(pending===t)pending=null;
  if(body.action==='fight'||body.action==='quit'){
   s.fight={...r,standings:r.result||r.run?.run};s.phase='result';
   if(body.action==='fight'&&visible())return replay();
  }
  draw(r.merged?.length?r.merged.map(u=>`${u.type} ${'★'.repeat(u.star)} 자동 승급`).join(' · '):'');
 }
 function choose(kind,type){
  if(!editable()||session.record?.run||!['deck','rentals'].includes(kind))return;
  const s=session,rec=s.record,options=kind==='deck'?rec.deckFrom:rec.offers;if(!options?.includes(type))return;
  if(s[kind].includes(type))s[kind]=s[kind].filter(t=>t!==type);
  else if(s.deck.length+s.rentals.length<rec.deckCap&&(kind!=='rentals'||s.rentals.length<rec.tickets))s[kind].push(type);
  else return draw('출전 한도 또는 남은 대여권을 확인하세요.');draw('');
 }
 const current=()=>session?.record?.run?.run;
 function moveSlot(where,i){
  if(!editable()||!current()||!['board','bench'].includes(where)||!Number.isInteger(i)||i<0||i>=current()[where].length)return;
  const s=session,from=s.selected,to={where,i};
  s.sellConfirm=false;s.quitConfirm=false;
  if(from){s.selected=null;if(from.where===where&&from.i===i)return draw('');return doAct({t:'move',from,to});}
  if(current()[where][i])s.selected=to;draw('');
 }
 async function doAct(a){
  if(!editable()||!current())return;
  const check=act(current(),a);if(check.error)return draw(ERRORS[check.error]||'이 동작을 실행할 수 없습니다.');
  return write({action:'act',rev:session.record.run.rev,actions:[a]});
 }
 function sell(){if(!editable()||!session.selected)return;const s=session;if(!s.sellConfirm){s.sellConfirm=true;return draw('판매하면 기체가 사라집니다. 판매 확정 버튼을 누르세요.');}return doAct({t:'sell',...s.selected});}
 function quit(){if(!editable()||!current())return;if(!session.quitConfirm){session.quitConfirm=true;return draw('런을 현재 승수로 마감합니다. 오늘의 첫 런이면 지금 승수에 맞는 보상이 지급됩니다.');}return write({action:'quit',rev:session.record.run.rev});}
 function replay(){
  if(!visible()||busy()||!session.fight?.events)return;
  stopReplay();const s=session;s.phase='replay';s.replay=replayState(s.fight);s.cursor=0;s.stage=canStage();draw('');
  if(ctx.audio)replayAudio=createCombatAudio(ctx.audio,{scope:'brawl',active:()=>session===s&&same(s)&&visible()&&s.phase==='replay',unit:(side,i)=>{const u=(side==='P'?s.fight.me:s.fight.opponent).team[i|0];return u&&{type:u.type,maxhp:u.stats.hp};}});
  const stageEl=s.stage&&doc.querySelector('#br-stage');
  if(stageEl){
   /* 무대 — 그리기는 brawl-stage 가, 상태 · 기록은 같은 reducer 가. 재생 중에는 draw() 로 무대를 다시 그리지 않는다(연출이 끊긴다) */
   const run={stop:false};stageRun=run;
   const live=()=>!run.stop&&session===s&&same(s)&&visible()&&s.phase==='replay';
   const logEl=doc.querySelector('#br-log'),progEl=doc.querySelector('#br-progress'),total=s.fight.events.length;
   playBrawlStage(stageEl,s.fight,{speed:()=>s.speed,active:live,names:{P:'우리 부대',E:s.fight.opponent.nickname},
    onEvent:e=>{s.cursor++;applyReplayEvent(s.replay,e);replayAudio?.event(e);
     if(logEl)logEl.innerHTML=s.replay.log.slice(-3).map(l=>`<p>${l.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}</p>`).join('');
     if(progEl)progEl.textContent=Math.floor(s.cursor/total*100)+'% 재생';}})
   .then(w=>{if(!live()||stageRun!==run)return;stageRun=null;
     if(w==null){for(;s.cursor<total;)applyReplayEvent(s.replay,s.fight.events[s.cursor++]);}   // 움직임 줄이기로 무대가 안 떴으면 결과만
     s.phase='result';draw('');});
   return;
  }
  function step(){
   replayTimer=null;if(session!==s||!same(s)||!visible()||s.phase!=='replay'){stopReplay();return;}
   const events=s.fight.events,chunk=Math.max(1,Math.ceil(events.length/120));
   for(let n=0;n<chunk&&s.cursor<events.length;n++){const e=events[s.cursor++];applyReplayEvent(s.replay,e);replayAudio?.event(e);}
   if(s.cursor>=events.length){s.phase='result';return draw('');}
   draw();replayTimer=timer(step,250/s.speed);
  }
  replayTimer=timer(step,200);
 }
 function skip(){if(!visible()||session.phase!=='replay')return;stopReplay();session.phase='result';draw('');}
 async function rank(){
  if(!visible()||blocked()||!session.record?.on||session.phase==='replay')return;
  const s=session,t={owner:s.owner,account:s.account,session:s};pending=t;draw('');let r;try{r=await ctx.net.brawlRank();}catch{}
  if(!same(t)||session!==s){if(pending===t)pending=null;return;}
  if(pending===t)pending=null;
  if(!r||r.error||!r.on)return draw('주간 순위를 불러오지 못했습니다. 다시 시도하세요.');
  if(s.phase!=='rank')s.beforeRank=s.phase;s.rank=r;s.phase='rank';draw('');
 }
 async function next(){if(!visible()||blocked())return;stopReplay();const done=session.fight?.done;session.fight=null;session.phase='workshop';if(done)return refresh();draw('');}
 return {busy,actions:{brawlHome:open,brawlRefresh:refresh,brawlChoose:choose,brawlStart:()=>write({action:'start',deck:session?.deck||[],rentals:session?.rentals||[]}),brawlSlot:moveSlot,brawlBuy:i=>doAct({t:'buy',i}),brawlAct:t=>['lock','reroll'].includes(t)&&doAct({t}),brawlSell:sell,brawlQuit:quit,brawlFight:()=>current()?.board.some(Boolean)&&write({action:'fight',rev:session.record.run.rev}),brawlRank:rank,brawlBack:()=>{if(!visible()||busy())return;session.phase=session.beforeRank||'workshop';draw('');},brawlContinue:next,brawlReplay:replay,brawlSkip:skip,brawlSpeed:()=>{if(!visible())return;session.speed=session.speed===1?2:session.speed===2?4:1;if(stageRun){const b=doc.querySelector('#br-speed');if(b)b.textContent='속도 ×'+session.speed;return;}draw();}}};
}
