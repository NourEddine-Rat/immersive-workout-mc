// The opener introduces InMotion, then opens the quick-start guide.
(() => {
  const opener = document.getElementById('opener');
  const tip = document.getElementById('opTip');
  let tipTimer = null;
  const tracks = opener.querySelector('.tracks');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const syncMotion = () => {
    if (reducedMotion.matches) tracks.pauseAnimations();
    else tracks.unpauseAnimations();
  };
  syncMotion();
  reducedMotion.addEventListener('change', syncMotion);
  // each icon in the glass menu says what it is, for a moment
  for (const b of opener.querySelectorAll('.op-menu button')) {
    b.addEventListener('click', () => {
      if (b === opener.querySelector('.op-menu button')) { window.openActivity(); return; }
      if (b === opener.querySelectorAll('.op-menu button')[1]) { window.openController(); return; }
      tip.textContent = b.dataset.tip; tip.hidden = false;
      tip.style.animation = 'none'; void tip.offsetWidth; tip.style.animation = '';
      clearTimeout(tipTimer); tipTimer = setTimeout(() => { tip.hidden = true; }, 1800);
    });
  }
  document.getElementById('opGo').addEventListener('click', () => {
    window.openPhoneGuide();
  });
})();
