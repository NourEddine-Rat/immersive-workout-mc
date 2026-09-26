// Intent-conditioned assist.
//
// The rule: amplify, never replace. The game never moves you without intent.
// But when a hazard is close and your body is already leaning the right way —
// even a little — the game completes the move at full speed. Strength 0 is
// the plain controller; strength 1 accepts ~20 % of a normal move.

const LOOK_S = 1.3;          // seconds of track we look ahead
const LANE_WINDOW_S = 0.8;   // lateral assist fires when the hazard is this close
const JUMP_LATEST = 0.42;    // a jump started later than this clears a low barrier
const JUMP_BEST = 0.30;      // ...and this is the sweet spot the timing assist aims for
const ROLL_LATEST = 0.55;
const ROLL_BEST = 0.42;
const HINT_S = 1.0;          // when the on-screen hint appears
const COOLDOWN = 0.35;

export class Assist {
  constructor() {
    this.strength = 0.6;
    this.count = 0;
    this.last = { lane: -Infinity, jump: -Infinity, roll: -Infinity };
    this.log = [];
  }

  /**
   * @param intent  { events, lat, latVel, rise, riseVel, duck, duckVel, source, cfg }
   * @returns { hint: { action, dir }|null, applied: string[] }
   */
  step(t, player, world, intent) {
    const applied = [];
    const speed = Math.max(1, player.speed);
    const ahead = world.lookAhead(player.distance, speed * LOOK_S, speed);

    // ---- strong intents: always honoured -------------------------------
    // Lateral ones right away. Vertical ones too — unless the timing assist
    // is on and a barrier is coming but still too far: then the move is your
    // intent, and *when* it happens is the game's help.
    const A = this.strength;
    for (const ev of intent.events || []) {
      if (ev.action === 'LEFT') { for (let i = 0; i < (ev.n || 1); i++) player.moveLane(-1); applied.push('LEFT'); }
      else if (ev.action === 'RIGHT') { for (let i = 0; i < (ev.n || 1); i++) player.moveLane(+1); applied.push('RIGHT'); }
      else if (ev.action === 'UP' || ev.action === 'DOWN') {
        const kind = ev.action === 'UP' ? 'jump' : 'roll';
        const h0 = ahead[player.lane];
        const tt = h0 ? (h0.timeTo != null ? h0.timeTo : h0.dist / speed) : Infinity;
        // what the thing ahead accepts: a block wants a jump, a signal a roll, the bar on legs either
        const wants = h0 && ((kind === 'jump' && (h0.kind === 'low' || h0.kind === 'block' || h0.kind === 'bar')) || (kind === 'roll' && (h0.kind === 'high' || h0.kind === 'bar')));
        const latest = kind === 'jump' ? JUMP_LATEST : ROLL_LATEST, best = kind === 'jump' ? JUMP_BEST : ROLL_BEST;
        if (A > 0 && wants && tt > latest && tt < 1.3 && !player.airborne) {
          player.schedule(kind, tt - best);
          this._note(t, 'timing', ev.action, `held ${(tt - best).toFixed(2)} s`);
          applied.push('assist:hold-' + ev.action);
        } else if (kind === 'jump' ? player.jump(ev.lead) : player.roll(ev.lead)) applied.push(ev.action);
      }
    }

    // ---- what does the current lane need? ------------------------------
    const lane = player.lane;
    const h = ahead[lane];
    let hint = null, need = null, timeTo = Infinity, safeDirs = [];
    if (h) {
      timeTo = h.timeTo != null ? h.timeTo : h.dist / speed;
      if (h.kind === 'train' || h.kind === 'ramp') {
        need = 'switch';
        // A lane is clear if no train blocks it before this one would hit us
        // (a barrier is fine — it has an answer). From an edge lane the free
        // lane may be two steps away: that is still a direction, if there's time.
        const clear = l => { const o = ahead[l]; return !o || o.kind !== 'train' || o.dist > h.dist + 6; };
        for (const dir of [-1, 1]) {
          const l1 = lane + dir, l2 = lane + 2 * dir;
          if (l1 < 0 || l1 > 2) continue;
          if (clear(l1)) safeDirs.push(dir);
          else if (l2 >= 0 && l2 <= 2 && clear(l2) && timeTo > 0.45) safeDirs.push(dir);
        }
      } else if (h.kind === 'low' || h.kind === 'block') need = 'jump';
      else if (h.kind === 'bar') need = 'either';
      else if (h.kind === 'high') need = 'roll';
      else if (h.kind === 'ramp') need = 'switch';
    }
    if (need && timeTo < HINT_S) {
      if (need === 'switch') {
        // prefer the side with more room; if boxed in, say so
        const dir = safeDirs.length ? (safeDirs.length === 1 ? safeDirs[0] : (ahead[lane - 1] && !ahead[lane + 1] ? 1 : ahead[lane + 1] && !ahead[lane - 1] ? -1 : safeDirs[0])) : 0;
        hint = { action: dir < 0 ? 'left' : dir > 0 ? 'right' : 'trapped', timeTo };
      } else hint = { action: need, timeTo };
    }

    // ---- weak intents, only when danger is near and the body agrees -----
    if (A > 0 && intent.source === 'body' && intent.cfg && need) {
      const relax = 1 - 0.8 * A;
      const c = intent.cfg;
      if (need === 'switch' && timeTo < LANE_WINDOW_S && t - this.last.lane > COOLDOWN) {
        for (const dir of safeDirs) {
          const pos = intent.lat * dir, vel = intent.latVel * dir;
          if (pos > c.lane.enter * relax * 0.6 && vel > -0.2 || vel > c.lane.vel * relax && pos > 0) {
            player.moveLane(dir); this._note(t, 'lane', dir > 0 ? 'RIGHT' : 'LEFT', `lat ${intent.lat.toFixed(2)} vel ${intent.latVel.toFixed(1)}`);
            applied.push('assist:' + (dir > 0 ? 'RIGHT' : 'LEFT'));
            this.last.lane = t; break;
          }
        }
      }
      if (need === 'jump' && timeTo < JUMP_LATEST && timeTo > 0.05 && !player.airborne && !player.scheduled && t - this.last.jump > COOLDOWN) {
        if (intent.rise > c.jump.rise * relax && intent.riseVel > 0.15) {
          if (player.jump()) { this._note(t, 'jump', 'UP', `rise ${intent.rise.toFixed(3)} vel ${intent.riseVel.toFixed(2)}`); applied.push('assist:UP'); this.last.jump = t; }
        }
      }
      if (need === 'roll' && timeTo < ROLL_LATEST && !player.rolling && !player.scheduled && t - this.last.roll > COOLDOWN) {
        if (intent.duck > c.duck.depth * relax && intent.duckVel > 0) {
          if (player.roll()) { this._note(t, 'roll', 'DOWN', `duck ${intent.duck.toFixed(2)} vel ${intent.duckVel.toFixed(1)}`); applied.push('assist:DOWN'); this.last.roll = t; }
        }
      }
    }

    return { hint, applied, need, timeTo };
  }

  _note(t, type, key, why) {
    this.count += 1;
    this.log.push({ t, type, key, why });
    if (this.log.length > 50) this.log.shift();
  }
}
