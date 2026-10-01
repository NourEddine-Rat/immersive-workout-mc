// The Dev panel: every screen of a game, one click each, without a phone —
// for working on the look. The same panel (and the same glass) in every game
// and in the training, so a redesign has one place to look.
//
//   devPanel({ screens, pocket, onOpen, settle })
//     screens  [{ group, name, show }]  show() puts the game into that moment,
//              using the game's own functions (so the preview IS the real UI)
//     pocket   the game's PocketSource: the panel can fake the phone's link
//              (Live / Weak / Off) so the HUD's phone card and any "phone
//              lost" behaviour can be seen without a phone
//     onOpen   the game's own dev mode (keyboard play, no phone needed)
//     settle   called after each screen: stop cards from pressing themselves
//
// A "Dev" pill bottom right opens it; ?dev=1 also does. ← / → step through
// the screens while it is open. "Leave dev" reloads without it.

const CSS = `
.xdev { position: fixed; z-index: 2147483000; right: max(18px, env(safe-area-inset-right)); bottom: max(18px, env(safe-area-inset-bottom));
  display: flex; flex-direction: column; align-items: flex-end; gap: 10px; font-family: Inter, -apple-system, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; color: #fff; text-shadow: none; letter-spacing: normal; }
.xdev * { box-sizing: border-box; }
.xdev-glass { border: 1px solid #ffffff70; background: linear-gradient(145deg, rgba(231, 242, 243, .40), rgba(176, 198, 201, .25));
  box-shadow: inset 0 1px 0 #ffffff80, 0 12px 36px #07181f38; backdrop-filter: blur(14px) saturate(.85); -webkit-backdrop-filter: blur(14px) saturate(.85); }
.xdev-toggle { color: #fff; font: 600 11px Inter, -apple-system, system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase;
  padding: 9px 15px; border-radius: 999px; cursor: pointer; }
.xdev-toggle[aria-expanded="true"] { color: #0d1a20; background: linear-gradient(180deg, #fff, #e8eff1); }
.xdev-panel { width: 280px; max-height: calc(100vh - 110px); overflow: auto; padding: 14px; border-radius: 20px;
  display: flex; flex-direction: column; gap: 9px; background-color: rgba(10, 16, 20, .35); }
.xdev-panel[hidden] { display: none; }
.xdev-title { font-size: 10px; font-weight: 600; letter-spacing: .18em; text-transform: uppercase; color: rgba(255, 255, 255, .6); margin-top: 2px; }
.xdev-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.xdev-seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
.xdev button.xdev-b { font: 500 12px Inter, -apple-system, system-ui, sans-serif; color: #fff; text-align: left; cursor: pointer; line-height: 1.25;
  padding: 8px 10px; border-radius: 10px; border: 1px solid transparent; background: rgba(255, 255, 255, .09); text-transform: none; letter-spacing: 0; box-shadow: none; }
.xdev .xdev-seg button.xdev-b { text-align: center; padding: 8px 4px; }
.xdev button.xdev-b:hover { background: rgba(255, 255, 255, .18); }
.xdev button.xdev-b[aria-pressed="true"] { color: #0d1a20; background: linear-gradient(180deg, #fff, #e8eff1); }
.xdev-hint { font-size: 11px; color: rgba(255, 255, 255, .6); }
.xdev button.xdev-exit { text-align: center; border-color: #ffffff40; background: none; }
`;

export function devPanel({ screens, pocket = null, onOpen = () => {}, settle = () => {} }) {
  if (!document.getElementById('xdev-css')) {
    const st = document.createElement('style'); st.id = 'xdev-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const root = document.createElement('div'); root.className = 'xdev';
  const groups = [];
  for (const [i, s] of screens.entries()) {
    let g = groups.find(x => x.name === (s.group || 'Screens'));
    if (!g) groups.push(g = { name: s.group || 'Screens', items: [] });
    g.items.push([i, s]);
  }
  root.innerHTML = `
    <div class="xdev-panel xdev-glass" hidden>
      ${groups.map(g => `<span class="xdev-title">${g.name}</span><div class="xdev-grid">${g.items.map(([i, s]) => `<button type="button" class="xdev-b" data-i="${i}">${s.name}</button>`).join('')}</div>`).join('')}
      ${pocket ? `<span class="xdev-title">Phone</span><div class="xdev-seg">
        ${['real', 'live', 'weak', 'off'].map(m => `<button type="button" class="xdev-b" data-phone="${m}" aria-pressed="${m === 'real'}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>` : ''}
      <span class="xdev-hint">← → next screen · no phone needed</span>
      <button type="button" class="xdev-b xdev-exit">Leave dev</button>
    </div>
    <button type="button" class="xdev-toggle xdev-glass" aria-expanded="false">Dev</button>`;
  document.body.appendChild(root);
  const panel = root.querySelector('.xdev-panel'), toggle = root.querySelector('.xdev-toggle');
  // the panel's clicks and keys are the panel's: the game must not see them as play
  for (const ev of ['keydown', 'keyup', 'pointerdown', 'mousedown', 'touchstart']) root.addEventListener(ev, e => e.stopPropagation());

  let opened = false, cur = -1, phone = 'real';
  async function show(i) {
    window.__devPreview = true;        // from here on this page is a preview: games record no stats and no bests
    cur = (i + screens.length) % screens.length;
    root.querySelectorAll('[data-i]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.i === cur)));
    try { await screens[cur].show(); } catch (e) { console.warn('dev screen', screens[cur].name, e); }
    settle();
  }
  function open() {
    if (!opened) { opened = true; onOpen(); }
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
  }
  toggle.onclick = () => { if (panel.hidden) open(); else { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); } };
  root.querySelectorAll('[data-i]').forEach(b => b.onclick = () => show(+b.dataset.i));
  root.querySelector('.xdev-exit').onclick = () => {
    const q = new URLSearchParams(location.search); q.delete('dev');
    location.href = location.pathname + (q.toString() ? '?' + q : '');
  };
  addEventListener('keydown', e => {
    if (panel.hidden || e.target.closest?.('input, textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); show(cur + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); show(cur - 1); }
  }, true);

  // ---- the phone's link, faked: a jog-shaped stream for Live, gaps for Weak, silence for Off
  if (pocket) {
    root.querySelectorAll('[data-phone]').forEach(b => b.onclick = () => {
      phone = b.dataset.phone;
      root.querySelectorAll('[data-phone]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    const G = 9.80665, t0 = performance.now();
    (function feed() {
      requestAnimationFrame(feed);
      if (phone === 'real') return;
      const pnow = performance.timeOrigin + performance.now(), el = (performance.now() - t0) / 1000;
      if (phone === 'off') { pocket.lastSampleAt = 1; return; }        // long gone (but once seen: "phone lost", not "never connected")
      const mag = 1 + 1.1 * Math.pow(Math.max(0, Math.sin(el * Math.PI * 2.7)), 6) - 0.25 * Math.max(0, Math.sin(el * Math.PI * 2.7 + 1.4));
      pocket.samples.push({ t: pnow, a: [0, 0, G * mag], g: [0, 0, G], w: [0, 0, 0] });
      if (pocket.samples.length > 600) pocket.samples.shift();
      pocket.lastSampleAt = phone === 'weak' ? pnow - 800 : pnow;
    })();
  }

  if (new URLSearchParams(location.search).get('dev') === '1') open();
  return { open, show };
}
