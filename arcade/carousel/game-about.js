(() => {
    const base = new URL('.', document.currentScript.src);
    const gameRoutes = {
        subway: '../games/subway/',
        redlight: '../games/squid/red-light/',
        jumprope: '../games/squid/jump-rope/',
        track: '../games/squid/track/'
    };
    // The script is loaded before the dialog markup; initialize once parsing finishes.
    function init() {
        const dialog = document.querySelector('#game-about');
        const copy = document.querySelector('#about-description');
        const original = copy.innerHTML;
        const logos = dialog.querySelector('.about-logos');
        const originalLogos = logos.innerHTML;
        const kicker = document.querySelector('#about-kicker');
        const label = document.querySelector('#about-countdown-label');
        const toggle = document.querySelector('#about-timer-toggle');
        const fill = document.querySelector('#about-timer-fill');
        let remaining = 3000, last = 0, tick = 0, paused = false, previousFocus, destination = null, trainFirst = false, squid = false;
        const squidCopy = '<p>Inspired by the Red Light, Green Light and Jump Rope challenges in <strong>Squid Game</strong>.</p><p>Original series production: <strong>Siren Pictures Inc.</strong></p><p>This is an independent adaptation, not affiliated with or endorsed by the original creators.</p>';
        const pages = {
            credits: '<p>Gameplay inspiration: Subway Surfers and Temple Run.</p><p>Subway Surfers and the SYBO logo reference the original game and studio.</p><p>3D asset creators are credited inside each game.</p>',
            legal: '<p>This is an independent project. It is not affiliated with or endorsed by any referenced titles, studios, or rights holders.</p><p>Referenced names, logos, and trademarks belong to their respective owners.</p><p>Some visual themes are influenced by popular survival-game media.</p>'
        };
        function paint() {
            const n = Math.max(1, Math.ceil(remaining / 1000));
            label.textContent = paused ? 'Auto-advance paused' : trainFirst ? `Quick training first · ${n}s` : `Continuing in ${n}s`;
            toggle.textContent = paused ? 'Resume' : 'Pause';
            fill.style.transform = `scaleX(${Math.min(1, Math.max(0, 1 - remaining / 3000))})`;
        }
        function frame(now) {
            if (!dialog.open) return;
            if (!paused && !document.hidden) remaining -= now - last;
            last = now;
            if (remaining <= 0) {
                const next = destination;
                dialog.close();
                if (next) location.assign(next);
                return;
            }
            paint(); tick = requestAnimationFrame(frame);
        }
        window.gameAbout = { open(item) {
            if (dialog.open) return;
            // Resolve from the selected game's identity, including cards created by
            // earlier carousel versions that did not carry an href.
            const route = gameRoutes[item.environment];
            if (!route) return;
            // No profile yet: the one-minute training first, then straight on to this game.
            const game = new URL(route, base);
            let trained = false;
            try { const p = JSON.parse(localStorage.getItem('arcade.profile.v1') || 'null'); trained = !!(p && p.v === 1); } catch {}
            trainFirst = !trained;
            destination = trained ? game.href : new URL(`/training/?next=${encodeURIComponent(game.pathname)}`, location.href).href;
            // Track & Field goes straight to its game (or first-time training).
            if (item.environment === 'track') { location.assign(destination); return; }
            previousFocus = document.activeElement;
            document.querySelector('#about-title').textContent = item.environment === 'subway' ? 'ENDLESS RUNNER' : item.label.toUpperCase();
            dialog.dataset.game = item.environment;
            squid = ['redlight', 'jumprope'].includes(item.environment);
            logos.innerHTML = squid ? `<img src="${new URL('credits-squid-game.svg', base).href}" alt="Squid Game" width="142" height="74"><span aria-hidden="true"></span><img src="${new URL('credits-siren.webp', base).href}" alt="The Siren Group Inc. — supplied credit logo" width="146" height="64">` : originalLogos;
            copy.innerHTML = squid ? squidCopy : original; kicker.textContent = 'ABOUT';
            dialog.querySelectorAll('[data-about-page]').forEach(button => button.setAttribute('aria-pressed', 'false'));
            remaining = 3000; paused = false; paint();
            dialog.showModal(); last = performance.now(); tick = requestAnimationFrame(frame);
        } };
        toggle.addEventListener('click', () => { paused = !paused; paint(); });
        dialog.querySelectorAll('[data-about-page]').forEach(button => button.addEventListener('click', () => {
            paused = true;
            const page = button.dataset.aboutPage;
            copy.innerHTML = page === 'credits' && squid ? '<p>Challenge inspiration: <strong>Squid Game</strong>.</p><p>Series created by Hwang Dong-hyuk and produced by <strong>Siren Pictures Inc.</strong></p><p>Referenced names and logos belong to their respective owners. 3D asset creators are credited inside each game.</p>' : pages[page]; kicker.textContent = page.toUpperCase();
            dialog.querySelectorAll('[data-about-page]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
            paint();
        }));
        document.querySelector('#about-close').addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => { destination = null; cancelAnimationFrame(tick); previousFocus?.focus({preventScroll:true}); });
        document.addEventListener('visibilitychange', () => { last = performance.now(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
