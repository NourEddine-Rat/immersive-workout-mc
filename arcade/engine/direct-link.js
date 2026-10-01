import {uuid} from './lib/identity.js';
import {localCandidate,localSDP,selectedLocalRoute,candidateInfo} from './lib/local-route.js';

const HELP='Connect both devices to the same Wi-Fi, allow Local Network access if asked, and avoid guest Wi-Fi or a VPN. Then retry.';
export class DirectLink {
  constructor({role,signal,onMessage=()=>{},onState=()=>{}}){
    this.role=role;this.signalOut=signal;this.onMessage=onMessage;this.onState=onState;
    this.peer=null;this.pc=null;this.status='waiting';this.up=false;this.serial=Promise.resolve();
    this.monitor=setInterval(()=>this.tick(),250);
  }
  setPeer(peer){
    if(peer&&this.peer&&['hostId','clientId','peerId'].every(key=>peer[key]===this.peer[key]))return;
    this.reset();this.peer=peer;
    if(peer&&typeof RTCPeerConnection==='undefined'){this.state('unsupported','This browser cannot make a direct connection. Use a current Safari, Chrome or Edge browser.');return;}
    if(peer){this.state('connecting','Connecting directly over your local Wi-Fi…');if(this.role==='host')this.offer();}
    else this.state('waiting','Scan the PC code to connect over the same Wi-Fi.');
  }
  state(status,message){
    const changed=this.status!==status||this.message!==message;
    this.status=status;this.message=message;
    if(changed)this.onState(this.snapshot());
  }
  snapshot(){return {direct:this.up,status:this.status,message:this.message,route:this.route||null,rttMs:this.rttMs??this.route?.rttMs??null};}
  emit(signal){if(this.peer)this.signalOut({t:'rtc-signal',...this.peer,negotiationId:this.negotiationId,...signal});}
  reset(){
    const old=this.pc;this.pc=null;this.up=false;this.verified=false;this.peerVerified=false;this.route=null;
    this.control=this.motion=null;this.ice=[];this.pendingCandidates=[];this.descriptionSent=false;this.localCandidates=[];this.remoteCandidates=[];this.lastHeard=0;this.checking=false;this.lastCheck=0;this.started=0;
    clearTimeout(this.retryTimer);this.retryTimer=null;old?.close();
  }
  close(){this.setPeer(null);}
  destroy(){this.close();clearInterval(this.monitor);}
  create(negotiationId){
    this.reset();this.negotiationId=negotiationId;this.started=performance.now();
    if(typeof RTCPeerConnection==='undefined'){this.state('unsupported','This browser cannot make a direct connection. Use a current Safari, Chrome or Edge browser.');return null;}
    // Intentionally no STUN/TURN servers and no cloud fallback.
    let pc;
    try{pc=this.pc=new RTCPeerConnection({iceServers:[],iceTransportPolicy:'all',bundlePolicy:'max-bundle'});}
    catch{this.state('unsupported','This browser blocked the direct connection. Check its WebRTC and Local Network settings, then reload.');return null;}
    pc.onicecandidate=e=>{
      if(this.pc!==pc||!e.candidate||!localCandidate(e.candidate))return;
      this.localCandidates.push(candidateInfo(e.candidate));
      const message={kind:'candidate',candidate:e.candidate.toJSON()};
      if(this.descriptionSent)this.emit(message);else this.pendingCandidates.push(message);
    };
    pc.ondatachannel=e=>{if(this.pc===pc)this.channel(e.channel);};
    pc.onconnectionstatechange=()=>{
      if(this.pc!==pc)return;
      if(['disconnected','failed','closed'].includes(pc.connectionState))this.unavailable('The direct Wi-Fi connection was interrupted. '+HELP);
      else this.check();
    };
    this.state('connecting','Connecting directly over your local Wi-Fi…');
    return pc;
  }
  async offer(){
    if(!this.peer||this.role!=='host')return;
    const pc=this.create(uuid());if(!pc)return;
    this.channel(pc.createDataChannel('control',{ordered:true}));
    this.channel(pc.createDataChannel('motion',{ordered:false,maxRetransmits:0}));
    try{await pc.setLocalDescription(await pc.createOffer());if(this.pc===pc)this.describe('offer',pc.localDescription);}
    catch{if(this.pc===pc)this.unavailable('Could not establish a local connection. '+HELP);}
  }
  describe(kind,description){
    // Preserve description-before-candidate ordering even if a browser gathers ICE early.
    this.emit({kind,description:{type:kind,sdp:localSDP(description.sdp)}});
    this.descriptionSent=true;
    for(const candidate of this.pendingCandidates.splice(0))this.emit(candidate);
  }
  signal(message){
    // Serialize trickled candidates and descriptions, including across rapid PC navigation.
    this.serial=this.serial.then(()=>this.acceptSignal(message)).catch(()=>{if(this.peer&&message.peerId===this.peer.peerId&&message.hostId===this.peer.hostId&&message.negotiationId===this.negotiationId)this.unavailable('Could not establish a local connection. '+HELP);});
  }
  async acceptSignal(m){
    if(!this.peer||!['hostId','clientId','peerId'].every(key=>m[key]===this.peer[key]))return;
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
      await pc.setLocalDescription(await pc.createAnswer());
      if(this.pc===pc)this.describe('answer',pc.localDescription);
      return;
    }
    const pc=this.pc;if(!pc||m.negotiationId!==this.negotiationId)return;
    if(m.kind==='answer'&&this.role==='host'&&m.description?.type==='answer'&&pc.signalingState==='have-local-offer'){
      this.recordDescription(m.description.sdp);
      await pc.setRemoteDescription({type:'answer',sdp:localSDP(m.description.sdp)});
      for(const candidate of this.ice.splice(0)){if(this.pc===pc)await pc.addIceCandidate(candidate);}
    }else if(m.kind==='candidate'&&localCandidate(m.candidate)){
      this.remoteCandidates.push(candidateInfo(m.candidate));
      if(pc.remoteDescription)await pc.addIceCandidate(m.candidate);
      else if(this.ice.length<128)this.ice.push(m.candidate);
    }
  }
  recordDescription(sdp){for(const line of sdp.split(/\r?\n/)){const candidate=candidateInfo(line);if(candidate)this.remoteCandidates.push(candidate);}}
  channel(channel){
    const pc=this.pc;
    if(!['motion','control'].includes(channel.label)||this[channel.label]){channel.close();return;}
    if(channel.label==='motion'&&(channel.ordered||channel.maxRetransmits!==0)){channel.close();return;}
    this[channel.label]=channel;
    channel.onopen=()=>{if(this.pc===pc){this.lastHeard=performance.now();this.check();}};
    channel.onclose=()=>{if(this.pc===pc)this.unavailable('The direct Wi-Fi connection closed. '+HELP);};
    channel.onerror=event=>{
      // A channel can fail while a page is closing; recovery owns this error.
      event.preventDefault();
      if(this.pc===pc)this.unavailable('The direct Wi-Fi connection was interrupted. '+HELP);
    };
    channel.onmessage=e=>{
      if(this.pc!==pc||typeof e.data!=='string'||e.data.length>65536)return;
      let m;try{m=JSON.parse(e.data);}catch{return;}
      if(!m||typeof m!=='object')return;
      this.lastHeard=performance.now();
      if(channel.label==='control'){
        if(m.t==='_local-proof'&&m.id===this.negotiationId){this.peerVerified=true;this.promote();return;}
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
  internal(message){if(this.pc&&this.pc.signalingState!=='closed'&&this.control?.readyState==='open'&&this.control.bufferedAmount<32768){try{this.control.send(JSON.stringify(message));}catch{}}}
  promote(){
    if(this.verified&&this.peerVerified&&this.control?.readyState==='open'&&this.motion?.readyState==='open'&&!this.up){
      clearTimeout(this.retryTimer);this.retryTimer=null;
      this.up=true;this.state('connected','Direct local Wi-Fi connected.');
    }
  }
  async check(){
    const pc=this.pc;
    if(!pc||this.checking||!['connected','completed'].includes(pc.iceConnectionState))return;
    this.checking=true;
    try{
      const route=selectedLocalRoute(await pc.getStats(),this);if(this.pc!==pc)return;
      if(route&&!route.allowed){this.unavailable('A local Wi-Fi route could not be verified. '+HELP);return;}
      if(route?.allowed){this.route=route;this.verified=true;this.internal({t:'_local-proof',id:this.negotiationId});this.promote();}
    }catch{/* Keep play blocked until the browser provides verifiable route information. */}
    finally{if(this.pc===pc)this.checking=false;}
  }
  unavailable(message){
    this.up=false;this.verified=false;this.peerVerified=false;this.state('blocked',message);
    if(!this.peer||this.retryTimer)return;
    this.retryTimer=setTimeout(()=>{this.retryTimer=null;if(this.role==='host')this.offer();else this.emit({kind:'restart'});},3000);
  }
  retry(){clearTimeout(this.retryTimer);this.retryTimer=null;if(this.role==='host')this.offer();else this.emit({kind:'restart'});}
  tick(){
    if(!this.pc)return;
    const now=performance.now();
    if(this.up&&now-this.lastHeard>1500){this.unavailable('The direct Wi-Fi connection stopped responding. '+HELP);return;}
    this.internal({t:'_pulse',at:now});
    if(now-this.lastCheck>750){this.lastCheck=now;this.check();}
    if(!this.up&&now-this.started>12000&&!this.retryTimer)this.unavailable('The devices cannot reach each other over local Wi-Fi. '+HELP);
  }
  send(message){
    // Trust the verified route and open channel, not an aggregate state that can
    // lag behind them. signalingState still stops sends synchronously on close.
    if(!this.up||!this.pc||this.pc.signalingState==='closed')return false;
    const channel=message.t==='samples'?this.motion:this.control;
    if(channel?.readyState!=='open'||channel.bufferedAmount>(message.t==='samples'?4096:262144))return false;
    try{const data=JSON.stringify(message);if(data.length>65536)return false;channel.send(data);return true;}catch{return false;}
  }
}
