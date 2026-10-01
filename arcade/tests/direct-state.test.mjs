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
