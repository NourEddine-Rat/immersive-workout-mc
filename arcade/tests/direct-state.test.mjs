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
