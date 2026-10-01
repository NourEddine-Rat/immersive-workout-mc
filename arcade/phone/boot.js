// Import in dependency order so a partial download cannot leave a half-working controller.
const loader=document.getElementById('phoneBoot'),message=document.getElementById('phoneBootMessage'),retry=document.getElementById('phoneBootRetry');
function failed(text){loader.dataset.state='error';message.textContent=text;retry.hidden=false;}
retry.onclick=()=>location.reload();
const timeout=setTimeout(()=>failed('Loading is taking longer than expected. Check your connection, then retry.'),25000);
try{
  for(const file of ['store','stats','details','basics','live-screen','controller','guide','profile','leaderboard','opener'])await import(`./${file}.js`);
  await import('../phone.js');
  await import('./app.js');
  for(const link of document.querySelectorAll('link[rel=stylesheet]')){
    if(new URL(link.href).origin===location.origin&&!link.sheet)throw Error('A stylesheet did not load.');
  }
  if(!window.PhoneApp||!window.PhoneMotion||!window.openController)throw Error('Controller startup failed.');
  clearTimeout(timeout);
  document.documentElement.classList.remove('phone-booting');loader.remove();
  dispatchEvent(new Event('phone-app-ready'));
}catch(error){
  clearTimeout(timeout);console.error('Phone startup:',error);
  failed('The controller could not finish loading. Check your connection and tap Retry.');
}
