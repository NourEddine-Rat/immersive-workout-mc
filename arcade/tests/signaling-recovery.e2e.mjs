import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {returningPhone} from './phone-fixtures.mjs';

async function server(port=0){
  const child=spawn('python3',['-u','-c',`import serve; s=serve.Dual(('127.0.0.1',${port}),serve.Handler); print(s.server_port,flush=True); s.serve_forever()`],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',data=>errors+=data);
  const listening=await new Promise((resolve,reject)=>{child.stdout.once('data',data=>resolve(Number(data.toString().split('\n')[0])));child.once('error',reject);child.once('exit',code=>reject(Error(`Test server stopped: ${code} ${errors}`)));});
  child.stdout.resume();let stopped=false;
  return {port:listening,base:`http://localhost:${listening}`,stop:()=>stopped?Promise.resolve():new Promise(resolve=>{stopped=true;child.once('exit',resolve);child.kill();})};
}
async function instrument(page){
  await page.addInitScript(()=>{
    window.testSockets=[];window.testPeers=[];window.testChannels=[];window.testSent=[];window.testReceived=[];
    const Socket=WebSocket;
    window.WebSocket=class extends Socket{
      constructor(...args){super(...args);testSockets.push(this);this.addEventListener('message',event=>{try{testReceived.push(JSON.parse(event.data));}catch{}});}
      send(data){try{testSent.push(JSON.parse(data));}catch{}return super.send(data);}
    };
    const Peer=RTCPeerConnection;
    window.RTCPeerConnection=class extends Peer{
      constructor(...args){super(...args);testPeers.push(this);this.addEventListener('datachannel',event=>testChannels.push(event.channel));}
      createDataChannel(...args){const channel=super.createDataChannel(...args);testChannels.push(channel);return channel;}
    };
  });
}
async function pair(browser,base){
  const pc=await browser.newPage(),phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];for(const page of [pc,phone]){await instrument(page);page.on('pageerror',error=>errors.push(error.message));}
  await returningPhone(phone);
  await pc.goto(base,{waitUntil:'domcontentloaded'});
  const code=await pc.evaluate(async()=>(await(await fetch('/where')).json()).pairCode);
  await phone.goto(`${base}/phone.html?connect=${code}`,{waitUntil:'domcontentloaded'});
  await phone.waitForFunction(()=>window.PhoneConnection?.status.direct,{},{timeout:40000});
  await pc.evaluate(async()=>{window.testBridge=(await import('/engine/host-bridge.js')).hostBridge;window.motionCount=0;testBridge.onMessage(message=>{if(message.t==='samples')motionCount++;});});
  await phone.evaluate(async()=>{await PhoneMotion.enable();window.testMotion=setInterval(()=>dispatchEvent(new DeviceMotionEvent('devicemotion',{accelerationIncludingGravity:{x:0,y:9.80665,z:0},acceleration:{x:0,y:0,z:0},rotationRate:{alpha:0,beta:0,gamma:0},interval:16})),16);});
  await pc.waitForFunction(()=>motionCount>20&&testBridge.connection.ready);
  return {pc,phone,code,errors};
}

test('verified local motion survives a real signaling restart and expired server room',{timeout:90000},async()=>{
  let service=await server();const browser=await chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
  try{
    const {pc,phone,code,errors}=await pair(browser,service.base);
    const before=await pc.evaluate(()=>({motion:motionCount,peers:testPeers.length}));
    const phonePeers=await phone.evaluate(()=>testPeers.length);
    const port=service.port;await service.stop();service=await server(port);
    await phone.waitForFunction(()=>testReceived.some(message=>message.t==='pair-expired'),{},{timeout:20000});
    await pc.waitForFunction(()=>testSockets.length>1&&testSockets.at(-1).readyState===1&&motionCount>100,{},{timeout:20000});
    const after=await pc.evaluate(()=>({motion:motionCount,peers:testPeers.length,ready:testBridge.connection.ready}));
    assert.equal(after.peers,before.peers,'server room loss must not replace the local peer');
    assert.equal(after.ready,true);assert.ok(after.motion>before.motion);
    assert.deepEqual(await phone.evaluate(()=>({direct:PhoneConnection.status.direct,peers:testPeers.length,code:PhoneApp.read('inmotion.pair.v1',null)?.code,running:PhoneMotion.running})),{direct:true,peers:phonePeers,code,running:true});
    // A Retry click cannot destroy a working connection whose code has expired.
    await phone.evaluate(()=>PhoneConnection.retry());
    assert.equal(await phone.evaluate(()=>PhoneConnection.status.direct),true);
    for(const page of [pc,phone])assert.deepEqual(await page.evaluate(()=>testPeers.at(-1).getConfiguration().iceServers),[]);
    // A hard local failure now requires the fresh PC code. It must not loop
    // forever against the server's empty room or leave the sensors running.
    await phone.evaluate(()=>testChannels.find(channel=>channel.label==='control'&&channel.readyState==='open').close());
    await phone.waitForFunction(()=>PhoneApp.read('inmotion.pair.v1',null)===null&&!PhoneMotion.running,{},{timeout:10000});
    assert.equal(await phone.evaluate(()=>PhoneConnection.status.direct),false);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await service.stop();}
});

test('authenticated phone retry sends one restart without an extra pairing join',{timeout:60000},async()=>{
  const service=await server(),browser=await chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
  try{
    const {pc,phone,errors}=await pair(browser,service.base);
    const before=await phone.evaluate(()=>({joins:testSent.filter(message=>message.t==='phone-join').length,restarts:testSent.filter(message=>message.kind==='restart').length,attempt:PhoneConnection.status.attempt}));
    const offers=await pc.evaluate(()=>testSent.filter(message=>message.kind==='offer').length);
    await phone.evaluate(()=>{PhoneConnection.retry();PhoneConnection.retry();});
    await phone.waitForFunction(attempt=>PhoneConnection.status.direct&&PhoneConnection.status.attempt>attempt,before.attempt,{timeout:20000});
    const after=await phone.evaluate(()=>({joins:testSent.filter(message=>message.t==='phone-join').length,restarts:testSent.filter(message=>message.kind==='restart').length}));
    assert.equal(after.joins,before.joins);assert.equal(after.restarts,before.restarts+1);
    assert.equal(await pc.evaluate(()=>testSent.filter(message=>message.kind==='offer').length),offers+1);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await service.stop();}
});
