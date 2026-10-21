// O'yin ko'rinishi: three.js sahnasi, yorug'lik, personajlar, kamera, ovoz/effektlar, tarmoq ulanishi.
import * as THREE from 'three';
import { Sim, P, CHAR_PITCH } from './sim.js';
import { buildWorld, buildDoors, buildExit, buildCabinets, buildLamps, lampLevel, makeThrowable, makeWeapon, makeBat } from './builder.js';
import { createActor, createSnake, preloadActors, CHARS, GHOST_DEF, KILLER_DEF } from './actors.js';
import { Cine } from './cine.js';
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
    // qurollar (yerda), qo'ldagi qurol, ko'rshapalaklar
    this.wepMeshes = sim.weps.map(w => { const m = makeWeapon(w.type); m.position.set(w.x, 0.14, w.z); m.rotation.y = w.id * 2.3; scene.add(m); return m; });
    this.hand = { hammer: makeWeapon('hammer'), pistol: makeWeapon('pistol') };
    scene.add(this.camera);
    for (const h of Object.values(this.hand)) { h.visible = false; h.scale.setScalar(1.35); this.camera.add(h); }
    this.bats = []; this.muzzleT = 0;
    this.muzzle = new THREE.PointLight(0xffd9a0, 0, 10, 2); scene.add(this.muzzle);

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
    loads.push(createSnake().then(sn => { this.snakeV = sn; sn.root.visible = false; scene.add(sn.root); this.snakeLight = new THREE.PointLight(0xa8ffb0, 0, 7, 2); scene.add(this.snakeLight); }).catch(e => console.warn('snake', e)));
    loads.push(preloadActors([CHARS[0], CHARS[1], KILLER_DEF]));
    await Promise.all(loads);
    this.cine = await Cine.create(scene);                 // badroom (kadr): bo'lmasa sahna o'tkazib yuboriladi
    if (this.cine) this.cine.onEvent = (k, n) => { if (k === 'splat') this.hud.splat(n); };
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
    const wep = { hammer: makeWeapon('hammer'), pistol: makeWeapon('pistol') };
    for (const w of Object.values(wep)) { w.visible = false; w.scale.setScalar(1.25); w.position.set(0.28, a.height * 0.52, 0.3); g.add(w); }
    this.avatars.set(p.id, { g, a, cone, tag: sp, p, wep });
  }

  stop() {
    this.hub = null;
    this.running = false; cancelAnimationFrame(this._raf);
    if (this.cine) { this.cine.dispose(); this.cine = null; }
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
      if ((inp.locked || inp.touch.on) && !sim.look && !sim.cine) { this.lookYaw -= inp.dx * inp.sens; this.lookPitch = Math.max(-1.45, Math.min(1.45, this.lookPitch - inp.dy * inp.sens)); }
      const mv = inp.move();
      ctl = { mx: mv.x, mz: mv.z, run: inp.run, hold: inp.hold, pressed: new Set(inp.pressed) };
      if (inp.hit('KeyM')) { this.audio.setMuted(!this.audio.muted); this.hud.msg(this.audio.muted ? 'Ovoz o\'chirildi' : 'Ovoz yoqildi', 'info'); }
    }
    sim.update(dt, { ...ctl, yaw: this.lookYaw, pitch: this.lookPitch });
    if (this.hub) this.hub.update(dt);
    inp.endFrame();
    if (sim.look) { this.lookYaw = sim.look.yaw; this.lookPitch = sim.look.pitch; }
    this._handleFx(sim.fx.splice(0));
    this._render(dt);
    this.frameCount++;
  }

  // ------------------------------------------------------------------ effektlar -> ovoz / HUD
  _handleFx(list) {
    const a = this.audio, sim = this.sim, me = sim.me;
    for (const f of list) {
      switch (f.t) {
        case 'cine': this._beginCine(f); break;
        case 'cineEnd': this._endCine(); break;
        case 'scream': a.scream(f.self ? { pitch: f.p, vol: f.v, loud: true } : { x: f.x, z: f.z, pitch: f.p, vol: f.v }); break;
        case 'jump': this.jumpT = 1.4; this.jumpFrom = { x: sim.ghost.x, z: sim.ghost.z }; break;
        case 'stinger': a.stinger(0.9); break;
        case 'chime': a.chime(f.kind); break;
        case 'creak': a.creak(f.x, f.z, f.v || 0.4); break;
        case 'slam': a.slam(f.x, f.z, 1); break;
        case 'thud': f.glass ? a.glass(f.x, f.z, 0.6 * f.v + 0.2) : a.thud(f.x, f.z, 0.3 + 0.7 * f.v); break;
        case 'step': f.self ? a.step(null, null, f.run ? 0.3 : 0.18, f.run) : a.step(f.x, f.z, 0.3, f.run); break;
        case 'click': a.uiClick(); break;
        case 'cabOpen': a.creak(f.x, f.z, 0.55); f.self ? a.bats() : a.bats(f.x, f.z); this._spawnBats(f); break;
        case 'bite': if (f.self) { a.bite(); a.stinger(1); a.scream({ pitch: CHAR_PITCH[me.char] || 1, vol: 1.3, loud: true }); } else { a.bite(f.x, f.z); a.scream({ x: f.x, z: f.z, pitch: 1, vol: 1 }); } break;
        case 'snake': if (f.self) { a.hiss(); a.scream({ pitch: CHAR_PITCH[me.char] || 1, vol: 1.2, loud: true }); a.stinger(0.8); } else { a.hiss(f.x, f.z); a.scream({ x: f.x, z: f.z, pitch: 1, vol: 1 }); } break;
        case 'drag': a.scrape(); if (Math.random() < 0.5) a.scream({ pitch: CHAR_PITCH[me.char] || 1, vol: 0.7, loud: true }); break;
        case 'snakeEnd': a.hiss(f.x, f.z, 0.7); a.thud(f.x, f.z, 1, 1.4); break;
        case 'splat': this.hud.splat(f.n); break;
        case 'bhit': a.thud(f.x, f.z, 1, 1.5); break;
        case 'release': a.growl(f.x, f.z, 0.9); a.chime('key'); break;
        case 'atk': { if (f.w === 'kick') { a.swing(f.self ? null : f.x, f.self ? null : f.z); break; } const px = f.self ? null : f.x, pz = f.self ? null : f.z; if (f.w === 'pistol') { a.shot(px, pz); if (f.self) this.muzzleT = 0.09; } else a.swing(px, pz); break; }
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
  // shkaf ochilganda ko'rshapalaklar uchib chiqadi: ba'zilari to'g'ri yuzga qarab
  _spawnBats(f) {
    const me = this.sim.me, nx = Math.sin(f.rot || 0), nz = Math.cos(f.rot || 0), near = Math.hypot(f.x - me.x, f.z - me.z) < 16;
    for (let i = 0; i < 16 && this.bats.length < 70; i++) {
      const m = makeBat(), x = f.x + nx * 0.5 + (Math.random() - 0.5) * 0.5, z = f.z + nz * 0.5 + (Math.random() - 0.5) * 0.5, y = 0.8 + Math.random() * 1.0;
      m.position.set(x, y, z); this.scene.add(m);
      const sp = 3.5 + Math.random() * 3; let vx, vy, vz;
      if (near && Math.random() < 0.5) { const dx = me.x - x, dy = 1.5 - y, dz = me.z - z, l = Math.hypot(dx, dy, dz) || 1; vx = dx / l * sp; vy = dy / l * sp; vz = dz / l * sp; }
      else { const a = Math.atan2(nx, nz) + (Math.random() - 0.5) * 2.2; vx = Math.sin(a) * sp; vz = Math.cos(a) * sp; vy = 1 + Math.random() * 2; }
      this.bats.push({ m, x, y, z, vx, vy, vz, life: 4 + Math.random() * 3, t0: Math.random() * 6, passed: false });
    }
  }
  _updateBats(dt, me) {
    const sim = this.sim, t = sim.t;
    for (let i = this.bats.length - 1; i >= 0; i--) {
      const b = this.bats[i]; b.life -= dt;
      if (b.life <= 0) { this.scene.remove(b.m); this.bats.splice(i, 1); continue; }
      // yuzga yetganda o'tib ketadi
      if (!b.passed && Math.hypot(b.x - me.x, b.z - me.z, b.y - 1.5) < 0.9) { b.passed = true; const a = Math.random() * 6.28; b.vx = Math.cos(a) * 5; b.vz = Math.sin(a) * 5; b.vy = 1.5; sim.addFear(0.15); }
      b.vy += (Math.sin(t * 5 + b.t0) * 3 - (b.y - 1.6) * 1.2) * dt;        // tebranib, o'rtacha balandlikda qoladi
      b.vx += Math.sin(t * 4 + b.t0) * 2 * dt; b.vz += Math.cos(t * 3.4 + b.t0) * 2 * dt;
      let nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
      const r = sim.col.resolve(nx, nz, 0.15);
      if (r.hit) { b.vx = -b.vx * 0.8 + (Math.random() - 0.5); b.vz = -b.vz * 0.8 + (Math.random() - 0.5); nx = r.x; nz = r.z; }
      b.x = nx; b.z = nz; b.y = Math.max(0.25, Math.min(WALL_H - 0.25, b.y + b.vy * dt));
      b.m.position.set(b.x, b.y, b.z); b.m.rotation.y = Math.atan2(b.vx, b.vz);
      const fl = Math.sin(t * 34 + b.t0 * 7) * 0.9; b.m.userData.wings[0].rotation.z = fl; b.m.userData.wings[1].rotation.z = -fl;
      b.m.scale.setScalar(1.5 * Math.min(1, b.life / 0.6));
    }
  }
  _onOver(f) {
    this.audio.chime(f.win ? 'win' : 'lose');
    this.input.unlock();
    if (this.onEnd) this.onEnd(f);
  }

  // ------------------------------------------------------------------ kadr (badroom)
  async _beginCine(f) {
    const sim = this.sim, c = this.cine;
    if (!c) { sim.finishCine(); return; }
    const pa = sim.players.get(f.a), pb = f.b ? sim.players.get(f.b) : null;
    const ai = pa && CHARS[pa.char] && CHARS[pa.char].role === 'survivor' ? pa.char : 0;
    const bi = pb && CHARS[pb.char] && CHARS[pb.char].role === 'survivor' ? pb.char : (ai === 0 ? 1 : 0);      // sherik yo'q bo'lsa — boshqa qahramon
    const gp = sim.ghostOwner ? sim.players.get(sim.ghostOwner) : null, gc = gp ? CHARS[gp.char] : null;
    const gdef = gc ? { ...gc, h: gc.role === 'ghost' ? gc.h : gc.h * 1.25 } : GHOST_DEF;
    const lids = document.getElementById('hzLids'); if (lids) lids.classList.remove('closed');
    try {
      await c.begin({ aDef: CHARS[ai], bDef: CHARS[bi], ghostDef: gdef, audio: this.audio, pitchA: CHAR_PITCH[ai] || 1, pitchB: CHAR_PITCH[bi] || 1 });
    } catch (e) { console.warn('cine', e); sim.finishCine(); return; }
    this.renderer.compile(this.scene, this.camera);          // soyalar yoqildi: shaderlarni oldindan kompilyatsiya qilamiz (qora parda ostida)
    if (!sim.cine) this._endCine();           // kutish paytida tugab qolgan bo'lsa
  }
  _endCine() {
    const c = this.cine; if (!c || !c.active) return;
    c.end();
    this.renderer.compile(this.scene, this.camera);
    this.camera.fov = 74; this.camera.up.set(0, 1, 0); this.camera.updateProjectionMatrix();
    this.crouchK = 0;
  }
  _renderCine(dt) {
    const sim = this.sim, c = this.cine;
    this.flash.intensity = 0; for (const l of this.lampLights) l.intensity = 0; for (const l of this.remoteSpots) l.intensity = 0; this.ghostLight.intensity = 0;
    const done = c.update(dt, this.camera, this);
    c.render(this.renderer, this.scene, this.camera, dt);
    if (done) sim.finishCine();
  }

  // ------------------------------------------------------------------ chizish
  _render(dt) {
    if (this.cine && this.cine.active) { if (!this.sim.cine) this._endCine(); else { this._renderCine(dt); return; } }
    const sim = this.sim, me = sim.me, cam = this.camera, t = sim.t;
    const lv = LEVELS[sim.level];
    const ghostView = me.role === 'ghost' || !me.alive || me.escaped;
    // kamera
    const moving = me.moving && !ghostView;
    this.bobY += ((moving ? Math.sin(me.bob * 2) * (me.running ? 0.07 : 0.04) : 0) - this.bobY) * Math.min(1, dt * 12);
    const scaredMe = !ghostView && me.frozen > 0;
    this.crouchK = (this.crouchK ?? 0) + ((scaredMe ? 1 : 0) - (this.crouchK ?? 0)) * Math.min(1, dt * 6);
    const lids = this.lids || (this.lids = document.getElementById('hzLids'));
    if (lids) lids.classList.toggle('closed', scaredMe && me.frozen < 4.7 && this.crouchK > 0.3);
    this.fallK = (this.fallK ?? 0) + ((sim.look ? sim.look.fall : 0) - (this.fallK ?? 0)) * Math.min(1, dt * 8);
    const eye = ghostView ? 1.75 + Math.sin(t * 1.3) * 0.08 : P.EYE - this.crouchK * 0.85 - this.fallK * 0.95;
    const sh = sim.shake;
    const shx = (Math.random() - 0.5) * 0.06 * sh, shy = (Math.random() - 0.5) * 0.06 * sh;
    cam.position.set(me.x, eye + this.bobY, me.z);
    cam.rotation.order = 'YXZ';
    const breath = Math.sin(t * 1.7) * 0.004 * (1 + sim.fear * 2);
    cam.rotation.set(this.lookPitch + shy + breath, this.lookYaw + shx, Math.sin(me.bob) * (moving ? 0.008 : 0) + (Math.random() - 0.5) * 0.02 * sh + Math.sin(t * 13) * 0.09 * this.fallK);
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
      const biteMe = !!sim.bite && sim.bite.to === me.id && me.alive;
      // ruh yaqinlashganda yuzi sekin-asta ekranga kelib to'ladi (3 m dan boshlab), nigoh ham uning tomoniga tortiladi
      let appr = 0;
      if (g.visible && !biteMe && !(this.jumpT > 0) && me.role === 'survivor' && me.alive && !me.escaped && gd < 3.2) {
        const k = Math.max(0, Math.min(1, (3.2 - gd) / 2.2)); appr = k * k * (3 - 2 * k);
        if (appr > 0.25) { let dy = Math.atan2(-(g.x - me.x), -(g.z - me.z)) - this.lookYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); this.lookYaw += dy * Math.min(1, dt * 2.2 * appr); this.lookPitch += (0.05 - this.lookPitch) * Math.min(1, dt * 2 * appr); sim.addFear(dt * 0.8); }
      }
      if ((this.jumpT > 0 || biteMe || appr > 0.02) && me.role === 'survivor') {            // yuz oldiga otilish / tishlab turish
        let e = 1; if (appr > 0.02) e = appr; else if (!biteMe) { this.jumpT -= dt; const k = Math.min(1, (1.4 - this.jumpT) / 0.3); e = k * k * (3 - 2 * k); }
        else if (this.jumpT > 0) this.jumpT = 0;
        const tx = me.x - Math.sin(this.lookYaw) * 0.45, tz = me.z - Math.cos(this.lookYaw) * 0.45, f = biteMe ? { x: tx, z: tz } : appr > 0.02 ? { x: g.x, z: g.z } : (this.jumpFrom || { x: tx, z: tz });
        ga.root.visible = true; const sc = 1 + 0.5 * e + (biteMe ? Math.sin(t * 28) * 0.025 : 0), hy = 0.93 * ga.height * sc; ga.root.scale.setScalar(sc); ga.root.position.set(f.x + (tx - f.x) * e, (1.5 - hy) * e, f.z + (tz - f.z) * e);
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
      av.crouch = (av.crouch ?? 0) + ((p.scared ? 1 : 0) - (av.crouch ?? 0)) * Math.min(1, dt * 6);
      av.a.root.scale.set(1 + av.crouch * 0.1, 1 - av.crouch * 0.45, 1 + av.crouch * 0.1);
      av.a.root.rotation.x = av.crouch * 0.35; av.tag.position.y = av.a.height * (1 - av.crouch * 0.45) + 0.3;
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
      const sw = Math.sin(Math.max(0, p.swingT || 0) / 0.4 * Math.PI);
      av.wep.hammer.visible = vis && p.weapon === 'hammer'; av.wep.pistol.visible = vis && p.weapon === 'pistol';
      av.wep.hammer.rotation.x = -0.9 + sw * 1.9; av.wep.pistol.position.z = 0.3 - sw * 0.08;
    }
    spots.sort((a, b) => a.d - b.d);
    for (let i = 0; i < REMOTE_SPOTS; i++) { const L = this.remoteSpots[i], s = spots[i]; if (s) { L.position.set(s.x, s.y, s.z); L.target.position.set(s.x + s.dx * 5, s.y + s.dy * 5, s.z + s.dz * 5); L.intensity = 40; } else L.intensity = 0; }

    // ilon
    if (this.snakeV) {
      const sv = this.snakeV, sn = sim.snake, sv_ = sv.root;
      if (sn) {
        const pos = sim.snakePos(sn), dragEnd = 0.7 + (sn.armed ? 1.8 : 3.0), tt = sn.t;
        let hx = pos.bx, hz = pos.bz;                                         // bosh orqaga (tortish yo'nalishi)
        if (!sn.dying && tt > dragEnd) { const k = Math.min(1, (tt - dragEnd) / 0.8); const a0 = Math.atan2(pos.bz, pos.bx), a1 = Math.atan2(-pos.bz, -pos.bx); let da = a1 - a0; da = Math.atan2(Math.sin(da), Math.cos(da)); const aa = a0 + da * k; hx = Math.cos(aa); hz = Math.sin(aa); }
        let sc = Math.min(1, 0.15 + tt / 0.7 * 0.85), y = -0.25 * (1 - Math.min(1, tt / 0.7)), shake = 0;
        if (sn.dying) { const k = Math.min(1, sn.dieT / 1.3); sc *= 1 - k * k; y -= 0.4 * k; shake = (1 - k) * 0.5; }
        sv_.visible = true; sv_.scale.setScalar(Math.max(0.01, sc));
        sv_.position.set(pos.x - hx * 1.35 * sc + (shake ? (Math.random() - 0.5) * shake * 0.3 : 0), y, pos.z - hz * 1.35 * sc);
        sv_.rotation.y = Math.atan2(-hz, hx) + (shake ? Math.sin(t * 40) * shake : 0); sv_.rotation.z = shake ? Math.sin(t * 33) * shake : 0;
        sv.action.paused = false; sv.action.time = Math.min(sv.duration - 0.5, 18 + tt * (sn.dying ? 4 : 2.2)); sv.mixer.update(0);
        this.snakeLight.position.set(pos.x, 0.8, pos.z); this.snakeLight.intensity = 2.4 * sc;
      } else { sv_.visible = false; this.snakeLight.intensity = 0; }
    }
    // qurollar, ko'rshapalaklar
    for (const w of sim.weps) { const m = this.wepMeshes[w.id]; m.visible = !w.by && (w.x - me.x) ** 2 + (w.z - me.z) ** 2 < FAR; if (m.visible) { m.rotation.y += dt * 0.8; m.position.y = 0.16 + Math.sin(t * 2 + w.id) * 0.04; } }
    const hw = (me.role === 'survivor' && me.alive && !me.escaped && me.weapon) || null;
    this.hand.hammer.visible = hw === 'hammer'; this.hand.pistol.visible = hw === 'pistol';
    { const sw = Math.sin(Math.max(0, me.swingT || 0) / 0.4 * Math.PI), H = this.hand.hammer, Pp = this.hand.pistol;
      H.position.set(0.3, -0.3 - sw * 0.08, -0.5 - sw * 0.12); H.rotation.set(0.8 - sw * 1.6, Math.PI, 0);
      Pp.position.set(0.24, -0.2, -0.45 + sw * 0.1); Pp.rotation.set(sw * 0.4, Math.PI, 0); }
    this.muzzleT = Math.max(0, (this.muzzleT || 0) - dt); this.muzzle.intensity = this.muzzleT > 0 ? 40 : 0; this.muzzle.position.copy(cam.position).addScaledVector(fwd, 0.6);
    this._updateBats(dt, me);

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
