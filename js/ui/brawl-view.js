import {ROBOT_TYPES,CONST} from '../../data/balance.js';
import {act,tagsOf,livesLostAt,synergiesOf} from '../brawl.js';
import {sprite} from '../sprites.js?v=20260912-hangar10-recovery';
import {escapeHtml as esc} from './icons.js';

const fmt=n=>Math.round(Number(n)||0).toLocaleString('ko-KR');
const B=()=>CONST.BRAWL;
const name=t=>ROBOT_TYPES[t]?.name||t;
const price=t=>B().price[ROBOT_TYPES[t]?.rarity]||1;
const stars=u=>'★'.repeat(u.star||1);
export const brawlPhase=s=>s.phase==='workshop'?(s.record?.run?'workshop':'lobby'):s.phase;
const tags=t=>tagsOf(t).map(k=>B().syn[k]?.ko||k).join(' · ');
export function synergyText(s){
 const pct=Math.round(s.v*100);
 return ({shield:`시작 방벽 ${pct}%`,repair:`턴마다 내구 ${pct}% 회복`,mark:`공격력 +${pct}%`,breach:`관통 발동 ${pct}%`,jam:`속도 +${pct}%`,execute:`치명 +${pct}%p`,drain:`방어력 +${pct}%`,precise:`스킬 위력 +${pct}%`,flurry:`회피 +${pct}%p`,family:`집안 내구·공격 +${pct}%`})[s.key]||'';
}
function unitArt(type,right=false){return `<div class="br-art">${sprite(type,right)}</div>`;}
function choice(t,s,kind){
 const selected=s[kind].includes(t),T=ROBOT_TYPES[t];
 const cap=s.record.deckCap,full=s.deck.length+s.rentals.length>=cap;
 const disabled=s.pending||(!selected&&(full||(kind==='rentals'&&s.rentals.length>=s.record.tickets)));
 return `<button id="br-${kind}-${esc(t)}" class="br-choice ${selected?'selected':''}" aria-pressed="${selected}" onclick="ROWAR.brawlChoose('${kind}','${esc(t)}')" ${disabled?'disabled':''}>
  <span class="br-rarity rr-${T.rarity}">${T.rarity} · ${kind==='rentals'?'대여':'보유'}</span>${unitArt(t)}<b>${esc(name(t))}</b><small>${esc(tags(t)||T.role)}</small><span class="br-check">${selected?'✓ 선택':'선택하기'}</span></button>`;
}
function lobby(s){
 const r=s.record;
 if(!r)return `<div class="br-empty"><h3>서버 기록 확인</h3><p>진행 중인 난투와 오늘의 대여 목록을 불러옵니다.</p></div>`;
 if(!r.on)return `<div class="br-empty"><h3>난투 준비 중</h3><p>운영 서버에서는 아직 난투가 열리지 않았습니다.</p></div>`;
 return `<div class="br-hero"><span class="br-eyebrow">BUILD. ADAPT. SURVIVE.</span><h3>네 기체로 만드는<br>열 번의 승리.</h3><p>상점에서 전력을 모으고, 전위와 후위를 배치하세요.<br>같은 기체 세 기는 자동으로 승급합니다.</p><div class="br-badges"><span>남은 대여 ${r.tickets}장</span><span>${r.rewardLeft?'오늘 첫 런 · 보상 가능':'오늘 추가 런 · 보상 없는 연습'}</span><span>주간 최고 ${r.week?.best??'—'}승</span></div></div>
 <section class="br-section"><div class="br-heading"><h3>오늘의 대여</h3><span>한 기체당 1장 · 이번 런만 사용</span></div><div class="br-choices">${r.offers.map(t=>choice(t,s,'rentals')).join('')||'<p>대여할 기체가 없습니다.</p>'}</div></section>
 <section class="br-section"><div class="br-heading"><h3>보유 기체 출전 목록</h3><span>대여 포함 ${s.deck.length+s.rentals.length} / ${r.deckCap}</span></div><p class="br-muted">C 등급은 항상 포함됩니다. 여기서 고른 기체가 이번 런의 상점에 등장합니다.</p><div class="br-choices">${r.deckFrom.map(t=>choice(t,s,'deck')).join('')||'<p>C 등급과 대여 기체로 시작할 수 있습니다.</p>'}</div></section>
 <div class="br-footer"><p>대여권은 시작할 때 사용됩니다. 시작 후 출전 목록을 바꿀 수 없습니다.<br>대여·첫 런 보상은 매일 한국 시간 09:00 초기화됩니다.</p><button id="br-start" class="btn gold" onclick="ROWAR.brawlStart()" ${s.pending||!s.known||!s.online?'disabled':''}>${r.rewardLeft?'보상 런 시작':'연습 런 시작'}</button></div>`;
}
function slot(u,where,i,s){
 const selected=s.selected?.where===where&&s.selected?.i===i;
 const label=where==='board'?`${i<2?'전위':'후위'} ${i%2+1}`:`대기 ${i+1}`;
 return `<button id="br-${where}-${i}" class="br-slot ${u?'filled':''} ${selected?'selected':''}" onclick="ROWAR.brawlSlot('${where}',${i})" aria-pressed="${selected}" aria-label="${esc(label+' · '+(u?name(u.type)+' '+stars(u):'빈 자리')+(s.selected?' · 이동 또는 교체':''))}" ${s.pending||!s.known?'disabled':''}>
 <small>${label}</small>${u?`${unitArt(u.type)}<b>${esc(name(u.type))}</b><span class="br-stars">${stars(u)}</span>`:'<span class="br-vacant">＋</span><b>빈 자리</b>'}</button>`;
}
function workshop(s){
 const w=s.record.run,r=w.run,sel=s.selected,u=sel&&r[sel.where]?.[sel.i],inc=w.income;
 return `<div class="br-stats"><div><small>ROUND</small><strong>${r.round}</strong></div><div><small>승리 / 목표</small><strong>${r.wins} / ${B().winGoal}</strong></div><div><small>남은 목숨</small><strong class="${r.lives<=3?'br-danger':''}">${r.lives} / ${B().lives}</strong></div><div><small>난투 골드</small><strong class="br-gold">${r.gold}</strong></div></div>
 <div class="br-workspace"><section class="br-section br-board"><div class="br-heading"><h3>전투 배치</h3><span>출격 ${r.board.filter(Boolean).length} / ${B().board}기</span></div><p class="br-muted">기체를 선택하고 옮길 자리를 누르세요. 기체가 있으면 서로 교체합니다.</p><div class="br-board-slots">${r.board.map((x,i)=>slot(x,'board',i,s)).join('')}</div><p class="br-board-note">앞줄이 상대 공격을 받습니다 · 뒷줄은 보호받는 동안 공격력 상승</p>
 <div class="br-heading"><h3>대기석</h3><span>전투·시너지에는 참여하지 않음</span></div><div class="br-bench">${r.bench.map((x,i)=>slot(x,'bench',i,s)).join('')}</div>
 <div class="br-selection" aria-live="polite">${u?`<span><b>${esc(name(u.type))} ${stars(u)}</b> · ${esc(tags(u.type)||'시너지 없음')}<small>${esc(ROBOT_TYPES[u.type].skill.name)} · ${esc(ROBOT_TYPES[u.type].role)}</small></span><button id="br-sell" class="btn ${s.sellConfirm?'gold':''}" onclick="ROWAR.brawlSell()" ${s.pending||!s.known?'disabled':''}>${s.sellConfirm?'판매 확정':'판매'} · ${price(u.type)*3**(u.star-1)}G</button>`:'<span>배치할 기체를 선택하세요. 상점 구매 기체는 빈 대기석부터 들어옵니다.</span>'}</div></section>
 <aside class="br-section br-synergies"><span class="br-eyebrow">TEAM SYNERGY</span><h3>부대 시너지</h3><p class="br-muted">같은 효과를 가진 서로 다른 기체 2기 / 3기가 필요합니다. 중복 기체는 한 기로 셉니다.</p>${w.syn.length?w.syn.map(x=>`<article class="br-syn"><div><b>${esc(x.ko)}${x.fam?' · '+esc(x.fam):''}</b><span>${x.n}기 · ${x.tier===2?'강화':'활성'}</span></div><strong>${esc(synergyText(x))}</strong><small>${x.types.map(t=>esc(name(t))).join(' · ')}</small></article>`).join(''):'<div class="br-empty-small">아직 활성화된 시너지가 없습니다.<br>기체 카드의 효과를 조합해 보세요.</div>'}<div class="br-income"><b>다음 수입 예상 ${inc.total}G</b><small>기본 ${inc.base} + 이자 ${inc.interest} + 현재 연승·연패 ${inc.streak}<br>전투 후 연승·연패에 따라 실제 수입은 달라집니다.</small></div><p class="br-muted">이번 패배 시 목숨 −${livesLostAt(r.round)}<br>${w.first?'오늘의 보상 런':'연습 런 · 보상 없음'} · ${r.streak>0?r.streak+'연승':r.streak<0?-r.streak+'연패':'첫 전투 준비'}</p></aside></div>
 <section class="br-section br-shop"><div class="br-heading"><h3>보급 상점</h3><div><button id="br-lock" class="btn" aria-pressed="${r.locked}" onclick="ROWAR.brawlAct('lock')" ${s.pending||!s.known?'disabled':''}>${r.locked?'다음 라운드 잠금 중':'상점 잠금'}</button><button id="br-reroll" class="btn" onclick="ROWAR.brawlAct('reroll')" ${s.pending||!s.known||act(r,{t:'reroll'}).error?'disabled':''}>새로고침 · ${B().shop.reroll}G</button></div></div><div class="br-shop-slots">${r.shop.map((t,i)=>!t?'<div class="br-shop-empty">구매 완료</div>':`<button id="br-buy-${i}" class="br-choice" onclick="ROWAR.brawlBuy(${i})" ${s.pending||!s.known||act(r,{t:'buy',i}).error?'disabled':''}><span class="br-rarity rr-${ROBOT_TYPES[t].rarity}">${ROBOT_TYPES[t].rarity} · ${price(t)}G</span>${unitArt(t)}<b>${esc(name(t))}</b><small>${esc(tags(t)||ROBOT_TYPES[t].role)}</small><span class="br-check">구매하기</span></button>`).join('')}</div><p class="br-muted">등급별 등장 몫 · ${Object.entries(w.odds).map(([k,v])=>`${k} ${v}%`).join(' / ')}<br>잠금은 다음 라운드에도 상점을 보존합니다. 새로고침하면 잠금이 풀립니다.</p></section>
 <div class="br-footer"><button id="br-quit" class="btn" onclick="ROWAR.brawlQuit()" ${s.pending||!s.known?'disabled':''}>${s.quitConfirm?'현재 승수로 마감 확정':'런 마감'}</button><p>모든 기체 Lv.${B().level} · 파츠·서킷·스킬 강화 미적용<br>같은 기체 3기 → ★2 · ★2 세 기 → ★3</p><button id="br-fight" class="btn gold" onclick="ROWAR.brawlFight()" ${s.pending||!s.known||!r.board.some(Boolean)||!s.online?'disabled':''}>${r.round}라운드 출격</button></div>`;
}
/* 무대 — 4 대 4 를 마주 세운다(2026-10-08). 전위(0 · 1)는 가운데 가까이, 후위(2 · 3)는 뒤에. 위 · 아래 두 줄로 깊이를 준다.
   칸 id 는 fighter-p0 … · hp-p0 … — js/ui/brawl-stage.js 와 연출 층(battle-fx · motion)이 이 이름으로 찾는다. 움직임 줄이기면 아래 옛 카드 판 */
const STAGE_X=[38,30,18,10],STAGE_Y=[44,10,44,10];
function stageView(s){
 const f=s.fight,p=s.replay;
 const slot=(side,i,u)=>{if(!u)return'';const k=(side==='P'?'p':'e')+i,x=side==='P'?STAGE_X[i]:100-STAGE_X[i],y=STAGE_Y[i],back=i%2===0;const v=p.units[side][i];
  return `<div class="bs-u ${back?'far':'near'} ${v?.hp===0?'down':''}" id="fighter-${k}" style="--x:${x}%;--y:${y}%"><div class="bs-plate"><b>${esc(name(u.type))}</b><span class="br-stars">${stars(u)}</span><div class="hpbar bs-hp" id="hp-${k}"><i style="width:${v?v.hp/v.maxhp*100:0}%"></i></div></div>${sprite(u.type,side==='P')}<small class="bs-role">${i<2?'전위':'후위'}</small></div>`;};
 const syn=(b)=>synergiesOf(b).map(x=>`<span>${esc(x.ko)} ${x.tier>1?'Ⅱ':'Ⅰ'}</span>`).join('');
 return `<div class="bs-head"><span class="br-eyebrow">ROUND ${f.round} / COMBAT REPLAY</span><b>우리 부대 <i>VS</i> ${esc(f.opponent.nickname)}${f.opponent.bot?' · AI':''}</b><small>창을 닫아도 결과는 저장됩니다</small></div>
<div class="bs-stage" id="br-stage"><div class="bs-syn p">${syn(f.me.board)}</div><div class="bs-syn e">${syn(f.opponent.board)}</div>${f.me.team.map((u,i)=>slot('P',i,u)).join('')}${f.opponent.team.map((u,i)=>slot('E',i,u)).join('')}<div class="flash" id="flash"></div><div class="skillbanner" id="skillbanner"></div></div>
<div class="br-log bs-log" id="br-log" aria-label="전투 기록">${p.log.slice(-3).map(l=>`<p>${esc(l)}</p>`).join('')}</div><div class="br-footer"><span id="br-progress">${Math.floor(s.cursor/f.events.length*100)}% 재생</span><div><button id="br-speed" class="btn" onclick="ROWAR.brawlSpeed()">속도 ×${s.speed}</button><button id="br-skip" class="btn gold" onclick="ROWAR.brawlSkip()">결과 보기</button></div></div>`;
}
export function replayView(s){
 if(s.stage)return stageView(s);
 const f=s.fight,p=s.replay;
 const side=(key,label,board)=>`<section class="br-team ${key==='E'?'enemy':''}"><h3>${esc(label)}</h3><div class="br-combat-slots">${board.map((u,i)=>{const v=p.units[key][i];return `<article id="br-combat-${key}-${i}" class="br-fighter ${v?.hp===0?'down':''} ${p.active===key+i?'active':''}"><small>${i<2?'전위':'후위'} ${i%2+1}</small>${u?`${unitArt(u.type,key==='P')}<b>${esc(name(u.type))} <span class="br-stars">${stars(u)}</span></b><div class="br-hp" role="progressbar" aria-label="${esc(name(u.type))} 내구" aria-valuemin="0" aria-valuemax="${v.maxhp}" aria-valuenow="${v.hp}"><i style="width:${v.hp/v.maxhp*100}%"></i></div><small>${fmt(v.hp)} / ${fmt(v.maxhp)} · SP ${fmt(v.sp)}${v.shield>0?' · 방벽 '+fmt(v.shield):''}</small>`:'<span class="br-vacant">—</span><b>빈 자리</b>'}</article>`;}).join('')}</div></section>`;
 return `<div class="br-replay-head"><span class="br-eyebrow">ROUND ${f.round} / COMBAT REPLAY</span><h3>전술이 맞부딪히는 순간.</h3><p>서버에서 확정된 전투 기록을 재생합니다. 창을 닫아도 결과는 저장됩니다.</p></div><div class="br-arena">${side('P','우리 부대',f.me.board)}<span class="br-vs">VS</span>${side('E',f.opponent.nickname+(f.opponent.bot?' · AI':''),f.opponent.board)}</div><div class="br-log" aria-label="전투 기록">${p.log.slice(-5).map(l=>`<p>${esc(l)}</p>`).join('')}</div><div class="br-footer"><span>${Math.floor(s.cursor/f.events.length*100)}% 재생</span><div><button id="br-speed" class="btn" onclick="ROWAR.brawlSpeed()">속도 ×${s.speed}</button><button id="br-skip" class="btn gold" onclick="ROWAR.brawlSkip()">결과 보기</button></div></div>`;
}
function resultView(s){
 const f=s.fight,r=f.result||f.standings,reward=f.reward;
 return `<section class="br-result"><span class="br-eyebrow">${f.done?'RUN COMPLETE':'ROUND '+f.round+' COMPLETE'}</span><h3>${f.result?.quit?'런 마감':f.done?(r.wins>=B().winGoal?'10승 달성':'난투 종료'):f.win?'라운드 승리':'라운드 패배'}</h3><p>${r.wins}승 · ${r.losses}패 · 남은 목숨 ${r.lives}</p>${f.round?`<p>${esc(f.opponent.nickname)}${f.opponent.bot?' · AI':''} · ${f.win?'승리':`목숨 −${f.lost}`}${f.done?'':` · 수입 +${f.income.total}G`}</p>`:''}<div class="br-history">${(r.hist||[]).map((v,i)=>`<span class="${v==='W'?'win':'loss'}" title="${i+1}라운드 ${v==='W'?'승리':'패배'}">${v}</span>`).join('')}</div>${f.done?`<div class="br-rewards"><h4>${reward?'서버 지급 완료':'연습 런 · 보상 없음'}</h4>${reward?`<div><span>크레딧 <b>+${fmt(reward.cr)}</b></span><span>스크랩 <b>+${fmt(reward.sc)}</b></span><span>정제 코어 <b>+${fmt(reward.refined)}</b></span><span>${reward.shardTo?esc(name(reward.shardTo))+' 조각':'목표 조각'} <b>+${fmt(reward.shard)}</b></span></div><p>${s.walletKnown?'재화 기록까지 동기화했습니다.':'재화 표시 확인이 필요합니다. 서버 기록 새로고침을 눌러 주세요.'}</p>`:'<p>주간 순위에는 기록됩니다. 보상은 하루 첫 런만 지급됩니다.</p>'}</div>`:''}<div class="br-result-actions"><button id="br-next" class="btn gold" onclick="ROWAR.brawlContinue()" ${s.pending?'disabled':''}>${f.done?'난투 로비로':'다음 라운드 준비'}</button>${f.events?'<button class="btn" onclick="ROWAR.brawlReplay()">다시 재생</button>':''}<button class="btn" onclick="ROWAR.brawlRank()" ${s.pending?'disabled':''}>주간 순위</button></div></section>`;
}
function rankView(s){return `<section class="br-section"><div class="br-heading"><h3>주간 난투 순위</h3><button class="btn" onclick="ROWAR.brawlBack()">돌아가기</button></div><p class="br-muted">최고 승수 → 남은 목숨 → 먼저 달성한 기록 순입니다. 월요일 한국 시간 09:00 갱신 · 별도 주간 보상 없음.</p>${s.rank?.me?`<p class="br-my-rank">내 기록 · ${s.rank.me.rank}위 · ${s.rank.me.best}승 · 목숨 ${s.rank.me.lives}</p>`:'<p>이번 주 마감한 런이 없습니다.</p>'}<div class="br-rank-list">${(s.rank?.top||[]).map(x=>`<article class="${x.me?'me':''}"><b>${x.rank}</b><span>${esc(x.nickname)}${x.me?' (나)':''}</span><strong>${x.best}승</strong><small>목숨 ${x.lives} · ${x.runs}런</small></article>`).join('')||'<p>아직 기록이 없습니다.</p>'}</div></section>`;}
export function brawlView(s){
 return `<div class="mhead">난투 · BRAWL</div><div class="br-app" data-brawl-phase="${brawlPhase(s)}" aria-busy="${!!s.pending}"><header class="br-toolbar"><span class="br-eyebrow">4 vs 4 / ASYNCHRONOUS ARENA</span><div><button id="br-refresh" class="btn" onclick="ROWAR.brawlRefresh()" ${s.pending||s.phase==='replay'?'disabled':''}>서버 기록 새로고침</button><button id="br-ranking" class="btn" onclick="ROWAR.brawlRank()" ${s.pending||!s.record?.on||s.phase==='replay'?'disabled':''}>주간 순위</button></div></header>${s.notice?`<p class="br-notice" role="status">${esc(s.notice)}</p>`:''}${s.pending?'<p class="br-loading" role="status">서버 확인 중… 중복 요청은 보내지 않습니다.</p>':''}${s.phase==='rank'?rankView(s):s.phase==='replay'?replayView(s):s.phase==='result'?resultView(s):s.record?.run?workshop(s):lobby(s)}<details class="br-help"><summary>난투 규칙과 저장 방식</summary><p>골드는 이 런에서만 사용하며 계정 재화와 다릅니다. 보유 기체는 소모되지 않습니다. 기체 수집이 출전 목록을 넓히지만 성장 능력치는 적용하지 않습니다. 상대는 같은 라운드의 플레이어 배치 기록이며, 기록이 없으면 훈련 봇을 만납니다.</p><p>모든 구매·이동은 서버 저장이 끝나야 반영됩니다. 창을 닫거나 재접속하면 진행 중인 런을 복구합니다. 하루 첫 런을 마감할 때만 보상을 받으며, 추가 런도 순위에 기록됩니다. 런 마감은 되돌릴 수 없습니다.</p></details></div>`;
}
