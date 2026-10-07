/* Renderer adapted from the user-approved 2026-09-28 circuit preview.
 * Preserves all 76 layouts and socket geometry. No saved state or API writes. */
import {CIRCUIT_LAYOUT,CIRCUIT_LABEL_BOXES} from '../../data/circuit_layout.js';
import {CIRCUIT_THEMES} from '../../data/circuit.js';
import {constellation,themesOf,blockOf,openNotables} from '../circuit.js';
import {traitPoints} from '../stats.js';
import {ROBOT_TYPES} from '../../data/balance.js';
const BR='ABCD'.split('');
const NS='http://www.w3.org/2000/svg';

const BG=Array.from({length:70},(_,i)=>[(i*137.7)%520,(i*79.1)%430,.6,.35]);
function labelSpot(P, b) {
  const st_ = P[b + '*'], s8 = P[b + '8'], out = Math.atan2(st_[1] - s8[1], st_[0] - s8[0]);
  const pts = [P.core, ...BR.flatMap(x => [1, 2, 3, 4, 5, 6, 7, 8, '*'].map(k => P[x + k]))];
  for (const r of [16, 28, 40]) for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
    const a = out + k * Math.PI / 6, cx = st_[0] + Math.cos(a) * r, cy = st_[1] + Math.sin(a) * r;
    const x0 = Math.cos(a) > .3 ? cx : Math.cos(a) < -.3 ? cx - 90 : cx - 45;
    const y0 = Math.sin(a) > .3 ? cy : Math.sin(a) < -.3 ? cy - 20 : cy - 10;
    if (x0 < 2 || x0 + 90 > 518 || y0 < 2 || y0 + 20 > 428) continue;
    if (pts.some(p => p[0] > x0 - 6 && p[0] < x0 + 96 && p[1] > y0 - 6 && p[1] < y0 + 26)) continue;
    return { x: x0, y: y0 };
  }
  return null;
}
function starPath(x, y, R, r) { let d = ''; for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i * Math.PI / 4, q = i % 2 ? r : R; d += (i ? 'L' : 'M') + (x + q * Math.cos(a)).toFixed(1) + ' ' + (y + q * Math.sin(a)).toFixed(1); } return d + 'Z'; }

export function drawCircuitSvg(svg,{type,taken,draft=[],level,selected,onSelect}){
  const el=(tag,attrs={},parent)=>{const e=svg.ownerDocument.createElementNS(NS,tag);for(const key in attrs)e.setAttribute(key,attrs[key]);if(parent)parent.appendChild(e);return e;};
  if(!CIRCUIT_LAYOUT[type])return;
  const st={mech:type,taken,sel:selected},stars=constellation(type);
  const D={labels:CIRCUIT_LABEL_BOXES,themes:CIRCUIT_THEMES};
  const M=()=>({themes:themesOf(type)});
  const isTaken=id=>taken.includes(id),why=id=>blockOf(type,taken,id,traitPoints(level));
  const nbOpen=br=>openNotables(type,taken).includes(br+'*');
  const starOf=id=>{const s=stars.find(s=>s.id===id);return s?[id,s.kind,s.fx]:null;};
  const layout=()=>{const L=CIRCUIT_LAYOUT[type];return {core:L.core,art:L.art,...Object.fromEntries(BR.flatMap(b=>L[b].map((p,i)=>[b+(i===8?'*':i+1),p])))};};
function drawSvg() {
  svg.textContent = '';
  const P = layout(st.mech);
  const defs = el('defs', {}, svg);
  const cp = el('clipPath', { id: 'cc' }, defs); el('circle', { cx: P.core[0], cy: P.core[1], r: 34 }, cp);
  const gl = el('filter', { id: 'glow', x: '-60%', y: '-60%', width: '220%', height: '220%' }, defs);
  el('feGaussianBlur', { stdDeviation: '2.6', result: 'b' }, gl); const mg = el('feMerge', {}, gl); el('feMergeNode', { in: 'b' }, mg); el('feMergeNode', { in: 'SourceGraphic' }, mg);
  for (const [id, colors] of [['socket-metal',['#f1db9b','#8b6939','#302c25','#ba9151']],['socket-cold',['#a2b1b6','#4c565b','#202931','#73746b']],['socket-gem',['#b9fff0','#38adab','#113b49','#08151f']],['socket-draft',['#ffe5ae','#bc8e3f','#68471f','#261b10']],['socket-dark',['#344149','#18232d','#080f17','#26333b']]]) {
    const gradient = el('linearGradient', {id, x1:'0%',y1:'0%',x2:'85%',y2:'100%'}, defs);
    colors.forEach((color,i)=>el('stop',{offset:`${i*100/3}%`,'stop-color':color},gradient));
  }
  /* 전문 별 연출(2026-10-07 사용자 지시) — 찍은 전문 별만 금빛 별 · 도는 햇살 · 숨쉬는 후광. 움직임은 SVG 안(SMIL)이라 CSS 를 건드리지 않는다 */
  const still=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sg = el('filter', { id: 'starglow', x: '-100%', y: '-100%', width: '300%', height: '300%' }, defs);
  el('feGaussianBlur', { stdDeviation: '1.1', result: 'b' }, sg); const sm = el('feMerge', {}, sg); el('feMergeNode', { in: 'b' }, sm); el('feMergeNode', { in: 'b' }, sm); el('feMergeNode', { in: 'SourceGraphic' }, sm);
  const au = el('radialGradient', { id: 'nb-aura' }, defs);
  [['0%', '#fff2b8', .95], ['35%', '#ffd35e', .55], ['100%', '#ffb13b', 0]].forEach(([o, c, a]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }, au));
  const ray = el('radialGradient', { id: 'nb-ray' }, defs);
  [['0%', '#fff0b0', .9], ['100%', '#ffc24a', 0]].forEach(([o, c, a]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }, ray));
  const anim=(parent,tag,attrs)=>{ if(!still) el(tag,{repeatCount:'indefinite',...attrs},parent); };
  /* 장식 — 이동 경로로 오인하지 않게 흐린 점과 끊긴 호만 */
  const deco = el('g', { 'pointer-events': 'none' }, svg);
  for (const [x, y, r, o] of BG) el('circle', { cx: x, cy: y, r, fill: '#6d86a0', opacity: o * .6 }, deco);
  if (P.art) {
    /* 별자리 그림 — 파일럿과 같은 톤(청록 은빛 · 알파 100/255 이하)으로 이미 눌러 두었다. 게시본은 assets/circuit/, 저장소에서 열면 ../../assets/circuit/ */
    const im = el('image', { x: 0, y: 0, width: 520, height: 430, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' }, deco);
    im.addEventListener('error', () => { if (!im.dataset.fb) { im.dataset.fb = 1; im.setAttribute('href', '../../assets/circuit/' + st.mech + '.webp'); } });
    im.setAttribute('href', 'assets/circuit/' + st.mech + '.webp');
  } else el('path', { d: `M40 ${P.core[1] + 30} Q260 ${P.core[1] - 70} 480 ${P.core[1] + 30}`, fill: 'none', stroke: '#22303e', 'stroke-width': 1, 'stroke-dasharray': '2 6' }, deco);
  /* 연결선 */
  const lines = el('g', { 'pointer-events': 'none' }, svg);
  for (const b of BR) {
    let prev = P.core;
    for (let i = 1; i <= 9; i++) {
      const id = b + (i === 9 ? '*' : i), p = P[id], on = isTaken(id);
      // The exact prerequisite edges stay straight: decorative curves must not imply new connections.
      const edge = {x1:prev[0],y1:prev[1],x2:p[0],y2:p[1],'stroke-linecap':'round'};
      el('line',{...edge,stroke:'#070c12','stroke-width':4.6},lines);
      const nbEdge = on && i === 9;
      el('line',{...edge,stroke:nbEdge?'#e2b650':on?'#ba9858':'#485052','stroke-width':nbEdge?3.2:2.6,'data-edge':id,...(nbEdge?{filter:'url(#glow)'}:{})},lines);
      el('line',{...edge,stroke:nbEdge?'#fff3c4':on?'#f0dba0':'#151e25','stroke-width':nbEdge?1.1:.8},lines);
      prev = p;
    }
    /* 갈래 이름 — ★ 둘레에서 판 안이고 별을 덮지 않는 첫 자리(tools/circuitlayoutcheck.mjs labelSpot 과 같은 순서) */
    const box = D.labels && D.labels[st.mech] && D.labels[st.mech][b];          // 정해 둔 이름 칸(파일럿은 ChatGPT)이 먼저
    const spot = box ? { x: box[0], y: box[1] } : labelSpot(P, b);
    const t = spot ? el('text', { x: spot.x + 2, y: spot.y + 14, 'font-size': 12, 'font-family': 'IBM Plex Sans KR, sans-serif', fill: 'var(--plateSub)' }, lines)
                   : el('text', { x: P[b + '*'][0], y: P[b + '*'][1] - 18, 'text-anchor': 'middle', 'font-size': 12, 'font-family': 'IBM Plex Sans KR, sans-serif', fill: 'var(--plateSub)' }, lines);
    t.textContent = `${b} · ${D.themes[M().themes[BR.indexOf(b)]].ko}`;
  }
  /* 가운데 — 그림이 있으면 기체가 이미 그려져 있으니 코어 별만, 없으면 기체 얼굴 */
  if (P.art) {
    el('circle', { cx: P.core[0], cy: P.core[1], r: 12, fill: 'none', stroke: 'var(--brass)', 'stroke-width': 1.5, opacity: .8 }, svg);
    el('circle', { cx: P.core[0], cy: P.core[1], r: 6, fill: 'var(--plate)', filter: 'url(#glow)' }, svg);
  } else {
    el('circle', { cx: P.core[0], cy: P.core[1], r: 38, fill: '#0a1016', stroke: '#35485a', 'stroke-width': 2 }, svg);
    el('image', { href: ROBOT_TYPES[st.mech]?.img, x: P.core[0] - 34, y: P.core[1] - 34, width: 68, height: 68, 'clip-path': 'url(#cc)', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' }, svg);
  }
  /* 후광 층 — 별보다 아래라 이웃 별을 덮지 않는다 */
  const aura = el('g', { 'pointer-events': 'none' }, svg);
  /* 별 */
  for (const b of BR) for (let i = 1; i <= 9; i++) {
    const id = b + (i === 9 ? '*' : i), lock = i === 9;
    const taken = isTaken(id), open = !lock && !taken && !why(id);
    const g = el('g', { class: 'star', tabindex: 0, role: 'button', 'data-id': id, style: 'cursor:pointer',
      'aria-label': `${id}${lock?' 전문 별':''} ${draft.includes(id)?'미저장 선택':taken?'저장됨':!why(id)?'찍을 수 있음':'잠김'}`, 'aria-pressed': taken ? 'true' : 'false' }, svg);
  }
  // Presentation only: IDs, positions, prerequisites and all click handlers remain unchanged.
  for (const g of svg.querySelectorAll('.star')) {
    const id=g.dataset.id, [x,y]=P[id], notable=id.endsWith('*'), node=notable?null:starOf(id);
    const taken=isTaken(id), available=!taken&&!why(id), kind=notable?'notable':node[1];
    const nearest=Math.min(...Object.entries(P).filter(([k,v])=>k!==id&&Array.isArray(v)).map(([,p])=>Math.hypot(x-p[0],y-p[1])));
    const r=Math.min(notable?12:kind==='c'?9.5:kind==='b'?8:6.5,nearest*.45-(notable?3:2));
    g.setAttribute('data-state',draft.includes(id)?'draft':taken?'taken':available?'available':'locked');
    g.setAttribute('data-kind',kind);
    const circle=(radius,attrs)=>el('circle',{cx:x,cy:y,r:radius,...attrs},g);
    circle(Math.min(15,nearest*.48),{fill:'transparent'});
    circle(r+2,{class:'focus-ring',fill:'none',stroke:'#fff0bc','stroke-width':1.1});
    if(st.sel===id) circle(r+1.6,{fill:'none',stroke:'#f5dfad','stroke-width':.8,'stroke-dasharray':'2 2'});
    circle(r+.7,{fill:'#080d13',stroke:'#0b1117','stroke-width':1.3});
    circle(r,{fill: taken||available||notable?'url(#socket-metal)':'url(#socket-cold)',stroke:taken?'#f3dca4':'#827451','stroke-width':.5});
    circle(r-1.8,{fill:draft.includes(id)?'url(#socket-draft)':taken?'url(#socket-gem)':'url(#socket-dark)',stroke:'#080e15','stroke-width':1});
    circle(Math.max(1,r-2.8),{fill:'none',stroke:taken?'#a8f9df':available?'#d8c393':'#738387','stroke-width':.45,opacity:taken?.8:.45});
    if(notable&&taken){
      /* 찍은 전문 별 — 도는 햇살 · 숨쉬는 후광 · 금색 고리 */
      let d='';
      for(let k=0;k<24;k++){const a=-Math.PI/2+k*Math.PI/12, q=k%2?r+3.5:(k%4?r+10:r+16); d+=(k?'L':'M')+(x+q*Math.cos(a)).toFixed(1)+' '+(y+q*Math.sin(a)).toFixed(1);}
      const rays=el('path',{d:d+'Z',fill:'url(#nb-ray)',opacity:.9},aura);
      anim(rays,'animateTransform',{attributeName:'transform',type:'rotate',from:`0 ${x} ${y}`,to:`360 ${x} ${y}`,dur:'26s'});
      const halo=el('circle',{cx:x,cy:y,r:r+8,fill:'url(#nb-aura)'},aura);
      anim(halo,'animate',{attributeName:'r',values:`${r+6};${r+10};${r+6}`,dur:'2.6s'});
      anim(halo,'animate',{attributeName:'opacity',values:'.55;1;.55',dur:'2.6s'});
    } else if(notable&&available){
      const ready=el('circle',{cx:x,cy:y,r:r+4.5,fill:'none',stroke:'#ffd978','stroke-width':1.3,opacity:.6},aura);
      anim(ready,'animate',{attributeName:'opacity',values:'.2;.95;.2',dur:'1.5s'});
    }
    if(notable){
      if(taken) circle(r+3.6,{fill:'none',stroke:'#ffd978','stroke-width':.9,opacity:.9});
      for(let a=0;a<4;a++) {
        const theta=a*Math.PI/2,dx=Math.cos(theta),dy=Math.sin(theta);
        el('path',{d:`M${x+dx*(r-1)} ${y+dy*(r-1)} L${x+dx*(r+2)-dy*1.5} ${y+dy*(r+2)+dx*1.5} L${x+dx*(r+3)} ${y+dy*(r+3)} L${x+dx*(r+2)+dy*1.5} ${y+dy*(r+2)-dx*1.5} Z`,fill:'url(#socket-metal)'},g);
      }
    }
    // Different silhouettes retain the basic / mixed / specialized node distinction.
    /* 찍은 전문 별만 금빛 별이 빛난다(청록 보석 안 · 더 크게). 일반 별은 흰 무늬 그대로 */
    const lit=taken&&notable;
    const ink=taken?(notable?'#fff0a8':'#dbfff0'):available?'#f1db9d':notable?'#b89453':'#87999d', s=r*(lit?.66:.43);
    if(notable||kind==='c') el('path',{d:starPath(x,y,s,s*.4),fill:ink,...(lit?{filter:'url(#starglow)'}:{})},g);
    else if(kind==='b') el('path',{d:`M${x} ${y-s} L${x+s*.8} ${y} L${x} ${y+s} L${x-s*.8} ${y} Z`,fill:ink},g);
    else if(kind==='x') {circle(s,{fill:'none',stroke:ink,'stroke-width':.8});circle(1,{fill:ink});}
    else el('path',{d:`M${x-s*.5} ${y-s} L${x+s*.7} ${y-s*.15} L${x+s*.25} ${y+s} L${x-s*.65} ${y+s*.2} Z`,fill:ink},g);
    if(lit){ const gr=r-1.8; el('ellipse',{cx:x-gr*.38,cy:y-gr*.45,rx:Math.max(.8,gr*.36),ry:Math.max(.5,gr*.2),fill:'#ffffff',opacity:.55,transform:`rotate(-30 ${(x-gr*.38).toFixed(1)} ${(y-gr*.45).toFixed(1)})`},g); }
    if(node&&Object.values(node[2]||{}).some(v=>v<0)) el('circle',{cx:x+r*.72,cy:y-r*.72,r:1.6,fill:'var(--minus)',stroke:'#10161c','stroke-width':.6},g);
  }
  for(const g of svg.querySelectorAll('.star')){
    g.addEventListener('click',()=>onSelect(g.dataset.id));
    g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(g.dataset.id);}});
  }
}
  drawSvg();
}
