const GUIDE_VIDEO_URL = './phone/media/how-to-play.mp4';
const app = window.PhoneApp;
const guide = document.createElement('dialog');
guide.className = 'phone-guide';
guide.setAttribute('aria-labelledby', 'phoneGuideTitle');
guide.innerHTML = `
  <header class="guide-topbar"><span class="guide-handle" aria-hidden="true"></span></header>
  <div class="guide-scroll">
    <div class="guide-media">
      <img class="guide-video-backdrop" src="./phone/media/how-to-play.jpg" alt="" aria-hidden="true">
      <video class="guide-video" muted loop playsinline preload="metadata" poster="./phone/media/how-to-play.jpg" aria-label="Movement gameplay demonstration"></video>
      <button class="guide-play-pause" type="button" aria-label="Play video" data-playing="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="guide-play-symbol" d="M8 5.5v13l11-6.5Z"/><path class="guide-pause-symbol" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg><span>Play</span></button>
      <div class="guide-video-error" role="status" hidden><p>The video couldn’t load.</p><button type="button">Try again</button></div>
    </div>
    <div class="guide-content">
      <h2 id="phoneGuideTitle">How to play</h2>
      <p class="guide-intro">Three steps. Then you’re in.</p>
      <ol class="guide-steps">
        <li><span class="guide-icon" aria-hidden="true"><img src="./phone/guide-icons/phone-desktop.svg" alt=""></span><div><h3>Connect your PC</h3><p>Open InMotion on your PC. Use the same Wi-Fi, then scan its QR code or enter its code.</p></div></li>
        <li><span class="guide-icon" aria-hidden="true"><img src="./phone/guide-icons/motion.png" alt=""></span><div><h3>Switch on motion</h3><p>Allow motion when asked. Swipe on your phone to choose a game on the PC.</p></div></li>
        <li><span class="guide-icon" aria-hidden="true"><img src="./phone/guide-icons/pocket.png" alt=""></span><div><h3>In your pocket. In the game.</h3><p>Start playing, then put your unlocked phone in your right front pocket. Run, jump and squat to move.</p></div></li>
      </ol>
    </div>
  </div>
  <footer class="guide-footer"><button class="guide-continue" type="button">Let’s play <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></footer>`;
document.body.append(guide);
const video = guide.querySelector('video');
const videoError = guide.querySelector('.guide-video-error');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
video.src = GUIDE_VIDEO_URL;
const playbackButton = guide.querySelector('.guide-play-pause');
const syncPlayback = () => {
  const playing = !video.paused && !video.ended;
  playbackButton.dataset.playing = String(playing);
  playbackButton.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
  playbackButton.querySelector('span').textContent = playing ? 'Pause' : 'Play';
  playbackButton.disabled = !!video.error;
};
const playVideo = () => video.play().catch(syncPlayback);
playbackButton.onclick = () => { if (video.paused) playVideo(); else video.pause(); };
for (const event of ['play', 'pause', 'ended', 'emptied', 'error']) video.addEventListener(event, syncPlayback);
// Keep playback muted and inline, with only the custom play/pause control.
const startVideo = () => {
  if (guide.open && !reducedMotion.matches && !video.error) playVideo();
};
video.addEventListener('error', () => { videoError.hidden = false; });
video.addEventListener('loadeddata', () => { videoError.hidden = true; });
videoError.querySelector('button').onclick = () => { videoError.hidden = true; video.load(); playVideo(); };
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) video.pause(); });
let guideOnDone=null;
window.openPhoneGuide = (options={}) => {
  if (guide.open) return;
  guideOnDone=options.onDone||null;
  guide.querySelector('.guide-continue').firstChild.textContent=guideOnDone?'Done ':'Let’s play ';
  if(!guideOnDone){const welcome=document.getElementById('opener');welcome.classList.remove('leaving');app.show('welcome',welcome);}
  guide.showModal();
  guide.querySelector('.guide-scroll').scrollTop = 0;
  video.muted = true;
  startVideo();
};
const closeGuide = () => { video.pause(); guide.close(); };
guide.addEventListener('cancel', () => video.pause());
guide.addEventListener('close', () => video.pause());
guide.querySelector('.guide-continue').onclick = () => {
  closeGuide();
  app.preference('guideSeen', true);
  if(guideOnDone){const done=guideOnDone;guideOnDone=null;done();}else window.openBasics();
};
window.addEventListener('phone-page', () => { if (guide.open) closeGuide(); });
