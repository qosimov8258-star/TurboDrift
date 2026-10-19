import * as THREE from 'three';

// =====================================================================================================================
//  Movable city vehicles + somersault visuals.
//   - PropCars: every parked / standing car of the city (see tools/city/build-world.mjs -> world.json `props`) is a light rigid
//     body. A driven car that hits one shoves it away: it slides, spins, and when the hit is hard it tumbles over and rolls
//     (it can end up on its side or on its roof). Props bump into each other and into buildings too.
//   - Tumbler: a purely visual somersault for driven cars / roadblock cars that crash into each other very hard.
// =====================================================================================================================
const G = 18;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MASS = { 'white sedan': 0.8, 'black sedan': 0.8, 'blue sedan': 0.8, suv: 1.1, van: 1.35, police: 0.95, 'fire truck': 3.2 };
const UNIT_OFFS = [-1.45, 0, 1.45], UNIT_R = 1.0;

// the six resting poses a toppled car can end in (local frame, relative to its original pose): wheels down, roof down, on either side, nose / tail down
const REST = [
  new THREE.Quaternion(),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
];
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _c = new THREE.Vector3(), _yaw = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export class PropCars {
  /** hooks: { impact(c, x, z, p) } */
  constructor(world, hooks = {}) {
    this.world = world; this.hooks = hooks; this.list = []; this.awake = [];
    for (const spec of world.m.props || []) {
      const piv = world.propPivot(spec); if (!piv) continue;
      const hh = spec.h / 2, hl = spec.hl, hw = spec.hw, rp = Math.max(0.95, hw), po = Math.max(0, hl - rp);
      this.list.push({
        idx: this.list.length, spec, piv, hl, hw, hh, rp, offs: po > 0.3 ? [-po, 0, po] : [0], mass: MASS[spec.kind] ?? 1,
        x: spec.x, z: spec.z, psi: spec.psi, vx: 0, vz: 0, yaw: 0, cy: hh, vy: 0, minCY: hh,
        q: new THREE.Quaternion(), av: new THREE.Vector3(), awake: false, bumpT: 0,
      });
    }
    this.corners = [];
  }

  /** back to the original parked positions (new mission) */
  reset() {
    for (const p of this.list) {
      p.x = p.spec.x; p.z = p.spec.z; p.psi = p.spec.psi; p.vx = p.vz = p.yaw = p.vy = 0; p.cy = p.minCY = p.hh;
      p.q.identity(); p.av.set(0, 0, 0); p.awake = false; this.place(p);
    }
    this.awake.length = 0;
  }

  /** lowest point of the box (relative to its centre) in the current tilt */
  lowest(p) {
    let low = 1e9;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { _v.set(sx * p.hw, sy * p.hh, sz * p.hl).applyQuaternion(p.q); if (_v.y < low) low = _v.y; }
    return -low;
  }

  /** write the rigid-body state into the model's pivot (rotation about the box centre) */
  place(p) {
    _yaw.setFromAxisAngle(_up, p.psi); _q.copy(_yaw).multiply(p.q);
    _c.set(0, p.hh, 0).applyQuaternion(_q);
    p.piv.quaternion.copy(_q);
    p.piv.position.set(p.x - _c.x, p.cy - _c.y, p.z - _c.z);
  }

  wake(p) { if (!p.awake) { p.awake = true; this.awake.push(p); } }

  /** knock a prop: velocity change along (nx, nz) and, for hard hits, a hop + somersault */
  knock(p, nx, nz, speed, off = 0) {
    this.wake(p);
    p.vx += nx * speed; p.vz += nz * speed;
    p.yaw += clamp(off * speed * 0.06, -2.5, 2.5);
    this.tumble(p, nx, nz, speed);
  }

  /** hop and roll about a horizontal axis perpendicular to the push (the car rolls over in the direction it is thrown) */
  tumble(p, nx, nz, speed) {
    if (speed <= 4.5) return;
    this.wake(p);
    const hop = clamp((speed - 4) * 0.22, 0, 5.5); if (hop > p.vy) p.vy = hop;
    const sp = Math.sin(p.psi), cp = Math.cos(p.psi), lx = nx * cp - nz * sp, lz = nx * sp + nz * cp;       // push direction in the car's frame
    const w = clamp((speed - 4.5) * 0.55, 0, 9) * (0.6 + Math.random() * 0.8);
    p.av.x += lz * w; p.av.z += -lx * w; p.av.y += (Math.random() - 0.5) * 0.6;
  }

  // ------------------------------------------------------------------ main step (called with the sub-step of the mission loop)
  /** units: mission units ({ v?, state, dead }) */
  step(units, dt) {
    const world = this.world;
    // ---- driven cars against props
    for (const u of units) {
      if (u.dead) continue;
      const v = u.v, s = v || u.state; if (!s) continue;
      const ux = v ? v.x : s.x, uz = v ? v.z : s.z, upsi = v ? v.psi : s.psi, uvx = v ? v.vx : s.vx || 0, uvz = v ? v.vz : s.vz || 0;
      const usp = Math.sin(upsi), ucp = Math.cos(upsi);
      for (const p of this.list) {
        if (Math.abs(p.x - ux) > 8 || Math.abs(p.z - uz) > 8) continue;
        const psp = Math.sin(p.psi), pcp = Math.cos(p.psi), iu = 1, ip = 1 / p.mass, isum = iu + ip;
        let best = 0, bnx = 0, bnz = 0, boff = 0;
        for (const a of UNIT_OFFS) for (const b of p.offs) {
          const ax = ux + usp * a, az = uz + ucp * a, bx = p.x + psp * b, bz = p.z + pcp * b;
          let dx = bx - ax, dz = bz - az; const d = Math.hypot(dx, dz), min = UNIT_R + p.rp - 0.12;
          if (d >= min || d < 1e-4) continue;
          dx /= d; dz /= d; const pen = min - d;
          p.x += dx * pen * ip / isum; p.z += dz * pen * ip / isum;
          if (v) { v.x -= dx * pen * iu / isum; v.z -= dz * pen * iu / isum; }
          const c = (uvx - p.vx) * dx + (uvz - p.vz) * dz;
          if (c > best) { best = c; bnx = dx; bnz = dz; boff = (bx - p.x) * dz - (bz - p.z) * dx; }
          this.wake(p);
        }
        if (best > 0.2) {
          const j = 1.35 * best / isum;
          this.knock(p, bnx, bnz, j * ip, boff);
          if (v) { v.vx -= bnx * j * iu; v.vz -= bnz * j * iu; if (best > 7) v.dmg = (v.dmg || 0) + Math.min(6, (best - 7) * 0.22); }
          if (best > 3 && p.bumpT <= 0) { p.bumpT = 0.25; this.hooks.impact?.(best, p.x, p.z, p, u); }
        }
      }
    }
    // ---- integrate the moving props
    for (let i = this.awake.length - 1; i >= 0; i--) {
      const p = this.awake[i];
      p.bumpT = Math.max(0, p.bumpT - dt);
      p.x += p.vx * dt; p.z += p.vz * dt; p.psi += p.yaw * dt;
      const ground = p.cy <= p.minCY + 0.03 && p.vy <= 0.5, sp = Math.hypot(p.vx, p.vz);
      if (ground) {
        const dec = (p.av.lengthSq() > 0.5 ? 3 : 7.5) * dt;
        if (sp > dec) { p.vx -= p.vx / sp * dec; p.vz -= p.vz / sp * dec; } else { p.vx = p.vz = 0; }
        p.yaw *= Math.exp(-dt * 3.2); p.av.multiplyScalar(Math.exp(-dt * 2.4));
      }
      p.vy -= G * dt; p.cy += p.vy * dt;
      const w = p.av.length();
      if (w > 1e-3) { _q2.setFromAxisAngle(_v.copy(p.av).normalize(), w * dt); p.q.multiply(_q2).normalize(); }
      p.minCY = this.lowest(p);
      if (p.cy < p.minCY) {
        p.cy = p.minCY;
        if (p.vy < -1.6) { if (p.bumpT <= 0) { p.bumpT = 0.2; this.hooks.impact?.(-p.vy * 1.4, p.x, p.z, p, null); } p.vy = -p.vy * 0.2; p.av.multiplyScalar(0.78); p.vx *= 0.9; p.vz *= 0.9; } else p.vy = 0;
      }
      // buildings stop a shoved car (and a hard hit knocks it over)
      const psp = Math.sin(p.psi), pcp = Math.cos(p.psi);
      for (const off of p.offs) {
        const ox = p.x + psp * off, oz = p.z + pcp * off, d = world.dist(ox, oz, true);
        if (d < p.rp) {
          const n = world.grad(ox, oz, undefined, true), pen = p.rp - d; p.x += n.x * pen; p.z += n.z * pen;
          const vn = p.vx * n.x + p.vz * n.z;
          if (vn < 0) { const c = -vn; p.vx -= vn * n.x * 1.3; p.vz -= vn * n.z * 1.3; if (c > 6) this.tumble(p, n.x, n.z, c * 0.9); if (c > 3 && p.bumpT <= 0) { p.bumpT = 0.25; this.hooks.impact?.(c * 0.8, p.x, p.z, p, null); } }
        }
      }
      // props against props (chain reactions)
      for (const q of this.list) {
        if (q === p || Math.abs(q.x - p.x) > 7 || Math.abs(q.z - p.z) > 7) continue;
        if (q.awake && q.idx < p.idx) continue;                     // each awake pair once
        const qsp = Math.sin(q.psi), qcp = Math.cos(q.psi), ip = 1 / p.mass, iq = 1 / q.mass, isum = ip + iq;
        let best = 0, bnx = 0, bnz = 0;
        for (const a of p.offs) for (const b of q.offs) {
          const ax = p.x + psp * a, az = p.z + pcp * a, bx = q.x + qsp * b, bz = q.z + qcp * b;
          let dx = bx - ax, dz = bz - az; const d = Math.hypot(dx, dz), min = p.rp + q.rp - 0.12;
          if (d >= min || d < 1e-4) continue;
          dx /= d; dz /= d; const pen = min - d;
          p.x -= dx * pen * ip / isum; p.z -= dz * pen * ip / isum; q.x += dx * pen * iq / isum; q.z += dz * pen * iq / isum;
          const c = (p.vx - q.vx) * dx + (p.vz - q.vz) * dz; if (c > best) { best = c; bnx = dx; bnz = dz; }
        }
        if (best > 0.3) {
          const j = 1.3 * best / isum;
          p.vx -= bnx * j * ip; p.vz -= bnz * j * ip; this.knock(q, bnx, bnz, j * iq, 0);
          if (best > 3 && q.bumpT <= 0) { q.bumpT = 0.25; this.hooks.impact?.(best * 0.8, q.x, q.z, q, null); }
        }
      }
      // sleep: settle into the nearest resting pose first
      const still = Math.hypot(p.vx, p.vz) < 0.15 && Math.abs(p.yaw) < 0.06 && p.av.length() < 0.25 && p.cy <= p.minCY + 0.03;
      if (still) {
        let bd = -1, bq = REST[0];
        for (const r of REST) { const d = Math.abs(p.q.dot(r)); if (d > bd) { bd = d; bq = r; } }
        p.q.slerp(bq, 1 - Math.exp(-dt * 9));
        if (Math.abs(p.q.dot(bq)) > 0.99995) { p.q.copy(bq); p.vx = p.vz = p.yaw = p.vy = 0; p.av.set(0, 0, 0); p.minCY = this.lowest(p); p.cy = p.minCY; p.awake = false; this.awake.splice(i, 1); }
      }
    }
  }

  /** once per frame: push the awake props' transforms to the models */
  updateVisuals() { for (const p of this.awake) this.place(p); }
}

// ---------------------------------------------------------------------------------------------------------------------
/** Visual somersault for a driven / roadblock car: a quick hop with a full roll (big hits) or a heavy wobble (medium hits). */
export class Tumbler {
  constructor(centre = 0.7, halfWidth = 0.95) { this.hc = centre; this.hw = halfWidth; this.act = false; this.t = 0; this.T = 1; this.roll = 0; this.pitch = 0; this.y = 0; this.target = 0; this.hop = 0; this.cool = 0; this.big = false; }
  /** power 0..1, side +-1 (which way it rolls). Returns true when a new tumble started. */
  trigger(power, side = 1) {
    if (this.act || this.cool > 0) return false;
    this.act = true; this.t = 0; this.cool = 2.6; this.big = power > 0.5; this.pw = power;
    this.T = this.big ? 1.2 : 0.7; this.target = this.big ? side * Math.PI * 2 : side * (0.4 + 0.45 * power);
    this.hop = this.big ? 1.1 + power * 1.4 : 0.2 + power * 0.5;
    return true;
  }
  update(dt) {
    this.cool = Math.max(0, this.cool - dt);
    if (!this.act) return;
    this.t += dt; const u = Math.min(1, this.t / this.T), e = u * u * (3 - 2 * u);
    this.roll = this.big ? this.target * e : this.target * Math.sin(Math.PI * u);
    this.pitch = (this.big ? 0.22 : 0.08) * Math.sin(Math.PI * 2 * u) * (this.target < 0 ? -1 : 1);
    this.y = this.hop * 4 * u * (1 - u);
    if (u >= 1) { this.act = false; this.roll = this.pitch = this.y = 0; }
  }
  /** after CarVisual.update(): add the somersault on top of the pose */
  apply(group) {
    if (!this.act) return;
    group.rotation.z = this.roll; group.rotation.x = this.pitch;
    _c.set(0, this.hc, 0); _v.copy(_c).applyQuaternion(group.quaternion);
    const lift = Math.max(0, this.hw * Math.abs(Math.sin(this.roll)) + this.hc * Math.abs(Math.cos(this.roll)) - this.hc);
    group.position.x += _c.x - _v.x; group.position.y += _c.y - _v.y + this.y + lift; group.position.z += _c.z - _v.z;
  }
}
