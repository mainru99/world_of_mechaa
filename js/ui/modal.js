/* Native modal isolation follows authentication changes without overwriting
 * #app.inert. Replacement views keep the original opener and matching control. */
export function createModal(root) {
  const doc=root.ownerDocument;
  let opener=null;
  function close() {
    if(!root.open) return;
    root.classList.remove('on');
    root.close();
    cleanup();
  }
  function cleanup(){
    // A close event can arrive after another view has already reopened it.
    if(root.open) return;
    root.replaceChildren();
    doc.documentElement.classList.remove('ui-modal-open');
    if(opener?.isConnected&&!opener.closest('[inert]')) opener.focus({preventScroll:true});
    opener=null;
  }
  root.addEventListener('close',cleanup);
  root.addEventListener('cancel',event=>{event.preventDefault();close();});
  root.addEventListener('click',event=>{if(event.target===root) close();});
  root.addEventListener('keydown',event=>{
    if(event.key!=='Tab') return;
    const card=root.firstElementChild;
    const fields=[...card.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.closest('[hidden], [inert]'));
    const first=fields[0],last=fields.at(-1);
    if(!first){event.preventDefault();card.focus();return;}
    if(event.shiftKey&&(doc.activeElement===first||doc.activeElement===card)){
      event.preventDefault();last.focus();
    } else if(!event.shiftKey&&(doc.activeElement===last||doc.activeElement===card)){
      event.preventDefault();first.focus();
    }
  });
  function open(html) {
    const replacing=root.open;
    const focused=replacing&&root.contains(doc.activeElement)?doc.activeElement.id:null;
    const scroll=replacing?root.querySelector('.ui-modal-body')?.scrollTop||0:0;
    const navScroll=replacing?root.querySelector('.cv-guide-nav')?.scrollTop||0:0;
    if(!replacing) opener=doc.activeElement;
    root.innerHTML=`<section class="modal-card" tabindex="-1">${html}</section>`;
    const card=root.firstElementChild;
    let head=card.querySelector('.mhead');
    const title=doc.createElement('h2');title.id='modal-title';
    if(head){
      title.textContent=[...head.childNodes].filter(node=>node.nodeName!=='BUTTON').map(node=>node.textContent).join('').trim();
      head.remove();
    }else{head=doc.createElement('header');head.className='mhead';title.textContent='상세 정보';}
    const dismiss=doc.createElement('button');
    dismiss.type='button';dismiss.className='mx';dismiss.textContent='×';
    dismiss.setAttribute('aria-label','팝업 닫기');dismiss.onclick=close;
    head.replaceChildren(title,dismiss);
    const body=doc.createElement('div');body.className='ui-modal-body';
    body.append(...card.childNodes);card.append(head,body);
    card.classList.toggle('ui-modal-wide',!!body.querySelector('.cv-guide, .gv-catalog, .cv-app, .dg-app'));
    card.classList.toggle('ui-modal-replacing',replacing);
    root.setAttribute('aria-labelledby',title.id);
    root.classList.add('on');doc.documentElement.classList.add('ui-modal-open');
    if(!replacing) root.showModal();
    const matching=focused?doc.getElementById(focused):null;
    const nav=body.querySelector('.cv-guide-nav');if(nav) nav.scrollTop=navScroll;
    if(matching&&card.contains(matching)){body.scrollTop=nav?0:scroll;matching.focus({preventScroll:true});}
    else card.focus({preventScroll:true});
  }
  return {open,close};
}
