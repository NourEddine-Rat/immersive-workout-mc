import {hostBridge} from '../engine/host-bridge.js';
if(new URLSearchParams(location.search).get('controller')!=='1'){
  const card=document.getElementById('phone-status'),label=document.getElementById('phone-state');
  function render(){
    if(!card)return;
    const connection=hostBridge.connection;
    const state=window.__phonePreview||(connection.ready?'live':connection.connected?'weak':'offline');
    card.dataset.state=state;
    label.textContent={live:'local wifi',weak:'local wifi',offline:'Connect phone'}[state];
  }
  addEventListener('screen-connection',render);setInterval(render,500);render();
}
