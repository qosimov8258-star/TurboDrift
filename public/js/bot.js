import { TUNE } from './car.js';
import { HALF } from './track.js';

const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Driver AI: follows the track, brakes for corners, shifts gears, uses nitro on straights.
// It drives the exact same Vehicle physics as the player (equal power).
export class Bot {
  constructor(v, track, skill = 0.5) {
    this.v = v; this.t = track; this.skill = skill;
    this.lane = (Math.random() - 0.5) * 7;
    this.aLat = 19.5 + skill * 3.4;
    this.off = 0; this.stuck = 0; this.nitroHold = false;
    this.inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  }

  control(dt, inp, others, factor = 1, active = true) {
    const v = this.v, t = this.t;
    inp.handbrake = false; inp.nitro = false;
    if (!active) { inp.throttle = 0; inp.brake = 0; inp.steer = 0; return; }
    const i = v.nearest.i < 0 ? 0 : v.nearest.i;
    const sp = v.speed;
    const look = 9 + sp * 0.5, li = i + Math.round(look / t.step);
    const Kl = t.K[t.wrap(li)];

    // lateral target: own lane + corner cutting + dodge slower cars ahead
    let want = this.lane * 0.6 + clamp(Kl * 260, -4.5, 4.5);
    const sp0 = Math.sin(v.psi), cp0 = Math.cos(v.psi);
    for (const o of others) {
      const dx = o.x - v.x, dz = o.z - v.z;
      const f = dx * sp0 + dz * cp0, lat = dx * cp0 - dz * sp0;
      if (f > 2 && f < 20 && Math.abs(lat) < 3.4) want += (lat > 0 ? -1 : 1) * 3.6 * (1 - f / 20);
    }
    want = clamp(want, -(HALF - 2.4), HALF - 2.4);
    this.off += (want - this.off) * Math.min(1, dt * 2.2);
    const tp = t.at(li, this.off);

    // steering
    const des = Math.atan2(tp.x - v.x, tp.z - v.z);
    const velAng = sp > 4 ? Math.atan2(v.vx, v.vz) : v.psi;
    const err = wrapA(des - (v.psi + 0.5 * wrapA(velAng - v.psi)));
    inp.steer = clamp(-err * 2.1, -1, 1);

    // speed plan: look 100 m ahead for the slowest corner we can still brake for
    let vt = 68;
    for (let k = 0; k <= 9; k++) {
      const d = k * 11, idx = i + Math.round(d / t.step);
      const K = Math.max(Math.abs(t.K[t.wrap(idx)]), Math.abs(t.K[t.wrap(idx + 4)]));
      const vmax = Math.sqrt(this.aLat / Math.max(K, 1e-4));
      vt = Math.min(vt, Math.sqrt(vmax * vmax + 2 * 17 * d));
    }
    vt = Math.min(vt, 68 - Math.abs(err) * 28) * factor;
    const dv = vt - sp;
    inp.throttle = dv > -1.5 ? clamp(0.45 + dv * 0.3, 0, 1) : 0;
    inp.brake = dv < -3 ? clamp((-dv - 3) / 9, 0, 1) : 0;

    // gearbox
    if (v.shiftCut <= 0) {
      if (v.rpmRaw > 0.92 && v.gear < 5) v.shift(1);
      else if (v.gear > 1 && Math.abs(v.vf) / TUNE.gears[v.gear - 1].max < 0.78 && v.rpmRaw < 0.55) v.shift(-1);
    }

    // nitro on long straights
    const Kfar = Math.abs(t.K[t.wrap(i + Math.round(60 / t.step))]);
    const straight = Math.abs(Kl) < 0.0016 && Kfar < 0.0016 && Math.abs(err) < 0.12;
    if (this.nitroHold) { if (v.nitro < 0.08 || !straight) this.nitroHold = false; }
    else if (straight && v.nitro > 0.55 && sp > 22 && factor >= 1 && inp.brake === 0) this.nitroHold = true;
    inp.nitro = this.nitroHold;

    // stuck -> put the car back on the road
    if (sp < 1.5 && !v.locked) this.stuck += dt; else this.stuck = 0;
    if (this.stuck > 3) {
      const p = t.at(i, 0); v.place(p.x, p.z, t.heading(i)); this.stuck = 0;
    }
  }
}

// Battle-arena driver: hunts the weakest / nearest living car and rams it, keeps off the walls, backs out when stuck.
// Same Vehicle physics as everyone else. `others` = racer states ({x,z,vx,vz,hp,dead}).
export class BattleBot {
  constructor(v, track, skill = 0.5) {
    this.v = v; this.t = track; this.skill = skill;
    this.target = null; this.retarget = 0; this.stuck = 0; this.rev = 0; this.revDir = 1; this.nitroHold = false;
    this.cruise = 34 + skill * 14;                       // preferred top speed (m/s) — fast enough to hurt, slow enough to survive the ring
    this.inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  }

  control(dt, inp, others, factor = 1, active = true) {
    const v = this.v, t = this.t;
    inp.handbrake = false; inp.nitro = false;
    if (!active) { inp.throttle = 0; inp.brake = 0; inp.steer = 0; return; }
    const sp = v.speed;

    // pick a victim: close and hurt cars first
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || this.target.dead) {
      this.retarget = 1.2 + Math.random();
      let best = 1e9; this.target = null;
      for (const o of others) {
        if (o.dead) continue;
        const sc = Math.hypot(o.x - v.x, o.z - v.z) + (o.hp ?? 100) * 0.25;
        if (sc < best) { best = sc; this.target = o; }
      }
    }

    // backing out of a jam
    if (this.rev > 0) {
      this.rev -= dt;
      inp.throttle = 0; inp.brake = 1; inp.steer = this.revDir;
      return;
    }
    if (sp < 2 && !v.locked) this.stuck += dt; else this.stuck = 0;
    if (this.stuck > 0.9) { this.rev = 0.9 + Math.random() * 0.6; this.revDir = Math.random() < 0.5 ? -1 : 1; this.stuck = 0; return; }

    const nr = v.nearest, i = nr.i < 0 ? 0 : nr.i;
    let tx, tz, dist = 99;
    if (this.target) {
      dist = Math.hypot(this.target.x - v.x, this.target.z - v.z);
      const lead = Math.min(1.1, dist / Math.max(sp, 14)) * (0.5 + 0.5 * this.skill);
      tx = this.target.x + (this.target.vx || 0) * lead; tz = this.target.z + (this.target.vz || 0) * lead;
    } else { const p = t.at(t.wrap(i + 10), 0); tx = p.x; tz = p.z; }

    // stay off the walls: near a barrier, blend the aim point towards the middle of the ring
    const lim = 8.5, ad = t.open ? nr.d * t.outerSg : Math.abs(nr.d);
    let wall = 0;
    if (ad > lim) {
      wall = clamp((ad - lim) / 5, 0, 1);
      const c = t.open ? t.centre : t.at(t.wrap(i + Math.round((6 + sp * 0.35) / t.step)), 0);
      tx += (c.x - tx) * wall; tz += (c.z - tz) * wall;
    }

    const des = Math.atan2(tx - v.x, tz - v.z);
    const velAng = sp > 5 ? Math.atan2(v.vx, v.vz) : v.psi;
    const err = wrapA(des - (v.psi + 0.35 * wrapA(velAng - v.psi)));
    inp.steer = clamp(-err * 2.3, -1, 1);

    // speed: flat out when lined up, ease off when pointing the wrong way
    const vt = (this.cruise - Math.abs(err) * 16) * factor * (wall > 0.5 ? 0.7 : 1);
    const dv = vt - sp;
    inp.throttle = dv > -1 ? clamp(0.5 + dv * 0.3, 0, 1) : 0;
    inp.brake = dv < -4 ? clamp((-dv - 4) / 10, 0, 1) : 0;
    if (Math.abs(err) > 1.1 && sp > 18) inp.handbrake = true;        // hairpin towards the victim

    if (v.shiftCut <= 0) {
      if (v.rpmRaw > 0.92 && v.gear < 5) v.shift(1);
      else if (v.gear > 1 && Math.abs(v.vf) / TUNE.gears[v.gear - 1].max < 0.78 && v.rpmRaw < 0.55) v.shift(-1);
    }
    // nitro for the final run-in
    if (this.nitroHold) { if (v.nitro < 0.08 || dist < 14 || Math.abs(err) > 0.3) this.nitroHold = false; }
    else if (dist > 30 && dist < 120 && Math.abs(err) < 0.12 && v.nitro > 0.6 && wall === 0 && inp.brake === 0) this.nitroHold = true;
    inp.nitro = this.nitroHold;
  }
}
