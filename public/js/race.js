import * as THREE from 'three';
import { Track, makeSky, HALF } from './track.js';
import { TRACKS } from './trackdata.js';
import { Vehicle, CarVisual, CAR_DEFS, TUNE, BATTLE } from './car.js';
import { Particles, SkidMarks } from './effects.js';
import { Bot, BattleBot } from './bot.js';
import * as TX from './textures.js';
import { BURN_POPS } from './audio.js';
import { Arsenal } from './arsenal.js';
import { ABILITIES, fixLoadout } from './abilities.js';

const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STEP = 1 / 120;
const DEAD_INP = { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false };   // a wrecked car just rolls to a stop
const TOWED_INP = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
const snapOf = v => ({ x: v.x, z: v.z, psi: v.psi, vx: v.vx, vz: v.vz });

/** canvas pixel ratio per graphics level. 'ultra' renders at least 3840 px wide (4K), super-sampling smaller screens */
export function pixelRatioFor(q) {
  const d = window.devicePixelRatio || 1;
  if (q === 'ultra') return clamp(Math.max(d, 3840 / Math.max(1, window.innerWidth)), 1, 3);
  // pixel budget: huge retina screens (5K iMac ...) would otherwise shade 15M+ pixels per frame; never below native 1:1
  const px = Math.max(1, window.innerWidth * window.innerHeight), fit = m => Math.max(1, Math.sqrt(m / px));
  if (q === 'high') return Math.min(d, 2, fit(5.4e6));
  if (q === 'medium') return Math.min(d, 1.5, fit(3.2e6));
  return 1;
}

function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) { for (const k of ['map', 'emissiveMap']) if (m[k]) m[k].dispose(); m.dispose(); }
    if (o.isInstancedMesh) o.dispose();
  });
}

export class Race {
  constructor(renderer, protos, audio, hud, { track = 0, quality = 'high' } = {}) {
    this.renderer = renderer; this.protos = protos; this.audio = audio; this.hud = hud;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.25, 6000);   // near 0.25: keeps the depth buffer precise so far road markings don't flicker at speed
    const horizon = new THREE.Color(0xcfe0ee);
    this.scene.background = horizon;
    this.scene.fog = new THREE.Fog(horizon, 260, 2600);
    this.quality = quality;
    this.sky = makeSky(renderer, this.scene);

    const hemi = this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a5a3a, 0.85);
    this.scene.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1d6, 3.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 400;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
    this.scene.add(sun, sun.target);

    this.smoke = new Particles(this.scene, TX.softSprite('225,225,228'), 900, false);
    this.smoke.drag = 1.1; this.smoke.rise = 0.7;
    this.dust = new Particles(this.scene, TX.softSprite('170,140,95'), 400, false);
    this.dust.drag = 1.5; this.dust.rise = 0.3;
    this.fire = new Particles(this.scene, TX.softSprite('255,190,110', 0.4), 1000, true);
    this.fire.drag = 2.2;
    this.sparks = new Particles(this.scene, TX.softSprite('255,210,120', 0.8), 300, true);
    this.sparks.drag = 0.6; this.sparks.rise = -9;
    this.skids = new SkidMarks(this.scene);

    // tow cable (Dodge Charger): a thin stretched cylinder + a hook ball
    this.tow = null;
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, metalness: 0.8, roughness: 0.4 }));
    this.cable.geometry.rotateX(Math.PI / 2); this.cable.visible = false; this.cable.frustumCulled = false;
    this.hook = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 1, roughness: 0.25 }));
    this.hook.visible = false;
    this.scene.add(this.cable, this.hook);

    this.arsenal = new Arsenal(this);
    this.racers = new Map();
    this.phase = 'idle';            // idle | countdown | racing | over
    this.t = 0; this.acc = 0; this.camMode = 0;
    this.camPos = new THREE.Vector3(); this.camAng = 0; this.shake = 0; this._shk = new THREE.Vector3();
    this.sendT = 0; this.me = null; this.net = null;
    this.mission = null; this.world = null; this.hitFlash = 0; this.dmgSum = 0; this.dmgAt = -9;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.driftScore = 0; this.driftBank = 0; this.driftTimer = 0; this.driftMult = 1;
    this.msg = () => {};
    this.onEnd = () => {};
    this.setTrack(track);
    this.setQuality(quality);
  }

  /** build (or switch to) circuit #idx from TRACKS and repaint sky / fog / sun for its theme */
  setTrack(idx) {
    idx = clamp(idx | 0, 0, TRACKS.length - 1);
    if (this.track && this.trackIndex === idx) return false;
    if (this.trackRoot) { this.scene.remove(this.trackRoot); disposeTree(this.trackRoot); }
    this.track = new Track(TRACKS[idx]);
    this.trackIndex = idx;
    this.trackRoot = this.track.build(this.scene, { quality: this.quality });
    this.applyTheme(this.track.theme);
    this.hud.resetMini?.();
    this.track.setLights(0);
    this.camera.far = 6000;
    return true;
  }

  /** sky / fog / sun colours of a theme (see THEMES in trackdata.js) */
  applyTheme(th) {
    this.scene.background = new THREE.Color(th.fog);
    this.scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    this.hemi.color.set(th.hemi[0]); this.hemi.groundColor.set(th.hemi[1]); this.hemi.intensity = th.hemi[2];
    this.sun.color.set(th.sunColor); this.sun.intensity = th.sunI;
    this.sky.setTheme(th);
  }

  /** Police mission: swap the circuit for the free-roam city world */
  enterWorld(world, theme) {
    if (this.world === world) return;
    if (this.trackRoot) this.scene.remove(this.trackRoot);
    this.world = world; this.scene.add(world.root);
    this.applyTheme(theme); this.camera.far = 6000;
  }
  exitWorld() {
    if (!this.world) return;
    this.scene.remove(this.world.root); this.world = null;
    if (this.trackRoot) { this.scene.add(this.trackRoot); this.applyTheme(this.track.theme); this.hud.resetMini?.(); }
    this.skids.last.clear();
  }

  setQuality(q) {
    this.quality = q;
    const hi = q === 'high' || q === 'ultra', size = q === 'ultra' ? 4096 : q === 'high' ? 2048 : 1024;
    this.sun.castShadow = hi;
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.renderer.setPixelRatio(pixelRatioFor(q));
  }

  // ------------------------------------------------------------------ setup
  setup({ players, laps, myId, isHost, net, countdown = 6, solo = false, track = 0, mode = 'race', loadout = null }) {
    if (this.mission) this.mission.stop();
    this.exitWorld();
    this.battle = mode === 'battle';
    this.setTrack(track);
    for (const r of this.racers.values()) { this.scene.remove(r.vis.group); this.hud.removeLabel(r.id); this.audio.removeRemote(r.id); }
    this.racers.clear(); this.releaseTow(true);
    this.arsenal.reset();
    this.skids.last.clear();
    for (const p of [this.smoke, this.dust, this.fire, this.sparks]) p.life.fill(0);
    this.laps = laps; this.net = net; this.solo = solo; this.isHost = isHost; this.myId = myId;
    this.t = -countdown; this.phase = 'countdown'; this.raceClock = 0; this.sendT = 0; this.finishCount = 0;
    this.driftScore = 0; this.driftBank = 0; this.countTick = Math.ceil(countdown) + 1; this.endTimer = null; this.wrongT = 0;
    this.releaseTow(true);
    this.hitFlash = 0; this.dmgSum = 0; this.dmgAt = -9; this.battleEndAt = null; this.soloEnded = false;
    this.track.setLights(0);
    const defsCount = CAR_DEFS.length;
    players.forEach((p, idx) => {
      const def = CAR_DEFS[p.car % defsCount];
      const vis = new CarVisual(this.protos[p.car % defsCount], def, p.color);
      this.scene.add(vis.group);
      if (p.id !== myId) vis.setShadowProxy(true);          // only the player's own car casts a full-detail shadow
      const slot = this.battle ? this.arenaSlot(p.slot ?? idx, players.length) : this.track.gridSlot(p.slot ?? idx);
      const r = {
        id: p.id, name: p.name, car: p.car, def, vis, bot: !!p.bot,
        kind: p.id === myId ? 'me' : (p.bot && isHost) ? 'ai' : 'remote',
        lapCross: 0, prog: 0, lastI: slot.i, finish: null, place: 0, lapStart: 0, lastLap: null, bestLap: null,
        state: { dead: false, hp: BATTLE.maxHp, x: slot.x, z: slot.z, psi: slot.psi, vx: 0, vz: 0, steer: 0, gear: 1, rpm: 0.18, thr: 0, nitro: 0, drift: 0, speed: 0 },
        net: null, auto: false,
        hp: BATTLE.maxHp, shown: BATTLE.maxHp, ghost: BATTLE.maxHp, dead: false, deathAt: 0, hitAt: -9,
      };
      if (r.kind !== 'remote') {
        r.v = new Vehicle(); if (def.id === 'charger') { r.v.ramMul = 0.25; r.v.hitMul = 1.6; } r.v.place(slot.x, slot.z, slot.psi); r.v.locked = true;
        if (r.kind === 'ai') r.bot = this.battle ? new BattleBot(r.v, this.track, 0.35 + Math.random() * 0.6) : new Bot(r.v, this.track, Math.random());
      }
      this.arsenal.initRacer(r);
      r.loadout = r.kind === 'me' ? fixLoadout(loadout) : r.kind === 'ai' ? fixLoadout([], true) : [];   // the 3 abilities on keys 1 2 3
      this.racers.set(r.id, r);
      if (r.kind !== 'me') this.hud.addLabel(r.id, r.name, r.def.color);
      if (r.kind === 'me') { this.me = r; r.v.auto = false; }
    });
    this.hud.setLoadout(this.battle ? this.me.loadout : []);
    this.camAng = this.me.v.psi; this.camPos.set(this.me.v.x, 3, this.me.v.z);
    this.audio.clearRemotes();
    this.updateRanks();
    this.hud.show(true);
  }

  // ------------------------------------------------------------------ network in
  onState(id, s) {
    const r = this.racers.get(id);
    if (!r || r.kind !== 'remote') return;
    const n = r.net || (r.net = {});
    [n.x, n.z, n.psi, n.vx, n.vz, n.steer, n.gear, n.rpm, n.thr, n.nitro, n.drift, n.prog, n.lap, n.hp] = s;
    n.t = performance.now();
    if (!r.seen) { r.seen = true; r.state.x = n.x; r.state.z = n.z; r.state.psi = n.psi; }
  }
  onFinish(id, time) {
    const r = this.racers.get(id); if (!r || r.finish != null) return;
    r.finish = time; r.place = ++this.finishCount;
    if (this.battle) return;
    if (r.kind === 'remote') this.msg(`{flag} ${r.name} marraga yetdi (${r.place}-o'rin)`, 2200, 'small');
  }
  removeRacer(id) {
    const r = this.racers.get(id); if (!r) return;
    if (this.tow && this.tow.target === r) this.releaseTow(true);
    this.scene.remove(r.vis.group); this.hud.removeLabel(id); this.audio.removeRemote(id); this.racers.delete(id); this.arsenal.onKill(r);
    if (this.battle) this.checkBattleEnd();
  }

  // ------------------------------------------------------------------ tow cable (Dodge Charger, R)
  static TOW_RANGE = 20; static TOW_LEN = 8; static TOW_TIME = 20;   // the cable holds for 20 s, then lets go
  /** R: fire the cable at the nearest car behind (<= 20 m), or let go if already hooked */
  fireTow() {
    const m = this.me;
    if (!m || !m.v || m.dead || this.phase !== 'racing') return;
    if (this.tow) { this.releaseTow(); this.msg('Tros bo\'shatildi', 1200, 'small'); return; }
    const v = m.v, fx = Math.sin(v.psi), fz = Math.cos(v.psi);
    let best = null, bd = Race.TOW_RANGE;
    for (const r of this.racers.values()) {
      if (r === m || r.dead) continue;                            // locally simulated cars AND online players (their own machine applies the rope)
      const dx = r.state.x - v.x, dz = r.state.z - v.z, d = Math.hypot(dx, dz);
      if (d > bd || (dx * fx + dz * fz) / (d || 1) > -0.3) continue;   // must be behind us (~ 145 deg cone)
      best = r; bd = d;
    }
    if (!best) { this.msg('Orqada mashina yo\'q (20 m ichida)', 1400, 'small'); return; }
    this.tow = { target: best, fly: 0, L: bd, attached: false, remote: !best.v };
    if (this.tow.remote && this.net && !this.solo) this.net.send({ t: 'tow', to: best.id, on: 1 });
    this.audio.noiseBurst?.(0.15, 2500, 0.5, 'highpass');
  }
  releaseTow(silent) {
    const tw = this.tow;
    if (tw && tw.remote && this.net && !this.solo) this.net.send({ t: 'tow', to: tw.target.id, on: 0 });
    this.tow = null;
    if (this.cable) this.cable.visible = this.hook.visible = false;
  }
  /** rope constraint applied each physics sub-step: reels in to TOW_LEN, then drags the victim along */
  stepTow(dt) {
    const tw = this.tow, m = this.me;
    if (!tw || !tw.attached) return;
    const a = m.v, b = tw.target.v;
    if (tw.target.dead || m.dead || !this.racers.has(tw.target.id)) { this.releaseTow(); return; }
    tw.t = (tw.t || 0) + dt;
    if (tw.t >= Race.TOW_TIME) { this.releaseTow(); this.msg('Tros 20 soniyadan keyin uzildi', 1600, 'small'); return; }
    if (!b) return;                                                // online player: his own machine applies the rope (see stepRopes)
    this.ropePull(a, b, tw, dt);
  }
  /** the rope constraint itself: `a` = the Charger ({x,z,vx,vz}), `b` = the hooked Vehicle; rope = {L} */
  ropePull(a, b, rope, dt) {
    rope.L = Math.max(Race.TOW_LEN, rope.L - 22 * dt);             // reel in
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d;
    if (d > rope.L) {
      const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;         // + = separating
      const over = d - rope.L;
      const J = Math.max(0, rel) + Math.min(over * 12, 30);
      b.vx -= nx * J; b.vz -= nz * J;                              // only the hooked car is yanked: the Charger's own speed is never touched
      const push = Math.min(over, 4 * dt * 60);
      b.x -= nx * push; b.z -= nz * push;
    }
    b.yaw *= 0.9; b.psi += wrapA(Math.atan2(-nx, -nz) - b.psi) * Math.min(1, dt * 4);   // the hooked car trails behind, nose towards the Charger
  }
  /** ropes that OTHER players' Chargers have put on cars simulated here (me, or the bots I host) */
  stepRopes(dt) {
    for (const r of this.racers.values()) {
      const tb = r.towedBy; if (!tb || !r.v) continue;
      const o = tb.owner;
      if (r.dead || o.dead || !this.racers.has(o.id)) { r.towedBy = null; continue; }
      tb.t += dt;
      if (tb.t >= Race.TOW_TIME) { r.towedBy = null; if (r.kind === 'me') this.msg('Tros uzildi', 1400, 'small'); continue; }
      this.ropePull(o.state, r.v, tb, dt);
    }
  }
  /** a Charger (another player) hooked / released car `to` */
  onTow(fromId, toId, on) {
    const o = this.racers.get(fromId), r = this.racers.get(toId);
    if (!o || !r || !r.v || r.dead || this.phase !== 'racing') return;
    if (!on) { if (r.towedBy && r.towedBy.owner === o) r.towedBy = null; return; }
    const d = Math.hypot(o.state.x - r.v.x, o.state.z - r.v.z);
    if (d > Race.TOW_RANGE * 1.8) return;                          // stale / out of range
    r.towedBy = { owner: o, L: d, t: 0 };
    if (r.kind === 'me') { this.msg('{warn} ' + o.name + ' sizni trosga oldi!', 2200, 'small'); this.shake = Math.max(this.shake, 0.5); this.audio.thump?.(0.8); }
  }
  /** draw the tow cable between two points (rope from the Charger's rear eye to the hooked car) */
  drawCable(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1e-3;
    this.cable.visible = this.hook.visible = true;
    this.cable.position.set(ax + dx / 2, ay + dy / 2, az + dz / 2);
    this.cable.scale.set(1, 1, len);
    this.cable.lookAt(bx, by, bz);
    this.hook.position.set(bx, by, bz);
  }
  updateTow(dt) {
    const tw = this.tow;
    if (!tw) {                                                       // hooked by somebody else's Charger: show their cable too
      const tb = this.me && this.me.towedBy;
      if (tb && this.me.v) { const o = tb.owner.state, fx = Math.sin(o.psi), fz = Math.cos(o.psi); this.drawCable(o.x - fx * 2.3, 0.55, o.z - fz * 2.3, this.me.v.x, 0.5, this.me.v.z); }
      else if (this.cable.visible) this.cable.visible = this.hook.visible = false;
      return;
    }
    const m = this.me, b = tw.target.state;
    if (!m.v) { this.releaseTow(); return; }
    const a = m.v, fx = Math.sin(a.psi), fz = Math.cos(a.psi);
    const ax = a.x - fx * 2.3, az = a.z - fz * 2.3, ay = 0.55;      // rear tow eye
    const bx = b.x, bz = b.z, by = 0.5;
    if (!tw.attached) {
      tw.fly += dt / 0.18;
      if (tw.fly >= 1) { tw.fly = 1; tw.attached = true; this.shake = Math.max(this.shake, 0.5); this.audio.thump?.(0.8); this.msg('{check} Tros ilindi — 20 soniya sudralaydi (R: bo\'shatish)', 1800, 'small'); }
    }
    const f = tw.fly, hx = ax + (bx - ax) * f, hy = ay + (by - ay) * f, hz = az + (bz - az) * f;
    const dx = hx - ax, dy = hy - ay, dz = hz - az, len = Math.hypot(dx, dy, dz) || 1e-3;
    this.cable.visible = this.hook.visible = true;
    this.cable.position.set(ax + dx / 2, ay + dy / 2, az + dz / 2);
    this.cable.scale.set(1, 1, len);
    this.cable.lookAt(hx, hy, hz);
    this.hook.position.set(hx, hy, hz);
  }

  // ------------------------------------------------------------------ helpers
  respawn() {
    if (this.mission) { this.mission.respawn(); return; }
    const m = this.me; if (!m || !m.v || m.dead) return;
    const i = m.v.nearest.i < 0 ? 0 : m.v.nearest.i;
    const p = this.track.at(i, 0);
    m.v.place(p.x, p.z, this.track.heading(i));
    m.v.locked = this.phase === 'countdown';
    this.msg('Mashina yo\'lga qaytarildi', 1200, 'small');
  }

  // ------------------------------------------------------------------ battle abilities (keys 1 2 3 ... 9 0 - =)
  /** the player pressed loadout slot `slot` (key 1 / 2 / 3) */
  useAbility(slot) {
    const m = this.me;
    if (!this.battle || !m || !m.v || m.dead || this.phase !== 'racing' || m.v.locked || m.loadout[slot] == null) return false;
    return this.fireAbility(m, m.loadout[slot]);
  }
  /** fire ability `i` for a locally simulated car (the player or a bot I host) and tell everyone else */
  fireAbility(r, i) {
    const A = this.arsenal;
    if (!r.v || r.dead || r.cd[i] > A.t) { if (r.kind === 'me') this.audio.beep?.(170, 0.06, 0.08); return false; }
    const o = A.origin(r);
    if (!A.activate(r, i, o)) return false;
    r.cd[i] = A.t + ABILITIES[i].cd;
    if (this.net && !this.solo) {
      const f = x => Math.round(x * 100) / 100, p = [f(o.x), f(o.z), f(o.psi), f(o.vx), f(o.vz)];
      this.net.send(r.kind === 'me' ? { t: 'ab', k: i, p } : { t: 'ab', id: r.id, k: i, p });
    }
    return true;
  }
  /** somebody else used an ability */
  onAbility(id, k, p) {
    const r = this.racers.get(id);
    if (!r || r.kind !== 'remote' || r.dead || !this.battle || this.phase !== 'racing') return;
    k |= 0; if (k < 0 || k >= ABILITIES.length) return;
    const o = Array.isArray(p) && p.length >= 5 && p.every(Number.isFinite) ? { x: p[0], z: p[1], psi: p[2], vx: p[3], vz: p[4] } : this.arsenal.origin(r);
    this.arsenal.activate(r, k, o);
  }

  /** battle start spots: spread evenly round the ring, every other car facing the opposite way (instant head-ons) */
  arenaSlot(k, n) {
    const t = this.track, i = t.wrap(Math.round(t.N * k / Math.max(1, n))), p = t.at(i, 0);
    return { x: p.x, z: p.z, psi: t.heading(i) + (k % 2 ? Math.PI : 0), i };
  }

  updateRanks() {
    const list = [...this.racers.values()];
    if (this.battle) {            // alive first (most HP on top), then the wrecks — the latest to die ranks highest
      list.sort((a, b) => (a.dead - b.dead) || (a.dead ? b.deathAt - a.deathAt : b.hp - a.hp));
      list.forEach((r, i) => { r.rank = i + 1; });
      this.order = list;
      return;
    }
    for (const r of list) {
      if (r.kind === 'remote') r.prog = r.net ? (r.net.prog ?? 0) : 0;
      else r.prog = r.lapCross + this.track.wrap(r.v.nearest.i < 0 ? r.lastI : r.v.nearest.i) / this.track.N;
    }
    list.sort((a, b) => {
      if (a.finish != null && b.finish != null) return a.place - b.place;
      if (a.finish != null) return -1;
      if (b.finish != null) return 1;
      return b.prog - a.prog;
    });
    list.forEach((r, i) => { r.rank = i + 1; });
    this.order = list;
  }

  // ------------------------------------------------------------------ main update
  update(dt, w, h) {
    if (this.phase === 'idle') return;
    if (this.mission) { this.mission.update(dt, w, h); return; }
    dt = Math.min(dt, 0.1);
    this.t += dt;

    // countdown
    if (this.phase === 'countdown') {
      const remain = -this.t;
      const tick = Math.ceil(remain);
      if (tick < this.countTick) {
        this.countTick = tick;
        if (tick >= 1 && tick <= 5) { this.track.setLights(6 - tick); this.audio.beep(330, 0.18, 0.2); this.hud.countdown(String(tick)); }
        if (tick === 0 || remain <= 0) this.startGo();
      }
      if (remain <= 0 && this.phase === 'countdown') this.startGo();
    }
    if (this.phase === 'racing' || this.phase === 'over') this.raceClock += dt;

    // fixed-step physics
    // physics covers exactly this frame's time (split into <= 1/120 s pieces): no leftover remainder, so the
    // drawn car never stutters forward/back at high speed when frame times vary
    const n = Math.min(12, Math.max(1, Math.ceil(dt / STEP - 1e-6))), sub = dt / n;
    for (let i = 0; i < n; i++) this.step(sub);

    this.updateRemotes(dt);
    this.updateRanks();
    if (this.battle) this.checkBattleEnd(); else this.checkProgress();
    this.updateTow(dt);
    this.updateVisuals(dt);
    this.updateCamera(dt, w, h);
    this.updateFx(dt);
    this.updateAudio(dt);
    this.sendState(dt);
    this.updateHud(dt, w, h);
  }

  startGo() {
    this.phase = 'racing'; this.raceClock = 0; this.t = 0;
    this.track.setLights(5, true);
    this.audio.beep(660, 0.6, 0.28);
    this.hud.countdown('GO!', true);
    for (const r of this.racers.values()) if (r.v) { r.v.locked = false; r.lapStart = 0; }
    setTimeout(() => this.track.setLights(0), 2500);
  }

  step(dt) {
    const me = this.me;
    // me
    const bt = this.battle;
    if (me.v) {
      const inp = bt && me.dead ? DEAD_INP : me.towedBy ? TOWED_INP : this.input;   // hooked by a Charger: can only coast
      if (me.auto) me.bot.control(dt, inp, this.allStates(me), 0.55, true);
      else {
        if (me.v.auto && !me.v.locked) this.autoGear(me.v);
        else if (!me.v.locked && me.v.shiftCut <= 0 && me.v.gear > 1 && me.v.rpmRaw < 0.3 && !me.v.reversing) me.v.shift(-1);   // slowing down: drop a gear by itself
      }
      me.v.update(dt, inp, this.track);
    }
    for (const r of this.racers.values()) {
      if (r.kind !== 'ai') continue;
      if (bt && r.dead) { r.v.update(dt, DEAD_INP, this.track); continue; }
      if ((this.tow && this.tow.attached && this.tow.target === r) || r.towedBy) { r.v.update(dt, TOWED_INP, this.track); continue; }   // hooked: the driver can only coast
      const inp = r.bot.inp;
      r.bot.control(dt, inp, this.allStates(r), r.finish != null ? 0.5 : 1, !r.v.locked);
      r.v.update(dt, inp, this.track);
    }
    // collisions between all locally simulated cars + remote cars
    const list = [...this.racers.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const la = !!a.v, lb = !!b.v;
      if (!la && !lb) continue;
      const dx = a.state.x - b.state.x, dz = a.state.z - b.state.z;
      if (dx * dx + dz * dz > 36) continue;
      if ((a.v && a.v.jy > 0.9) || (b.v && b.v.jy > 0.9)) continue;   // a car in the air flies over the other one
      if (la && lb) {
        if (bt) { const sa = snapOf(a.v), sb = snapOf(b.v); a.v.collide(sb, 0.5); b.v.collide(sa, 0.5); }   // both see the same pre-impact speeds -> equal, fair damage
        else { a.v.collide(b.v, 0.5); b.v.collide(a.v, 0.5); }
      }
      else if (la) a.v.collide(b.state, 1);
      else b.v.collide(a.state, 1);
    }
    if (me.v && me.v.landEvent) { me.v.landEvent = false; if (me.v.landVel > 3) { this.shake = Math.max(this.shake, Math.min(0.8, me.v.landVel / 12)); this.audio.thump(Math.min(1.4, me.v.landVel / 8)); } }
    this.stepTow(dt); this.stepRopes(dt);
    for (const r of this.racers.values()) if (r.v) {
      const v = r.v;
      if (v.dmg) { const d = v.dmg; v.dmg = 0; if (bt && this.phase === 'racing' && !r.dead) this.hurt(r, d); }
      r.state.hp = r.hp; r.state.dead = r.dead;
      r.state.x = v.x; r.state.z = v.z; r.state.psi = v.psi; r.state.vx = v.vx; r.state.vz = v.vz;
      r.state.steer = v.steer; r.state.gear = v.gear; r.state.rpm = v.rpm; r.state.thr = v.throttle;
      r.state.nitro = v.nitroOn ? 1 : 0; r.state.drift = v.drift; r.state.speed = v.speed;
    }
    if (bt) this.arsenal.step(dt);
  }

  // ------------------------------------------------------------------ battle: health, wrecks, last car standing
  /** take `d` HP off a locally simulated car (called with damage worked out from the impact force) */
  hurt(r, d) {
    d *= this.arsenal.guard(r, d);                         // Qalqon blocks everything, Zirh halves it
    if (d <= 0.001) return;
    r.hp = Math.max(0, r.hp - d); r.hitAt = this.raceClock;
    if (r.kind === 'me') {
      this.hitFlash = Math.min(1, this.hitFlash + 0.25 + d / 28);
      this.dmgSum = (this.raceClock - this.dmgAt < 1.3 ? this.dmgSum : 0) + d; this.dmgAt = this.raceClock;
      this.audio.thump(Math.min(2, 0.4 + d / 14));
      this.shake = Math.max(this.shake, Math.min(1.1, d / 22));
    }
    if (r.hp <= 0) this.kill(r);
  }

  kill(r, fromNet = false) {
    if (r.dead) return;
    r.dead = true; r.hp = 0; r.state.hp = 0; r.state.dead = true; r.deathAt = this.raceClock;
    this.arsenal.onKill(r);
    if (r.finish == null) { r.finish = this.raceClock; r.place = ++this.finishCount; }
    this.hud.removeLabel(r.id);
    this.explode(r);
    const me = this.me, dist = Math.hypot(r.state.x - me.state.x, r.state.z - me.state.z);
    if (r.kind === 'me') {
      this.msg('{fire} MASHINANGIZ PORTLADI!', 4000, 'big');
      this.audio.thump(2.2); this.audio.noiseBurst(0.5, 120, 0.9, 'lowpass'); this.shake = 1.6;
      this.hud.setFinished(true);
      if (this.solo) this.battleEndAt = this.raceClock + 4;
    } else {
      this.msg(`{fire} ${r.name} yo'q qilindi`, 2200, 'small');
      if (dist < 90) { const k = 1 - dist / 90; this.audio.thump(0.4 + 1.6 * k); this.audio.noiseBurst(0.4, 140, 0.6 * k, 'lowpass'); }
    }
    if (!fromNet && this.net && !this.solo) {
      if (r.kind === 'me') this.net.send({ t: 'fin', time: r.finish });
      else if (r.kind === 'ai' && this.isHost) this.net.send({ t: 'fin', id: r.id, time: r.finish });
    }
  }

  /** last car standing wins; solo: show the results a moment later */
  checkBattleEnd() {
    if (this.phase !== 'racing' || this.raceClock < 1) return;
    const all = [...this.racers.values()];
    if (all.length >= 2) {
      const alive = all.filter(r => !r.dead);
      if (alive.length === 1 && alive[0].finish == null) {
        const w = alive[0];
        if (w.kind === 'me' || (w.kind === 'ai' && this.isHost)) {
          w.finish = this.raceClock + 1000; w.place = ++this.finishCount;     // +1000 s: ranks above everyone who died
          if (w.kind === 'me') {
            this.msg('{trophy} G\'OLIB SIZ!', 5000, 'big');
            this.audio.beep(880, 0.5, 0.25); setTimeout(() => this.audio.beep(1100, 0.7, 0.25), 250);
            this.hud.setFinished(true);
          } else this.msg(`{trophy} ${w.name} g'olib bo'ldi`, 3500, 'big');
          if (this.net && !this.solo) this.net.send(w.kind === 'me' ? { t: 'fin', time: w.finish } : { t: 'fin', id: w.id, time: w.finish });
          if (this.solo) this.battleEndAt = this.raceClock + 3.5;
        }
      }
    }
    if (this.solo && !this.soloEnded && this.battleEndAt != null && this.raceClock >= this.battleEndAt) {
      this.soloEnded = true;
      const key = r => r.finish ?? (500 + r.hp);
      const list = all.map(r => ({ id: r.id, name: r.name, car: r.car, bot: r.bot, time: r.finish, hp: r.hp, alive: !r.dead, me: r.kind === 'me' }))
        .sort((a, b) => key(b) - key(a));
      this.onEnd(list);
    }
  }

  allStates(self) {
    const out = [];
    for (const r of this.racers.values()) if (r !== self) out.push(r.state);
    return out;
  }

  autoGear(v) {
    if (v.shiftCut > 0) return;
    const hi = v.rpmRaw;
    if (hi > 0.93 && v.gear < 5 && v.throttle > 0.3) v.shift(1);
    else if (v.gear > 1 && Math.abs(v.vf) / TUNE.gears[v.gear - 1].max < 0.72 && hi < 0.5) v.shift(-1);
  }

  updateRemotes(dt) {
    const now = performance.now();
    for (const r of this.racers.values()) {
      if (r.kind !== 'remote') continue;
      const n = r.net, s = r.state;
      if (!n) continue;
      const age = Math.min((now - n.t) / 1000, 0.25);
      const tx = n.x + n.vx * age, tz = n.z + n.vz * age;
      const k = 1 - Math.exp(-dt * 14);
      const far = Math.hypot(tx - s.x, tz - s.z) > 25;
      s.x += (tx - s.x) * (far ? 1 : k); s.z += (tz - s.z) * (far ? 1 : k);
      s.psi += wrapA(n.psi - s.psi) * k;
      s.vx = n.vx; s.vz = n.vz; s.steer = n.steer; s.gear = n.gear;
      s.rpm += (n.rpm - s.rpm) * (1 - Math.exp(-dt * 10)); s.thr = n.thr; s.nitro = n.nitro; s.drift = n.drift;
      s.speed = Math.hypot(n.vx, n.vz);
      if ((this.battle || this.mission) && n.hp != null) { r.hp = n.hp; s.hp = n.hp; if (this.battle && n.hp <= 0 && !r.dead) this.kill(r, true); }
    }
  }

  checkProgress() {
    const N = this.track.N;
    for (const r of this.racers.values()) {
      if (!r.v) continue;
      const i = r.v.nearest.i; if (i < 0) continue;
      const d = i - r.lastI;
      if (d < -N / 2) {                                    // crossed the line forwards
        r.lapCross++;
        if (this.phase === 'racing' || this.phase === 'over') this.onLap(r);
      } else if (d > N / 2) r.lapCross--;
      r.lastI = i;
    }
  }

  onLap(r) {
    if (r.lapCross >= 2 || r.lapCross === 1) {
      if (r.lapCross >= 2) {
        const lt = this.raceClock - r.lapStart;
        r.lastLap = lt; if (r.bestLap == null || lt < r.bestLap) r.bestLap = lt;
        if (r.kind === 'me') this.msg(`{check} LAP ${r.lapCross - 1}  ${fmt(lt)}${lt === r.bestLap ? '  {star} eng yaxshi' : ''}`, 2600, 'lap');
      }
      r.lapStart = this.raceClock;
    }
    if (r.kind === 'me' && r.lapCross === this.laps && r.finish == null) this.msg('OXIRGI AYLANA!', 2400, 'big');
    if (r.lapCross >= this.laps + 1 && r.finish == null) this.finishRacer(r);
  }

  finishRacer(r) {
    r.finish = this.raceClock; r.place = ++this.finishCount;
    r.auto = r.kind === 'me';
    if (r.kind === 'me') {
      r.bot = r.bot || new Bot(r.v, this.track, 0.7);
      this.msg(`{flag} MARRA! ${r.place}-o'rin  ${fmt(r.finish)}`, 4500, 'big');
      this.audio.beep(880, 0.5, 0.25); setTimeout(() => this.audio.beep(1100, 0.7, 0.25), 250);
      if (this.net && !this.solo) this.net.send({ t: 'fin', time: r.finish });
      this.phase = 'over';
      this.hud.setFinished(true);
      if (this.solo) this.endTimer = this.raceClock + 18;
    } else if (r.kind === 'ai') {
      r.auto = true;
      if (this.net && !this.solo && this.isHost) this.net.send({ t: 'fin', id: r.id, time: r.finish });
      this.msg(`{flag} ${r.name} marraga yetdi`, 1800, 'small');
    }
    if (this.solo) this.checkSoloEnd();
  }

  checkSoloEnd() {
    if (this.soloEnded) return;
    const all = [...this.racers.values()];
    if (all.every(r => r.finish != null) || (this.endTimer && this.raceClock > this.endTimer)) {
      this.soloEnded = true;
      const list = all.map(r => ({ id: r.id, name: r.name, car: r.car, bot: r.bot, time: r.finish, prog: r.prog, me: r.kind === 'me' }));
      list.sort((a, b) => (a.time != null && b.time != null) ? a.time - b.time : a.time != null ? -1 : b.time != null ? 1 : b.prog - a.prog);
      this.onEnd(list);
    }
  }

  // ------------------------------------------------------------------ visuals / fx
  updateVisuals(dt) {
    const cp = this.camera.position, lodIn = this.quality === 'low' ? 45 : this.quality === 'medium' ? 60 : 72;
    for (const r of this.racers.values()) {
      const s = r.state;
      if (r.kind !== 'me') {                                   // far cars: boxes (hysteresis so they don't flicker between the two)
        const d = Math.hypot(s.x - cp.x, s.z - cp.z);
        if (!r.vis.far && d > lodIn * 1.12) r.vis.setFar(true); else if (r.vis.far && d < lodIn) r.vis.setFar(false);
      }
      let steerAngle, spin, latG = 0, accG = 0, hb = false;
      if (r.v) {
        steerAngle = r.v.steerAngle; spin = r.v.wheelSpin; latG = r.v.latG; accG = r.v.accG; hb = r.v.handbrake && !r.v.locked;
        r.vis.update(dt, { x: s.x, z: s.z, psi: s.psi, steerAngle, wheelSpin: spin, rearSpin: r.v.rearSpin, latG, accG, handbrake: hb, speed: r.v.speed, rpm: r.v.rpm, burn: r.v.burnout, jy: r.v.jy });
      } else {
        const vf = s.vx * Math.sin(s.psi) + s.vz * Math.cos(s.psi);
        const maxSteer = 0.72 + (0.26 - 0.72) * Math.pow(clamp(Math.abs(vf) / 62, 0, 1), 0.6);
        steerAngle = -s.steer * maxSteer; spin = vf / TUNE.wheelR;
        latG = -(vf * (s.steer)) * 0.0; accG = 0;
        r.vis.update(dt, { x: s.x, z: s.z, psi: s.psi, steerAngle, wheelSpin: spin, latG: s.drift * (s.steer > 0 ? 9 : -9), accG: 0, handbrake: false, speed: Math.hypot(s.vx, s.vz), rpm: s.rpm, burn: Math.hypot(s.vx, s.vz) < 2.5 && s.thr > 0.5 && s.rpm > 0.85, jy: this.mission && r.net ? (r.net.prog || 0) : 0 });
      }
    }
  }

  updateFx(dt) {
    const me = this.me;
    for (const r of this.racers.values()) {
      const s = r.state, sp = Math.sin(s.psi), cp = Math.cos(s.psi);
      const speed = s.speed;
      const v = r.v;
      const burning = !!(v && v.burnout);
      const drifting = ((v ? v.drift : s.drift) > 0.33 && speed > 7) || burning;
      const spin = v ? v.launchSpin && this.phase !== 'countdown' : false;
      const dist = Math.hypot(s.x - me.state.x, s.z - me.state.z);
      if (dist > 160) continue;
      // rear wheel positions (car forward = +z)
      const wheels = [[0.85, -1.35], [-0.85, -1.35]];
      for (let k = 0; k < 2; k++) {
        const [lx, lz] = wheels[k];
        const wx = s.x + (cp * lx + sp * lz), wz = s.z + (-sp * lx + cp * lz);
        const left = [cp, -sp];
        const id = r.id + k;
        if (drifting || spin) {
          const intensity = burning ? 0.75 + v.burn * 0.6 : spin ? 0.6 : (v ? v.drift : s.drift);
          this.skids.add(id, wx, wz, left[0], left[1], Math.min(1, intensity * 1.2));
          const rate = (burning ? 150 * intensity : spin ? 38 : 55 * intensity) * dt;
          const dark = burning ? Math.max(0.07, 0.93 - 0.9 * clamp(v.burn / 0.9, 0, 1)) : 0.92;
          let n = Math.floor(rate); if (Math.random() < rate - n) n++;
          for (let q = 0; q < n; q++) {
            this.smoke.emit(wx + (Math.random() - 0.5) * 0.4, 0.25 + Math.random() * 0.2, wz + (Math.random() - 0.5) * 0.4,
              s.vx * 0.25 + (Math.random() - 0.5) * 1.4, 0.7 + Math.random() * 1.2, s.vz * 0.25 + (Math.random() - 0.5) * 1.4,
              1.0 + Math.random() * 1.1, 1.4, (burning ? 8 : 6) + Math.random() * 3.5, (burning ? 0.7 : 0.5) * Math.min(1, 0.45 + intensity), dark, dark, dark * 1.02);
          }
        } else this.skids.add(id, wx, wz, 0, 0, 0);
        if (v && v.surface === 'gravel' && speed > 6 && Math.random() < dt * 40) {
          this.dust.emit(wx, 0.2, wz, (Math.random() - 0.5) * 3, 1 + Math.random(), (Math.random() - 0.5) * 3, 1.2, 1.2, 5, 0.5, 0.75, 0.62, 0.42);
        }
      }
      // burning engine: flames + thick black smoke, then smouldering
      if (v && (v.fire > 0 || (v.burn > 0.25 && !v.burnout))) {
        const on = v.fire > 0;
        const fr = (on ? 70 : 0) * dt, sr = (on ? 40 : 14 * v.burn) * dt;
        let n = Math.floor(fr); if (Math.random() < fr - n) n++;
        for (let q = 0; q < n; q++) {
          const lx = (Math.random() - 0.5) * 1.1, lz = 1.0 + Math.random() * 0.9;
          this.fire.emit(s.x + cp * lx + sp * lz, 0.7 + Math.random() * 0.3, s.z - sp * lx + cp * lz, s.vx * 0.5 + (Math.random() - 0.5), 2.5 + Math.random() * 3.5, s.vz * 0.5 + (Math.random() - 0.5), 0.45 + Math.random() * 0.4, 1.4, 0.4, 1.0, 1.0, 0.42 + Math.random() * 0.2, 0.08);
        }
        n = Math.floor(sr); if (Math.random() < sr - n) n++;
        for (let q = 0; q < n; q++) {
          const lz = 1.1 + Math.random() * 0.8;
          this.smoke.emit(s.x + sp * lz, 0.9, s.z + cp * lz, s.vx * 0.4 + (Math.random() - 0.5) * 1.5, 2.2 + Math.random() * 2, s.vz * 0.4 + (Math.random() - 0.5) * 1.5, 1.8 + Math.random() * 1.4, 2.0, 9 + Math.random() * 4, 0.75, 0.06, 0.06, 0.065);
        }
      }
      // exhaust pipes (positions are per car model): nitro, gear-shift flicker, Supra MK4 burnout pops
      const exh = r.def.exh || [[0.5, 0.4, -2.2], [-0.5, 0.4, -2.2]];
      const pipe = e => [s.x + cp * e[0] + sp * e[2], e[1], s.z - sp * e[0] + cp * e[2]];
      // exhaust smoke while driving: thicker under throttle, thin when coasting
      {
        const thrN = v ? v.throttle : (s.thr || 0), moving = Math.min(1, speed / 6);
        const rate = (3 + 22 * thrN) * (0.35 + 0.65 * moving) * dt * (v && v.fire > 0 ? 0 : 1);
        for (const e of exh.slice(0, 2)) {
          let n = Math.floor(rate); if (Math.random() < rate - n) n++;
          const [wx, wy, wz] = pipe(e);
          for (let q = 0; q < n; q++) this.smoke.emit(wx, wy, wz, s.vx * 0.6 - sp * (1.5 + Math.random()) + (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.6, s.vz * 0.6 - cp * (1.5 + Math.random()) + (Math.random() - 0.5) * 0.8, 0.7 + Math.random() * 0.7, 0.35, 1.6 + Math.random(), 0.16 + 0.14 * thrN, 0.55, 0.55, 0.56);
        }
      }
      const flame = (e, n, big) => {
        const [wx, wy, wz] = pipe(e);
        for (let q = 0; q < n; q++) {
          const sv = 3 + Math.random() * 4;
          this.fire.emit(wx, wy, wz, s.vx * 0.9 - sp * sv + (Math.random() - 0.5), Math.random() * 0.4, s.vz * 0.9 - cp * sv + (Math.random() - 0.5), 0.1 + Math.random() * 0.1, 0.08, big, 0.85, 1, 0.5 + Math.random() * 0.25, 0.1);
        }
      };
      // slow smoke puff: drifts back, then curves away to the car's right-hand side
      const puff = (e, n, left) => {
        const [wx, wy, wz] = pipe(e);
        for (let q = 0; q < n; q++) {
          const sv = 1 + Math.random() * 1.6, g = 0.5 + Math.random() * 0.25, side = 3 + Math.random() * 3;
          if (left) this.smoke.emit(wx, wy, wz, cp * (1.5 + Math.random() * 1.5), 0.2 + Math.random() * 0.5, -sp * (1.5 + Math.random() * 1.5), 1.4 + Math.random() * 1.0, 0.18, 0.9 + Math.random() * 0.7, 0.4, g, g, g * 1.03, cp * side, -sp * side);
          else this.smoke.emit(wx, wy, wz, s.vx * 0.5 - sp * sv, 0.2 + Math.random() * 0.5, s.vz * 0.5 - cp * sv, 1.2 + Math.random() * 1.0, 0.18, 0.9 + Math.random() * 0.7, 0.4, g, g, g * 1.03, -cp * side, sp * side);
        }
      };
      if (s.nitro > 0) {
        const per = exh.length > 2 ? 1 : 2;
        for (const e of exh) {
          const [wx, wy, wz] = pipe(e);
          for (let q = 0; q < per; q++) {
            this.fire.emit(wx, wy, wz, s.vx * 0.9 - sp * (6 + Math.random() * 5) + (Math.random() - 0.5), (Math.random() - 0.5) * 0.6, s.vz * 0.9 - cp * (6 + Math.random() * 5) + (Math.random() - 0.5), 0.22 + Math.random() * 0.12, 0.15, 0.55, 0.9, 0.35, 0.55, 1.0);
          }
          this.fire.emit(wx, wy, wz, s.vx * 0.95 - sp * 3, 0.1, s.vz * 0.95 - cp * 3, 0.16, 0.5, 0.8, 1.0, 0.7, 0.3);
        }
      }
      if (r.lastGear !== undefined && s.gear !== r.lastGear && dist < 60) for (const e of exh) { flame(e, 3, 0.4); puff(e, 2); }
      r.lastGear = s.gear;
      if (v && r.kind === 'me' && r.def.id === 'supra_mk4') {
        const pos = this.audio.burnPos(), prev = this.burnPopPos ?? -1;
        if (pos >= 0) {
          for (const tp of BURN_POPS) if (tp > prev && tp <= pos) for (const e of exh) { flame(e, 4, 0.5); puff(e, 3, true); }
          const rate = 18 * dt; let n = Math.floor(rate); if (Math.random() < rate - n) n++;
          if (n) for (const e of exh) puff(e, n, true);
        }
        this.burnPopPos = pos;
      }
      // wall / car impacts -> sparks
      const dmgFx = this.battle || !!this.mission;
      const hitPow = v ? Math.max(v.hitEvent || 0, dmgFx ? (v.carHit || 0) : 0) : 0;
      if (v && hitPow > 2) {
        const n = Math.min(40, hitPow * 2.2 | 0);
        for (let q = 0; q < n; q++) this.sparks.emit(s.x + (Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.6, s.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 12, 2 + Math.random() * 5, (Math.random() - 0.5) * 12, 0.5 + Math.random() * 0.5, 0.35, 0.1, 1, 1, 0.75, 0.3);
      }
      if (dmgFx && v && r.kind !== 'me' && (v.carHit || 0) > 4 && dist < 55) this.audio.thump(Math.min(1.2, v.carHit / 30) * (1 - dist / 55));
      // damaged cars smoke, badly damaged ones burn; wrecks burn out
      if (dmgFx && (r.dead || r.hp < 55)) {
        const sev = r.dead ? 1 : clamp((55 - r.hp) / 55, 0, 1);
        const sr = (5 + 38 * sev) * dt, fr = r.dead ? 40 * dt : r.hp < 22 ? (8 + 30 * (1 - r.hp / 22)) * dt : 0;
        const g = r.dead ? 0.05 : 0.5 - 0.42 * sev;
        let n = Math.floor(sr); if (Math.random() < sr - n) n++;
        for (let q = 0; q < n; q++) {
          const lz = 1.1 + Math.random() * 0.8;
          this.smoke.emit(s.x + sp * lz, 0.9, s.z + cp * lz, s.vx * 0.4 + (Math.random() - 0.5) * 1.5, 2.0 + Math.random() * 2, s.vz * 0.4 + (Math.random() - 0.5) * 1.5, 1.6 + Math.random() * 1.2, 1.8, 7 + Math.random() * 4, 0.55 + 0.2 * sev, g, g, g * 1.03);
        }
        n = Math.floor(fr); if (Math.random() < fr - n) n++;
        for (let q = 0; q < n; q++) {
          const lx = (Math.random() - 0.5) * 1.1, lz = 1.0 + Math.random() * 0.9;
          this.fire.emit(s.x + cp * lx + sp * lz, 0.7 + Math.random() * 0.3, s.z - sp * lx + cp * lz, s.vx * 0.5 + (Math.random() - 0.5), 2.2 + Math.random() * 3, s.vz * 0.5 + (Math.random() - 0.5), 0.4 + Math.random() * 0.4, 1.4, 0.4, 1.0, 1.0, 0.42 + Math.random() * 0.2, 0.08);
        }
      }
      if (v && r.kind === 'me') {
        if (v.warnEvent) { v.warnEvent = false; this.msg('{warn} Shinalar kuymoqda! Gaz yoki tormozni qo\'yib yuboring', 2400, 'small'); }
        if (v.igniteEvent) { v.igniteEvent = false; this.msg('{fire} MASHINA PORTLADI!', 3500, 'big'); this.audio.thump(2.2); this.audio.noiseBurst(1.6, 700, 0.6, 'bandpass', 0.6); this.audio.noiseBurst(0.5, 120, 0.9, 'lowpass'); this.shake = 1.6; this.explode(r); }
        if (v.fireOut) { v.fireOut = false; this.msg('Olov o\'chdi', 1800, 'small'); }
        if (!this.battle && (v.hitEvent || 0) > 3) { this.audio.thump(v.hitEvent / 20); this.shake = Math.max(this.shake, Math.min(1, v.hitEvent / 18)); }
        if (!this.battle && (v.carHit || 0) > 1.5) { this.audio.thump(v.carHit / 25); this.shake = Math.max(this.shake, Math.min(0.6, v.carHit / 25)); }
      }
      if (v) { v.hitEvent = 0; v.carHit = 0; }
    }
    this.skids.flush();
    this.smoke.update(dt, this.camera, this.renderer.domElement.height);
    this.dust.update(dt, this.camera, this.renderer.domElement.height);
    this.fire.update(dt, this.camera, this.renderer.domElement.height);
    this.sparks.update(dt, this.camera, this.renderer.domElement.height);
  }

  /** big fireball + debris at the car */
  explode(r) {
    const s = r.state;
    for (let q = 0; q < 160; q++) {
      const a = Math.random() * 6.283, sp = 4 + Math.random() * 16, up = 2 + Math.random() * 14;
      this.fire.emit(s.x + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 0.8, s.z + (Math.random() - 0.5) * 2, Math.cos(a) * sp, up, Math.sin(a) * sp, 0.5 + Math.random() * 0.8, 0.6, 5 + Math.random() * 4, 1.0, 0.75 + Math.random() * 0.25, 0.3 + Math.random() * 0.3, 0.05);
    }
    for (let q = 0; q < 80; q++) {
      const a = Math.random() * 6.283, sp = 3 + Math.random() * 10;
      this.smoke.emit(s.x + (Math.random() - 0.5) * 2, 0.8 + Math.random(), s.z + (Math.random() - 0.5) * 2, Math.cos(a) * sp, 3 + Math.random() * 8, Math.sin(a) * sp, 2.0 + Math.random() * 1.5, 1.8, 9 + Math.random() * 4, 0.8, 0.05, 0.05, 0.05);
    }
    for (let q = 0; q < 60; q++) this.sparks.emit(s.x, 0.8, s.z, (Math.random() - 0.5) * 30, 4 + Math.random() * 14, (Math.random() - 0.5) * 30, 0.8 + Math.random() * 0.8, 0.4, 0.1, 1, 0.9, 0.5, 0.2);
  }

  updateAudio(dt) {
    const me = this.me, v = me.v;
    v.revHold = this.input.throttle;
    this.audio.updatePlayer(v, dt, me.def.id);
    v.shifted = 0;
    // other cars
    const cam = this.camera;
    const camDir = new THREE.Vector3(); cam.getWorldDirection(camDir);
    const right = new THREE.Vector3(-camDir.z, 0, camDir.x).normalize();
    for (const r of this.racers.values()) {
      if (r === me) continue;
      const dx = r.state.x - cam.position.x, dz = r.state.z - cam.position.z, d = Math.hypot(dx, dz);
      const pan = clamp((dx * right.x + dz * right.z) / Math.max(d, 1), -1, 1) * clamp(d / 10, 0, 1);
      this.audio.updateRemote(r.id, r.state.rpm, r.state.thr, d, pan);
    }
  }

  sendState(dt) {
    if (!this.net || this.solo) return;
    this.sendT += dt;
    if (this.sendT < 0.05) return;
    this.sendT = 0;
    const pack = r => {
      const v = r.v, f = x => Math.round(x * 100) / 100;
      return [f(v.x), f(v.z), f(v.psi), f(v.vx), f(v.vz), f(v.steer), v.gear, f(v.rpm), f(v.throttle), v.nitroOn ? 1 : 0, f(v.drift), f(r.lapCross + this.track.wrap(v.nearest.i < 0 ? r.lastI : v.nearest.i) / this.track.N), r.lapCross, Math.round(r.hp * 10) / 10];
    };
    this.net.send({ t: 'st', s: pack(this.me) });
    if (this.isHost) for (const r of this.racers.values()) if (r.kind === 'ai') this.net.send({ t: 'st', id: r.id, s: pack(r) });
  }

  // ------------------------------------------------------------------ camera
  updateCamera(dt, w, h) {
    const cam = this.camera, me = this.me, v = me.v;
    if (cam.aspect !== w / h) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
    const speed = v.speed, kmFrac = clamp(speed / 105, 0, 1);
    // blend between car heading and its velocity direction (shows drifts nicely)
    let tgt = v.psi;
    if (speed > 6) {     // reversing: compare against the *backwards* heading, otherwise the camera flips left/right
      const vang = Math.atan2(v.vx, v.vz) + (v.vf < 0 ? Math.PI : 0);
      tgt += clamp(wrapA(vang - v.psi), -0.7, 0.7) * 0.45;
    }
    let intro = 0, introDist = 0;
    if (this.phase === 'countdown') {
      const k = clamp((-this.t) / 6, 0, 1);
      intro = Math.pow(k, 1.6) * 3.1; introDist = Math.pow(k, 1.2) * 4;
    }
    const mode = this.camMode;
    if (mode === 2) {   // bumper
      this.camAng += wrapA(v.psi - this.camAng) * (1 - Math.exp(-dt * 14));
      const f = [Math.sin(this.camAng), Math.cos(this.camAng)];
      cam.position.set(v.x + f[0] * 2.1, 0.78, v.z + f[1] * 2.1);
      cam.lookAt(v.x + f[0] * 30, 0.7, v.z + f[1] * 30);
    } else {
      this.camAng += wrapA(tgt + intro - this.camAng) * (1 - Math.exp(-dt * (this.phase === 'countdown' ? 3 : 4.5)));
      const dist = (mode === 1 ? 8 : 5.2) + kmFrac * (mode === 1 ? 0.8 : 0.5) + introDist;
      const height = (mode === 1 ? 3.3 : 1.9) + kmFrac * 0.25 + introDist * 0.15;
      const ax = Math.sin(this.camAng), az = Math.cos(this.camAng);
      const want = new THREE.Vector3(v.x - ax * dist, height, v.z - az * dist);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 38));
      cam.position.copy(this.camPos);
      if (this.world) this.world.pushCamera(cam, v.x, v.z);                  // never look through a building
      cam.lookAt(v.x + Math.sin(v.psi) * 4.5, 1.15 + (mode === 1 ? 0.6 : 0), v.z + Math.cos(v.psi) * 4.5);
    }
    // shake
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * 0.35 + (v.nitroOn ? 0.025 : 0) + kmFrac * kmFrac * 0.004;
    if (sh > 0) {        // smooth (sine) shake instead of per-frame random jitter, which looked like stutter at high speed
      const tt = performance.now() * 0.001;
      cam.position.add(this._shk.set(Math.sin(tt * 37.1), Math.sin(tt * 43.7 + 1.3), Math.sin(tt * 31.3 + 2.1)).multiplyScalar(sh * 0.5));
    }
    const fovT = 58 + 9 * kmFrac + (v.nitroOn ? 9 : 0) + (mode === 2 ? 8 : 0);
    cam.fov += (fovT - cam.fov) * (1 - Math.exp(-dt * 4));
    cam.updateProjectionMatrix();
    // sun follows
    // snap the shadow frustum to whole shadow-map texels so shadows don't crawl/shimmer while driving fast
    const d = this.sky.sunDir, sc = this.sun.shadow.camera;
    const ts = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    const rx = d.z, rz = -d.x, rl = Math.hypot(rx, rz) || 1, Rx = rx / rl, Rz = rz / rl;
    const Ux = d.y * Rz, Uy = d.z * Rx - d.x * Rz, Uz = -d.y * Rx;
    const pr = v.x * Rx + v.z * Rz, pu = v.x * Ux + v.z * Uz;
    const dr = Math.round(pr / ts) * ts - pr, du = Math.round(pu / ts) * ts - pu;
    const tx = v.x + Rx * dr + Ux * du, ty = Uy * du, tz = v.z + Rz * dr + Uz * du;
    this.sun.target.position.set(tx, ty, tz);
    this.sun.position.set(tx + d.x * 140, ty + d.y * 140, tz + d.z * 140);
    this.sky.sky.position.copy(cam.position);
  }

  // ------------------------------------------------------------------ HUD
  updateHud(dt, w, h) {
    const me = this.me, v = me.v, bt = this.battle;
    if (bt) {
      // health bars ease towards the real value (the bright "ghost" bar lingers, then drains slowly)
      for (const r of this.racers.values()) {
        r.shown += (r.hp - r.shown) * (1 - Math.exp(-dt * 6));
        if (this.raceClock - r.hitAt > 0.5) r.ghost += (r.shown - r.ghost) * (1 - Math.exp(-dt * 1.3));
        r.ghost = Math.max(r.ghost, r.shown);
      }
      this.hitFlash = Math.max(0, this.hitFlash - dt * 1.4);
    }
    const hint = v.rpmRaw > 0.9 && v.gear < 5 && !v.auto && v.throttle > 0.3;
    // wrong way
    const t = this.track.T[this.track.wrap(v.nearest.i < 0 ? 0 : v.nearest.i)];
    const fwd = Math.sin(v.psi) * t.x + Math.cos(v.psi) * t.z;
    const wrong = !bt && fwd < -0.25 && v.speed > 5 && this.phase !== 'countdown';
    // drift scoring
    const dr = !bt && v.drift > 0.4 && v.speed > 12 && !v.reversing && v.surface !== 'gravel';
    if (dr) { this.driftScore += v.speed * v.drift * dt * 1.4 * this.driftMult; this.driftTimer = 0; this.driftMult = Math.min(5, this.driftMult + dt * 0.25); }
    else { this.driftTimer += dt; if (this.driftTimer > 1.4 && this.driftScore > 0) { this.driftBank += this.driftScore; this.driftScore = 0; this.driftMult = 1; } }
    if (v.hit > 0.5) { this.driftScore = 0; this.driftMult = 1; }
    const labels = [];
    for (const r of this.racers.values()) {
      if (r === me) continue;
      labels.push({ id: r.id, x: r.state.x, y: 2.3, z: r.state.z, rank: r.rank, dist: r.dead ? 1e9 : Math.hypot(r.state.x - v.x, r.state.z - v.z), hp: bt ? r.shown : null, ghost: r.ghost });
    }
    this.hud.update({
      kmh: v.speed * 3.6 | 0, gear: v.reversing ? 'R' : String(v.gear), rpm: v.rpm, rpmRaw: v.rpmRaw, nitro: v.nitro, nitroOn: v.nitroOn,
      lap: clamp(me.lapCross, 1, this.laps), laps: this.laps, rank: me.rank, total: this.racers.size,
      clock: this.raceClock, lapTime: this.raceClock - me.lapStart, best: me.bestLap, last: me.lastLap,
      hint, wrong, manual: !v.auto, drift: this.driftScore, mult: this.driftMult, bank: this.driftBank,
      phase: this.phase, order: this.order.map(r => ({ id: r.id, name: r.name, color: r.def.color, me: r === me, finish: r.finish, rank: r.rank, hp: r.shown, dead: r.dead })),
      battle: bt, hp: me.shown, ghost: me.ghost, hpReal: me.hp, alive: bt ? this.order.filter(r => !r.dead).length : 0, hitFlash: this.hitFlash, dmg: this.dmgSum, dmgAge: this.raceClock - this.dmgAt,
      ab: bt && me.fx ? this.arsenal.hudState(me) : null,
      mini: this.order.map(r => ({ x: r.state.x, z: r.state.z, psi: r.state.psi, color: r.def.color, me: r === me })),
      camera: this.camera, w, h, labels, track: this.track, gearLimit: v.overrev, limiter: v.limiter,
    });
    if (!bt && this.solo && this.phase === 'over') this.checkSoloEnd();
  }
}

export function fmt(t) {
  if (t == null) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
