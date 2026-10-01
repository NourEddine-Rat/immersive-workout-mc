// Keep a useful recovery action when 3D support or a critical download fails.
(() => {
  const remote=new URLSearchParams(location.search).get('controller')==='1';
  let notice;
  function fail(message){
    if(remote){parent.postMessage({t:'carousel-error'},location.origin);return;}
    window.galleryIntro?.fail();
    if(!notice){
      notice=document.createElement('aside');notice.className='gallery-recovery';notice.setAttribute('role','alert');
      notice.innerHTML='<h2>Let’s get your screen ready</h2><p></p><button type="button">Reload gallery</button>';
      notice.querySelector('button').onclick=()=>location.reload();document.querySelector('.frame').append(notice);
    }
    notice.querySelector('p').textContent=message;
  }
  window.galleryRecovery={fail};
  addEventListener('error',event=>{
    if(event.target instanceof HTMLScriptElement)fail('Part of the gallery could not load. Check your connection and reload.');
  },true);
})();
