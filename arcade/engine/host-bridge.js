import {DirectLink} from './direct-link.js';
import {screenSession} from './screen-session.js';
import {readSessions, mergeSessions, JOURNAL_KEY} from './activity-store.js';
import {uuid} from './lib/identity.js';
import {lanIPv4} from './lib/local-route.js';
import * as Profile from './profile.js';
const remote = new URLSearchParams(location.search).get('controller') === '1';
const route = location.pathname;
const game = route.includes('/subway')?'subway':route.includes('/track')?'track':route.includes('/red-light')?'redlight':route.includes('/jump-rope')?'jumprope':route.includes('/training')?'training':'hub';
const id = uuid();
let socket, stopped=false, retry, pairedUser=null, pairedClient=null, lastPairedClient=null, active=false, uiRevision=0, lastUI='', buttons=[], snapshot=null, journal=readSessions(), current=null;
const visible = el => el && !el.closest('[hidden]') && getComputedStyle(el).display!=='none' && el.getClientRects().length>0;
const listeners=new Set(),connectionListeners=new Set();
let direct,lastSample=0,firstSample=0,motion='needed';
const ADDRESS_KEY='inmotion.local-address.v1';
let addressHint='';
try{const saved=sessionStorage.getItem(ADDRESS_KEY);if(lanIPv4(saved))addressHint=saved;}catch{}
const diagnostic=globalThis.ConnectionDiagnostics;
const signal=m=>{if(socket?.readyState===1){try{socket.send(JSON.stringify(m));return true;}catch{}}return false;};
if(!remote)diagnostic?.bind('host',signal);
let lastSignal=0;
const send=m=>active&&direct?.send({...m,hostId:id});
function save(){try{journal=mergeSessions(readSessions(),journal);localStorage.setItem(JOURNAL_KEY,JSON.stringify(journal));}catch{send({t:'host-warning',message:'PC storage is full. Keep this phone connected to save the session.'});}}
function syncHistory(){
  journal=mergeSessions(readSessions(),journal);
  if(!pairedUser)return;
  const rows=journal.filter(row=>row.userId===pairedUser.id);
  for(let i=0;i<rows.length;i+=30)send({t:'session-history',userId:pairedUser.id,rows:rows.slice(i,i+30)});
}
function profile(m){
  if(typeof m.clientId!=='string'||m.clientId.length>100||!m.profile||m.profile.id!==m.clientId)return;
  const changing=lastPairedClient&&lastPairedClient!==m.clientId;
  if(changing&&current&&!current.complete)hostBridge.update(snapshot?.()||{});
  pairedClient=lastPairedClient=m.clientId;pairedUser=m.profile;
  const calibration=Profile.selectUser(m.clientId,m.profile.calibration);
  if(calibration)send({t:'phone-calibration',userId:m.clientId,calibration});
  // Weight reaches both future games and an already-open game's calorie model.
  const kg=Number.isFinite(m.profile.weightKg)&&m.profile.weightKg>=30&&m.profile.weightKg<=200?m.profile.weightKg:70;
  if(Number.isFinite(kg)&&kg>=30&&kg<=200){
    try{localStorage.setItem('subway.kg',String(kg));localStorage.setItem('squid.kg',String(kg));}catch{}
    const input=document.getElementById('kgIn');if(input){input.value=String(kg);input.dispatchEvent(new Event('change'));}
  }
  syncHistory();publish();
  if(changing&&game!=='hub')location.assign('/');
}
function publish(){
  if(remote||!active)return;
  const overlay=document.getElementById('overlay');
  const scope=game==='training'?document.getElementById('actions'):document.getElementById('overlayBtns');
  const next=[...(scope?.querySelectorAll('button')||[])].filter(b=>visible(b)&&!b.disabled);
  const heading=game==='hub'?'Choose a game':game==='training'?document.getElementById('title')?.textContent:visible(overlay)?document.getElementById('overlayTitle')?.textContent:'Game in progress';
  const body=game==='training'?document.getElementById('say')?.textContent:visible(overlay)?document.getElementById('overlayText')?.innerText:'';
  const signature=JSON.stringify([heading,body,next.map(b=>b.textContent)]);
  if(signature!==lastUI||next.some((b,i)=>b!==buttons[i])){uiRevision++;lastUI=signature;buttons=next;}
  send({t:'host-state',game,heading:heading||'Loading game',text:(body||'Watch your PC. Your phone controls the game.').slice(0,1500),revision:uiRevision,actions:buttons.map((b,i)=>({id:i,label:b.textContent.trim()})),clientId:pairedClient,live:snapshot?.()||null});
}
function connectionState(){
  const detail=hostBridge.connection;
  dispatchEvent(new CustomEvent('screen-connection',{detail}));
  for(const listener of connectionListeners)listener(detail);
}
function receive(m){
  if(!active)return;
  if(m.t==='phone-profile')profile(m);
  if(m.t==='samples'){
    const now=performance.now();if(now-lastSample>1000)firstSample=now;lastSample=now;
  }
  if(m.t==='phone-presence'){
    motion=m.motion;
    if(motion!=='ready')firstSample=lastSample=0;
    connectionState();
  }
  if(m.t==='phone-release'&&m.clientId===pairedClient){pairedClient=null;pairedUser=null;direct.close();publish();}
  if(m.t==='host-sync'){publish();syncHistory();}
  if(m.t==='host-action'&&m.clientId===pairedClient&&m.revision===uiRevision){const b=buttons[m.action];if(visible(b)&&!b.disabled){buttons=[];uiRevision++;b.click();publish();}}
  if(m.t==='host-home'&&m.clientId===pairedClient)location.assign('/');
  for(const listener of listeners)listener(m);
}
direct=new DirectLink({role:'host',signal,addressHint,onMessage:receive,onState:state=>{
  if(!state.direct)firstSample=lastSample=0;
  connectionState();if(state.direct){publish();syncHistory();}
}});
async function connect(){
  if(remote||stopped||socket?.readyState<2)return;
  try{await screenSession(true);}catch(error){if(!direct.up){direct.state('signaling',error.message);connectionState();}if(!stopped)retry=setTimeout(connect,2500);return;}
  if(stopped)return;
  if(socket?.readyState<2)return;
  diagnostic?.record('ws-opening');
  const ws=socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws?role=console`);
  ws.onopen=()=>{lastSignal=Date.now();diagnostic?.record('ws-open');signal({t:'host-register',hostId:id});diagnostic?.flush();};
  ws.onmessage=e=>{
    if(socket!==ws)return;
    let m;try{m=JSON.parse(e.data);}catch{return;}
    lastSignal=Date.now();if(diagnostic?.receive(m))return;
    if(m.hostId&&m.hostId!==id)return;
    if(m.t==='host-active'){
      active=m.active;
      if(!active)direct.close();
      connectionState();return;
    }
    if(!active)return;
    if(m.t==='peer-phone'){
      if(!m.clientId||!m.peerId){pairedClient=null;pairedUser=null;direct.close();return;}
      const same=direct.peer?.peerId===m.peerId&&direct.peer?.hostId===id;
      pairedClient=m.clientId;direct.setPeer({hostId:id,clientId:m.clientId,peerId:m.peerId});
      // A rejoined signaling socket may have lost an offer/answer. A working
      // data channel survives the socket outage, unfinished negotiations restart.
      if(same&&!direct.up&&performance.now()-direct.started>3000)direct.retry();
    }
    if(m.t==='rtc-signal')direct.signal(m);
  };
  ws.onclose=e=>{if(socket!==ws)return;diagnostic?.record('ws-close',{code:e.code,clean:e.wasClean});if(!direct.up){direct.state('signaling','Reconnecting to the pairing server…');connectionState();}if(!stopped)retry=setTimeout(connect,1000);};
  ws.onerror=()=>{diagnostic?.record('ws-error');ws.close();};
}
export const hostBridge={
  connectionInfo:screenSession,
  get connection(){
    const status=direct.snapshot(),age=performance.now()-lastSample;
    return {active,online:socket?.readyState===1||status.direct,connected:status.direct,paired:!!pairedClient,motion,
      ready:active&&status.direct&&motion==='ready'&&lastSample>0&&age<1000&&lastSample-firstSample>=250,
      sampleAge:age,direct:status.direct,route:status.route,rttMs:status.rttMs,localStatus:status.status,stage:status.stage,reason:status.reason,attempt:status.attempt,
      error:!status.direct&&['blocked','unsupported','signaling'].includes(status.status)?status.message:null,
      message:status.message};
  },
  send,
  retryLocal(){if(socket?.readyState!==1)connect();direct.retry();},
  get localAddress(){return direct.addressHint;},
  setLocalAddress(value){
    const address=String(value||'').trim();
    if(address&&!lanIPv4(address))throw Error('Enter this PC’s private Wi-Fi IPv4 address, such as 192.168.1.20.');
    direct.addressHint=address;
    try{if(address)sessionStorage.setItem(ADDRESS_KEY,address);else sessionStorage.removeItem(ADDRESS_KEY);}catch{}
    direct.retry();
  },
  onMessage(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
  onConnection(listener){connectionListeners.add(listener);listener(hostBridge.connection);return ()=>connectionListeners.delete(listener);},
  get id(){return id;},get active(){return active;},get clientId(){return pairedClient;},
  setSnapshot(fn){snapshot=fn;},publish,
  begin(){
    current={id:uuid(),userId:pairedUser?.id||'unpaired',game,startedAt:Date.now(),updatedAt:Date.now(),complete:false,steps:0};
  },
  step(){if(current&&!current.complete&&['play','running'].includes(snapshot?.()?.phase))current.steps++;},
  update(values,complete=false){
    if(!current||current.complete||window.__devPreview||new URLSearchParams(location.search).has('dev'))return;
    if(current.userId==='unpaired'&&pairedUser)current.userId=pairedUser.id;
    Object.assign(current,values,{updatedAt:Date.now(),complete});
    journal=mergeSessions(journal,[current]);save();
    if(pairedUser&&current.userId===pairedUser.id)send({t:'session-history',userId:pairedUser.id,rows:[current]});
  }
};
if(!remote){connect();setInterval(publish,1000);setInterval(connectionState,250);setInterval(()=>{signal({t:'heartbeat'});if(socket?.readyState===1&&Date.now()-lastSignal>12000){diagnostic?.record('ws-timeout');socket.close();}},2000);addEventListener('online',()=>connect());addEventListener('pagehide',()=>{if(['play','running'].includes(snapshot?.()?.phase))hostBridge.update(snapshot());stopped=true;clearTimeout(retry);direct.close();socket?.close();});addEventListener('pageshow',e=>{if(e.persisted){stopped=false;connect();}});}
addEventListener('calibration-saved',e=>{if(pairedUser)send({t:'phone-calibration',userId:pairedUser.id,calibration:e.detail});});
