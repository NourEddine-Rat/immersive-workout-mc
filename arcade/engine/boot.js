// Loaded before modules so startup/download failures always have a usable UI.
(function () {
  'use strict';
  if (window.boot && window.boot.__glassBoot) return;
  var root = document.documentElement;
  root.classList.add('boot-loading');
  var path = location.pathname;
  var training = path.indexOf('/training') !== -1;
  var kind = training ? 'training' : path.indexOf('/red-light') !== -1 ? 'redlight' : path.indexOf('/jump-rope') !== -1 ? 'jumprope' : path.indexOf('/track') !== -1 ? 'track' : 'subway';
  var name = training ? 'Training' : path.indexOf('/red-light') !== -1 ? 'Red Light, Green Light' : path.indexOf('/jump-rope') !== -1 ? 'Jump Rope' : path.indexOf('/track') !== -1 ? 'Track & Field' : 'Subway';
  var cover = training ? '' : path.indexOf('/red-light') !== -1 ? 'red-light-environment.webp' : path.indexOf('/jump-rope') !== -1 ? 'jump-rope-environment.webp' : path.indexOf('/track') !== -1 ? 'track-environment.webp' : 'subway-environment.webp';
  var layer, observer, timer, dismissal, lastProgress = Date.now(), remembered = new Map();
  var text = 'Preparing your ' + (training ? 'training' : 'game') + '…';
  var detail = 'Keep your phone connected. We’ll continue when everything is ready.';
  var phase = 'download', loaded = 0, total = 0, percent = null, failed = false, ready = false;
  function el(id) { return document.getElementById(id); }
  function setText(id, value) { var node = el(id); if (node && node.textContent !== value) node.textContent = value; }
  function log(event, data) { if (window.ConnectionDiagnostics) window.ConnectionDiagnostics.record(event, data || {}); }
  function blockChildren() {
    if (!document.body || ready) return;
    Array.from(document.body.children).forEach(function (node) {
      if (node === layer || /^(SCRIPT|STYLE|LINK)$/.test(node.tagName)) return;
      if (!remembered.has(node)) remembered.set(node, node.inert);
      node.inert = true;
    });
  }
  function paint() {
    if (!layer) return;
    layer.dataset.state = failed ? 'failed' : ready ? 'ready' : phase;
    layer.dataset.indeterminate = String(percent === null && !failed);
    setText('bootTitle', failed ? 'Let’s try loading again.' : ready ? 'Ready to move.' : name);
    setText('bootText', text);
    setText('bootDetail', detail);
    setText('bootPercent', failed ? 'Download paused' : phase === 'prepare' && !ready ? 'Preparing' : percent === null ? 'Downloading' : Math.floor(percent) + '%');
    var progress = el('bootProgress');
    if (percent === null) progress.removeAttribute('aria-valuenow');
    else progress.setAttribute('aria-valuenow', String(Math.floor(percent)));
    progress.setAttribute('aria-valuetext', phase === 'prepare' ? 'Downloads complete. Preparing the scene.' : percent === null ? detail : Math.floor(percent) + '% downloaded');
    el('bootBar').style.width = percent === null ? '32%' : percent + '%';
    el('bootRetry').hidden = !failed && Date.now() - lastProgress < 30000;
    el('bootHome').hidden = !failed;
    el('bootActions').hidden = el('bootRetry').hidden && el('bootHome').hidden;
    el('bootReport').hidden = !failed || !window.ConnectionDiagnostics;
    el('bootStepDownload').dataset.active = String(phase === 'download' && !failed);
    el('bootStepPrepare').dataset.active = String(phase === 'prepare' && !failed);
    el('bootStepReady').dataset.active = String(ready);
  }
  function mount() {
    if (layer || !document.body) return;
    layer = document.createElement('section'); layer.id = 'gameBoot'; layer.className = 'boot-layer';
    layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'bootTitle'); layer.setAttribute('aria-describedby', 'bootText');
    if (cover) layer.style.setProperty('--boot-cover', 'url("/carousel/' + cover + '")');
    layer.innerHTML = '<div class="boot-card"><p class="boot-eyebrow">IN MOTION <span>LOCAL PLAY</span></p><h1 id="bootTitle" tabindex="-1"></h1><p id="bootText" role="status" aria-live="polite"></p><div class="boot-progress-row"><span id="bootProgressLabel">Getting ready</span><span id="bootPercent"></span></div><div id="bootProgress" role="progressbar" aria-labelledby="bootProgressLabel" aria-valuemin="0" aria-valuemax="100"><div id="bootBar"></div></div><ol class="boot-steps" aria-label="Loading stages"><li id="bootStepDownload">Download</li><li id="bootStepPrepare">Prepare</li><li id="bootStepReady">Play</li></ol><p id="bootDetail"></p><div id="bootActions" hidden><button id="bootRetry" type="button">Try again</button><a id="bootHome" href="/">Back to games</a></div><button id="bootReport" type="button" hidden>Download error report</button></div>';
    document.body.appendChild(layer);
    el('bootRetry').onclick = function () { location.reload(); };
    el('bootReport').onclick = function () { window.ConnectionDiagnostics.download(); };
    blockChildren();
    observer = new MutationObserver(blockChildren);
    observer.observe(document.body, { childList: true });
    paint();
    if (!ready) el(failed ? 'bootRetry' : 'bootTitle').focus({ preventScroll: true });
    if (ready) finish();
  }
  function finish() {
    observer && observer.disconnect(); clearInterval(timer);
    root.classList.remove('boot-loading');
    remembered.forEach(function (inert, node) { if (node.isConnected) node.inert = inert; });
    remembered.clear();
    if (layer) {
      var dismissed = layer;
      layer.setAttribute('aria-hidden', 'true'); layer.inert = true;
      dismissal = setTimeout(function () { dismissed.remove(); }, 250);
    }
  }
  var boot = {
    __glassBoot: true, state: 'loading', ok: true,
    step: function (message) {
      if (failed || ready) return;
      lastProgress = Date.now(); text = String(message || 'Preparing the scene…');
      phase = /prepar|building|first frame|lighting/i.test(text) ? 'prepare' : 'download';
      if (phase === 'prepare') detail = 'Downloads complete. Preparing the scene and lighting.';
      paint();
    },
    progress: function (label, bytes, size, meta) {
      if (failed || ready) return;
      lastProgress = Date.now(); phase = 'download';
      loaded = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
      total = Number.isFinite(size) ? Math.max(0, size) : 0;
      percent = total > 0 ? Math.max(0, Math.min(100, 100 * loaded / total)) : null;
      text = 'Downloading ' + String(label || 'game assets').replace(/\.{3}$|…$/, '') + '…';
      var mb = function (n) { return (n / 1048576).toFixed(1) + ' MB'; };
      detail = total ? mb(loaded) + ' of ' + mb(total) : mb(loaded) + ' downloaded';
      if (meta && meta.resources) detail += ' · ' + meta.completed + ' of ' + meta.resources + ' files complete';
      paint();
    },
    fail: function (error, force) {
      if (failed || ready && !force) return;
      clearTimeout(dismissal);
      failed = true; ready = false; boot.state = 'failed'; boot.ok = false;
      window.__gameUp = false; root.classList.add('boot-loading');
      text = 'The ' + (training ? 'training room' : 'game') + ' could not finish loading.';
      detail = 'Check your internet connection, then try again. Your saved progress is kept.';
      var message = String(error && error.message || error || 'Loading failed');
      if (/WebGL|context|graphics/i.test(message)) detail = 'The browser could not prepare the graphics. Close unused tabs and try again, or enable hardware acceleration in your browser.';
      else if (/browser|importmap|module support/i.test(message)) detail = 'Open this page in a current Chrome, Safari or Edge browser, then try again.';
      var http = message.match(/HTTP (\d{3})/);
      var reason = http ? 'http-' + http[1] : /decode|texture|image/i.test(message) ? 'image-decode' : /timeout|too long|stopped responding/i.test(message) ? 'timeout' : /WebGL|context|graphics/i.test(message) ? 'graphics' : 'startup';
      log('asset-load-failed', { stage: phase, reason: reason, kind: kind, errorName: error && error.name || 'LoadError' });
      if (window.ConnectionDiagnostics) window.ConnectionDiagnostics.error('asset-load-failed', error instanceof Error ? error : new Error(message), { stage: phase });
      if (layer && !layer.isConnected) { layer = null; mount(); }
      if (layer) { layer.inert = false; layer.removeAttribute('aria-hidden'); }
      if (observer && document.body) observer.observe(document.body, { childList: true });
      blockChildren(); paint();
      if (layer) el('bootRetry').focus({ preventScroll: true });
    },
    done: function () {
      if (failed || ready) return false;
      ready = true; boot.state = 'ready'; phase = 'ready'; percent = 100;
      text = 'Everything is ready.'; detail = 'Your phone controls the game.';
      log('asset-load-ready', { stage: training ? 'training' : 'game', kind: kind });
      paint(); finish(); return true;
    },
    log: function (message) { if (window.console) console.debug(message); },
    check: function (name, pass, fix) { if (!pass) boot.fail(fix || name); },
    render: paint
  };
  window.boot = window.__boot = boot; window.__log = boot.log;
  window.__modern = 'noModule' in document.createElement('script') && !!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('importmap'));
  if (!window.__modern) boot.fail('This browser needs module support and importmap support.');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.addEventListener('error', function (event) {
    if (ready) return;
    if (event.target !== window) { if (event.target && event.target.tagName === 'SCRIPT') boot.fail('A required game module could not download.'); return; }
    boot.fail(event.error || event.message || 'The page could not start.');
  }, true);
  window.addEventListener('unhandledrejection', function (event) { if (!ready) boot.fail(event.reason); });
  document.addEventListener('webglcontextlost', function (event) { event.preventDefault(); boot.fail('The graphics context was lost.', true); }, true);
  window.addEventListener('keydown', function (event) {
    if (ready) return;
    if (!layer || !layer.contains(event.target)) event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) lastProgress = Date.now(); });
  timer = setInterval(function () {
    if (ready || failed || document.hidden) return;
    var idle = Date.now() - lastProgress;
    if (idle > 120000) boot.fail('Loading stopped responding.');
    else if (idle > 30000) { detail = 'This is taking longer than usual. You can keep waiting or try again.'; paint(); }
  }, 1000);
})();
