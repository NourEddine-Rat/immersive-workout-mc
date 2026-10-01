// The look of the place: one palette per hour, in one file, so the sky, the
// haze, the light and the lamps are changed together and stay a set.
//
// The game runs in DAYLIGHT. That is the game. But the same corridor at dusk
// — lamps lit, the track running into the sun — is worth seeing, so it comes
// round now and then (see `hourFor` in game.js: every fourth level) and goes
// again. A change of scene you are given, not a setting you have to find;
// `?hour=day` or `?hour=dusk` pins it for anyone who wants one or the other.
//
// An hour is only lights, fog and sky colours, so the change is instant and
// can be eased across a few seconds. What is baked into the textures at load
// has to work at every hour, so it is a shift of palette and not of light:
// the corridor's blue goes teal, its concrete warms, and the things the
// player has to read — striped barriers, signals, coins, the flame — are
// left exactly as they are.
//
// Everything here is a constant, one canvas pass at load, or a colour lerp
// while the hour turns. Nothing a weak screen has to keep up with.

import * as THREE from 'three';

/** Where the lamps sit. Baked into geometry at load, so it cannot change with the hour — only their brightness does. */
export const LAMP = { size: 2.9, height: 3.6, out: 6.5, pitch: 12.8 };

export const HOURS = {
  // Clear morning: a deep blue overhead, a pale horizon, a warm sun high
  // enough to light the floor of the corridor. The lamps are on but washed
  // out, the way a real lamp is in daylight.
  day: {
    sky: { low: 0xdfeeff, mid: 0x8cc4f0, high: 0x2d6cc2 },
    fog: { color: 0xcbe3f7, near: 70, far: 240, liteNear: 55, liteFar: 155 },
    hemi: { sky: 0xffffff, ground: 0x8d9a70, intensity: 1.45 },
    sun: { color: 0xfff3dd, intensity: 0.8, position: [3, 8, 2] },
    backdrop: { top: 0x5b7ea8, bottom: 0x141e2a },
    lamp: { color: 0xffd7a0, strength: 0.14 },
  },
  // The sun on the horizon, the corridor running into it. Teal against amber:
  // the cold half of the picture is the place, the warm half is what matters.
  dusk: {
    sky: { low: 0xffb066, mid: 0x8a4a7a, high: 0x1b2456 },
    fog: { color: 0xe0956a, near: 70, far: 230, liteNear: 55, liteFar: 150 },
    hemi: { sky: 0xb4c8ff, ground: 0x9a6038, intensity: 1.55 },
    sun: { color: 0xffc38a, intensity: 0.95, position: [2, 4, -9] },
    backdrop: { top: 0x4a3566, bottom: 0x140c1c },
    lamp: { color: 0xffb457, strength: 1 },
  },
};
export const DEFAULT_HOUR = 'day';
const TURN = 2.6;            // seconds for one hour to become the other

/**
 * The corridor's own palette, applied once per texture as it loads. Not an
 * hour — this has to look right at every hour:
 *
 *   blue    the walls and the rails      -> teal, the same brightness
 *   green   the trees on the banks       -> a touch cooler
 *   grey    the concrete and the ballast -> warmed
 *   warm    stripes, signs, lamps, coins -> left exactly as they are
 *
 * That last rule is why this is done by hand instead of with a hue filter
 * over everything: what the player has to read is all warm, and it must not
 * move an inch while the place around it changes.
 *
 * Rolling stock is done to its own recipe. A train is the one thing in here
 * that can end a run, so it must never sink into the wall behind it: it
 * keeps more of its colour and a little more light.
 *
 * @param tex  the loaded texture
 * @param size if set, the texture is resampled to this many pixels first (a weak screen)
 * @param mode 'place' for the corridor and its banks, 'train' for rolling stock
 */
const restyled = new WeakMap();
export function restyle(tex, size = 0, mode = 'place') {
  if (!tex) return tex;
  const hit = restyled.get(tex);                     // pieces share maps: do each one once
  if (hit && hit.size === size && hit.mode === mode) return hit.tex;
  const img = tex.image;
  if (!img || !img.width) return tex;
  const w = size && img.width > size ? size : img.width;
  const h = size && img.height > size ? size : img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  try {
    const d = g.getImageData(0, 0, w, h), p = d.data;
    const train = mode === 'train';
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], gr = p[i + 1], b = p[i + 2];
      const max = r > gr ? (r > b ? r : b) : (gr > b ? gr : b);
      const min = r < gr ? (r < b ? r : b) : (gr < b ? gr : b);
      const chroma = max - min;
      if (r === max && chroma > 24) continue;                     // warm: a stripe, a sign, a lamp — untouched
      if (b === max && chroma > 18) {                             // blue -> teal
        p[i] = train ? cap(r * 0.94) : r * 0.86;
        p[i + 1] = cap((gr + (b - gr) * (train ? 0.42 : 0.52)) * (train ? 1.06 : 1.00));
        p[i + 2] = train ? cap(b * 0.99) : b * 0.92;
      } else if (gr === max && chroma > 26) {                     // foliage -> a touch cooler
        p[i] = r * 0.92;
        p[i + 1] = gr * 0.95;
        p[i + 2] = b * 0.98 + 6;
      } else if (chroma <= 24) {                                  // concrete and ballast -> warmed
        p[i] = cap(r * (train ? 1.12 : 1.06) + (train ? 8 : 4));
        p[i + 1] = cap(gr * (train ? 1.05 : 1.00) + (train ? 5 : 0));
        p[i + 2] = b * (train ? 0.95 : 0.92);
      }
    }
    g.putImageData(d, 0, 0);
  } catch (e) { /* no pixel access (an old engine, a tainted canvas): the resize alone still stands */ }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = tex.colorSpace; t.flipY = tex.flipY; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  restyled.set(tex, { size, mode, tex: t });
  return t;
}
const cap = v => (v > 255 ? 255 : v);

// ------------------------------------------------------------- the hour

// What the current hour is being written into: made by light(), read every
// frame while an hour turns into the next.
const live = { scene: null, lite: false, hemi: null, sun: null, sky: null, listeners: [] };
let fromHour = DEFAULT_HOUR, toHour = DEFAULT_HOUR, turn = 1;   // turn: 0 at the start of the change, 1 when it is done

const mix = (a, b, t) => a + (b - a) * t;
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
const mixColor = (out, a, b, t) => out.lerpColors(_c1.set(a), _c2.set(b), t);

/** The palette right now: one hour, or a point between two of them. */
function blend(t) {
  const a = HOURS[fromHour], b = HOURS[toHour];
  return {
    sky: { low: mixColor(new THREE.Color(), a.sky.low, b.sky.low, t), mid: mixColor(new THREE.Color(), a.sky.mid, b.sky.mid, t), high: mixColor(new THREE.Color(), a.sky.high, b.sky.high, t) },
    fog: {
      color: mixColor(new THREE.Color(), a.fog.color, b.fog.color, t),
      near: mix(a.fog.near, b.fog.near, t), far: mix(a.fog.far, b.fog.far, t),
      liteNear: mix(a.fog.liteNear, b.fog.liteNear, t), liteFar: mix(a.fog.liteFar, b.fog.liteFar, t),
    },
    hemi: { sky: mixColor(new THREE.Color(), a.hemi.sky, b.hemi.sky, t), ground: mixColor(new THREE.Color(), a.hemi.ground, b.hemi.ground, t), intensity: mix(a.hemi.intensity, b.hemi.intensity, t) },
    sun: { color: mixColor(new THREE.Color(), a.sun.color, b.sun.color, t), intensity: mix(a.sun.intensity, b.sun.intensity, t), position: a.sun.position.map((v, i) => mix(v, b.sun.position[i], t)) },
    backdrop: { top: mixColor(new THREE.Color(), a.backdrop.top, b.backdrop.top, t), bottom: mixColor(new THREE.Color(), a.backdrop.bottom, b.backdrop.bottom, t) },
    lamp: { color: mixColor(new THREE.Color(), a.lamp.color, b.lamp.color, t), strength: mix(a.lamp.strength, b.lamp.strength, t) },
  };
}

/** Write a palette onto the scene. Everything here is a colour or a number: no object is rebuilt. */
function paint(p) {
  const s = live.scene;
  if (!s) return;
  s.background.copy(p.fog.color);
  s.fog.color.copy(p.fog.color);
  s.fog.near = live.lite ? p.fog.liteNear : p.fog.near;
  s.fog.far = live.lite ? p.fog.liteFar : p.fog.far;
  live.hemi.color.copy(p.hemi.sky); live.hemi.groundColor.copy(p.hemi.ground); live.hemi.intensity = p.hemi.intensity;
  if (live.sun) { live.sun.color.copy(p.sun.color); live.sun.intensity = p.sun.intensity; live.sun.position.set(...p.sun.position); }
  const u = live.sky.material.uniforms;
  u.low.value.copy(p.sky.low); u.mid.value.copy(p.sky.mid); u.high.value.copy(p.sky.high);
  for (const cb of live.listeners) cb(p);
}

/** Whoever else owns something that changes with the hour (world.js: the backdrop and the lamps) says so here. */
export function onHour(cb) { live.listeners.push(cb); if (live.scene) cb(blend(turn)); }

/** Turn to an hour. Instant before a run; otherwise it eases over a couple of seconds, as the light would. */
export function setHour(name, instant = false) {
  if (!HOURS[name] || name === toHour) return;
  fromHour = instant ? name : currentName();
  toHour = name;
  turn = instant ? 1 : 0;
  if (instant || !live.scene) paint(blend(1));
}
/** The hour now — the one being turned to once the change is more than half done. */
export function currentName() { return turn < 0.5 ? fromHour : toHour; }
export function isTurning() { return turn < 1; }

/** Called every frame: carries an hour into the next. Cheap, and does nothing at all when nothing is changing. */
export function updateHour(dt) {
  if (turn >= 1) return;
  turn = Math.min(1, turn + dt / TURN);
  const t = turn * turn * (3 - 2 * turn);            // ease, so the light does not slide at a constant rate
  paint(blend(t));
}

/** The sky: a ball painted with the three bands of the hour. Drawn behind everything, lit by nothing. */
export function makeSky(p) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { low: { value: p.sky.low.clone() }, mid: { value: p.sky.mid.clone() }, high: { value: p.sky.high.clone() } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'uniform vec3 low; uniform vec3 mid; uniform vec3 high; varying float h;',
      'void main(){',
      '  float k = smoothstep(-0.10, 0.60, h);',
      '  vec3 c = mix(low, mid, smoothstep(0.0, 0.40, k));',   // the band at the horizon
      '  c = mix(c, high, smoothstep(0.30, 1.0, k));',         // then up overhead
      '  gl_FragColor = vec4(c, 1.0);',
      '}',
    ].join('\n'),
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), m);
  sky.name = 'sky';
  return sky;
}

/**
 * The light, the haze and the sky, on a scene.
 * @param lite a weak screen: the fog is pulled in close and the sun is dropped
 * @param hour which hour to open on
 */
export function light(scene, lite = false, hour = DEFAULT_HOUR) {
  fromHour = toHour = HOURS[hour] ? hour : DEFAULT_HOUR;
  turn = 1;
  const p = blend(1);
  live.scene = scene; live.lite = lite;
  scene.background = p.fog.color.clone();
  scene.fog = new THREE.Fog(p.fog.color.getHex(), lite ? p.fog.liteNear : p.fog.near, lite ? p.fog.liteFar : p.fog.far);
  live.hemi = new THREE.HemisphereLight(p.hemi.sky.getHex(), p.hemi.ground.getHex(), p.hemi.intensity);
  scene.add(live.hemi);
  if (!lite) {
    live.sun = new THREE.DirectionalLight(p.sun.color.getHex(), p.sun.intensity);
    live.sun.position.set(...p.sun.position);
    scene.add(live.sun);
  }
  live.sky = makeSky(p);
  scene.add(live.sky);
  paint(p);
}

/** The hour asked for in the address bar, if any: ?hour=day / ?hour=dusk pins it for the whole session. */
export function pinnedHour() {
  try {
    const q = new URLSearchParams(location.search).get('hour');
    return HOURS[q] ? q : null;
  } catch { return null; }
}
