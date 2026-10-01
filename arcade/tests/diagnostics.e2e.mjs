import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {returningPhone} from './phone-fixtures.mjs';

test('phone and PC export a correlated timeline; signaling reconnect preserves motion connection',{timeout:60000},async()=>{
 const child=spawn('python3',['-u','-c',"import serve; s=serve.Dual(('127.0.0.1',0),serve.Handler); print(s.server_port,flush=True); s.serve_forever()"],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
 const port=await new Promise(r=>child.stdout.once('data',d=>r(Number(d.toString().trim()))));
 const base=`http://localhost:${port}`;
 const browser=await chromium.launch({channel:process.env.ARCADE_BROWSER||'chrome',headless:true,args:['--enable-unsafe-swiftshader']});
 try{
  const pc=await browser.newPage(),phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];for(const page of [pc,phone])page.on('pageerror',e=>errors.push(e.message));
  await returningPhone(phone);
  await pc.addInitScript(()=>{window.sockets=[];const W=WebSocket;window.WebSocket=class extends W{constructor(...a){super(...a);sockets.push(this);}};});
  await pc.goto(base,{waitUntil:'domcontentloaded'});await pc.waitForSelector('.pair-qr svg');
  const code=await pc.locator('.pair-code').textContent();
  await phone.goto(base+'/phone.html?connect='+code,{waitUntil:'domcontentloaded'});
  await phone.waitForFunction(()=>window.PhoneConnection?.status.direct);
  await phone.evaluate(()=>ConnectionDiagnostics.flush());
  await pc.waitForTimeout(1500);
  const report=await pc.evaluate(()=>ConnectionDiagnostics.report());
  assert.ok(report.serverAvailable);
  for(const role of ['console','phone'])assert.ok(report.server.events.some(e=>e.role===role&&e.event==='rtc-create'),role);
  assert.ok(report.server.events.some(e=>e.event==='pair-accepted'));
  assert.ok(!JSON.stringify(report).includes(code));
  const phoneReport=await phone.evaluate(()=>ConnectionDiagnostics.report());
  assert.equal(phoneReport.server.context.session,report.server.context.session);
  assert.ok(phoneReport.events.some(e=>e.event==='sdp-remote'));
  await pc.evaluate(()=>sockets.at(-1).close());
  await pc.waitForFunction(()=>sockets.length>1&&sockets.at(-1).readyState===1);
  assert.equal(await phone.evaluate(()=>PhoneConnection.status.direct),true);
  await pc.locator('#phone-status').click();await pc.locator('.pair-local-help summary').click();
  const downloaded=pc.waitForEvent('download');await pc.getByRole('button',{name:'Download connection report'}).click();
  assert.match((await downloaded).suggestedFilename(),/^inmotion-connection-.*-host.json$/);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();child.kill();}
});
