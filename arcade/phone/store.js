import {readSessions,mergeSessions,totals,periodRows,JOURNAL_KEY} from '../engine/activity-store.js';
const memory=new Map();
const read=(key,fallback)=>{if(memory.has(key))return memory.get(key)??fallback;try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
let storageOK=true;
const save=(key,value)=>{memory.set(key,value);try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{if(storageOK){storageOK=false;window.dispatchEvent(new CustomEvent('storage-unavailable'));}return false;}};
const uuid=()=>crypto.randomUUID?.()||`phone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const savedIdentity=read('inmotion.identity.v1',null);
const identity=typeof savedIdentity==='string'&&savedIdentity.length>0&&savedIdentity.length<=100?savedIdentity:uuid();save('inmotion.identity.v1',identity);
let journal=readSessions(), preview=null, previewPreferences=null;
const storedPreferences=read('inmotion.preferences.v1',{});
const preferences=storedPreferences&&typeof storedPreferences==='object'&&!Array.isArray(storedPreferences)?storedPreferences:{};
const emit=()=>window.dispatchEvent(new CustomEvent('activity-change'));
window.PhoneApp={
  read,save,id:identity,get preferences(){return previewPreferences||preferences;},
  get storageOK(){return storageOK;},get preview(){return preview!==null;},
  // A saved, complete profile is the completion record, including existing users.
  // Visiting Play or dismissing the guide alone must never skip onboarding.
  get onboarded(){const p=read('inmotion.basics.v1',null);return !!p&&typeof p.username==='string'&&/^[a-zA-Z0-9_]{2,20}$/.test(p.username)&&['male','female'].includes(p.sex)&&Number.isFinite(p.weightKg)&&p.weightKg>=30&&p.weightKg<=200;},
  get profile(){return {...read('inmotion.basics.v1',{}),id:identity,calibration:read('inmotion.calibration.v1',null)};},
  preference(key,value){if(this.preview){previewPreferences[key]=value;return;}preferences[key]=value;save('inmotion.preferences.v1',preferences);},
  get sessions(){return (preview??journal).filter(row=>row.userId===identity);},
  summary(period='D'){return totals(periodRows(this.sessions,period));},
  rows(period='D'){return periodRows(this.sessions,period);},
  previewData(rows){if(rows!==null&&preview===null)previewPreferences={...preferences};if(rows===null)previewPreferences=null;preview=rows;emit();},
  ingest(rows){if(!Array.isArray(rows))return;journal=mergeSessions(mergeSessions(readSessions(),journal),rows.filter(row=>row?.userId===identity));save(JOURNAL_KEY,journal);emit();},
  show(name,element){
    if(!this.preview&&!this.onboarded&&!['welcome','setup'].includes(name)){name='welcome';element=document.getElementById('opener');}
    document.querySelectorAll('#opener,.page,#activity,.statistics-screen,.metric-screen,.basics-screen,.control-screen,.profile-screen').forEach(el=>{el.hidden=el!==element;});
    document.getElementById('shield')?.remove();element.hidden=false;element.scrollTop=0;
    if(!this.preview)this.preference('page',name);
    window.dispatchEvent(new CustomEvent('phone-page',{detail:name}));
  },
  fmt:n=>Math.round(Number(n)||0).toLocaleString(),
  duration:n=>`${Math.floor((n||0)/60)}m ${Math.floor((n||0)%60)}s`
};
window.addEventListener('storage',e=>{memory.delete(e.key);if(e.key===JOURNAL_KEY){journal=mergeSessions(journal,readSessions());emit();}if(e.key==='inmotion.basics.v1')window.dispatchEvent(new CustomEvent('phone-profile'));});
