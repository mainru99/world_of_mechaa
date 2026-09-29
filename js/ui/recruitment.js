/* Display probabilities derived from the same weighted pools used by rollPull.
 * Never rolls a reward or changes balance. Values are percentages per single pull. */
import { ROBOT_TYPES, RARITY, CONST } from '../../data/balance.js';
import { PULL_CUR } from '../gacha.js';
import { sprite } from '../sprites.js?v=20260912-hangar10-recovery';
import { icon, escapeHtml as esc } from './icons.js';

export const RECRUITMENT_CHANNELS={
  core:{title:'코어 캡슐',headline:'전장을 바꿀\n새로운 전력',tag:'CORE RECRUITMENT',lead:'ignis',description:'새로운 기체와 파츠로\n당신만의 전술을 완성하세요.'},
  credit:{title:'크레딧 캡슐',headline:'더 단단해질\n당신의 부대',tag:'CREDIT RECRUITMENT',lead:'azure',description:'전장에서 모은 크레딧으로\n다음 전투를 준비하세요.'},
  rcore:{title:'정제 코어 캡슐',headline:'한계를 넘어\n깨어나는 전력',tag:'REFINED CORE RECRUITMENT',lead:'solaris',description:'정제한 코어로\n새로운 전력의 가능성을 여세요.'},
};

export function recruitmentPool(currency='core') {
  const config=PULL_CUR[currency]||PULL_CUR.core;
  const total=config.table.reduce((n,row)=>n+row.w,0);
  const rarityTotal=config.rar.reduce((n,row)=>n+row.w,0);
  const partTotal=RARITY.reduce((n,row)=>n+row.w,0);
  const outcomes=config.table.map(row=>({...row,percent:row.w/total*100}));
  const robotPercent=outcomes.find(row=>row.k==='robot')?.percent||0;
  const partPercent=outcomes.find(row=>row.k==='part')?.percent||0;
  const rarities=config.rar.map(row=>({...row,percent:robotPercent*row.w/rarityTotal}));
  const robots=rarities.slice().reverse().flatMap(row=>{
    const candidates=Object.values(ROBOT_TYPES).filter(robot=>!robot.story&&robot.rarity===row.k);
    return row.w>0?candidates.map(robot=>({...robot,percent:row.percent/candidates.length})):[];
  });
  const parts=RARITY.map(row=>({k:row.k,ko:row.ko,percent:partPercent*row.w/partTotal,conditional:row.w/partTotal*100}));
  return {cost:config.cost,unit:config.ko,outcomes,rarities,robots,parts,robotPercent,partPercent};
}

export function percentText(value) {
  return value.toFixed(4).replace(/\.?0+$/,'')+'%';
}

const number=value=>Number(value).toLocaleString('ko-KR');
const labels={robot:'기체',part:'파츠',core:'코어',credit:'크레딧',bust:'꽝'};
const money=currency=>currency==='rcore'?'<span class="cv-rcore-icon" aria-hidden="true">◆</span>':`<img src="assets/ui/coin-${currency==='core'?'core':'credit'}.png" alt="" aria-hidden="true">`;

export function recruitmentView({currency,featured,cores,credits,rcores=0,online,stageHtml}) {
  const channel=RECRUITMENT_CHANNELS[currency],pool=recruitmentPool(currency);
  const hero=pool.robots.find(r=>r.id===featured)||pool.robots.find(r=>r.id===channel.lead)||pool.robots[0];
  const have=currency==='rcore'?rcores:currency==='core'?cores:credits;
  const lead=pool.robots.find(r=>r.id===channel.lead)||pool.robots[0];
  const suggestions=[lead,...pool.robots.filter(r=>r.id!==lead.id&&r.rarity===lead.rarity)].slice(0,3);
  const cards=suggestions.map(r=>`<button class="gv-feature ${r.id===hero.id?'selected':''}" aria-pressed="${r.id===hero.id}" onclick="ROWAR.setRecruitmentHero('${r.id}')">${sprite(r.id,false)}<span><b class="rr-${r.rarity}">${r.rarity}</b> ${esc(r.name)}</span><small>${esc(r.role.split(' · ')[0])}</small></button>`).join('');
  const channels=Object.entries(RECRUITMENT_CHANNELS).map(([key,c])=>`<button class="gv-channel ${key===currency?'selected':''}" aria-pressed="${key===currency}" onclick="ROWAR.setGacha('${key}')">${sprite(c.lead,false)}<span><small>${key==='rcore'?'REFINED CORE':key==='core'?'CORE':'CREDIT'} RECRUITMENT</small><b>${c.title}</b><em>${key==='rcore'?'기체와 파츠 · 정제 코어 사용':key==='core'?'기체와 파츠 · 코어 사용':'기체와 파츠 · 크레딧 사용'}</em></span>${icon('chevron')}</button>`).join('');
  const actions=[1,10].map(count=>`<button class="gv-pull ${count===10?'primary':''}" onclick="ROWAR.pull${count}()" ${!online||have==null||have<pool.cost*count?'disabled':''}><span>${money(currency)} ${number(pool.cost*count)} ${pool.unit}</span><b>${count}회 뽑기</b><small>${count===10?'1회 뽑기 × 10':'새로운 전력을 만나세요'}</small></button>`).join('');
  return `<div class="ui-pagehead gv-pagehead"><div><span class="ui-eyebrow">RECRUITMENT / SUPPLY</span><h1>뽑기</h1><p>새로운 기체와의 만남, 더 넓어지는 전술.</p></div><button class="ui-text-button" onclick="ROWAR.openRecruitmentRates()">${icon('help')} 획득 확률</button></div>
  <div class="gv-layout ${currency}">
    <nav class="gv-rail" aria-label="뽑기와 보급">${channels}<button class="gv-utility" onclick="ROWAR.openRefine()">${icon('gacha')}<span><b>코어 정제</b><small>코어 ${CONST.REFINE.need}개 → 정제 코어 1개</small></span>${icon('chevron')}</button>
      <button class="gv-utility" onclick="ROWAR.setShopTab('shop')">${icon('gacha')}<span><b>보급 상점</b><small>파츠 · 기체 조각 · 재료</small></span>${icon('chevron')}</button>
      <button class="gv-utility" onclick="ROWAR.setShopTab('bag')">${icon('hangar')}<span><b>기체 조각 보관함</b><small>조각을 모아 기체 조립</small></span>${icon('chevron')}</button>
    </nav>
    <div class="gv-main">
      <section class="gv-banner" aria-label="${channel.title} 등장 기체 소개">
        <div class="gv-banner-copy"><span>${channel.tag}</span><h2>${channel.headline.replace('\n','<br>')}</h2><strong>${channel.title}</strong><p>${channel.description.replace('\n','<br>')}</p><small>기체 · 파츠 · 자원 획득</small></div>
        <div class="gv-hero">${sprite(hero.id,false)}</div>
        <div class="gv-hero-label"><span><b class="rr-${hero.rarity}">${hero.rarity}</b> ${esc(hero.name)}</span><button onclick="ROWAR.openRecruitmentDetails('${hero.id}')">${icon('expand')} 상세보기 ${icon('chevron')}</button></div>
        <span class="gv-banner-note">등장 가능 기체 미리보기</span>
        <div class="gv-animation" hidden aria-live="polite">${stageHtml}</div>
      </section>
      <div class="gv-lower"><div class="gv-features">${cards}</div><section class="gv-summary ui-surface"><div><b>획득 안내</b><button aria-label="상세 획득 확률" onclick="ROWAR.openRecruitmentRates()">${icon('help')}</button></div><dl><div><dt>기체</dt><dd>${percentText(pool.robotPercent)}</dd></div><div><dt>파츠</dt><dd>${percentText(pool.partPercent)}</dd></div></dl><button class="ui-text-button" onclick="ROWAR.openRecruitmentRates()">전체 확률 보기 ${icon('chevron')}</button></section></div>
      <div class="gv-bottom"><section class="gv-roster ui-surface"><div><h3>등장 기체 미리보기</h3><button class="ui-text-button" onclick="ROWAR.openRecruitmentPool()">전체 ${pool.robots.length}종 ${icon('chevron')}</button></div><div class="gv-thumbs">${pool.robots.slice(0,9).map(r=>`<button aria-label="${esc(r.name)} 상세 정보" onclick="ROWAR.openRecruitmentDetails('${r.id}')">${sprite(r.id,false)}<b class="rr-${r.rarity}">${r.rarity}</b></button>`).join('')}</div></section><div class="gv-actions">${actions}</div></div>
      <div class="gv-disclosure"><span>${!online?'서버 연결 후 뽑기를 이용할 수 있습니다.':have==null?'재화 잔액 확인 중':`보유 ${pool.unit} ${number(have)}`}</span><span>중복 기체는 자원으로 전환 · 10회 뽑기 등급 보장 없음</span></div>
    </div>
  </div>`;
}

export function recruitmentRates(currency) {
  const pool=recruitmentPool(currency);
  const rows=(list,label)=>`<table class="gv-rate-table"><thead><tr><th>${label}</th><th>1회당 확률</th></tr></thead><tbody>${list.map(row=>`<tr><td>${row.ko||labels[row.k]}</td><td>${percentText(row.percent)}</td></tr>`).join('')}</tbody></table>`;
  return `<p class="hint">${RECRUITMENT_CHANNELS[currency].title} · 1회 ${number(pool.cost)} ${pool.unit}. 아래 수치는 모두 뽑기 1회 기준입니다.</p>${rows(pool.outcomes,'획득 종류')}${rows(pool.rarities,'기체 등급')}${rows(pool.parts,'파츠 등급')}<p class="hint">기체가 나온 경우 같은 등급 안에서 기체별 확률은 동일합니다. 중복 기체는 자원으로 전환됩니다. 10회 뽑기는 독립된 1회 뽑기 10번이며 등급 보장은 없습니다. 확률은 소수점 넷째 자리까지 반올림해 표시합니다.</p>`;
}

export function recruitmentCatalog(currency,owned) {
  return `<p class="hint">${RECRUITMENT_CHANNELS[currency].title}에서 등장하는 기체입니다. 확률은 뽑기 1회 기준이며 소수점 넷째 자리까지 반올림합니다.</p><div class="gv-catalog">${recruitmentPool(currency).robots.map(r=>`<button onclick="ROWAR.openRecruitmentDetails('${r.id}')">${sprite(r.id,false)}<b>${esc(r.name)}</b><span class="rr-${r.rarity}">${r.rarity} · ${percentText(r.percent)}</span><small>${owned.includes(r.id)?'보유 중':'미보유'}</small></button>`).join('')}</div>`;
}
