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
