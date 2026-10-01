(() => {
  const app=window.PhoneApp,fmt=app.fmt,duration=app.duration;
  const names={calories:'Calories',steps:'Steps',distance:'Distance',time:'Play time',games:'Games',jumps:'Jumps',squats:'Squats',sensors:'Sensor quality'};
  const gameNames={subway:'Subway',track:'Track & Field',redlight:'Red Light Green Light',jumprope:'Jump Rope'};
  let sensors={},selected='calories',viewer,loading;
  const sensorHistory=[];
  const root=document.createElement('section');root.className='statistics-screen';root.hidden=true;root.setAttribute('aria-label','Statistics');
  root.innerHTML=`<div class="statistics-inner"><header class="statistics-head phone-page-head"><button class="statistics-back phone-back" type="button" aria-label="Back to Stats"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 5-7 7 7 7"/></svg></button><h1>Statistics</h1><p id="statisticsPeriod">Today</p></header><div class="statistics-list">${Object.entries(names).map(([id,name])=>`<button class="stat-tile" type="button" data-stat="${id}"><span class="stat-tile-title">${name}<span aria-hidden="true">›</span></span><svg class="stat-spark" viewBox="0 0 360 90" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="spark-fill-${id}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".17"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><polygon class="stat-spark-area" fill="url(#spark-fill-${id})"/><polyline fill="none" stroke="#ffffffbb" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" points="0,82 360,82"/><circle class="stat-spark-end" r="2.5" fill="#eee"/></svg><span class="stat-tile-value">0</span><span class="stat-tile-caption">Your activity starts with a game</span></button>`).join('')}</div></div>`;
  const detail=document.createElement('section');detail.className='metric-screen';detail.hidden=true;detail.setAttribute('aria-label','Activity detail');
  detail.innerHTML=`<div class="metric-inner"><header class="metric-head phone-page-head"><button class="metric-back phone-back" type="button" aria-label="Back to Statistics"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 5-7 7 7 7"/></svg></button><h1 id="metricTitle"></h1><span class="metric-period">Today</span></header><p class="metric-preview"></p><div class="body-stage" role="img" aria-label="Decorative human movement model"><div class="body-halo"></div><div id="bodyCanvas"></div><p class="body-loading">Loading movement model…</p></div><div class="metric-hero"><strong id="metricValue"></strong><p id="metricLabel"></p></div><div class="metric-summary"><div><span>PLAY TIME</span><b id="metricTime">0m</b></div><div><span>GAMES</span><b id="metricGames">0</b></div><div><span>EST. CALORIES</span><b id="metricCalories">0</b></div></div><div class="metric-rows" id="metricRows"></div><div id="metricExtra"></div><p class="metric-note" id="metricNote"></p></div>`;
  document.body.append(root,detail);
  const el=id=>detail.querySelector('#'+id);
  const row=(label,value)=>{const d=document.createElement('div'),s=document.createElement('span'),b=document.createElement('b');s.textContent=label;b.textContent=value;d.append(s,b);return d;};
  function values(d){return {calories:`${fmt(d.kcal)} kcal`,steps:fmt(d.steps),distance:`${(d.metres/1000).toFixed(2)} km`,time:duration(d.seconds),games:fmt(d.runs),jumps:fmt(d.jumps),squats:fmt(d.squats),sensors:sensors.status==='ready'?`${sensors.rate} Hz`:'Waiting'};}
  function trends(rows,period){
    const now=new Date();
    // Future time buckets are not zero activity; stop the trend at the present.
    const count=period==='D'?Math.floor(now.getHours()/3)+1:period==='W'?(now.getDay()+6)%7+1:now.getDate();
    const fields={calories:'kcal',steps:'steps',distance:'metres',time:'seconds',jumps:'jumps',squats:'squats'};
    const series=Object.fromEntries(Object.keys(names).map(key=>[key,Array(count).fill(0)]));
    for(const session of rows){
      const date=new Date(session.startedAt),index=period==='D'?Math.floor(date.getHours()/3):period==='W'?(date.getDay()+6)%7:date.getDate()-1;
      for(const [key,field] of Object.entries(fields))series[key][index]+=session[field]||0;
      if(session.complete)series.games[index]++;
    }
    series.sensors=app.preview?[]:sensorHistory;
    return series;
  }
  function sparkPoints(values){
    if(!values.length||!values.some(value=>value>0))return '0,82 360,82';
    const max=Math.max(...values),points=values.length===1?[values[0],values[0]]:values;
    return points.map((value,index)=>`${(index*360/(points.length-1)).toFixed(1)},${(82-value/max*68).toFixed(1)}`).join(' ');
  }
  function render(){
    const period=app.preferences.period||'D',d=app.summary(period),rows=app.rows(period),v=values(d),label={D:'Today',W:'This week',M:'This month'}[period];
    root.querySelector('#statisticsPeriod').textContent=(app.preview?'PREVIEW · ':'')+label;
    const series=trends(rows,period);
    root.querySelectorAll('[data-stat]').forEach(b=>{
      const key=b.dataset.stat;
      b.querySelector('.stat-tile-value').textContent=v[key];
      b.querySelector('.stat-tile-caption').textContent=key==='sensors'?(app.preview||!sensorHistory.length?'Waiting for motion samples':'Live sample rate · recent readings'):rows.length?`${label} · ${d.runs} completed games`:'Ready for your first game';
      const points=sparkPoints(series[key]),empty=!series[key].some(value=>value>0);
      b.querySelector('.stat-spark polyline').setAttribute('points',points);
      b.querySelector('.stat-spark-area').setAttribute('points',`0,90 ${points} 360,90`);
      const [x,y]=points.split(' ').at(-1).split(',');
      const end=b.querySelector('.stat-spark-end');end.setAttribute('cx',x);end.setAttribute('cy',y);
      b.querySelector('.stat-spark').classList.toggle('is-empty',empty);
    });
    el('metricTitle').textContent=names[selected];el('metricValue').textContent=v[selected];el('metricLabel').textContent=names[selected].toUpperCase();detail.querySelector('.metric-period').textContent=label;
    detail.querySelector('.metric-preview').textContent=app.preview?'PREVIEW · NOT SAVED':rows.length?'SYNCED FROM YOUR GAMES':'A FRESH START · NO ACTIVITY YET';
    el('metricTime').textContent=duration(d.seconds);el('metricGames').textContent=fmt(d.runs);el('metricCalories').textContent=fmt(d.kcal);
    const perGame=Object.entries(gameNames).map(([key,name])=>[name,rows.filter(r=>r.game===key)]);
    const fields={
      calories:[['Estimated total',`${d.kcal.toFixed(1)} kcal`],['Active energy',`${d.active.toFixed(1)} kcal`],['Standing energy',`${Math.max(0,d.kcal-d.active).toFixed(1)} kcal`],['Current weight',`${app.profile.weightKg||70} kg${app.profile.weightKg?'':' · default'}`]],
      steps:[['Detected steps',fmt(d.steps)],['Games with activity',fmt(rows.length)]],
      distance:perGame.map(([name,r])=>[name,`${(r.reduce((s,x)=>s+x.metres,0)/1000).toFixed(2)} km`]),
      time:[['Total play time',duration(d.seconds)],['Completed games',fmt(d.runs)],['Longest session',duration(Math.max(0,...rows.map(r=>r.seconds)))]],
      games:perGame.map(([name,r])=>[name,`${r.filter(x=>x.complete).length} played · ${r.filter(x=>x.outcome==='Winner').length} wins`]),
      jumps:[['Detected jumps',fmt(d.jumps)]],squats:[['Detected squats / slides',fmt(d.squats)]],
      sensors:[['Motion',sensors.status||'Not enabled'],['Sample rate',sensors.rate?`${sensors.rate} Hz`:'Waiting for samples'],['Round-trip latency',sensors.rtt?`${sensors.rtt} ms`:'Waiting for PC'],['Samples sent',fmt(sensors.sent)],['Screen awake',sensors.wake||'Not active'],['Gravity mode',sensors.gravity||'Waiting']]
    };
    el('metricRows').replaceChildren(...fields[selected].map(([a,b])=>row(a,b)));
    el('metricExtra').replaceChildren();
    if(selected==='games')for(const session of [...rows].reverse().slice(0,30)){
      const card=document.createElement('details');card.className='metric-disclosure';const summary=document.createElement('summary');summary.textContent=`${gameNames[session.game]} · ${new Date(session.startedAt).toLocaleDateString()} · ${session.complete?session.outcome||'Finished':'In progress / unfinished'}`;card.append(summary,row('Play time',duration(session.seconds)),row('Distance',`${Math.round(session.metres)} m`),row('Estimated calories',`${session.kcal.toFixed(1)} kcal`),row('Detected steps',fmt(session.steps)),row('Jumps / squats',`${session.jumps} / ${session.squats}`));el('metricExtra').append(card);
    }
    el('metricNote').textContent=selected==='sensors'?'Live readings from this phone. Motion requires a supported phone browser and permission.':selected==='calories'?'Calories are estimates based on cadence, duration and body weight, plus jumps and squats. No heart rate is measured.':selected==='distance'?'Distance follows the game’s stride model; it is not GPS distance.':selected==='steps'?'Steps come from the PC motion detector during gameplay. Activity is grouped by the local date when each game started.':'Finished games and activity in progress are saved on this phone. Interrupted games keep their last synced activity without counting as completed games.';
  }
  window.openStatistics=()=>{app.show('statistics',root);viewer?.stop();render();};
  window.openMetric=async(id)=>{
    if(!names[id])return;selected=id;app.show('metric:'+id,detail);render();
    try{loading ||= import('./body-view.js').then(m=>m.createBodyView(document.getElementById('bodyCanvas')));viewer=await loading;detail.querySelector('.body-loading').hidden=true;if(!detail.hidden)viewer.start();}catch{loading=null;detail.querySelector('.body-loading').textContent='Your movement, in numbers below';}
  };
  document.querySelector('.activity-badge').onclick=window.openStatistics;
  root.querySelector('.statistics-back').onclick=window.openActivity;
  detail.querySelector('.metric-back').onclick=window.openStatistics;
  root.querySelectorAll('[data-stat]').forEach(b=>b.onclick=()=>window.openMetric(b.dataset.stat));
  window.addEventListener('activity-change',render);window.addEventListener('phone-sensors',e=>{sensors=e.detail;if(!app.preview){sensorHistory.push(sensors.status==='ready'&&Number.isFinite(sensors.rate)?Math.max(0,sensors.rate):0);if(sensorHistory.length>30)sensorHistory.shift();}if(!root.hidden||!detail.hidden)render();});window.addEventListener('phone-page',()=>{if(detail.hidden)viewer?.stop();});render();
})();
