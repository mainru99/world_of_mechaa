import { TERRITORY, TERRAIN, CONST } from '../../data/balance.js';
import { icon, escapeHtml as esc } from './icons.js';

/* Display geometry only: these borders introduce no adjacency/attack rules. */
export const MAP_POSITIONS = {
  n10:[210,128],n11:[485,113],n12:[768,143],
  n07:[220,266],n08:[485,270],n09:[790,275],
  n04:[230,399],n05:[505,411],n06:[790,411],
  n01:[252,529],n02:[512,546],n03:[770,526],
};
const POLYGONS = {
  n10:'95,75 205,45 285,70 345,55 352,119 330,152 351,195 269,207 234,185 170,210 106,186 84,135',
  n11:'345,55 450,40 511,60 601,38 644,83 626,136 661,197 560,211 515,188 438,205 351,195 330,152 352,119',
  n12:'644,83 736,65 831,90 880,62 925,128 907,204 831,193 778,220 709,192 661,197 626,136',
  n07:'106,186 170,210 234,185 269,207 351,195 368,235 333,283 365,333 285,347 222,321 149,350 80,296',
  n08:'351,195 438,205 515,188 560,211 661,197 680,246 636,300 663,345 572,330 492,353 432,331 365,333 333,283 368,235',
  n09:'661,197 709,192 778,220 831,193 907,204 935,260 909,334 832,358 765,332 663,345 636,300 680,246',
  n04:'80,296 149,350 222,321 285,347 365,333 340,399 375,460 292,482 216,455 143,474 102,413',
  n05:'365,333 432,331 492,353 572,330 663,345 641,397 676,462 604,487 522,466 463,491 375,460 340,399',
  n06:'663,345 765,332 832,358 909,334 945,416 902,477 829,462 760,486 676,462 641,397',
  n01:'143,474 216,455 292,482 375,460 392,502 372,550 400,600 317,629 218,600 167,563',
  n02:'375,460 463,491 522,466 604,487 676,462 700,527 668,576 683,617 572,631 486,608 400,600 372,550 392,502',
  n03:'676,462 760,486 829,462 902,477 922,527 854,582 779,621 683,617 668,576 700,527',
};
const fmt = n => Math.round(n||0).toLocaleString('ko-KR');
const ownership = n => n?.owner==='me'?'mine':n?.owner==='other'?'enemy':'neutral';
export function nodeLabel(n){return n?.owner==='me'?'내 점령지':n?.owner==='other'?'다른 지휘관':'몬스터 주둔';}
export function territoryView({data, selectedId, squadHtml='', filter='all', detailHtml=''}={}){
  const byId = Object.fromEntries((data?.nodes||[]).map(n=>[n.id,n]));
  const visible = n=>filter==='all'||(filter==='mine'?byId[n.id]?.owner==='me':byId[n.id]?.owner!=='me');
  const chosen = TERRITORY.find(n=>n.id===selectedId)||TERRITORY[0];
  const p=data?.pending||{};
  const mine=(data?.nodes||[]).filter(n=>n.owner==='me').length;
  const enemies=(data?.nodes||[]).filter(n=>n.owner==='other').length;
  const has=(p.cr||0)+(p.sc||0)+(p.core||0)>0;
  const markers=TERRITORY.map(n=>{
    const s=byId[n.id], [x,y]=MAP_POSITIONS[n.id], selected=n.id===chosen.id;
    const status=s?.locked?'진입 제한':s?.protectUntil>Date.now()?'보호 중':nodeLabel(s);
    return `<button class="tc-marker ${ownership(s)}${selected?' selected':''}${s?.locked?' locked':''}${visible(n)?'':' filtered'}" style="--x:${x/10}%;--y:${y/6.7}%" data-node="${n.id}" aria-label="${esc(n.ko)} · ${status}" aria-pressed="${selected}"><span class="tc-marker-symbol">${icon(s?.locked?'lock':'terr')}</span><span class="tc-marker-label"><small>${n.id.slice(1)} / ${esc(n.rar)}</small>${esc(n.ko)}</span>${s?.protectUntil>Date.now()?'<span class="tc-protected" title="보호 중">보호</span>':''}</button>`;
  }).join('');
  const borders=TERRITORY.map(n=>`<polygon points="${POLYGONS[n.id]}" data-region="${n.id}" class="${ownership(byId[n.id])}${n.id===chosen.id?' selected':''}${visible(n)?'':' filtered'}"/>`).join('');
  const cards=TERRITORY.filter(visible).map(n=>{
    const s=byId[n.id]; return `<button class="tc-region ${ownership(s)}${n.id===chosen.id?' selected':''}" data-node="${n.id}" aria-pressed="${n.id===chosen.id}"><img src="assets/terrain/${n.terrain}.webp" alt="" loading="lazy"><span><small>${n.id.slice(1)} · ${esc(TERRAIN[n.terrain].ko)}</small><b>${esc(n.ko)}</b><em>${s?.locked?`Lv.${s.minLv||n.minLv} 해금`:nodeLabel(s)}</em></span></button>`;
  }).join('');
  return `<div class="ui-pagehead"><div><span class="ui-eyebrow">TERRITORY CONTROL</span><h1>점령</h1><p>거점을 확보하고, 다음 전장을 준비하세요.</p></div><button class="ui-text-button" data-territory-refresh>${icon('refresh')} 지도 새로고침</button></div>
  <div class="tc-layout">
    <aside class="tc-sidebar">
      <section class="ui-surface tc-brief"><div class="ui-section-label">작전 현황 <small>OPERATIONS</small></div><h2>전장을 넓혀라</h2><p>기체의 힘으로 거점을 확보하고<br>내일의 전력을 만드세요.</p><img class="tc-brief-art" src="assets/terrain/ruins.webp" alt="폐허가 된 산업 지구"><div class="tc-owned"><strong>${mine.toString().padStart(2,'0')}</strong><span>/ 12 거점<br><b>내 점령지</b></span></div><div class="tc-control"><span style="width:${mine/12*100}%"></span></div><div class="tc-tally"><span>다른 지휘관 <b>${enemies}</b></span><span>몬스터 <b>${12-mine-enemies}</b></span></div></section>
      <section class="ui-surface tc-income"><div class="ui-section-label">점령 수입 <small>INCOME</small></div><dl><div><dt><img src="assets/ui/coin-credit.png" alt="">크레딧</dt><dd>${fmt(p.cr)}</dd></div><div><dt><img src="assets/ui/coin-scrap.png" alt="">스크랩</dt><dd>${fmt(p.sc)}</dd></div><div><dt><img src="assets/ui/coin-core.png" alt="">코어</dt><dd>${fmt(p.core)}</dd></div></dl><button class="btn ui-primary" ${has?'':'disabled'} onclick="ROWAR.claimTerr()">${has?'수입 받기':'수입 대기 중'}${icon('arrow')}</button><p class="tc-note">최대 ${CONST.TERR.INCOME_CAP_H}시간분이 쌓입니다.</p></section>
      <section class="ui-surface tc-roster"><div class="ui-section-label">출전 편성 <button class="ui-text-button" onclick="ROWAR.prepareTerritory()">정비 ${icon('chevron')}</button></div>${squadHtml}<p class="tc-note">선봉이 쓰러지면 예비가 이어받습니다.</p></section>
    </aside>
    <section class="tc-center">
      <div class="ui-surface tc-map-panel"><div class="tc-map-head"><div class="ui-section-label">전장 지도 <small>WAR MAP</small></div><div class="tc-filters" aria-label="거점 필터">${[['all','전체'],['mine','내 거점'],['available','미점령']].map(([k,v])=>`<button data-territory-filter="${k}" aria-pressed="${k===filter}" class="${k===filter?'on':''}">${v}</button>`).join('')}</div></div>
      <div class="tc-map-scroll" id="tc-map-scroll"><div class="tc-map-canvas"><img class="tc-map-image" src="assets/backgrounds/territory-map-v2.png" alt="산맥과 해안으로 이루어진 점령 전장"><svg class="tc-borders" viewBox="0 0 1000 670" preserveAspectRatio="none" aria-hidden="true">${borders}</svg><div class="tc-map-grid" aria-hidden="true"></div>${markers}<div class="tc-compass" aria-hidden="true"><b>N</b>✧</div></div></div>
      <div class="tc-map-foot"><div class="tc-legend"><span class="mine">내 거점</span><span class="enemy">다른 지휘관</span><span class="neutral">몬스터</span></div><div class="tc-map-tools"><button data-map-zoom="out" aria-label="지도 축소">−</button><button data-map-zoom="reset" aria-label="지도 전체 보기">전체</button><button data-map-zoom="in" aria-label="지도 확대">+</button></div></div></div>
      <div class="tc-regions-head"><h2>주요 거점 <small>REGIONS</small></h2><span>지역을 선택해 방어선을 확인하세요</span></div><div class="tc-regions">${cards||'<p class="tc-empty">조건에 맞는 거점이 없습니다.</p>'}</div>
      <div class="tc-intel">${icon('target')}<span><b>모든 공격은 흔적을 남깁니다.</b> 돌파에 실패해도 깎아 둔 방어선은 남습니다.</span></div>
    </section>
    <aside class="tc-detail-column"><div class="ui-surface tc-detail" id="tc-detail" tabindex="-1" aria-label="선택 거점 정보">${detailHtml}</div></aside>
  </div>`;
}

/* One delegated listener per mounted screen. No timers, global listeners or API calls. */
export function bindTerritory(root,{select,filter,refresh,view={zoom:1,left:0,top:0}}={}){
  const canvas=root.querySelector('.tc-map-canvas'), scroll=root.querySelector('.tc-map-scroll');
  const applyZoom=()=>{canvas.style.width=`${view.zoom*100}%`;canvas.style.maxWidth='none';};
  applyZoom(); scroll.scrollLeft=view.left; scroll.scrollTop=view.top;
  scroll.onscroll=()=>{view.left=scroll.scrollLeft;view.top=scroll.scrollTop;};
  root.onclick=e=>{
    const node=e.target.closest('[data-node]'); if(node){select(node.dataset.node);return;}
    const f=e.target.closest('[data-territory-filter]'); if(f){filter(f.dataset.territoryFilter);return;}
    if(e.target.closest('[data-territory-refresh]')){refresh();return;}
    const z=e.target.closest('[data-map-zoom]'); if(!z)return;
    view.zoom=z.dataset.mapZoom==='reset'?1:Math.max(1,Math.min(2,view.zoom+(z.dataset.mapZoom==='in'?.25:-.25)));
    applyZoom();
    if(z.dataset.mapZoom==='reset'){scroll.scrollLeft=0;scroll.scrollTop=0;view.left=0;view.top=0;}
  };
}
