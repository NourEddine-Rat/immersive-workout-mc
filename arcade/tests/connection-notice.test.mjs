import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionNotice} from '../engine/lib/connection-notice.js';

test('connection help stays stable through automatic retries and clears on recovery',()=>{
  const notice=new ConnectionNotice();
  assert.equal(notice.update({},0).state,'waiting');
  assert.equal(notice.update({pending:true},1).visible,false);
  assert.equal(notice.update({pending:true,failed:true},1600).state,'help');
  for(let time=2000;time<20000;time+=1000){
    const state=notice.update({pending:true,failed:time%2000===0},time);
    assert.equal(state.state,'help');assert.equal(state.visible,true);assert.equal(state.retry,true);
  }
  assert.equal(notice.update({connected:true},21000).visible,false);
  assert.equal(notice.update({pending:true},22000).state,'reconnecting');
  for(let time=24000;time<40000;time+=1000)assert.equal(notice.update({pending:time%2000===0,failed:time%3000===0},time).state,'reconnecting');
  notice.reset();assert.equal(notice.update({},40000).state,'waiting');
});

test('quiet connection attempts offer help after ten seconds without resetting the grace period',()=>{
  const notice=new ConnectionNotice();
  assert.equal(notice.update({pending:true},0).state,'connecting');
  assert.equal(notice.update({pending:true},1499).visible,false);
  assert.equal(notice.update({pending:true},1500).visible,true);
  assert.equal(notice.update({pending:true},10000).state,'help');
  assert.equal(notice.update({pending:true},10001).retry,true);
});
