import * as THREE from 'three';

// =====================================================================================================================
//  THIEF BOMBS: the thief presses T to drop a bomb behind his car. It arms after a moment; when a police car drives near
//  it blows up: damage + a shove for every police car close by. The host / solo game decides everything;
//  online friends only see the events ({k:'bomb'} when it is dropped, {k:'boom'} when it goes off, {k:'kick'}).
// =====================================================================================================================
export const BOMB = { cooldown: 5, max: 3, arm: 0.9, trigger: 3.6, radius: 14, dmg: 58, life: 45, push: 18 };

export class Bombs {
  constructor(mission) {
    this.m = mission; this.group = new THREE.Group(); this.list = []; this.nextId = 1; this.cool = 0; this.aiT = 0;
    this.bodyGeo = new THREE.SphereGeometry(0.42, 14, 10); this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x1b1b20, metalness: 0.7, roughness: 0.4 });
    this.lightGeo = new THREE.SphereGeometry(0.13, 8, 6);
    this.ringGeo = new THREE.RingGeometry(BOMB.trigger - 0.25, BOMB.trigger, 36);
  }
  attach(scene) { scene.add(this.group); }
  detach(scene) { scene.remove(this.group); }
  reset() { for (const b of this.list) this.group.remove(b.g); this.list = []; this.cool = 0; this.nextId = 1; }

  /** a bomb exists now (host: just created; clients: told by the host) */
  add(spec) {
    if (this.list.some(b => b.id === spec.id)) return;
    const g = new THREE.Group(); g.position.set(spec.x, 0, spec.z);
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat); body.position.y = 0.42; body.castShadow = true;
    const lm = new THREE.MeshBasicMaterial({ color: 0xff2a2a, fog: false }), led = new THREE.Mesh(this.lightGeo, lm); led.position.y = 0.88;
    const rm = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }), ring = new THREE.Mesh(this.ringGeo, rm);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
    g.add(body, led, ring); this.group.add(g);
    this.list.push({ id: spec.id, x: spec.x, z: spec.z, owner: spec.owner, t: 0, g, led, lm, rm });
  }
  remove(id) { const i = this.list.findIndex(b => b.id === id); if (i < 0) return null; const b = this.list[i]; this.group.remove(b.g); this.list.splice(i, 1); return b; }

  mine(ownerId) { return this.list.filter(b => b.owner === ownerId).length; }

  /** thief `u` drops a bomb behind his car. host / solo: creates it; a friend asks the host. returns true when it was dropped / asked */
  drop(u, fromHost = true) {
    const m = this.m, s = u.state;
    if (!u || u.dead || m.state !== 'play' || m.race.phase !== 'racing') return false;
    const x = s.x - Math.sin(s.psi) * 3.4, z = s.z - Math.cos(s.psi) * 3.4;
    if (m.isClient && u === m.me) { m.net.send({ t: 'mcmd', c: { k: 'bomb', x: +x.toFixed(1), z: +z.toFixed(1) } }); return true; }
    if (this.mine(u.id) >= BOMB.max) return false;
    const spec = { id: this.nextId++, x, z, owner: u.id };
    this.add(spec);
    if (m.net && m.net.host) m.net.event({ k: 'bomb', spec });
    return true;
  }

  /** (me) T pressed: drop with a cooldown + a message */
  press() {
    const m = this.m, me = m.me;
    if (!me || me.dead || !me.isThief || m.state !== 'play' || m.race.phase !== 'racing') return;
    if (m.clock < this.cool) { m.hud.message(`Bomba tayyor emas (${Math.ceil(this.cool - m.clock)} s)`, 900, 'small'); return; }
    if (!m.isClient && this.mine(me.id) >= BOMB.max) { m.hud.message(`Bir vaqtda ${BOMB.max} tadan ortiq bomba bo'lmaydi`, 1200, 'small'); return; }
    if (this.drop(me)) { this.cool = m.clock + BOMB.cooldown; m.hud.message("{bolt} Bomba tashlandi!", 900, 'small'); m.audio.beep?.(300, 0.1, 0.18); }
  }

  /** host: a friend (thief) asked for a bomb */
  onCmd(fromId, c) {
    const m = this.m, u = m.units.find(q => q.id === fromId);
    if (m.isClient || !u || !u.isThief || u.dead || c.k !== 'bomb' || !Number.isFinite(c.x) || !Number.isFinite(c.z)) return;
    if (this.mine(u.id) >= BOMB.max || Math.hypot(c.x - u.state.x, c.z - u.state.z) > 9) return;
    const spec = { id: this.nextId++, x: c.x, z: c.z, owner: u.id };
    this.add(spec);
    if (m.net && m.net.host) m.net.event({ k: 'bomb', spec });
  }

  update(dt) {
    const m = this.m;
    for (const b of this.list) {
      b.t += dt;
      const on = b.t >= BOMB.arm, blink = on ? (Math.floor(b.t * 6) % 2) : (Math.floor(b.t * 14) % 2);
      b.lm.color.setHex(blink ? 0xff3030 : 0x401010); b.rm.opacity = on ? 0.3 + 0.15 * Math.sin(b.t * 6) : 0.12;
    }
    if (m.isClient || m.state !== 'play' || m.race.phase !== 'racing') return;
    // AI thieves drop bombs when police are on their tail
    this.aiT -= dt;
    if (this.aiT <= 0) {
      this.aiT = 0.6;
      for (const u of m.thieves) {
        if (u.dead || !u.drv || (u.bombCool || 0) > m.clock || this.mine(u.id) >= BOMB.max) continue;
        const s = u.state, fx = Math.sin(s.psi), fz = Math.cos(s.psi);
        const chased = m.units.some(p => p.isPolice && !p.dead && (() => { const dx = p.state.x - s.x, dz = p.state.z - s.z, d = Math.hypot(dx, dz); return d > 7 && d < 26 && (dx * fx + dz * fz) / d < -0.35 && s.speed > 8; })());
        if (chased && Math.random() < 0.55) { this.drop(u); u.bombCool = m.clock + BOMB.cooldown + Math.random() * 4; }
      }
    }
    for (const b of this.list.slice()) {
      if (b.t > BOMB.life) { this.explode(b, true); continue; }
      if (b.t < BOMB.arm) continue;
      for (const u of m.units) {
        if (u.dead || u.isThief) continue;
        if (Math.hypot(u.state.x - b.x, u.state.z - b.z) < BOMB.trigger) { this.explode(b); break; }
      }
    }
  }

  /** host / solo: the bomb goes off */
  explode(b, silent) {
    const m = this.m; if (!this.remove(b.id)) return;
    if (m.net && m.net.host) m.net.event({ k: 'boom', id: b.id, x: +b.x.toFixed(1), z: +b.z.toFixed(1), s: silent ? 1 : 0 });
    this.fx(b.x, b.z, silent);
    if (silent) return;
    for (const u of m.units) {
      if (u.dead || u.isThief) continue;
      const dx = u.state.x - b.x, dz = u.state.z - b.z, d = Math.hypot(dx, dz);
      if (d > BOMB.radius) continue;
      const k = 1 - d / BOMB.radius, nx = d > 0.1 ? dx / d : 1, nz = d > 0.1 ? dz / d : 0;
      m.hurt(u, BOMB.dmg * (0.3 + 0.7 * k), true);                 // raw: the police armour does not soften a bomb
      const kx = nx * BOMB.push * (0.4 + k), kz = nz * BOMB.push * (0.4 + k);
      if (u.v) this.kick(u.v, kx, kz);
      else if (u.isHuman && m.net && m.net.host) m.net.event({ k: 'kick', id: u.id, vx: +kx.toFixed(1), vz: +kz.toFixed(1) });
    }
  }
  /** shove + a little hop */
  kick(v, kx, kz) { v.vx += kx; v.vz += kz; if (v.jy < 0.02) { v.jv = 6.5; v.jy = 0.03; } v.yaw += (Math.random() - 0.5) * 3; }

  /** blast visuals + sound (everybody) */
  fx(x, z, silent) {
    const m = this.m, race = m.race;
    if (!silent) {
      for (let q = 0; q < 90; q++) {
        const a = Math.random() * 6.283, sp = 3 + Math.random() * 12, up = 2 + Math.random() * 10;
        race.fire.emit(x + (Math.random() - 0.5) * 1.5, 0.5 + Math.random() * 0.6, z + (Math.random() - 0.5) * 1.5, Math.cos(a) * sp, up, Math.sin(a) * sp, 0.4 + Math.random() * 0.6, 0.5, 4 + Math.random() * 3, 1.0, 0.7 + Math.random() * 0.3, 0.25 + Math.random() * 0.3, 0.05);
      }
      for (let q = 0; q < 40; q++) {
        const a = Math.random() * 6.283, sp = 2 + Math.random() * 7;
        race.smoke.emit(x + (Math.random() - 0.5) * 1.5, 0.7 + Math.random(), z + (Math.random() - 0.5) * 1.5, Math.cos(a) * sp, 2 + Math.random() * 6, Math.sin(a) * sp, 1.6 + Math.random() * 1.2, 1.4, 7 + Math.random() * 3, 0.8, 0.05, 0.05, 0.05);
      }
      for (let q = 0; q < 40; q++) race.sparks.emit(x, 0.7, z, (Math.random() - 0.5) * 24, 3 + Math.random() * 11, (Math.random() - 0.5) * 24, 0.6 + Math.random() * 0.6, 0.35, 0.1, 1, 0.9, 0.5, 0.2);
    } else {
      for (let q = 0; q < 12; q++) race.smoke.emit(x, 0.6, z, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, 1, 0.8, 3, 0.5, 0.5, 0.5, 0.3);
    }
    const me = m.me; if (!me) return;
    const d = Math.hypot(x - me.state.x, z - me.state.z);
    if (d < 130 && !silent) {
      const k = 1 - d / 130;
      m.audio.thump(0.8 + 1.8 * k); m.audio.noiseBurst?.(0.45, 160, 0.8 * k, 'lowpass');
      race.shake = Math.max(race.shake, Math.min(1.2, 1.4 * k));
    }
  }
}
