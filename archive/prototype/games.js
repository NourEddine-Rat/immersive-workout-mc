// The arcade's rooms.
//
// One list, read by the hub on the screen and by the chooser in your pocket,
// so the cards you look at and the buttons you press can never disagree about
// what exists or what is ready to play. A room that is not built yet says so
// in both places, from this one line.
//
// To add a room: give it an id, a name, what it asks of the body, and — when
// it is real — the page it opens. Nothing else in the hub needs touching.

export const GAMES = [
  {
    id: 'subway',
    name: 'SUBWAY',
    tag: 'Run the yard',
    asks: 'run · jump · slide',
    blurb: 'A train yard at full speed. Your legs are the throttle, the dog behind you is the deadline, and the lanes are the game’s to worry about.',
    minutes: '5–20 min',
    accent: '#5fd8e8',
    href: './index.html',
    ready: true,
  },
  {
    id: 'boxing',
    name: 'BOXING',
    tag: 'Three rounds',
    asks: 'punch · slip · guard',
    blurb: 'Combinations called on the screen and thrown with your hands. Keep the guard up between them — the bag hits back.',
    minutes: '3 × 3 min',
    accent: '#ff7a5e',
    href: null,
    ready: false,
  },
  {
    id: 'tumble',
    name: 'TUMBLE',
    tag: 'Last one standing',
    asks: 'jump · dodge · dive',
    blurb: 'A gauntlet of spinning arms and floors that give way. Fifty start the round, one finishes it, and standing still is not an option.',
    minutes: '2–6 min',
    accent: '#c58cff',
    href: null,
    ready: false,
  },
];

export const gameById = id => GAMES.find(g => g.id === id) || null;
