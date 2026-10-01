// The top-right card: what one game of the game in front gives you — the same
// for every player. Same card, same design; the numbers ease across (ring, bar,
// counts) when the game changes instead of jumping.
//
//   ring (flame)   kcal for one game, 70 kg, from the games' own model
//                  (engine/calories.js: MET × 3.5 × kg / 200 per minute, plus
//                  0.23 kcal a jump, 0.32 a squat/slide)
//   % and bar      intensity: the game's average MET against a flat-out run (12)
//   loop icon      what you do in one game (levels, red lights, jumps, laps)
//   footprint      distance: subway = your legs' metres in a 10 min run
//                  (2.7 Hz jog ≈ 2.7 m/s); the maps = the course itself
//
//   subway     10 min jogging ~8.5 MET → 104 + ~20 jumps/slides   ≈ 110 kcal, ~7 levels, 1.6 km
//   red light  3 min clock, 57 % green at a jog, still on red      ≈  15 kcal, ~20 red lights, 60 m field
//   jump rope  2:30 clock running in place + ~40 jumps              ≈  25 kcal, 44 m platform to platform
//   track      3 laps ≈ 1.2 km at ~5 m/s ≈ 4 min + ~33 hurdles      ≈  45 kcal
(() => {
    if (new URLSearchParams(location.search).get('controller') === '1') return;
    const DATA = {
        subway:   { kcal: 110, intensity: 71, label: 'Intensity · 10 min run', count: 7,  unit: 'Levels',  dist: 1.6, distUnit: 'KM', dp: 1 },
        redlight: { kcal: 15,  intensity: 43, label: 'Intensity · 3 min game', count: 20, unit: 'Freezes', dist: 60,  distUnit: 'M',  dp: 0 },
        jumprope: { kcal: 25,  intensity: 58, label: 'Intensity · 2.5 min game', count: 40, unit: 'Jumps', dist: 44,  distUnit: 'M',  dp: 0 },
        track:    { kcal: 45,  intensity: 73, label: 'Intensity · 4 min race', count: 3,  unit: 'Laps',    dist: 1.2, distUnit: 'KM', dp: 1 }
    };
    const card = document.querySelector('#race-summary');
    const ringFill = card.querySelector('.race-ring-fill');
    const ringText = card.querySelector('.race-ring-label strong');
    const heading = card.querySelector('.race-heading > strong');
    const label = card.querySelector('.race-heading > span');
    const segments = card.querySelector('.race-segments');
    const [countEl, distEl] = card.querySelectorAll('.race-metrics > span > strong');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let shown = null, now = null, tick = 0;

    function paint(v, d) {
        ringFill.style.strokeDasharray = `${v.intensity} 100`;
        segments.style.background = `linear-gradient(90deg, #fff ${v.intensity}%, #ffffff24 ${v.intensity}%)`;
        ringText.textContent = String(Math.round(v.kcal));
        heading.firstChild.nodeValue = String(Math.round(v.intensity));
        countEl.firstChild.nodeValue = `${Math.round(v.count)} `;
        countEl.lastElementChild.textContent = d.unit;
        distEl.firstChild.nodeValue = `${v.dist.toFixed(d.dp)} `;
        distEl.lastElementChild.textContent = d.distUnit;
    }

    window.raceSummary = {
        show(key) {
            const d = DATA[key];
            if (!d || key === shown) return;
            shown = key;
            label.textContent = d.label;
            card.setAttribute('aria-label', `One game: about ${d.kcal} kcal, ${d.intensity} percent intensity, ${d.count} ${d.unit.toLowerCase()}, ${d.dist} ${d.distUnit === 'KM' ? 'kilometres' : 'metres'}`);
            // a unit change (KM ↔ M) would count through nonsense, so the distance starts from its new unit
            const end = { kcal: d.kcal, intensity: d.intensity, count: d.count, dist: d.dist };
            const start = now ? { ...now, dist: now.unit === d.distUnit ? now.dist : 0 } : end;
            cancelAnimationFrame(tick);
            if (reduced || !now) { now = { ...end, unit: d.distUnit }; paint(end, d); return; }
            const t0 = performance.now(), dur = 650;
            const step = t => {
                const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
                const v = {};
                for (const f of Object.keys(end)) v[f] = start[f] + (end[f] - start[f]) * e;
                now = { ...v, unit: d.distUnit };
                paint(v, d);
                if (k < 1) tick = requestAnimationFrame(step);
            };
            tick = requestAnimationFrame(step);
        }
    };
})();
