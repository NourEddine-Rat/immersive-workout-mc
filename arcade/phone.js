import {DirectLink} from './engine/direct-link.js';
import {uuid} from './engine/lib/identity.js';
import './phone/store.js';
// The phone half of Subway: read the motion sensors, send them, stay awake.
//
// Deliberately thin. All the judgement — what counts as a jump, where the
// player is facing, whether a rep landed on the beat — happens on the Mac, so
// that the code deciding things LIVE is byte for byte the code that will later
// re-decide them offline over the recording. Two implementations of a detector
// is two chances to be wrong about which one we measured.
//
// Samples cross the direct local channel immediately, one per packet.
// The phone never uploads motion to the signaling server.

import { packSample, BATCH } from './engine/lib/protocol.js';
import { AR, langInit } from './engine/localization.js';
langInit();

const $ = id => document.getElementById(id);
const state = $('state'), hint = $('hint');
const app=window.PhoneApp;
const instanceId=uuid();
let motionStatus='needed', motionBusy=false,motionRequestedAt=0, closed=false, reconnectTimer, authenticated=false, replaced=false, lastMessage=0;
function motionChange(status,text){motionStatus=status;if(text)hint.textContent=text;window.dispatchEvent(new CustomEvent('phone-motion',{detail:{status,text:hint.textContent}}));if(authenticated)send({t:'phone-presence',motion:status});}
window.PhoneMotion={get status(){return motionStatus;},get running(){return running;},enable:()=>startMotion(),stop:()=>{document.getElementById('shield')?.remove();running=false;window.removeEventListener('devicemotion',onMotion);batch=[];lastTs=0;rateEst=0;wakeLock?.release().catch(()=>{});useVideo(false);state.textContent='Not started';$('start').textContent='Start sensing';motionChange('needed','Motion is off. Enable it again when you are ready to play.');},lock:()=>{if(running)shield();}};

let ws = null, running = false, pocket = 'right', mode = 'idle';
let sent = 0, batch = [], lastTs = 0, rateEst = 0, rtt = 0, wakeLock = null;
let gravityMode = null;          // 'os' | 'os-flipped' | 'lowpass'
let gLow = null;                 // fallback low-passed gravity
const recent = [];               // for the little on-screen bars

// ------------------------------------------------------------------- the link

const signal=o=>{if(ws?.readyState===1){try{ws.send(JSON.stringify({...o,clientId:app.id}));return true;}catch{}}return false;};
const direct=new DirectLink({role:'phone',signal,onMessage:receive,onState:status=>{
  batch=[];
  window.dispatchEvent(new CustomEvent('phone-link',{detail:{connected:status.direct}}));
  window.dispatchEvent(new CustomEvent('phone-local',{detail:status}));
  set('rLink',status.direct?'direct Wi-Fi':status.status,status.direct?'ok':'warn');
  if(status.direct){
    sendProfile();send({t:'phone-presence',motion:motionStatus});send({t:'host-sync'});send({t:'carousel-sync'});
    send({t:'hello',pocket,conv:'webkit',mirrored:MIRROR,screen:[screen.width,screen.height]});
  }
}});
window.PhoneConnection={get status(){return direct.snapshot();},retry:()=>direct.retry()};
function setPeer(m){
  if(m.hostId&&m.peerId)direct.setPeer({hostId:m.hostId,clientId:app.id,peerId:m.peerId});
}
function receive(m){
  if(m.t==='phone-calibration'&&m.userId===app.id&&m.calibration?.v===1){app.save('inmotion.calibration.v1',m.calibration);return;}
  if(['host-state','host-warning','session-history'].includes(m.t)){window.dispatchEvent(new CustomEvent('phone-host',{detail:m}));return;}
  if(m.t==='carousel-state'){window.dispatchEvent(new CustomEvent('phone-carousel',{detail:m}));return;}
  if(m.t==='ping'){send({t:'pong',seq:m.seq,t0:m.t0,tp:now()});return;}
  if(m.t==='rtt'){rtt=m.ms;set('rRtt',`${Math.round(m.ms)} ms`,m.ms<25?'ok':m.ms<60?'warn':'bad');return;}
  if(m.t==='mode'){mode=m.mode;showMode();return;}
  if(m.t==='say'){hint.textContent=m.text;return;}
  if(m.t==='scene')scene(m);
}
function connect(){
  if(closed||replaced||ws&&ws.readyState<2)return;
  clearTimeout(reconnectTimer);
  const socket=ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws?role=phone`);
  socket.onopen=()=>{if(ws!==socket)return;lastMessage=Date.now();join();};
  socket.onclose=()=>{
    if(ws!==socket)return;
    // Existing data channels keep working during a signaling-server outage.
    if(!direct.up){authenticated=false;window.dispatchEvent(new CustomEvent('phone-link',{detail:{connected:false}}));}
    if(!closed&&!replaced)reconnectTimer=setTimeout(connect,1000);
  };
  socket.onerror=()=>socket.close();
  socket.onmessage=e=>{
    if(ws!==socket)return;
    let m;try{m=JSON.parse(e.data);}catch{return;}lastMessage=Date.now();
    if(m.t==='phone-paired'){
      authenticated=true;
      window.dispatchEvent(new CustomEvent('phone-host',{detail:m}));
      setPeer(m);if(direct.up){sendProfile();send({t:'host-sync'});}return;
    }
    if(m.t==='peer-host'){setPeer(m);return;}
    if(m.t==='rtc-signal'){direct.signal(m);return;}
    if(m.t==='phone-replaced'){authenticated=false;replaced=true;direct.close();window.PhoneMotion.stop();ws.close();}
    if(m.t==='pair-expired'){authenticated=false;direct.close();app.save('inmotion.pair.v1',null);window.PhoneMotion.stop();}
    if(m.t==='host-busy'){authenticated=false;direct.close();}
    if(['phone-replaced','pair-expired','host-busy'].includes(m.t))window.dispatchEvent(new CustomEvent('phone-host',{detail:m}));
  };
}
const send=o=>{
  if(!authenticated)return false;
  return direct.send({...o,clientId:app.id,hostId:direct.peer?.hostId});
};
const join=()=>{const pair=app.read('inmotion.pair.v1',null);if(app.onboarded&&pair)signal({t:'phone-join',pairCode:pair.code,instanceId});};
const sendProfile=()=>send({t:'phone-profile',profile:app.profile});
window.addEventListener('phone-profile',sendProfile);
window.addEventListener('phone-paired',()=>{replaced=false;connect();join();});
setInterval(()=>{
  if(ws?.readyState===1){
    signal({t:'heartbeat'});
    if(Date.now()-lastMessage>12000){ws.close();return;}
    if(!authenticated&&!replaced)join();
  }
  if(direct.up)send({t:'phone-presence',motion:motionStatus});
},1000);
window.addEventListener('online',()=>{if(ws?.readyState>1)connect();});
window.addEventListener('phone-command',e=>{
  if(!['carousel-move','carousel-pick','carousel-sync','host-sync','host-action','host-home','phone-release','phone-profile'].includes(e.detail?.t))return;
  send(e.detail);
  if(e.detail.t==='phone-release'){signal({t:'phone-release'});authenticated=false;direct.close();}
});
const now = () => (performance.timeOrigin || Date.now()-performance.now()) + performance.now();

// --------------------------------------------------------------- the sensors

/**
 * iOS reports both the total acceleration and the user's part of it, so
 * gravity is the difference — except that Safari has historically flipped the
 * sign of one of them relative to the specification, and a flipped gravity
 * vector would point the whole coordinate frame at the ceiling.
 *
 * Rather than encode a belief about which Safari this is, measure it: on the
 * first still second, whichever of (total - user) and (total + user) comes out
 * near 9.81 is the real gravity. If neither does, the phone is not giving us a
 * usable split and we fall back to low-passing the total, which is always
 * available and merely slower.
 */
function pickGravityMode(tot, usr) {
  const minus = Math.hypot(tot.x - usr.x, tot.y - usr.y, tot.z - usr.z);
  const plus = Math.hypot(tot.x + usr.x, tot.y + usr.y, tot.z + usr.z);
  const near = v => Math.abs(v - 9.80665) < 1.2;
  if (near(minus) && !near(plus)) return 'os';
  if (near(plus) && !near(minus)) return 'os-flipped';
  if (near(minus)) return 'os';
  return 'lowpass';
}

function gravityOf(tot, usr, dt) {
  if (gravityMode === 'os') return [tot.x - usr.x, tot.y - usr.y, tot.z - usr.z];
  if (gravityMode === 'os-flipped') return [tot.x + usr.x, tot.y + usr.y, tot.z + usr.z];
  const a = Math.min(1, dt / 0.25);           // ~250 ms to follow the leg
  const v = [tot.x, tot.y, tot.z];
  if (!gLow) gLow = v;
  else gLow = gLow.map((g, i) => g + (v[i] - g) * a);
  return gLow.slice();
}

// Every browser reports the accelerometer, but not with the same sign. iOS
// (all of it — every iOS browser is WebKit) reports gravity pointing down at
// rest; the specification, and so Android, reports it pointing up. The wire
// carries the iOS convention, so anything else is mirrored here, once, and
// nothing downstream has to know.
const MIRROR = !(/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
const fix = v => (MIRROR && v && v.x != null) ? { x: -v.x, y: -v.y, z: -v.z } : v;

let lastDisplaySample=0;
function onMotion(e) {
  if(!running||document.hidden)return;
  const tot = fix(e.accelerationIncludingGravity);
  const usr = fix(e.acceleration);
  const rot = e.rotationRate;
  if (!tot || ![tot.x,tot.y,tot.z].every(Number.isFinite)) return;

  const t = now();
  if(motionStatus!=='ready')motionChange('ready','Motion is ready. Put your phone in your right front pocket to play.');
  if(lastTs && t<=lastTs)return;
  const dt = lastTs ? Math.max(.001,Math.min(0.2, (t - lastTs) / 1000)) : 1 / 60;
  if (lastTs) rateEst = rateEst * 0.95 + (1 / dt) * 0.05;
  lastTs = t;

  if (gravityMode === null) {
    if (usr && [usr.x,usr.y,usr.z].every(Number.isFinite)) gravityMode = pickGravityMode(tot, usr);
    else gravityMode = 'lowpass';
  }
  const g = gravityOf(tot, usr || { x: 0, y: 0, z: 0 }, dt);

  const s = {
    t,
    a: [tot.x, tot.y, tot.z],
    g,
    // rotationRate is named for the axes it turns about: beta about x,
    // gamma about y, alpha about z. Degrees per second. iOS reports it with
    // the sign mirrored, like the accelerometer; the wire carries iOS's
    // convention, so anything else is mirrored to match.
    w: rot ? [rot.beta, rot.gamma, rot.alpha].map(v => Number.isFinite(v)?(MIRROR ? -v : v):0) : [0, 0, 0],
  };

  batch.push(packSample(s));
  if(window.PhoneLive?.visible&&t-lastDisplaySample>=33){
    lastDisplaySample=t;
    window.dispatchEvent(new CustomEvent('phone-motion-sample',{detail:{acceleration:s.a.map((v,i)=>v-s.g[i]),rotation:s.w,rate:rateEst}}));
  }
  const size = mode === 'play' ? 1 : BATCH;
  if (batch.length >= size) {
    send({ t: 'samples', rows: batch });
    sent += batch.length; batch = [];
    if ((sent & 31) === 0) {
      set('rSent', sent.toLocaleString());
      set('rRate', `${rateEst.toFixed(0)} Hz`, rateEst > 45 ? 'ok' : rateEst > 25 ? 'warn' : 'bad');
    }
  }

  recent.push(Math.hypot(tot.x, tot.y, tot.z) / 9.80665);
  if (recent.length > 240) recent.shift();
}

// --------------------------------------------------------------- staying awake

/**
 * A phone in a pocket has no reason to stay awake, and a locked screen stops
 * `devicemotion` dead — no web page senses through a lock. So the page never
 * lets it lock, and never trusts that it asked once:
 *
 *   1. the Screen Wake Lock (iOS 16.4+, Android Chrome), asked for again
 *      whenever it is released and checked every few seconds, since the
 *      browser drops it quietly on any hiccup;
 *   2. if the lock is refused or missing, a silent, invisible, looping video —
 *      a playing video keeps a phone awake on every browser. It is primed
 *      inside the Start tap, so it may play later without another touch.
 *
 * Whatever holds it, the row says which, so a sleep never looks like a sensor
 * problem.
 */
const video = $('awake');
let videoOn = false, hiddenAt = 0, wakePending=false;
function useVideo(on) {
  videoOn = on;
  if (on) video.play().catch(() => {}); else video.pause();
}
async function keepAwake() {
  if (!running || document.visibilityState !== 'visible') return;
  if(wakePending)return;
  if ('wakeLock' in navigator) {
    if (wakeLock && !wakeLock.released) return;
    try {
      wakePending=true;
      wakeLock = await navigator.wakeLock.request('screen');
      if(!running||document.hidden){await wakeLock.release();return;}
      wakeLock.addEventListener('release', () => { showAwake(); setTimeout(keepAwake, 300); });
      useVideo(false);
      return showAwake();
    } catch { /* refused (low power, no focus…): fall through to the video */ }
    finally{wakePending=false;}
  }
  useVideo(true);
  showAwake();
}
function showAwake() {
  if (wakeLock && !wakeLock.released) set('rLock', 'yes · wake lock', 'ok');
  else if (videoOn && !video.paused) set('rLock', 'yes · video', 'ok');
  else set('rLock', 'at risk — set Auto-Lock to Never', 'bad');
}
setInterval(() => { if (running) { keepAwake(); showAwake(); } }, 4000);
video.addEventListener('playing', showAwake);
video.addEventListener('pause', showAwake);

document.addEventListener('visibilitychange', () => {
  if (!running) return;
  if (document.visibilityState === 'visible') {
    batch=[];lastTs=0;rateEst=0;gravityMode=null;gLow=null;motionRequestedAt=now();motionChange('waiting','Keep this page open. Checking motion again…');
    keepAwake();
    if (hiddenAt) send({ t: 'warn', text: `phone page was away for ${((Date.now() - hiddenAt) / 1000).toFixed(1)} s` });
    hiddenAt = 0;
  } else {
    batch=[];motionChange('suspended','Motion pauses while your phone is locked or this page is in the background.');
    hiddenAt = Date.now();
    send({ t: 'warn', text: 'phone page went to the background' });
  }
});
addEventListener('pageshow', () => keepAwake());
addEventListener('focus', () => keepAwake());

// ------------------------------------------------------------- where it runs

/**
 * As a home-screen app the page has no browser bars, no back swipe and no tab
 * switcher — nothing a pocket can press except the page itself, which the
 * shield swallows. So the first visit in the browser asks for that, once; it
 * can be skipped.
 */
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = navigator.standalone === true || ['standalone', 'fullscreen'].some(m => matchMedia(`(display-mode: ${m})`).matches);
set('rMode', STANDALONE ? 'home-screen app' : 'browser tab', STANDALONE ? 'ok' : 'warn');
if (!STANDALONE && !app.read('inmotion.browser.v1',false)) {
  document.body.classList.add('install');
  $('stepsIos').hidden = !IOS;
  $('stepsAndroid').hidden = IOS;
}
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('installBtn').hidden = IOS; });
$('installBtn').onclick = async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; };
$('useBrowser').onclick = () => { app.save('inmotion.browser.v1',true); document.body.classList.remove('install'); };

// Browser Back is managed by the live display; sensing never traps navigation.

async function startMotion() {
  if(motionBusy)return false;
  if(running&&motionStatus==='ready')return true;
  if(!window.isSecureContext){motionChange('unavailable','Motion needs the secure HTTPS phone address shown on your PC.');return false;}
  if(!('DeviceMotionEvent' in window)){motionChange('unavailable','This browser has no motion sensors. Open this page on your phone.');return false;}
  motionBusy=true;motionChange('requesting','When the browser asks, tap Allow for Motion & Orientation.');
  // Inside the tap, before any await: prime the fallback video (so it may play
  // later without a touch) and, on Android in a tab, go full screen — the
  // browser's bars disappear there too. iPhone has no full screen for pages.
  video.play().then(() => { if (!videoOn) video.pause(); }).catch(() => {});
  if (!STANDALONE && !IOS && document.documentElement.requestFullscreen) {
    // Fullscreen is optional; do not interrupt the permission prompt.
  }
  try {
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') {
        state.textContent = 'Motion refused';
        motionBusy=false;motionChange('denied','Motion was blocked. Allow Motion & Orientation for this site in your browser settings, then try again.');
        return false;
      }
    }
  } catch (err) {
    state.textContent = 'Motion unavailable';
    motionBusy=false;motionChange('unavailable',String(err && err.message || err));
    return false;
  }
  window.removeEventListener('devicemotion',onMotion);
  window.addEventListener('devicemotion', onMotion);
  running = true;motionBusy=false;lastTs=0;rateEst=0;gravityMode=null;gLow=null;batch=[];motionRequestedAt=now();motionChange('waiting','Move your phone gently to check the sensors.');
  $('start').textContent = 'Sensing';
  $('start').classList.remove('go');
  keepAwake();
  showMode();
  send({ t: 'ready', pocket, standalone: STANDALONE });
  return true;
}
$('start').onclick=startMotion;
setInterval(()=>{
  if(running && now()-motionRequestedAt>5000 && document.visibilityState==='visible' && (!lastTs || now()-lastTs>5000) && motionStatus!=='no-data')motionChange('no-data','No motion samples yet. Keep this page open on your phone, check motion permissions, then retry.');
  window.dispatchEvent(new CustomEvent('phone-sensors',{detail:{rate:Math.round(rateEst),rtt:Math.round(rtt),sent,wake:wakeLock&&!wakeLock.released?'Awake':videoOn?'Video fallback':'Not active',gravity:gravityMode||'Waiting',status:motionStatus}}));
},5000);

/**
 * The screen is against the leg. Skin through thin cloth can register as a
 * touch, and one touch in the wrong place — a back swipe, a pull to refresh,
 * a tap on a link — ends the stream. So once sensing, a dark sheet covers the
 * page and swallows every touch; a long press (2 s) on it lifts it again.
 */
function shield() {
  if(document.getElementById('shield'))return;
  const d = document.createElement('dialog');
  d.id = 'shield';
  d.style.cssText = 'position:fixed;inset:0;margin:0;max-width:none;max-height:none;width:100%;height:100%;border:0;background:#000;z-index:99;display:grid;place-items:center;color:#5a2d2a;font:600 15px Montserrat,-apple-system,system-ui,sans-serif;text-align:center;padding:24px;touch-action:none;-webkit-user-select:none;user-select:none';
  d.innerHTML = '<div><div style="font-size:34px;margin-bottom:10px">📱🦵</div>In your pocket, sensing.<br><span style="font-size:13px">Hold two fingers for 1 second to unlock. Keep your phone unlocked.</span></div>';
  // A leg through cloth makes one broad contact, and can lean on the glass for
  // seconds during a squat — so one long press was not safe. Two separate
  // fingers held still together is something only a hand does.
  let press = null;
  const swallow = e => { e.preventDefault(); e.stopPropagation(); };
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'contextmenu', 'gesturestart', 'gesturechange', 'dblclick', 'click']) d.addEventListener(ev, swallow, { passive: false });
  const watch = e => {
    if (e.touches.length === 2) { if (!press) press = setTimeout(() => d.remove(), 1000); }
    else { clearTimeout(press); press = null; }
  };
  for (const ev of ['touchstart', 'touchend', 'touchcancel']) d.addEventListener(ev, watch, { passive: false });
  d.addEventListener('cancel',e=>e.preventDefault());
  document.body.appendChild(d);d.showModal();
}

/**
 * The screen told us where it is.
 *
 * At the hub the phone becomes the chooser: the same three rooms that are on
 * the big screen, and your own numbers, so you can start a session without
 * walking back to the Mac. Inside a room it goes back to being a controller
 * and says nothing you would have to read mid-move.
 */
function scene(m) {
  const hub = m.where === 'hub';
  document.body.classList.toggle('hub', hub);
  $('title').textContent = hub ? 'Pick a game' : 'Your phone is the controller';
  if (!hub) return;
  const games = m.games || [];
  $('rooms').innerHTML = games.map(g => `
    <button class="room" type="button" data-id="${g.id}" ${g.ready ? '' : 'disabled'}>
      <span class="dot" style="background:${g.accent};color:${g.accent}"></span>
      <span class="txt"><span class="nm">${g.name}</span><span class="sub2">${g.ready ? g.asks : 'not built yet'}</span></span>
      <span class="arrow">›</span>
    </button>`).join('');
  for (const b of $('rooms').querySelectorAll('.room[data-id]:not([disabled])')) {
    b.onclick = () => { send({ t: 'pick', game: b.dataset.id }); hint.textContent = 'Starting… put the phone in your pocket.'; };
  }
  const st = (m.you && m.you.stats) || {};
  window.dispatchEvent(new CustomEvent('activity-summary', { detail: st }));
  $('mine').innerHTML = [['runs', st.runs], ['covered', st.distance], ['burned', st.kcal]]
    .map(([k, v]) => `<div><div class="n">${v || '—'}</div><div class="k">${k.toUpperCase()}</div></div>`).join('');
}

function showMode() {
  if (!running) return;
  state.textContent = mode === 'record' ? 'Recording' : mode === 'play' ? 'Playing' : 'Streaming';
  if (mode === 'idle') hint.textContent = (AR ? 'حط الجوال في جيبك الآن وروح للماك. · ' : '') + 'In your right front pocket now, then look at the Mac.';
}


function set(row, text, cls) {
  const el = $(row);
  if (!el) return;
  el.querySelector('b').textContent = text;
  el.className = 'row' + (cls ? ' ' + cls : '');
}

// a trace of total g, so a glance says whether the sensor is alive
const bars = $('bars'), bctx = bars.getContext('2d');
(function draw() {
  const W = bars.width, H = bars.height;
  bctx.clearRect(0, 0, W, H);
  bctx.strokeStyle = '#ffffff1a'; bctx.lineWidth = 1;
  bctx.beginPath(); bctx.moveTo(0, H * 0.65); bctx.lineTo(W, H * 0.65); bctx.stroke();
  // the trace wears the page's colour of the moment (it breathes red ↔ blue); read twice a second, not every frame
  if (!(draw.n = (draw.n || 0) + 1) || draw.n % 30 === 1) draw.tone = getComputedStyle(document.documentElement).getPropertyValue('--t2').trim() || '#ff8a2a';
  bctx.strokeStyle = draw.tone; bctx.lineWidth = 2; bctx.beginPath();
  for (let i = 0; i < recent.length; i++) {
    const x = (i / 240) * W, y = H * 0.65 - (recent[i] - 1) * H * 0.22;
    i ? bctx.lineTo(x, y) : bctx.moveTo(x, y);
  }
  bctx.stroke();
  requestAnimationFrame(draw);
})();

// Pair only after startup has resolved onboarding and any new QR code.
// The controller's phone-paired event opens the signaling connection.

addEventListener('pagehide',()=>{closed=true;clearTimeout(reconnectTimer);direct.close();ws?.close();});
addEventListener('pageshow',e=>{if(e.persisted){closed=false;connect();}});
