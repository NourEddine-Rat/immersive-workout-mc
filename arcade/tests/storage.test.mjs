import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {mergeSessions,totals,periodRows,readSessions,JOURNAL_KEY} from '../engine/activity-store.js';

test('blocked localStorage retains pairing, identity and profile in memory; duplicate history remains one session',()=>{
 const events=[];
 const sandbox={Map,Date,Math,crypto:{randomUUID:()=> 'phone-identity'},localStorage:{getItem:()=>null,setItem:()=>{throw Error('Quota');}},mergeSessions,totals,periodRows,readSessions:()=>[],JOURNAL_KEY,CustomEvent:class{constructor(type){this.type=type;}},addEventListener(){},dispatchEvent:e=>events.push(e.type)};
 sandbox.window=sandbox;
 const source=fs.readFileSync(new URL('../phone/store.js',import.meta.url),'utf8').replace(/^import .*\n/,'');
 vm.runInNewContext(source,sandbox);
 const app=sandbox.PhoneApp;
 app.save('inmotion.pair.v1',{code:'123456'});assert.equal(app.read('inmotion.pair.v1',null).code,'123456');
 assert.equal(app.onboarded,false);
 app.preference('guideSeen',true);app.preference('page','controller');assert.equal(app.onboarded,false);
 app.save('inmotion.basics.v1',{username:'player',weightKg:88});assert.equal(app.profile.weightKg,88);assert.equal(app.id,'phone-identity');assert.equal(app.onboarded,false);
 app.save('inmotion.basics.v1',{username:'player',weightKg:88,sex:'female'});assert.equal(app.onboarded,true);
 assert.equal(app.storageOK,false);assert.equal(events.filter(e=>e==='storage-unavailable').length,1);
 const row={id:'round',userId:app.id,game:'subway',startedAt:Date.now(),updatedAt:Date.now(),steps:12,complete:true};
 app.ingest([row,row]);app.ingest([row]);assert.equal(app.sessions.length,1);assert.equal(app.summary().steps,12);
});

test('calibration follows its player and survives blocked PC storage through phone sync',async()=>{
 const saved=new Map(),events=[];
 globalThis.localStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
 globalThis.window={dispatchEvent:e=>events.push(e.type)};
 globalThis.CustomEvent=class{constructor(type,options){this.type=type;this.detail=options?.detail;}};
 const profile=await import('../engine/profile.js');
 try{
  const first={v:1,created:100,cfg:{jump:{vUp:.5}}},second={v:1,created:200,cfg:{jump:{vUp:.7}}};
  assert.equal(profile.selectUser('one'),null);profile.save(first);
  assert.equal(profile.selectUser('two'),null);profile.save(second);
  assert.equal(profile.selectUser('one').created,100);assert.equal(profile.load().created,100);
  assert.equal(profile.selectUser('one',{...first,created:300}).created,300);
  globalThis.localStorage={getItem(){throw Error('Blocked');},setItem(){throw Error('Blocked');}};
  assert.equal(profile.selectUser('two',second).created,200);assert.equal(profile.load().created,200);
  assert.ok(events.includes('calibration-saved'));
 }finally{delete globalThis.window;delete globalThis.localStorage;delete globalThis.CustomEvent;}
});
