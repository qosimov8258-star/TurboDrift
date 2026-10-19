import * as THREE from 'three';

// =====================================================================================================================
//  POLICE GUNS: police cars shoot at the thief's car from their windows (tracer rounds + muzzle flash + sound).
//  AI police fire automatically when the thief is in range and in line of sight; the player's own police car fires a
//  burst at the thief with F (auto-aimed). Rounds only do a little damage, like the robots' guns. The host / solo game
//  decides hits; online friends replay the events ({k:'pshot'}).
// =====================================================================================================================
const RANGE = 58, MIN_RANGE = 4, CONE = 1.7;                        // m, m, rad (half angle the guns can cover around the car's nose)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
export const GUN = { burst: 3, gap: 0.16, pause: 2.3, dmgMin: 0.8, dmgMax: 1.7, playerPause: 1.1 };

export class Guns {
  constructor(mission) {
    this.m = mission; this.group = new THREE.Group(); this.tr = []; this.fl = [];
    const geo = new THREE.CylinderGeometry(0.03, 0.03, 1, 5); geo.rotateX(Math.PI / 2); geo.translate(0, 0, 0.5);
    for (let i = 0; i < 40; i++) {
      const t = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      t.visible = false; t.frustumCulled = false; t.userData.life = 0; this.group.add(t); this.tr.push(t);
    }
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,245,190,1)'); gr.addColorStop(0.4, 'rgba(255,180,70,0.7)'); gr.addColorStop(1, 'rgba(255,120,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffd080, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false }));
      s.scale.setScalar(1.3); s.visible = false; s.userData.life = 0; this.group.add(s); this.fl.push(s);
    }
    this.playerCool = 0; this.playerLeft = 0; this.playerGap = 0; this.v = new THREE.Vector3();
  }
  attach(scene) { scene.add(this.group); }
  detach(scene) { scene.remove(this.group); }
  reset() { this.playerCool = 0; this.playerLeft = 0; for (const t of this.tr) { t.visible = false; t.userData.life = 0; } for (const s of this.fl) { s.visible = false; s.userData.life = 0; } }

  /** muzzle of a police car: on the roof line, just ahead of the light bar */
  muzzle(u, out) {
    const s = u.state, sp = Math.sin(s.psi), cp = Math.cos(s.psi);
    return out.set(s.x + sp * 1.5 - cp * 0.45, 1.25, s.z + cp * 1.5 + sp * 0.45);
  }

  /** can this police unit shoot the thief now? */
  canShoot(u, th, needCone = true) {
    const m = this.m;
    if (!th || u.dead || m.state !== 'play' || m.race.phase !== 'racing') return null;
    const dx = th.x - u.state.x, dz = th.z - u.state.z, d = Math.hypot(dx, dz);
    if (d > RANGE || d < MIN_RANGE) return null;
    if (needCone && Math.abs(wrapA(Math.atan2(dx, dz) - u.state.psi)) > CONE) return null;
    this.muzzle(u, this.v);
    if (m.world.rayFree(this.v.x, this.v.z, th.x, th.z, 0.2, true) < 1) return null;
    return d;
  }

  /** (host / solo) one round from unit `u` at the thief. */
  shoot(u, th, d, dmgMul = 1) {
    const m = this.m, lead = d / 300;
    const tx = th.x + th.vx * lead, tz = th.z + th.vz * lead;
    const sigma = 0.7 + d * 0.03 + th.speed * 0.022 + u.state.speed * 0.02;
    const ex = (Math.random() + Math.random() + Math.random() - 1.5) * sigma * 1.6, ez = (Math.random() + Math.random() + Math.random() - 1.5) * sigma * 1.6;
    const hit = Math.hypot(ex, ez) < 1.3, ix = tx + ex, iz = tz + ez;
    this.fx(u.id, ix, iz, hit);
    if (hit) m.robotHit(th, (GUN.dmgMin + Math.random() * (GUN.dmgMax - GUN.dmgMin)) * dmgMul);
    if (m.net && m.net.host) m.net.event({ k: 'pshot', u: u.id, x: +ix.toFixed(1), z: +iz.toFixed(1), h: hit ? 1 : 0 });
  }

  /** tracer + flash + sound (everybody) */
  fx(unitId, ix, iz, hit) {
    const m = this.m, u = m.units.find(q => q.id === unitId); if (!u) return;
    const muz = this.muzzle(u, new THREE.Vector3()), q = this.tr.find(t => !t.visible) || this.tr[0];
    q.position.copy(muz); q.lookAt(ix, 0.7, iz); q.scale.z = Math.max(1, muz.distanceTo(this.v.set(ix, 0.7, iz))); q.visible = true; q.userData.life = 0.09;
    const f = this.fl.find(s => !s.visible) || this.fl[0]; f.position.copy(muz); f.visible = true; f.userData.life = 0.06; f.material.opacity = 1;
    const cam = m.race.camera, d = Math.hypot(muz.x - cam.position.x, muz.z - cam.position.z);
    if (d < 150) m.audio.noiseBurst?.(0.06, 1500 + Math.random() * 600, 0.22 * (1 - d / 150), 'bandpass', 0.8);
    if (hit) { const s = m.race.sparks; for (let k = 0; k < 6; k++) s.emit(ix, 0.8, iz, (Math.random() - 0.5) * 8, 1 + Math.random() * 4, (Math.random() - 0.5) * 8, 0.3 + Math.random() * 0.3, 0.3, 0.1, 1, 1, 0.8, 0.3); }
  }

  /** the player (police) presses F: an auto-aimed burst at the thief */
  firePlayer() {
    const m = this.m, me = m.me, th = me ? m.thiefNear(me.state.x, me.state.z) : null;
    if (m.role !== 'police' || !me || me.dead || m.state !== 'play' || m.race.phase !== 'racing') return;
    if (!th || th.dead) return;
    if (!m.shooter) { m.hud.message("Qurol faqat host kompyuterida ishlaydi", 1500, 'small'); return; }
    if (this.playerCool > 0 || this.playerLeft > 0) return;
    const d = this.canShoot(me, th.state, true);
    if (d == null) { m.hud.message("O'g'ri nishonda emas (oldingizda, 58 m ichida bo'lsin)", 1400, 'small'); return; }
    this.playerLeft = GUN.burst + 2; this.playerGap = 0;
  }

  update(dt) {
    const m = this.m;
    for (const q of this.tr) if (q.userData.life > 0) { q.userData.life -= dt; q.material.opacity = Math.max(0, q.userData.life / 0.09) * 0.95; if (q.userData.life <= 0) q.visible = false; }
    for (const f of this.fl) if (f.userData.life > 0) { f.userData.life -= dt; f.material.opacity = Math.max(0, f.userData.life / 0.06); if (f.userData.life <= 0) f.visible = false; }
    if (!m.shooter || m.state !== 'play' || m.race.phase !== 'racing') return;
    if (!m.aliveThieves().length) return;
    const k = [0.6, 1, 1.3][m.D.id] ?? 1;
    // AI police
    for (const u of m.units) {
      if (!u.isPolice || !u.drv || u.dead) continue;
      const tu = m.thiefNear(u.state.x, u.state.z), th = tu ? tu.state : null; if (!th) continue;
      const g = u.gun || (u.gun = { cool: 0.8 + Math.random() * 1.6, left: 0, gap: 0 });
      if (g.left > 0) {
        g.gap -= dt;
        if (g.gap <= 0) { const d = this.canShoot(u, th); if (d != null) { this.shoot(u, th, d, k); g.gap = GUN.gap; g.left--; } else g.left = 0; if (g.left <= 0) g.cool = (GUN.pause + Math.random() * 1.2) / k; }
      } else {
        g.cool -= dt;
        if (g.cool <= 0) { if (this.canShoot(u, th) != null) { g.left = GUN.burst; g.gap = 0; } else g.cool = 0.35; }
      }
    }
    // the player's own police car
    if (this.playerLeft > 0 && m.me && !m.me.dead) {
      this.playerGap -= dt;
      if (this.playerGap <= 0) {
        const pu = m.thiefNear(m.me.state.x, m.me.state.z), th = pu ? pu.state : null;
        const d = th ? this.canShoot(m.me, th, false) : null;
        if (d != null) { this.shoot(m.me, th, d, 1.15); this.playerGap = 0.09; this.playerLeft--; } else this.playerLeft = 0;
        if (this.playerLeft <= 0) this.playerCool = GUN.playerPause;
      }
    } else this.playerCool = Math.max(0, this.playerCool - dt);
  }
}
