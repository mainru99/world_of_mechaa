// Only served by ui-preview.mjs --sample-performance. Never in production dist.
const samples=[],tasks=[],events=[];
const support=PerformanceObserver.supportedEntryTypes;
for(const type of ['longtask','event']){
 if(!support.includes(type))continue;
 new PerformanceObserver(list=>{
  for(const e of list.getEntries()){
   if(type==='event'&&!e.interactionId)continue;
   const record={name:e.name,start:Math.round(e.startTime),ms:Math.round(e.duration)};
   if(type==='event')record.interaction=e.interactionId||0;
   const target=type==='longtask'?tasks:events;
   target.push(record);if(target.length>200)target.shift();
  }
 }).observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})});
}
performance.setResourceTimingBufferSize(1500);
const panel=document.createElement('details');
panel.id='performance-probe';panel.open=true;
panel.style.cssText='position:fixed;bottom:8px;right:8px;z-index:10000;background:#0a1925;color:#cde1ed;border:1px solid #567;padding:8px;max-width:min(440px,95vw);max-height:40vh;overflow:auto;font:12px monospace';
panel.innerHTML='<summary>로컬 성능 검수 · 가상 80기 / 파츠 1,000개</summary><button id="perf-capture" type="button">측정 기록</button> <button id="perf-frames" type="button">5초 프레임 간격</button><pre id="perf-report" style="white-space:pre-wrap">측정 대기</pre>';
document.body.append(panel);
let frameResult=null;
const round=x=>Math.round(x*10)/10;
function capture(){
 const nav=performance.getEntriesByType('navigation')[0], resources=performance.getEntriesByType('resource');
 const png=resources.filter(x=>/\/assets\/(?:monsters\/)?[^/]+\.png/.test(x.name));
 const report={scope:'local synthetic PC browser; no CPU/network throttling; not physical phone/GPU FPS/INP',at:new Date().toISOString(),
  viewport:{width:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth},
  load:{domReady:round(nav?.domContentLoadedEventEnd||0),load:round(nav?.loadEventEnd||0),fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null},
  resources:{count:resources.length,transferBytes:resources.reduce((n,x)=>n+x.transferSize,0),unitPngCount:png.length,unitPngEncodedBytes:png.reduce((n,x)=>n+x.encodedBodySize,0)},
  dom:{elements:document.querySelectorAll('*').length,inventoryCards:document.querySelectorAll('#hv-inventory .pchip').length,modals:document.querySelectorAll('[role="dialog"]').length,activeScreen:document.querySelector('.screen.active')?.id||null,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth},
  longTasks:support.includes('longtask')?tasks.slice():null,eventTiming:support.includes('event')?events.slice():null,frameIntervals:frameResult};
 samples.push(report);if(samples.length>30)samples.shift();
 document.querySelector('#perf-report').textContent=JSON.stringify({samples},null,2);
}
document.querySelector('#perf-capture').onclick=capture;
document.querySelector('#perf-frames').onclick=()=>{
 const button=document.querySelector('#perf-frames');button.disabled=true;
 const intervals=[];let start=null,prev=null,hidden=document.hidden;
 const visibility=()=>{if(document.hidden)hidden=true;};document.addEventListener('visibilitychange',visibility);
 function tick(t){
  if(start===null)start=t;
  if(prev!==null)intervals.push(t-prev);prev=t;
  if(t-start<5000){requestAnimationFrame(tick);return;}
  document.removeEventListener('visibilitychange',visibility);
  const sorted=intervals.slice().sort((a,b)=>a-b);
  frameResult={kind:'requestAnimationFrame callback gaps, not rendered FPS',hiddenDuringSample:hidden,count:sorted.length,median:round(sorted[Math.floor(sorted.length*.5)]||0),p95:round(sorted[Math.floor(sorted.length*.95)]||0),max:round(sorted.at(-1)||0),over50ms:sorted.filter(x=>x>50).length};
  button.disabled=false;capture();
 }
 requestAnimationFrame(tick);
};
