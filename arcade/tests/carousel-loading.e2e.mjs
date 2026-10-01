import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {returningPhone} from './phone-fixtures.mjs';

async function server(){
  const child=spawn('python3',['-u','-c',"import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','ignore']});
  const port=await new Promise((resolve,reject)=>{child.stdout.once('data',d=>resolve(Number(d.toString().trim())));child.once('error',reject);});
  return {base:`http://localhost:${port}`,close:()=>new Promise(resolve=>{child.once('exit',resolve);child.kill();})};
}
const launch=()=>chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
async function phonePage(browser){
  const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await returningPhone(phone);
  await phone.addInitScript(()=>{
    window.carouselMessages=[];
    addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.t?.startsWith('carousel-'))carouselMessages.push(event.data.t);});
  });
  return phone;
}
async function showGallery(phone,base){
  await phone.goto(base+'/phone.html',{waitUntil:'domcontentloaded'});
  await phone.waitForFunction(()=>window.ControllerDev);
  await phone.evaluate(()=>{
    window.ControllerDev.show('connected');
    dispatchEvent(new CustomEvent('phone-carousel',{detail:{t:'carousel-state',hostId:'preview',position:3,label:'Track & Field',game:'track'}}));
  });
}

test('phone hides unfinished 3D until images, logos and the PC selection are rendered',{timeout:60000},async()=>{
  const s=await server(),browser=await launch();
  let releaseCover,releaseLogo;
  try{
    const phone=await phonePage(browser);
    const coverWait=new Promise(resolve=>{releaseCover=resolve;}),logoWait=new Promise(resolve=>{releaseLogo=resolve;});
    await phone.route('**/carousel/red-light-cover.jpeg',async route=>{await coverWait;await route.continue();});
    await phone.route('**/carousel/track-and-field-logo.png',async route=>{await logoWait;await route.continue();});
    await showGallery(phone,s.base);
    await phone.waitForFunction(()=>carouselMessages.includes('carousel-mounted'));
    await phone.frameLocator('#remoteCarousel').locator('#stage canvas').waitFor();
    assert.equal(await phone.locator('.remote-gallery-loading').isVisible(),true);
    assert.equal(await phone.locator('#remoteCarousel').evaluate(el=>getComputedStyle(el).opacity),'0');
    assert.equal(await phone.locator('#remoteCarousel').evaluate(el=>el.inert),true);
    assert.equal(await phone.evaluate(()=>carouselMessages.includes('carousel-loaded')),false);
    await phone.screenshot({path:'test-results/phone-carousel-loading.png'});

    const coverResponse=phone.waitForResponse('**/carousel/red-light-cover.jpeg');
    releaseCover();await coverResponse;
    assert.equal(await phone.locator('.remote-gallery-loading').isVisible(),true,'a decoded logo is also required before reveal');
    releaseLogo();
    await phone.waitForSelector('.remote-gallery[data-state=ready]');
    assert.equal(await phone.locator('.remote-gallery-loading').isVisible(),false);
    assert.equal(await phone.locator('#remoteCarousel').evaluate(el=>el.inert),false);
    assert.equal(await phone.locator('.remote-gallery').getAttribute('aria-busy'),'false');
    assert.equal(await phone.locator('#remoteGame').textContent(),'Track & Field');
    await phone.frameLocator('#remoteCarousel').locator('.game-logo[data-game=track].is-active').waitFor();
    await phone.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#remoteCarousel')).opacity)>.5);
    await phone.screenshot({path:'test-results/phone-carousel-ready.png'});

    const loadingAgain=await phone.evaluate(()=>{
      ControllerDev.show('playing');ControllerDev.show('connected');
      return document.querySelector('.remote-gallery').dataset.state==='loading'&&document.querySelector('#remoteCarousel').inert;
    });
    assert.equal(loadingAgain,true,'returning from a game must cover the new iframe too');
    await phone.waitForSelector('.remote-gallery[data-state=ready]');
  }finally{releaseCover?.();releaseLogo?.();await browser.close();await s.close();}
});

test('failed carousel images reveal a usable game list instead of unfinished 3D',{timeout:60000},async()=>{
  const s=await server(),browser=await launch();
  try{
    const phone=await phonePage(browser);
    await phone.route('**/carousel/red-light-cover.jpeg',route=>route.abort());
    await showGallery(phone,s.base);
    await phone.waitForSelector('.remote-fallback:not([hidden])');
    assert.equal(await phone.locator('.remote-gallery').isVisible(),false);
    assert.equal(await phone.locator('.remote-fallback button').count(),4);
    assert.equal(await phone.evaluate(()=>carouselMessages.includes('carousel-loaded')),false);
    await phone.screenshot({path:'test-results/phone-carousel-fallback.png'});
  }finally{await browser.close();await s.close();}
});
