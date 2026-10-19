import { TUNE } from './car.js';

const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// =====================================================================================================================
//  Drivers for the Police mission. They drive exactly the same Vehicle physics as the player (equal power) and follow
//  the navigation fields built in world.js (Dijkstra distance fields over the street grid).
// =====================================================================================================================

/** shared steering / throttle controller: drive car `v` towards (tx,tz) at about `vt` m/s */
export function driveTo(v, world, tx, tz, vt, inp, opts = {}) {
  const sp = v.speed;
  const des = Math.atan2(tx - v.x, tz - v.z);
  const velAng = sp > 4 ? Math.atan2(v.vx, v.vz) : v.psi;
  const err = wrapA(des - (v.psi + 0.35 * wrapA(velAng - v.psi)));
  let steer = -err * (opts.gain || 2.3);
  // feelers: lean away from the nearer wall
  const sp0 = Math.sin(v.psi), cp0 = Math.cos(v.psi), look = 5 + Math.min(sp, 40) * 0.38, w = 2.4;
  const fl = Math.min(5, world.dist(v.x + sp0 * look + cp0 * w, v.z + cp0 * look - sp0 * w));
  const fr = Math.min(5, world.dist(v.x + sp0 * look - cp0 * w, v.z + cp0 * look + sp0 * w));
  steer += clamp((fr - fl) * 0.09, -0.4, 0.4);
  inp.steer = clamp(steer, -1, 1);
  const front = world.dist(v.x + sp0 * look * 1.3, v.z + cp0 * look * 1.3);
  let target = vt * clamp(1 - Math.abs(err) * 0.55, 0.26, 1);
  if (front < 2.2) target = Math.min(target, 10);                               // wall dead ahead: slow right down
  const dv = target - sp;
  inp.throttle = dv > -1.2 ? clamp(0.5 + dv * 0.3, 0, 1) : 0;
  inp.brake = dv < -3.5 ? clamp((-dv - 3.5) / 9, 0, 1) : 0;
  inp.handbrake = Math.abs(err) > 1.2 && sp > 17;
  inp.nitro = !!opts.nitro && Math.abs(err) < 0.1 && inp.brake === 0 && front > 14;
  if (v.shiftCut <= 0) {
    if (v.rpmRaw > 0.92 && v.gear < 5) v.shift(1);
    else if (v.gear > 1 && Math.abs(v.vf) / TUNE.gears[v.gear - 1].max < 0.78 && v.rpmRaw < 0.55) v.shift(-1);
  }
  return err;
}

/** push away from cars that are close ahead (called after driveTo) */
function separate(v, others, inp) {
  const sp0 = Math.sin(v.psi), cp0 = Math.cos(v.psi);
  for (const o of others) {
    if (o.dead) continue;
    const dx = o.x - v.x, dz = o.z - v.z;
    if (dx * dx + dz * dz > 196) continue;
    const f = dx * sp0 + dz * cp0, lat = dx * cp0 - dz * sp0;
    if (f > 1.5 && f < 13 && Math.abs(lat) < 2.8) inp.steer = clamp(inp.steer + (lat > 0 ? 0.55 : -0.55) * (1 - f / 13), -1, 1);
  }
}

/** shared "stuck" handling: reverse out of a jam, and as a last resort drop the car back on the street */
class Unjam {
  constructor() { this.t = 0; this.rev = 0; this.dir = 1; this.total = 0; }
  /** returns true while it is controlling the car */
  run(dt, v, inp, drv) {
    if (this.rev > 0) {
      this.rev -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = this.dir; inp.handbrake = false; inp.nitro = false;
      return true;
    }
    if (v.speed < 1.8 && !v.locked) { this.t += dt; this.total += dt; } else { this.t = 0; if (v.speed > 6) this.total = 0; }
    if (this.t > 1.0) { this.rev = 0.9 + Math.random() * 0.7; this.dir = Math.random() < 0.5 ? -1 : 1; this.t = 0; }
    if (this.total > 6) { this.total = 0; drv.rescue(); }
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
export class PoliceDriver {
  /** tactic: 0 chaser (straight at the thief), 1 interceptor (cuts the thief off ahead), 2 flanker */
  constructor(v, ctx, tactic, diff) {
    this.v = v; this.ctx = ctx; this.tactic = tactic; this.diff = diff;
    this.unjam = new Unjam(); this.inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.skill = 0.85 + Math.random() * 0.25; this.wob = Math.random() * 6;
    this.mode = 'path';
  }
  rescue() {
    const { nav, world } = this.ctx, k = nav.snap(this.v.x, this.v.z); if (k < 0) return;
    const [x, z] = nav.centre(k); this.v.place(x, z, world.freeHeading(x, z));
  }
  control(dt, inp, active = true) {
    const v = this.v, c = this.ctx, world = c.world, th = c.thief(v);
    inp.handbrake = false; inp.nitro = false;
    if (!active || !th) { inp.throttle = 0; inp.brake = 1; inp.steer = 0; return; }
    if (this.unjam.run(dt, v, inp, this)) return;
    const sp = v.speed, dx = th.x - v.x, dz = th.z - v.z, d = Math.hypot(dx, dz);
    const cruise = this.diff.cruise * this.skill;
    let tx = th.x, tz = th.z, vt = cruise, direct = false;
    // lead the target when it is close
    const lead = clamp(d / Math.max(sp + 6, 14), 0, 1.4) * (this.tactic === 1 ? 1.6 : 0.8);
    const px = th.x + th.vx * lead, pz = th.z + th.vz * lead;
    if (d < 34 && world.rayFree(v.x, v.z, th.x, th.z, 0.85) >= 1) {
      direct = true; tx = px; tz = pz;
      vt = Math.max(th.speed + 9, 17);                                       // match speed, then lean on it
      if (d < 9) vt = th.speed + 12;
      if (th.speed < 6 && d < 14) vt = clamp(d * 0.5, 0, 5);                // the thief is stopped: stay beside him and hold him there
    } else {
      const F = this.tactic === 1 && d > 55 && c.fieldAhead ? c.fieldAhead() : c.fieldThief();
      const pts = F ? F.descend(v.x, v.z, 26) : null;
      if (pts && pts.length > 1) {
        let k = pts.length - 1;
        while (k > 1 && world.rayFree(v.x, v.z, pts[k][0], pts[k][1], 0.9) < 1) k--;     // furthest waypoint we can see
        tx = pts[k][0]; tz = pts[k][1];
        if (this.tactic === 2 && d < 70) { const a = Math.atan2(th.vx, th.vz) + Math.PI / 2 * (this.wob > 3 ? 1 : -1); tx += Math.sin(a) * 4; tz += Math.cos(a) * 4; }
      } else { tx = th.x; tz = th.z; }
      // slow for sharp corners ahead on the path
      if (pts && pts.length > 4) {
        const a1 = Math.atan2(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1]), a2 = Math.atan2(pts[pts.length - 1][0] - pts[2][0], pts[pts.length - 1][1] - pts[2][1]);
        vt = Math.min(vt, cruise * clamp(1.25 - Math.abs(wrapA(a2 - a1)) * 0.75, 0.4, 1));
      }
    }
    const err = driveTo(v, world, tx, tz, vt, inp, { nitro: this.diff.nitro && !direct && d > 70, gain: direct ? 2.8 : 2.3 });
    separate(v, c.others(this), inp);
    this.err = err;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
export class FleeDriver {
  constructor(v, ctx, diff) {
    this.v = v; this.ctx = ctx; this.diff = diff;
    this.unjam = new Unjam(); this.inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.path = null; this.pi = 0; this.replan = 0; this.skill = 1;
  }
  rescue() {
    const { nav, world } = this.ctx, k = nav.snap(this.v.x, this.v.z); if (k < 0) return;
    const [x, z] = nav.centre(k); this.v.place(x, z, world.freeHeading(x, z)); this.path = null;
  }
  /** pick a destination the thief reaches well before any police car and drive there */
  plan() {
    const c = this.ctx, nav = c.nav, Ft = c.fieldThief(), Fp = c.fieldPolice();
    if (!Ft || !Fp) return;
    const v = this.v, here = nav.snap(v.x, v.z); if (here < 0) return;
    const root = k => { let g = 0, r = k; while (k >= 0 && g++ < 900) { r = k; k = Ft.par[k]; } return r; };
    const myRoot = root(here), owns = k => root(k) === myRoot;      // several thieves: the field leads to the NEAREST one - only cells that lead to my own source count
    let best = -1, bs = -1e9;
    for (let n = 0; n < 60; n++) {
      const k = c.wide[(Math.random() * c.wide.length) | 0], dt = Ft.dist[k], dp = Fp.dist[k];
      if (!isFinite(dt) || dt < 90 || dt > 520 || !owns(k)) continue;
      const score = Math.min(dp, 900) - dt * 0.9 + Math.random() * 40;
      if (score > bs && dp > dt * 1.05) { bs = score; best = k; }
    }
    if (best < 0) {                                                            // nothing safe: just run away from the nearest police
      let far = -1, fd = -1;
      for (let n = 0; n < 60; n++) { const k = c.wide[(Math.random() * c.wide.length) | 0], dt = Ft.dist[k]; if (!isFinite(dt) || dt < 60 || dt > 400 || !owns(k)) continue; if (Fp.dist[k] > fd) { fd = Fp.dist[k]; far = k; } }
      best = far;
    }
    if (best < 0) return;
    const pts = []; let k = best, guard = 0;
    while (k >= 0 && guard++ < 700) { pts.push(nav.centre(k)); if (k === here) break; k = Ft.par[k]; }
    pts.reverse();
    if (pts.length > 3) { this.path = pts; this.pi = 0; }
  }
  control(dt, inp, active = true) {
    const v = this.v, c = this.ctx, world = c.world;
    inp.handbrake = false; inp.nitro = false;
    if (!active) { inp.throttle = 0; inp.brake = 1; inp.steer = 0; return; }
    if (this.unjam.run(dt, v, inp, this)) return;
    this.replan -= dt;
    if (!this.path || this.pi >= this.path.length - 3 || this.replan <= 0) { this.plan(); this.replan = 3.5 + Math.random() * 2; }
    const hp = c.thiefHp ? c.thiefHp(v) : 100;                                  // a shot-up car limps, then dies on the spot
    if (hp < 12) { inp.throttle = 0; inp.brake = 0.6; inp.steer = 0; return; }
    let tx = v.x + Math.sin(v.psi) * 20, tz = v.z + Math.cos(v.psi) * 20, vt = this.diff.fleeSpeed * (hp < 50 ? 0.3 + 0.7 * hp / 50 : 1);
    if (this.path) {
      const P = this.path; let best = this.pi, bd = 1e9;
      for (let i = this.pi; i < Math.min(P.length, this.pi + 14); i++) { const d = Math.hypot(P[i][0] - v.x, P[i][1] - v.z); if (d < bd) { bd = d; best = i; } }
      this.pi = best;
      let k = Math.min(P.length - 1, best + Math.round((10 + v.speed * 0.5) / 2));
      while (k > best + 1 && world.rayFree(v.x, v.z, P[k][0], P[k][1], 0.9) < 1) k--;
      tx = P[k][0]; tz = P[k][1];
      if (k + 5 < P.length) {
        const a1 = Math.atan2(P[Math.min(k, best + 2)][0] - P[best][0], P[Math.min(k, best + 2)][1] - P[best][1]), a2 = Math.atan2(P[k + 4][0] - P[k][0], P[k + 4][1] - P[k][1]);
        vt *= clamp(1.2 - Math.abs(wrapA(a2 - a1)) * 0.7, 0.42, 1);
      }
    }
    const near = c.nearestPoliceDist(v);
    driveTo(v, world, tx, tz, vt, inp, { nitro: near < 60 && near > 8, gain: 2.3 });
    separate(v, c.others(this), inp);
    if (c.towed && c.towed()) {                                                // hooked by a tow rope: weave left / right and floor it to snap it
      this.weave = (this.weave || 0) + dt;
      const dir = Math.floor(this.weave / 0.7) % 2 ? 1 : -1;
      inp.steer = clamp(inp.steer * 0.3 + dir * 0.95, -1, 1); inp.throttle = 1; inp.brake = 0; inp.handbrake = false; inp.nitro = this.diff.nitro;
    } else this.weave = 0;
  }
}
