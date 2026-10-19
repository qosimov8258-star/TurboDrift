// O'yin ko'rinishi: three.js sahnasi, yorug'lik, personajlar, kamera, ovoz/effektlar, tarmoq ulanishi.
import * as THREE from 'three';
import { Sim, P, CHAR_PITCH } from './sim.js';
import { buildWorld, buildDoors, buildExit, buildCabinets, buildLamps, lampLevel, makeThrowable } from './builder.js';
import { createActor, CHARS, GHOST_DEF } from './actors.js';
import { PHRASES } from './ghostai.js';
import { LEVELS, WALL_H } from './levels.js';
import { Bot } from './bot.js';
import { LocalHub } from './localhub.js';
import { mulberry32 } from './rng.js';

const LAMP_POOL = 4, REMOTE_SPOTS = 3;

export class Game {
  constructor(canvas, audio, input, hud) {
    this.canvas = canvas; this.audio = audio; this.input = input; this.hud = hud;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(0x000000);
    this.camera = new THREE.PerspectiveCamera(74, 1, 0.05, 90);
    this.running = false; this.sim = null; this.scene = null; this.onEnd = null;
    addEventListener('resize', () => this.resize());
    this.resize();
    this._last = 0; this._raf = 0;
    this.frameCount = 0;
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  async start(cfg) {
    this.stop();
    const { net, me, players, level, seed, diff, ghostId, hostId } = cfg;
    this.net = net; this.cfg = cfg;
    this.hub = null;
    this.sim = new Sim({ seed, level, diff, me, players, hostId, ghostId, send: m => { if (this.hub) this.hub.fromMe(m); else net.send(m); } });
    if (players.some(p => p.bot)) this.hub = new LocalHub(cfg, this.sim);
    const sim = this.sim, map = sim.map, lv = LEVELS[level];

    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x040405, lv.fog);
    scene.background = new THREE.Color(0x020203);
    this.world = buildWorld(map); scene.add(this.world.root);
    this.doors = buildDoors(map); scene.add(this.doors.group);
    this.exitV = buildExit(map); scene.add(this.exitV.group);
    this.cabV = buildCabinets(map); scene.add(this.cabV.group);
    this.lampV = buildLamps(map); scene.add(this.lampV.group);
    // otiladigan narsalar
    this.objMeshes = sim.objs.map(o => { const m = makeThrowable(o.type); m.position.set(o.x, o.y, o.z); m.rotation.set(0, o.id * 1.7, 0); scene.add(m); return m; });

    // yorug'lik
    this.hemi = new THREE.HemisphereLight(0x3a4560, 0x140c0c, lv.ambient * 3.4); scene.add(this.hemi);
    this.flash = new THREE.SpotLight(0xfff2d8, 36, 30, 0.52, 0.6, 1.5);
    this.flash.castShadow = true; this.flash.shadow.mapSize.set(1024, 1024); this.flash.shadow.camera.near = 0.25; this.flash.shadow.camera.far = 30; this.flash.shadow.bias = -0.0008; this.flash.shadow.normalBias = 0.03;
    scene.add(this.flash, this.flash.target);
    this.lampLights = []; for (let i = 0; i < LAMP_POOL; i++) { const l = new THREE.PointLight(0xffc98a, 0, 15, 2); scene.add(l); this.lampLights.push(l); }
    this.remoteSpots = []; for (let i = 0; i < REMOTE_SPOTS; i++) { const l = new THREE.SpotLight(0xfff2d8, 0, 20, 0.5, 0.6, 1.5); scene.add(l, l.target); this.remoteSpots.push(l); }
    this.ghostLight = new THREE.PointLight(0x7a9cff, 0, 9, 2); scene.add(this.ghostLight);

    // personajlar
    this.avatars = new Map();
    const loads = [];
    for (const p of sim.players.values()) {
      if (p.local || p.role === 'ghost') continue;
      loads.push(createActor(CHARS[p.char] || CHARS[0]).then(a => this._addAvatar(p, a)).catch(e => console.warn('actor', e)));
    }
    {
      const gp = sim.ghostOwner ? sim.players.get(sim.ghostOwner) : null, gc = gp ? CHARS[gp.char] : null;
      const gdef = gc ? { ...gc, h: gc.role === 'ghost' ? gc.h : gc.h * 1.25 } : GHOST_DEF;
      loads.push(createActor(gdef).then(a => {
        this.ghostActor = a; a.root.visible = false; scene.add(a.root);
        a.root.traverse(o => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0x1a2230); o.material.emissiveIntensity = 1; } });
      }).catch(e => console.warn('ghost actor', e)));
    }
    await Promise.all(loads);
    // beacons (ruh uchun)
    this.markers = new Map();

    // ovoz
    const a = this.audio;
    a.init(); a.stopMenu(); a.setupRooms(map.rooms, seed); a.startAmbience(level);
    this.clockOffset = cfg.t0 ? cfg.t0 - Date.now() : 0;   // hamma uchun umumiy "all" soati
    this.lookYaw = 0; this.lookPitch = 0;
    this.me = sim.me;
    // boshlang'ich yo'nalish: xonaning markaziga qaraydi
    const sr = map.rooms[map.start]; this.lookYaw = Math.atan2(-(sr.cx - this.me.x), -(sr.cz - this.me.z)); if (Math.hypot(sr.cx - this.me.x, sr.cz - this.me.z) < 0.2) this.lookYaw = 0;
    this.flashYaw = this.lookYaw; this.flashPitch = 0; this.fovBoost = 0; this.bobY = 0;
    this.bot = (new URLSearchParams(location.search).has('bot') || window.__hzBot) ? new Bot(sim, mulberry32(seed ^ 0x9e37)) : null;
    this.hud.begin(sim, this);
    this.running = true; this._last = performance.now(); this.time0 = performance.now();
    this._loop = this._loop.bind(this); this._raf = requestAnimationFrame(this._loop);
    this.input.enabled = true;
    window.__hz = this;
  }
  _addAvatar(p, a) {
    const g = new THREE.Group(); g.add(a.root); this.scene.add(g);
    // fanar nuri (ko'rinadigan konus)
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 9, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    cone.geometry.translate(0, -4.5, 0); cone.geometry.rotateX(-Math.PI / 2);      // cho'qqi koordinata boshida, +(-z) bo'ylab
    cone.visible = false; this.scene.add(cone);
    // ism yorlig'i
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); x.font = 'bold 34px Georgia'; x.textAlign = 'center'; x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 6; x.strokeText(p.name, 128, 44); x.fillText(p.name, 128, 44);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })); sp.scale.set(1.3, 0.33, 1); sp.position.y = a.height + 0.3; g.add(sp);
    this.avatars.set(p.id, { g, a, cone, tag: sp, p });
  }

  stop() {
    this.hub = null;
    this.running = false; cancelAnimationFrame(this._raf);
    if (this.scene) {
      this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      for (const x of [this.world, this.doors, this.exitV, this.cabV, this.lampV]) x && x.dispose && x.dispose();
      this.scene = null;
    }
    if (this.flash && this.flash.shadow && this.flash.shadow.map) this.flash.shadow.map.dispose();
    this.avatars = new Map(); this.ghostActor = null;
    if (this.audio) { this.audio.stopRooms(); this.audio.stopAmbience(); }
    if (this.input) this.input.enabled = false;
    this.sim = null;
    if (window.__hz === this) window.__hz = null;
  }

  _loop(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now;
    this.frame(dt);
  }

  frame(dt) {
    const sim = this.sim; if (!sim) return;
    if (this.paused) { this._render(0.0001); return; }
    const inp = this.input, me = sim.me;
    // ko'rish
    let ctl;
    if (this.bot) {
      const b = this.bot.step(dt); this.lookYaw = b.yaw; this.lookPitch = 0;
      ctl = { mx: b.mx, mz: b.mz, run: b.run, hold: b.hold, pressed: b.pressed };
    } else {
      if (inp.locked || inp.touch.on) { this.lookYaw -= inp.dx * inp.sens; this.lookPitch = Math.max(-1.45, Math.min(1.45, this.lookPitch - inp.dy * inp.sens)); }
      const mv = inp.move();
      ctl = { mx: mv.x, mz: mv.z, run: inp.run, hold: inp.hold, pressed: new Set(inp.pressed) };
      if (inp.hit('KeyM')) { this.audio.setMuted(!this.audio.muted); this.hud.msg(this.audio.muted ? 'Ovoz o\'chirildi' : 'Ovoz yoqildi', 'info'); }
    }
    sim.update(dt, { ...ctl, yaw: this.lookYaw, pitch: this.lookPitch });
    if (this.hub) this.hub.update(dt);
    inp.endFrame();
    this._handleFx(sim.fx.splice(0));
    this._render(dt);
    this.frameCount++;
  }

  // ------------------------------------------------------------------ effektlar -> ovoz / HUD
  _handleFx(list) {
    const a = this.audio, sim = this.sim, me = sim.me;
    for (const f of list) {
      switch (f.t) {
        case 'scream': a.scream(f.self ? { pitch: f.p, vol: f.v, loud: true } : { x: f.x, z: f.z, pitch: f.p, vol: f.v }); break;
        case 'jump': this.jumpT = 1.4; this.jumpFrom = { x: sim.ghost.x, z: sim.ghost.z }; break;
        case 'stinger': a.stinger(0.9); break;
        case 'chime': a.chime(f.kind); break;
        case 'creak': a.creak(f.x, f.z, f.v || 0.4); break;
        case 'slam': a.slam(f.x, f.z, 1); break;
        case 'thud': f.glass ? a.glass(f.x, f.z, 0.6 * f.v + 0.2) : a.thud(f.x, f.z, 0.3 + 0.7 * f.v); break;
        case 'step': f.self ? a.step(null, null, f.run ? 0.3 : 0.18, f.run) : a.step(f.x, f.z, 0.3, f.run); break;
        case 'click': a.uiClick(); break;
        case 'cabOpen': a.creak(f.x, f.z, 0.55); if (f.key) setTimeout(() => {}, 0); break;
        case 'exitOpen': a.clank(f.x, f.z); a.chime('win'); break;
        case 'clank': a.clank(f.x, f.z); break;
        case 'blackout': a.slam(me.x + 4, me.z, 0.5); this.hud.msg('Chiroqlar o\'chdi…', 'scare'); break;
        case 'appear': if (!f.far && Math.hypot(f.x - me.x, f.z - me.z) < 25) a.growl(f.x, f.z, 0.6); break;
        case 'say': {
          const txt = PHRASES[f.i] || '…';
          a.whisperNoise(f.x, f.z, 0.5); if (f.i === 6 || f.i === 7) a.growl(f.x, f.z, 0.35); if (f.d < 28) a.speak(txt, { dist: f.d, pitch: 0.2, rate: 0.6 });
          if (me.role === 'survivor' || f.d < 28) this.hud.subtitle(txt);
          break;
        }
        case 'sfx': ({ creak: () => a.creak(f.x, f.z, 0.5), knock: () => { a.thud(f.x, f.z, 0.8); setTimeout(() => a.thud(f.x, f.z, 0.8), 260); setTimeout(() => a.thud(f.x, f.z, 0.8), 520); }, bell: () => a.bell(f.x, f.z, 0.5), whisper: () => a.whisperNoise(f.x, f.z, 0.6), growl: () => a.growl(f.x, f.z, 0.7) }[f.n] || (() => {}))(); break;
        case 'flash': this.hud.flash(f.color, f.v); break;
        case 'msg': this.hud.msg(f.text, f.kind); break;
        case 'end': this._onOver(f); break;
        default: break;
      }
    }
  }
  _onOver(f) {
    this.audio.chime(f.win ? 'win' : 'lose');
    this.input.unlock();
    if (this.onEnd) this.onEnd(f);
  }

  // ------------------------------------------------------------------ chizish
  _render(dt) {
    const sim = this.sim, me = sim.me, cam = this.camera, t = sim.t;
    const lv = LEVELS[sim.level];
    const ghostView = me.role === 'ghost' || !me.alive || me.escaped;
    // kamera
    const moving = me.moving && !ghostView;
    this.bobY += ((moving ? Math.sin(me.bob * 2) * (me.running ? 0.07 : 0.04) : 0) - this.bobY) * Math.min(1, dt * 12);
    const eye = ghostView ? 1.75 + Math.sin(t * 1.3) * 0.08 : P.EYE;
    const sh = sim.shake;
    const shx = (Math.random() - 0.5) * 0.06 * sh, shy = (Math.random() - 0.5) * 0.06 * sh;
    cam.position.set(me.x, eye + this.bobY, me.z);
    cam.rotation.order = 'YXZ';
    const breath = Math.sin(t * 1.7) * 0.004 * (1 + sim.fear * 2);
    cam.rotation.set(this.lookPitch + shy + breath, this.lookYaw + shx, Math.sin(me.bob) * (moving ? 0.008 : 0) + (Math.random() - 0.5) * 0.02 * sh);
    const targetFov = 74 + (me.running ? 6 : 0) - sim.fear * 6 + sh * 4;
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 6); cam.updateProjectionMatrix();
    const blackout = t < sim.blackoutUntil;

    // ambient: ruh/tomoshabin uchun yorqinroq
    this.hemi.intensity = ghostView ? 3.2 : lv.ambient * 3.4;
    this.hemi.color.set(ghostView ? 0xb4c4ee : 0x3a4560); this.hemi.groundColor.set(ghostView ? 0x70708a : 0x140c0c);
    this.scene.fog.density = ghostView ? lv.fog * 0.12 : lv.fog;

    // fanar
    const fwd = new THREE.Vector3(-Math.sin(this.lookYaw) * Math.cos(this.lookPitch), Math.sin(this.lookPitch), -Math.cos(this.lookYaw) * Math.cos(this.lookPitch));
    let dyaw = this.lookYaw - this.flashYaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.flashYaw += dyaw * Math.min(1, dt * 9); this.flashPitch += (this.lookPitch - this.flashPitch) * Math.min(1, dt * 9);
    const fd = new THREE.Vector3(-Math.sin(this.flashYaw) * Math.cos(this.flashPitch), Math.sin(this.flashPitch), -Math.cos(this.flashYaw) * Math.cos(this.flashPitch));
    const rightV = new THREE.Vector3(Math.cos(this.lookYaw), 0, -Math.sin(this.lookYaw));
    this.flash.position.copy(cam.position).addScaledVector(rightV, 0.18).addScaledVector(fwd, 0.25); this.flash.position.y -= 0.12;
    this.flash.target.position.copy(this.flash.position).addScaledVector(fd, 6);
    let fl = (me.flash && me.alive && me.role === 'survivor' && !me.escaped) ? 1 : 0;
    const g = sim.ghost, gd = g.visible ? Math.hypot(g.x - me.x, g.z - me.z) : 99;
    if (fl) {
      if (blackout) fl = 0.35 + 0.5 * (Math.sin(t * 60) > 0 ? 1 : 0);
      else if (gd < 10 || sim.fear > 0.75) { const k = Math.max(1 - gd / 10, sim.fear - 0.6); fl = Math.sin(t * 47 + Math.sin(t * 13) * 3) > 1 - k * 1.6 ? 0.05 : 1; }
      else if (Math.sin(t * 2.3) * Math.sin(t * 7.1) > 0.92) fl = 0.65;       // ba'zan titraydi
    }
    this.flash.intensity = 36 * fl;

    // lampalar
    const lamps = this.lampV.lamps;
    const cand = [];
    for (const l of lamps) {
      const d = Math.hypot(l.x - me.x, l.z - me.z);
      const gnear = g.visible ? Math.max(0, 1 - Math.hypot(l.x - g.x, l.z - g.z) / 9) : 0;
      l.level = lampLevel(l, t, gnear, blackout);
      const v = 0.15 + l.level * 0.85; l.mat.color.setRGB(1 * v, 0.85 * v, 0.62 * v);
      if (d < 22) cand.push([d, l]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < LAMP_POOL; i++) {
      const L = this.lampLights[i], c = cand[i];
      if (c) { L.position.set(c[1].x, c[1].y - 0.2, c[1].z); L.intensity = 14 * c[1].level * Math.min(1, (22 - c[0]) / 8); } else L.intensity = 0;
    }

    // eshiklar (uzoqdagilari chizilmaydi — tuman ichida ko'rinmaydi ham)
    const FAR = 34 * 34;
    for (const dv of this.doors.doors) { const d = sim.doors[dv.id]; dv.pivot.rotation.y = dv.base + d.side * d.open * 1.75; dv.pivot.visible = (d.x - me.x) ** 2 + (d.z - me.z) ** 2 < FAR; }
    // chiqish eshigi
    const ex = sim.exit; this.exitV.bars.position.y = ex.open * 2.6; this.exitV.lightMat.opacity = ex.open * 0.85;
    this.exitV.lockMat.emissiveIntensity = ex.isOpen ? 0 : 0.6 + Math.sin(t * 3) * 0.3;
    // shkaflar
    for (const cv of this.cabV.list) { const c = sim.cabs[cv.id]; cv.group.visible = (cv.x - me.x) ** 2 + (cv.z - me.z) ** 2 < FAR; for (const d of cv.doors) d.pivot.rotation.y = d.sign * c.openAmt * 1.9; if (cv.key) { cv.key.visible = c.open && c.hasKey && (t - (cv.openedAt ??= t)) < 3.2 && sim.keysFound.has(cv.id); if (cv.key.visible) { cv.key.rotation.y = t * 2; } } }
    // narsalar
    for (const o of sim.objs) {
      const m = this.objMeshes[o.id]; m.position.set(o.x, o.y, o.z); m.visible = (o.x - me.x) ** 2 + (o.z - me.z) ** 2 < FAR;
      if (o.state === 'fly') { m.rotation.x += dt * 9; m.rotation.z += dt * 6; } else if (o.state === 'held') { m.rotation.y += dt * 2; } else { m.rotation.x *= 0.9; m.rotation.z *= 0.9; }
    }

    // ruh
    if (this.ghostActor) {
      const ga = this.ghostActor, vis = g.visible && !(me.role === 'ghost');
      const flick = (t - g.appearT < 0.5) ? (Math.sin(t * 70) > -0.3) : true;
      ga.root.visible = vis && flick;
      ga.root.position.set(g.x, 0.05 + Math.sin(t * 2) * 0.05, g.z);
      ga.root.rotation.y = g.yaw;
      this.ghostLight.position.set(g.x, 1.6, g.z); this.ghostLight.intensity = ga.root.visible ? 3.2 : 0;
      ga.root.rotation.z = Math.sin(t * 1.5) * 0.03;
      if (this.jumpT > 0 && me.role === 'survivor') {            // yuz oldiga otilish
        this.jumpT -= dt; const k = Math.min(1, (1.4 - this.jumpT) / 0.3), e = k * k * (3 - 2 * k), tx = me.x - Math.sin(this.lookYaw) * 0.45, tz = me.z - Math.cos(this.lookYaw) * 0.45, f = this.jumpFrom || { x: tx, z: tz };
        ga.root.visible = true; const sc = 1 + 0.5 * e, hy = 0.93 * ga.height * sc; ga.root.scale.setScalar(sc); ga.root.position.set(f.x + (tx - f.x) * e, (1.5 - hy) * e, f.z + (tz - f.z) * e);
        ga.root.rotation.y = Math.atan2(me.x - ga.root.position.x, me.z - ga.root.position.z); ga.root.rotation.z = 0;
        this.ghostLight.position.set(me.x - Math.sin(this.lookYaw) * 0.9, 1.6, me.z - Math.cos(this.lookYaw) * 0.9); this.ghostLight.intensity = 14;
      } else if (ga.root.scale.x !== 1) { ga.root.scale.setScalar(1);
      }
      if (ga.mixer && ga.actions[0]) { ga.actions[0].paused = !ga.root.visible; ga.mixer.update(dt); }
    }
    // boshqa o'yinchilar
    const spots = [];
    for (const av of this.avatars.values()) {
      const p = av.p, root = av.g;
      root.position.set(p.x, 0, p.z); root.rotation.y = p.yaw + Math.PI;
      const vis = p.alive && !p.escaped;
      root.visible = vis; av.a.root.visible = vis;
      if (av.a.mixer) { const a0 = av.a.actions[0]; if (a0) { a0.paused = !p.moving; a0.timeScale = Math.max(0.3, (p.speed || 2) / 2); } av.a.mixer.update(dt); }
      else { av.a.wrap.position.y = p.moving ? Math.abs(Math.sin(p.bob * 2)) * 0.05 : 0; av.a.wrap.rotation.z = p.moving ? Math.sin(p.bob * 2) * 0.05 : 0; }
      const on = vis && p.flash;
      av.cone.visible = on && !ghostView;
      if (on) {
        const ey = av.a.height * 0.9;
        const dxn = -Math.sin(p.yaw) * Math.cos(p.pitch), dyn = Math.sin(p.pitch), dzn = -Math.cos(p.yaw) * Math.cos(p.pitch);
        av.cone.position.set(p.x + dxn * 0.3, ey, p.z + dzn * 0.3);
        av.cone.lookAt(p.x + dxn * 5, ey + dyn * 5, p.z + dzn * 5);
        spots.push({ d: Math.hypot(p.x - me.x, p.z - me.z), x: p.x + dxn * 0.3, y: ey, z: p.z + dzn * 0.3, dx: dxn, dy: dyn, dz: dzn });
      }
      av.tag.visible = vis && Math.hypot(p.x - me.x, p.z - me.z) < 14;
    }
    spots.sort((a, b) => a.d - b.d);
    for (let i = 0; i < REMOTE_SPOTS; i++) { const L = this.remoteSpots[i], s = spots[i]; if (s) { L.position.set(s.x, s.y, s.z); L.target.position.set(s.x + s.dx * 5, s.y + s.dy * 5, s.z + s.dz * 5); L.intensity = 40; } else L.intensity = 0; }

    // ovoz
    const a = this.audio;
    a.setListener(me.x, me.z, this.lookYaw);
    a.updateRooms(me.x, me.z, Date.now() + this.clockOffset, (x, z) => !sim.col.los(me.x, me.z, x, z, false));
    a.heartbeat(sim.fear, dt);
    this._gStep = (this._gStep ?? 0) - dt;
    if (g.visible && g.chase && gd < 16 && this._gStep <= 0) { this._gStep = 0.34; a.step(g.x, g.z, 0.55, true); }
    this._ambTimer = (this._ambTimer ?? 6) - dt;
    if (this._ambTimer <= 0) { this._ambTimer = 7 + Math.random() * 14; const ang = Math.random() * 6.28, d = 8 + Math.random() * 14, x = me.x + Math.cos(ang) * d, z = me.z + Math.sin(ang) * d; const k = Math.floor(Math.random() * 4); [() => a.creak(x, z, 0.45), () => a.thud(x, z, 0.5), () => a.whisperNoise(x, z, 0.4), () => a.bell(x, z, 0.25)][k](); }

    this.hud.update(sim, this, dt);
    this.renderer.render(this.scene, cam);
  }
}
