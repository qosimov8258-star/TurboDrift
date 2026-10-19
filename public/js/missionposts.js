import * as THREE from 'three';
import { CarVisual } from './car.js';
import { Tumbler } from './missionprops.js';

// =====================================================================================================================
//  ROADBLOCKS ("posts"): after the first minute without an arrest, robot police set up a post ahead of the thief:
//  police cars parked across the street + robots with guns behind them who shoot at the thief's car (small damage).
//  The host plans / shoots; clients only replay the events (see Mission network code).
// =====================================================================================================================
const RANGE = 62, ROBOT_YAW_RATE = 6;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Posts {
  constructor(mission) {
    this.m = mission; this.list = []; this.nextId = 1;
    this.group = new THREE.Group();
    // pooled tracer rounds + muzzle flashes
    this.tr = [];
    const geo = new THREE.CylinderGeometry(0.035, 0.035, 1, 5); geo.rotateX(Math.PI / 2); geo.translate(0, 0, 0.5);
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false; m.frustumCulled = false; m.userData.life = 0; this.group.add(m); this.tr.push(m);
    }
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(0.4, 'rgba(255,170,60,0.7)'); gr.addColorStop(1, 'rgba(255,120,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.flashTex = new THREE.CanvasTexture(c);
    this.gunMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.4, metalness: 0.8 });
    this._v = new THREE.Vector3();
  }

  attach(scene) { scene.add(this.group); }
  detach(scene) { scene.remove(this.group); }

  clear() {
    for (const p of [...this.list]) this.remove(p.id, true);
    this.list.length = 0; this.sync();
  }

  /** push the current post circles into the world + nav */
  sync(skipNav) {
    const obs = [];
    for (const p of this.list) for (const o of p.obs) obs.push(o);
    const w = this.m.world; w.setObstacles(obs);
    return obs;
  }

  // ------------------------------------------------------------------ planning (host)
  /** pick a spot on the thief's way ahead and describe a post there; null when nothing fits */
  plan() {
    const m = this.m, nav = m.nav, w = m.world, alive = m.aliveThieves(), tu = alive.length ? alive[(Math.random() * alive.length) | 0] : null, th = tu ? tu.state : null, F = m.fT.cur;
    if (!th || !F) return null;
    const sp = th.speed, dx = sp > 4 ? th.vx / sp : Math.sin(th.psi), dz = sp > 4 ? th.vz / sp : Math.cos(th.psi);
    let best = null, bs = -1e9;
    const drv = tu.drv, P = drv && drv.path;                                   // the AI thief's planned route: put the post right on it
    if (P) {
      let run = 0;
      for (let i = Math.max(1, drv.pi); i < P.length; i++) {
        run += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
        if (run < 85) continue;
        if (run > 230) break;
        const x = P[i][0], z = P[i][1], k = nav.snap(x, z);
        if (k < 0 || (nav.clear[k] > 9)) continue;
        if (m.units.some(u => !u.dead && Math.hypot(u.state.x - x, u.state.z - z) < 45)) continue;
        if (this.list.some(q => Math.hypot(q.x - x, q.z - z) < 70)) continue;
        const sc = -Math.abs(run - 140) + Math.random() * 30;
        if (sc > bs) { bs = sc; best = { x, z, k }; }
      }
      if (best) return this.layout(best.x, best.z, th);
    }
    for (let n = 0; n < 140; n++) {
      const k = m.narrow[(Math.random() * m.narrow.length) | 0], d = F.dist[k];
      if (!isFinite(d) || d < 110 || d > 280) continue;
      const [x, z] = nav.centre(k), ex = x - th.x, ez = z - th.z, el = Math.hypot(ex, ez) || 1, ahead = (ex * dx + ez * dz) / el;
      if (ahead < 0.3) continue;
      if (m.units.some(u => !u.dead && Math.hypot(u.state.x - x, u.state.z - z) < 45)) continue;
      if (this.list.some(p => Math.hypot(p.x - x, p.z - z) < 90)) continue;
      const sc = ahead * 60 - Math.abs(d - 170) * 0.3 + Math.random() * 25;
      if (sc > bs) { bs = sc; best = { x, z, k }; }
    }
    if (!best) return null;
    return this.layout(best.x, best.z, th);
  }

  /** cars across the street + robots behind them (relative to where the thief comes from) */
  layout(x, z, th) {
    const w = this.m.world, psiR = w.freeHeading(x, z), px = Math.cos(psiR), pz = -Math.sin(psiR);      // along the street / across it
    const span = dir => { let d = 0; while (d < 9 && w.dist(x + px * dir * d, z + pz * dir * d) > 0.95) d += 0.5; return d; };
    const a = span(1), b = span(-1), c = (a - b) / 2, total = a + b;
    const cx = x + px * c, cz = z + pz * c;
    const n = clamp(Math.ceil((total + 1.9) / 4.3 - 0.15), 1, 3), kinds = ['suv', 'gt300', 'suv'];
    const cars = [];
    for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * 4.3; cars.push({ x: cx + px * o, z: cz + pz * o, psi: psiR + Math.PI / 2 + (i % 2 ? 0.08 : -0.06), kind: kinds[i % 3] }); }
    let ax = th.x - cx, az = th.z - cz; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;          // towards the thief
    const rb = -3.4, robots = [];
    for (let i = 0; i < 2 + (n > 2 ? 1 : 0); i++) { const o = (i - (n > 2 ? 1 : 0.5)) * 2.2; robots.push({ x: cx + ax * rb + px * o, z: cz + az * rb + pz * o, yaw: Math.atan2(ax, az) }); }
    return { id: this.nextId++, x: cx, z: cz, psi: psiR, cars, robots };
  }

  // ------------------------------------------------------------------ build / remove (host + clients)
  add(spec) {
    const m = this.m, f = m.fleet, scene = this.group;
    const post = { id: spec.id, x: spec.x, z: spec.z, cars: [], robots: [], obs: [], t0: m.clock, spec };
    for (const c of spec.cars) {
      const k = f.kind(c.kind, m.protos), vis = new CarVisual(k.proto, k.def, k.paint ?? -1);
      vis.addSiren(); vis.sirenOff = Math.random() * 3; vis.group.position.set(c.x, 0, c.z); vis.group.rotation.y = c.psi; vis.setShadowProxy(true);
      scene.add(vis.group); post.cars.push(vis);
      const sp = Math.sin(c.psi), cp = Math.cos(c.psi), circles = [-1.5, 0, 1.5].map(o => ({ x: c.x + sp * o, z: c.z + cp * o, r: 1.0 }));
      for (const o of circles) post.obs.push(o);
      vis.soft = { x: c.x, z: c.z, psi: c.psi, vx: 0, vz: 0, yaw: 0, circles }; vis.tm = new Tumbler();
    }
    for (const r of spec.robots) {
      const rb = f.makeRobot(); rb.group.position.set(r.x, 0, r.z); rb.group.rotation.y = r.yaw;
      rb.yaw = r.yaw; rb.cool = 1 + Math.random() * 1.5; rb.burst = 0; rb.kick = 0;
      rb.mixer.update(0.35); rb.mixer.timeScale = 0;                                  // the clip is a walk cycle: freeze it in a standing pose
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.8), this.gunMat); gun.position.set(0.26, 1.2, 0.5); gun.castShadow = true;
      const mz = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xffd080, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false }));
      mz.position.set(0.26, 1.2, 1.0); mz.scale.setScalar(0.9);
      rb.group.add(gun, mz); rb.gun = gun; rb.flash = mz; rb.obs = { x: r.x, z: r.z, r: 0.55 };
      post.obs.push(rb.obs);
      scene.add(rb.group); post.robots.push(rb);
    }
    this.list.push(post);
    this.sync();
    m.nav.refresh(post.x, post.z, 14);
    return post;
  }

  remove(id, quiet) {
    const i = this.list.findIndex(p => p.id === id); if (i < 0) return;
    const p = this.list[i];
    for (const v of p.cars) this.group.remove(v.group);
    for (const r of p.robots) this.group.remove(r.group);
    this.list.splice(i, 1);
    if (!quiet) { this.sync(); this.m.nav.refresh(p.x, p.z, 14); }
  }

  /** roadblock cars are not walls: cars that hit them shove them aside (a little damage, a little speed lost) */
  pushCars(units, dt) {
    const w = this.m.world, offs = [-1.5, 0, 1.5];
    for (const p of this.list) for (const vis of p.cars) {
      const c = vis.soft; if (!c) continue;
      const csp = Math.sin(c.psi), ccp = Math.cos(c.psi);
      for (const u of units) {
        const v = u.v; if (!v || u.dead) continue;
        if (Math.abs(v.x - c.x) > 7 || Math.abs(v.z - c.z) > 7) continue;
        const usp = Math.sin(v.psi), ucp = Math.cos(v.psi);
        for (const a of offs) for (const b of offs) {
          const ax = v.x + usp * a, az = v.z + ucp * a, bx = c.x + csp * b, bz = c.z + ccp * b;
          let dx = bx - ax, dz = bz - az; const d = Math.hypot(dx, dz), min = 1.95;
          if (d >= min || d < 1e-4) continue;
          dx /= d; dz /= d;
          const pen = min - d, closing = (v.vx - c.vx) * dx + (v.vz - c.vz) * dz;
          c.x += dx * pen * 0.85; c.z += dz * pen * 0.85; v.x -= dx * pen * 0.15; v.z -= dz * pen * 0.15;
          if (closing > 0) {
            c.vx += dx * closing * 0.75; c.vz += dz * closing * 0.75;
            v.vx -= dx * closing * 0.12; v.vz -= dz * closing * 0.12;                  // barely slows the car that pushes
            c.yaw += ((bx - c.x) * dz - (bz - c.z) * dx) * closing * 0.02;
            if (closing > 7) v.dmg = (v.dmg || 0) + Math.min(5, (closing - 7) * 0.2);
            if (closing > 9 && vis.tm.trigger(clamp((closing - 9) / 16, 0.2, 1), (c.vx * ccp - c.vz * csp) > 0 ? -1 : 1)) {       // a hard hit rolls the roadblock car over and sends it sliding
              c.vx += dx * closing * 0.35; c.vz += dz * closing * 0.35; c.yaw += (Math.random() - 0.5) * closing * 0.2;
              this.m.propImpact?.(closing, c.x, c.z, null, u);
            }
          }
        }
      }
    }
    for (const p of this.list) for (const vis of p.cars) {
      const c = vis.soft; if (!c) continue;
      if (Math.abs(c.vx) + Math.abs(c.vz) + Math.abs(c.yaw) < 0.02) continue;
      c.x += c.vx * dt; c.z += c.vz * dt; c.psi += c.yaw * dt;
      const k = Math.exp(-dt * 2.2); c.vx *= k; c.vz *= k; c.yaw *= Math.exp(-dt * 3);
      const sp = Math.sin(c.psi), cp = Math.cos(c.psi);
      for (let i = 0; i < 3; i++) {                                                     // buildings stop a shoved car
        const o = c.circles[i], off = offs[i], ox = c.x + sp * off, oz = c.z + cp * off, d = w.dist(ox, oz, true);
        if (d < 1) { const n = w.grad(ox, oz, undefined, true), pen = 1 - d; c.x += n.x * pen; c.z += n.z * pen; const vn = c.vx * n.x + c.vz * n.z; if (vn < 0) { c.vx -= vn * n.x * 1.3; c.vz -= vn * n.z * 1.3; } }
      }
      for (let i = 0; i < 3; i++) { const o = c.circles[i]; o.x = c.x + sp * offs[i]; o.z = c.z + cp * offs[i]; }
    }
  }

  // ------------------------------------------------------------------ per frame
  update(dt, t) {
    const m = this.m, cam = m.race.camera;
    for (const p of this.list) {
      for (const v of p.cars) {
        v.updateSiren(t, true);
        if (v.soft) { v.group.position.set(v.soft.x, 0, v.soft.z); v.group.rotation.set(0, v.soft.psi, 0, 'YXZ'); v.tm.update(dt); v.tm.apply(v.group); }
      }
      for (const r of p.robots) {
        const gx = r.group.position.x, gz = r.group.position.z;
        const near = Math.hypot(gx - cam.position.x, gz - cam.position.z) < 160;
        r.group.visible = near;
        if (r.kick > 0) r.kick = Math.max(0, r.kick - dt * 6);
        r.flash.material.opacity = r.kick > 0.6 ? 1 : 0;
        r.gun.position.z = 0.5 - r.kick * 0.08;
        const tu = m.thiefNear(gx, gz), th = tu ? tu.state : null;
        if (!th) continue;
        const dx = th.x - gx, dz = th.z - gz, d = Math.hypot(dx, dz);
        if (d < RANGE * 1.4) { const want = Math.atan2(dx, dz); let da = Math.atan2(Math.sin(want - r.yaw), Math.cos(want - r.yaw)); r.yaw += clamp(da, -ROBOT_YAW_RATE * dt, ROBOT_YAW_RATE * dt); r.group.rotation.y = r.yaw; }
        if (!m.shooter) continue;                                                      // clients only replay events; the host decides the shots
        r.cool -= dt;
        if (d < RANGE && r.cool <= 0 && m.state === 'play' && m.race.phase === 'racing') {
          const muz = this.muzzle(r, this._v);
          if (m.world.rayFree(muz.x, muz.z, th.x, th.z, 0.25, true) >= 1) {       // buildings block the line of fire, the post's own cars do not (shooting over them)
            r.burst++; r.cool = r.burst % 5 === 0 ? 1.3 + Math.random() * 0.7 : 0.22;
            this.shoot(p, r, th, d);
          } else r.cool = 0.4;
        }
      }
    }
    for (const q of this.tr) if (q.userData.life > 0) { q.userData.life -= dt; q.material.opacity = Math.max(0, q.userData.life / 0.09) * 0.95; if (q.userData.life <= 0) q.visible = false; }
  }

  muzzle(r, out) { return r.gun.localToWorld(out.set(0, 0, 0.55)); }

  /** host: one round at the thief. Hit chance falls with distance and with the thief's speed. */
  shoot(p, r, th, d) {
    const m = this.m, lead = d / 330;
    const tx = th.x + th.vx * lead, tz = th.z + th.vz * lead;
    const sigma = 0.55 + d * 0.028 + th.speed * 0.02;
    const ex = (Math.random() + Math.random() + Math.random() - 1.5) * sigma * 1.6, ez = (Math.random() + Math.random() + Math.random() - 1.5) * sigma * 1.6;
    const hit = Math.hypot(ex, ez) < 1.25;
    const ix = tx + ex, iz = tz + ez;
    this.fx(p.id, p.robots.indexOf(r), ix, iz, hit);
    if (hit) m.robotHit(th, 1.4 + Math.random() * 1.4);
    if (m.net && m.net.host) m.net.event({ k: 'shot', p: p.id, r: p.robots.indexOf(r), x: +ix.toFixed(1), z: +iz.toFixed(1), h: hit ? 1 : 0 });
  }

  /** visuals + sound of a round (host and clients) */
  fx(postId, ri, ix, iz, hit) {
    const p = this.list.find(q => q.id === postId); if (!p) return;
    const r = p.robots[ri]; if (!r) return;
    r.kick = 1;
    const muz = this.muzzle(r, this._v.clone()), q = this.tr.find(t => !t.visible) || this.tr[0];
    q.position.copy(muz); q.lookAt(ix, 0.7, iz); q.scale.z = Math.max(1, muz.distanceTo(this._v.set(ix, 0.7, iz)));
    q.visible = true; q.userData.life = 0.09;
    const cam = this.m.race.camera, d = Math.hypot(muz.x - cam.position.x, muz.z - cam.position.z);
    if (d < 140) this.m.audio.noiseBurst?.(0.07, 1800 + Math.random() * 500, 0.2 * (1 - d / 140), 'bandpass', 0.8);
    if (hit) { const s = this.m.race.sparks; for (let k = 0; k < 6; k++) s.emit(ix, 0.8, iz, (Math.random() - 0.5) * 8, 1 + Math.random() * 4, (Math.random() - 0.5) * 8, 0.3 + Math.random() * 0.3, 0.3, 0.1, 1, 1, 0.8, 0.3); }
  }
}
