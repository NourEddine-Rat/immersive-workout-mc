import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import WebSocket from 'ws';

test('diagnostic schema strips motion, profiles, credentials and addresses and bounds reports',()=>{
 const run=spawnSync('python3',['-c',`import connection_diagnostics as d
row={'event':'stats','traceId':'abc','seq':1,'at':10,'elapsed':5,'rows':[[1,2,3]],'data':{'ice':'failed','localCount':2,'rows':[[1,2,3]],'profile':{'name':'private'},'sdp':'secret','address':'192.168.1.2','password':'secret'}}
clean=d.client_events([row])[0]
assert set(clean['data'])=={'ice','localCount'}
assert 'rows' not in clean
assert not d.client_events([row]*25)
assert not d.client_events([{**row,'event':'samples'}])
assert not d.client_events([{**row,'seq':True}])
for event in ('microphone-request','microphone-granted','microphone-failed','microphone-cancelled'):
 assert d.client_events([{**row,'event':event}])[0]['event']==event
for i in range(6200): d.record('test',session='a',data={'rows':[[1,2,3]]})
assert len(d.EVENTS)==6000
assert len(d.report('a')['events'])==1000
assert not d.report('b')['events']
`],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
});

test('PC report combines paired phone and server events without exposing another room',{timeout:10000},async()=>{
 const child=spawn('python3',['-u','-c',"import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
 const port=await new Promise(r=>child.stdout.once('data',d=>r(Number(d.toString().trim()))));
 const base=`http://localhost:${port}`,sockets=[];
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 async function session(){const res=await fetch(base+'/where');return {info:await res.json(),cookie:res.headers.get('set-cookie').split(';')[0]};}
 async function socket(role,cookie){const ws=new WebSocket(`ws://localhost:${port}/ws?role=${role}`,{headers:cookie?{Cookie:cookie}:{}});sockets.push(ws);ws.on('error',()=>{});await new Promise(r=>ws.on('open',r));return ws;}
 try{
  const a=await session(),b=await session();
  const host=await socket('console',a.cookie),phone=await socket('phone');
  host.send(JSON.stringify({t:'host-register',hostId:'h'}));
  phone.send(JSON.stringify({t:'connection-log',events:[{event:'page-start',traceId:'phone-trace',seq:1,at:Date.now(),elapsed:10,data:{browser:'Safari',profile:'secret'}}]}));
  phone.send(JSON.stringify({t:'phone-join',clientId:'phone',instanceId:'instance',pairCode:a.info.pairCode}));
  await delay(100);
  assert.equal((await fetch(base+'/connection-report')).status,403);
  const report=await(await fetch(base+'/connection-report',{headers:{Cookie:a.cookie}})).json();
  assert.ok(report.events.some(e=>e.event==='pair-accepted'));
  assert.ok(report.events.some(e=>e.traceId==='phone-trace'));
  assert.ok(!JSON.stringify(report).includes('secret'));
  const other=await(await fetch(base+'/connection-report',{headers:{Cookie:b.cookie}})).json();
  assert.ok(!other.events.some(e=>e.traceId==='phone-trace'));
 }finally{for(const ws of sockets)ws.terminate();child.kill();}
});
