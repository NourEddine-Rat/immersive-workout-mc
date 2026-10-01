import {totals} from '../engine/activity-store.js';
const app=window.PhoneApp;
const svg=path=>`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
const icons={
  back:svg('m15 5-7 7 7 7'),
  edit:svg('m14 5 5 5M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z'),
  user:'<img src="./phone/profile/icons/user.svg" alt="" aria-hidden="true">',
  weight:'<img src="./phone/profile/icons/weight.png" alt="" aria-hidden="true">',
  stats:'<img src="./phone/profile/icons/statistics.svg" alt="" aria-hidden="true">',
  help:svg('M9 9a3 3 0 1 1 4 3c-1 .4-1 1-1 2m0 3v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'),
  screen:svg('M3 4h18v12H3V4Zm5 16h8m-4-4v4'),
  chevron:svg('m9 5 7 7-7 7')
};
const row=(id,icon,label,value='')=>`<button type="button" class="profile-row" id="${id}"><span class="profile-row-icon">${icons[icon]}</span><span class="profile-row-copy"><strong>${label}</strong><small>${value}</small></span><span class="profile-chevron">${icons.chevron}</span></button>`;
const screen=document.createElement('section');screen.className='profile-screen';screen.hidden=true;screen.setAttribute('aria-label','Your profile');
screen.innerHTML=`<div class="profile-inner"><header class="profile-head phone-page-head"><button type="button" class="phone-back" aria-label="Back to Stats">${icons.back}</button><h1>Profile</h1><button type="button" class="profile-edit" aria-label="Edit profile">${icons.edit}<span>Edit</span></button></header><div class="profile-hero"><div class="profile-avatar"><img src="./phone/profile/wireframe-profile.webp" width="468" height="780" alt=""></div><h2 id="profileName"></h2><p id="profileSubtitle"></p></div><div class="profile-summary" aria-label="All-time activity"><div><strong id="profileGames">0</strong><span>Games</span></div><div><strong id="profileSteps">0</strong><span>Steps</span></div><div><strong id="profileTime">0m</strong><span>Play time</span></div></div><h3 class="profile-section-label">YOUR DETAILS</h3><div class="profile-card">${row('profileUsername','user','Username')}${row('profileWeight','weight','Weight')}</div><h3 class="profile-section-label">YOUR INMOTION</h3><div class="profile-card">${row('profileActivity','stats','Your activity','See your progress')}${row('profileGuide','help','How to play','A quick guide to getting started')}${row('profileConnection','screen','Motion & connection','Connect your phone to your PC')}</div><button type="button" class="profile-play"><span><strong>Ready to move?</strong><small>Your next game is waiting.</small></span>${icons.chevron}</button><p class="profile-storage">Your profile and activity are saved on this phone.</p></div>`;
document.body.append(screen);
const $=id=>screen.querySelector('#'+id);
function render(){
  const p=app.profile,username=typeof p.username==='string'&&/^[a-zA-Z0-9_]{2,20}$/.test(p.username)?p.username:null;
  const weight=Number.isFinite(p.weightKg)&&p.weightKg>=30&&p.weightKg<=200?p.weightKg:null;
  $('profileName').textContent=username||'Your player profile';
  $('profileSubtitle').textContent=username?'Made for the way you move.':'Add your details to make it yours.';
  $('profileUsername').querySelector('small').textContent=username?'@'+username:'Choose your username';
  $('profileWeight').querySelector('small').textContent=weight?`${weight.toLocaleString(undefined,{maximumFractionDigits:1})} kg`:'Not set';
  const data=totals(app.sessions);
  $('profileGames').textContent=app.fmt(data.runs);$('profileSteps').textContent=app.fmt(data.steps);
  const minutes=Math.floor(data.seconds/60);
  $('profileTime').textContent=minutes<60?`${minutes}m`:`${Math.floor(minutes/60)}h ${minutes%60}m`;
  screen.querySelector('.profile-play small').textContent=data.runs?'Your next game is waiting.':'Your first game starts here.';
  screen.querySelector('.profile-storage').textContent=app.storageOK?'Your profile and activity are saved on this phone.':'Storage is unavailable. Changes may not survive a reload.';
}
function edit(step=0){
  const p=app.profile;
  if(typeof p.username!=='string'||!/^[a-zA-Z0-9_]{2,20}$/.test(p.username))step=0;
  else if(step===2&&!['male','female'].includes(p.sex))step=1;
  window.openBasicsStep(step,'profile');
}
screen.querySelector('.profile-edit').onclick=()=>edit();
screen.querySelector('.phone-back').onclick=()=>window.openActivity();
$('profileUsername').onclick=()=>edit(0);$('profileWeight').onclick=()=>edit(2);
$('profileActivity').onclick=()=>window.openActivity();
$('profileGuide').onclick=()=>window.openPhoneGuide({onDone:()=>window.openProfile()});
$('profileConnection').onclick=()=>window.openController();
screen.querySelector('.profile-play').onclick=()=>window.openController();
window.openProfile=()=>{render();app.show('profile',screen);};
for(const event of ['phone-profile','activity-change','storage-unavailable'])window.addEventListener(event,()=>{if(!screen.hidden)render();});
window.addEventListener('storage',e=>{if(e.key==='inmotion.basics.v1'&&!screen.hidden)render();});
