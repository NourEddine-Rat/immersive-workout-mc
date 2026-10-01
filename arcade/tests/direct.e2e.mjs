import {returningPhone} from './phone-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {networkInterfaces} from 'node:os';
import {chromium,webkit} from 'playwright';
import {lanIPv4} from '../engine/lib/local-route.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function server(){
 const child=spawn('python3',['-u','-c',"import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
 const port=await new Promise(r=>child.stdout.once('data',d=>r(Number(d.toString().trim()))));let ended=false;
 return {base:`http://localhost:${port}`,close:()=>ended?Promise.resolve():new Promise(r=>{ended=true;child.once('exit',r);child.kill();})};
}
const launch=()=>chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
async function instrument(page){
 await page.addInitScript(()=>{
  window.sentToServer=[];window.testPCs=[];window.testChannels=[];
  const send=WebSocket.prototype.send;WebSocket.prototype.send=function(data){try{sentToServer.push(JSON.parse(data));}catch{}return send.call(this,data);};
  const Original=RTCPeerConnection;
  window.RTCPeerConnection=class extends Original{constructor(config){super(config);testPCs.push(this);this.addEventListener('datachannel',e=>testChannels.push(e.channel));}createDataChannel(...args){const channel=super.createDataChannel(...args);testChannels.push(channel);return channel;}};
 });
}
async function startMotion(phone){
 await phone.locator('#motionEnable').click();
 await phone.evaluate(()=>{window.testMotion=setInterval(()=>dispatchEvent(new DeviceMotionEvent('devicemotion',{accelerationIncludingGravity:{x:0,y:9.80665,z:0},acceleration:{x:0,y:0,z:0},rotationRate:{alpha:0,beta:0,gamma:0},interval:16})),16);});
}
async function pair(s,browser,phoneSetup){
 const pc=await browser.newPage({viewport:{width:1000,height:700}}),phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await instrument(pc);await instrument(phone);await returningPhone(phone);
 await phone.addInitScript(()=>{
  window.carouselStartedConnected=null;
  const src=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src');
  Object.defineProperty(HTMLIFrameElement.prototype,'src',{...src,set(value){
   if(new URL(value,location.href).searchParams.get('controller')==='1')window.carouselStartedConnected=window.PhoneConnection?.status.direct===true;
   src.set.call(this,value);
  }});
 });
 const carouselRequest=phone.waitForRequest(request=>new URL(request.url()).searchParams.get('controller')==='1');
 if(phoneSetup)await phone.addInitScript(phoneSetup);
 await pc.goto(s.base,{waitUntil:'domcontentloaded'});await pc.waitForFunction(()=>/^\d{6}$/.test(document.querySelector('.pair-code')?.textContent));
 const code=await pc.locator('.pair-code').textContent();
 await phone.goto(s.base+'/phone.html?connect='+code,{waitUntil:'domcontentloaded'});
 await phone.waitForFunction(()=>window.PhoneConnection?.status.direct,{},{timeout:20000});
 await carouselRequest;
 assert.equal(await phone.evaluate(()=>carouselStartedConnected),true,'the 3D carousel must load after direct pairing');
 return {pc,phone};
}
test('motion uses direct unreliable UDP, recovers a dropped channel, and survives signaling-server shutdown',{timeout:90000},async()=>{
 const s=await server(),browser=await launch();
 try{
  const {pc,phone}=await pair(s,browser),posts=[];
  for(const page of [pc,phone])page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  await pc.evaluate(async()=>{const {hostBridge}=await import('/engine/host-bridge.js');window.receivedMotion=[];hostBridge.onMessage(m=>{if(m.t==='samples')receivedMotion.push({rows:m.rows.length,age:Date.now()-m.rows[0][0]});});});
  await startMotion(phone);await pc.waitForFunction(()=>window.phoneGate.ready);
  await pc.waitForFunction(()=>receivedMotion.length>50);
  const route=await phone.evaluate(()=>PhoneConnection.status.route);
  assert.equal(route.allowed,true);assert.equal(route.protocol,'udp');assert.equal(route.localType,'host');assert.equal(route.remoteType,'host');
  for(const page of [pc,phone]){
    const config=await page.evaluate(()=>testPCs.at(-1).getConfiguration());assert.deepEqual(config.iceServers,[]);
    const motion=await page.evaluate(()=>{const c=testChannels.filter(c=>c.label==='motion').at(-1);return {ordered:c.ordered,retries:c.maxRetransmits};});assert.deepEqual(motion,{ordered:false,retries:0});
  }
  const readings=await pc.evaluate(()=>receivedMotion);
  assert.ok(readings.every(r=>r.rows===1));
  const ages=readings.map(r=>r.age).sort((a,b)=>a-b);console.log('Same-machine direct motion latency (ms):',JSON.stringify({median:ages[Math.floor(ages.length*.5)],p95:ages[Math.floor(ages.length*.95)]}));
  await pc.evaluate(()=>testPCs.at(-1).close());
  await pc.waitForFunction(()=>!window.phoneGate.ready);
  await pc.waitForFunction(()=>window.phoneGate.ready,{},{timeout:20000});
  const count=await pc.evaluate(()=>receivedMotion.length);
  await s.close();await sleep(5000);
  assert.equal(await phone.evaluate(()=>window.PhoneConnection?.status.direct),true);
  assert.equal(await pc.evaluate(()=>phoneGate.ready),true);
  assert.ok(await pc.evaluate(()=>receivedMotion.length)>count+80,'fresh motion must continue with the server stopped');
  const allowed=new Set(['host-register','phone-join','heartbeat','rtc-signal','phone-release']);
  for(const page of [pc,phone]){
    const messages=await page.evaluate(()=>sentToServer);
    assert.ok(messages.length>0);
    assert.deepEqual([...new Set(messages.map(m=>m.t))].filter(t=>!allowed.has(t)),[]);
    assert.ok(messages.every(m=>!('rows' in m)&&!('profile' in m)&&!('actions' in m)));
  }
  assert.deepEqual(posts,[]);
 }finally{await browser.close();await s.close();}
});

test('mobile state lag cannot stall pairing and the phone can restart an apparently healthy PC link',{timeout:60000},async()=>{
 const s=await server(),browser=await launch();
 try{
  const {pc,phone}=await pair(s,browser,()=>{
    const Original=RTCPeerConnection;
    window.RTCPeerConnection=class extends Original{
      get connectionState(){const state=super.connectionState;return state==='connected'?'connecting':state;}
    };
  });
  await phone.waitForFunction(()=>document.getElementById('controlStatus')?.textContent==='CONNECTED');
  assert.equal(await phone.evaluate(()=>testPCs.at(-1).connectionState),'connecting');
  await startMotion(phone);await pc.waitForFunction(()=>phoneGate.ready);
  const peers=await pc.evaluate(()=>testPCs.length);
  await phone.evaluate(()=>PhoneConnection.retry());
  await pc.waitForFunction(count=>testPCs.length>count,peers);
  await phone.waitForFunction(()=>PhoneConnection.status.direct);
  await pc.waitForFunction(()=>phoneGate.ready);
  assert.equal(await phone.evaluate(()=>PhoneConnection.status.route.allowed),true);
  assert.equal(await phone.evaluate(()=>sentToServer.some(m=>m.t==='samples')),false);
 }finally{await browser.close();await s.close();}
});

test('unverifiable/relay candidate stats block motion with no WebSocket fallback',{timeout:60000},async()=>{
 const s=await server(),browser=await launch();
 try{
  const pc=await browser.newPage(),phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await returningPhone(phone);
  for(const page of [pc,phone]){
    await instrument(page);
    await page.addInitScript(()=>{
      window.motionPackets=0;
      const original=RTCDataChannel.prototype.send;RTCDataChannel.prototype.send=function(data){if(this.label==='motion')motionPackets++;return original.call(this,data);};
      const stats=RTCPeerConnection.prototype.getStats;
      RTCPeerConnection.prototype.getStats=async function(...args){const original=await stats.apply(this,args),report=new Map();original.forEach((v,k)=>report.set(k,v.type==='local-candidate'?{...v,candidateType:'relay'}:v));return report;};
    });
  }
  await pc.goto(s.base,{waitUntil:'domcontentloaded'});await pc.waitForSelector('.pair-qr svg');const code=await pc.locator('.pair-code').textContent();
  await phone.goto(s.base+'/phone.html?connect='+code,{waitUntil:'domcontentloaded'});
  await phone.waitForFunction(()=>window.PhoneConnection?.status.status==='blocked',{},{timeout:20000});
  await phone.evaluate(()=>PhoneMotion.enable());await sleep(2000);
  assert.equal(await phone.evaluate(()=>window.PhoneConnection?.status.direct),false);
  assert.equal(await phone.evaluate(()=>motionPackets),0);
  assert.equal(await pc.evaluate(()=>phoneGate.ready),false);
  assert.equal(await pc.locator('.pair-dialog').evaluate(el=>el.open),true);
  assert.match(await pc.locator('.pair-state').innerText(),/local|Wi-Fi/i);
  assert.equal(await phone.evaluate(()=>sentToServer.some(m=>m.t==='samples')),false);
 }finally{await browser.close();await s.close();}
});

test('a private PC address recovers blocked mDNS discovery in WebKit and survives game navigation',{timeout:90000},async()=>{
 const address=Object.values(networkInterfaces()).flat().find(n=>n.family==='IPv4'&&!n.internal&&lanIPv4(n.address))?.address;
 assert.ok(address,'a local network interface is needed for the direct UDP test');
 const s=await server(),desktop=await launch(),mobile=await webkit.launch({headless:true});
 try{
  const pc=await desktop.newPage(),phone=await mobile.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await returningPhone(phone);
  for(const page of [pc,phone]){
   await instrument(page);
   await page.addInitScript(()=>{
    // Model a network/browser where .local names never resolve. Numeric private
    // candidates still use real browser ICE and real UDP sockets.
    const Original=RTCPeerConnection;
    window.RTCPeerConnection=class extends Original{
     setRemoteDescription(description){return super.setRemoteDescription({...description,sdp:description.sdp.split(/\r?\n/).filter(line=>!line.startsWith('a=candidate:')||!line.includes('.local')).join('\r\n')});}
     addIceCandidate(candidate){return candidate?.candidate?.includes('.local')?Promise.resolve():super.addIceCandidate(candidate);}
    };
   });
   if(page===phone)await page.addInitScript(()=>{
    const stats=RTCPeerConnection.prototype.getStats;
    RTCPeerConnection.prototype.getStats=async function(...args){
     const report=await stats.apply(this,args);
     return new Map([...report].map(([id,c])=>[id,c.type==='local-candidate'?{...c,address:'',foundation:'',port:undefined}:c]));
    };
   });
  }
  await pc.goto(s.base,{waitUntil:'domcontentloaded'});await pc.waitForSelector('.pair-qr svg');
  await phone.goto(s.base+'/phone.html?connect='+await pc.locator('.pair-code').textContent(),{waitUntil:'domcontentloaded'});
  await pc.waitForFunction(()=>testPCs.at(-1)?.remoteDescription);await sleep(1000);
  assert.equal(await phone.evaluate(()=>PhoneConnection.status.direct),false);
  await pc.locator('.pair-local-help summary').click();await pc.locator('#pair-local-address').fill('8.8.8.8');
  await pc.locator('.pair-local-form button[type=submit]').click();
  assert.match(await pc.locator('#pair-local-feedback').textContent(),/private Wi-Fi IPv4/);
  await pc.locator('#pair-local-address').fill(address);await pc.locator('.pair-local-form button[type=submit]').click();
  try{await phone.waitForFunction(()=>PhoneConnection.status.direct,{},{timeout:20000});}
  catch(error){
   for(const page of [pc,phone])console.error(page===pc?'PC route:':'Phone route:',await page.evaluate(async()=>{
    const pc=testPCs.at(-1),pair=pc.sctp?.transport?.iceTransport?.getSelectedCandidatePair?.();
    const describe=c=>c&&Object.fromEntries(['type','protocol','address','port','foundation'].map(k=>[k,c[k]]));
    return {ice:pc.iceConnectionState,selected:{local:describe(pair?.local),remote:describe(pair?.remote)},stats:[...(await pc.getStats()).values()].filter(s=>/candidate|transport/.test(s.type))};
   }));
   throw error;
  }
  assert.equal(await phone.evaluate(()=>PhoneConnection.status.route.allowed),true);
  await pc.goto(s.base+'/training/',{waitUntil:'domcontentloaded'});
  await pc.evaluate(async()=>{window.addressTestBridge=(await import('/engine/host-bridge.js')).hostBridge;});
  await pc.waitForFunction(()=>addressTestBridge.connection.direct&&['connected','completed'].includes(testPCs.at(-1)?.iceConnectionState),{},{timeout:20000});
  assert.equal(await pc.evaluate(()=>addressTestBridge.localAddress),address);
  assert.deepEqual(await pc.evaluate(()=>testPCs.at(-1).getConfiguration().iceServers),[]);
 }finally{await mobile.close();await desktop.close();await s.close();}
});
