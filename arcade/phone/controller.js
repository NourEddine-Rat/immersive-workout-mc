import {ConnectionNotice} from '../engine/lib/connection-notice.js';

(() => {
  const app=window.PhoneApp;
  const root=document.createElement('section');root.className='control-screen';root.hidden=true;root.setAttribute('aria-label','Game controller');
  root.innerHTML=`<div class="control-inner"><header class="control-head phone-page-head"><button type="button" id="controlBack" class="phone-back" aria-label="Back to stats"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 5-7 7 7 7"/></svg></button><span>Play</span><small id="controlStatus">NOT CONNECTED</small></header><div id="controlConnect"><div class="connect-hero"><div class="connect-device" aria-hidden="true"><img src="./phone/guide-icons/phone-desktop.svg" alt=""></div><div><h1>Connect your screen</h1><p class="control-intro" id="connectHint">Scan the QR code on your PC to start.</p></div></div><div class="control-methods" role="group" aria-label="Connection method"><button type="button" data-method="scan" aria-pressed="true">Scan QR</button><button type="button" data-method="code" aria-pressed="false">Enter code</button></div>
  <div class="connect-card" id="scanPanel"><div class="scanner-frame"><video id="scanVideo" muted playsinline hidden></video><div id="scanPlaceholder"><span class="connect-scan-icon" aria-hidden="true"></span><p>Your game starts here<span>Scan the QR code on your PC</span></p></div></div><button class="control-primary" type="button" id="scanStart">Open camera <span class="connect-camera-icon" aria-hidden="true"></span></button><button class="control-secondary" type="button" id="scanStop" hidden>Stop camera</button></div>
  <form class="connect-card" id="codePanel" hidden><div class="pair-code-label"><label for="pairCode">Connection code</label><span>6 digits</span></div><div class="pair-code-field"><input id="pairCode" type="text" inputmode="numeric" enterkeyhint="go" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" pattern="[0-9]{6}" maxlength="6" placeholder="000000" aria-describedby="pairCodeHint controlMessage"></div><p id="pairCodeHint">Enter the code shown on your PC.</p><button class="control-primary" type="submit" id="pairSubmit">Connect <span aria-hidden="true">→</span></button></form>
  <p class="control-wifi"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 3a4.5 4.5 0 0 1 6 0"/><circle cx="12" cy="19" r="1"/></svg>Same Wi-Fi as your PC. Direct motion.</p></div>
  <p class="control-message" id="controlMessage" role="status"></p><footer class="control-footer">InMotion</footer></div>`;
  document.body.append(root);
  // Form feedback belongs above the connection form, never below the carousel.
  root.querySelector('#controlConnect').before(root.querySelector('#controlMessage'));
  const gallery=document.createElement('div');gallery.id='controlGallery';gallery.hidden=true;
  gallery.innerHTML=`<header class="remote-heading"><div><h1>Choose your game</h1><p>Play on the big screen.</p></div><button class="control-secondary" id="remoteChange" type="button" aria-label="Connect another screen">Change screen</button></header><div class="remote-gallery"><iframe title="Swipe to choose a game on your PC" id="remoteCarousel"></iframe></div><div class="remote-swipe"><span aria-hidden="true"></span><p>Swipe to explore · tap a card to choose</p></div><div class="remote-selection"><div class="remote-caption"><span>ON YOUR PC</span><strong id="remoteGame" aria-live="polite">Loading games…</strong></div><button class="remote-play" id="remotePlay" type="button" disabled hidden>Play <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg></button><button class="control-primary" id="remoteSense" type="button">Enable motion to play</button></div>`;
  root.querySelector('#controlConnect').after(gallery);
  const frame=gallery.querySelector('iframe');
  const carouselMount=gallery.querySelector('.remote-gallery');
  const fallback=document.createElement('div');fallback.className='remote-fallback';fallback.hidden=true;
  fallback.innerHTML='<p>Choose a game</p>'+[['subway','Subway'],['redlight','Red Light Green Light'],['jumprope','Jump Rope'],['track','Track & Field']].map(([id,name])=>`<button type="button" class="control-secondary" data-game="${id}">${name}</button>`).join('');
  carouselMount.after(fallback);fallback.querySelectorAll('button').forEach(b=>b.onclick=()=>chooseGame(b.dataset.game));
  let fallbackTimer,localIssue='';
  function showFallback(){fallback.hidden=false;carouselMount.hidden=true;}
  function mountCarousel(){if(!frame.isConnected)carouselMount.append(frame);if(!frame.getAttribute('src')){fallback.hidden=true;carouselMount.hidden=false;frame.src='./index.html?controller=1';clearTimeout(fallbackTimer);fallbackTimer=setTimeout(showFallback,15000);}}
  function unmountCarousel(){clearTimeout(fallbackTimer);fallback.hidden=true;frame.remove();frame.removeAttribute('src');}
  const command=detail=>{if(!preview)window.dispatchEvent(new CustomEvent('phone-command',{detail:{...detail,hostId:host?.hostId}}));};
  let link=false,lastDesktopState=null,host=null,lastHostAt=0,restoring=false,preview=false,liveBeforePreview=null,returningToGames=false,accepted=false,connectionIssue='',hostWarning='',pairVersion=0;
  const isLive=()=>accepted&&link&&host&&host.clientId===app.id&&Date.now()-lastHostAt<5500&&!preview;
  let selectedRemoteGame=null;
  function updateSelection(m){
    if(m.label)gallery.querySelector('#remoteGame').textContent=m.label;
    if(['subway','redlight','jumprope','track'].includes(m.game))selectedRemoteGame=m.game;
    gallery.querySelector('#remotePlay').disabled=!selectedRemoteGame||gallery.classList.contains('is-disconnected');
  }
  function chooseGame(game){
    if(!['subway','redlight','jumprope','track'].includes(game))return;
    if(preview){if(motionBanner.dataset.state!=='ready'){setMotion({status:'ready'});return;}window.ControllerDev.show('playing');return;}
    if(!isLive()||gallery.classList.contains('is-disconnected')){message('Waiting for your PC. Keep this page open.');return;}
    if(window.PhoneMotion?.status!=='ready'){message('Enable motion to start playing.');motionBanner.scrollIntoView({block:'nearest',behavior:'smooth'});return;}
    command({t:'carousel-pick',game});message('Opening on your PC…');
  }
  gallery.querySelector('#remotePlay').onclick=()=>chooseGame(selectedRemoteGame);
  function forwardState(m){lastDesktopState=m;frame.contentWindow?.postMessage(m,location.origin);updateSelection(m);}
  window.addEventListener('phone-carousel',e=>{if(paired&&(!host||host.hostId===e.detail.hostId)){forwardState(e.detail);}});
  window.addEventListener('message',e=>{
    if(e.origin!==location.origin||e.source!==frame.contentWindow||!paired)return;
    const m=e.data||{};
    if(m.t==='carousel-error'){clearTimeout(fallbackTimer);showFallback();}
    if(m.t==='carousel-loaded'){clearTimeout(fallbackTimer);fallback.hidden=true;carouselMount.hidden=false;if(preview)frame.contentWindow.postMessage({t:'carousel-state',position:0},location.origin);if(lastDesktopState)forwardState(lastDesktopState);command({t:'carousel-sync'});}
    if(m.t==='carousel-state'&&m.label){updateSelection(m);if(!preview)app.preference('selectedGame',m.label);}
    if(m.t==='carousel-pick')chooseGame(m.game);
    if(isLive()&&m.t==='carousel-move'&&!gallery.classList.contains('is-disconnected'))command(m);
  });
  gallery.querySelector('#remoteSense').onclick=()=>{if(preview)setMotion({status:'ready',text:'Preview: motion enabled'});else window.PhoneMotion?.enable();};
  const $=id=>root.querySelector('#'+id), video=$('scanVideo'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  let stream=null,scanTimer=null,cameraVersion=0,paired=false,busy=false;
  const notice=new ConnectionNotice();
  const reconnect=document.createElement('dialog');
  reconnect.className='phone-reconnect';
  reconnect.setAttribute('aria-labelledby','reconnectTitle');
  reconnect.setAttribute('aria-describedby','reconnectHelp');
  reconnect.innerHTML=`<header><span>LOCAL WI-FI</span><button type="button" class="reconnect-later" aria-label="Back to stats">Later</button></header><h2 id="reconnectTitle" tabindex="-1">Connecting to your PC</h2><p id="reconnectHelp">Keep both screens open on the same Wi-Fi. We’ll connect automatically.</p><details><summary>Connection help</summary><p>Allow Local Network access if asked. Avoid guest Wi-Fi or a VPN. If you opened a different PC, choose Change screen.</p></details><div class="reconnect-actions"><button type="button" id="reconnectRetry">Try again</button><button type="button" id="reconnectChange">Change screen</button></div>`;
  document.body.append(reconnect);
  const text=(element,value)=>{if(element.textContent!==value)element.textContent=value;};
  function renderConnection(){
    if(preview){reconnect.close();return;}
    const state=notice.update({connected:!!isLive(),pending:paired,failed:!!localIssue});
    text($('controlStatus'),connectionIssue?'SCREEN IN USE':!paired?'NOT CONNECTED':state.state==='connected'?'CONNECTED':state.state==='reconnecting'?'RECONNECTING':'CONNECTING');
    const visible=paired&&!connectionIssue&&!root.hidden&&!window.PhoneLive?.visible&&state.visible;
    if(!visible){if(reconnect.open)reconnect.close();return;}
    text(reconnect.querySelector('h2'),state.state==='reconnecting'?'Reconnecting to your PC':state.state==='help'?'Check your Wi-Fi':'Connecting to your PC');
    reconnect.querySelector('#reconnectRetry').hidden=!state.retry;
    if(!reconnect.open){reconnect.showModal();reconnect.querySelector('h2').focus({preventScroll:true});}
  }
  reconnect.querySelector('.reconnect-later').onclick=()=>window.openActivity();
  reconnect.addEventListener('cancel',e=>{e.preventDefault();window.openActivity();});
  reconnect.querySelector('#reconnectRetry').onclick=()=>{
    const button=reconnect.querySelector('#reconnectRetry');button.disabled=true;
    window.PhoneConnection?.retry();setTimeout(()=>button.disabled=false,1500);
  };
  reconnect.querySelector('#reconnectChange').onclick=()=>$('remoteChange').click();
  const motionBanner=document.createElement('aside');motionBanner.className='motion-banner';motionBanner.setAttribute('aria-label','Motion permission');
  motionBanner.dataset.state='needed';
  motionBanner.innerHTML='<span class="motion-symbol" aria-hidden="true"><i></i></span><div class="motion-copy"><strong id="motionTitle">Enable motion</strong><p id="motionHelp">Let your movement control the game.</p></div><button type="button" id="motionEnable" aria-label="Enable motion" aria-describedby="motionHelp">Enable</button>';
  $('controlConnect').before(motionBanner);
  motionBanner.querySelector('button').onclick=()=>{if(preview){setMotion({status:motionBanner.dataset.state==='ready'?'needed':'ready'});return;}if(window.PhoneMotion?.status==='ready')window.PhoneMotion.stop();else window.PhoneMotion?.enable();};
  function setMotion(m){
    const ready=m.status==='ready';motionBanner.dataset.state=m.status;
    motionBanner.querySelector('strong').textContent=ready?'Motion ready':m.status==='denied'?'Allow motion access':m.status==='unavailable'?'Motion unavailable':m.status==='no-data'?'Waiting for motion':m.status==='requesting'?'Allow on your phone':'Enable motion';
    motionBanner.querySelector('p').textContent=ready?'You’re ready to move.':m.status==='needed'?'Let your movement control the game.':m.status==='requesting'?'Tap Allow in the permission prompt.':m.text||'Allow movement access to play.';
    motionBanner.querySelector('button').hidden=false;motionBanner.querySelector('button').disabled=m.status==='requesting';
    motionBanner.querySelector('button').textContent=ready?'Stop':m.status==='requesting'?'Waiting…':['denied','no-data'].includes(m.status)?'Retry':'Enable';
    motionBanner.querySelector('button').setAttribute('aria-label',ready?'Stop motion':m.status==='requesting'?'Waiting for motion permission':'Enable motion');
    $('remoteSense').textContent=m.status==='requesting'?'Waiting for permission…':'Enable motion to play';$('remoteSense').hidden=ready;$('remoteSense').disabled=m.status==='requesting';
    $('remotePlay').hidden=!ready;
  }
  window.addEventListener('phone-motion',e=>{if(!preview)setMotion(e.detail);});
  function gameAction(id,revision){
    if(preview){window.ControllerDev.show(host?.game==='training'?'playing':id===0?'playing':'connected');return;}
    if(isLive())command({t:'host-action',revision,action:id});
  }
  window.addEventListener('phone-live-back',()=>{
    if(!paired||!host||host.game==='hub')return;
    if(preview){window.ControllerDev.show('connected');return;}
    returningToGames=true;gallery.hidden=false;
    mountCarousel();
    gallery.classList.add('is-disconnected');$('remotePlay').disabled=true;
    message('Returning to games on your PC…');
    if(isLive())command({t:'host-home'});
  });
  function renderHost(m){
    const changed=host?.hostId!==m.hostId;host=m;lastHostAt=Date.now();
    if(changed)returningToGames=false;
    if(changed&&!preview){lastDesktopState=null;window.dispatchEvent(new CustomEvent('phone-profile'));command({t:'carousel-sync'});}
    const hub=m.game==='hub';if(hub)returningToGames=false;$('controlConnect').hidden=true;gallery.hidden=!hub&&!returningToGames;
    if(hub){mountCarousel();}
    else if(!returningToGames){unmountCarousel();}
    const busy=!accepted||(m.clientId&&m.clientId!==app.id);
    if(preview)$('controlStatus').textContent='PREVIEW';
    gallery.classList.toggle('is-disconnected',!hub||busy||(!link&&!preview));$('remotePlay').disabled=!selectedRemoteGame||!hub||busy||(!link&&!preview);
    if(busy)message('Another phone controls this screen. Disconnect it first, then reconnect here.');else if(!restoring)message('');
    if(returningToGames&&!hub){message('Returning to games on your PC…');if(isLive()&&!busy)command({t:'host-home'});}
    window.PhoneLive.update(m,{preview,allowOpen:!root.hidden&&!busy&&!returningToGames,onAction:gameAction});
    window.PhoneLive.connection(busy||(!link&&!preview));
    renderConnection();
  }
  window.addEventListener('phone-host',e=>{
    if(preview)return;const m=e.detail;
    if(m.t==='pair-expired'){resetPairing(m.message);return;}
    if(m.t==='phone-replaced'){resetPairing('This phone is open in another tab. Continue there, or enter the code here to take control.',false);return;}
    if(!paired)return;
    if(m.t==='phone-paired'){accepted=true;connectionIssue='';renderConnection();return;}
    if(m.t==='host-busy'&&m.clientId===app.id){accepted=false;connectionIssue='This PC is in use. Disconnect the other phone or enter a different code.';gallery.hidden=true;$('controlConnect').hidden=false;message(connectionIssue);renderConnection();return;}
    if(!accepted)return;
    if(m.t==='host-state')renderHost(m);
    if(m.t==='session-history'&&m.userId===app.id)app.ingest(m.rows);
    if(m.t==='host-warning'){hostWarning=m.message;message('');}
  });
  setInterval(()=>{
    if(!paired||preview)return;
    if(!isLive()){window.PhoneLive.connection(true);gallery.classList.add('is-disconnected');$('remotePlay').disabled=true;}
    renderConnection();
  },500);

  window.addEventListener('phone-local',e=>{
    localIssue=['blocked','unsupported'].includes(e.detail.status)?e.detail.message:'';
    renderConnection();
  });
  function message(s){
    // Pairing/camera errors stay in the form. Transport retries have one steady modal.
    const content=$('controlConnect').hidden?hostWarning:s;
    text($('controlMessage'),content||'');$('controlMessage').hidden=!content;
  }
  function stopCamera(){cameraVersion++;clearTimeout(scanTimer);stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;video.hidden=true;$('scanPlaceholder').hidden=false;$('scanStart').hidden=false;$('scanStart').disabled=false;$('scanStop').hidden=true;}
  function method(m){$('connectHint').textContent=m==='scan'?'Scan the QR code on your PC to start.':'Enter the code on your PC to start.';if(!preview)app.preference('connectionMethod',m);stopCamera();root.querySelectorAll('[data-method]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.method===m)));$('scanPanel').hidden=m!=='scan';$('codePanel').hidden=m!=='code';message('');}
  function ready(code){paired=true;accepted=false;connectionIssue='';localIssue='';notice.reset();const cleanURL=new URL(location.href);cleanURL.searchParams.delete('connect');history.replaceState(history.state,'',cleanURL.href);app.save('inmotion.pair.v1',{code,origin:location.origin});window.dispatchEvent(new CustomEvent('phone-paired'));lastHostAt=Date.now();stopCamera();$('controlConnect').hidden=true;gallery.hidden=false;command({t:'carousel-sync'});message('');root.scrollTop=0;renderConnection();}
  function resetPairing(text='',forget=true){
    pairVersion++;window.PhoneLive.clear();returningToGames=false;accepted=false;paired=false;host=null;connectionIssue='';hostWarning='';localIssue='';notice.reset();reconnect.close();
    if(forget)app.save('inmotion.pair.v1',null);gallery.hidden=true;unmountCarousel();lastDesktopState=null;selectedRemoteGame=null;
    $('controlConnect').hidden=false;$('controlStatus').textContent='NOT CONNECTED';method('code');message(text);
  }
  async function pair(code){
    if(preview){window.ControllerDev.show('connected');return;}
    if(busy)return;if(!/^\d{6}$/.test(code)){message('Enter the six-digit code shown on your PC or TV.');return;}
    busy=true;const version=++pairVersion,abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),8000);$('pairSubmit').disabled=true;message('Finding your game…');
    try{const res=await fetch(`/pair?code=${encodeURIComponent(code)}`,{cache:'no-store',signal:abort.signal});if(version!==pairVersion)return;if(res.status===404)throw Error('Start InMotion with start.command on your PC, then scan its QR code.');const data=await res.json();if(res.status===409){ready(code);return;}if(!res.ok||!data.ok){if(res.status===400){resetPairing(data.error||'That code has expired.');return;}throw Error(data.error||'Could not connect to this game.');}ready(code);}
    catch(e){if(version!==pairVersion)return;if(restoring&&e.name==='TypeError'){ready(code);return;}message(['TimeoutError','AbortError'].includes(e.name)?'Connection timed out. Check your connection. For local play, use the same Wi-Fi.':e.message||'Could not reach the game. Try again.');}
    finally{clearTimeout(timeout);busy=false;$('pairSubmit').disabled=false;}
  }
  async function scanned(text){
    let url;try{url=new URL(text);}catch{return false;}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/phone.html')return false;
    const code=url.searchParams.get('connect');if(!/^\d{6}$/.test(code||''))return false;
    stopCamera();if(url.origin===location.origin){await pair(code);}else{url.search='?connect='+code;url.hash='';location.assign(url.href);}return true;
  }
  async function scan(){
    if(!stream||root.hidden)return;
    if(video.readyState>=2&&video.videoWidth){try{const width=Math.min(640,video.videoWidth),height=Math.round(width*video.videoHeight/video.videoWidth);canvas.width=width;canvas.height=height;ctx.drawImage(video,0,0,width,height);const frame=ctx.getImageData(0,0,width,height),result=window.jsQR(frame.data,width,height,{inversionAttempts:'attemptBoth'});if(result){if(await scanned(result.data))return;message('Use the InMotion QR code on your game’s connection screen.');}}catch{stopCamera();message('The camera stopped. Open it again or enter the code.');return;}}
    scanTimer=setTimeout(scan,180);
  }
  $('scanStart').onclick=async()=>{
    if(preview){message('Camera preview. Return to the live phone to scan a real QR code.');return;}
    message('');if(!window.isSecureContext){message('Camera access needs HTTPS. Open the secure phone address shown on your game screen, or enter the code.');return;}
    if(!navigator.mediaDevices?.getUserMedia){method('code');message('Camera scanning isn’t available here. Enter the code instead.');return;}
    if(!window.jsQR){method('code');message('The scanner could not load. Enter the code instead.');return;}
    stopCamera();const version=cameraVersion;$('scanStart').disabled=true;
    try{const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});if(version!==cameraVersion||root.hidden){media.getTracks().forEach(t=>t.stop());return;}stream=media;video.srcObject=media;video.hidden=false;$('scanPlaceholder').hidden=true;$('scanStart').hidden=true;$('scanStop').hidden=false;await video.play();scan();}
    catch(e){if(version!==cameraVersion)return;stopCamera();message(e.name==='NotAllowedError'?'Camera access wasn’t allowed. You can enter the code instead.':'Camera unavailable. Close other camera apps or enter the code.');}
    finally{if(version===cameraVersion)$('scanStart').disabled=false;}
  };
  $('scanStop').onclick=stopCamera;
  root.querySelectorAll('[data-method]').forEach(b=>b.onclick=()=>method(b.dataset.method));
  $('pairCode').addEventListener('input',()=>{$('pairCode').value=$('pairCode').value.replace(/\D/g,'').slice(0,6);message('');});
  $('codePanel').onsubmit=e=>{e.preventDefault();pair($('pairCode').value);};
  window.openController=()=>{
    app.show('controller',root);
    if(app.onboarded&&!preview)resumePairing();
    renderConnection();
  };
  $('controlBack').onclick=()=>{stopCamera();root.hidden=true;window.openActivity();};
  $('remoteChange').onclick=()=>{command({t:'phone-release',clientId:app.id});window.PhoneMotion?.stop();resetPairing();method('scan');};

  window.addEventListener('phone-page',e=>{if(e.detail!=='controller')stopCamera();renderConnection();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});addEventListener('pagehide',stopCamera);
  window.addEventListener('phone-link',e=>{link=e.detail.connected;if(preview){if(liveBeforePreview)liveBeforePreview.link=link;return;}gallery.classList.toggle('is-disconnected',!link);if(paired&&!link)window.PhoneLive.connection(true);else if(paired)command({t:'carousel-sync'});renderConnection();});
  method(app.preferences.connectionMethod==='code'?'code':'scan');
  // Keep the QR in the URL throughout welcome, guide and profile setup, including reloads.
  // Startup and the final profile save are the only paths that resume pairing.
  function resumePairing(){
    if(!app.onboarded||paired||busy)return;
    const code=new URLSearchParams(location.search).get('connect'),saved=app.read('inmotion.pair.v1',null);
    if(code)pair(code);
    else if(saved?.code&&saved.origin===location.origin){restoring=true;pair(saved.code).finally(()=>{restoring=false;});}
  }
  window.ControllerDev={
    suspend(){if(!preview)liveBeforePreview={paired,host,link};preview=true;stopCamera();},
    show(kind){returningToGames=false;preview=true;paired=true;link=true;stopCamera();window.openController();setMotion({status:kind==='connect'?'needed':'ready',text:kind==='connect'?'Preview: enable motion before playing.':'Preview: motion is ready.'});
      if(kind==='connect'){window.PhoneLive.clear();gallery.hidden=true;$('controlConnect').hidden=false;$('controlStatus').textContent='PREVIEW';return;}
      renderHost({hostId:'preview',game:kind==='connected'?'hub':kind==='training'?'training':'subway',heading:{loading:'Loading your game',playing:'Game in progress',results:'Run complete',training:'Stand still',lost:'Connection lost'}[kind]||'Ready to play',text:kind==='results'?'Your activity is saved. Play again or pick another game.':'Preview only. No commands or sample data are sent to your PC.',actions:kind==='results'?[{id:0,label:'Play again'},{id:1,label:'Choose another game'}]:kind==='training'?[{id:0,label:'Continue'}]:[],live:{phase:kind},revision:1});
      if(kind!=='connected')window.PhoneLive.open();
      if(kind==='lost'){window.PhoneLive.connection(true);$('controlStatus').textContent='RECONNECTING';gallery.classList.add('is-disconnected');}
    },motion(status){preview=true;window.openController();setMotion({status,text:status==='denied'?'Allow Motion & Orientation in your browser settings, then retry.':'Preview: '+status});},exit(){window.PhoneLive.clear();returningToGames=false;preview=false;if(liveBeforePreview){({paired,host,link}=liveBeforePreview);liveBeforePreview=null;}lastHostAt=0;if(paired){host=null;command({t:'host-sync'});}else{gallery.hidden=true;$('controlConnect').hidden=false;$('controlStatus').textContent='NOT CONNECTED';}setMotion({status:window.PhoneMotion?.status||'needed'});}
  };
})();
