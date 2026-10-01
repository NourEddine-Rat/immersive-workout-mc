import { hostBridge } from './host-bridge.js';
// The phone in your pocket, seen from the game.
//
// Receives the direct local stream, turns the sample stream into three things — jump,
// slide, and how your legs are going — and nothing else. Lanes are the
// game's own. The detectors are the generic ones from the test rig, with a
// player's profile laid over them once one exists.

import { Detectors, GENERIC } from './lib/detect.js';
import { baselineFrom, makeFrame } from './lib/frame.js';
import { ClockSync, unpackSample } from './lib/protocol.js';

const now = () => (performance.timeOrigin || (Date.now() - performance.now())) + performance.now();   // old engines have no timeOrigin

/** Deep-merge a profile's overrides onto the generic thresholds. */
export function mergeCfg(base, over) {
  const out = {};
  for (const k of Object.keys(base)) out[k] = { ...base[k], ...(over && over[k] ? over[k] : {}) };
  return out;
}

/** The chart: how long a span it shows, and how many columns it is drawn in. */
const WINDOW = 1800, COLS = 76;

export class PocketSource {
  constructor() {
    this.connected = false;         // the direct local connection
    this.streaming = false;         // samples arriving
    this.samples = [];              // the last few seconds, for the warm-up and for the card's line
    this.queue = [];                // events waiting for the game
    this.clock = new ClockSync();
    this.pings = new Map(); this.pingSeq = 0;
    this.D = null; this.frame = null; this.baseline = null;
    this.cfg = GENERIC;
    this.lastSampleAt = 0;
    this.info = {};
    this.onEvent = null;            // (event) => void, for the profiler
    this.onPhoneSays = null;        // (message) => void, for whoever wants the phone's own words
    this.onSample = null;           // (sample, last) => void
  }

  start() {
    if(this.started)return;this.started=true;this.stopped=false;
    this._connect(); this.pingTimer=setInterval(() => this._ping(), 250);
    addEventListener('pagehide',()=>{this.stopped=true;this.offMessages?.();this.offConnection?.();});
    addEventListener('pageshow',e=>{if(e.persisted){this.stopped=false;this._connect();}});
  }

  // ----------------------------------------------------------------- link

  _connect() {
    if(this.stopped)return;
    this.offMessages?.();this.offConnection?.();
    this.offConnection=hostBridge.onConnection(state=>{
      this.connected=state.direct;
      if(!state.direct){this.streaming=false;this.queue=[];this.lastSampleAt=0;this.lastRawTime=0;}
    });
    this.offMessages=hostBridge.onMessage(m=>{
      if (m.t === 'samples') { if(hostBridge.active && m.clientId===hostBridge.clientId && Array.isArray(m.rows)) this._samples(m.rows); return; }
      if(m.t==='phone-profile'&&m.clientId!==this.info.clientId){this.info.clientId=m.clientId;this.clock=new ClockSync();this.lastRawTime=0;this.samples=[];this.queue=[];}
      if (m.t === 'phone-release' || (m.t==='phone-presence'&&m.motion!=='ready')) {this.streaming=false;this.lastSampleAt=1;this.queue=[];return;}
      // Match replies to this page’s clock-sync requests.
      if (m.t === 'pong') { const t0 = this.pings.get(m.seq); if (t0 != null && m.t0 === t0) { this.pings.delete(m.seq); this.clock.add(t0, now(), m.tp); this._send({t:'rtt',ms:this.clock.rtt}); } return; }
      if (m.t === 'hello' || m.t === 'ready') { this.info = { ...this.info, ...m }; this._send({ t: 'mode', mode: 'play' }); }
      if (this.onPhoneSays) this.onPhoneSays(m);      // the hub listens here: the phone can pick the room it wants
    });
  }
  /** Say something to the phone. Anything a page sends goes to it and to nothing else. */
  send(o) { this._send(o); }
  _send(o) { if(this.connected&&hostBridge.active)hostBridge.send(o); }
  _ping() { if (!this.connected) return; const t0 = now(); this.pings.set(this.pingSeq, t0); this._send({ t: 'ping', seq: this.pingSeq++, t0 }); if (this.pings.size > 40) this.pings.delete(this.pings.keys().next().value); }
  say(text) { this._send({ t: 'say', text }); }

  /** Samples are arriving: 'live' (fresh), 'stalled' (a Wi-Fi hiccup, under 1.5 s), or lost. */
  get link() { const age = now() - this.lastSampleAt; return !this.connected||!hostBridge.active?'lost':age < 400 ? 'live' : age < 1500 ? 'stalled' : 'lost'; }
  get live() { return this.link !== 'lost'; }
  get rttMs() { return this.clock.rtt; }

  _samples(rows) {
    for (const r of rows) {
      if(!Array.isArray(r)||r.length!==10||!r.every(Number.isFinite))continue;
      if(this.lastRawTime && r[0]<=this.lastRawTime)continue;
      const gap=this.lastRawTime && r[0]-this.lastRawTime>1500;
      this.lastRawTime=r[0];
      if(gap){this.samples=[];this.queue=[];if(this.frame)this.applyCfg(this.cfg);}
      const s = unpackSample(r); s.t = this.clock.toConsole(s.t);
      if(this.clock.ready&&(now()-s.t>750||s.t-now()>1000))continue;
      this.samples.push(s); if (this.samples.length > 600) this.samples.shift();
      this.lastSampleAt = now();
      if (this.D) {
        for (const e of this.D.push(s)) {
          if (e.kind === 'left' || e.kind === 'right' || /^lean/.test(e.kind)) continue;
          if (e.kind === 'step') hostBridge.step();
          if (this.onEvent) this.onEvent(e);
          // the body is already this far into the move: a jump is called as the feet leave the floor,
          // so only the link's delay; a slide is called after its hold, so that too
          const lead = Math.max(0, (now() - s.t) / 1000);
          if (e.kind === 'jump') this.queue.push({ action: 'UP', at: s.t, v: e.takeoffV, lead });
          else if (e.kind === 'slide') this.queue.push({ action: 'DOWN', at: s.t, deg: e.depthDeg, lead: Math.max(0, (now() - e.at) / 1000) });
        }
        if (this.onSample) this.onSample(s, this.D.last);
      }
    }
    if (!this.streaming) { this.streaming = true; this._send({ t: 'mode', mode: 'play' }); }
  }

  // -------------------------------------------------------------- warm-up

  /** Two seconds of standing still give `down`. Resolves true when it has it. */
  async warmUp(onWait) {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let still = [], quiet=false;
    for (let tries = 0; tries < 60; tries++) {
      await wait(250);
      still = this.samples.filter(s => s.t >= now() - 2000);
      // quiet = nearly every sample slow and none violent; a single fidget must not restart the clock
      const w = still.map(s => Math.hypot(...s.w)).sort((a, b) => a - b);
      quiet = still.length >= 30 && still.at(-1).t-still[0].t>=1500 && w[Math.floor(w.length * 0.9)] < 45 && w[w.length - 1] < 150;
      if (quiet) break;
      if (onWait) onWait(tries, still.length);
    }
    if (!quiet) return false;
    this.baseline = baselineFrom(still.map(s => s.g));
    this.frame = makeFrame(this.baseline, null);
    this.applyCfg(this.cfg);
    return true;
  }

  /** (Re)build the detectors with these thresholds, keeping the frame. */
  applyCfg(cfg) {
    this.cfg = cfg;
    if (this.frame) this.D = new Detectors(this.frame, cfg);
    this.queue = [];
  }

  // ----------------------------------------------------------------- poll

  /** What the game reads every frame. */
  poll() {
    const events = this.queue; this.queue = [];
    const D = this.D;
    return {
      events,
      ready: !!D,
      live: this.live,
      running: !!(D && D.running),
      steady: !!(D && D.steady),
      cadenceHz: D ? D.cadenceHz : 0,
      v: D && D.last ? D.last.v : 0,
      tilt: D && D.last ? D.last.total : 0,
      aG: D && D.last ? D.last.aG : 1,
      wDps: D && D.last ? D.last.wDps : 0,
    };
  }

  /**
   * The link card: one word for the link, and a moving chart of what the
   * phone is feeling. No numbers, no names of moves — nothing to read while
   * you are trying to move.
   *
   * The chart is the real motion, and the trick that keeps it smooth is that
   * it is sampled by the CLOCK, not by the packet. Plotting "the newest 120
   * samples" means the line jumps by however many packets happened to land
   * between two frames — and Wi-Fi does not deliver evenly, so the line
   * lurches even though the phone is moving steadily. Here each column of the
   * chart owns a fixed moment in time and takes whichever sample sits nearest
   * it, so the line always scrolls at exactly one card-width per WINDOW
   * milliseconds. Bursts and gaps in the link change nothing about the speed
   * it travels; they only change the shape, which is the honest part.
   *
   * Drawn the cheap way, since it sits on top of a 3D game: no canvas shadows
   * (a software blur pass, dearer than all the rest of this put together),
   * the gradient built once, one path walked three times.
   */
  drawPanel(canvas, { glass = false, label = true } = {}) {
    const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    const link = this.link;
    const tone = link === 'live' ? '#5fd8e8' : link === 'stalled' ? '#ffc24d' : '#ff6b5e';
    const word = link === 'live' ? 'CONNECTED' : link === 'stalled' ? 'WEAK LINK' : 'NO LINK';

    // the state: a dot and one word, small, along the top. On a glass card
    // (subway) there is no dot and the word is frosted white, not coloured.
    const pad = W * 0.055, r = W * 0.018, ty = H * 0.19;
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.font = `700 ${Math.round(H * 0.155)}px ui-monospace, Menlo, monospace`;
    if (!label) {
      // no word: a card next to this one already says whether the phone is there (the training)
    } else if (glass) {
      c.fillStyle = this._frost || (this._frost = (() => {
        const g = c.createLinearGradient(0, ty - H * 0.09, 0, ty + H * 0.09);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(1, 'rgba(214,232,238,0.62)');
        return g;
      })());
      c.fillText(word, pad, ty + 1);
    } else {
      c.beginPath(); c.arc(pad + r, ty, r, 0, Math.PI * 2); c.fillStyle = tone; c.fill();
      c.fillStyle = link === 'live' ? 'rgba(223,246,250,0.92)' : tone;
      c.fillText(word, pad + r * 3.4, ty + 1);
    }

    const x0 = pad, x1 = W - pad, top = label ? H * 0.36 : H * 0.14, bot = label ? H * 0.92 : H * 0.86, mid = (top + bot) / 2, half = (bot - top) / 2;
    c.lineWidth = Math.max(1, H * 0.008); c.strokeStyle = 'rgba(255,255,255,0.10)';
    c.beginPath(); c.moveTo(x0, mid); c.lineTo(x1, mid); c.stroke();

    const src = this.samples;
    if ((glass || !label) && (link === 'lost' || src.length < 2)) return;   // nothing coming in: just the quiet baseline
    if (link === 'lost' || src.length < 2) {            // nothing coming in: a flat, broken line
      c.strokeStyle = link === 'lost' ? 'rgba(255,107,94,0.5)' : 'rgba(255,255,255,0.18)';
      c.lineWidth = Math.max(1.5, H * 0.016);
      c.setLineDash([W * 0.028, W * 0.028]);
      c.beginPath(); c.moveTo(x0, mid); c.lineTo(x1, mid); c.stroke();
      c.setLineDash([]);
      return;
    }

    // One pass back through the samples: each column takes the newest sample
    // at or before its own moment. The value is how far that sample is from
    // lying still, in g — raw, not a detector's opinion, so a footfall is a
    // spike and standing still is a flat line.
    const tNow = now(), step = (x1 - x0) / (COLS - 1);
    let j = src.length - 1;
    const line = new Path2D();
    for (let i = COLS - 1; i >= 0; i--) {
      const when = tNow - (COLS - 1 - i) * (WINDOW / (COLS - 1));
      while (j > 0 && src[j].t > when) j--;
      const a = src[j].a;
      const v = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) / 9.80665 - 1;
      const y = mid - Math.max(-1, Math.min(1, v / 1.2)) * half;   // ±1.2 g fills the card
      if (i === COLS - 1) { line.moveTo(x1, y); this._headY = y; } else line.lineTo(x0 + i * step, y);
    }
    const wash = new Path2D(line);
    wash.lineTo(x0, bot); wash.lineTo(x1, bot); wash.closePath();
    c.fillStyle = this._wash || (this._wash = (() => {
      const g = c.createLinearGradient(0, top, 0, bot);
      g.addColorStop(0, 'rgba(95,216,232,0.24)');
      g.addColorStop(1, 'rgba(95,216,232,0)');
      return g;
    })());
    c.fill(wash);
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = link === 'live' ? 'rgba(95,216,232,0.20)' : 'rgba(255,194,77,0.20)';
    c.lineWidth = Math.max(3, H * 0.055); c.stroke(line);      // a wide, faint pass: the glow, without a blur
    c.strokeStyle = tone; c.lineWidth = Math.max(1.5, H * 0.018); c.stroke(line);
    c.beginPath(); c.arc(x1, this._headY, Math.max(1.6, H * 0.022), 0, Math.PI * 2);
    c.fillStyle = '#eafcff'; c.fill();                          // the head of the line: the newest moment
  }
}
