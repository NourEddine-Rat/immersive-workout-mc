import {qrcode} from '../engine/lib/qrcode.js';
import {hostBridge} from '../engine/host-bridge.js';
import {ConnectionNotice} from '../engine/lib/connection-notice.js';
import {connectionExplanation} from '../engine/lib/connection-explanation.js';

if(new URLSearchParams(location.search).get('controller')!=='1'){
  const trigger=document.getElementById('phone-status'),frame=document.querySelector('.frame');
  const dialog=document.createElement('dialog');
  dialog.className='pair-dialog';
  dialog.setAttribute('aria-labelledby','pair-title');
  dialog.setAttribute('aria-describedby','pair-help');
  dialog.innerHTML=`
    <button type="button" class="pair-close" aria-label="Close connection code" hidden>Close</button>
    <header class="pair-header">YOUR PHONE IS THE CONTROLLER</header>
    <h2 id="pair-title" tabindex="-1">Let’s get you moving.</h2>
    <p id="pair-help">Connect your phone. The game is waiting for you.</p>
    <div class="pair-layout">
      <div class="pair-scan"><div class="pair-qr" aria-label="Phone pairing QR code"><span class="pair-loading">Preparing QR…</span></div><span class="pair-scan-label">Scan with your phone camera</span></div>
      <div class="pair-instructions">
        <span class="pair-code-label">OR CONNECT WITH A CODE</span>
        <strong class="pair-code" aria-label="Connection code">······</strong>
        <p class="pair-manual">Open the link below on your phone<br>and enter these six digits.</p>
        <div class="pair-motion-step"><strong>Before you play</strong><p>Enable motion on your phone when you’re ready to play. Keep your screen unlocked.</p></div>
      </div>
    </div>
    <div class="pair-link-row"><a class="pair-address" target="_blank" rel="noopener">Preparing phone link…</a><button class="pair-copy" type="button" disabled>Copy link</button></div>
    <p class="pair-network"></p><details class="pair-trouble" hidden><summary>Phone not opening the link?</summary><p class="pair-warning"></p></details>
    <footer class="pair-state" role="status" aria-live="polite"><span>Preparing your connection…</span><button class="pair-retry" type="button" hidden>Retry</button></footer>
    <details class="pair-local-help"><summary>Connection help</summary><p>Allow Local Network access in your browser and use the same Wi-Fi on both devices. If automatic discovery fails, enter this PC’s IPv4 address from its Wi-Fi settings.</p><form class="pair-local-form"><label for="pair-local-address">PC Wi-Fi address</label><div><input id="pair-local-address" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="192.168.1.20" aria-describedby="pair-local-feedback"><button type="submit">Connect directly</button></div><p id="pair-local-feedback" role="status"></p><button class="pair-local-reset" type="button" hidden>Use automatic discovery</button></form></details>`;
  document.body.append(dialog);
  globalThis.ConnectionDiagnostics?.mount(dialog.querySelector('.pair-local-help'));
  const diagnosticStage=document.createElement('p');diagnosticStage.setAttribute('aria-live','polite');dialog.querySelector('.pair-local-help').append(diagnosticStage);
  const $=selector=>dialog.querySelector(selector);
  $('#pair-local-address').value=hostBridge.localAddress;
  $('.pair-local-reset').hidden=!hostBridge.localAddress;
  $('.pair-local-form').onsubmit=e=>{
    e.preventDefault();
    try{hostBridge.setLocalAddress($('#pair-local-address').value);$('#pair-local-feedback').textContent='Trying this Wi-Fi address. Keep your phone’s Play screen open.';$('.pair-local-reset').hidden=!hostBridge.localAddress;}
    catch(error){$('#pair-local-feedback').textContent=error.message;}
  };
  $('.pair-local-reset').onclick=()=>{hostBridge.setLocalAddress('');$('#pair-local-address').value='';$('#pair-local-feedback').textContent='Automatic discovery restored.';$('.pair-local-reset').hidden=true;};
  let info=null,loading=false,issue='',inspecting=false,unlocked=false;
  const notice=new ConnectionNotice();
  const presented=()=>window.galleryIntro?.presented===true;
  const failed=()=>window.galleryIntro?.failed===true;
  const connected=()=>hostBridge.connection.active&&hostBridge.connection.direct;
  window.phoneGate={get ready(){return presented()&&!failed()&&connected();}};
  function show(){
    if(!presented()||failed())return;
    if(!dialog.open){dialog.showModal();$('#pair-title').focus({preventScroll:true});}
    frame.inert=true;
  }
  function unlock(){
    if(!window.phoneGate.ready)return;
    dialog.close();frame.inert=false;
    if(!unlocked){unlocked=true;dispatchEvent(new Event('phone-gate-ready'));}
  }
  function paintCode(code){
    $('.pair-code').replaceChildren(...Array.from(code,digit=>{const span=document.createElement('span');span.textContent=digit;return span;}));
    $('.pair-code').setAttribute('aria-label','Connection code: '+Array.from(code).join(' '));
  }
  async function refresh(){
    if(loading)return;loading=true;
    try{
      const next=await hostBridge.connectionInfo(true);
      if(!next.phoneUrl||!/^\d{6}$/.test(next.pairCode))throw Error('Could not prepare your connection. Please retry.');
      // Build code and QR together, including when a restarted server issues a new code.
      if(next.phoneUrl!==info?.phoneUrl||!$('.pair-qr svg')){
        const url=new URL(next.phoneUrl);
        if(!['http:','https:'].includes(url.protocol))throw Error('The phone address is unavailable.');
        const qr=qrcode(0,'M');qr.addData(url.href);qr.make();
        $('.pair-qr').innerHTML=qr.createSvgTag({cellSize:4,margin:16,scalable:true});
        paintCode(next.pairCode);
        const entry=next.phoneEntry||new URL('/phone.html',url).href;
        $('.pair-address').textContent=entry.replace(/^https?:\/\//,'');
        $('.pair-address').href=url.href;
      }
      info=next;issue=next.phoneError||'';$('.pair-copy').disabled=false;
      $('.pair-trouble').hidden=!next.phoneWarning;$('.pair-warning').textContent=next.phoneWarning||'';
      $('.pair-network').textContent='Same Wi-Fi required. Motion travels directly to your PC.';
    }catch(error){
      issue=error.name==='AbortError'?'The connection is taking too long. Check your network and retry.':error.message||'Could not reach the game server. Please retry.';
    }finally{loading=false;render();}
  }
  function render(){
    const state=hostBridge.connection,ready=connected();
    const status=notice.update({connected:ready,pending:state.paired||!!issue||!!state.error,failed:!!issue||!!state.error});
    $('.pair-close').hidden=!ready;
    $('.pair-retry').hidden=!status.retry||ready;
    dialog.dataset.state=ready?'ready':'waiting';
    const message=ready?'Phone connected over local Wi-Fi.':state.online&&!state.active?'Close your other game tab to continue here.':status.state==='reconnecting'?'Phone disconnected. Open Play on your phone.':!info&&issue?'Couldn’t prepare the QR code. Please retry.':status.state==='help'?connectionExplanation(state):status.state==='connecting'?'Connecting to your phone…':'Waiting for your phone';
    const detail=connectionExplanation(state);if(diagnosticStage.textContent!==detail)diagnosticStage.textContent=detail;
    const label=$('.pair-state span');if(label.textContent!==message)label.textContent=message;
    // Pairing may finish in the background, but never interrupt the gallery entrance.
    if(!presented()||failed())return;
    if(ready){
      if(!inspecting)unlock();
    }else{
      inspecting=false;unlocked=false;
      const about=document.getElementById('game-about');if(about?.open)about.close();
      show();
    }
  }
  $('.pair-close').onclick=unlock;
  dialog.addEventListener('cancel',e=>{e.preventDefault();unlock();});
  $('.pair-retry').onclick=()=>{const button=$('.pair-retry');button.disabled=true;hostBridge.retryLocal();refresh();setTimeout(()=>button.disabled=false,1500);};
  $('.pair-copy').onclick=async()=>{
    try{await navigator.clipboard.writeText(info.phoneUrl);$('.pair-copy').textContent='Copied';}
    catch{
      // Clipboard access can be unavailable on a PC opened through plain LAN HTTP.
      const input=document.createElement('textarea');input.value=info.phoneUrl;input.className='pair-copy-input';dialog.append(input);input.select();
      let copied=false;try{copied=document.execCommand('copy');}catch{}input.remove();
      if(!copied){const range=document.createRange();range.selectNodeContents($('.pair-address'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
      $('.pair-copy').textContent=copied?'Copied':'Select & copy';
    }
    setTimeout(()=>$('.pair-copy').textContent='Copy link',2200);
  };
  trigger.setAttribute('role','button');trigger.tabIndex=0;trigger.setAttribute('aria-label','Show phone connection');
  trigger.onclick=()=>{inspecting=connected();show();refresh();};
  trigger.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();trigger.click();}};
  addEventListener('screen-connection',render);
  addEventListener('gallery-presented',render);
  addEventListener('gallery-unavailable',()=>{dialog.close();frame.inert=false;});
  addEventListener('pageshow',()=>{render();refresh();});
  setInterval(render,500);setInterval(()=>{if(dialog.open)refresh();},5000);
  refresh();
}
