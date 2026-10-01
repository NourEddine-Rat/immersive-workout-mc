import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import WebSocket from 'ws';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('ICE restart signaling is bounded and strips unrelated data',()=>{
 const run=spawnSync('python3',['-c',`import serve
base={'kind':'offer','hostId':'pc','clientId':'phone','peerId':'pair','negotiationId':'new','restartOf':'old','description':{'type':'offer','sdp':'v=0\\r\\n'},'audio':'private','rows':[[1]]}
out=serve.rtc_message(base)
assert out['restartOf']=='old'
assert 'audio' not in out and 'rows' not in out
for bad in ('', 'x'*101, 123, 'new'):
 assert serve.rtc_message({**base,'restartOf':bad}) is None
assert 'restartOf' not in serve.rtc_message({**base,'kind':'answer','description':{'type':'answer','sdp':'v=0\\r\\n'}})
assert serve.rtc_message({**base,'kind':'diagnostic','diagnostic':{'phase':'reconnecting','ice':'disconnected','connection':'disconnected','reason':'','localCount':1,'remoteCount':1}})
`],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
});
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await delay(10);}assert.fail('Signaling timeout');}
test('pairing ownership, phone replacement, PC navigation and stale negotiation isolation',async()=>{
 const child=spawn('python3',['-u','-c',"import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','ignore']}),sockets=[];
 try{
  const port=await new Promise(r=>child.stdout.once('data',d=>r(Number(d.toString().trim()))));
  const base=`http://localhost:${port}`,response=await fetch(base+'/where'),cookie=response.headers.get('set-cookie').split(';')[0],{pairCode}=await response.json();
  async function peer(role){const ws=new WebSocket(`ws://localhost:${port}/ws?role=${role}`,{headers:role==='console'?{Cookie:cookie}:{}}),messages=[];sockets.push(ws);ws.onmessage=e=>messages.push(JSON.parse(e.data));await new Promise(r=>ws.onopen=r);return {ws,messages,send:m=>ws.send(JSON.stringify(m))};}
  const hub=await peer('console');hub.send({t:'host-register',hostId:'hub'});
  const p=await peer('phone'),join={t:'phone-join',clientId:'one',instanceId:'tab1',pairCode};p.send(join);
  await until(()=>p.messages.some(m=>m.t==='phone-paired'));
  const first=p.messages.find(m=>m.t==='phone-paired').peerId;
  const competitor=await peer('phone');competitor.send({...join,clientId:'two',instanceId:'tab2'});
  await until(()=>competitor.messages.some(m=>m.t==='host-busy'));
  const second=await peer('phone');second.send({...join,instanceId:'other-tab'});
  await until(()=>p.messages.some(m=>m.t==='phone-replaced')&&second.messages.some(m=>m.t==='phone-paired'));
  const replacement=second.messages.find(m=>m.t==='phone-paired').peerId;assert.notEqual(replacement,first);
  const game=await peer('console');game.send({t:'host-register',hostId:'game'});
  await until(()=>second.messages.some(m=>m.t==='peer-host'&&m.hostId==='game'));
  const signal={t:'rtc-signal',hostId:'game',clientId:'one',peerId:replacement,negotiationId:'n',kind:'offer',description:{type:'offer',sdp:'v=0\r\n'}};
  hub.send(signal);game.send({...signal,peerId:first});await delay(30);assert.ok(!second.messages.some(m=>m.t==='rtc-signal'));
  game.send(signal);await until(()=>second.messages.some(m=>m.t==='rtc-signal'));
  p.send({...signal,kind:'answer',description:{type:'answer',sdp:'v=0\r\n'}});await delay(30);assert.ok(!game.messages.some(m=>m.t==='rtc-signal'));
  second.send({t:'phone-release',clientId:'one'});await until(()=>game.messages.some(m=>m.t==='peer-phone'&&m.clientId===null));
  competitor.send({...join,clientId:'two',instanceId:'tab2'});await until(()=>competitor.messages.some(m=>m.t==='phone-paired'));
  game.ws.close();await until(()=>hub.messages.filter(m=>m.t==='host-active').at(-1)?.active);
  assert.equal((await fetch(base+'/pair?code='+encodeURIComponent('１２３４５６'))).status,400);
 }finally{for(const ws of sockets)ws.close();child.kill();}
});
