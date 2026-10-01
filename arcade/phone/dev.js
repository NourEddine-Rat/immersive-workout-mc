// Preview fixtures are held in memory. Never send them to a PC or save them as activity.
const app=window.PhoneApp;
const button=document.createElement('button');button.className='phone-dev-toggle';button.textContent='Dev';button.setAttribute('aria-label','Open phone developer panel');
const panel=document.createElement('dialog');panel.className='phone-dev-panel';panel.setAttribute('aria-label','Phone developer panel');
panel.innerHTML='<header><strong>Phone design lab</strong><button type="button" aria-label="Close developer panel">×</button></header><p>Preview existing pages and edge cases. Sample activity stays in memory and preview controls never operate your PC.</p><div class="dev-state" role="status"></div><div class="dev-groups"></div><button type="button" class="dev-live">Back to live phone</button>';
const badge=document.createElement('div');badge.className='phone-preview-badge';badge.hidden=true;badge.textContent='DEV PREVIEW · NOT LIVE';
document.body.append(button,panel,badge);
// Varied sessions exercise peaks, rest days and different game/metric mixes.
const sample=()=>{
  const now=new Date(),rows=[],counts=[4,2,0,3,1,4,2,1,3,0,2,4,1,3];
  const effort=[.55,1.2,.8,1.65,.95,.4,1.35,.7,1.1];
  for(let day=0;day<35;day++){
    const start=new Date(now);start.setDate(start.getDate()-day);start.setHours(0,0,0,0);
    const count=counts[day%counts.length];
    for(let session=0;session<count;session++){
      const index=day*4+session,game=['subway','track','redlight','jumprope'][(day+session)%4];
      const scale=effort[(day*3+session*2)%effort.length],seconds=Math.round((180+(index*73)%480)*scale);
      const steps=Math.round(seconds*(game==='jumprope'?.5:game==='redlight'?1.25:2.1));
      const kcal=Math.round(seconds/60*(game==='jumprope'?9:6.5)*10)/10;
      const elapsed=day===0?+now-+start:22*3600000;
      rows.push({id:`preview-${day}-${session}`,userId:app.id,game,
        startedAt:+start+Math.floor(elapsed*(session+.5)/count),updatedAt:+now,complete:true,
        outcome:index%3?'Finished':'Winner',steps,metres:Math.round(steps*(game==='track'?1.1:.72)),
        kcal,active:Math.round(kcal*.84*10)/10,seconds,
        jumps:game==='jumprope'?Math.round(seconds*.7):game==='subway'?4+index%19:0,
        squats:game==='subway'?3+index%13:game==='redlight'?2+index%7:0,coins:Math.round(steps/25)});
    }
  }
  return rows;
};
const groups={
 'Getting started':{'How to play guide':()=>window.openPhoneGuide()},
 'Pages':{'Welcome':()=>app.show('welcome',document.getElementById('opener')),'Activity':()=>window.openActivity(),'Detailed stats':()=>window.openStatistics(),'Profile':()=>window.openProfile(),'Leaderboard':()=>window.openLeaderboard(),'Profile · name':()=>window.openBasicsStep(0),'Profile · sex':()=>window.openBasicsStep(1),'Profile · weight':()=>window.openBasicsStep(2),'Home-screen setup':()=>app.show('setup',document.querySelector('.page'))},
 'Connection & game':Object.fromEntries(['connect','connected','loading','training','playing','results','lost'].map(kind=>[kind,()=>window.ControllerDev.show(kind)])),
 'Motion':Object.fromEntries(['needed','requesting','ready','denied','unavailable','no-data'].map(kind=>[kind,()=>window.ControllerDev.motion(kind)])),
 'Activity data':{'Zero activity':()=>{app.previewData([]);window.openActivity();},'Sample history':()=>{app.previewData(sample());window.openActivity();},'Storage full notice':()=>window.dispatchEvent(new CustomEvent('storage-unavailable'))},
 'Metric details':Object.fromEntries(['calories','steps','distance','time','games','jumps','squats','sensors'].map(id=>[id,()=>window.openMetric(id)]))
};
for(const [name,options] of Object.entries(groups)){const group=document.createElement('section'),title=document.createElement('h3');title.textContent=name;group.append(title);for(const [label,action] of Object.entries(options)){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{if(!app.preview)app.previewData([]);badge.hidden=false;panel.querySelector('.dev-state').textContent=label;window.ControllerDev.suspend();action();panel.close();};group.append(b);}panel.querySelector('.dev-groups').append(group);}
button.onclick=()=>panel.showModal();panel.querySelector('header button').onclick=()=>panel.close();
panel.querySelector('.dev-live').onclick=()=>{app.previewData(null);badge.hidden=true;window.ControllerDev.exit();window.openController();panel.close();};
window.addEventListener('storage-unavailable',()=>{let note=document.getElementById('phoneStorageWarning');if(!note){note=document.createElement('div');note.id='phoneStorageWarning';note.className='phone-storage-warning';note.setAttribute('role','status');note.textContent='Storage is unavailable. Your activity works this session, but new changes may not survive a reload.';note.onclick=()=>note.remove();document.body.append(note);}});
const params=new URLSearchParams(location.search);
if(!params.has('connect')){
  const page=params.get('screen')||app.preferences.page;
  if(page==='stats')window.openActivity();else if(page==='controller')window.openController();else if(page==='statistics')window.openStatistics();else if(page?.startsWith('metric:'))window.openMetric(page.slice(7));else if(page==='profile')window.openProfile();
}
if(params.get('preview')==='1'){app.previewData(sample());badge.hidden=false;window.ControllerDev.suspend();}
