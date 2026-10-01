// What the arcade remembers about you between runs.
//
// The profile (profile.js) is how you move — the bars the game reads you by.
// This is what you have done with it: the metres your legs actually covered,
// the calories behind them, the jumps and the squats. It is the reason the
// hub has something true to put on the screen, and the reason a good run is
// worth something once it is over.
//
// Kept in this browser, like the profile. Nothing leaves the machine.

const KEY = 'arcade.stats.v1';
const EMPTY = { v: 1, runs: 0, metres: 0, kcal: 0, coins: 0, jumps: 0, squats: 0, seconds: 0, bestMetres: 0, bestKcal: 0, last: 0, byGame: {} };

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && s.v === 1 ? { ...EMPTY, ...s, byGame: { ...s.byGame } } : { ...EMPTY };
  } catch { return { ...EMPTY }; }
}

/**
 * Fold one finished run into the totals.
 * @param game a games.js id
 * @param run  { metres, kcal, coins, jumps, squats, seconds }
 */
export function record(game, run) {
  const s = load();
  const one = s.byGame[game] || (s.byGame[game] = { runs: 0, metres: 0, kcal: 0, seconds: 0, bestMetres: 0 });
  const add = (k, v) => { s[k] += v || 0; if (one[k] != null) one[k] += v || 0; };
  s.runs++; one.runs++;
  add('metres', run.metres); add('kcal', run.kcal); add('coins', run.coins);
  add('jumps', run.jumps); add('squats', run.squats); add('seconds', run.seconds);
  s.bestMetres = Math.max(s.bestMetres, run.metres || 0);
  s.bestKcal = Math.max(s.bestKcal, run.kcal || 0);
  one.bestMetres = Math.max(one.bestMetres, run.metres || 0);
  s.last = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  return s;
}

export function clear() { try { localStorage.removeItem(KEY); } catch {} }

/** The totals as short strings, the way the hub and the phone both want them. */
export function pretty(s = load()) {
  const km = s.metres / 1000;
  return {
    runs: String(s.runs),
    distance: km >= 1 ? km.toFixed(1) + ' km' : Math.round(s.metres) + ' m',
    kcal: Math.round(s.kcal) + ' kcal',
    minutes: Math.round(s.seconds / 60) + ' min',
    best: Math.round(s.bestMetres) + ' m',
    moves: String(s.jumps + s.squats),
  };
}
