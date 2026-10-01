// The other players on the bridge.
//
// One line, single file (the bridge is a metre wide): five ahead of you, one
// right behind, and the rest of the group waiting at the side of the
// platform, who step into the line once there is room. They walk when the
// one in front gives them space, jump every time the rope comes round, stop
// at the gap and leap it just after a pass — some after a long, frightened
// wait. Not all of them make it, and it is cast, not random: one in front of
// you misses the rope early (you see it happen), one falls short at the gap,
// and one or two behind you miss later. When the clock runs out, whoever is
// still on the bridge goes over.
//
// The director decides and moves; the game draws the moments.

import { ROPE, RULES, inDanger, groundAt } from './rules.js';

const LANE = 0;
export { LANE };
const SPACING = 1.55;      // nobody walks closer than this to the one in front
const EDGE = ROPE.gap[0] - 0.55;   // where they stop to look at the gap

export class Director {
  constructor(crowd, rand = Math.random) { this.crowd = crowd; this.rand = rand; this.bots = []; this.out = []; }

  setup(n = 14, used = new Set([456])) {
    const R = this.rand;
    const nums = []; while (nums.length < n) { const k = 1 + Math.floor(R() * 455); if (!used.has(k)) { used.add(k); nums.push(k); } }
    // in the line: five ahead of you (the first already at the bridge), one behind
    const line = [-17.9, -19.6, -21.3, -23.0, -24.7].map(z => ({ x: LANE, z }));
    line.push({ x: LANE, z: RULES.startZ - 1.8 });
    // the rest wait at the side of the platform
    const side = [];
    for (let i = 0; line.length + side.length < n; i++) side.push({ x: (i % 2 ? 2.3 : -2.3) + (R() - 0.5) * 0.4, z: -26.8 - Math.floor(i / 2) * 1.3 });
    const spots = [...line, ...side];
    spots.forEach((s, i) => {
      const b = this.crowd.add(nums[i], s.x, s.z);
      b.baseY = groundAt(s.z);
      b.order = i < 5 ? i : i + 1;            // the player is order 5
      b.inLine = i < line.length;
      b.pace = 0.95 + R() * 0.4;
      b.nerve = R();                          // how long they stare at the gap
      b.jumpedTurn = -1;
      b.onLand = bot => this.out.push({ kind: 'landed', bot });
      this.bots.push(b);
    });
    // who does not make it: one ahead misses the rope on their 3rd turn on the bridge, one ahead falls short at the gap,
    // and one of the side group misses the rope later on
    this.bots[1].fate = { miss: 3 };
    this.bots[3].fate = { short: true };
    const late = this.bots.filter(b => !b.inLine); if (late.length) late[Math.floor(R() * late.length)].fate = { miss: 5 };
    for (const b of this.bots) b.dangerTurns = 0;
    this.player = { order: 5 };
    return this.bots;
  }

  get remaining() { return this.bots.filter(b => b.alive).length; }

  /** Whoever is in the line directly ahead of z (bot or null), and how far. */
  ahead(z, self) {
    let best = null;
    for (const b of this.bots) if (b !== self && b.alive && b.inLine && Math.abs(b.x - LANE) < 0.6 && b.z > z + 0.05 && (!best || b.z < best.z)) best = b;
    return best;
  }

  /**
   * Per frame.
   * @param rope   the Rope (rules.js)
   * @param player { z, alive, safe }
   * @param now    seconds
   */
  update(dt, now, rope, player, active) {
    const R = this.rand;
    for (const b of this.bots) {
      if (!b.alive) continue;
      b.baseY = groundAt(b.z);
      if (b.state === 'safe') continue;
      if (!active) { if (b.state !== 'stand') b.go(0); continue; }
      // stepping into the line: when the spot beside the line is free, walk across into it
      if (!b.inLine) {
        const z = b.z, blocked = this.bots.some(o => o !== b && o.alive && o.inLine && Math.abs(o.z - z) < SPACING) || (player.alive && !player.safe && Math.abs(player.z - z) < SPACING);
        const turn = this.bots.filter(o => !o.inLine && o.alive && o.order < b.order).length === 0;   // one at a time, in order
        if (!blocked && turn) { b.x += Math.sign(LANE - b.x) * Math.min(Math.abs(LANE - b.x), 1.2 * dt); if (Math.abs(b.x - LANE) < 0.02) { b.x = LANE; b.inLine = true; } }
        b.go(0); continue;
      }
      // walking: keep the distance to whoever is in front (a bot or you)
      const front = this.ahead(b.z, b);
      let room = front ? front.z - b.z : Infinity;
      if (player.alive && !player.safe && player.z > b.z) room = Math.min(room, player.z - b.z);
      let want = room > SPACING + 0.3 ? b.pace : room > SPACING ? b.pace * 0.4 : 0;
      // the gap: stop at the edge, look, and go just after the rope has passed
      if (b.z < ROPE.gap[0] && b.z > EDGE - 0.4 && !b.leapP) {
        want = 0; if (b.z > EDGE) b.z = EDGE;
        if (b.gapSince == null) b.gapSince = now;
        const waited = now - b.gapSince, since = rope.sincePass(now);
        if (waited > 0.4 + b.nerve * 2.2 && since > 0.1 && since < 0.45 && rope.untilPass > 0.9) {
          if (b.fate && b.fate.short) { b.leap(ROPE.gap[0] + 0.5, 0.55); b.falling = 'gap'; }
          else b.leap(ROPE.gap[1] + 0.55, 0.7);
          this.out.push({ kind: 'leap', bot: b });
        }
      }
      if (b.falling === 'gap' && !b.leapP) { b.falling = null; b.plunge(0.15, ROPE.pitY, 0.3); this.out.push({ kind: 'fell', bot: b, why: 'gap' }); continue; }
      if (!b.leapP) b.go(want);
      // the rope: jump so as to be in the air when it passes (they are good at it — mostly)
      if (inDanger(b.z)) {
        const u = rope.untilPass;
        if (u < 0.3 && b.jumpedTurn !== rope.turns && !b.leapP) {
          b.jumpedTurn = rope.turns; b.dangerTurns++;
          const miss = b.fate && b.fate.miss && b.dangerTurns >= b.fate.miss;
          if (!miss) b.jumpOver(0.6);
        }
      }
      // across
      if (b.z >= RULES.finishZ) {
        const side = b.order % 2 ? 1 : -1;
        b.safe(RULES.finishZ + 1.2 + R() * 3.5);
        b.targetX = side * (2.2 + R() * 2.4);
        this.out.push({ kind: 'safe', bot: b });
      }
    }
    // those already across drift aside to make room, then turn to watch
    for (const b of this.bots) if (b.state === 'safe' && b.targetX != null) b.x += (b.targetX - b.x) * (1 - Math.exp(-dt / 0.9));
    this.crowd.update(dt, now);
  }

  /** The rope has swept under the bridge: whoever stands on it in the danger zone, on the deck, goes over. */
  onPass(ev) {
    for (const b of this.bots) {
      if (!b.alive || b.state === 'safe' || !inDanger(b.z) || b.airborne || b.leapP) continue;
      b.plunge(1, ROPE.pitY, 2.2);
      this.out.push({ kind: 'fell', bot: b, why: 'rope' });
    }
  }

  /** Time up: everyone still on the bridge goes over; those on the start platform are eliminated where they stand. */
  timeUp() {
    let i = 0;
    for (const b of this.bots) {
      if (!b.alive || b.state === 'safe') continue;
      const onBridge = b.z > ROPE.bridge[0] && b.z < ROPE.bridge[1];
      const delay = 200 + (i++) * 180;
      setTimeout(() => { if (!b.alive) return; if (onBridge) b.plunge(Math.random() < 0.5 ? -1 : 1, ROPE.pitY, 1.2); else b.shoot(null, -1); this.out.push({ kind: 'fell', bot: b, why: 'time' }); }, delay);
    }
  }

  drain() { const o = this.out; this.out = []; return o; }
  /** Knock the next one in front of z over the side (dev key). */
  knock(z) { const b = this.ahead(z, null); if (b && b.z > ROPE.bridge[0] && b.z < ROPE.bridge[1]) { b.plunge(1, ROPE.pitY, 2.2); this.out.push({ kind: 'fell', bot: b, why: 'rope' }); } }
}
