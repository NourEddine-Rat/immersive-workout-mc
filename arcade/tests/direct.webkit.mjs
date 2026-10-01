import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium,webkit} from 'playwright';

test('WebKit phone sends direct motion to Chrome across PC navigation and reconnect',{timeout:120000},async()=>{
  const server=spawn('python3',['-u','-c',"import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
  const port=await new Promise(resolve=>server.stdout.once('data',data=>resolve(Number(data.toString().trim()))));
  const base=`http://localhost:${port}`;
  const desktop=await chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
  const mobile=await webkit.launch({headless:true});
  try{
    const pc=await desktop.newPage(),phone=await mobile.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors=[];
    for(const page of [pc,phone]){
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{
        window.testPeers=[];
        const Original=RTCPeerConnection;
        window.RTCPeerConnection=class extends Original{constructor(config){super(config);testPeers.push(this);}};
      });
    }
    // Permission is synthetic; an actual iPhone still needs the native permission check.
    await phone.addInitScript(()=>{DeviceMotionEvent.requestPermission=async()=> 'granted';});
    await pc.goto(base,{waitUntil:'domcontentloaded'});
    await pc.waitForFunction(()=>/^\d{6}$/.test(document.querySelector('.pair-code')?.textContent));
    const code=await pc.locator('.pair-code').textContent();
    await phone.goto(`${base}/phone.html?connect=${code}`,{waitUntil:'domcontentloaded'});
    await phone.waitForFunction(()=>window.PhoneConnection?.status.direct,{},{timeout:40000});
    const route=await phone.evaluate(()=>PhoneConnection.status.route);
    assert.equal(route.allowed,true);assert.equal(route.protocol,'udp');
    await phone.locator('#motionEnable').click();
    await phone.evaluate(()=>{setInterval(()=>{
      // WebKit exposes native motion events but disallows constructing DeviceMotionEvent.
      const event=new Event('devicemotion');
      Object.defineProperties(event,{
        accelerationIncludingGravity:{value:{x:0,y:9.80665,z:0}},
        acceleration:{value:{x:0,y:0,z:0}},
        rotationRate:{value:{alpha:0,beta:0,gamma:0}},interval:{value:16}
      });
      dispatchEvent(event);
    },16);});
    await pc.waitForFunction(()=>window.phoneGate.ready);
    await phone.evaluate(()=>testPeers.at(-1).close());
    await pc.waitForFunction(()=>!window.phoneGate.ready);
    await pc.waitForFunction(()=>window.phoneGate.ready,{},{timeout:40000});
    await pc.goto(base+'/training/',{waitUntil:'domcontentloaded'});
    await pc.evaluate(async()=>{window.testBridge=(await import('/engine/host-bridge.js')).hostBridge;});
    await pc.waitForFunction(()=>testBridge.connection.ready,{},{timeout:40000});
    const state=await pc.evaluate(async()=>{const {hostBridge}=await import('/engine/host-bridge.js');return hostBridge.connection;});
    assert.equal(state.ready,true);assert.equal(state.route.allowed,true);
    assert.deepEqual(errors,[]);
  }finally{await mobile.close();await desktop.close();server.kill();}
});
