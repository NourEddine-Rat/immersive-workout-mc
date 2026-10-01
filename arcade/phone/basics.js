(() => {
  const KEY='inmotion.basics.v1',app=window.PhoneApp;
  const rawDraft=app.read('inmotion.basics.draft.v1',{});
  const draft=rawDraft&&typeof rawDraft==='object'?rawDraft:{};
  let saved=app.read(KEY,null);
  const valid=p=>p&&typeof p.username==='string'&&/^[a-zA-Z0-9_]{2,20}$/.test(p.username)&&Number.isFinite(p.weightKg)&&p.weightKg>=30&&p.weightKg<=200;
  if(!valid(saved))saved=null;
  const screen=document.createElement('section');screen.className='basics-screen';screen.hidden=true;screen.setAttribute('aria-label','Your basics');
  screen.innerHTML=`<form class="basics-inner" novalidate><header class="basics-head phone-page-head"><button type="button" class="basics-back phone-back" aria-label="Go back"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 5-7 7 7 7"/></svg></button><span>Basics</span><small id="basicsCount">1 of 3</small></header><div class="basics-progress" role="progressbar" aria-label="Setup progress" aria-valuemin="0" aria-valuemax="3" aria-valuenow="1"><i></i></div>
    <div class="basics-step" data-basics-step="0"><div class="basics-kicker">LET’S MAKE IT YOURS</div><h1>Make it yours.</h1><p>Choose a name for your games.</p><div class="basics-avatar" aria-hidden="true"><img src="./phone/profile/wireframe-profile.webp" alt="" width="468" height="780"></div><label for="basicsName">Username</label><div class="basics-name-wrap"><span>@</span><input id="basicsName" name="username" type="text" autocomplete="nickname" autocapitalize="none" spellcheck="false" maxlength="20" placeholder="your_name" aria-describedby="basicsNameHint basicsError"></div><small class="basics-help" id="basicsNameHint">2–20 letters, numbers or underscores.</small></div>
    <div class="basics-step" data-basics-step="1" hidden><div class="basics-kicker">A LITTLE ABOUT YOU</div><h1>What’s your sex?</h1><p>Personalize the body illustrations in your profile.</p><fieldset class="basics-sex"><legend class="sr">Sex</legend><label><input type="radio" name="sex" value="male"><span><strong>Male</strong></span></label><label><input type="radio" name="sex" value="female"><span><strong>Female</strong></span></label></fieldset></div>
    <div class="basics-step" data-basics-step="2" hidden><div class="basics-kicker">YOUR WEIGHT</div><h1>What’s your weight?</h1><p>Choose a preset or enter your exact weight.</p><div class="basics-weight-grid" role="group" aria-label="Weight presets in kilograms">${[40,50,60,65,70,75,80,90,100].map((v,index)=>`<button type="button" data-weight="${v}" aria-pressed="false"><img src="./phone/weight-shapes/shape-${index+1}.webp" alt="" aria-hidden="true" width="270" height="226"><span>${v}<small>kg</small></span><i aria-hidden="true">✓</i></button>`).join('')}</div><label for="basicsWeight">Your exact weight <span>kg</span></label><input id="basicsWeight" name="weight" type="number" inputmode="decimal" min="30" max="200" step="0.1" placeholder="e.g. 70.5" aria-describedby="basicsWeightHint basicsError"><small class="basics-help" id="basicsWeightHint">Enter any weight between 30 and 200 kg.</small></div>
    <footer class="basics-footer"><p id="basicsError" role="alert"></p><button type="submit" class="basics-next"><span class="basics-next-label">Next</span></button><p class="basics-local">Saved on this phone.</p></footer></form>`;
  document.body.append(screen);
  const form=screen.querySelector('form'),name=screen.querySelector('#basicsName'),weight=screen.querySelector('#basicsWeight'),error=screen.querySelector('#basicsError');let step=0,fromStats=false,returnPage='stats';
  let sex=['male','female'].includes(saved?.sex||draft.sex)?(saved?.sex||draft.sex):null;
  name.value=draft.username||'';weight.value=draft.weightKg||'';
  function saveDraft(){if(app.preview)return;app.save('inmotion.basics.draft.v1',{username:name.value,weightKg:weight.value,sex,step});}
  form.addEventListener('input',saveDraft);form.addEventListener('change',saveDraft);
  function syncSex(){
    screen.querySelectorAll('input[name=sex]').forEach(r=>r.checked=r.value===sex);
    screen.querySelectorAll('.basics-weight-grid img').forEach((img,index)=>{img.src=`./phone/weight-shapes/${sex==='male'?'male/':''}shape-${index+1}.webp`;});
  }
  screen.querySelectorAll('input[name=sex]').forEach(r=>r.addEventListener('change',()=>{sex=r.value;syncSex();error.textContent='';}));
  function showStep(n){step=n;screen.querySelectorAll('[data-basics-step]').forEach(s=>s.hidden=Number(s.dataset.basicsStep)!==n);screen.querySelector('#basicsCount').textContent=`${n+1} of 3`;screen.querySelector('.basics-progress').setAttribute('aria-valuenow',String(n+1));screen.querySelector('.basics-progress i').style.width=`${(n+1)/3*100}%`;screen.querySelector('.basics-next-label').textContent=n===2?(returnPage==='profile'?'Save changes':'Let’s play'):'Next';error.textContent='';screen.scrollTop=0;saveDraft();}
  function syncWeight(){screen.querySelectorAll('[data-weight]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.weight)===Number(weight.value))));weight.removeAttribute('aria-invalid');error.textContent='';}
  screen.querySelectorAll('[data-weight]').forEach(b=>b.onclick=()=>{weight.value=b.dataset.weight;syncWeight();saveDraft();});weight.addEventListener('input',syncWeight);name.addEventListener('input',()=>{name.removeAttribute('aria-invalid');error.textContent='';});
  window.openBasics=(edit=false,returnTo='stats')=>{
    returnPage=returnTo;
    if(saved&&['male','female'].includes(saved.sex)&&!edit){window.openController();return;}
    fromStats=edit;document.getElementById('opener').hidden=true;document.getElementById('activity').hidden=true;document.querySelector('.page').hidden=true;
    if(!app.preview){const currentDraft=app.read('inmotion.basics.draft.v1',{});name.value=saved?.username||currentDraft.username||'';weight.value=saved?.weightKg||currentDraft.weightKg||'';sex=saved?.sex||currentDraft.sex||null;}
    const resumeStep=/^[a-zA-Z0-9_]{2,20}$/.test(name.value)?(sex?Math.min(2,Math.max(0,Number(draft.step)||0)):1):0;
    syncWeight();syncSex();showStep(edit?0:resumeStep);app.show('setup',screen);
    screen.querySelector('.basics-local').textContent=app.storageOK?'Saved on this phone.':'Available until you close or reload this page.';
  };
  window.openBasicsStep=(n,returnTo='stats')=>{window.openBasics(true,returnTo);showStep(Math.max(0,Math.min(2,n)));};
  screen.querySelector('.basics-back').onclick=()=>{if(step){showStep(step-1);return;}screen.hidden=true;if(fromStats){if(returnPage==='profile')window.openProfile();else window.openActivity();}else{const op=document.getElementById('opener');op.classList.remove('leaving');app.show('welcome',op);}};
  form.addEventListener('submit',e=>{
    e.preventDefault();
    if(!step){name.value=name.value.trim();if(!/^[a-zA-Z0-9_]{2,20}$/.test(name.value)){error.textContent='Use 2–20 letters, numbers or underscores.';name.setAttribute('aria-invalid','true');name.focus();return;}showStep(1);return;}
    if(step===1){if(!sex){error.textContent='Choose Male or Female to continue.';screen.querySelector('input[name=sex]').focus();return;}syncSex();showStep(2);return;}
    const kg=Number(weight.value);if(!weight.value||!Number.isFinite(kg)||kg<30||kg>200){error.textContent='Enter a weight between 30 and 200 kg.';weight.setAttribute('aria-invalid','true');weight.focus();return;}
    const profile={v:1,sex,username:name.value.trim(),weightKg:Math.round(kg*10)/10,updatedAt:new Date().toISOString()};
    if(app.preview){if(returnPage==='profile')window.openProfile();else window.openActivity();return;}
    app.save(KEY,profile);
    saved=profile;app.save('inmotion.basics.draft.v1',{});window.dispatchEvent(new CustomEvent('phone-profile'));screen.hidden=true;if(returnPage==='profile')window.openProfile();else window.openController();
  });
})();
