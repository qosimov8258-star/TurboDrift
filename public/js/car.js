import * as THREE from 'three';
import { HALF, CURB_W, WALL_D } from './track.js';
import { applyPaint, PAINTS } from './paint.js';

// ---------------------------------------------------------------- shared tuning
// Every car in the game uses exactly the same numbers -> equal power for all.
export const TUNE = {
  gears: [null,
    { max: 23, acc: 15.5 },   // 1st  ~83 km/h
    { max: 43, acc: 10.5 },   // 2nd  ~155 km/h
    { max: 63, acc: 8.5 },    // 3rd  ~227 km/h
    { max: 82, acc: 7.5 },    // 4th  ~295 km/h
    { max: 100, acc: 6.8 },   // 5th  ~360 km/h (400 km/h with nitro)
  ],
  nitroMaxBoost: 1.12, nitroAcc: 1.8, nitroUse: 0.32, nitroRegen: 0.045,
  wheelBase: 2.7, wheelR: 0.34,
  gripBase: 9.0, gripDrift: 1.15,
  latAccelMax: 46,
  brake: 30, reverseMax: 10,
};

export const CAR_DEFS = [
  { id: 'bmw_m3',      name: 'BMW M3 Competition',      front: '-z', paint: ['Material.032'], color: '#e53935', exh: [[0.46,0.24,-2.2],[0.3,0.24,-2.2],[-0.29,0.24,-2.2],[-0.45,0.24,-2.2]] },
  { id: 'bmw_gtr',     name: 'BMW M3 GTR',              front: '-z', paint: ['CARSKIN_LOGO'], color: '#1e63d6', exh: [[0.6,0.25,-2.2],[-0.6,0.25,-2.2]] },
  { id: 'charger',     name: 'Dodge Charger',           front: '-z', paint: ['vehicle_generic_smallspecmap_PRIMARY'], color: '#8a8f99', exh: [[0.66,0.6,-2.2],[0.52,0.6,-2.2],[-0.51,0.6,-2.2],[-0.66,0.6,-2.2]] },
  { id: 'ferrari',     name: 'Ferrari 296 GT3',         front: '+z', paint: ['mat_220'], color: '#f2f2f2', exh: [[0.24,0.61,-2.15],[-0.24,0.61,-2.15]] },
  { id: 'amg',         name: 'Mercedes-AMG GT3',        front: '+z', paint: ['MI_Mercedes_AMG_GT3_Evo_Livery'], color: '#2c3d8f', exh: [[0.55,0.3,-2.1],[-0.55,0.3,-2.1]] },
  { id: 'supra_gt300', name: 'Toyota GR Supra GT300',   front: '-z', paint: ['01_-_Default'], color: '#e6e6e6', exh: [[0.45,0.4,-2.15],[-0.45,0.4,-2.15]] },
  { id: 'supra_mk4',   name: 'Toyota Supra MK4',        front: '-z', paint: ['esta80', '.002'], color: '#d81bd8', exh: [[0.56,0.33,-2.2]] },
];

/** Battle mode: HP lost in a crash depends on the closing speed along the contact normal (m/s), so a light tap
 *  costs almost nothing and a head-on at 150 km/h hurts a lot. `share` = how much of the closing speed came from the
 *  OTHER car (0..1): the one that was hit takes more, the one that rammed takes less. */
export const BATTLE = { maxHp: 100, carMin: 3.2, carK: 0.075, carCap: 60, wallMin: 4, wallK: 0.05, wallCap: 40 };
export function carDamage(closing, share = 0.5) {
  if (closing <= BATTLE.carMin) return 0;
  return Math.min(BATTLE.carCap, BATTLE.carK * Math.pow(closing - BATTLE.carMin, 1.6) * (0.6 + 0.8 * share));
}
export function wallDamage(speed) {
  if (speed <= BATTLE.wallMin) return 0;
  return Math.min(BATTLE.wallCap, BATTLE.wallK * Math.pow(speed - BATTLE.wallMin, 1.6));
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function torqueCurve(r) {
  const rise = 0.25 + 0.75 * smooth(0, 0.3, r);
  const fall = 1 - 0.45 * smooth(0.72, 1.0, r);
  const limiter = r > 1 ? clamp((1.05 - r) / 0.05, 0, 1) : 1;
  return rise * fall * limiter;
}

export class Vehicle {
  constructor() {
    this.x = 0; this.z = 0; this.psi = 0;
    this.vx = 0; this.vz = 0;
    this.yaw = 0; this.steer = 0; this.steerAngle = 0;
    this.gear = 1; this.reversing = false; this.shiftCut = 0;
    this.rpm = 0.18; this.rpmRaw = 0;
    this.nitro = 1; this.nitroOn = false;
    this.drift = 0; this.slip = 0; this.grip = TUNE.gripBase;
    this.throttle = 0; this.brake = 0; this.handbrake = false;
    this.vf = 0; this.vl = 0; this.speed = 0; this.latG = 0; this.accG = 0;
    this.surface = 'road'; this.hit = 0; this.wheelSpin = 0; this.launchSpin = 0;
    this.nearest = { i: -1, d: 0, a: 0 };
    this.limiter = false; this.overrev = false;
    this.auto = false;
    this.ramMul = 1; this.hitMul = 1;   // battle damage multipliers: when this car is the rammer / when it is the one hit
    this.jy = 0; this.jv = 0;  // jump height (m) and vertical speed
    this.locked = false;       // race not started: handbrake held, no input
    this.burn = 0; this.fire = 0; this.burnout = false; this.rearSpin = 0; this.igniteEvent = false; this.burnWarn = false;
    this.boost = 0; this.stun = 0; this.oil = 0;   // battle abilities: turbo seconds left / EMP stun / oil-slick slide
  }

  place(x, z, psi) {
    this.x = x; this.z = z; this.psi = psi; this.vx = this.vz = 0; this.yaw = 0; this.gear = 1; this.burn = 0; this.burnArm = 0; this.fire = 0; this.burnout = false;
    this.steer = 0; this.nearest.i = -1; this.rpm = 0.18;
  }

  /** battle: hop into the air (only from the ground) */
  jump() {
    if (this.locked || this.jy > 0.02) return false;
    this.jv = 8; this.jy = 0.03; this.jumpEvent = true; return true;
  }

  gearMax() { return TUNE.gears[this.gear].max * (this.nitroOn ? TUNE.nitroMaxBoost : 1); }

  shift(dir) {
    return this.setGear(clamp(this.gear + dir, 1, 5));
  }

  setGear(g) {
    if (g === this.gear) return false;
    const r = Math.abs(this.vf) / TUNE.gears[g].max;
    if (g < this.gear && r > 1.4) return false;           // would over-rev the engine
    const up = g > this.gear;
    this.gear = g; this.shiftCut = up ? 0.16 : 0.1; this.shifted = up ? 1 : -1;
    return true;
  }

  update(dt, inp, track) {
    const T = TUNE;
    const sp = Math.sin(this.psi), cp = Math.cos(this.psi);
    const fx = sp, fz = cp, lx = cp, lz = -sp;
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * lx + this.vz * lz;
    this.vf = vf;
    const speed = Math.hypot(this.vx, this.vz);
    this.speed = speed;

    let thr = this.locked ? 0 : inp.throttle;
    let brk = this.locked ? 0 : inp.brake;
    if (this.stun > 0) { this.stun -= dt; thr = 0; brk = 0; }              // EMP: engine dead
    const boosting = this.boost > 0 && this.stun <= 0 && !this.locked;
    if (boosting) { this.boost -= dt; thr = 1; brk = 0; }                  // turbo: floor it
    else if (this.boost > 0) this.boost = 0;
    if (this.oil > 0) this.oil -= dt;
    // burnout: gas + brake together while (almost) standing -> wheels spin on the spot
    // needs a deliberate hold (0.3 s) at a near-standstill, so braking while slowly rolling never triggers it
    const both0 = !this.locked && thr > 0.5 && brk > 0.5 && Math.abs(vf) < 2.5 && this.fire <= 0;
    this.burnArm = both0 ? (this.burnArm || 0) + dt : 0;
    const burn = both0 && this.burnArm > 0.3;
    this.burnout = burn;
    // burnout lasts exactly as long as the ong-chap clip (6 s), then the car blows up; letting go resets it
    if (burn) this.burn += dt / 6; else this.burn = this.fire > 0 ? Math.max(0, this.burn - dt * 0.02) : Math.max(0, this.burn - dt * 1.5);
    if (this.fire > 0) { this.fire -= dt; thr = 0; if (this.fire <= 0) { this.burn = 0.2; this.fireOut = true; } }
    else if (this.burn >= 1) { this.fire = 9; this.burn = 0.7; this.igniteEvent = true; }
    if (this.burn > 0.55 && !this.burnWarn) { this.burnWarn = true; this.warnEvent = true; }
    if (this.burn < 0.2) this.burnWarn = false;
    if (this.fire > 0 && vf < 1) brk = 0;          // burning car just rolls to a stop
    this.throttle = thr; this.brake = brk;
    this.handbrake = this.locked ? true : !!inp.handbrake;

    // ---- steering (speed sensitive, smoothed)
    const target = this.locked ? 0 : inp.steer;
    const rate = Math.abs(target) > Math.abs(this.steer) ? 12 : 16;
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    let maxSteer = lerp(0.72, 0.26, Math.pow(clamp(Math.abs(vf) / 62, 0, 1), 0.6));
    if (this.reversing) maxSteer = Math.min(maxSteer, 0.46);          // reverse: gentler lock, like a real car backing up
    this.steerAngle = -this.steer * maxSteer;      // + = left

    // ---- engine
    if (this.shiftCut > 0) this.shiftCut -= dt;
    this.nitroOn = !this.locked && !this.reversing && thr > 0.1 && ((inp.nitro && this.nitro > 0.02 && this.stun <= 0) || boosting);
    const gmax = this.gearMax();
    const rr = Math.max(vf, 0) / gmax;                   // 0..>1 within the selected gear
    this.rpmRaw = rr;
    let a = 0;
    const both = !this.locked && thr > 0.5 && brk > 0.5;
    if (burn || both0) {                                 // W+S at a standstill: hold the car on the spot (also during the 0.3 s arming)
      a = clamp(-vf * 8, -10, 10);
      this.reversing = false;
    } else if (both && Math.abs(vf) >= 2.5) {
      a = -Math.sign(vf) * T.brake;                    // both pedals: engine cut, full brake until we stop
      this.limiter = false; this.overrev = false;
    } else if (this.reversing) {
      if (brk > 0.05) a = -9 * brk * (vf > -T.reverseMax ? 1 : 0);
      if (thr > 0.05) a += 28 * thr;                     // throttle brakes the reverse roll
    } else {
      if (thr > 0 && this.shiftCut <= 0) {
        const g = T.gears[this.gear];
        a = g.acc * torqueCurve(rr) * thr * (this.nitroOn ? T.nitroAcc : 1) * (boosting ? 1.5 : 1);
        if (rr > 1.0) a = 0;
      }
      if (rr > 1.02) { a -= Math.min(18, (rr - 1) * 30); this.overrev = true; } else this.overrev = false;
      this.limiter = thr > 0.5 && rr > 0.985;
      if (brk > 0.05) {
        if (vf > 0.6) a -= T.brake * brk;
        else if (this.locked === false && speed < 3) { this.reversing = true; }
      }
    }
    // switching direction
    if (this.reversing && vf > -0.2 && thr > 0.05 && brk < 0.05) this.reversing = false;
    if (this.reversing && brk < 0.05 && thr < 0.05 && Math.abs(vf) < 0.3) this.reversing = false;
    if (!this.reversing && vf < -0.5) this.reversing = true;

    // drag + rolling resistance
    const sgn = Math.sign(vf);
    a -= sgn * (0.28 + 0.0003 * vf * vf);
    if (this.handbrake && !this.locked) a -= sgn * 3.2;
    if (this.locked) a -= sgn * 40;

    // traction limit (wheelspin when starting hard)
    const aMax = boosting ? 27 : 17.5;
    this.launchSpin = (a > aMax * 0.78 && Math.abs(vf) < 14) ? 1 : 0;
    a = clamp(a, -T.brake - 6, aMax);
    this.accG = burn ? 0 : a;

    // ---- surface
    const nr = track.nearest(this.x, this.z, this.nearest.i, this.nearest);
    const ad = Math.abs(nr.d);
    this.surface = ad <= HALF + 0.25 ? 'road' : ad <= HALF + CURB_W ? 'curb' : 'gravel';
    let surfGrip = 1;
    if (this.surface === 'gravel') {
      a -= sgn * (0.55 + 0.045 * Math.abs(vf)) * Math.min(1, Math.abs(vf) / 4) * 2.2;
      surfGrip = 0.62;
    } else if (this.surface === 'curb') surfGrip = 0.95;

    // ---- drift state
    const absSt = Math.abs(this.steer);
    let D = smooth(26, 46, Math.abs(vf)) * smooth(0.25, 0.9, absSt) * 0.7;
    if (this.handbrake && Math.abs(vf) > 6) D = Math.max(D, 0.95);
    if (this.nitroOn) D *= 0.85;
    if (this.oil > 0) D = Math.max(D, 0.85);
    if (this.reversing) D = 0;
    if (burn) D = 0.9;
    this.drift += (D - this.drift) * Math.min(1, dt * 9);
    const grip = lerp(T.gripBase, T.gripDrift, this.drift) * surfGrip * (this.oil > 0 ? 0.3 : 1);
    this.grip = grip;

    // ---- longitudinal
    vf += a * dt;
    if (!this.reversing && vf < 0 && a < 0) vf = Math.max(vf, 0);        // brakes alone can't push backwards
    if (this.reversing) vf = Math.max(vf, -T.reverseMax);
    if (this.nitroOn) {                                                  // no speed cap beyond nitro limit
      vf = Math.min(vf, gmax * 1.06);
    }

    if (Math.abs(vf) < 0.05 && thr < 0.05 && brk < 0.05) vf = 0;

    // ---- lateral (tyre grip) -> slip dissipates a bit of speed
    const vl0 = vl;
    vl *= Math.exp(-grip * dt);
    const lost = Math.abs(vl0 - vl);
    if (Math.abs(vf) > 1) vf -= Math.sign(vf) * lost * 0.1;
    this.vl = vl;
    this.slip = Math.abs(vl) / Math.max(Math.abs(vf), 6);
    this.latG = burn ? 0 : grip * vl;

    // ---- yaw
    let yawT = (vf / T.wheelBase) * Math.tan(this.steerAngle) * (1 + 0.38 * this.drift);
    const ymax = (T.latAccelMax * (this.drift > 0.4 ? 1.35 : 1)) / Math.max(Math.abs(vf), 6);
    yawT = clamp(yawT, -ymax, ymax * 1);
    if (this.handbrake && !this.locked) yawT *= 1.1;
    yawT = clamp(yawT, -1.25, 1.25);
    if (this.reversing) yawT = clamp(yawT, -0.8, 0.8);
    if (Math.abs(vf) < 0.6) yawT = 0;
    if (burn) yawT = -this.steer * 2.0;
    this.yaw += (yawT - this.yaw) * Math.min(1, dt * (this.drift > 0.4 ? 8 : 15));

    // ---- rebuild world velocity with the *old* heading, then rotate (inertia keeps the slide)
    this.vx = vf * fx + vl * lx;
    this.vz = vf * fz + vl * lz;
    this.psi += this.yaw * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.vf = vf;

    // ---- nitro tank
    if (this.nitroOn && !boosting) this.nitro = Math.max(0, this.nitro - T.nitroUse * dt);
    else this.nitro = Math.min(1, this.nitro + (T.nitroRegen + (this.drift > 0.5 ? 0.11 : 0)) * dt);

    // ---- jump
    if (this.jy > 0) {
      this.jv -= 18 * dt; this.jy += this.jv * dt;
      if (this.jy <= 0) { this.landVel = -this.jv; this.jy = 0; this.jv = 0; this.landEvent = true; }
    }

    // ---- walls
    this.wallHit(track, dt);

    // ---- engine rpm (0..1), smoothed
    let tr;
    if (this.reversing) tr = 0.2 + 0.5 * clamp(Math.abs(vf) / T.reverseMax, 0, 1) + 0.25 * thr;
    else {
      tr = 0.18 + 0.82 * clamp(rr, 0, 1.0);
      if (thr > 0.05 && rr < 0.2) tr = Math.max(tr, 0.18 + 0.62 * thr * (0.55 + 0.45 * rr / 0.2));   // clutch slip / launch
      if (this.shiftCut > 0) tr = Math.max(0.18, tr - 0.1);
      if (this.limiter) tr = 0.93 + (Math.sin(performance.now() * 0.06) > 0 ? 0.06 : 0);
    }
    if (this.overrev) tr = Math.min(1.08, 0.18 + 0.82 * rr);
    if (this.locked) tr = 0.18 + 0.75 * inp.throttle;
    if (burn) tr = 0.94;
    if (this.fire > 0) tr = 0.2;
    this.rpm += (tr - this.rpm) * Math.min(1, dt * (tr > this.rpm ? 10 : 6));

    // wheel spin for visuals
    this.wheelSpin = vf / T.wheelR;
    this.rearSpin = burn ? 60 : this.launchSpin ? this.wheelSpin * 2.2 + 12 : this.wheelSpin;
  }

  wallHit(track, dt) {
    const nr = this.nearest;
    track.nearest(this.x, this.z, nr.i, nr);
    const lim = WALL_D - 1.0;
    if (track.open ? nr.d * track.outerSg <= lim : Math.abs(nr.d) <= lim) { this.hit = Math.max(0, this.hit - dt * 3); return; }
    const sgn = Math.sign(nr.d);
    const L = track.L[nr.i];
    // push back inside
    const over = Math.abs(nr.d) - lim;
    this.x -= L.x * sgn * over; this.z -= L.z * sgn * over;
    const nx = -L.x * sgn, nz = -L.z * sgn;             // wall normal (towards track)
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      this.vx -= 1.2 * vn * nx; this.vz -= 1.2 * vn * nz;
      const tx = -nz, tz = nx;
      const vt = this.vx * tx + this.vz * tz;
      this.vx -= vt * tx * 0.12; this.vz -= vt * tz * 0.12;
      this.hit = Math.min(1, -vn / 20);
      this.hitEvent = Math.max(this.hitEvent || 0, -vn);
      this.dmg = (this.dmg || 0) + wallDamage(-vn);
      // turn the nose along the wall
      const wallAng = Math.atan2(tx, tz);
      let da = wallAng - this.psi; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > Math.PI / 2) da = Math.atan2(Math.sin(da + Math.PI), Math.cos(da + Math.PI));
      this.yaw += da * Math.min(1, -vn / 14) * 2.2;
      this.psi += da * Math.min(1, dt * 9);            // slide along the wall instead of digging in
    }
  }

  /** soft collision against other cars (3 circles each). `other` = {x,z,psi,vx,vz} */
  collide(o, pushShare = 1) {
    const rad = 1.0, offs = [-1.45, 0, 1.45];
    const sp = Math.sin(this.psi), cp = Math.cos(this.psi), so = Math.sin(o.psi), co = Math.cos(o.psi);
    let hit = false, impact = 0, share = 0.5;
    for (const a of offs) for (const b of offs) {
      const ax = this.x + sp * a, az = this.z + cp * a, bx = o.x + so * b, bz = o.z + co * b;
      let dx = ax - bx, dz = az - bz;
      const d = Math.hypot(dx, dz), min = rad * 2 - 0.1;
      if (d < min && d > 1e-4) {
        dx /= d; dz /= d;
        const pen = (min - d);
        this.x += dx * pen * 0.5 * pushShare; this.z += dz * pen * 0.5 * pushShare;
        const rvx = this.vx - (o.vx || 0), rvz = this.vz - (o.vz || 0);
        const vn = rvx * dx + rvz * dz;
        if (vn < 0) {
          if (-vn > impact) {          // strongest contact of this call (several circle pairs often touch at once); dx,dz point from the other car to this one
            impact = -vn;
            const mine = Math.max(0, -(this.vx * dx + this.vz * dz)), theirs = Math.max(0, (o.vx || 0) * dx + (o.vz || 0) * dz);
            share = mine + theirs > 0.01 ? theirs / (mine + theirs) : 0.5;
          }
          this.vx -= vn * dx * 0.9 * pushShare; this.vz -= vn * dz * 0.9 * pushShare;
          this.vx *= 0.995; this.vz *= 0.995;
          this.carHit = Math.max(this.carHit || 0, -vn);
          // small spin from off-centre contact
          const cross = (ax - this.x) * dz - (az - this.z) * dx;
          this.yaw += cross * vn * 0.012;
        }
        hit = true;
      }
    }
    if (impact > 0) this.dmg = (this.dmg || 0) + carDamage(impact, share) * (share <= 0.5 ? this.ramMul : this.hitMul);   // Charger: takes little damage when it rams, extra when it is hit
    return hit;
  }
}

// ---------------------------------------------------------------- visual
export class CarVisual {
  constructor(proto, def, paint = -1) {
    this.def = def;
    this.root = proto.clone(true);
    this.paint = -1;
    this.setPaint(paint);
    this.group = new THREE.Group();
    this.group.add(this.root);
    this.wheels = {};
    for (const k of ['LF', 'RF', 'LB', 'RB']) {
      this.wheels[k] = { steer: this.root.getObjectByName('steer_' + k), spin: this.root.getObjectByName('spin_' + k) };
    }
    this.far = false; this.proxy = null; this.lod = null;
    this.spinSign = def.front === '+z' ? 1 : -1;     // models whose nose was turned round spin the other way
    this.spinAngle = 0;
    this.roll = 0; this.pitch = 0;
    this.body = this.root;
  }

  /** Cheap stand-ins used in races: the real models are 60k–660k triangles each. */
  _lodMat() {
    const hex = this.paint >= 0 ? PAINTS[this.paint].hex : this.def.color;
    return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.35, metalness: 0.55 });
  }
  /** far away (> ~70 m): swap the detailed model for two boxes */
  setFar(far) {
    if (far === this.far) return;
    this.far = far;
    if (far && !this.lod) {
      const g = new THREE.Group(), m = this._lodMat();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.62, 4.3), m); body.position.set(0, 0.62, 0);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.0), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.2, metalness: 0.6 })); cab.position.set(0, 1.1, -0.15);
      const wl = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.5, 3.1), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.9 })); wl.position.set(0, 0.25, 0);
      g.add(body, cab, wl); g.userData.paintMat = m;
      this.lod = g; this.group.add(g);
    }
    if (this.lod) { this.lod.userData.paintMat.color.set(this.paint >= 0 ? PAINTS[this.paint].hex : this.def.color); this.lod.visible = far; }
    this.root.visible = !far;
  }
  /** shadows from a 12-triangle box instead of the full mesh (shadow pass would otherwise draw every car twice) */
  setShadowProxy(on) {
    if (on === !!this.proxy) return;
    this.root.traverse(o => { if (o.isMesh) o.castShadow = !on; });
    if (on) {
      const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
      const g = new THREE.Group();
      const a = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.7, 4.3), mat); a.position.set(0, 0.55, 0);
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.0), mat); b.position.set(0, 1.1, -0.15);
      a.castShadow = b.castShadow = true;
      g.add(a, b); this.proxy = g; this.group.add(g);
    } else if (this.proxy) { this.group.remove(this.proxy); this.proxy = null; }
  }

  /** body colour: index into PAINTS, or -1 for the factory colours */
  setPaint(idx) {
    idx = Number.isInteger(idx) ? idx : -1;
    if (idx === this.paint) return;
    this.paint = idx;
    applyPaint(this.root, this.def.paint, idx);
  }

  update(dt, s, extra = {}) {
    // s: {x,z,psi,steerAngle,wheelSpin,latG,accG,handbrake}
    this.group.position.set(s.x, s.jy || 0, s.z);
    this.group.rotation.set(0, s.psi, 0, 'YXZ');
    this.spinAngle += s.wheelSpin * dt;
    this.rearAngle = (this.rearAngle || 0) + (s.rearSpin ?? s.wheelSpin) * dt;
    const rear = s.handbrake ? 0 : 1;
    for (const k in this.wheels) {
      const w = this.wheels[k];
      if (!w.steer) continue;
      if (k[1] === 'F') w.steer.rotation.y = s.steerAngle;
      const base = k[1] === 'B' ? this.rearAngle : this.spinAngle;
      const ang = (k[1] === 'B' && !rear) ? (w.lock ?? (w.lock = base)) : base;
      if (k[1] === 'B' && rear) w.lock = undefined;
      w.spin.rotation.x = ang * this.spinSign;
    }
    // body roll / pitch (the whole model leans around the ground)
    const tr = clamp(-s.latG * 0.0045, -0.07, 0.07), tp = clamp(-s.accG * 0.0035, -0.05, 0.05);
    this.roll += (tr - this.roll) * Math.min(1, dt * 6);
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 6);
    // engine vibration: idling car trembles softly, revving on the spot (countdown / gas+brake) shakes hard
    this.t = (this.t || 0) + dt;
    const still = 1 - smooth(2, 12, Math.abs(s.speed ?? 0));
    const rev = clamp(((s.rpm ?? 0.18) - 0.2) / 0.7, 0, 1);
    this.shk = (this.shk || 0) + ((still * (0.0014 + 0.0045 * rev * rev + (s.burn ? 0.0022 : 0))) - (this.shk || 0)) * Math.min(1, dt * 14);
    const A = this.shk, t = this.t, hz = 20 + 38 * rev;                     // vibration gets faster with rpm
    const w1 = Math.sin(t * hz * 6.283), w2 = Math.sin(t * hz * 9.1 + 1.3), w3 = Math.sin(t * hz * 4.3 + 2.1);
    const sway = still * 0.0035 * Math.sin(t * 1.7);                          // slow idle breathing
    this.root.position.set(A * 0.7 * w2, A * w1, A * 0.5 * w3);
    this.root.rotation.set(this.pitch + A * 0.9 * w3 + sway * 0.4, 0, this.roll + A * 1.1 * w2 + sway, 'XYZ');
  }
}
