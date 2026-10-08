export function audioSettingsView(s){
 const volume=Math.round(s.volume*100);
 return `<div class="mhead">소리 설정</div><section class="au-settings" data-audio-settings>
 <p class="au-lead">기체의 타격, 성장, 획득 순간을 소리로 느껴보세요.</p>
 <label class="au-mute"><input id="au-mute" type="checkbox" ${s.muted?'checked':''} onchange="ROWAR.audioMute(this.checked)"> 효과음 음소거</label>
 <label class="au-volume" for="au-volume">효과음 음량 <output id="au-value" for="au-volume">${volume}%</output></label>
 <input id="au-volume" type="range" min="0" max="100" step="1" value="${volume}" oninput="ROWAR.audioVolume(this.value)" aria-describedby="au-note">
 <button class="btn gold" data-audio-silent onclick="ROWAR.audioTest()">효과음 들어보기</button>
 <p id="au-status" role="status" aria-live="polite">${audioStatus(s)}</p>
 <p id="au-note" class="hint">설정은 이 브라우저에 저장됩니다. 배경 음악은 포함하지 않습니다.</p></section>`;
}
export function audioStatus(s){return s.unsupported?'이 브라우저에서는 효과음 재생을 지원하지 않습니다.':s.muted||!s.volume?'효과음이 꺼져 있습니다.':s.failed?'일부 효과음을 불러오지 못했습니다. 페이지를 새로고침해 다시 시도하세요.':s.ready?'효과음이 켜져 있습니다.':'버튼을 누르면 효과음이 활성화됩니다.';}
