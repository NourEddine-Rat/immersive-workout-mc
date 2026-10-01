import {qrcode} from '../engine/lib/qrcode.js';
import {hostBridge} from '../engine/host-bridge.js';
import {ConnectionNotice} from '../engine/lib/connection-notice.js';
import {connectionExplanation} from '../engine/lib/connection-explanation.js';
import {createMicrophoneRecovery} from '../engine/lib/microphone-recovery.js';

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
    <details class="pair-local-help"><summary>Connection help</summary><section class="pair-audio-help" aria-labelledby="pair-audio-title"><h3 id="pair-audio-title">Help your phone find this PC</h3><p>Microphone permission can help your browser connect locally. Your microphone opens briefly and stops immediately. No audio is recorded or sent.</p><button class="pair-audio-allow" type="button" aria-describedby="pair-audio-status">Allow microphone &amp; retry</button><p id="pair-audio-status" role="status" aria-live="polite"></p></section><p>Keep both screens open on the same Wi-Fi. Avoid guest Wi-Fi or a VPN. This option cannot connect devices that your network keeps separate.</p></details>`;
  document.body.append(dialog);
  globalThis.ConnectionDiagnostics?.mount(dialog.querySelector('.pair-local-help'));
  const $=selector=>dialog.querySelector(selector);
  let info=null,loading=false,issue='',inspecting=false,unlocked=false,offeredAudio=false;
  const notice=new ConnectionNotice();
  const microphone=createMicrophoneRecovery({onChange:()=>render(),onRetry:()=>{
    const state=hostBridge.connection;
    if(!state.active||!state.paired||state.direct)return;
    // Replace any address saved by the old diagnostic workaround. The browser
    // must discover the address itself after consent; no camera/audio is sent.
    hostBridge.setLocalAddress('');
  }});
  $('.pair-audio-allow').onclick=()=>microphone.request();
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
    const audio=microphone.snapshot;
    if(audio.pending&&(ready||!state.active||!state.paired))microphone.cancel();
    const audioButton=$('.pair-audio-allow');
    audioButton.disabled=ready||!state.active||!state.paired||audio.pending||!audio.available||audio.granted;
    audioButton.textContent=ready?'Phone connected':audio.granted?'Microphone access stopped':audio.state==='idle'?'Allow microphone & retry':audio.buttonLabel;
    const audioMessage=ready?'Connected. No microphone is needed for gameplay.':!state.paired?'Scan the QR code first. If connecting stalls, try this option.':audio.state==='idle'?'Optional. Your browser will ask you to allow microphone access.':audio.message;
    if($('#pair-audio-status').textContent!==audioMessage)$('#pair-audio-status').textContent=audioMessage;
    if(!ready&&state.active&&state.paired&&state.stage==='local-discovery'&&status.retry&&!offeredAudio){
      offeredAudio=true;$('.pair-local-help').open=true;
    }
    $('.pair-close').hidden=!ready;
    $('.pair-retry').hidden=!status.retry||ready;
    dialog.dataset.state=ready?'ready':'waiting';
    const help=audio.granted&&state.stage==='local-discovery'?'Microphone permission is allowed. If connecting still stalls, check both devices are on the same Wi-Fi and choose Retry.':connectionExplanation(state);
    const message=ready?'Phone connected over local Wi-Fi.':state.online&&!state.active?'Close your other game tab to continue here.':status.state==='reconnecting'?'Phone disconnected. Open Play on your phone.':!info&&issue?'Couldn’t prepare the QR code. Please retry.':status.state==='help'?help:status.state==='connecting'?'Connecting to your phone…':'Waiting for your phone';
    const label=$('.pair-state span');if(label.textContent!==message)label.textContent=message;
    // Pairing may finish in the background, but never interrupt the gallery entrance.
    if(!presented()||failed())return;
    if(ready){
      offeredAudio=false;
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
