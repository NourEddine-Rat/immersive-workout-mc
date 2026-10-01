(() => {
  const $ = id => document.getElementById(id);
  const menu = [...document.querySelectorAll('.op-menu button')];
  const screen = document.createElement('section');
  screen.id = 'activity'; screen.className = 'activity'; screen.hidden = true;
  screen.setAttribute('aria-label', 'Activity stats');
  screen.innerHTML = `<div class="activity-inner">
    <header class="activity-head"><div><strong id="activityHeadline">Let’s get moving</strong><p id="activitySubtitle">Every move counts</p></div><button type="button" class="activity-badge" aria-label="Detailed Stats"><img class="detail-flame" src="./phone/flame-white.png" alt="" aria-hidden="true"><span>Details</span></button></header>
    <div class="activity-chart" role="img" aria-label="Activity chart"><span class="chart-axis-y">Steps</span><span class="chart-axis-x" id="chartAxisX">Day</span><span class="chart-calorie-label">Calories <i></i></span><div class="chart-calorie-scale" id="calorieScale"></div><div class="chart-scale" id="chartScale"></div><div class="chart-columns" id="chartColumns"></div><p class="chart-empty" id="chartEmpty" hidden>Play your first game.<br>Your activity starts here.</p></div>
    <div class="activity-sheet"><div class="sheet-top"><span class="sheet-brand">InMotion</span><div class="activity-periods" aria-label="Activity period"><button type="button" data-period="D" aria-label="Day" aria-pressed="true">D</button><button type="button" data-period="W" aria-label="Week" aria-pressed="false">W</button><button type="button" data-period="M" aria-label="Month" aria-pressed="false">M</button></div></div>
    <div class="activity-total" id="activitySteps">0</div><p class="activity-label">Steps</p>
    <div class="activity-metrics"><div><strong><span id="activityKm">0</span><small id="distanceUnit">km</small></strong><p>Distance</p></div><div><strong><span id="activityKcal">0</span><small>kcal</small></strong><p>Calories</p></div><div><strong id="activityRuns">0</strong><p>Games</p></div></div>
    <nav class="activity-nav" aria-label="Main navigation">${menu.map((b,i)=>`<button type="button" data-destination="${i}" aria-label="${['Stats','Play','Leaderboard','Profile'][i]}" ${i===0?'aria-current="page"':''}>${b.querySelector('svg').outerHTML}<span>${['Stats','Play','Leaderboard','Profile'][i]}</span></button>`).join('')}</nav></div></div><div class="activity-notice" id="activityNotice" role="status" hidden></div>`;
  document.body.append(screen);
  const app=window.PhoneApp;
  let period=['D','W','M'].includes(app.preferences.period)?app.preferences.period:'D';
  const emptyPrompt=document.createElement('dialog');
  emptyPrompt.className='stats-empty-dialog';
  emptyPrompt.setAttribute('aria-labelledby','statsEmptyTitle');
  emptyPrompt.setAttribute('aria-describedby','statsEmptyDescription');
  emptyPrompt.innerHTML=`<div class="stats-empty-icon" aria-hidden="true"><i></i></div><h2 id="statsEmptyTitle">No activity yet</h2><p id="statsEmptyDescription"></p><button class="stats-empty-play" type="button">Let’s play <span aria-hidden="true">→</span></button><button class="stats-empty-dismiss" type="button">Not now</button>`;
  document.body.append(emptyPrompt);
  let emptyDismissed=false;
  const hasActivity=d=>['steps','metres','kcal','seconds','runs','jumps','squats'].some(key=>d[key]>0);
  const dismissEmptyPrompt=()=>{emptyDismissed=true;emptyPrompt.close();};
  emptyPrompt.addEventListener('cancel',()=>{emptyDismissed=true;});
  emptyPrompt.querySelector('.stats-empty-dismiss').onclick=dismissEmptyPrompt;
  emptyPrompt.querySelector('.stats-empty-play').onclick=()=>{dismissEmptyPrompt();window.openController();};
  function syncEmptyPrompt(d){
    if(hasActivity(d)||screen.hidden){if(emptyPrompt.open)emptyPrompt.close();return;}
    $('statsEmptyDescription').textContent=app.sessions.length?`No activity recorded ${ {D:'today',W:'this week',M:'this month'}[period]}. Play a game to get things moving.`:'Play your first game to see your steps, calories and progress here.';
    // Let the Dev panel or setup guide close before showing another modal.
    queueMicrotask(()=>{
      if(!screen.hidden&&!emptyDismissed&&!hasActivity(app.summary(period))&&!document.querySelector('dialog[open]'))emptyPrompt.showModal();
    });
  }
  function render(next=period) {
    period=next;
    const rows=app.rows(period),d=app.summary(period),fmt=app.fmt;
    $('activitySteps').textContent=fmt(d.steps);
    $('activityKm').textContent=(d.metres/1000).toFixed(2);$('activityKcal').textContent=fmt(d.kcal);$('activityRuns').textContent=fmt(d.runs);
    $('activityHeadline').textContent=rows.length?`${fmt(d.steps)} steps`:'Your activity';
    $('activitySubtitle').textContent=rows.length?'Every move counts':'Ready for your first game';
    $('chartAxisX').textContent=period==='D'?'Hour':'Day';
    const count=period==='D'?8:period==='W'?7:new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();
    const values=Array(count).fill(0),calories=Array(count).fill(0);
    rows.forEach(row=>{const date=new Date(row.startedAt),i=period==='D'?Math.floor(date.getHours()/3):period==='W'?(date.getDay()+6)%7:date.getDate()-1;values[i]+=row.steps;calories[i]+=row.kcal;});
    const labels=period==='D'?['0','3','6','9','12','15','18','21']:period==='W'?['M','T','W','T','F','S','S']:values.map((_,i)=>i%5===0?String(i+1):'');
    const max=Math.max(100,Math.ceil(Math.max(...values)/100)*100),calorieMax=Math.max(10,Math.ceil(Math.max(...calories)/10)*10);
    $('chartScale').innerHTML=Array.from({length:5},(_,i)=>`<span>${Math.round(max*(4-i)/4)}</span>`).join('');
    $('chartColumns').style.gridTemplateColumns=`repeat(${count},1fr)`;
    $('chartColumns').innerHTML=values.map((v,i)=>`<div class="chart-column ${v&&v===Math.max(...values)?'is-selected':''}"><div class="chart-track"><div class="chart-bar" style="--height:${v/max*100}%"></div></div><span>${labels[i]}</span></div>`).join('');
    $('calorieScale').innerHTML=`<span>${calorieMax}</span><span>${calorieMax/2}</span><span>0 kcal</span>`;
    if(rows.length){const points=calories.map((v,i)=>`${(i+.5)*100/count},${100-v/calorieMax*92}`).join(' ');$('chartColumns').insertAdjacentHTML('beforeend',`<svg class="calorie-trend" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="#a8f5df" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`);}
    $('chartEmpty').hidden=rows.length>0;
    $('chartEmpty').innerHTML='A fresh start.<br>Play a game to fill your activity chart.';
    document.querySelector('.activity-chart').setAttribute('aria-label',rows.length?`${fmt(d.steps)} detected steps and ${fmt(d.kcal)} estimated calories. Activity grouped by session start time.`:'No activity in this period. All totals are zero.');
    document.querySelectorAll('[data-period]').forEach(b=>{b.disabled=false;b.setAttribute('aria-pressed',String(b.dataset.period===period));});
    syncEmptyPrompt(d);
  }
  render();window.addEventListener('activity-change',()=>render());
  const controller = document.querySelector('.page');
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'activity-back phone-back-label'; back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 5-7 7 7 7"/></svg><span>Stats</span>'; back.setAttribute('aria-label','Back to Stats');
  controller.prepend(back);
  window.openActivity = () => { app.show('stats',screen);render(); };
  back.onclick = window.openActivity;
  screen.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{app.preference('period',b.dataset.period);render(b.dataset.period);});
  screen.querySelectorAll('[data-destination]').forEach(b=>b.onclick=()=>{
    const dest=Number(b.dataset.destination);
    if(dest===0){window.openActivity();return;}
    if(dest===3){window.openProfile();return;}
    if(dest===1){window.openController();return;}
    if(dest===2)window.openLeaderboard();
  });
  // Navigation belongs to the app shell, outside each scrollable page.
  const nav=screen.querySelector('.activity-nav');nav.id='phoneNav';nav.hidden=true;
  document.body.append(nav,$('activityNotice'));
  window.addEventListener('phone-page',e=>{
    const page=e.detail;nav.hidden=page==='welcome';document.body.classList.toggle('phone-has-nav',!nav.hidden);
    if(page!=='stats'){if(emptyPrompt.open)emptyPrompt.close();emptyDismissed=false;}
    nav.dataset.theme=page==='stats'?'light':'dark';
    const current=page==='profile'?3:page==='controller'||page==='setup'?1:0;
    nav.querySelectorAll('[data-destination]').forEach(b=>{if(Number(b.dataset.destination)===current)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  });
  if(new URLSearchParams(location.search).get('screen')==='stats')window.openActivity();
})();
