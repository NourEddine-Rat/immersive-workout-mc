import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {returningPhone} from './phone-fixtures.mjs';

async function server(){
  const child=spawn('python3',['-u','-c',"import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','ignore']});
  const port=await new Promise(resolve=>child.stdout.once('data',data=>resolve(Number(data.toString().trim()))));
  child.stdout.resume();
  return {base:`http://localhost:${port}`,close:()=>new Promise(resolve=>{child.once('exit',resolve);child.kill();})};
}
async function blockDiscovery(page){
  await page.addInitScript(()=>{
    window.testPeers=[];window.testMediaRequests=[];window.testMediaTracks=[];window.testSignals=[];window.testBlockMDNS=true;
    const Original=RTCPeerConnection;
    window.RTCPeerConnection=class extends Original{
      constructor(config){super(config);testPeers.push(this);}
      setRemoteDescription(description){return super.setRemoteDescription({...description,sdp:description.sdp.split(/\r?\n/).filter(line=>!testBlockMDNS||!line.startsWith('a=candidate:')||!line.includes('.local')).join('\r\n')});}
      addIceCandidate(candidate){return testBlockMDNS&&candidate?.candidate?.includes('.local')?Promise.resolve():super.addIceCandidate(candidate);}
    };
    const getUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=function(constraints){
      testMediaRequests.push(constraints);
      return getUserMedia(constraints).then(stream=>{testMediaTracks.push(...stream.getTracks());return stream;});
    };
    const send=WebSocket.prototype.send;
    WebSocket.prototype.send=function(data){try{testSignals.push(JSON.parse(data));}catch{}return send.call(this,data);};
  });
}
async function pair(pc,phone,base){
  await returningPhone(phone);
  await blockDiscovery(pc);await blockDiscovery(phone);
  await pc.goto(base,{waitUntil:'domcontentloaded'});
  await pc.waitForSelector('.pair-qr svg');
  await phone.goto(base+'/phone.html?connect='+await pc.locator('.pair-code').textContent(),{waitUntil:'domcontentloaded'});
  await pc.waitForFunction(()=>testPeers.at(-1)?.remoteDescription);
  await pc.waitForFunction(()=>document.querySelector('.pair-local-help').open,{},{timeout:25000});
  assert.equal(await phone.evaluate(()=>PhoneConnection.status.direct),false);
  assert.equal(await pc.evaluate(()=>testMediaRequests.length),0,'failed pairing must not request microphone automatically');
  assert.equal(await phone.evaluate(()=>testMediaRequests.length),0);
}

test('explicit PC microphone recovery connects WebKit with mDNS unavailable, no IP input, no media traffic and no repeat capture across navigation',{timeout:100000},async()=>{
  const s=await server(),desktop=await chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--use-fake-device-for-media-stream','--enable-unsafe-swiftshader']}),mobile=await webkit.launch({headless:true});
  try{
    const context=await desktop.newContext({viewport:{width:1050,height:900},reducedMotion:'reduce'}),pc=await context.newPage(),phone=await mobile.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors=[];pc.on('pageerror',error=>errors.push(error.message));phone.on('pageerror',error=>errors.push(error.message));
    await pair(pc,phone,s.base);
    assert.equal(await pc.locator('#pair-local-address').count(),0,'production pairing does not request an IP');
    await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
    await pc.locator('.pair-audio-allow').scrollIntoViewIfNeeded();
    await pc.screenshot({path:new URL('../test-results/microphone-fallback-desktop.png',import.meta.url).pathname});
    await pc.setViewportSize({width:390,height:844});
    await pc.locator('.pair-audio-allow').scrollIntoViewIfNeeded();
    assert.ok(await pc.locator('.pair-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await pc.screenshot({path:new URL('../test-results/microphone-fallback-narrow.png',import.meta.url).pathname});
    await pc.setViewportSize({width:1050,height:900});
    // The isolated browser uses a simulated microphone; no real device access.
    await context.grantPermissions(['microphone'],{origin:s.base});
    await pc.locator('.pair-audio-allow').click();
    await phone.waitForFunction(()=>PhoneConnection.status.direct,{},{timeout:25000});
    await pc.waitForFunction(()=>phoneGate.ready);
    assert.deepEqual(await pc.evaluate(()=>testMediaRequests),[{audio:true,video:false}]);
    assert.ok(await pc.evaluate(()=>testMediaTracks.length>0&&testMediaTracks.every(track=>track.readyState==='ended')));
    assert.equal(await phone.evaluate(()=>testMediaRequests.length),0);
    for(const page of [pc,phone]){
      const result=await page.evaluate(()=>{const peer=testPeers.at(-1);return {iceServers:peer.getConfiguration().iceServers,senders:peer.getSenders().length,sdp:peer.localDescription.sdp};});
      assert.deepEqual(result.iceServers,[]);assert.equal(result.senders,0);assert.doesNotMatch(result.sdp,/m=(audio|video) /);
      assert.equal(await page.evaluate(()=>testSignals.some(m=>'rows' in m||'profile' in m||'audio' in m)),false);
    }
    const route=await phone.evaluate(()=>PhoneConnection.status.route);
    assert.equal(route.allowed,true);assert.equal(route.protocol,'udp');
    assert.equal(await pc.evaluate(async()=>(await import('/engine/host-bridge.js')).hostBridge.localAddress),'');
    assert.ok(await pc.evaluate(()=>ConnectionDiagnostics.events.some(e=>e.event==='microphone-granted')));
    for(const path of ['/training/','/games/squid/red-light/','/']){
      await pc.goto(s.base+path,{waitUntil:'domcontentloaded'});
      await pc.evaluate(async()=>{window.testBridge=(await import('/engine/host-bridge.js')).hostBridge;});
      await pc.waitForFunction(()=>testBridge.connection.direct,{},{timeout:25000});
      assert.equal(await pc.evaluate(()=>testBridge.localAddress),'');
      assert.equal(await pc.evaluate(()=>testMediaRequests.length),0,'navigation must not recapture the microphone');
    }
    assert.deepEqual(errors,[]);
  }finally{await mobile.close();await desktop.close();await s.close();}
});

test('late microphone permission cannot restart a connection that recovered while the prompt was pending',{timeout:60000},async()=>{
  const s=await server(),browser=await chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
  try{
    const pc=await browser.newPage({reducedMotion:'reduce'}),phone=await browser.newPage({viewport:{width:390,height:844}});
    await pair(pc,phone,s.base);
    await pc.evaluate(()=>{
      navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{
        window.testLateTrack={readyState:'live',stop(){this.readyState='ended';}};
        window.finishMicrophone=()=>resolve({getTracks:()=>[testLateTrack]});
      });
    });
    await pc.locator('.pair-audio-allow').click();
    await pc.waitForFunction(()=>typeof finishMicrophone==='function');
    await pc.evaluate(()=>{testBlockMDNS=false;});await phone.evaluate(()=>{testBlockMDNS=false;});
    await pc.evaluate(async()=>(await import('/engine/host-bridge.js')).hostBridge.retryLocal());
    await pc.waitForFunction(()=>phoneGate.ready);
    const attempts=await pc.evaluate(()=>testPeers.length);
    await pc.evaluate(()=>finishMicrophone());
    await pc.waitForFunction(()=>testLateTrack.readyState==='ended');
    assert.equal(await pc.evaluate(()=>testPeers.length),attempts);
    assert.equal(await pc.evaluate(()=>phoneGate.ready),true);
    assert.ok(await pc.evaluate(()=>ConnectionDiagnostics.events.some(e=>e.event==='microphone-cancelled')));
  }finally{await browser.close();await s.close();}
});

test('denied microphone recovery stays local, explains the permission and never reports a connection',{timeout:60000},async()=>{
  const s=await server(),browser=await chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
  try{
    const pc=await browser.newPage({reducedMotion:'reduce'}),phone=await browser.newPage({viewport:{width:390,height:844}});
    await pair(pc,phone,s.base);
    await pc.evaluate(()=>{navigator.mediaDevices.getUserMedia=async constraints=>{testMediaRequests.push(constraints);throw new DOMException('Denied','NotAllowedError');};});
    await pc.locator('.pair-audio-allow').click();
    await pc.waitForFunction(()=>document.getElementById('pair-audio-status').textContent.includes('was not allowed'));
    assert.equal(await pc.locator('.pair-audio-allow').isEnabled(),true);
    assert.equal(await phone.evaluate(()=>PhoneConnection.status.direct),false);
    assert.equal(await pc.evaluate(()=>phoneGate.ready),false);
    assert.deepEqual(await pc.evaluate(()=>testMediaRequests),[{audio:true,video:false}]);
    assert.equal(await pc.evaluate(()=>testSignals.some(m=>'rows' in m||'profile' in m)),false);
    assert.ok(await pc.evaluate(()=>ConnectionDiagnostics.events.some(e=>e.event==='microphone-failed'&&e.data.reason==='denied')));
  }finally{await browser.close();await s.close();}
});
