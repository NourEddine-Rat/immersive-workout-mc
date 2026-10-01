import {returningPhone} from './phone-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';

// These tests use real pages, direct WebRTC, and synthetic browser motion events.
// Physical Safari/Android sensor and wake-lock behavior still needs a device check.
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function server(listenPort=0){
  const process=spawn('python3',['-u','-c',`import serve; s=serve.Dual(('127.0.0.1',${listenPort}),serve.Handler); print(s.server_port,flush=True); s.serve_forever()`],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
  let log='';process.stderr.on('data',d=>{log+=d;});
  const port=await new Promise((resolve,reject)=>{process.stdout.once('data',d=>resolve(Number(d.toString().split('\n')[0])));process.once('error',reject);});
  return {base:`http://localhost:${port}`,port,close:()=>new Promise(resolve=>{process.once('exit',resolve);process.kill();}),get log(){return log;}};
}
async function motions(page){
  await page.evaluate(()=>{
    clearInterval(window.testMotion);
    window.testMotion=setInterval(()=>window.dispatchEvent(new DeviceMotionEvent('devicemotion',{
      accelerationIncludingGravity:{x:0,y:9.80665,z:0},acceleration:{x:0,y:0,z:0},rotationRate:{alpha:0,beta:0,gamma:0},interval:16
    })),16);
  });
}
const launch=()=>chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--enable-unsafe-swiftshader']});

async function phonePage(browser){const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await returningPhone(page);return page;}

test('PC QR, phone pairing, all game pages, remote actions, motion pause/resume, history and reload',{timeout:240000},async()=>{
  const s=await server(),browser=await launch(),errors=[];
  try{
    const pc=await browser.newPage({viewport:{width:1000,height:700}});
    const phone=await phonePage(browser);
    for(const [name,page] of [['pc',pc],['phone',phone]]){
      page.on('pageerror',e=>errors.push(name+': '+e.message));
      page.on('response',response=>{if(response.url().startsWith(s.base)&&response.status()>=400)errors.push(`${name}: ${response.status()} ${response.url()}`);});
      // Remote fonts are optional; don't make network availability part of a LAN test.
      await page.route('https://fonts.googleapis.com/**',route=>route.abort());
      await page.route('https://fonts.gstatic.com/**',route=>route.abort());
    }
    await pc.addInitScript(()=>{if(!localStorage.getItem('arcade.profile.v1'))localStorage.setItem('arcade.profile.v1',JSON.stringify({v:1,created:Date.now(),cfg:{},run:{}}));});
    await pc.addInitScript(()=>{
      window.audibleCalls=0;
      for(const name of ['AudioContext','webkitAudioContext'])if(window[name]){
        const Original=window[name];window[name]=new Proxy(Original,{construct(target,args){audibleCalls++;return Reflect.construct(target,args);}});
      }
      if(window.speechSynthesis){const speak=speechSynthesis.speak;speechSynthesis.speak=function(...args){audibleCalls++;return speak.apply(this,args);};}
      const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){if(!this.muted&&this.volume>0)audibleCalls++;return play.apply(this,args);};
    });
    await pc.goto(s.base,{waitUntil:'domcontentloaded'});
    await pc.waitForSelector('.pair-dialog[open]',{timeout:30000});
    await pc.waitForFunction(()=>!!document.querySelector('.pair-qr svg'));
    const {pairCode}=await pc.evaluate(async()=> (await fetch('/where')).json());
    assert.equal(await pc.locator('.pair-code').textContent(),pairCode);
    await pc.keyboard.press('Escape');
    assert.equal(await pc.locator('.pair-dialog').evaluate(el=>el.open),true);
    assert.equal(await pc.locator('.pair-close').isVisible(),false);
    await phone.goto(s.base+'/phone.html?connect='+pairCode,{waitUntil:'domcontentloaded'});
    await phone.waitForFunction(()=>document.querySelector('#controlStatus')?.textContent==='CONNECTED');
    assert.equal(await phone.locator('.phone-dev-toggle').count(),0);
    await pc.waitForFunction(()=>!document.querySelector('.pair-dialog').open);
    assert.notEqual(await phone.evaluate(()=>window.PhoneMotion.status),'ready');
    assert.equal(await pc.locator('.frame').evaluate(el=>el.inert),false);
    assert.equal(await phone.locator('#phoneBoot').count(),0);
    await phone.locator('#motionEnable').click();await motions(phone);
    await phone.waitForFunction(()=>window.PhoneMotion.status==='ready');
    await pc.waitForFunction(()=>!document.querySelector('.pair-dialog').open);
    await pc.locator('#tv-button').click();
    assert.match(await pc.locator('#tv-pop').innerText(),/HDMI/);
    assert.match(await pc.locator('#tv-pop').innerText(),/not adapted to every TV/);
    await pc.locator('#tv-button').click();
    await phone.locator('#remotePlay').click();
    await pc.waitForURL('**/games/subway/',{waitUntil:'domcontentloaded'});
    await phone.waitForFunction(()=>document.querySelector('#liveGameName').textContent==='Subway');
    const actions=phone.locator('.live-game-actions');
    await actions.getByRole('button',{name:'Play',exact:true}).click({timeout:30000});
    await actions.getByRole('button',{name:'It is in my pocket',exact:true}).click();
    await actions.getByRole('button',{name:'Start game',exact:true}).click({timeout:25000});
    await pc.waitForFunction(()=>document.getElementById('overlay').hidden);
    await phone.evaluate(()=>window.PhoneMotion.stop());
    await pc.waitForFunction(()=>document.getElementById('overlayTitle').textContent==='PHONE LOST');
    await phone.locator('.live-motion-enable').click();
    await pc.waitForFunction(()=>document.getElementById('overlay').hidden);
    await phone.waitForFunction(()=>window.PhoneApp.sessions.some(s=>s.seconds>0),{},{timeout:15000});
    assert.equal(await pc.evaluate(()=>audibleCalls),0,'Subway must not create audio or play audible media');
    await phone.locator('.live-back-button').click();
    try{await pc.waitForURL(s.base+'/',{waitUntil:'domcontentloaded',timeout:20000});}
    catch(e){console.log('BACK FAILURE',pc.url(),await phone.locator('body').innerText());throw e;}
    await phone.waitForFunction(()=>!document.querySelector('#controlGallery').hidden&&!document.querySelector('#controlGallery').classList.contains('is-disconnected'));
    for(const [route,name] of [['/games/squid/red-light/','Red Light Green Light'],['/games/squid/jump-rope/','Jump Rope'],['/games/squid/track/','Track & Field'],['/training/','Controller training']]){
      await pc.goto(s.base+route,{waitUntil:'domcontentloaded'});
      await phone.waitForFunction(name=>document.querySelector('#liveGameName')?.textContent===name,name,{timeout:30000});
      assert.equal(await phone.evaluate(()=>window.PhoneMotion.status),'ready');
      try{await phone.waitForFunction(()=>document.querySelector('.live-game-actions button'),{},{timeout:30000});}
      catch(e){console.log('GAME ACTION FAILURE',route,await pc.locator('body').innerText(),await phone.locator('body').innerText(),errors);throw e;}
      if(route!=='/training/'){
        await actions.getByRole('button',{name:'Play',exact:true}).click();
        await actions.getByRole('button',{name:'It is in my pocket',exact:true}).click();
        await actions.getByRole('button',{name:'Start game',exact:true}).click({timeout:25000});
        await pc.waitForFunction(()=>document.getElementById('overlay').hidden);
        await phone.evaluate(()=>window.PhoneMotion.stop());
        await pc.waitForFunction(()=>document.getElementById('overlayTitle').textContent==='PHONE LOST');
        await phone.locator('.live-motion-enable').click();
        await pc.waitForFunction(()=>document.getElementById('overlay').hidden);
      }
      assert.equal(await pc.evaluate(()=>audibleCalls),0,`${name} must stay silent`);
      assert.equal(await pc.locator('#sound').count(),0);
    }
    const identity=await phone.evaluate(()=>window.PhoneApp.id);
    const rows=await phone.evaluate(()=>window.PhoneApp.sessions);
    assert.ok(rows.length>0);
    await phone.reload({waitUntil:'domcontentloaded'});
    await phone.waitForFunction(()=>document.querySelector('#controlStatus')?.textContent==='CONNECTED');
    assert.equal(await phone.evaluate(()=>window.PhoneApp.id),identity);
    assert.deepEqual(await phone.evaluate(()=>window.PhoneApp.sessions),rows);
    assert.notEqual(await phone.evaluate(()=>window.PhoneMotion.status),'ready');
    assert.equal(await phone.locator('.live-motion-enable').isVisible(),true);
    assert.deepEqual(errors,[]);
    assert.doesNotMatch(s.log,/Traceback|Bad request syntax/);
  }finally{await browser.close();s.close();}
});

test('denied permissions, storage failures, camera denial, expired code and competing phone',{timeout:90000},async()=>{
  const s=await server(),browser=await launch();
  try{
    const pc=await browser.newPage();
    await pc.goto(s.base+'/training/',{waitUntil:'domcontentloaded'});
    const {pairCode}=await pc.evaluate(async()=> (await fetch('/where')).json());
    const phone=await phonePage(browser);
    await phone.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Storage full','QuotaExceededError');};DeviceMotionEvent.requestPermission=async()=> 'denied';});
    await phone.goto(s.base+'/phone.html?connect='+pairCode,{waitUntil:'domcontentloaded'});
    await phone.waitForFunction(()=>document.querySelector('#controlStatus')?.textContent==='CONNECTED');
    await phone.locator('.live-motion-enable').click();
    await phone.waitForFunction(()=>window.PhoneMotion.status==='denied');
    assert.equal(await phone.evaluate(()=>window.PhoneApp.storageOK),false);
    const other=await phonePage(browser);
    await other.goto(s.base+'/phone.html?connect='+pairCode,{waitUntil:'domcontentloaded'});
    await other.waitForFunction(()=>document.querySelector('#controlStatus')?.textContent==='SCREEN IN USE');
    assert.equal(await other.locator('#controlConnect').isVisible(),true);
    await other.locator('[data-method=code]').click();
    await other.locator('#pairCode').fill(pairCode==='000000'?'111111':'000000');
    await other.locator('#pairSubmit').click();
    await other.waitForFunction(()=>document.querySelector('#controlMessage').textContent.includes('does not match'));
    await other.locator('[data-method=scan]').click();
    await other.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});
    await other.locator('#scanStart').click();
    await other.waitForFunction(()=>document.querySelector('#controlMessage').textContent.includes('wasn’t allowed'));
  }finally{await browser.close();s.close();}
});

test('phone loading failures offer retry; connected carousel stays available without motion',{timeout:90000},async()=>{
  const s=await server(),browser=await launch();
  try{
    const phone=await phonePage(browser);
    await phone.route('**/phone/controller.js',route=>route.abort());
    await phone.goto(s.base+'/phone.html',{waitUntil:'domcontentloaded'});
    await phone.waitForSelector('#phoneBoot[data-state=error]');
    assert.equal(await phone.locator('#phoneBootRetry').isVisible(),true);
    await phone.screenshot({path:'test-results/phone-loading-error.png'});
    await phone.unroute('**/phone/controller.js');
    await phone.locator('#phoneBootRetry').click();
    await phone.waitForFunction(()=>window.PhoneApp&&window.PhoneMotion&&!document.getElementById('phoneBoot'));
    const pc=await browser.newPage({viewport:{width:1280,height:850}});
    await pc.goto(s.base,{waitUntil:'domcontentloaded'});
    await pc.waitForSelector('.pair-qr svg');
    await pc.waitForFunction(()=>!document.getElementById('intro'),{},{timeout:20000});
    await pc.screenshot({path:'test-results/pc-phone-gate.png'});
    const code=await pc.locator('.pair-code').textContent();
    await phone.goto(s.base+'/phone.html?connect='+code,{waitUntil:'domcontentloaded'});
    await phone.waitForFunction(()=>document.getElementById('controlStatus')?.textContent==='CONNECTED');
    await phone.locator('#motionEnable').click();await motions(phone);
    await pc.waitForFunction(()=>!document.querySelector('.pair-dialog').open);
    await phone.evaluate(()=>window.PhoneMotion.stop());
    await delay(1500);
    assert.equal(await pc.locator('.pair-dialog').evaluate(el=>el.open),false);
    assert.equal(await pc.locator('.frame').evaluate(el=>el.inert),false);
    await pc.locator('#phone-status').click();
    await pc.waitForSelector('.pair-dialog[open]');
    assert.equal(await pc.locator('.pair-close').isVisible(),true);
    await pc.keyboard.press('Escape');
    assert.equal(await pc.locator('.pair-dialog').evaluate(el=>el.open),false);
    await pc.reload({waitUntil:'domcontentloaded'});
    await pc.waitForFunction(()=>window.galleryIntro?.presented&&document.querySelector('.pair-dialog')&&!document.querySelector('.pair-dialog').open);
    assert.equal(await pc.locator('.pair-code').textContent(),code);
    await pc.locator('#tv-button').click();
    await pc.waitForSelector('#tv-pop:not([hidden])');
    await delay(500);
    await pc.screenshot({path:'test-results/pc-tv-instructions.png'});
    assert.match(await pc.locator('#tv-url').innerText(),/desktop=1/);
  }finally{await browser.close();s.close();}
});

test('server restart refreshes the PC code and the phone can pair again with its saved identity',{timeout:90000},async()=>{
  let s=await server();const browser=await launch();
  try{
    const pc=await browser.newPage({viewport:{width:1000,height:700}}),phone=await phonePage(browser);
    await pc.goto(s.base,{waitUntil:'domcontentloaded'});await pc.waitForSelector('.pair-qr svg');
    const old=await pc.locator('.pair-code').textContent();
    await phone.goto(s.base+'/phone.html?connect='+old,{waitUntil:'domcontentloaded'});
    await phone.waitForFunction(()=>document.getElementById('controlStatus')?.textContent==='CONNECTED');
    const identity=await phone.evaluate(()=>window.PhoneApp.id);
    await phone.locator('#motionEnable').click();await motions(phone);
    await pc.waitForFunction(()=>!document.querySelector('.pair-dialog').open);
    const port=s.port;await s.close();s=await server(port);
    await pc.waitForFunction(old=>document.querySelector('.pair-dialog').open&&/^\d{6}$/.test(document.querySelector('.pair-code').textContent)&&document.querySelector('.pair-code').textContent!==old,old,{timeout:25000});
    await phone.waitForFunction(()=>document.getElementById('controlStatus')?.textContent==='NOT CONNECTED');
    const code=await pc.locator('.pair-code').textContent();
    await phone.goto(s.base+'/phone.html?connect='+code,{waitUntil:'domcontentloaded'});
    await phone.waitForFunction(()=>document.getElementById('controlStatus')?.textContent==='CONNECTED');
    assert.equal(await phone.evaluate(()=>window.PhoneApp.id),identity);
    await phone.locator('#motionEnable').click();await motions(phone);
    await pc.waitForFunction(()=>!document.querySelector('.pair-dialog').open);
    assert.doesNotMatch(s.log,/Traceback/);
  }finally{await browser.close();s.close();}
});

async function decodePairQR(page){
  await page.addScriptTag({url:new URL('/phone/vendor/jsQR.js',page.url()).href});
  const png=await page.locator('.pair-qr').screenshot();
  return page.evaluate(async base64=>{
    const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    return window.jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height)?.data;
  },png.toString('base64'));
}

test('pairing waits for the finished scene and widgets; the displayed QR opens its matching phone session',{timeout:90000},async()=>{
  const s=await server(),browser=await launch();
  try{
    const pc=await browser.newPage({viewport:{width:1280,height:850}});
    await pc.addInitScript(()=>{
      window.pairPresentation=null;
      addEventListener('gallery-presented',()=>{
        window.pairPresentation={intro:!!document.getElementById('intro'),canvas:!!document.querySelector('#stage canvas'),stats:getComputedStyle(document.getElementById('race-summary')).opacity,phone:getComputedStyle(document.getElementById('phone-status')).opacity,dock:getComputedStyle(document.getElementById('tv-dock')).opacity};
      });
    });
    await pc.goto(s.base,{waitUntil:'domcontentloaded'});
    await pc.waitForFunction(()=>!!document.querySelector('.pair-qr svg'));
    assert.equal(await pc.locator('.pair-dialog').evaluate(el=>el.open),false,'QR should be prepared while the scene is still entering');
    await pc.waitForSelector('.pair-dialog[open]',{timeout:30000});
    assert.equal(await pc.locator('.pair-dialog svg:not(.pair-qr svg), .pair-state i').count(),0);
    assert.deepEqual(await pc.evaluate(()=>pairPresentation),{intro:false,canvas:true,stats:'1',phone:'1',dock:'1'});
    await delay(400);
    const decoded=await decodePairQR(pc),code=await pc.locator('.pair-code').textContent();
    assert.equal(decoded,await pc.locator('.pair-address').getAttribute('href'));
    assert.equal(new URL(decoded).searchParams.get('connect'),code);
    const phone=await phonePage(browser);
    await phone.goto(decoded,{waitUntil:'domcontentloaded'});
    await phone.waitForFunction(()=>document.getElementById('controlStatus')?.textContent==='CONNECTED');
    await pc.waitForFunction(()=>!document.querySelector('.pair-dialog').open);
    assert.notEqual(await phone.evaluate(()=>window.PhoneMotion.status),'ready');
    assert.equal(await pc.locator('.frame').evaluate(el=>el.inert),false);
  }finally{await browser.close();s.close();}
});

test('hosted pairing QR encodes the returned HTTPS domain and code',{timeout:60000},async()=>{
  const s=await server(),browser=await launch();
  try{
    const pc=await browser.newPage({viewport:{width:1000,height:700},reducedMotion:'reduce'});
    await pc.route('**/where',async route=>{
      const response=await route.fetch(),data=await response.json();
      // Server-side forwarded-domain behavior is independently covered in hosting.test.mjs.
      await route.fulfill({response,json:{...data,hosted:true,phoneEntry:'https://beta.example.test/phone.html',phoneUrl:'https://beta.example.test/phone.html?connect='+data.pairCode}});
    });
    await pc.goto(s.base,{waitUntil:'domcontentloaded'});
    await pc.waitForSelector('.pair-dialog[open]',{timeout:30000});
    const code=await pc.locator('.pair-code').textContent();
    assert.equal(await decodePairQR(pc),'https://beta.example.test/phone.html?connect='+code);
    assert.equal(await pc.locator('.pair-network').innerText(),'Same Wi-Fi required. Motion travels directly to your PC.');
    assert.equal(await pc.evaluate(()=>!!document.getElementById('intro')),false);
  }finally{await browser.close();s.close();}
});
