// The other players, and who the doll catches.
//
// Nobody here is caught at random. The eliminations are cast like the show's:
//
//   the first red light   one player, in front of you, a beat too late —
//                         the first shot. Then the panic: a handful turn and
//                         run for the doors, and are shot running.
//   every red light after nought to three: a late stop, or someone frozen on
//                         one leg who loses it
//   in your path          two players walk your line ahead of you. Each is
//                         caught when you are a few metres behind and falls
//                         toward you: a body you have to JUMP
//   time up               everyone still on the field
//
// The director only decides and moves; the game fires the shots (sound,
// tracer, blood, the kill feed) when it gets a {kind:'shoot'} from here.

import { FIELD } from './arena.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const LANE = -1.2;            // your line across the field (x)

export class Director {
  constructor(crowd, rand = Math.random) {
    this.crowd = crowd; this.rand = rand;
    this.bots = []; this.victims = []; this.bodies = []; this.out = [];
    this.redCount = 0; this.pending = []; this.panicked = false;
  }

  /** Line everyone up at the start. */
  setup(n = 56, usedNums = new Set([456])) {
    const R = this.rand;
    const nums = []; while (nums.length < n) { const k = 1 + Math.floor(R() * 455); if (!usedNums.has(k)) { usedNums.add(k); nums.push(k); } }
    // lanes across the width, the player's own kept clear (except for the two walking it)
    const lanes = [];
    for (let x = -18.6; x <= 18.6; x += 0.72) if (Math.abs(x - LANE) > 0.85) lanes.push(x);
    for (let i = lanes.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [lanes[i], lanes[j]] = [lanes[j], lanes[i]]; }
    for (let i = 0; i < n; i++) {
      let x, z;
      if (i < 2) { x = LANE + (R() - 0.5) * 0.12; z = FIELD.startZ + (i === 0 ? 3.2 : 8.5); }
      else { x = lanes[(i - 2) % lanes.length] + (R() - 0.5) * 0.2; z = FIELD.startZ - 1.6 + R() * 4.4 + (i - 2 >= lanes.length ? 1.3 : 0); }
      const b = this.crowd.add(nums[i], x, z);
      b.lane = x;
      // how fast they cross: most keep a steady walk, a few are quick, a few too slow to make it
      const r = R();
      b.pace = i < 2 ? (i === 0 ? 0.85 : 0.9) : r < 0.15 ? 0.45 + R() * 0.2 : r < 0.8 ? 0.8 + R() * 0.55 : 1.4 + R() * 0.7;
      b.react = 0.12 + R() * 0.35;       // how quickly they stop when she turns
      b.nerves = R();                    // who looks around, who trembles
      b.victim = i < 2;
      b.onDown = (bot, p) => this.out.push({ kind: 'down', bot, p });
      this.bots.push(b);
      if (b.victim) this.victims.push(b);
    }
    return this.bots;
  }

  alive() { return this.bots.filter(b => b.alive && b.state !== 'safe'); }
  get remaining() { return this.bots.filter(b => b.alive).length; }

  /** The doll's events. `player` = { z, alive }. */
  onDoll(ev, player, doll) {
    const R = this.rand;
    if (ev.type === 'song' || ev.type === 'start') {
      for (const b of this.alive()) { if (b.state === 'flee') continue; b.wobble = 0; b.armOut = 0; b.go(b.pace * (0.9 + R() * 0.2)); }
      this.pending = [];
    }
    if (ev.type === 'turn') {
      this.redCount++;
      // everyone stops, each at their own speed; the doomed ones are chosen now and act it out in the scan
      const doomed = this._cast(player, doll);
      for (const b of this.alive()) {
        const d = doomed.get(b);
        if (b.state === 'flee') continue;
        if (d && d.how === 'late') this.pending.push({ at: doll.R.turnS + doll.R.graceS + 0.15 + R() * 0.4, b, act: 'stop' }, { at: doll.R.turnS + doll.R.graceS + 0.25 + R() * 0.5, b, act: 'shoot' });
        else {
          this.pending.push({ at: b.react * doll.R.turnS * 1.6, b, act: 'stop' });
          if (d && d.how === 'wobble') {
            this.pending.push({ at: doll.R.turnS + 0.05, b, act: 'wobble' }, { at: doll.R.turnS + doll.R.graceS + 0.9 + R() * 1.4, b, act: 'stumble' });
          }
        }
        b.lookWant = 0; if (b.state !== 'frozen') b.fear = Math.max(b.fear, 0.3 + b.nerves * 0.4);
      }
      this.clock = 0;
    }
    if (ev.type === 'scan') {
      // the first red light: when the first body drops, the panic starts
      if (this.redCount === 1 && !this.panicked) this.panicAt = 1.2 + R() * 0.4;
    }
    if (ev.type === 'away') {
      for (const b of this.alive()) { b.fear = Math.max(0, b.fear - 0.2); }
    }
    if (ev.type === 'timeup') this._massacre();
  }

  /** Who is caught this red light, and how. */
  _cast(player, doll) {
    const R = this.rand, doomed = new Map();
    const alive = this.alive().filter(b => b.state !== 'flee');
    // the player's line: a walker a few metres ahead of you
    for (const v of this.victims) {
      if (!v.alive || doomed.size > 1) continue;
      const gap = v.z - player.z;
      if (player.alive && gap > 0.9 && gap < 9) doomed.set(v, { how: gap > 2.2 ? 'wobble' : 'late', dir: gap > 2.2 ? -1 : 1 });
    }
    let n;
    if (this.redCount === 1) n = 1;
    else { const r = R(); n = r < 0.33 ? 0 : r < 0.75 ? 1 : r < 0.95 ? 2 : 3; }
    // near the end, the slow ones get nervous and sloppy
    if (doll.clock < 40) n += 1;
    // prefer players you can see: ahead of you, within sight
    const inView = alive.filter(b => !b.victim && b.z > player.z + 2.5 && Math.abs(b.x - LANE) < 8 && b.z < FIELD.lineZ0 - 1);
    const pool = (this.redCount === 1 ? inView : alive.filter(b => !b.victim && b.z < FIELD.lineZ0 - 1));
    for (let i = 0; i < n && pool.length; i++) {
      const b = pool.splice(Math.floor(R() * pool.length), 1)[0];
      doomed.set(b, { how: this.redCount === 1 || R() < 0.55 ? 'late' : 'wobble' });
    }
    return doomed;
  }

  /** Start the massacre: everyone on the field, in a rolling volley. */
  _massacre() {
    const R = this.rand;
    const left = this.alive().sort((a, b) => a.z - b.z);
    left.forEach((b, i) => { this.pending.push({ at: this.clock + 0.4 + i * (2.8 / Math.max(1, left.length)) + R() * 0.2, b, act: i % 3 === 0 ? 'flee+shoot' : 'shoot' }); b.fear = 1; });
  }

  /** Per frame. `doll` for its state, `player` = { z, alive }. */
  update(dt, t, doll, player) {
    const R = this.rand;
    this.clock = (this.clock || 0) + dt;
    // scheduled acts
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]; if (this.clock < p.at) continue;
      this.pending.splice(i, 1);
      const b = p.b; if (!b.alive) continue;
      if (p.act === 'stop') b.freeze();
      else if (p.act === 'wobble') { b.freeze(); b.armOut = 1; b.fear = 1; }   // caught off balance: arms out, dead still — until the step
      else if (p.act === 'stumble') { b.wobble = 0; b.go(0.9); this.pending.push({ at: this.clock + 0.25, b, act: 'shoot' }); }
      else if (p.act === 'shoot') this._shoot(b, doll);
      else if (p.act === 'flee+shoot') { b.flee(3.4); this.pending.push({ at: this.clock + 0.5 + R() * 0.6, b, act: 'shoot' }); }
    }
    // the panic after the first shot
    if (this.panicAt != null && doll.state === 'scan') {
      this.panicAt -= dt;
      if (this.panicAt <= 0) {
        this.panicAt = null; this.panicked = true;
        const pool = this.alive().filter(b => !b.victim && b.state !== 'flee' && Math.abs(b.z - player.z) < 12);
        const n = Math.min(pool.length, 4 + Math.floor(R() * 4));
        for (let i = 0; i < n; i++) {
          const b = pool.splice(Math.floor(R() * pool.length), 1)[0];
          this.pending.push({ at: this.clock + i * 0.35 + R() * 0.3, b, act: 'flee+shoot' });
        }
        doll.extend(n * 0.4 + 1.8);
        this.out.push({ kind: 'panic', n });
      }
    }
    // the others react to what they see: heads turn toward a shot, and they tremble
    for (const b of this.bots) {
      if (!b.alive) continue;
      if (b.state === 'walk' || b.state === 'stand') {
        // a body in my lane: hop it; someone slower in front: slow down
        for (const d of this.bodies) if (Math.abs(d.x - b.x) < 0.5 && b.z + 0.7 > d.z0 && b.z < d.z1 && b.hop <= 0) b.jumpOver();
        const ahead = this._aheadInLane(b.x, b.z, b);
        if (ahead) b.want = Math.min(b.want, Math.max(0, ahead.speed));
        if (b.z >= FIELD.lineZ + 0.2) {
          const side = b.x < 0 ? -1 : 1;
          b.safe(FIELD.lineZ + 1.2 + R() * 3.2);
          if (Math.abs(b.x) < 1.8) b.x = side * (1.8 + R() * 0.5);
          this.out.push({ kind: 'safe', bot: b });
        }
      }
      if (b.state === 'frozen') b.lookWant = b.look;   // frozen means frozen: no looking around
    }
    this.crowd.update(dt, t);
  }

  _aheadInLane(x, z, self) {
    let best = null, bz = Infinity;
    for (const o of this.bots) {
      if (o === self || !o.alive || Math.abs(o.x - x) > 0.5) continue;
      if (o.z > z && o.z - z < 1.1 && o.z < bz) { bz = o.z; best = o; }
    }
    return best;
  }

  /** The alive bot directly ahead of the player in their line, if close. */
  blocking(z) { return this._aheadInLane(LANE, z, null); }

  _shoot(b, doll) {
    const toward = -1;                           // shots come from the far wall: bodies mostly fall back, toward the doors
    const dir = b.victim ? (b.z - this.lastPlayerZ > 2.2 ? -1 : 1) : (b.state === 'flee' ? 1 : (this.rand() < 0.7 ? toward : 1));
    if (b.shoot(null, dir)) {
      this.out.push({ kind: 'shoot', bot: b });
      if (doll && doll.state === 'scan') doll.extend(0.9);
    }
  }

  /** A body is down: remember where it lies (a lane obstacle), hand the moment to the game. */
  _down(b, p) {
    const [z0, z1] = b.bodySpan();
    this.bodies.push({ bot: b, x: b.x, z0: z0 - 0.15, z1: z1 + 0.15 });
  }

  /** What happened this frame, for the game to show and sound. */
  drain(playerZ) {
    this.lastPlayerZ = playerZ;
    const o = this.out; this.out = [];
    for (const e of o) if (e.kind === 'down') this._down(e.bot, e.p);
    return o;
  }

  /** The body lying across the player's line next ahead of `z`, if any. */
  bodyAhead(z, within = 6) {
    let best = null;
    for (const d of this.bodies) if (Math.abs(d.x - LANE) < 0.55 && d.z1 > z && d.z0 - z < within && (!best || d.z0 < best.z0)) best = d;
    return best;
  }
}
