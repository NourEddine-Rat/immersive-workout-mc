import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {returningPhone} from './phone-fixtures.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const launch=()=>chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
async function server(){
  const child=spawn('python3',['-u','-c',"import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
  const port=await new Promise(resolve=>child.stdout.once('data',d=>resolve(Number(d.toString().trim()))));
  return {base:`http://localhost:${port}`,close:()=>child.kill()};
}
async function phonePage(browser){const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(15000);return page;}
async function welcome(phone){
  await phone.waitForFunction(()=>!!window.PhoneMotion&&!document.getElementById('phoneBoot'));
  assert.equal(await phone.locator('#opGo').isVisible(),true);
  assert.equal(await phone.locator('.control-screen').isVisible(),false);
}
async function guide(phone){await phone.locator('#opGo').click();await phone.locator('.guide-continue').click();}
async function profile(phone){
  await phone.locator('#basicsName').fill('new_player');await phone.locator('.basics-next').click();
  await phone.locator('.basics-sex label:has(input[value=female])').click();await phone.locator('.basics-next').click();
  await phone.locator('#basicsWeight').fill('68.5');await phone.locator('.basics-next').click();
}

test('fresh phones start at welcome; QR intent and draft survive reload; a saved profile opens Play',{timeout:90000},async()=>{
  const s=await server(),browser=await launch();
  try{
    const phone=await phonePage(browser),pc=await browser.newPage();
    const errors=[],joins=[];phone.on('pageerror',e=>errors.push(e.message));
    phone.on('websocket',socket=>socket.on('framesent',e=>{try{if(JSON.parse(e.payload).t==='phone-join')joins.push(e.payload);}catch{}}));
    await phone.addInitScript(()=>{
      // Old page/guide flags are not completion records.
      if(!localStorage.getItem('inmotion.basics.v1')){
        localStorage.setItem('inmotion.preferences.v1',JSON.stringify({page:'controller',guideSeen:true}));
      }
    });
    await phone.goto(s.base+'/phone.html');await welcome(phone);
    await phone.evaluate(()=>window.openController());await welcome(phone);
    await pc.goto(s.base);await pc.waitForSelector('.pair-qr svg');
    const code=await pc.locator('.pair-code').textContent();
    await phone.goto(s.base+'/phone.html?connect='+code);await welcome(phone);
    assert.equal(joins.length,0);
    await phone.screenshot({path:'test-results/phone-first-visit.png'});
    await guide(phone);await phone.locator('#basicsName').fill('new_player');await phone.locator('.basics-next').click();
    assert.equal(await phone.evaluate(()=>PhoneApp.onboarded),false);
    await phone.reload();await welcome(phone);
    assert.equal(new URL(phone.url()).searchParams.get('connect'),code);assert.equal(joins.length,0);
    await guide(phone);
    assert.equal(await phone.locator('#basicsName').inputValue(),'new_player');
    await phone.locator('.basics-sex label:has(input[value=female])').click();await phone.locator('.basics-next').click();
    await phone.locator('#basicsWeight').fill('68.5');await phone.locator('.basics-next').click();
    await phone.waitForFunction(()=>document.getElementById('controlStatus').textContent==='CONNECTED');
    assert.ok(joins.length>0);assert.equal(new URL(phone.url()).searchParams.has('connect'),false);
    assert.equal(await phone.evaluate(()=>PhoneApp.onboarded),true);
    await phone.evaluate(()=>window.openProfile());await phone.reload();
    await phone.waitForFunction(()=>document.getElementById('controlStatus')?.textContent==='CONNECTED');
    assert.equal(await phone.locator('.control-screen').isVisible(),true);
    assert.equal(await phone.locator('#opGo').isVisible(),false);
    assert.equal(await phone.evaluate(()=>PhoneApp.profile.username),'new_player');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();s.close();}
});

test('onboarding can finish with blocked storage and safely starts over after a reload',{timeout:60000},async()=>{
  const s=await server(),browser=await launch();
  try{
    const phone=await phonePage(browser);
    await phone.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Blocked','SecurityError');};});
    await phone.goto(s.base+'/phone.html');await welcome(phone);await guide(phone);await profile(phone);
    assert.equal(await phone.evaluate(()=>PhoneApp.onboarded),true);
    assert.equal(await phone.locator('#controlConnect').isVisible(),true);
    assert.equal(await phone.locator('#phoneStorageWarning').isVisible(),true);
    await phone.reload();await welcome(phone);
    assert.equal(await phone.evaluate(()=>PhoneApp.onboarded),false);
  }finally{await browser.close();s.close();}
});

test('PC and phone reconnect notices stay steady across retries, then close after direct recovery',{timeout:90000},async()=>{
  const s=await server(),browser=await launch();
  try{
    const phone=await phonePage(browser),pc=await browser.newPage({viewport:{width:1280,height:850}});
    await returningPhone(phone);
    await pc.addInitScript(()=>{
      window.testPeers=[];window.blockLocalRoute=false;
      const Original=RTCPeerConnection;
      window.RTCPeerConnection=class extends Original{constructor(config){super(config);testPeers.push(this);}async getStats(...args){
        const stats=await super.getStats(...args);if(!blockLocalRoute)return stats;
        const altered=new Map();stats.forEach((v,k)=>altered.set(k,v.type==='local-candidate'?{...v,candidateType:'relay'}:v));return altered;
      }};
    });
    await pc.goto(s.base);await pc.waitForSelector('.pair-qr svg');
    const code=await pc.locator('.pair-code').textContent();
    await phone.goto(s.base+'/phone.html?connect='+code);
    await phone.waitForFunction(()=>document.getElementById('controlStatus')?.textContent==='CONNECTED');
    await pc.waitForFunction(()=>window.phoneGate?.ready&&!document.querySelector('.pair-dialog').open);
    await pc.evaluate(()=>{blockLocalRoute=true;testPeers.at(-1).close();});
    await phone.waitForSelector('.phone-reconnect[open]');
    await pc.waitForSelector('.pair-dialog[open]');
    assert.equal(await phone.locator('#reconnectTitle').innerText(),'Reconnecting to your PC');
    assert.equal(await phone.locator('#controlMessage').isVisible(),false);
    assert.equal(await pc.locator('.pair-state span').innerText(),'Phone disconnected. Open Play on your phone.');
    for(const [page,selector] of [[pc,'.pair-state span'],[phone,'#reconnectTitle']])await page.evaluate(selector=>{
      window.statusMutations=[];new MutationObserver(()=>statusMutations.push(document.querySelector(selector).textContent)).observe(document.querySelector(selector),{subtree:true,characterData:true,childList:true});
    },selector);
    await phone.locator('#reconnectRetry').click();
    await delay(12000);
    assert.deepEqual(await phone.evaluate(()=>statusMutations),[]);assert.deepEqual(await pc.evaluate(()=>statusMutations),[]);
    const card=await phone.locator('.phone-reconnect').boundingBox();assert.ok(card.y<60);assert.ok(card.x>=0&&card.x+card.width<=390);
    await phone.screenshot({path:'test-results/phone-reconnect-glass.png'});await pc.screenshot({path:'test-results/pc-reconnect-steady.png'});
    await phone.locator('.reconnect-later').click();assert.equal(await phone.locator('.phone-reconnect').evaluate(el=>el.open),false);
    await phone.evaluate(()=>window.openController());await phone.waitForSelector('.phone-reconnect[open]');
    await pc.evaluate(async()=>{blockLocalRoute=false;(await import('/engine/host-bridge.js')).hostBridge.retryLocal();});
    await phone.waitForFunction(()=>document.getElementById('controlStatus').textContent==='CONNECTED'&&!document.querySelector('.phone-reconnect').open,{},{timeout:25000});
    await pc.waitForFunction(()=>!document.querySelector('.pair-dialog').open);
    assert.equal(await phone.locator('#controlMessage').isVisible(),false);
  }finally{await browser.close();s.close();}
});
