// One motion screen for every game phase. Host actions appear only when available.
const panel=document.createElement('dialog');
panel.className='live-motion-screen';panel.setAttribute('aria-labelledby','liveMotionTitle');panel.tabIndex=-1;
panel.innerHTML=`<header class="live-motion-head"><p class="live-game-name" id="liveGameName"></p><h1 id="liveMotionTitle">Game in progress</h1><p class="live-instruction" id="liveInstruction">Watch your PC. Move to play.</p></header><div class="live-wave-stage" role="img" aria-label="Live motion along the phone’s X, Y and Z axes"><canvas aria-hidden="true"></canvas><span class="live-axis live-axis-x">X</span><span class="live-axis live-axis-y">Y</span><span class="live-axis live-axis-z">Z</span></div><footer class="live-motion-footer"><div class="live-signal" role="status" id="liveSignal">Waiting for motion</div><div class="live-readings"><div><strong id="liveAcceleration">—</strong><span>MOVEMENT · g</span></div><div><strong id="liveRotation">—</strong><span>ROTATION · °/s</span></div><div><strong id="liveRate">—</strong><span>SAMPLES · Hz</span></div></div><div class="live-game-actions" aria-label="Game actions" hidden></div><p class="live-back-hint">Tap Games or use browser Back to return</p><p class="live-preview-note" hidden>Design preview · simulated motion</p></footer>`;
document.body.append(panel);
const backButton=document.createElement('button');backButton.type='button';backButton.className='live-back-button';backButton.textContent='← Games';backButton.setAttribute('aria-label','Return to games');
panel.querySelector('.live-motion-head').prepend(backButton);
const motionButton=document.createElement('button');motionButton.type='button';motionButton.className='live-motion-enable';motionButton.textContent='Enable motion';
const pocketButton=document.createElement('button');pocketButton.type='button';pocketButton.className='live-pocket-button';pocketButton.textContent='Pocket mode';
panel.querySelector('.live-motion-footer').append(motionButton,pocketButton);
motionButton.onclick=e=>{e.stopPropagation();window.PhoneMotion?.enable();};
pocketButton.onclick=e=>{e.stopPropagation();window.PhoneMotion?.lock();};
function motionControls(){const status=window.PhoneMotion?.status;motionButton.hidden=status==='ready';motionButton.disabled=status==='requesting'||status==='waiting';motionButton.textContent=status==='waiting'?'Checking motion…':status==='requesting'?'Tap Allow…':'Enable motion';pocketButton.hidden=status!=='ready';}
window.addEventListener('phone-motion',motionControls);
const returnPrompt=document.createElement('dialog');
returnPrompt.className='live-return-prompt';
returnPrompt.setAttribute('aria-labelledby','liveReturnTitle');
returnPrompt.setAttribute('aria-describedby','liveReturnText');
returnPrompt.innerHTML='<div class="live-return-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 6 6v3"/></svg></div><h2 id="liveReturnTitle"></h2><p id="liveReturnText"></p>';
document.body.append(returnPrompt);
const $=id=>panel.querySelector('#'+id),canvas=panel.querySelector('canvas'),context=canvas.getContext('2d');
const games={subway:'Subway',track:'Track & Field',redlight:'Red Light Green Light',jumprope:'Jump Rope',training:'Controller training'};
const sampleCount=100,channels=Array.from({length:3},()=>Array(sampleCount).fill(0));
let host=null,preview=false,key=null,dismissed=null,active=false,lastSample=0,rate=0,rotation=0,magnitude=0,lastFrame=0,raf=0,waitingForBack=false,linkLost=false;
let completed=false,completionSeen=false,promptTimer=0,onAction=null,actionSignature='',actionPending=false;
function showReturnPrompt(kind='hint'){
  if(!active)return;
  returnPrompt.dataset.kind=kind;
  returnPrompt.querySelector('h2').textContent=kind==='complete'?'Round complete':'Back to Play?';
  returnPrompt.querySelector('p').textContent=kind==='complete'?'Play again below, or tap Games to choose another game.':'Tap Games above, or use your browser’s Back button to return to game selection on your phone and PC.';
  clearTimeout(promptTimer);
  if(!returnPrompt.open)returnPrompt.showModal();
  promptTimer=setTimeout(()=>returnPrompt.close(),3000);
}
returnPrompt.addEventListener('click',()=>{clearTimeout(promptTimer);returnPrompt.close();});
panel.addEventListener('click',e=>{if(!e.target?.closest('button'))showReturnPrompt();});
panel.addEventListener('keydown',e=>{if(!e.target?.closest('button')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();showReturnPrompt();}});
function renderActions(){
  const area=panel.querySelector('.live-game-actions');
  const signature=JSON.stringify([host?.hostId,host?.revision,host?.actions]);
  if(signature!==actionSignature){
    actionSignature=signature;actionPending=false;area.replaceChildren();
    for(const action of host?.actions||[]){
      const button=document.createElement('button');button.type='button';button.textContent=action.label;
      button.onclick=e=>{
        e.stopPropagation();if(linkLost||actionPending)return;
        actionPending=true;renderActions();
        onAction?.(action.id,host.revision);
        setTimeout(()=>{if(actionSignature===signature){actionPending=false;renderActions();}},1500);
      };
      area.append(button);
    }
  }
  area.hidden=!host?.actions?.length;
  area.querySelectorAll('button').forEach(b=>b.disabled=linkLost||actionPending);
}
const historyToken=crypto.randomUUID?.()||String(Date.now());
backButton.onclick=e=>{e.stopPropagation();leave();window.dispatchEvent(new CustomEvent('phone-live-back'));};
const text=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const finite=n=>Number.isFinite(n)?n:0;
function sample(s){
  if(!active||preview)return;
  const a=s.acceleration.map(finite);
  a.forEach((n,i)=>{channels[i].push(Math.max(-2,Math.min(2,n/9.80665)));channels[i].shift();});
  magnitude=Math.hypot(...a)/9.80665;rotation=Math.hypot(...s.rotation.map(finite));rate=finite(s.rate);lastSample=performance.now();
}
window.addEventListener('phone-motion-sample',e=>sample(e.detail));
function paint(t){
  if(!active)return;
  raf=requestAnimationFrame(paint);
  if(document.hidden||t-lastFrame< (reduced.matches?180:33))return;
  lastFrame=t;
  if(preview){
    const scale=host?.live?.phase==='training'?.15:.7;
    const values=[Math.sin(t/430)*Math.sin(t/1600),Math.sin(t/620+.8)*.7,Math.cos(t/770)*.45].map(v=>v*scale);
    values.forEach((v,i)=>{channels[i].push(v);channels[i].shift();});
    magnitude=Math.hypot(...values);rotation=18+Math.abs(Math.sin(t/690))*40;rate=60;lastSample=t;
  }
  const fresh=lastSample>0&&t-lastSample<1500;
  const status=window.PhoneMotion?.status;
  text('liveSignal',linkLost?'Reconnecting to your PC':fresh?(magnitude>.12?'Movement detected':'Holding steady'):status==='denied'?'Motion access is blocked':status==='unavailable'?'Motion unavailable':status==='needed'?'Motion is off':'Waiting for motion');
  $('liveAcceleration').textContent=fresh?magnitude.toFixed(2):'—';$('liveRotation').textContent=fresh?String(Math.round(rotation)):'—';$('liveRate').textContent=fresh?String(Math.round(rate)):'—';
  const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=rect.width,h=rect.height;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  context.setTransform(dpr,0,0,dpr,0,0);context.clearRect(0,0,w,h);
  if(!w||!h)return;
  const rail=context.createLinearGradient(0,0,0,h);rail.addColorStop(0,'#ffffff00');rail.addColorStop(.35,'#ffffff45');rail.addColorStop(.75,'#ffffff30');rail.addColorStop(1,'#ffffff00');
  context.strokeStyle=rail;context.lineWidth=1;
  for(const x of [.25,.5,.75]){context.beginPath();context.moveTo(w*x,0);context.lineTo(w*x,h);context.stroke();}
  channels.forEach((values,index)=>{
    const y=h*(.2+index*.3),amp=Math.min(h*.105,65);
    const edge=context.createLinearGradient(0,0,w,0);edge.addColorStop(0,'#ffffff00');edge.addColorStop(.2,index===1?'#ffffff90':'#ffffff60');edge.addColorStop(.5,index===1?'#ffffffff':'#ffffffb0');edge.addColorStop(.8,index===1?'#ffffff90':'#ffffff60');edge.addColorStop(1,'#ffffff00');
    context.strokeStyle=fresh?edge:'#ffffff22';context.lineWidth=index===1?2:1.5;context.lineJoin='round';context.lineCap='round';context.beginPath();
    const points=values.map((v,i)=>[i*w/(sampleCount-1),y-(fresh?v:0)*amp]);context.moveTo(...points[0]);
    for(let i=1;i<points.length-1;i++)context.quadraticCurveTo(...points[i],(points[i][0]+points[i+1][0])/2,(points[i][1]+points[i+1][1])/2);
    context.lineTo(...points.at(-1));context.stroke();
    // Quiet diagonal accents echo the reference; they are decorative, not measurements.
    context.strokeStyle='#ffffff16';context.lineWidth=1.5;context.beginPath();context.moveTo(w*(.13+index*.16),y+38);context.lineTo(w*(.3+index*.16),y-38);context.stroke();
  });
}
function renderCopy(){
  if(!host)return;
  const phase=host.live?.phase||'',training=host.game==='training'||phase==='training';
  $('liveGameName').textContent=games[host.game]||'InMotion';
  $('liveMotionTitle').textContent=linkLost?'Reconnecting':host.heading||(training?'Training your movement':['results','won','dead','over'].includes(phase)?'Run complete':phase==='loading'?'Getting ready':'Game in progress');
  $('liveInstruction').textContent=linkLost?'Keep this page open. We’ll reconnect automatically.':preview?(training?'Follow the instructions on your PC.':phase==='results'?'Your results are on the big screen.':phase==='loading'?'Your game will be ready in a moment.':'Keep your phone in your right front pocket.'):host.text||'Watch your PC. Move to play.';
  motionControls();
  panel.querySelector('.live-preview-note').hidden=!preview;
}
function reveal(push=true){
  if(active||!host||waitingForBack)return;
  if(push&&history.state?.inmotionLive!==historyToken){
    const url=new URL(location.href);url.hash='motion';
    history.pushState({...history.state,inmotionLive:historyToken},'',url);
  }
  active=true;dismissed=null;panel.showModal();document.getElementById('shield')?.remove();panel.focus({preventScroll:true});renderCopy();cancelAnimationFrame(raf);raf=requestAnimationFrame(paint);
  if(completed&&!completionSeen){completionSeen=true;showReturnPrompt('complete');}
}
function hide(){active=false;clearTimeout(promptTimer);if(returnPrompt.open)returnPrompt.close();panel.close();cancelAnimationFrame(raf);}
function leave(){
  if(!active)return;
  hide();dismissed=key;
  if(history.state?.inmotionLive===historyToken){waitingForBack=true;history.back();}
}
addEventListener('popstate',()=>{
  const automatic=waitingForBack;
  waitingForBack=false;
  if(history.state?.inmotionLive===historyToken&&host){reveal(false);}
  else{const wasActive=active;hide();if(!automatic)dismissed=key;if(wasActive&&!automatic)window.dispatchEvent(new CustomEvent('phone-live-back'));}
});
panel.addEventListener('cancel',e=>{e.preventDefault();if(history.state?.inmotionLive===historyToken)history.back();else{hide();dismissed=key;}});
window.addEventListener('phone-page',e=>{if(e.detail!=='controller')leave();});
window.PhoneLive={
  get visible(){return active;},
  update(m,options={}){
    if(!m||m.game==='hub'){host=null;key=null;dismissed=null;leave();return;}
    const nextKey=`${m.hostId}:${m.game}`;
    if(key!==nextKey){dismissed=null;completionSeen=false;channels.forEach(c=>c.fill(0));lastSample=0;}
    key=nextKey;host=m;onAction=options.onAction;preview=!!options.preview;linkLost=m.live?.phase==='lost';renderCopy();
    const phase=m.live?.phase;
    completed=['results','won','dead','over','finished','complete','ended','done'].includes(phase)&&(phase==='results'||m.actions?.length>0);
    if(['play','playing','running','intro','ready'].includes(phase))completionSeen=false;
    renderActions();
    if(options.allowOpen&&dismissed!==key)reveal();
    if(active&&completed&&!completionSeen){completionSeen=true;showReturnPrompt('complete');}
  },
  open(){reveal();},
  clear(){host=null;key=null;dismissed=null;leave();},
  connection(lost){linkLost=lost;renderCopy();renderActions();}
};
