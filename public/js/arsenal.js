import * as THREE from 'three';
import { ABILITIES, AB } from './abilities.js';

// Battle-arena weapons and defences.
//
// Networking model: an ability press is broadcast ({t:'ab'}); EVERY client then simulates the shot / mine / shield locally.
// Damage and impulses are only applied to cars this client simulates itself (me, and the bots when I am the host), so each
// car is hurt exactly once, by the machine that owns it. Remote cars only get the visuals.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const BOX_L = 2.25, BOX_W = 1.05;                 // half length / half width of a car's hit box

/** is the point (x,z) inside the car's box (grown by `pad`)? */
function hitBox(s, x, z, pad) {
  const dx = x - s.x, dz = z - s.z, sp = Math.sin(s.psi), cp = Math.cos(s.psi);
  return Math.abs(dx * sp + dz * cp) < BOX_L + pad && Math.abs(dx * cp - dz * sp) < BOX_W + pad;
}

const basic = (color, opacity = 1, additive = true) => new THREE.MeshBasicMaterial({
  color, transparent: opacity < 1 || additive, opacity, depthWrite: false, side: THREE.DoubleSide,
  blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
});

export class Arsenal {
  constructor(race) {
    this.race = race; this.scene = race.scene; this.t = 0;
    this.bullets = []; this.missiles = []; this.mines = []; this.oils = []; this.bombs = []; this.rings = []; this.beams = [];
    this.auras = new Map();
    this.root = new THREE.Group(); this.scene.add(this.root);

    // ---- shared geometry / materials
    this.gBullet = new THREE.BoxGeometry(0.08, 0.08, 2.8);
    this.mBullet = basic(0xffd36b, 1);
    this.gRing = new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2);
    this.gDisc = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    this.gBeam = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    this.gMissileBody = new THREE.CylinderGeometry(0.16, 0.16, 1.7, 10).rotateX(Math.PI / 2);
    this.gMissileNose = new THREE.ConeGeometry(0.16, 0.55, 10).rotateX(Math.PI / 2).translate(0, 0, 1.12);
    this.gFin = new THREE.BoxGeometry(0.04, 0.5, 0.45);
    this.mMissile = new THREE.MeshStandardMaterial({ color: 0xcfd3da, metalness: 0.7, roughness: 0.35 });
    this.mMissileNose = new THREE.MeshStandardMaterial({ color: 0xe53935, metalness: 0.4, roughness: 0.4 });
    this.gMine = new THREE.CylinderGeometry(1.0, 1.15, 0.22, 20);
    this.mMine = new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.8, roughness: 0.45 });
    this.gLamp = new THREE.SphereGeometry(0.17, 10, 8);
    this.mLampOn = new THREE.MeshBasicMaterial({ color: 0xff2a2a }); this.mLampOff = new THREE.MeshBasicMaterial({ color: 0x4a0e0e });
    this.gBomb = new THREE.SphereGeometry(0.38, 14, 10);
    this.mBomb = new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.7, roughness: 0.35 });
    this.gSpark = new THREE.SphereGeometry(0.1, 8, 6); this.mSpark = new THREE.MeshBasicMaterial({ color: 0xffa238 });
    this.gOil = new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2);
    this.gAura = new THREE.SphereGeometry(1, 28, 18);
  }

  // ------------------------------------------------------------------ lifecycle
  reset() {
    this.t = 0;
    for (const list of [this.bullets, this.missiles, this.mines, this.oils, this.bombs, this.rings, this.beams]) {
      for (const o of list) this._drop(o);
      list.length = 0;
    }
    for (const m of this.auras.values()) { this.root.remove(m); m.material.dispose(); }
    this.auras.clear();
  }
  _drop(o) {
    const m = o.obj; if (!m) return;
    this.root.remove(m);
    if (o.ownMats) for (const mt of o.ownMats) mt.dispose();
  }
  initRacer(r) {
    r.cd = ABILITIES.map(() => 0);
    r.fx = { shield: 0, armor: 0, magnet: 0, repair: 0, repairUntil: 0, burst: null, aiT: 0.8 + Math.random(), aiLast: -9 };
  }
  onKill(r) {
    if (r.fx) { r.fx.shield = r.fx.armor = r.fx.magnet = r.fx.repair = r.fx.repairUntil = 0; r.fx.burst = null; }
    this._aura(r, null);
  }
  origin(r) { const s = r.state; return { x: s.x, z: s.z, psi: s.psi, vx: s.vx, vz: s.vz }; }

  /** HUD data for the player's own hot-bar */
  hudState(me) {
    const f = me.fx, v = me.v, t = this.t;
    const on = [!!f.burst, false, false, f.shield > t, f.repairUntil > t, !!(v && v.boost > 0), false, false, false, false, f.armor > t, f.magnet > t];
    return me.loadout.map(i => ({ left: Math.max(0, me.cd[i] - t), cd: ABILITIES[i].cd, on: on[i] }));
  }

  /** damage multiplier of a car: shield blocks everything, armour halves it */
  guard(r, d = 0) {
    const f = r.fx; if (!f) return 1;
    if (f.shield > this.t) { if (d > 1.2) this._blockFx(r); return 0; }
    return f.armor > this.t ? 0.5 : 1;
  }
  _blockFx(r) {
    const s = r.state, R = this.race;
    if (this.t - (r.fx.blockAt || -9) < 0.12) return;
    r.fx.blockAt = this.t;
    for (let q = 0; q < 10; q++) {
      const a = Math.random() * 6.283;
      R.sparks.emit(s.x + Math.cos(a) * 1.8, 0.4 + Math.random() * 1.2, s.z + Math.sin(a) * 2.8, Math.cos(a) * 7, 1 + Math.random() * 3, Math.sin(a) * 7, 0.35 + Math.random() * 0.3, 0.3, 0.1, 1, 0.35, 0.85, 1);
    }
    if (r.kind === 'me') R.audio.beep?.(1250, 0.05, 0.1);
  }

  // ------------------------------------------------------------------ activation (own press, bot, or a remote's message)
  /** returns false when nothing happened (no cool-down is spent) */
  activate(r, k, o) {
    const ab = ABILITIES[k];
    if (!ab || r.dead) return false;
    const R = this.race, t = this.t, f = r.fx, fx = Math.sin(o.psi), fz = Math.cos(o.psi), local = !!r.v;
    switch (ab.id) {
      case 'gun': f.burst = { n: 14, next: t }; break;
      case 'missile': this._spawnMissile(r, o); break;
      case 'mine': this._spawnMine(r, o); break;
      case 'shield': f.shield = t + 4.5; this._ringAt(o.x, o.z, 1, 3.4, 0.5, 0x59d5ff, 0.7); if (r.kind === 'me') R.audio.beep?.(520, 0.25, 0.14); break;
      case 'repair':
        if (local && r.hp >= 99) { if (r.kind === 'me') R.msg('Jon to\'liq', 900, 'small'); return false; }
        f.repair = 30; f.repairUntil = t + 4; if (r.kind === 'me') R.audio.beep?.(740, 0.2, 0.12); break;
      case 'turbo': if (local) r.v.boost = 2.4; this._ringAt(o.x - fx * 2, o.z - fz * 2, 0.5, 4, 0.35, 0xffa23a, 0.8); if (r.kind === 'me') R.shake = Math.max(R.shake, 0.4); break;
      case 'oil': this._spawnOil(r, o); break;
      case 'emp': this._emp(r, o); break;
      case 'bomb': this._spawnBomb(r, o); break;
      case 'laser': this._laser(r, o); break;
      case 'armor': f.armor = t + 10; this._ringAt(o.x, o.z, 1, 3.2, 0.5, 0xffc23a, 0.7); if (r.kind === 'me') R.audio.beep?.(330, 0.3, 0.14); break;
      case 'magnet':
        f.magnet = t + 1.6;
        for (let q = 0; q < 3; q++) this._ringAt(o.x, o.z, 50, 3, 0.9, 0xb36bff, 0.7, q * 0.28);
        if (r.kind === 'me') R.audio.beep?.(260, 0.4, 0.14);
        break;
      default: return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ spawners
  _spawnMissile(r, o) {
    const fx = Math.sin(o.psi), fz = Math.cos(o.psi);
    let target = null, best = 1e9;
    for (const e of this.race.racers.values()) {
      if (e === r || e.dead) continue;
      const dx = e.state.x - o.x, dz = e.state.z - o.z, d = Math.hypot(dx, dz);
      if (d > 130) continue;
      const ang = Math.abs(wrapA(Math.atan2(dx, dz) - o.psi));
      if (ang > 0.75) continue;
      const sc = d + ang * 45; if (sc < best) { best = sc; target = e; }
    }
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.gMissileBody, this.mMissile), new THREE.Mesh(this.gMissileNose, this.mMissileNose));
    for (const rot of [0, Math.PI / 2]) { const fin = new THREE.Mesh(this.gFin, this.mMissileNose); fin.position.z = -0.75; fin.rotation.z = rot; g.add(fin); }
    g.position.set(o.x + fx * 3, 0.85, o.z + fz * 3); g.rotation.y = o.psi;
    this.root.add(g);
    const sp0 = Math.max(Math.hypot(o.vx, o.vz), 20) + 12;
    this.missiles.push({ obj: g, owner: r, target, x: o.x + fx * 3, z: o.z + fz * 3, ang: o.psi, speed: sp0, life: 4.2 });
    this._noise(o.x, o.z, 0.3, 700, 0.3, 'bandpass');
  }
  _spawnMine(r, o) {
    const fx = Math.sin(o.psi), fz = Math.cos(o.psi);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.gMine, this.mMine));
    const lamp = new THREE.Mesh(this.gLamp, this.mLampOn); lamp.position.y = 0.2; g.add(lamp);
    g.position.set(o.x - fx * 3.4, 0.13, o.z - fz * 3.4);
    this.root.add(g);
    const mine = { obj: g, lamp, owner: r, x: g.position.x, z: g.position.z, armAt: this.t + 0.8, life: 45 };
    this.mines.push(mine);
    const mine5 = this.mines.filter(m => m.owner === r);        // at most 5 live mines per car: the oldest goes away
    if (mine5.length > 5) this._removeFrom(this.mines, mine5[0]);
  }
  _spawnOil(r, o) {
    const fx = Math.sin(o.psi), fz = Math.cos(o.psi);
    const m = new THREE.MeshStandardMaterial({ color: 0x06070a, roughness: 0.12, metalness: 0.65, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mesh = new THREE.Mesh(this.gOil, m);
    const rad = 5.2;
    mesh.position.set(o.x - fx * 4, 0.05, o.z - fz * 4); mesh.scale.set(rad * (0.92 + Math.random() * 0.16), 1, rad * (0.92 + Math.random() * 0.16)); mesh.rotation.y = Math.random() * 6.28;
    this.root.add(mesh);
    this.oils.push({ obj: mesh, ownMats: [m], mat: m, owner: r, x: mesh.position.x, z: mesh.position.z, rad, life: 16 });
  }
  _spawnBomb(r, o) {
    const fx = Math.sin(o.psi), fz = Math.cos(o.psi);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.gBomb, this.mBomb));
    const sp = new THREE.Mesh(this.gSpark, this.mSpark); sp.position.y = 0.42; g.add(sp);
    g.position.set(o.x + fx * 2.2, 1.1, o.z + fz * 2.2);
    this.root.add(g);
    this.bombs.push({ obj: g, owner: r, x: g.position.x, y: 1.1, z: g.position.z, vx: fx * 27 + o.vx * 0.85, vz: fz * 27 + o.vz * 0.85, vy: 13 });
  }
  _emp(r, o) {
    this._ringAt(o.x, o.z, 2, 30, 0.5, 0x6fe3ff, 0.9);
    this._ringAt(o.x, o.z, 1, 22, 0.4, 0xffffff, 0.6, 0.05);
    const R = this.race;
    for (const e of R.racers.values()) {
      if (e === r || e.dead) continue;
      const s = e.state, d = Math.hypot(s.x - o.x, s.z - o.z);
      if (d > 28) continue;
      for (let q = 0; q < 14; q++) R.sparks.emit(s.x + (Math.random() - 0.5) * 2, 0.3 + Math.random() * 1.2, s.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 9, 1 + Math.random() * 5, (Math.random() - 0.5) * 9, 0.5 + Math.random() * 0.4, 0.3, 0.1, 1, 0.45, 0.9, 1);
      if (!e.v) continue;
      if (e.fx.shield > this.t) { this._blockFx(e); continue; }
      e.v.stun = Math.max(e.v.stun || 0, 2.1 - 0.9 * d / 28);
      e.v.yaw += (Math.random() - 0.5) * 1.6;
      R.hurt(e, 9 * (1 - 0.5 * d / 28));
    }
    this._noise(o.x, o.z, 0.7, 1800, 0.35, 'highpass');
  }
  _laser(r, o) {
    const fx = Math.sin(o.psi), fz = Math.cos(o.psi), RANGE = 80;
    const sx = o.x + fx * 2.3, sz = o.z + fz * 2.3;
    let hit = null, ht = RANGE;
    for (const e of this.race.racers.values()) {
      if (e === r || e.dead) continue;
      const dx = e.state.x - sx, dz = e.state.z - sz;
      const t = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (t > 0 && t < ht && lat < 1.5) { ht = t; hit = e; }
    }
    const len = hit ? ht : RANGE;
    const grp = new THREE.Group(), mO = basic(0xff2a4a, 0.55), mI = basic(0xffffff, 1);
    const outer = new THREE.Mesh(this.gBeam, mO), inner = new THREE.Mesh(this.gBeam, mI);
    outer.scale.set(0.34, 0.34, len); inner.scale.set(0.1, 0.1, len);
    grp.add(outer, inner); grp.position.set(sx, 0.75, sz); grp.rotation.y = o.psi;
    this.root.add(grp);
    this.beams.push({ obj: grp, ownMats: [mO, mI], mats: [mO, mI], life: 0.28, max: 0.28 });
    if (hit) {
      const hx = sx + fx * len, hz = sz + fz * len, R = this.race;
      for (let q = 0; q < 16; q++) R.sparks.emit(hx, 0.7, hz, (Math.random() - 0.5) * 14, 1 + Math.random() * 6, (Math.random() - 0.5) * 14, 0.4 + Math.random() * 0.3, 0.3, 0.1, 1, 1, 0.5, 0.5);
      if (hit.v) { R.hurt(hit, 20); if (hit.fx.shield <= this.t) { hit.v.vx += fx * 2; hit.v.vz += fz * 2; } }
    }
    this._noise(o.x, o.z, 0.5, 2600, 0.3, 'highpass');
  }

  // ------------------------------------------------------------------ small helpers
  _removeFrom(list, o) { const i = list.indexOf(o); if (i >= 0) list.splice(i, 1); this._drop(o); }
  _ringAt(x, z, r0, r1, dur, color, op = 0.8, delay = 0) {
    const grp = new THREE.Group();
    const mR = basic(color, op), mD = basic(color, op * 0.18);
    grp.add(new THREE.Mesh(this.gRing, mR), new THREE.Mesh(this.gDisc, mD));
    grp.position.set(x, 0.3, z); grp.scale.set(r0, 1, r0); grp.visible = delay <= 0;
    this.root.add(grp);
    this.rings.push({ obj: grp, ownMats: [mR, mD], mats: [mR, mD], ops: [op, op * 0.18], t: -delay, dur, r0, r1 });
  }
  _noise(x, z, vol, freq, dur, type) {
    const R = this.race, me = R.me; if (!me) return;
    const d = Math.hypot(x - me.state.x, z - me.state.z);
    if (d > 120) return;
    R.audio.noiseBurst?.(dur, freq, vol * (1 - d / 120), type);
  }
  /** explosion: damage + knock-back to every locally simulated car in reach, fire / smoke / sparks for everyone */
  _blast(x, z, radius, dmg, owner, knock, y = 0.6) {
    const R = this.race;
    for (const e of R.racers.values()) {
      if (e === owner || e.dead) continue;
      const s = e.state, dx = s.x - x, dz = s.z - z, d = Math.hypot(dx, dz), reach = radius + 1.6;
      if (d > reach || !e.v) continue;
      const k = 1 - d / reach;
      R.hurt(e, dmg * (0.4 + 0.6 * k));
      if (e.fx.shield > this.t) continue;
      const nx = d > 0.01 ? dx / d : 0, nz = d > 0.01 ? dz / d : 1;
      e.v.vx += nx * knock * k; e.v.vz += nz * knock * k;
      e.v.yaw += (Math.random() - 0.5) * 4 * k;
    }
    const big = radius / 7;
    for (let q = 0; q < 70 * big; q++) {
      const a = Math.random() * 6.283, sp = (3 + Math.random() * 12) * big;
      R.fire.emit(x + (Math.random() - 0.5) * 1.5, y + Math.random() * 0.6, z + (Math.random() - 0.5) * 1.5, Math.cos(a) * sp, 1 + Math.random() * 8 * big, Math.sin(a) * sp, 0.4 + Math.random() * 0.5, 0.6, 3.5 + Math.random() * 3 * big, 1.0, 1.0, 0.65 + Math.random() * 0.3, 0.2 + Math.random() * 0.3);
    }
    for (let q = 0; q < 30 * big; q++) {
      const a = Math.random() * 6.283, sp = (2 + Math.random() * 7) * big;
      R.smoke.emit(x, y + 0.4, z, Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp, 1.2 + Math.random(), 1.4, 6 + Math.random() * 3, 0.65, 0.12, 0.12, 0.12);
    }
    for (let q = 0; q < 26 * big; q++) R.sparks.emit(x, y + 0.3, z, (Math.random() - 0.5) * 24 * big, 3 + Math.random() * 9, (Math.random() - 0.5) * 24 * big, 0.6 + Math.random() * 0.5, 0.35, 0.1, 1, 1, 0.8, 0.3);
    this._ringAt(x, z, 1, radius, 0.35, 0xffb347, 0.85);
    const me = R.me;
    if (me) {
      const d = Math.hypot(x - me.state.x, z - me.state.z);
      if (d < 70) { const k = 1 - d / 70; R.shake = Math.max(R.shake, 0.9 * k + 0.1); R.audio.thump?.(0.5 + 1.6 * k * big); }
    }
  }

  // ------------------------------------------------------------------ simulation step (fixed, 1/120 s)
  step(dt) {
    this.t += dt;
    const R = this.race, t = this.t;
    const cars = R.racers;

    // pulemyot bursts
    for (const r of cars.values()) {
      const b = r.fx && r.fx.burst; if (!b) continue;
      if (r.dead) { r.fx.burst = null; continue; }
      while (b.n > 0 && t >= b.next) {
        b.n--; b.next += 0.065;
        const s = r.state, sp = Math.sin(s.psi), cp = Math.cos(s.psi), spread = (Math.random() - 0.5) * 0.03;
        const a = s.psi + spread, bx = Math.sin(a), bz = Math.cos(a);
        const mesh = new THREE.Mesh(this.gBullet, this.mBullet);
        const x = s.x + sp * 2.4, z = s.z + cp * 2.4;
        mesh.position.set(x, 0.75, z); mesh.rotation.y = a;
        this.root.add(mesh);
        this.bullets.push({ obj: mesh, owner: r, x, z, vx: bx * 170 + s.vx, vz: bz * 170 + s.vz, life: 0.8 });
        R.fire.emit(x, 0.75, z, sp * 6, 0.2, cp * 6, 0.08, 0.5, 1.1, 0.9, 1, 0.85, 0.4);
        if (b.n % 3 === 0) this._noise(x, z, 0.16, 3200, 0.04, 'highpass');
      }
      if (b.n <= 0) r.fx.burst = null;
    }

    // bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt;
      b.obj.position.x = b.x; b.obj.position.z = b.z;
      let hit = null;
      for (const e of cars.values()) if (e !== b.owner && !e.dead && hitBox(e.state, b.x, b.z, 0.25)) { hit = e; break; }
      if (hit) {
        if (hit.v) {
          R.hurt(hit, 3.4);
          if (hit.fx.shield <= t) { hit.v.vx += b.vx * 0.004; hit.v.vz += b.vz * 0.004; }
        }
        for (let q = 0; q < 4; q++) R.sparks.emit(b.x, 0.7, b.z, (Math.random() - 0.5) * 10, 1 + Math.random() * 4, (Math.random() - 0.5) * 10, 0.3 + Math.random() * 0.2, 0.25, 0.1, 1, 1, 0.7, 0.3);
      }
      if (hit || b.life <= 0) this._removeFrom(this.bullets, b);
    }

    // missiles (home in on the locked car, turn rate is limited so a good driver can dodge)
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt; m.speed = Math.min(88, m.speed + 70 * dt);
      if (m.target && !m.target.dead) {
        const s = m.target.state, des = Math.atan2(s.x - m.x, s.z - m.z);
        m.ang += clamp(wrapA(des - m.ang), -2.5 * dt, 2.5 * dt);
      }
      const dx = Math.sin(m.ang), dz = Math.cos(m.ang);
      m.x += dx * m.speed * dt; m.z += dz * m.speed * dt;
      m.obj.position.set(m.x, 0.85, m.z); m.obj.rotation.y = m.ang;
      R.fire.emit(m.x - dx * 1.1, 0.85, m.z - dz * 1.1, -dx * 8 + (Math.random() - 0.5), (Math.random() - 0.5) * 0.8, -dz * 8 + (Math.random() - 0.5), 0.18, 0.5, 1.4, 1, 1, 0.65, 0.2);
      if (Math.random() < 0.45) R.smoke.emit(m.x - dx * 1.4, 0.85, m.z - dz * 1.4, (Math.random() - 0.5) * 0.8, 0.3, (Math.random() - 0.5) * 0.8, 0.9, 0.6, 2.2, 0.35, 0.7, 0.7, 0.72);
      let hit = null;
      for (const e of cars.values()) if (e !== m.owner && !e.dead && hitBox(e.state, m.x, m.z, 0.9)) { hit = e; break; }
      if (hit || m.life <= 0) { this._blast(m.x, m.z, 7, 26, m.owner, 15); this._removeFrom(this.missiles, m); }
    }

    // grenades (a lobbed arc, explode when they land)
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.vy -= 24 * dt; b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
      b.obj.position.set(b.x, Math.max(b.y, 0.2), b.z); b.obj.rotation.x += dt * 9;
      if (Math.random() < 0.5) R.fire.emit(b.x, b.y + 0.4, b.z, 0, 0.5, 0, 0.18, 0.25, 0.7, 0.9, 1, 0.6, 0.2);
      if (b.y <= 0.15 && b.vy < 0) { this._blast(b.x, b.z, 10, 28, b.owner, 21); this._removeFrom(this.bombs, b); }
    }

    // mines (also vanish when a remote car drives over them, so every screen stays in step)
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.life -= dt;
      m.lamp.material = (t * 3 % 1) < 0.5 ? this.mLampOn : this.mLampOff;
      if (m.life <= 0) { this._removeFrom(this.mines, m); continue; }
      if (t < m.armAt) continue;
      let hit = null;
      for (const e of cars.values()) if (e !== m.owner && !e.dead && hitBox(e.state, m.x, m.z, 0.5) && !(e.v && e.v.jy > 0.9)) { hit = e; break; }
      if (hit) { this._blast(m.x, m.z, 7.5, 30, m.owner, 17, 0.4); this._removeFrom(this.mines, m); }
    }

    // oil puddles
    for (let i = this.oils.length - 1; i >= 0; i--) {
      const o = this.oils[i];
      o.life -= dt;
      o.mat.opacity = 0.92 * clamp(o.life / 2, 0, 1);
      if (o.life <= 0) { this._removeFrom(this.oils, o); continue; }
      for (const e of cars.values()) {
        if (e === o.owner || e.dead || !e.v || e.v.oil > 0.3) continue;
        if (e.fx.shield > t) continue;
        const s = e.state;
        if (Math.hypot(s.x - o.x, s.z - o.z) < o.rad * 0.9 && !(e.v.jy > 0.5)) {
          e.v.oil = 2.2; e.v.yaw += (Math.random() < 0.5 ? -1 : 1) * (1.0 + Math.random() * 0.8);
          if (e.kind === 'me') { R.msg('Yog\'da sirpanyapsiz!', 1200, 'small'); R.shake = Math.max(R.shake, 0.3); }
        }
      }
    }

    // magnet pull, repair
    for (const r of cars.values()) {
      const f = r.fx; if (!f) continue;
      if (f.magnet > t && !r.dead) {
        const s = r.state;
        for (const e of cars.values()) {
          if (e === r || e.dead || !e.v || e.fx.shield > t) continue;
          const dx = s.x - e.state.x, dz = s.z - e.state.z, d = Math.hypot(dx, dz);
          if (d > 50 || d < 4) continue;
          const acc = 32 * (0.4 + 0.6 * (1 - d / 50));
          e.v.vx += dx / d * acc * dt; e.v.vz += dz / d * acc * dt;
        }
      }
      if (f.repairUntil > t && !r.dead) {
        if (r.v && f.repair > 0 && r.hp < 100) {
          const h = Math.min(7.5 * dt, f.repair, 100 - r.hp);
          r.hp += h; f.repair -= h;
        }
        if (Math.random() < dt * 40) {
          const s = r.state;
          R.fire.emit(s.x + (Math.random() - 0.5) * 2, 0.4, s.z + (Math.random() - 0.5) * 3.4, 0, 2.2 + Math.random() * 2, 0, 0.8, 0.5, 0.25, 0.9, 0.3, 1, 0.55);
        }
      }
    }

    // expanding rings, laser beams
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const g = this.rings[i];
      g.t += dt;
      if (g.t < 0) continue;
      g.obj.visible = true;
      const k = clamp(g.t / g.dur, 0, 1), e = 1 - (1 - k) * (1 - k), rad = g.r0 + (g.r1 - g.r0) * e;
      g.obj.scale.set(rad, 1, rad);
      for (let j = 0; j < g.mats.length; j++) g.mats[j].opacity = g.ops[j] * (1 - k);
      if (k >= 1) this._removeFrom(this.rings, g);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      const k = clamp(b.life / b.max, 0, 1);
      b.mats[0].opacity = 0.55 * k; b.mats[1].opacity = k;
      if (b.life <= 0) this._removeFrom(this.beams, b);
    }

    // shield / armour bubbles follow their cars
    for (const r of cars.values()) {
      const f = r.fx; if (!f || r.dead) continue;
      const kind = f.shield > t ? 'shield' : f.armor > t ? 'armor' : null;
      this._aura(r, kind);
    }

    this._bots(dt);
  }

  _aura(r, kind) {
    let m = this.auras.get(r.id);
    if (!kind) { if (m) { this.root.remove(m); m.material.dispose(); this.auras.delete(r.id); } return; }
    if (!m) {
      m = new THREE.Mesh(this.gAura, new THREE.MeshBasicMaterial({ color: 0x59d5ff, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.scale.set(1.55, 1.1, 2.9); m.renderOrder = 7;
      this.root.add(m); this.auras.set(r.id, m);
    }
    const s = r.state, f = r.fx, left = (kind === 'shield' ? f.shield : f.armor) - this.t;
    m.position.set(s.x, 0.8, s.z); m.rotation.y = s.psi;
    m.material.color.set(kind === 'shield' ? 0x59d5ff : 0xffc23a);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 8);
    m.material.opacity = (kind === 'shield' ? 0.2 : 0.12) + 0.08 * pulse;
    m.visible = left > 0.9 || Math.sin(this.t * 26) > 0;           // blinks in its last second
  }

  // ------------------------------------------------------------------ bot brains
  _bots(dt) {
    const R = this.race, t = this.t;
    if (R.phase !== 'racing') return;
    for (const r of R.racers.values()) {
      if (r.kind !== 'ai' || r.dead || !r.v || r.v.locked) continue;
      const f = r.fx;
      f.aiT -= dt; if (f.aiT > 0) continue;
      f.aiT = 0.35 + Math.random() * 0.4;
      if (t - f.aiLast < 1.8) continue;                          // a bot can't spam: at least ~2 s between uses
      const skill = r.bot ? r.bot.skill : 0.5;
      if (Math.random() > 0.45 + skill * 0.35) continue;
      const s = r.state;
      let near = null, nd = 1e9;
      for (const e of R.racers.values()) { if (e === r || e.dead) continue; const d = Math.hypot(e.state.x - s.x, e.state.z - s.z); if (d < nd) { nd = d; near = e; } }
      if (!near) continue;
      const bearing = wrapA(Math.atan2(near.state.x - s.x, near.state.z - s.z) - s.psi), fa = Math.abs(bearing);
      const ready = i => r.loadout.includes(i) && r.cd[i] <= t, hurt = R.raceClock - r.hitAt < 1.5;
      let pick = -1;
      const rnd = Math.random;
      if (r.hp < 45 && ready(AB.repair)) pick = AB.repair;
      else if (hurt && r.hp < 85 && ready(AB.shield) && rnd() < 0.7) pick = AB.shield;
      else if (nd < 18 && ready(AB.emp) && rnd() < 0.6) pick = AB.emp;
      else if (hurt && r.hp < 70 && ready(AB.armor)) pick = AB.armor;
      else if (fa < 0.12 && nd < 78 && ready(AB.laser)) pick = AB.laser;
      else if (fa < 0.3 && nd < 70 && ready(AB.gun)) pick = AB.gun;
      else if (fa < 0.5 && nd > 22 && nd < 115 && ready(AB.missile)) pick = AB.missile;
      else if (fa < 0.35 && nd > 14 && nd < 42 && ready(AB.bomb)) pick = AB.bomb;
      else if (fa > 2.2 && nd < 40 && ready(AB.mine) && rnd() < 0.7) pick = AB.mine;
      else if (fa > 2.2 && nd < 40 && ready(AB.oil)) pick = AB.oil;
      else if (nd > 20 && nd < 46 && ready(AB.magnet) && rnd() < 0.35) pick = AB.magnet;
      else if (fa < 0.2 && nd > 45 && ready(AB.turbo)) pick = AB.turbo;
      if (pick >= 0 && R.fireAbility(r, pick)) f.aiLast = t;
    }
  }
}
