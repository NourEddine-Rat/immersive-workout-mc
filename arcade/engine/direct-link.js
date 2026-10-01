import {uuid} from './lib/identity.js';
import {localCandidate,localSDP,selectedLocalRoute,candidateInfo,hintedCandidate} from './lib/local-route.js';
import './connection-diagnostics.js';

const HELP='Connect both devices to the same Wi-Fi and avoid guest Wi-Fi or a VPN. If automatic discovery fails, use the PC Wi-Fi address in Connection help.';
export class DirectLink {
  constructor({role,signal,addressHint='',onMessage=()=>{},onState=()=>{}}){
    this.role=role;this.signalOut=signal;this.onMessage=onMessage;this.onState=onState;
    this.addressHint=addressHint;
    this.peer=null;this.pc=null;this.status='waiting';this.up=false;this.serial=Promise.resolve();
    this.attempt=0;
    this.monitor=setInterval(()=>this.tick(),250);
  }
  setPeer(peer){
    if(peer&&this.peer&&['hostId','clientId','peerId'].every(key=>peer[key]===this.peer[key]))return;
    this.log('peer-change',{present:!!peer});this.reset();this.peer=peer;
    if(peer&&typeof RTCPeerConnection==='undefined'){this.state('unsupported','This browser cannot make a direct connection. Use a current Safari, Chrome or Edge browser.');return;}
    if(peer){this.state('connecting','Connecting directly over your local Wi-Fi…');if(this.role==='host')this.offer();}
    else this.state('waiting','Scan the PC code to connect over the same Wi-Fi.');
  }
  state(status,message){
    const changed=this.status!==status||this.message!==message;
    this.status=status;this.message=message;
    if(changed){this.log('link-state',{stage:status});this.onState(this.snapshot());}
  }
  snapshot(){return {direct:this.up,status:this.status,message:this.message,route:this.route||null,rttMs:this.rttMs??this.route?.rttMs??null,stage:this.stage(),attempt:this.attempt,reason:this.routeIssue||null};}
  stage(){
    if(this.up)return 'connected';
    if(!this.peer)return 'pairing';
    if(!this.pc)return this.role==='phone'?'waiting-offer':'starting';
    if(!this.pc.remoteDescription)return this.role==='host'?'waiting-answer':'waiting-offer';
    if(!['connected','completed'].includes(this.pc.iceConnectionState))return 'local-discovery';
    if(!this.verified)return 'route-verification';
    if(!this.peerVerified)return 'peer-verification';
    return 'opening-channels';
  }
  log(event,data={}){
    globalThis.ConnectionDiagnostics?.record(event,{attempt:this.attempt||0,stage:this.stage(),ice:this.pc?.iceConnectionState,connection:this.pc?.connectionState,gathering:this.pc?.iceGatheringState,signaling:this.pc?.signalingState,control:this.control?.readyState,motion:this.motion?.readyState,verified:!!this.verified,peerVerified:!!this.peerVerified,direct:!!this.up,...data});
  }
  error(error,data={}){
    this.log('rtc-error',{errorName:error.name,...data});
    globalThis.ConnectionDiagnostics?.error('rtc-error',error,{attempt:this.attempt,...data});
  }
  emit(signal){
    if(!this.peer)return false;
    const sent=this.signalOut({t:'rtc-signal',...this.peer,negotiationId:this.negotiationId,...signal})!==false;
    if(signal.kind!=='diagnostic')this.log(sent?'signal-send':'signal-dropped',{kind:signal.kind});
    return sent;
  }
  reset(){
    const old=this.pc;this.pc=null;this.up=false;this.verified=false;this.peerVerified=false;this.route=null;
    this.control=this.motion=null;this.ice=[];this.pendingCandidates=[];this.descriptionSent=false;this.localCandidates=[];this.remoteCandidates=[];this.lastHeard=0;this.checking=false;this.lastCheck=0;this.started=0;this.routeIssue=null;this.lastDiagnostic='';this.lastStats=0;this.rttMs=null;this.rejectedCount=0;
    this.finishGathering?.();this.finishGathering=null;
    clearTimeout(this.retryTimer);this.retryTimer=null;old?.close();
  }
  close(){this.setPeer(null);}
  destroy(){this.close();clearInterval(this.monitor);}
  create(negotiationId){
    this.reset();this.negotiationId=negotiationId;this.started=performance.now();this.attempt++;
    if(typeof RTCPeerConnection==='undefined'){this.state('unsupported','This browser cannot make a direct connection. Use a current Safari, Chrome or Edge browser.');return null;}
    // Intentionally no STUN/TURN servers and no cloud fallback.
    let pc;
    try{pc=this.pc=new RTCPeerConnection({iceServers:[],iceTransportPolicy:'all',bundlePolicy:'max-bundle'});}
    catch(error){this.error(error,{stage:'create'});this.state('unsupported','This browser blocked the direct connection. Check its WebRTC and Local Network settings, then reload.');return null;}
    this.log('rtc-create',{hint:!!this.addressHint});
    pc.onicecandidate=e=>{
      if(this.pc!==pc)return;
      if(!e.candidate){this.log('rtc-state',{stage:'gathering-complete',localCount:this.localCandidates.length,rejectedCount:this.rejectedCount});return;}
      const parts=e.candidate.candidate.split(/\s+/),address=parts[4]||'';
      const accepted=localCandidate(e.candidate);
      this.log('ice-candidate',{accepted,candidateType:e.candidate.type||parts[parts.indexOf('typ')+1],protocol:e.candidate.protocol||parts[2],addressType:address.includes('.local')?'mdns':address.includes(':')?'ipv6':'ipv4'});
      if(!accepted){this.rejectedCount++;return;}
      const original=e.candidate.toJSON(),hint=hintedCandidate(original,this.addressHint);
      for(const candidate of hint?[{...original,candidate:hint},original]:[original]){
        this.localCandidates.push(candidateInfo(candidate));
        const message={kind:'candidate',candidate};
        if(this.descriptionSent)this.emit(message);else this.pendingCandidates.push(message);
      }
    };
    pc.onicecandidateerror=e=>{if(this.pc===pc)this.log('ice-error',{errorCode:e.errorCode});};
    for(const type of ['iceconnectionstatechange','icegatheringstatechange','signalingstatechange'])pc.addEventListener(type,()=>{
      if(this.pc!==pc)return;this.log('rtc-state');
      if(type==='iceconnectionstatechange')this.check();
    });
    pc.ondatachannel=e=>{if(this.pc===pc)this.channel(e.channel);};
    pc.onconnectionstatechange=()=>{
      if(this.pc!==pc)return;
      this.log('rtc-state');
      if(['disconnected','failed','closed'].includes(pc.connectionState))this.unavailable('The direct Wi-Fi connection was interrupted. '+HELP);
      else this.check();
    };
    this.state('connecting','Connecting directly over your local Wi-Fi…');
    return pc;
  }
  async offer(){
    if(!this.peer||this.role!=='host')return;
    const pc=this.create(uuid());if(!pc)return;
    try{
      this.channel(pc.createDataChannel('control',{ordered:true}));
      this.channel(pc.createDataChannel('motion',{ordered:false,maxRetransmits:0}));
      const offer=await pc.createOffer();if(this.pc!==pc)return;
      await pc.setLocalDescription(offer);await this.describeWhenGathered(pc,'offer');
    }catch(error){if(this.pc===pc){this.error(error,{stage:'offer'});this.unavailable('Could not establish a local connection. '+HELP);}}
  }
  async describeWhenGathered(pc,kind){
    // Send the first local addresses with the SDP, before remote ICE checks can
    // nominate a temporary, privacy-redacted peer-reflexive route.
    if(this.pc!==pc)return;
    if(pc.iceGatheringState!=='complete')await new Promise(resolve=>{
      let timer;
      const done=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',changed);if(this.finishGathering===done)this.finishGathering=null;resolve();};
      const changed=()=>{if(pc.iceGatheringState==='complete'||this.pc!==pc)done();};
      this.finishGathering=done;pc.addEventListener('icegatheringstatechange',changed);timer=setTimeout(done,1800);changed();
    });
    if(this.pc===pc){this.describe(kind,pc.localDescription);this.diagnostic('gathered');}
  }
  diagnostic(phase){
    if(!this.peer)return;
    const data={phase,ice:this.pc?.iceConnectionState||'new',connection:this.pc?.connectionState||'new',localCount:this.localCandidates?.length||0,remoteCount:this.remoteCandidates?.length||0,reason:this.routeIssue||''};
    const signature=JSON.stringify(data);if(signature===this.lastDiagnostic)return;this.lastDiagnostic=signature;
    this.emit({kind:'diagnostic',diagnostic:data});
  }
  describe(kind,description){
    // Preserve description-before-candidate ordering even if a browser gathers ICE early.
    this.log('sdp-local',{kind,localCount:this.localCandidates?.length||0});
    this.emit({kind,description:{type:kind,sdp:localSDP(description.sdp,this.addressHint)}});
    this.descriptionSent=true;
    for(const candidate of this.pendingCandidates.splice(0))this.emit(candidate);
  }
  signal(message){
    // Serialize trickled candidates and descriptions, including across rapid PC navigation.
    this.serial=this.serial.then(()=>this.acceptSignal(message)).catch(error=>{if(this.peer&&message.peerId===this.peer.peerId&&message.hostId===this.peer.hostId&&message.negotiationId===this.negotiationId){this.error(error,{kind:message.kind});this.unavailable('Could not establish a local connection. '+HELP);}});
  }
  async acceptSignal(m){
    if(!this.peer||!['hostId','clientId','peerId'].every(key=>m[key]===this.peer[key]))return;
    this.log('signal-received',{kind:m.kind});
    // One side can lose the link before the other notices. A paired phone's
    // restart request must work even while the PC still considers it connected.
    if(m.kind==='restart'){if(this.role==='host'&&!this.retryTimer)this.offer();return;}
    if(typeof m.negotiationId!=='string'||m.negotiationId.length>100)return;
    if(m.kind==='offer'&&this.role==='phone'){
      if(m.description?.type!=='offer')return;
      // Candidates preceding the offer are not needed: the host sends the SDP before trickle events.
      const pc=this.create(m.negotiationId);if(!pc)return;
      this.recordDescription(m.description.sdp);
      await pc.setRemoteDescription({type:'offer',sdp:localSDP(m.description.sdp)});
      if(this.pc!==pc)return;
      this.log('sdp-remote',{kind:'offer',remoteCount:this.remoteCandidates.length});
      const answer=await pc.createAnswer();if(this.pc!==pc)return;
      await pc.setLocalDescription(answer);
      await this.describeWhenGathered(pc,'answer');
      return;
    }
    const pc=this.pc;if(!pc||m.negotiationId!==this.negotiationId)return;
    if(m.kind==='answer'&&this.role==='host'&&m.description?.type==='answer'&&pc.signalingState==='have-local-offer'){
      this.recordDescription(m.description.sdp);
      await pc.setRemoteDescription({type:'answer',sdp:localSDP(m.description.sdp)});
      if(this.pc!==pc)return;
      this.log('sdp-remote',{kind:'answer',remoteCount:this.remoteCandidates.length});
      for(const candidate of this.ice.splice(0)){if(this.pc===pc)await this.addCandidate(pc,candidate);}
    }else if(m.kind==='candidate'&&localCandidate(m.candidate)){
      this.remoteCandidates.push(candidateInfo(m.candidate));
      if(pc.remoteDescription)await this.addCandidate(pc,m.candidate);
      else if(this.ice.length<128)this.ice.push(m.candidate);
    }
  }
  async addCandidate(pc,candidate){
    try{await pc.addIceCandidate(candidate);}
    catch(error){
      // A failed/stale trickle candidate must not tear down other working routes.
      // The ICE timeout still reports failure if no usable route remains.
      if(this.pc===pc)this.error(error,{stage:'add-candidate'});
    }
  }
  recordDescription(sdp){for(const line of sdp.split(/\r?\n/)){const candidate=candidateInfo(line);if(candidate)this.remoteCandidates.push(candidate);}}
  channel(channel){
    const pc=this.pc;
    if(!['motion','control'].includes(channel.label)||this[channel.label]){channel.close();return;}
    if(channel.label==='motion'&&(channel.ordered||channel.maxRetransmits!==0)){channel.close();return;}
    this[channel.label]=channel;
    channel.onopen=()=>{if(this.pc===pc){this.log('channel-open',{channel:channel.label});this.lastHeard=performance.now();this.check();}};
    channel.onclose=()=>{if(this.pc===pc){this.log('channel-close',{channel:channel.label});this.unavailable('The direct Wi-Fi connection closed. '+HELP);}};
    channel.onerror=event=>{
      // A channel can fail while a page is closing; recovery owns this error.
      event.preventDefault();
      if(this.pc===pc){this.log('channel-error',{channel:channel.label,errorName:event.error?.name});this.unavailable('The direct Wi-Fi connection was interrupted. '+HELP);}
    };
    channel.onmessage=e=>{
      if(this.pc!==pc||typeof e.data!=='string'||e.data.length>65536)return;
      let m;try{m=JSON.parse(e.data);}catch{return;}
      if(!m||typeof m!=='object')return;
      this.lastHeard=performance.now();
      if(channel.label==='control'){
        if(m.t==='_local-proof'&&m.id===this.negotiationId){const first=!this.peerVerified;this.peerVerified=true;if(first){this.log('proof-received');this.check();}this.promote();return;}
        if(m.t==='_pulse'){this.internal({t:'_pulse-ack',at:m.at});return;}
        if(m.t==='_pulse-ack'){if(Number.isFinite(m.at))this.rttMs=Math.max(0,Math.round(performance.now()-m.at));return;}
      }
      if(!this.up)return;
      if(this.role==='host'&&(m.clientId!==this.peer.clientId||(m.hostId&&m.hostId!==this.peer.hostId)))return;
      if(this.role==='phone'&&m.hostId!==this.peer.hostId)return;
      if(channel.label==='motion'){
        if(this.role!=='host'||m.t!=='samples'||!Array.isArray(m.rows)||m.rows.length!==1||!Array.isArray(m.rows[0])||m.rows[0].length!==10||!m.rows[0].every(v=>Number.isFinite(v)&&Math.abs(v)<1e16))return;
      }else if(m.t==='samples')return;
      this.onMessage(m);
    };
  }
  canWrite(){
    const pc=this.pc;
    return !!pc&&pc.signalingState!=='closed'&&!['closed','failed','disconnected'].includes(pc.connectionState)&&!['closed','failed','disconnected'].includes(pc.iceConnectionState)&&pc.sctp?.state!=='closed'&&!['closed','failed'].includes(pc.sctp?.transport?.state);
  }
  internal(message){if(this.canWrite()&&this.control?.readyState==='open'&&this.control.bufferedAmount<32768){try{this.control.send(JSON.stringify(message));}catch{}}}
  promote(){
    if(this.verified&&this.peerVerified&&this.control?.readyState==='open'&&this.motion?.readyState==='open'&&!this.up){
      clearTimeout(this.retryTimer);this.retryTimer=null;
      this.up=true;this.state('connected','Direct local Wi-Fi connected.');
      this.routeIssue=null;this.diagnostic('connected');
    }
  }
  async check(){
    const pc=this.pc;
    if(!pc||this.checking)return;
    this.checking=true;
    try{
      const report=await pc.getStats();if(this.pc!==pc)return;
      const now=performance.now();
      if(now-this.lastStats>(this.up?15000:5000)){
        this.lastStats=now;
        const keys=['id','type','candidateType','protocol','foundation','port','networkType','state','nominated','writable','localCandidateId','remoteCandidateId','selectedCandidatePairId','requestsSent','responsesReceived','bytesSent','bytesReceived','currentRoundTripTime'];
        globalThis.ConnectionDiagnostics?.detail('ice-stats',[...report.values()].filter(s=>/candidate|transport/.test(s.type)).slice(0,64).map(s=>({...Object.fromEntries(keys.filter(k=>s[k]!==undefined).map(k=>[k,s[k]])),addressType:(s.address||s.ip||'').includes('.local')?'mdns':(s.address||s.ip||'').includes(':')?'ipv6':s.address||s.ip?'ipv4':'hidden'})));
        const pairs=[...report.values()].filter(s=>s.type==='candidate-pair');
        const transport=[...report.values()].find(s=>s.type==='transport'&&s.selectedCandidatePairId);
        const pair=report.get(transport?.selectedCandidatePairId)||pairs.find(s=>s.nominated&&s.state==='succeeded')||pairs.find(s=>s.state==='in-progress');
        this.log('stats',{localCount:this.localCandidates?.length||0,remoteCount:this.remoteCandidates?.length||0,rejectedCount:this.rejectedCount||0,mdnsCount:this.localCandidates?.filter(c=>c.address.includes('.local')).length||0,pairCount:pairs.length,succeededCount:pairs.filter(s=>s.state==='succeeded').length,requestsSent:pair?.requestsSent,responsesReceived:pair?.responsesReceived,bytesSent:pair?.bytesSent,bytesReceived:pair?.bytesReceived,rttMs:this.rttMs,ageMs:this.lastHeard?now-this.lastHeard:0,dtls:pc.sctp?.transport?.state,sctp:pc.sctp?.state,reason:this.routeIssue||''});
      }
      if(!['connected','completed'].includes(pc.iceConnectionState))return;
      let selectedPair=null;
      try{selectedPair=pc.sctp?.transport?.iceTransport?.getSelectedCandidatePair?.();}catch{}
      const route=selectedLocalRoute(report,{localCandidates:this.localCandidates,remoteCandidates:this.remoteCandidates,peerVerified:this.peerVerified,selectedPair});
      if(route&&!route.allowed){
        if(this.routeIssue!==route.reason)this.log('route-check',{reason:route.reason,accepted:false});
        this.routeIssue=route.reason;this.diagnostic('verifying');
        if(route.pending){this.up=false;this.verified=false;this.state('verifying','Waiting for the browser to confirm the local connection.');return;}
        this.unavailable('A local Wi-Fi route could not be verified. '+HELP);return;
      }
      if(route?.allowed){if(!this.verified)this.log('route-check',{accepted:true,localType:route.localType,remoteType:route.remoteType});this.route=route;this.verified=true;this.internal({t:'_local-proof',id:this.negotiationId});this.promote();}
    }catch(error){this.error(error,{stage:'get-stats'});}
    finally{if(this.pc===pc)this.checking=false;}
  }
  unavailable(message){
    this.up=false;this.verified=false;this.peerVerified=false;this.state('blocked',message);
    this.diagnostic('blocked');
    if(!this.peer||this.retryTimer)return;
    this.retryTimer=setTimeout(()=>{this.retryTimer=null;if(this.role==='host')this.offer();else this.emit({kind:'restart'});},3000);
  }
  retry(){this.log('retry');clearTimeout(this.retryTimer);this.retryTimer=null;if(this.role==='host')this.offer();else this.emit({kind:'restart'});}
  tick(){
    if(!this.pc)return;
    const now=performance.now();
    // Loading a 3D scene can stall a phone's main thread. Keep the transport alive;
    // the game separately pauses as soon as motion samples are no longer fresh.
    if(this.up&&now-this.lastHeard>10000){this.unavailable('The direct Wi-Fi connection stopped responding. '+HELP);return;}
    this.internal({t:'_pulse',at:now});
    if(now-this.lastCheck>750){this.lastCheck=now;this.check();}
    // Give browser address discovery and permission prompts time to finish.
    // The presentation layer offers help sooner without aborting this attempt.
    if(!this.up&&now-this.started>60000&&!this.retryTimer){this.log('timeout',{duration:now-this.started});this.unavailable('The devices cannot reach each other over local Wi-Fi. '+HELP);}
  }
  send(message){
    // Trust the verified route and open channel, not an aggregate state that can
    // lag behind them. signalingState still stops sends synchronously on close.
    if(!this.up||!this.canWrite())return false;
    const channel=message.t==='samples'?this.motion:this.control;
    if(channel?.readyState!=='open'||channel.bufferedAmount>(message.t==='samples'?4096:262144))return false;
    try{const data=JSON.stringify(message);if(data.length>65536)return false;channel.send(data);return true;}catch{return false;}
  }
}
