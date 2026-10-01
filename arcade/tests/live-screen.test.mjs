import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

function harness(){
  const events=new Map(),dialogs=[],timers=new Map();let frame,clock=100,timerId=0;
  const on=(name,fn)=>events.set(name,[...(events.get(name)||[]),fn]);
  const emit=(name,detail)=>{for(const fn of events.get(name)||[])fn({detail});};
  const ctx2d=new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]||(()=>{})});
  const node=()=>{
    const nodes=new Map(),listeners=new Map();
    return {nodes,children:[],append(...els){this.children.push(...els);},prepend(el){this.children.unshift(el);},replaceChildren(){this.children=[];},querySelectorAll(){return this.children;},dataset:{},textContent:'',hidden:false,open:false,width:0,height:0,setAttribute(){},focus(){},
      addEventListener(name,fn){listeners.set(name,fn);},
      fire(name,event={}){listeners.get(name)?.(event);},
      showModal(){this.open=true;},close(){this.open=false;},getBoundingClientRect:()=>({width:390,height:420}),getContext:()=>ctx2d,
      querySelector(q){if(!nodes.has(q))nodes.set(q,node());return nodes.get(q);}};
  };
  const entries=[null];let index=0;
  const history={get state(){return entries[index];},pushState(state,_title,url){entries.splice(++index);entries.push(state);sandbox.location.href=String(url);},back(){if(index){index--;emit('popstate');}},forward(){if(index<entries.length-1){index++;emit('popstate');}}};
  const sandbox={setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout(id){timers.delete(id);},document:{createElement:tag=>{const el=node();if(tag==="dialog")dialogs.push(el);return el;},body:{append(){}},getElementById:()=>null,hidden:false},history,location:{href:'http://localhost/phone.html'},crypto:{randomUUID:()=> 'test-entry'},performance:{now:()=>clock},devicePixelRatio:1,matchMedia:()=>({matches:false}),requestAnimationFrame:f=>(frame=f,1),cancelAnimationFrame(){},CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail;}},addEventListener:on,dispatchEvent:e=>emit(e.type,e.detail),URL};
  sandbox.window=sandbox;sandbox.PhoneMotion={status:'ready'};
  vm.runInNewContext(fs.readFileSync(new URL('../phone/live-screen.js',import.meta.url),'utf8'),sandbox);
  return {api:sandbox.PhoneLive,panel:dialogs[0],prompt:dialogs[1],nodes:dialogs[0].nodes,history,entries,emit,advance(ms){clock+=ms;for(const [id,timer] of timers){if(timer.at<=clock){timers.delete(id);timer.fn();}}},paint(t){clock=t;frame(t);}};
}
const host={hostId:'pc1',game:'subway',heading:'Game in progress',live:{phase:'play'}};
test('one history entry per live view; Back stays dismissed across host updates; Forward restores it',()=>{
  const h=harness();h.api.update(host,{allowOpen:true});assert.equal(h.panel.open,true);assert.equal(h.entries.length,2);
  h.api.update({...host,heading:'Run complete',live:{phase:'results'}},{allowOpen:true});assert.equal(h.entries.length,2);
  h.history.back();assert.equal(h.panel.open,false);
  h.api.update(host,{allowOpen:true});assert.equal(h.panel.open,false);
  h.history.forward();assert.equal(h.panel.open,true);
  h.api.update({hostId:'pc1',game:'hub'},{allowOpen:true});assert.equal(h.panel.open,false);assert.equal(h.history.state,null);
});
test('hidden controller never opens a live display; a new host can open after Back',()=>{
  const h=harness();h.api.update(host,{allowOpen:false});assert.equal(h.panel.open,false);
  h.api.update(host,{allowOpen:true});h.history.back();
  h.api.update({...host,hostId:'pc2'},{allowOpen:true});assert.equal(h.panel.open,true);
});
test('real readings require actual fresh sensor samples and expire when samples stop',()=>{
  const h=harness();h.api.update(host,{allowOpen:true});h.paint(100);
  assert.equal(h.nodes.get('#liveAcceleration').textContent,'—');
  h.emit('phone-motion-sample',{acceleration:[9.80665,0,0],rotation:[0,30,0],rate:60});h.paint(150);
  assert.equal(h.nodes.get('#liveAcceleration').textContent,'1.00');assert.equal(h.nodes.get('#liveRotation').textContent,'30');assert.equal(h.nodes.get('#liveRate').textContent,'60');
  h.paint(2000);assert.equal(h.nodes.get('#liveAcceleration').textContent,'—');assert.equal(h.nodes.get('#liveSignal').textContent,'Waiting for motion');
});
test('playing display has no hardcoded game controls',()=>{
  const source=fs.readFileSync(new URL('../phone/live-screen.js',import.meta.url),'utf8');
  const markup=source.split('panel.innerHTML=`')[1].split('`;')[0];
  assert.doesNotMatch(markup,/<(?:button|input|select|a)\b/);
});

test('a tap only opens the Back hint; dismissal keeps motion active and does not add history',()=>{
  const h=harness();h.api.update(host,{allowOpen:true});h.panel.fire('click');
  assert.equal(h.prompt.open,true);assert.equal(h.prompt.dataset.kind,'hint');
  assert.match(h.prompt.querySelector('p').textContent,/browser’s Back button/);
  assert.equal(h.entries.length,2);
  h.advance(3000);
  assert.equal(h.prompt.open,false);assert.equal(h.panel.open,true);
  h.panel.fire('click');h.history.back();
  assert.equal(h.prompt.open,false);assert.equal(h.panel.open,false);
});
test('completion prompts once per round and auto-dismisses; browser Back closes the view',()=>{
  const h=harness();h.api.update(host,{allowOpen:true});
  const result={...host,live:{phase:'results'}};
  h.api.update(result,{allowOpen:true});assert.equal(h.prompt.dataset.kind,'complete');assert.equal(h.prompt.open,true);
  h.advance(3000);
  h.api.update(result,{allowOpen:true});assert.equal(h.prompt.open,false);
  h.api.update(host,{allowOpen:true});h.api.update(result,{allowOpen:true});assert.equal(h.prompt.open,true);
  h.history.back();
  assert.equal(h.prompt.open,false);assert.equal(h.panel.open,false);assert.equal(h.history.state,null);
  h.api.update(result,{allowOpen:true});assert.equal(h.panel.open,false);
});

test('host actions live on the wave screen, dispatch the current revision and disable during disconnection',()=>{
  const h=harness(),calls=[];
  h.api.update({...host,revision:7,live:{phase:'done'},actions:[{id:0,label:'Race again'},{id:2,label:'Lobby'}]},{allowOpen:true,onAction:(...args)=>calls.push(args)});
  const area=h.nodes.get('.live-game-actions');
  assert.equal(area.hidden,false);assert.equal(area.children[0].textContent,'Race again');
  assert.equal(h.prompt.open,true);h.advance(3000);assert.equal(h.prompt.open,false);
  area.children[0].onclick({stopPropagation(){}});
  assert.deepEqual(calls,[[0,7]]);assert.equal(area.children[0].disabled,true);
  area.children[0].onclick({stopPropagation(){}});assert.equal(calls.length,1);
  h.advance(1500);assert.equal(area.children[0].disabled,false);
  h.api.connection(true);assert.equal(area.children[0].disabled,true);
  area.children[0].onclick({stopPropagation(){}});assert.equal(calls.length,1);
  h.api.update({...host,actions:[]},{allowOpen:true});assert.equal(area.hidden,true);assert.equal(area.children.length,0);
});
