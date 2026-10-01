import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium,webkit} from 'playwright';
import {returningPhone} from './phone-fixtures.mjs';

test('automatic ICE restart preserves Chrome and WebKit channels after a transient disconnection',{timeout:90000},async()=>{
const server=spawn('python3',['-u','-c',"import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
const port=await new Promise(resolve=>server.stdout.once('data',data=>resolve(Number(data.toString().trim()))));
const base=`http://localhost:${port}`;
let desktop,mobile;
try{
 desktop=await chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
 mobile=await webkit.launch({headless:true});
 const pc=await desktop.newPage(),phone=await mobile.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[];
 await returningPhone(phone);
 await phone.addInitScript(()=>{DeviceMotionEvent.requestPermission=async()=> 'granted';});
 for(const page of [pc,phone]){
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   window.testPeers=[];window.sentSignals=[];
   const send=WebSocket.prototype.send;
   WebSocket.prototype.send=function(data){try{const message=JSON.parse(data);if(message.t==='rtc-signal')sentSignals.push(message);}catch{}return send.call(this,data);};
   const Native=RTCPeerConnection;
   window.RTCPeerConnection=class extends Native{
    constructor(config){super(config);testPeers.push(this);this.restartCalls=0;this.forceDisconnected=false;this.channelCount=0;this.addEventListener('datachannel',()=>this.channelCount++);}
    get connectionState(){return this.forceDisconnected?'disconnected':super.connectionState;}
    get iceConnectionState(){return this.forceDisconnected?'disconnected':super.iceConnectionState;}
    createDataChannel(...args){this.channelCount++;return super.createDataChannel(...args);}
    createOffer(options){if(options?.iceRestart){this.restartCalls++;this.forceDisconnected=false;}return super.createOffer(options);}
   };
  });
 }
 await pc.goto(base,{waitUntil:'domcontentloaded'});
 await pc.waitForFunction(()=>/^\d{6}$/.test(document.querySelector('.pair-code')?.textContent));
 await phone.goto(base+'/phone.html?connect='+await pc.locator('.pair-code').textContent(),{waitUntil:'domcontentloaded'});
 await phone.waitForFunction(()=>window.PhoneConnection?.status.direct,{},{timeout:30000});
 await pc.evaluate(async()=>{window.testBridge=(await import('/engine/host-bridge.js')).hostBridge;});
 await pc.waitForFunction(()=>testBridge.connection.direct);
 await phone.locator('#motionEnable').click();
 await phone.evaluate(()=>{window.recoveryMotion=setInterval(()=>{
  const event=new Event('devicemotion');
  Object.defineProperties(event,{
   accelerationIncludingGravity:{value:{x:0,y:9.80665,z:0}},acceleration:{value:{x:0,y:0,z:0}},
   rotationRate:{value:{alpha:0,beta:0,gamma:0}},interval:{value:16}
  });dispatchEvent(event);
 },16);});
 await pc.waitForFunction(()=>phoneGate.ready);
 const before={host:await pc.evaluate(()=>testPeers.length),phone:await phone.evaluate(()=>testPeers.length),channels:await pc.evaluate(()=>testPeers.at(-1).channelCount),phoneChannels:await phone.evaluate(()=>testPeers.at(-1).channelCount)};
 await pc.evaluate(()=>{const connection=testPeers.at(-1);connection.forceDisconnected=true;connection.dispatchEvent(new Event('connectionstatechange'));});
 await pc.waitForFunction(()=>!testBridge.connection.direct);
 assert.equal(await pc.evaluate(()=>testPeers.at(-1).restartCalls),0,'transient disconnects get time to recover before renegotiation');
 await pc.waitForFunction(()=>testPeers.at(-1).restartCalls===1,{},{timeout:15000});
 await pc.waitForFunction(()=>testBridge.connection.direct,{},{timeout:20000});
 await phone.waitForFunction(()=>window.PhoneConnection?.status.direct,{},{timeout:20000});
 await pc.waitForFunction(()=>phoneGate.ready);
 assert.equal(await pc.evaluate(()=>testPeers.length),before.host);
 assert.equal(await phone.evaluate(()=>testPeers.length),before.phone);
 assert.equal(await pc.evaluate(()=>testPeers.at(-1).channelCount),before.channels);
 assert.equal(await phone.evaluate(()=>testPeers.at(-1).channelCount),before.phoneChannels);
 assert.equal(await phone.evaluate(()=>PhoneConnection.status.route.allowed),true);
 for(const page of [pc,phone])assert.deepEqual(await page.evaluate(()=>testPeers.at(-1).getConfiguration().iceServers),[]);
 const offers=await pc.evaluate(()=>sentSignals.filter(m=>m.kind==='offer'));
 assert.ok(offers.some(m=>m.restartOf));
 assert.equal(offers.at(-1).restartOf,offers.at(-2).negotiationId);
 assert.deepEqual(errors,[]);
}finally{await mobile?.close();await desktop?.close();server.kill();}
});
