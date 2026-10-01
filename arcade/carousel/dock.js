// The dock, bottom right: two glass circles, each opening a small glass card.
//
//   controller  the training: "Train it on you" (no profile yet) or "Trained on
//               you · date" with Train again. Until a profile is saved it opens
//               by itself each time, just after the intro — the invitation —
//               and closes itself after 8 s unless they hover or tab into it.
//   TV          the address to type into the TV's browser (the server says
//               which one it could bind).
(() => {
    if (new URLSearchParams(location.search).get('controller') === '1') return;
    const dock = document.querySelector('#tv-dock');
    const pops = {
        train: { button: document.querySelector('#train-button'), pop: document.querySelector('#train-pop') },
        tv: { button: document.querySelector('#tv-button'), pop: document.querySelector('#tv-pop') },
    };

    // ---- what the controller card says: have we met this player?
    function profile() { try { const p = JSON.parse(localStorage.getItem('arcade.profile.v1') || 'null'); return p && p.v === 1 ? p : null; } catch { return null; } }
    function fillTrain() {
        const p = profile();
        const title = document.querySelector('#train-title'), note = document.querySelector('#train-note'), go = document.querySelector('#train-go');
        if (p) {
            const d = new Date(p.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
            title.textContent = `Trained on you · ${d}`;
            note.textContent = 'New shoes, looser pants, or someone else playing? Train again — it takes a minute.';
            go.textContent = 'Train again';
        } else {
            title.textContent = 'Train it on you';
            note.textContent = 'One minute, once: walk, run, stop, jump and squat. Every game then fits how you move.';
            go.textContent = 'Start training';
        }
    }

    // ---- the TV's address, asked once
    const url = document.querySelector('#tv-url');
    let known = false;
    async function where() {
        if (known) return;
        try {
            const w = await (await fetch('./where', { cache: 'no-store' })).json();
            url.textContent = w.tv || location.origin+'/';
            known = true;
        } catch { url.textContent = location.host; }
    }

    // ---- the invitation closes itself: 8 s (a line along its foot runs down), unless they reach for it
    const INVITE_MS = 8000;
    let hideTimer = null;
    function stopTimer() { clearTimeout(hideTimer); hideTimer = null; pops.train.pop.classList.remove('timed'); }
    function leave(name) {
        const x = pops[name]; if (x.pop.hidden) return;
        x.pop.classList.add('leaving');
        setTimeout(() => { x.pop.classList.remove('leaving', 'timed'); x.pop.hidden = true; x.button.setAttribute('aria-expanded', 'false'); }, 300);
    }
    function timed() {
        stopTimer();
        pops.train.pop.style.setProperty('--invite-ms', INVITE_MS + 'ms');
        pops.train.pop.classList.add('timed');
        hideTimer = setTimeout(() => leave('train'), INVITE_MS);
    }
    // hovering or tabbing into it means they are reading it: it stays until they click elsewhere
    for (const ev of ['pointerenter', 'focusin']) pops.train.pop.addEventListener(ev, stopTimer);

    function open(name) {
        stopTimer();
        for (const [k, x] of Object.entries(pops)) {
            const on = k === name && x.pop.hidden;
            x.pop.hidden = !on; x.button.setAttribute('aria-expanded', String(on));
        }
        if (name === 'tv' && !pops.tv.pop.hidden) where();
        if (name === 'train' && !pops.train.pop.hidden) fillTrain();
    }
    const closeAll = () => { for (const x of Object.values(pops)) { x.pop.hidden = true; x.button.setAttribute('aria-expanded', 'false'); } };
    pops.train.button.addEventListener('click', () => open('train'));
    pops.tv.button.addEventListener('click', () => open('tv'));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('#tv-dock')) closeAll(); });

    // ---- no profile saved yet: every time the carousel opens, once the intro has handed over (the dock
    // shows), the controller card opens by itself — until they train. With a profile it never does.
    if (!profile()) {
        const invite = () => setTimeout(() => { if (window.phoneGate?.ready && !profile() && pops.train.pop.hidden && pops.tv.pop.hidden) { open('train'); timed(); } }, 900);
        addEventListener('phone-gate-ready',invite,{once:true});
        if (dock.classList.contains('is-visible')) invite();
        else {
            const watch = new MutationObserver(() => { if (dock.classList.contains('is-visible')) { watch.disconnect(); invite(); } });
            watch.observe(dock, { attributes: true, attributeFilter: ['class'] });
        }
    }
})();
