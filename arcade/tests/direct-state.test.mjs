import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectLink} from '../engine/direct-link.js';

function fixture(connectionState){
  const packets=[];
  const link=new DirectLink({role:'phone',signal:()=>{}});
  link.pc={connectionState,signalingState:'stable',close(){}};
  link.control={readyState:'open',bufferedAmount:0,send:data=>packets.push(JSON.parse(data))};
  link.motion=link.control;
  return {link,packets};
}

test('open channels exchange proof while aggregate connection state is delayed or unavailable',()=>{
  for(const state of ['connecting','new',undefined]){
    const {link,packets}=fixture(state);
    try{
      link.internal({t:'_local-proof',id:'negotiation'});
      assert.equal(packets.length,1,`local proof must not wait for connectionState=${state}`);
      assert.equal(link.send({t:'phone-profile'}),false,'gameplay still requires a verified direct link');
      link.up=true;
      assert.equal(link.send({t:'phone-profile'}),true);
    }finally{link.destroy();}
  }
});

test('closed peers cannot send even while WebKit still reports an open data channel',()=>{
  const {link,packets}=fixture('connecting');
  try{
    link.up=true;link.pc.signalingState='closed';
    link.internal({t:'_pulse'});
    assert.equal(link.send({t:'samples',rows:[]}),false);
    assert.equal(packets.length,0);
  }finally{link.destroy();}
});

test('failed and disconnected transports cannot emit keepalives through stale open channels',()=>{
 for(const state of ['failed','disconnected','closed']){
  const {link,packets}=fixture(state);
  try{link.up=true;link.internal({t:'_pulse'});assert.equal(link.send({t:'samples',rows:[]}),false);assert.equal(packets.length,0);}
  finally{link.destroy();}
 }
});

test('a short phone rendering stall does not destroy an established connection',()=>{
 const {link}=fixture('connected');
 try{
  link.up=true;link.lastHeard=performance.now()-2500;link.lastCheck=performance.now();link.started=performance.now();
  link.tick();assert.equal(link.up,true);assert.equal(link.retryTimer,undefined);
 }finally{link.destroy();}
});

test('slow local discovery is not restarted every twelve seconds',()=>{
 const {link}=fixture('connecting');
 try{
  link.peer={hostId:'pc',clientId:'phone',peerId:'pair'};
  link.started=performance.now()-20000;link.lastCheck=performance.now();
  link.tick();assert.equal(link.retryTimer,undefined);assert.notEqual(link.status,'blocked');
  link.started=performance.now()-61000;link.tick();assert.equal(link.status,'blocked');assert.ok(link.retryTimer);
 }finally{link.destroy();}
});

test('a paired phone can restart when only the PC still thinks the link is connected',async()=>{
  const {link}=fixture('connected');let offers=0;
  try{
    link.role='host';link.up=true;
    link.peer={hostId:'pc',clientId:'phone',peerId:'pair'};
    link.offer=()=>{offers++;};
    await link.acceptSignal({...link.peer,kind:'restart'});
    assert.equal(offers,1,'phone recovery must not be ignored because the PC still appears connected');
  }finally{link.destroy();}
});

test('incomplete private candidate metadata waits for signaling instead of restarting a working ICE negotiation',async()=>{
 const {link}=fixture('connected');
 try{
  link.pc.iceConnectionState='connected';link.localCandidates=[];link.remoteCandidates=[];
  link.pc.getStats=async()=>new Map([
    ['transport',{type:'transport',selectedCandidatePairId:'pair'}],
    ['pair',{type:'candidate-pair',state:'succeeded',nominated:true,localCandidateId:'local',remoteCandidateId:'remote'}],
    ['local',{candidateType:'host',protocol:'udp',address:'',foundation:'local',port:5000}],
    ['remote',{candidateType:'host',protocol:'udp',address:'',foundation:'remote',port:5001}]
  ]);
  await link.check();assert.equal(link.up,false);assert.equal(link.status,'verifying');assert.equal(link.retryTimer,undefined);
  link.localCandidates=[{foundation:'local',port:5000,protocol:'udp',address:'pc.local'}];
  link.remoteCandidates=[{foundation:'remote',port:5001,protocol:'udp',address:'phone.local'}];
  link.peerVerified=true;
  await link.check();assert.equal(link.up,true);assert.equal(link.route.allowed,true);
 }finally{link.destroy();}
});

test('the initial offer contains gathered LAN candidates and excludes public candidates',async()=>{
 const messages=[];const link=new DirectLink({role:'host',signal:m=>messages.push(m)});
 const pc=Object.assign(new EventTarget(),{iceGatheringState:'gathering',localDescription:{type:'offer',sdp:'v=0\r\n'},close(){}});
 link.pc=pc;link.peer={hostId:'pc',clientId:'phone',peerId:'pair'};link.negotiationId='n';link.pendingCandidates=[];
 try{
  const pending=link.describeWhenGathered(pc,'offer');assert.equal(messages.length,0);
  pc.localDescription={type:'offer',sdp:'v=0\r\na=candidate:1 1 udp 1 pc.local 5000 typ host\r\na=candidate:2 1 udp 1 8.8.8.8 5001 typ host\r\n'};
  pc.iceGatheringState='complete';pc.dispatchEvent(new Event('icegatheringstatechange'));await pending;
  const offer=messages.find(m=>m.kind==='offer');assert.match(offer.description.sdp,/pc.local/);assert.doesNotMatch(offer.description.sdp,/8\.8\.8\.8/);
 }finally{link.destroy();}
});

test('only the current control channel proof triggers verification, and repeated proofs do not echo',()=>{
 const link=new DirectLink({role:'host',signal:()=>{}});let checks=0;
 link.pc={close(){}};link.negotiationId='current';link.check=()=>checks++;
 const control={label:'control',close(){}},motion={label:'motion',ordered:false,maxRetransmits:0,close(){}};
 try{
  link.channel(control);link.channel(motion);
  const proof=id=>({data:JSON.stringify({t:'_local-proof',id})});
  control.onmessage(proof('old'));motion.onmessage(proof('current'));
  assert.equal(checks,0);assert.ok(!link.peerVerified);
  control.onmessage(proof('current'));control.onmessage(proof('current'));
  assert.equal(checks,1);assert.equal(link.peerVerified,true);
 }finally{link.destroy();}
});

test('an unusable trickle candidate does not kill a working direct channel',async()=>{
 const {link}=fixture('connected');
 try{
  link.up=true;link.pc.remoteDescription={type:'answer'};link.remoteCandidates=[];
  link.peer={hostId:'pc',clientId:'phone',peerId:'pair'};link.negotiationId='n';
  link.pc.addIceCandidate=async()=>{throw new DOMException('Candidate no longer exists','OperationError');};
  await link.acceptSignal({...link.peer,negotiationId:'n',kind:'candidate',candidate:{candidate:'candidate:1 1 udp 1 pc.local 1234 typ host'}});
  assert.equal(link.up,true);assert.equal(link.retryTimer,undefined);
 }finally{link.destroy();}
});

test('a completed stale answer cannot consume candidates from a replacement peer',async()=>{
 const link=new DirectLink({role:'host',signal:()=>{}});let finish;
 const old={signalingState:'have-local-offer',close(){},setRemoteDescription:()=>new Promise(resolve=>finish=resolve)};
 link.pc=old;link.peer={hostId:'pc',clientId:'phone',peerId:'pair'};link.negotiationId='n';link.remoteCandidates=[];link.ice=[];
 try{
  const accepting=link.acceptSignal({...link.peer,negotiationId:'n',kind:'answer',description:{type:'answer',sdp:'v=0\r\n'}});
  link.reset();link.pc={close(){}};link.ice=[{candidate:'replacement'}];finish();await accepting;
  assert.deepEqual(link.ice,[{candidate:'replacement'}]);
 }finally{link.destroy();}
});

function establishedFixture(role='host'){
 const messages=[],link=new DirectLink({role,signal:m=>messages.push(m)});
 const offers=[],descriptions=[];
 const pc=Object.assign(new EventTarget(),{
  connectionState:'connected',iceConnectionState:'connected',iceGatheringState:'complete',signalingState:'stable',
  remoteDescription:{type:role==='host'?'answer':'offer',sdp:'v=0\r\n'},
  sctp:{state:'connected',transport:{state:'connected'}},
  close(){this.closed=true;},
  async createOffer(options){offers.push(options);return {type:'offer',sdp:'v=0\r\n'};},
  async createAnswer(){return {type:'answer',sdp:'v=0\r\n'};},
  async setLocalDescription(description){this.localDescription=description;this.signalingState=description.type==='offer'?'have-local-offer':'stable';},
  async setRemoteDescription(description){descriptions.push(description);this.remoteDescription=description;this.signalingState=description.type==='offer'?'have-remote-offer':'stable';},
  async getStats(){return new Map();}
 });
 link.pc=pc;link.peer={hostId:'pc',clientId:'phone',peerId:'pair'};link.negotiationId='original';
 link.localCandidates=[];link.remoteCandidates=[];link.pendingCandidates=[];link.ice=[];
 const control={label:'control',readyState:'open',bufferedAmount:0,send(){},close(){}};
 const motion={label:'motion',readyState:'open',ordered:false,maxRetransmits:0,bufferedAmount:0,send(){},close(){}};
 link.channel(control);link.channel(motion);link.up=true;link.verified=true;link.peerVerified=true;link.everConnected=true;link.started=performance.now()-120000;
 return {link,pc,messages,offers,descriptions,control,motion};
}

test('a brief disconnect after a long session has a new recovery deadline and cancels when proofs return',()=>{
 const {link,pc}=establishedFixture();let recoveries=0;
 try{
  link.recover=()=>recoveries++;
  const now=performance.now();
  link.unavailable('Interrupted',{transient:true});
  assert.equal(link.status,'connecting');assert.equal(link.up,false);
  assert.ok(link.attemptDeadline>=now+59000,'old initial pairing time must not expire this recovery');
  assert.equal(link.retryTimer._idleTimeout,5000,'give ICE a grace period before replacing anything');
  const pending=link.retryTimer;
  link.lastCheck=performance.now();link.tick();
  assert.equal(link.status,'connecting');assert.equal(link.retryTimer,pending);
  link.verified=true;link.peerVerified=true;link.promote();
  assert.equal(link.up,true);assert.equal(link.retryTimer,null);assert.equal(link.attemptDeadline,0);
  assert.equal(link.pc,pc);assert.equal(recoveries,0);
 }finally{link.destroy();}
});

test('repeated failures back off and successful recovery resets the delay',()=>{
 const {link}=establishedFixture('phone');
 try{
  link.retryFailures=99;link.unavailable('Interrupted',{transient:true});
  assert.equal(link.retryTimer._idleTimeout,30000);
  link.verified=true;link.peerVerified=true;link.promote();
  assert.equal(link.retryFailures,0);
  link.unavailable('Interrupted',{transient:true});
  assert.equal(link.retryTimer._idleTimeout,6000,'phone gives the host time to lead the ICE restart');
 }finally{link.destroy();}
});

test('an automatic ICE restart keeps open channels but changes credentials and proof identity',async()=>{
 const {link,pc,messages,offers,control,motion}=establishedFixture();
 try{
  await link.offer({iceRestart:true});
  assert.equal(link.pc,pc);assert.equal(link.control,control);assert.equal(link.motion,motion);assert.ok(!pc.closed);
  assert.deepEqual(offers,[{iceRestart:true}]);
  assert.notEqual(link.negotiationId,'original');assert.equal(link.up,false);assert.equal(link.peerVerified,false);
  const offer=messages.find(m=>m.kind==='offer');
  assert.equal(offer.restartOf,'original');assert.equal(offer.negotiationId,link.negotiationId);
  control.onmessage({data:JSON.stringify({t:'_local-proof',id:'original'})});
  assert.equal(link.peerVerified,false,'old route proof cannot validate a new negotiation');
 }finally{link.destroy();}
});

test('the phone applies a matching ICE restart without rebuilding channels and replays lost answers',async()=>{
 const {link,pc,messages,descriptions,control,motion}=establishedFixture('phone');
 const offer={...link.peer,kind:'offer',negotiationId:'replacement',restartOf:'original',description:{type:'offer',sdp:'v=0\r\n'}};
 try{
  await link.acceptSignal(offer);
  assert.equal(link.pc,pc);assert.equal(link.control,control);assert.equal(link.motion,motion);assert.ok(!pc.closed);
  assert.equal(link.negotiationId,'replacement');assert.equal(link.peerVerified,false);assert.equal(descriptions.length,1);
  assert.equal(messages.filter(m=>m.kind==='answer').length,1);
  await link.acceptSignal(offer);
  assert.equal(descriptions.length,1,'duplicate offer must not be applied again');
  assert.equal(messages.filter(m=>m.kind==='answer').length,2,'the lost answer may be retried without a new transport');
  await link.acceptSignal({...offer,negotiationId:'stale-replacement'});
  assert.equal(link.negotiationId,'replacement');assert.equal(descriptions.length,1,'stale restart ancestry must be ignored');
 }finally{link.destroy();}
});

test('a phone with a closed channel asks for a fresh connection instead of partially accepting a restart',async()=>{
 const {link,pc,control}=establishedFixture('phone');
 try{
  control.readyState='closed';
  await link.acceptSignal({...link.peer,kind:'offer',negotiationId:'replacement',restartOf:'original',description:{type:'offer',sdp:'v=0\r\n'}});
  assert.equal(link.negotiationId,'original');assert.equal(link.pc,pc);assert.equal(link.status,'blocked');assert.ok(link.retryTimer);
 }finally{link.destroy();}
});

test('automatic recovery tries ICE restart once, then falls back to a fresh peer after failure',async()=>{
 const {link,pc}=establishedFixture();let fresh=0;
 try{
  await link.offer({iceRestart:true});
  pc.signalingState='stable';
  link.create=()=>{fresh++;return null;};
  await link.offer({iceRestart:true});
  assert.equal(fresh,1,'an unsuccessful restart must not loop on the same broken transport');
 }finally{link.destroy();}
});

test('simultaneous restart requests cannot replace an offer still being gathered',async()=>{
 const {link,pc,offers}=establishedFixture();let finish;
 pc.createOffer=options=>{offers.push(options);return new Promise(resolve=>finish=resolve);};
 try{
  const offering=link.offer({iceRestart:true});
  await link.acceptSignal({...link.peer,kind:'restart'});
  link.recover();
  assert.equal(offers.length,1);assert.equal(link.pc,pc);assert.ok(!pc.closed);
  finish({type:'offer',sdp:'v=0\r\n'});await offering;
 }finally{link.destroy();}
});

test('rapid repeated recovery signals are coalesced, while an explicit retry remains fresh',()=>{
 const {link}=establishedFixture();const options=[];
 try{
  link.up=false;link.offer=value=>options.push(value);
  link.recover();link.recover();
  assert.equal(options.length,1);assert.equal(options[0].iceRestart,true);
  link.retry();link.retry();
  assert.equal(options.length,2);assert.equal(options[1].force,true);
 }finally{link.destroy();}
});

test('SDP and trickle duplicates are counted once and not re-added to ICE',async()=>{
 const {link,pc}=establishedFixture();const added=[];
 const candidate={candidate:'candidate:1 1 udp 1 pc.local 1234 typ host',sdpMid:'0',sdpMLineIndex:0};
 try{
  pc.addIceCandidate=async value=>added.push(value);
  link.recordDescription('v=0\r\na='+candidate.candidate+'\r\n');
  await link.acceptSignal({...link.peer,negotiationId:link.negotiationId,kind:'candidate',candidate:{...candidate,candidate:candidate.candidate+' generation 0 ufrag current network-cost 999'}});
  assert.equal(link.remoteCandidates.length,1);assert.equal(added.length,0);
  const second={...candidate,candidate:'candidate:2 1 udp 1 phone.local 2345 typ host'};
  await link.acceptSignal({...link.peer,negotiationId:link.negotiationId,kind:'candidate',candidate:second});
  await link.acceptSignal({...link.peer,negotiationId:link.negotiationId,kind:'candidate',candidate:second});
  assert.equal(link.remoteCandidates.length,2);assert.equal(added.length,1);
 }finally{link.destroy();}
});

test('late statistics from before an ICE restart cannot verify the new attempt',async()=>{
 const {link,pc}=establishedFixture();let finish;
 pc.getStats=()=>new Promise(resolve=>finish=resolve);
 try{
  const checking=link.check();link.beginAttempt('replacement');
  finish(new Map([
   ['transport',{type:'transport',selectedCandidatePairId:'pair'}],
   ['pair',{type:'candidate-pair',state:'succeeded',nominated:true,localCandidateId:'local',remoteCandidateId:'remote'}],
   ['local',{candidateType:'host',protocol:'udp',address:'192.168.1.10',foundation:'local',port:5000}],
   ['remote',{candidateType:'host',protocol:'udp',address:'192.168.1.11',foundation:'remote',port:5001}]
  ]));
  await checking;assert.equal(link.verified,false);assert.equal(link.up,false);assert.equal(link.route,null);
 }finally{link.destroy();}
});

test('a stale answer on a reused peer cannot drain the replacement ICE candidate queue',async()=>{
 const {link,pc}=establishedFixture();let finish;
 pc.signalingState='have-local-offer';pc.setRemoteDescription=()=>new Promise(resolve=>finish=resolve);
 try{
  const accepting=link.acceptSignal({...link.peer,negotiationId:'original',kind:'answer',description:{type:'answer',sdp:'v=0\r\n'}});
  link.beginAttempt('replacement');link.ice=[{candidate:'replacement'}];finish();await accepting;
  assert.deepEqual(link.ice,[{candidate:'replacement'}]);
 }finally{link.destroy();}
});

test('a just-reconnected signaling socket replays a pending offer without replacing the peer',async()=>{
 const {link,pc,messages}=establishedFixture();
 try{
  await link.offer({iceRestart:true});
  const id=link.negotiationId;link.recover();
  assert.equal(link.pc,pc);assert.equal(link.negotiationId,id);
  const offers=messages.filter(m=>m.kind==='offer');assert.equal(offers.length,2);
  assert.equal(offers[1].restartOf,'original');assert.equal(offers[1].negotiationId,id);
 }finally{link.destroy();}
});

test('late ICE events from old credentials are ignored while candidates with hidden credentials still work',()=>{
 const Native=globalThis.RTCPeerConnection;
 globalThis.RTCPeerConnection=class extends EventTarget{close(){}};
 const link=new DirectLink({role:'host',signal:()=>{}});
 try{
  link.peer={hostId:'pc',clientId:'phone',peerId:'pair'};
  const pc=link.create('current');link.localIceUfrags=new Set(['current']);
  const candidate=(line,usernameFragment)=>({candidate:line,toJSON(){return {candidate:line,usernameFragment};}});
  pc.onicecandidate({candidate:candidate('candidate:1 1 udp 1 pc.local 1234 typ host ufrag old','old')});
  assert.equal(link.localCandidates.length,0);
  pc.onicecandidate({candidate:candidate('candidate:1 1 udp 1 pc.local 1234 typ host')});
  assert.equal(link.localCandidates.length,1,'WebKit may omit the optional username fragment');
  pc.onicecandidate({candidate:candidate('candidate:2 1 udp 1 pc.local 2345 typ host ufrag current','current')});
  assert.equal(link.localCandidates.length,2);
 }finally{link.destroy();if(Native===undefined)delete globalThis.RTCPeerConnection;else globalThis.RTCPeerConnection=Native;}
});


test('a permission-driven retry bypasses the ordinary repeated-click throttle',()=>{
 const {link}=establishedFixture();let offers=0;
 try{
  link.offer=()=>offers++;
  link.retry();link.retry();assert.equal(offers,1);
  link.retry({force:true});assert.equal(offers,2,'new microphone permission must start a fresh candidate-gathering attempt');
 }finally{link.destroy();}
});
