import {request} from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import WebSocket from 'ws';
function rawGet(url,headers){return new Promise((resolve,reject)=>{const req=request(url,{headers},res=>{let text='';res.setEncoding('utf8');res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>[].concat(res.headers[key.toLowerCase()]||[]).join(';')},json:async()=>JSON.parse(text)}));});req.on('error',reject);req.end();});}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await delay(10);}assert.fail('Relay message timeout');}
async function server(env={}){
 const child=spawn('python3',['-u','-c',"import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"],{cwd:new URL('../',import.meta.url),env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 let log='';child.stderr.on('data',d=>log+=d);
 const port=await new Promise((r,j)=>{child.stdout.once('data',d=>r(Number(d.toString().split('\n')[0])));child.once('error',j);});
 return {child,base:`http://localhost:${port}`,address:`ws://localhost:${port}/ws`,get log(){return log;}};
}
async function screen(s,cookie){const res=await fetch(s.base+'/where',{headers:cookie?{Cookie:cookie}:{}});return {...await res.json(),cookie:cookie||res.headers.get('set-cookie').split(';')[0]};}
async function peer(s,role,cookie){const ws=new WebSocket(s.address+'?role='+role,{headers:cookie?{Cookie:cookie}:{}}),messages=[];ws.onmessage=e=>messages.push(JSON.parse(e.data));await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});return {ws,messages,send:m=>ws.send(JSON.stringify(m))};}

test('independent beta sessions isolate signaling and reject all gameplay over WebSocket',async()=>{
 const s=await server(),peers=[];
 try{
  const a=await screen(s),b=await screen(s);
  assert.notEqual(a.pairCode,b.pairCode);assert.equal((await screen(s,a.cookie)).pairCode,a.pairCode);
  const ha=await peer(s,'console',a.cookie),hb=await peer(s,'console',b.cookie),pa=await peer(s,'phone'),pb=await peer(s,'phone');peers.push(ha,hb,pa,pb);
  ha.send({t:'host-register',hostId:'a'});hb.send({t:'host-register',hostId:'b'});
  pa.send({t:'phone-join',pairCode:a.pairCode,clientId:'alice',instanceId:'tab-a'});pb.send({t:'phone-join',pairCode:b.pairCode,clientId:'bob',instanceId:'tab-b'});
  await until(()=>ha.messages.some(m=>m.t==='peer-phone')&&hb.messages.some(m=>m.t==='peer-phone'));
  const peerId=ha.messages.find(m=>m.t==='peer-phone').peerId;
  const offer={t:'rtc-signal',hostId:'a',clientId:'alice',peerId,negotiationId:'offer-1',kind:'offer',description:{type:'offer',sdp:'v=0\r\n'}};
  ha.send(offer);await until(()=>pa.messages.some(m=>m.t==='rtc-signal'));
  assert.ok(!pb.messages.some(m=>m.t==='rtc-signal'));
  for(const t of ['samples','phone-profile','phone-presence','carousel-pick','host-action'])pa.send({t,clientId:'alice',hostId:'a',rows:[[1,2]],profile:{id:'alice'}});
  ha.send({t:'session-history',hostId:'a',userId:'alice',rows:[{id:'private'}]});ha.send({t:'host-state',hostId:'a',game:'subway'});
  await delay(50);
  assert.ok(!ha.messages.some(m=>['samples','phone-profile','phone-presence','carousel-pick','host-action'].includes(m.t)));
  assert.ok(!pa.messages.some(m=>['session-history','host-state'].includes(m.t)));
  assert.ok(!hb.messages.some(m=>m.clientId==='alice'));
  assert.doesNotMatch(s.log,/Traceback/);
 }finally{for(const p of peers)p.ws.close();s.child.kill();}
});

test('hosted URLs follow domain and HTTPS, private files stay private, assets support video ranges',async()=>{
 const s=await server({PORT:'1'});
 try{
  const headers={Host:'motion-beta.herokuapp.com','X-Forwarded-Proto':'https'};
  const res=await rawGet(s.base+'/where',headers),data=await res.json();
  assert.match(res.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Secure/);
  assert.equal(data.phoneUrl,`https://motion-beta.herokuapp.com/phone.html?connect=${data.pairCode}`);
  assert.equal(data.tv,'https://motion-beta.herokuapp.com/?desktop=1');assert.equal(data.hosted,true);
  const redirect=await rawGet(s.base+'/phone.html?connect=123456',{...headers,'X-Forwarded-Proto':'http'});
  assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'https://motion-beta.herokuapp.com/phone.html?connect=123456');
  for(const path of ['/serve.py','/.certs/cert.pem','/logs/game.log','/tests/hosting.test.mjs','/node_modules/ws/package.json','/phone/']){
    assert.equal((await fetch(s.base+path,{headers})).status,404,path);
  }
  assert.equal((await fetch(s.base+'/serve.py',{method:'HEAD',headers})).status,404);
  assert.equal((await fetch(s.base+'/',{headers})).status,200);
  const clip=await fetch(s.base+'/carousel/intro-reveal.mp4',{headers:{...headers,Range:'bytes=0-99'}});
  assert.equal(clip.status,206);assert.equal((await clip.arrayBuffer()).byteLength,100);
  assert.deepEqual(await(await fetch(s.base+'/health')).json(),{ok:true});
  const denied=await new Promise(resolve=>{const ws=new WebSocket(s.address+'?role=console');ws.on('unexpected-response',(_req,response)=>{resolve(response.statusCode);response.resume();ws.terminate();});ws.on('error',()=>{});});
  assert.equal(denied,409);
 }finally{s.child.kill();}
});

test('Heroku process binds PORT without LAN certificates and exits cleanly on SIGTERM',{timeout:10000},async()=>{
 const child=spawn('python3',['-u','-c',"import socket,os; s=socket.socket(); s.bind(('127.0.0.1',0)); p=s.getsockname()[1]; s.close(); os.environ['PORT']=str(p); print(p,flush=True); import serve; serve.main()"],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 try{
  await until(()=>output.includes('listening'));
  const port=Number(output.split('\n')[0]);
  assert.equal((await fetch(`http://localhost:${port}/health`)).status,200);
  const exit=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));
  child.kill('SIGTERM');assert.deepEqual(await exit,{code:0,signal:null});
  assert.doesNotMatch(output,/certificate|Traceback/);
 }finally{child.kill();}
});
