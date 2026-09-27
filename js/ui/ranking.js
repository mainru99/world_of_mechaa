/* Ranking and archive presentation only. The server owns rank order and records. */
import {icon,escapeHtml as esc} from './icons.js';

const fmt=n=>Math.max(0,Number(n)||0).toLocaleString('ko-KR');
const wr=(w,l)=>Number(w)+Number(l)>0?Math.round(Number(w)/(Number(w)+Number(l))*100)+'%':'—';
const record=x=>`${fmt(x.wins)}승 ${fmt(x.losses)}패`;
const title=(x,titleName)=>{const name=x.title&&titleName(x.title);return name?`<span class="rv-title">${esc(name)}</span>`:'';};

export function rankShell(tab,inner,dueBadge=''){
 return `<div class="rv-page"><header class="rv-heading"><div><span class="rv-eyebrow">COMMAND RECORDS</span><h1>${tab==='codex'?'도감':'랭킹'}</h1></div><p>${tab==='codex'?'전장에서 얻은 기록을 모아 새로운 이름을 남기세요.':'전장의 기록이 지휘관의 순서를 만듭니다.'}</p></header>
 <div class="rv-shell"><nav class="rv-rail" aria-label="기록 메뉴"><strong>기록 보관소 <small>RECORDS</small></strong><button aria-current="${tab==='rank'?'page':'false'}" onclick="ROWAR.setRankTab('rank')">${icon('rank')}<span>대전 랭킹<small>지휘관 순위</small></span>${icon('chevron')}</button><button aria-current="${tab==='codex'?'page':'false'}" onclick="ROWAR.setRankTab('codex')">${icon('gacha')}<span>도감<small>수집 · 활성화 ${dueBadge}</small></span>${icon('chevron')}</button><div class="rv-rail-foot">ROWAR<br>ROBOT · WAR</div></nav><div class="rv-content">${inner}</div></div></div>`;
}

export function rankingView(r,{page=0,pageSize=10,titleName=()=>null}={}){
 const all=Array.isArray(r.top)?r.top:[],top=all.slice(0,3),rest=all.slice(3),pages=Math.max(1,Math.ceil(rest.length/pageSize));
 const current=Math.max(0,Math.min(page,pages-1)),shown=rest.slice(current*pageSize,(current+1)*pageSize);
 const order=[top[1],top[0],top[2]].filter(Boolean);
 const pod=order.map(x=>`<article class="rv-podium-card rv-place-${x.rank}${x.me?' rv-mine':''}"><span class="rv-medal">${x.rank}</span><div class="rv-avatar">${icon('shield')}</div><div class="rv-podium-name">${esc(x.nickname)}${x.me?'<em>나</em>':''}</div>${title(x,titleName)}<b class="rv-podium-rate">${wr(x.wins,x.losses)}</b><span class="rv-podium-record">${record(x)}</span></article>`).join('');
 const rows=shown.map(x=>`<tr class="${x.me?'mine':''}"><td class="rv-rank">${x.rank}</td><td class="rv-name"><span class="rv-small-medal">${icon('shield')}</span><span>${esc(x.nickname)}${title(x,titleName)}${x.me?'<em>나</em>':''}</span></td><td>${wr(x.wins,x.losses)}</td><td>${record(x)}</td></tr>`).join('');
 const me=r.me||{},myRank=me.rank==null?'집계 중':fmt(me.rank)+'위';
 const date=r.ranked_at?new Date(r.ranked_at):null;
 const when=date&&!Number.isNaN(date.getTime())?`${date.getMonth()+1}월 ${date.getDate()}일 ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`:'집계 대기 중';
 return `<section class="rv-banner"><span>RANKING · COMMANDERS</span><h2>전장의 기록</h2><p>승부가 쌓여 순위가 됩니다. 상위 ${all.length}명의 지휘관과 내 기록을 확인하세요.</p><small>${when} 집계 · 전체 ${fmt(r.total)}명</small></section>
 <div class="rv-columns"><div class="rv-primary"><section class="rv-podium" aria-label="상위 지휘관"><div class="rv-section-head"><h2>상위 지휘관</h2><span>TOP ${top.length}</span></div>${top.length?`<div class="rv-podium-grid rv-count-${top.length}">${pod}</div>`:'<p class="rv-empty">아직 순위에 오른 지휘관이 없습니다.</p>'}</section>
 <section class="rv-board" aria-label="대전 순위"><div class="rv-section-head"><h2>대전 순위</h2><span>상위 ${fmt(all.length)}명 표시</span></div><div class="rv-table-wrap"><table class="rv-table"><thead><tr><th>순위</th><th>지휘관</th><th>승률</th><th>전적</th></tr></thead><tbody>${rows||`<tr><td colspan="4" class="rv-empty">${top.length?'상위 3위 다음 기록이 아직 없습니다.':'첫 대전의 기록을 기다리고 있습니다.'}</td></tr>`}</tbody></table></div>${pages>1?`<div class="rv-pager"><button class="btn ghost" ${current===0?'disabled':''} onclick="ROWAR.rankPage(${current-1})">이전</button><span>${current+1} / ${pages}</span><button class="btn ghost" ${current===pages-1?'disabled':''} onclick="ROWAR.rankPage(${current+1})">다음</button></div>`:''}</section></div>
 <aside class="rv-aside"><section class="rv-my-record"><span class="rv-eyebrow">MY RECORD</span><h2>내 전적</h2><strong>${myRank}</strong><p>${esc(me.nickname||'지휘관')}${title(me,titleName)}</p><div><span>승률 <b>${wr(me.wins,me.losses)}</b></span><span>전적 <b>${record(me)}</b></span></div><small>${me.live?'내 순위는 현재 레이팅으로 계산했습니다.':'순위는 주기적으로 집계됩니다.'}</small></section><section class="rv-aside-note"><h3>순위 안내</h3><p>대전 결과로 순위가 바뀝니다. 표는 서버가 제공한 상위 ${fmt(all.length)}명까지 표시합니다.</p><p>내 순위는 상위 목록에 없어도 여기에서 확인할 수 있습니다.</p></section></aside></div>`;
}
