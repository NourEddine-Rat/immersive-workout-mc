(() => {
    if (new URLSearchParams(location.search).get('controller') === '1') return;
    const overlay = document.querySelector('#intro');
    const video = document.querySelector('#intro-video');
    const frame = document.querySelector('.frame');
    const bar = document.querySelector('#intro-progress');
    const percent = document.querySelector('#intro-percent');
    const skip = document.querySelector('#intro-skip');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let sceneReady = false, leaving = false, shown = 0, handoffFrame = 0, playbackStarted = false;
    frame.inert = true;
    let entranceStarted = false, widgetsShown = false, widgetsSettled = false, overlayGone = false, presented = false, failed = false;
    function present() {
        if (presented || failed || !sceneReady || !widgetsSettled || !overlayGone) return;
        presented = true;
        window.dispatchEvent(new Event('gallery-presented'));
    }
    function showPhoneCard() {
        if (widgetsShown) return;
        widgetsShown = true;
        document.querySelector('#phone-status')?.classList.add('is-visible');
        document.querySelector('#race-summary')?.classList.add('is-visible');
        document.querySelector('#tv-dock')?.classList.add('is-visible');
        // The longest widget fade is 650 ms + 240 ms delay. Let it settle and be seen.
        setTimeout(() => { widgetsSettled = true; present(); }, reduced ? 200 : 1400);
    }
    function startEntrance() {
        if (entranceStarted || reduced) return;
        entranceStarted = true;
        const vignette = document.createElement('div');
        vignette.className = 'intro-entrance';
        vignette.setAttribute('aria-hidden', 'true');
        document.body.appendChild(vignette);
        const completeEntrance = () => { vignette.remove(); showPhoneCard(); };
        vignette.addEventListener('animationend', completeEntrance, { once: true });
        // Also clean up if animation events are suppressed by a hidden tab.
        setTimeout(completeEntrance, 2100);
    }

    function progress(value) {
        if (leaving || sceneReady) return;
        shown = Math.max(shown, Math.min(99, Math.round(value * 100)));
        bar.style.setProperty('--progress', shown / 100);
        bar.setAttribute('aria-valuenow', shown);
        percent.textContent = `${shown}%`;
    }
    function finish() {
        if (leaving) return;
        leaving = true;
        clearTimeout(fallback);
        cancelAnimationFrame(handoffFrame);
        overlay.style.removeProperty('opacity');
        overlay.classList.remove('is-blending');
        overlay.classList.add('is-leaving');
        frame.inert = !failed;
        if (overlay.contains(document.activeElement)) document.querySelector('#stage').focus({ preventScroll: true });
        setTimeout(() => {
            video.pause();
            overlay.remove(); overlayGone = true;
            if (!entranceStarted) showPhoneCard();
            present();
        }, reduced ? 0 : 280);
    }
    let lastIntroRender = -Infinity;
    function shouldRender(now) {
        if (!playbackStarted || !overlay.isConnected) return true;
        // The prepared scene stays on screen; cap its six render passes during video playback.
        if (now - lastIntroRender < 1000 / 30 - 1) return false;
        lastIntroRender = now;
        return true;
    }
    function watchHandoff() {
        if (leaving) return;
        // Launch one compositor fade while the clip is moving, rather than
        // writing opacity from JavaScript on every frame of the 3D render loop.
        if (Number.isFinite(video.duration) && video.currentTime >= video.duration - .295) {
            startEntrance();
            finish();
            return;
        }
        handoffFrame = requestAnimationFrame(watchHandoff);
    }
    function ready() {
        if (sceneReady) return;
        progress(1);
        sceneReady = true;
        bar.style.setProperty('--progress', 1);
        bar.setAttribute('aria-valuenow', '100');
        percent.textContent = '100%';
        if (leaving) present(); else startPlayback();
    }
    function startPlayback() {
        if (!sceneReady || leaving || playbackStarted) return;
        if (reduced) { finish(); return; }
        // Buffer the short clip before showing it, so neither loading phase holds a still.
        if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return;
        playbackStarted = true;
        video.muted = true;
        video.play().then(watchHandoff).catch(finish);
    }
    video.addEventListener('canplaythrough', startPlayback);
    video.addEventListener('playing', () => {
        if (!leaving) overlay.classList.add('is-revealing');
    });
    function fail() {
        failed = true; finish(); frame.inert = false;
        window.dispatchEvent(new Event('gallery-unavailable'));
    }
    window.galleryIntro = { progress, ready, finish, shouldRender, fail, get presented() { return presented; }, get failed() { return failed; } };
    const fallback = setTimeout(finish, 15000);
    // This edit ends on the close-up glasses, before the baked-in site screenshot.
    video.addEventListener('ended', finish);
    video.addEventListener('error', finish);
    skip.addEventListener('click', finish);
})();
