import * as THREE from 'three';
import { Vehicle, CarVisual, CAR_DEFS, BATTLE } from './car.js';
import { THEME } from './trackdata.js';
import { PoliceDriver, FleeDriver } from './missionai.js';
import { Posts } from './missionposts.js';
import { FLEET_KINDS } from './missionfleet.js';
import { PropCars, Tumbler } from './missionprops.js';
import { Guns } from './missionguns.js';
import { Bombs } from './missionbombs.js';

// =====================================================================================================================
//  POLICE MISSION
//    role 'thief'  : (single player) grab LOOT_N cash bags scattered over the three cities, then reach the hideout.
//    role 'police' : you (+ friends online) and AI police chase an AI thief through the city and arrest him.
//  ARREST = a police car within BUST_R of the thief while he is (nearly) stopped for PIN_TIME seconds in a row.
//  After POST_FIRST seconds without an arrest, robot police start setting up roadblocks and shoot at the thief.
//  Online: the host runs everything (AI, rules, robots); friends drive their own police car and get snapshots.
// =====================================================================================================================
export const DIFFS = [
  { id: 0, name: 'Oson', cruise: 33, nitro: false, fleeSpeed: 35 },
  { id: 1, name: "O'rtacha", cruise: 40, nitro: true, fleeSpeed: 40 },
  { id: 2, name: 'Qiyin', cruise: 47, nitro: true, fleeSpeed: 45 },
];
export const THIEF_MIN = 1, THIEF_MAX = 8;
export const POLICE_MIN = 1, POLICE_MAX = 50, TIME_MIN = 60, TIME_MAX = 3600;
export const PIN_TIME = 10;                 // seconds the thief must be held still
const TOW = { range: 28, snap: 48, slack: 7, time: 28, decel: 26, breakAng: 0.7, minSpeed: 2.2, slowTime: 9 };   // police tow rope: the thief is hauled down to a crawl within ~9 s
const FLIP_MIN = 15;                         // m/s closing speed between two cars above which one of them rolls over
const THIEF_ARMOR = 0.4;                    // damage multiplier for thieves (0.4 = 2.5x the health)
const PIN_SPEED = 3.2;                      // m/s: slower than this counts as "stopped"
const LOOT_N = 5, LOOT_R = 6.5, HIDE_R = 9, BUST_R = 8;
const POST_FIRST = 60, POST_EVERY = 45, POST_MIN = 14, POST_MAX = 3;
const clamp01 = v => Math.max(0, Math.min(1, v));
const THIEF_CARS = [0, 1, 2, 3, 4];
const BLACK = 3;                            // PAINTS index
const STEP = 1 / 120;
const DEAD_INP = { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const r2 = x => Math.round(x * 100) / 100;

/** vertical alpha gradient for the light pillars: solid at the foot, fading out towards the sky */
let PILLAR = null;
function pillarTex() {
  if (PILLAR) return PILLAR;
  const c = document.createElement('canvas'); c.width = 4; c.height = 128; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(255,255,255,0.62)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  PILLAR = new THREE.CanvasTexture(c); PILLAR.colorSpace = THREE.SRGBColorSpace; return PILLAR;
}

/** distance field that is rebuilt in the background while the previous result keeps being used */
class FieldBuf {
  constructor(nav) { this.nav = nav; this.a = nav.field(); this.b = nav.field(); this.cur = null; this.building = null; }
  start(sources, limit = Infinity) { if (this.building) return false; const t = this.cur === this.a ? this.b : this.a; t.start(sources, limit); this.building = t; return true; }
  step(ms) { if (this.building && this.building.run(ms)) { this.cur = this.building; this.building = null; } }
  sync(sources) { const t = this.cur === this.a ? this.b : this.a; t.start(sources); t.runAll(); this.cur = t; this.building = null; }
}

export class Mission {
  constructor(race, world, nav, audio, hud, protos, mhud, fleet) {
    this.race = race; this.world = world; this.nav = nav; this.audio = audio; this.hud = hud; this.protos = protos; this.mhud = mhud; this.fleet = fleet;
    // open cells with room to spare = good places for spawns, loot, hideouts; narrow ones = roadblock spots
    this.wide = []; this.narrow = [];
    for (let k = 0; k < nav.open.length; k++) if (nav.open[k]) { if (nav.clear[k] >= 3.2) this.wide.push(k); else if (nav.clear[k] >= 1.6 && nav.clear[k] <= 6.5) this.narrow.push(k); }
    for (let k = 0; k < nav.open.length; k++) if (nav.open[k] && nav.clear[k] > 6.5 && nav.clear[k] <= 9 && this.narrow.length < 4000) this.narrow.push(k);
    this.fT = new FieldBuf(nav); this.fP = new FieldBuf(nav); this.fA = new FieldBuf(nav);
    this.units = []; this.props = new THREE.Group(); this.state = 'idle'; this.net = null; this.shooter = true; this.tow = null; this.towedBy = null; this.towCool = 0; this.thieves = [];
    this.posts = new Posts(this);
    this.guns = new Guns(this); this.bombs = new Bombs(this);
    this.parked = world.m.props && world.m.props.length ? new PropCars(world, { impact: (c, x, z, p, u) => this.propImpact(c, x, z, p, u) }) : null;
    this.pl = [new THREE.PointLight(0xff2020, 0, 34, 2), new THREE.PointLight(0x2f64ff, 0, 34, 2)];
    this.ctx = {
      world, nav, wide: this.wide,
      thief: v => this.thiefState(v), thiefHp: v => { const u = this.units.find(q => q.v === v); return u ? u.hp : 100; },
      fieldThief: () => this.fT.cur, fieldPolice: () => this.fP.cur, fieldAhead: () => this.fA.cur,
      others: self => this.otherStates(self),
      nearestPoliceDist: v => this.nearestPoliceDist(v),
      towed: () => !!(this.tow && this.tow.attached && this.tow.target.isThief),
    };
  }

  // ------------------------------------------------------------------ setup
  /**
   * cfg: { role:'thief'|'police', police:1..20, diff:0..2, time:sec, players:[{id,name,car}], myId }
   * net: null (single player) | { host:true|false, send(o), event(e) }
   * setup: (client) { units:[descriptor], spawns:{id:[x,z,psi]} } received from the host
   */
  start(cfg, net = null, setup = null) {
    const race = this.race, scene = race.scene;
    this.stop(true);
    race.mission = this;
    this.cfg = cfg; this.role = cfg.role; this.D = DIFFS[cfg.diff] || DIFFS[1];
    this.net = net; this.isClient = !!(net && !net.host); this.shooter = !this.isClient; this.myId = cfg.myId || 'me';
    race.enterWorld(this.world, THEME('police'));
    for (const r of race.racers.values()) { scene.remove(r.vis.group); this.hud.removeLabel(r.id); this.audio.removeRemote(r.id); }
    race.racers.clear(); race.releaseTow(true); race.skids.last.clear();
    for (const p of [race.smoke, race.dust, race.fire, race.sparks]) p.life.fill(0);
    race.battle = false; race.laps = 1; race.solo = !net; race.net = null; race.isHost = true; race.myId = this.myId;
    scene.add(this.props); for (const l of this.pl) scene.add(l);
    this.posts.attach(scene); this.guns.attach(scene); this.guns.reset(); this.bombs.attach(scene); this.bombs.reset(); this.parked?.reset();
    this.t = 0; this.clock = 0; this.timeLeft = cfg.time; this.bust = 0; this.over = null; this.endAt = 0; this.reported = false;
    this.stats = { loot: 0, wrecked: 0, hitsTaken: 0, top: 0, damage: 0, posts: 0 };
    this.fieldT = 0; this.warned = {}; this.nextPost = POST_FIRST; this.sendT = 0; this.pinMsg = false;
    this.loot = []; this.hide = null; this.state = 'play';

    // ---- who goes where
    const nav = this.nav;
    let descs, spawns;
    if (setup) { descs = setup.units; spawns = setup.spawns; }
    else ({ descs, spawns } = this.plan(cfg));
    this.descs = descs; this.spawns = spawns;
    this.units = [];
    for (const d of descs) {
      const s = spawns[d.id], at = { x: s[0], z: s[1], psi: s[2] };
      this.makeUnit(d, at);
    }
    this.me = race.racers.get(this.myId); race.me = this.me;
    this.thieves = this.units.filter(u => u.isThief);
    this.role = this.me.isThief ? 'thief' : 'police';                              // personal role (online: one friend may be the thief); cfg.role = the game type
    if (!this.isClient) {
      if (cfg.role === 'thief') this.buildLoot(this.planInfo);
      this.fT.sync(this.thiefCells());
      if (cfg.role === 'police') this.fP.sync(this.policeCells());
    }
    this.fieldT = 0;

    race.t = -3; race.phase = 'countdown'; race.countTick = 4; race.wrongT = 0; race.raceClock = 0;
    race.camAng = this.me.v.psi; race.camPos.set(this.me.v.x, 3, this.me.v.z); race.camMode = 0;
    race.audio.clearRemotes();
    this.me.v.auto = true;
    this.mhud.begin(cfg, this);
    this.hud.setLoadout([]); this.hud.clearLabels(); this.hud.setFinished(false); this.hud.show(true);
    this.hud.message(this.role === 'thief' ? (cfg.role === 'thief' ? `{bolt} O'G'RI: ${LOOT_N} ta xaltani yig'ing!` : "{bolt} O'G'RI: politsiyadan qoching, T — bomba tashlang!") : `{check} POLITSIYA: o'g'rini ${PIN_TIME} soniya to'xtatib turing! (R — tros, F — o'q)`, 3200, 'small');
  }

  /** (host / solo) decide every unit and its spawn point */
  plan(cfg) {
    const humans = cfg.players, nh = humans.length;
    const thiefHs = cfg.role === 'police' ? humans.filter(p => p.role === 'thief') : [];        // online: friends who play thieves
    const polH = humans.filter(p => !thiefHs.includes(p)), np = polH.length;
    const nT = cfg.role === 'police' ? Math.max(1, Math.min(THIEF_MAX, Math.max(cfg.thieves | 0 || 1, thiefHs.length))) : 1, nAT = cfg.role === 'police' ? nT - thiefHs.length : 0;
    const total = cfg.role === 'thief' ? cfg.police : Math.max(np, cfg.police), nAI = cfg.role === 'thief' ? cfg.police : total - np;
    const sp = this.pickSpawns(cfg, np, nAI, nT); this.planInfo = sp;
    const descs = [], spawns = {};
    polH.forEach((p, i) => {
      descs.push({ id: p.id, name: p.name, car: p.car, human: true, police: cfg.role === 'police', thief: cfg.role === 'thief', idx: i });
      spawns[p.id] = sp.humans[i];
    });
    for (let i = 0; i < nAI; i++) {
      const id = 'ai' + i, kind = FLEET_KINDS[i % FLEET_KINDS.length];
      descs.push({ id, name: 'Politsiya ' + (cfg.role === 'thief' ? i + 1 : np + i + 1), kind, police: true, idx: np + i });
      spawns[id] = sp.police[i];
    }
    thiefHs.forEach((p, i) => {
      descs.push({ id: p.id, name: p.name, car: p.car, human: true, thief: true, idx: i });
      spawns[p.id] = sp.thieves[i];
    });
    for (let i = 0; i < nAT; i++) {
      const id = i === 0 ? 'thief' : 'thief' + (i + 1);
      descs.push({ id, name: nT > 1 ? "O'g'ri " + (thiefHs.length + i + 1) : "O'g'ri", car: THIEF_CARS[(Math.random() * THIEF_CARS.length) | 0], thief: true, paint: Math.random() < 0.6 ? (Math.random() * 3) | 0 : -1 });
      spawns[id] = sp.thieves[thiefHs.length + i];
    }
    return { descs, spawns };
  }

  stop(keepWorld = false) {
    const race = this.race;
    for (const u of this.units) { race.scene.remove(u.vis.group); race.racers.delete(u.id); this.hud.removeLabel(u.id); this.audio.removeRemote(u.id); }
    this.units = []; this.thieves = []; this.dropTow(true); this.towedBy = null;
    this.posts.clear(); this.posts.detach(race.scene); this.guns.detach(race.scene); this.bombs.reset(); this.bombs.detach(race.scene); this.parked?.reset();
    this.props.clear(); race.scene.remove(this.props); for (const l of this.pl) race.scene.remove(l);
    this.audio.setSiren?.(0);
    this.state = 'idle'; this.net = null;
    if (!keepWorld) { race.mission = null; race.exitWorld(); }
  }

  makeUnit(d, at) {
    const race = this.race, local = d.id === this.myId || (!this.isClient && !d.human);
    const me = d.id === this.myId;
    let def, proto, paint = -1;
    const kind = d.kind || (d.car === 7 ? 'suv' : null);
    if (kind) { const k = this.fleet.kind(kind, this.protos); def = k.def; proto = k.proto; paint = k.paint ?? -1; }
    else { def = CAR_DEFS[d.car % CAR_DEFS.length]; proto = this.protos[d.car % CAR_DEFS.length]; paint = d.thief ? (d.paint ?? -1) : (d.paint ?? (def.id === 'supra_gt300' ? -1 : BLACK)); }
    const vis = new CarVisual(proto, def, paint);
    if (d.police) { vis.addSiren(); vis.sirenOff = d.idx * 1.3; }
    race.scene.add(vis.group);
    if (!me) vis.setShadowProxy(true);
    const r = {
      id: d.id, name: d.name, car: d.car ?? -1, def, vis, bot: !d.human, kind: me ? 'me' : local ? 'ai' : 'remote', lapCross: 0, prog: 0, lastI: 0, finish: null, place: 0, lapStart: 0, lastLap: null, bestLap: null,
      state: { dead: false, hp: BATTLE.maxHp, x: at.x, z: at.z, psi: at.psi, vx: 0, vz: 0, steer: 0, gear: 1, rpm: 0.18, thr: 0, nitro: 0, drift: 0, speed: 0 },
      net: null, auto: false, hp: BATTLE.maxHp, shown: BATTLE.maxHp, ghost: BATTLE.maxHp, dead: false, deathAt: 0, hitAt: -9, rank: 0,
      isPolice: !!d.police, isThief: !!d.thief, isHuman: !!d.human, idx: d.idx || 0, tm: new Tumbler(),
    };
    if (local) {
      r.v = new Vehicle(); r.v.place(at.x, at.z, at.psi); r.v.locked = true; r.v.auto = true;
      if (!me) {
        r.inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
        r.drv = d.police ? new PoliceDriver(r.v, this.ctx, d.idx % 3, this.D) : new FleeDriver(r.v, this.ctx, this.D);
      }
    }
    if (d.human && !me) this.hud.addLabel(d.id, d.name, d.thief ? '#ff9f0a' : '#4a8dff');           // friends: name + health above the car
    race.racers.set(d.id, r); this.units.push(r);
    return r;
  }

  /** random open street cells with room: spawn points for everybody */
  pickSpawns(cfg, nh, nAI, nT = 1) {
    const nav = this.nav, world = this.world, wide = shuffle(this.wide.slice());
    const at = k => { const [x, z] = nav.centre(k); return [x, z, world.freeHeading(x, z), k]; };
    const far = (p, list, d) => list.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) >= d);
    const out = { humans: [], police: [] }, taken = [];
    const first = at(wide[0]); out.humans.push(first); taken.push(first);
    const F = nav.field(); F.start([first[3]]); F.runAll();                // distances from the first player's start
    const pick = (lo, hi, minSep) => {
      for (let n = 0; n < wide.length; n++) {
        const k = wide[n], d = F.dist[k]; if (!isFinite(d) || d < lo || d > hi) continue;
        const p = at(k); if (far(p, taken, minSep)) { taken.push(p); return p; }
      }
      return null;
    };
    for (let i = 1; i < nh; i++) out.humans.push(pick(8, 70, 8) || pick(4, 220, 5) || at(wide[(i * 37 + 3) % wide.length]));
    if (cfg.role === 'thief') {
      for (let i = 0; i < nAI; i++) out.police.push(pick(150, 700, 35) || pick(60, 1400, 12) || at(wide[(i * 97 + 5) % wide.length]));
    } else {
      out.thieves = [];
      for (let i = 0; i < nT; i++) out.thieves.push(pick(220, 520, 30) || pick(100, 1400, 20) || at(wide[((wide.length >> 1) + i * 211) % wide.length]));
      out.thief = out.thieves[0];
      for (let i = 0; i < nAI; i++) out.police.push(pick(8, 100, 9) || pick(4, 240, 6) || at(wide[(i * 131 + 7) % wide.length]));
    }
    out.F = F;
    return out;
  }

  // ------------------------------------------------------------------ loot / hideout
  buildLoot(spawn) {
    const nav = this.nav, F = spawn.F, wide = shuffle(this.wide.slice()), world = this.world;
    const mePos = { x: spawn.humans[0][0], z: spawn.humans[0][1] }, wantCity = [0, 1, 2, 0, -1], chosen = [], taken = [mePos, ...spawn.police.map(p => ({ x: p[0], z: p[1] }))];
    for (const city of wantCity) {
      let found = null;
      for (let n = 0; n < wide.length && !found; n++) {
        const k = wide[n], [x, z] = nav.centre(k);
        if (city >= 0 && world.cityAt(x, z) !== city) continue;
        if (!isFinite(F.dist[k]) || F.dist[k] < 60) continue;
        if (![...taken, ...chosen].every(q => Math.hypot(q.x - x, q.z - z) >= 70)) continue;
        found = { x, z, k };
      }
      if (!found) { const k = wide[(chosen.length * 53 + 11) % wide.length], [x, z] = nav.centre(k); found = { x, z, k }; }
      chosen.push(found);
    }
    const grad = pillarTex();
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc233, emissive: 0xffa000, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.8 });
    const beam = new THREE.MeshBasicMaterial({ map: grad, color: 0xffc233, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const c of chosen) {
      const g = new THREE.Group(); g.position.set(c.x, 0, c.z);
      const bag = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.95, 0.95), gold); bag.position.y = 1.7; bag.castShadow = true;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 70, 14, 1, true), beam); pillar.position.y = 35;
      const ring = new THREE.Mesh(new THREE.RingGeometry(LOOT_R - 0.5, LOOT_R, 40), new THREE.MeshBasicMaterial({ color: 0xffc233, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08;
      g.add(bag, pillar, ring); this.props.add(g);
      this.loot.push({ x: c.x, z: c.z, got: false, g, bag });
    }
    // hideout: far from the start, in a different city
    const me = mePos; let best = null, bd = -1;
    for (let n = 0; n < wide.length; n++) {
      const k = wide[n], [x, z] = nav.centre(k), d = Math.hypot(x - me.x, z - me.z);
      if (nav.clear[k] < 4 || world.cityAt(x, z) === world.cityAt(me.x, me.z) || !isFinite(F.dist[k])) continue;
      if (d > bd) { bd = d; best = { x, z }; }
    }
    best = best || (() => { const [x, z] = nav.centre(wide[0]); return { x, z }; })();
    const green = new THREE.MeshBasicMaterial({ map: grad, color: 0x2fe07c, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const g = new THREE.Group(); g.position.set(best.x, 0, best.z);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(HIDE_R * 0.55, HIDE_R * 0.55, 90, 24, 1, true), green); pillar.position.y = 45;
    const ring = new THREE.Mesh(new THREE.RingGeometry(HIDE_R - 0.7, HIDE_R, 56), new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(HIDE_R - 0.7, 48), new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.07;
    g.add(pillar, ring, disc); g.visible = false; this.props.add(g);
    this.hide = { x: best.x, z: best.z, g, on: false };
  }

  // ------------------------------------------------------------------ helpers for the drivers
  /** the thief everything single-target aims at: the first one still on the road (or the first one at all) */
  get thief() { const t = this.thieves; if (!t || !t.length) return undefined; return t.find(u => !u.dead) || t[0]; }
  aliveThieves() { return this.thieves.filter(u => !u.dead); }
  thiefNear(x, z) { let best = null, bd = 1e12; for (const u of this.thieves) { if (u.dead) continue; const d = (u.state.x - x) ** 2 + (u.state.z - z) ** 2; if (d < bd) { bd = d; best = u; } } return best; }
  thiefCells() { return this.aliveThieves().map(u => this.nav.snap(u.state.x, u.state.z)).filter(k => k >= 0); }
  thiefState(v) { const u = v ? this.thiefNear(v.x, v.z) : this.thief; return u && !u.dead ? u.state : null; }
  otherStates(self) { const o = []; for (const u of this.units) if (u.drv !== self && u.state && !u.dead) o.push(u.state); return o; }
  policeUnits() { return this.units.filter(u => u.isPolice); }
  policeCells() { const c = []; for (const u of this.policeUnits()) if (!u.dead) c.push(this.nav.snap(u.state.x, u.state.z)); return c; }
  nearestPoliceDist(v) {
    const th = v || (this.thief && this.thief.state); if (!th) return 1e9; let d = 1e9;
    for (const u of this.units) if (u.isPolice && !u.dead) d = Math.min(d, Math.hypot(u.state.x - th.x, u.state.z - th.z));
    return d;
  }
  /** show a message here and (host) on every friend's screen */
  /** a message worded differently for the police and for the thief (each machine picks its own) */
  sayRole(textPolice, textThief, ms, kind) {
    this.hud.message(this.role === 'thief' ? textThief : textPolice, ms, kind);
    if (this.net && this.net.host) this.net.event({ k: 'msg2', p: textPolice, t: textThief, ms, kind });
  }
  say(text, ms, kind) { this.hud.message(text, ms, kind); if (this.net && this.net.host) this.net.event({ k: 'msg', t: text, ms, kind }); }

  // ------------------------------------------------------------------ main update
  update(dt, w, h) {
    const race = this.race; dt = Math.min(dt, 0.1);
    this.clock += dt;
    if (this.hook) this.hook(dt);                         // test hook: lets a script drive the player's car
    if (race.phase === 'countdown') {
      race.t += dt;
      const remain = -race.t, tick = Math.ceil(remain);
      if (tick < race.countTick) { race.countTick = tick; if (tick >= 1 && tick <= 3) { this.audio.beep(330, 0.18, 0.2); this.hud.countdown(String(tick)); } }
      if (remain <= 0) this.go();
    } else if (this.state === 'play') {
      this.t += dt; this.timeLeft -= dt;
    }
    this.driveAI(dt);
    const n = Math.min(12, Math.max(1, Math.ceil(dt / STEP - 1e-6))), sub = dt / n;
    for (let i = 0; i < n; i++) this.step(sub);
    race.updateRemotes(dt);
    this.deathWatch();
    if (!this.isClient) this.updateFields(dt);
    if (this.state === 'play' && race.phase === 'racing' && !this.isClient) this.rules(dt);
    else if (this.state === 'over' && this.clock > this.endAt && !this.reported) { this.reported = true; race.onMissionEnd?.(this.over); }
    this.posts.update(dt, this.clock);
    this.updateProps(dt); this.drawTow(dt);
    this.guns.update(dt); this.bombs.update(dt);
    this.parked?.updateVisuals();
    race.updateVisuals(dt);
    for (const u of this.units) { u.tm.update(dt); u.tm.apply(u.vis.group); }
    race.updateCamera(dt, w, h); race.updateFx(dt); race.updateAudio(dt);
    this.updateSiren(dt);
    this.sendNet(dt);
    this.updateHud(dt, w, h);
  }

  go() {
    const race = this.race;
    race.phase = 'racing'; race.t = 0; race.raceClock = 0;
    for (const u of this.units) if (u.v) u.v.locked = false;
    this.audio.beep(660, 0.6, 0.28); this.hud.countdown('GO!', true);
  }

  driveAI(dt) {
    const racing = this.race.phase === 'racing' && this.state === 'play';
    for (const u of this.units) {
      if (!u.drv) continue;
      if (u.dead || this.state === 'over') { u.inp.throttle = 0; u.inp.brake = 0.5; u.inp.steer = 0; u.inp.handbrake = u.dead; u.inp.nitro = false; continue; }
      u.drv.control(dt, u.inp, racing);
      if (u.tm.act) { u.inp.throttle = 0; u.inp.brake = 0.15; u.inp.steer = 0; u.inp.handbrake = false; u.inp.nitro = false; }       // rolling over: no control
    }
  }

  step(dt) {
    const me = this.me, world = this.world, over = this.state === 'over';
    const inpMe = me.dead || over ? DEAD_INP : me.tm.act ? { throttle: 0, brake: 0.1, steer: 0, handbrake: false, nitro: false } : this.race.input;
    if (!me.dead && !over && me.v.auto && !me.v.locked) this.race.autoGear(me.v);
    else if (!me.v.auto && !me.v.locked && me.v.shiftCut <= 0 && me.v.gear > 1 && me.v.rpmRaw < 0.3 && !me.v.reversing) me.v.shift(-1);
    me.v.update(dt, over && !me.dead ? { ...DEAD_INP, handbrake: false, brake: 0.35 } : inpMe, world);
    for (const u of this.units) if (u !== me && u.v) u.v.update(dt, u.inp, world);
    const L = this.units;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j], dx = a.state.x - b.state.x, dz = a.state.z - b.state.z;
      if (dx * dx + dz * dz > 36) continue;
      if ((a.v && a.v.jy > 0.9) || (b.v && b.v.jy > 0.9)) continue;                   // a car in the air (Space) flies over the other one
      if (a.v && b.v) {
        const da = a.v.dmg || 0, db = b.v.dmg || 0, ca = a.v.carHit || 0, cb = b.v.carHit || 0;
        a.v.carHit = 0; b.v.carHit = 0;
        const sa = a.v.speed, sb = b.v.speed;
        a.v.collide(b.v, 0.5); b.v.collide(a.v, 0.5);
        const hard = Math.max(a.v.carHit || 0, b.v.carHit || 0);
        a.v.carHit = Math.max(ca, a.v.carHit || 0); b.v.carHit = Math.max(cb, b.v.carHit || 0);
        if (a.isPolice && b.isPolice) { a.v.dmg = da; b.v.dmg = db; }               // police cars only bump each other: no damage
        if (hard > FLIP_MIN) this.crashFlip(a, b, hard, sa, sb);
      }
      else if (a.v) a.v.collide(b.state, 1);
      else if (b.v) b.v.collide(a.state, 1);
    }
    this.posts.pushCars(L, dt);
    this.parked?.step(L, dt);
    this.stepTow(dt);
    for (const r of L) {
      const v = r.v; if (!v) continue;
      const dw = world.dist(v.x, v.z);
      if (dw > 1.3) { r.safe = r.safe || {}; r.safe.x = v.x; r.safe.z = v.z; r.safe.psi = v.psi; r.voidT = 0; }
      else if (dw < -0.8 && (r.voidT = (r.voidT || 0) + dt) > 0.2) this.rescue(r);        // somehow inside a wall / off the map: back to the last good spot
      if (v.dmg) { const d = v.dmg; v.dmg = 0; if (this.state === 'play' && this.race.phase === 'racing' && !r.dead) this.hurt(r, d); }
      const s = r.state;
      s.hp = r.hp; s.dead = r.dead; s.x = v.x; s.z = v.z; s.psi = v.psi; s.vx = v.vx; s.vz = v.vz; s.steer = v.steer; s.gear = v.gear; s.rpm = v.rpm; s.thr = v.throttle;
      s.nitro = v.nitroOn ? 1 : 0; s.drift = v.drift; s.speed = v.speed;
    }
    this.stats.top = Math.max(this.stats.top, me.v.speed);
  }

  // ------------------------------------------------------------------ tow rope (police, R): slows the thief gently; he can swerve and snap it
  fireGun() { this.guns.firePlayer(); }
  /** T: the thief drops a bomb; police: put the car back on the road */
  keyT() { if (this.me && this.me.isThief) this.bombs.press(); else this.respawn(); }
  onCmd(fromId, c) { this.bombs.onCmd(fromId, c); }

  /** R: hook the nearest car (the thief first) - any car, police or thief, AI or a friend; R again lets go */
  fireTow() {
    const me = this.me, race = this.race;
    if (!me || me.dead || this.state !== 'play' || race.phase !== 'racing') return;
    if (this.tow) { this.dropTow(); this.hud.message("Tros bo'shatildi", 1200, 'small'); return; }
    if (this.clock < this.towCool) return;
    let best = null, bd = TOW.range;
    for (const u of this.units) {
      if (u === me || u.dead || (best && best.isThief && !u.isThief)) continue;
      const d = Math.hypot(u.state.x - me.v.x, u.state.z - me.v.z);
      if (d < bd || (u.isThief && d <= TOW.range && !(best && best.isThief))) { best = u; bd = Math.min(bd, d); }
    }
    if (!best) { this.hud.message(`Yaqinda mashina yo'q (${TOW.range} m ichida)`, 1400, 'small'); return; }
    if (!best.v && !best.isHuman) { this.hud.message('Tros faqat host kompyuterida ishlaydi', 1600, 'small'); return; }
    const remote = !best.v;
    this.tow = { target: best, remote, fly: 0, attached: false, t: 0, stress: 0, floor: Math.max(8, best.state.speed || 0) };
    if (remote && this.net) this.net.send({ t: 'tow', to: best.id, on: 1 });
    this.audio.noiseBurst?.(0.15, 2500, 0.5, 'highpass');
  }
  dropTow(silent) {
    const tw = this.tow;
    if (tw && !silent) this.towCool = this.clock + 2;
    if (tw && tw.remote && this.net) this.net.send({ t: 'tow', to: tw.target.id, on: 0 });
    this.tow = null;
    const r = this.race; if (r && r.cable && !this.towedBy) r.cable.visible = r.hook.visible = false;
  }
  /** a friend hooked me / let go (or the friend I hooked broke the rope) */
  onTow(fromId, toId, on) {
    if (toId !== this.myId || this.state !== 'play') return;
    const o = this.units.find(u => u.id === fromId); if (!o) return;
    if (on) {
      if (!this.me || this.me.dead || o.dead || !this.me.v) return;
      this.towedBy = { owner: o, t: 0, stress: 0, floor: Math.max(8, this.me.v.speed) };
      this.hud.message(`{warn} ${o.name} sizni trosga oldi — chapga-o'ngga burilib uzing!`, 2200, 'small'); this.race.shake = Math.max(this.race.shake, 0.5); this.audio.thump?.(0.8);
    } else if (this.towedBy && this.towedBy.owner === o) { this.towedBy = null; if (this.race.cable && !this.tow) this.race.cable.visible = this.race.hook.visible = false; }
    else if (this.tow && this.tow.target === o) { this.tow.remote = false; this.dropTow(); this.hud.message(`{check} ${o.name} trosni uzib tashladi`, 1800, 'small'); }
  }
  /** the rope itself: haul `b` (a Vehicle) down gradually; swerving sideways snaps it. returns 0 = holds, 1 = timed out / too far, 2 = broken free */
  ropeDrag(a, b, tw, dt) {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d;
    tw.t += dt;
    if (tw.t >= TOW.time || d > TOW.snap) return 1;
    // taut rope: the car is hauled down gradually (its top speed shrinks from what it had down to a crawl over TOW.slowTime seconds),
    // whatever its throttle does - the faster it is going, the harder the rope bites
    const sp = Math.hypot(b.vx, b.vz);
    const vmax = Math.max(TOW.minSpeed, tw.floor * (1 - Math.min(1, tw.t / TOW.slowTime)));
    if (sp > vmax) {
      const dec = Math.min(sp - vmax, TOW.decel * dt * (1 + Math.min(1.5, (sp - vmax) / 25)));
      b.vx -= b.vx / sp * dec; b.vz -= b.vz / sp * dec;
    }
    // swerving sideways (away from the line of the rope) for a moment snaps it
    const side = Math.abs(Math.atan2(Math.sin(b.psi - Math.atan2(nx, nz)), Math.cos(b.psi - Math.atan2(nx, nz))));
    if (side > TOW.breakAng) tw.stress += dt * (side - TOW.breakAng) * 1.6; else tw.stress = Math.max(0, tw.stress - dt * 0.5);
    return tw.stress >= 1 ? 2 : 0;
  }
  stepTow(dt) {
    const me = this.me, tb = this.towedBy;
    if (tb) {                                                                     // a friend's rope is on MY car: my machine applies it
      const o = tb.owner;
      if (!me || me.dead || o.dead || this.state !== 'play' || !this.units.includes(o)) this.towedBy = null;
      else {
        const r = this.ropeDrag(o.state, me.v, tb, dt);
        if (r) {
          this.towedBy = null; if (this.net) this.net.send({ t: 'tow', to: o.id, on: 0 });
          this.hud.message(r === 2 ? '{check} Trosni uzdingiz!' : 'Tros uzildi', 1600, 'small'); if (r === 2) { this.audio.thump?.(0.7); this.race.shake = Math.max(this.race.shake, 0.5); }
        }
      }
    }
    const tw = this.tow; if (!tw) return;
    const th = tw.target;
    if (!me || me.dead || !th || th.dead || this.state !== 'play' || !this.units.includes(th)) { this.dropTow(); return; }
    const d = Math.hypot(th.state.x - me.v.x, th.state.z - me.v.z);
    if (!tw.attached) { if (d > TOW.range * 1.5) this.dropTow(); return; }
    if (tw.remote) { tw.t += dt; if (tw.t >= TOW.time + 1 || d > TOW.snap + 6) this.dropTow(); return; }      // the friend's own machine drags and may snap it
    const r = this.ropeDrag(me.v, th.v, tw, dt);
    if (r) {
      this.dropTow();
      if (r === 2) { this.say(th.isThief ? "{warn} O'g'ri trosni uzib tashladi!" : `{warn} ${th.name} trosni uzdi`, 1800, 'small'); this.audio.thump?.(0.7); this.race.shake = Math.max(this.race.shake, 0.5); }
      else this.hud.message('Tros uzildi', 1400, 'small');
    }
  }
  drawTow(dt) {
    const tw = this.tow, race = this.race, me = this.me;
    if (!me || !me.v) return;
    if (!tw) {
      const tb = this.towedBy;
      if (tb && !tb.owner.dead) { const o = tb.owner.state, v = me.v; race.drawCable(o.x + Math.sin(o.psi) * 2.2, 0.55, o.z + Math.cos(o.psi) * 2.2, v.x - Math.sin(v.psi) * 2.2, 0.55, v.z - Math.cos(v.psi) * 2.2); }
      else if (race.cable && race.cable.visible) race.cable.visible = race.hook.visible = false;
      return;
    }
    if (!tw.attached) {
      tw.fly += dt / 0.18;
      if (tw.fly >= 1) { tw.fly = 1; tw.attached = true; race.shake = Math.max(race.shake, 0.4); this.audio.thump?.(0.7); this.hud.message(`{check} Tros ilindi — ${tw.target.isThief ? "o'g'ri" : tw.target.name} sekinlashadi (R: bo'shatish)`, 1800, 'small'); }
    }
    const a = me.v, b = tw.target.state, fa = Math.sin(a.psi), ca = Math.cos(a.psi), fb = Math.sin(b.psi), cb = Math.cos(b.psi);
    const ax = a.x + fa * 2.2, az = a.z + ca * 2.2, bx = b.x - fb * 2.2, bz = b.z - cb * 2.2, f = tw.fly;
    race.drawCable(ax, 0.55, az, ax + (bx - ax) * f, 0.55, az + (bz - az) * f);
  }

  /** put a car that ended up inside a wall back on the street */
  rescue(r) {
    const nav = this.nav; let { x, z, psi } = r.safe || {};
    if (x == null) { const k = nav.snap(r.v.x, r.v.z); if (k < 0) return; [x, z] = nav.centre(k); psi = this.world.freeHeading(x, z); }
    r.v.place(x, z, psi); r.voidT = 0; if (r.drv && r.drv.path) r.drv.path = null;
  }

  updateFields(dt) {
    const nav = this.nav, th = this.thief;
    this.fieldT -= dt;
    if (this.fieldT <= 0 && th && !th.dead) {
      const started = this.fT.start(this.thiefCells());
      if (this.cfg.role === 'police' && !this.fP.building) this.fP.start(this.policeCells());
      if (this.units.some(u => u.isPolice && u.drv && u.idx % 3 === 1) && !this.fA.building) {      // interceptors aim ahead of the thief
        const ax = th.state.x + clamp(th.state.vx * 3.5, -120, 120), az = th.state.z + clamp(th.state.vz * 3.5, -120, 120);
        this.fA.start([nav.snap(ax, az)]);
      }
      if (started) this.fieldT = 0.4;
    }
    const busy = [this.fT, this.fP, this.fA].filter(f => f.building);
    for (const f of busy) f.step(3 / busy.length);
  }

  /** remote cars (friends, AI on a friend's screen) blow up when their HP runs out */
  deathWatch() {
    for (const u of this.units) {
      if (u.v || u.dead || u.hp > 0 || !u.net) continue;
      u.dead = true; u.state.dead = true; this.race.explode(u);
      const d = Math.hypot(u.state.x - this.me.state.x, u.state.z - this.me.state.z);
      if (d < 100) this.audio.thump(0.4 + 1.6 * (1 - d / 100));
      if (!this.isClient) this.afterWreck(u);
    }
  }

  // ------------------------------------------------------------------ damage
  hurt(r, d, raw = false) {
    const race = this.race;
    if (!r.v && r.isHuman && this.net && this.net.host) { this.net.event({ k: 'hurt', id: r.id, d: raw ? -d : d }); return; }          // a friend's car: his own machine applies the damage
    if (!raw) d *= r.isPolice ? (r.isHuman ? 0.5 : 0.85) : THIEF_ARMOR;      // thieves are tough: the same hit costs them far less
    if (d <= 0.01) return;
    r.hp = Math.max(0, r.hp - d); r.hitAt = this.t;
    if (r === this.me) {
      this.stats.damage += d; this.stats.hitsTaken++;
      race.hitFlash = Math.min(1, race.hitFlash + 0.25 + d / 28);
      race.dmgSum = (this.t - race.dmgAt < 1.3 ? race.dmgSum : 0) + d; race.dmgAt = this.t;
      this.audio.thump(Math.min(2, 0.4 + d / 14)); race.shake = Math.max(race.shake, Math.min(1.1, d / 22));
    }
    if (r.hp <= 0) this.wreck(r);
  }

  /** a robot's round hit the thief's car: a little damage */
  robotHit(th, d) {
    const r = this.units.find(u => u.state === th); if (!r || r.dead) return;
    this.hurt(r, d);
    if (r === this.me) this.audio.thump?.(0.35);
  }

  wreck(r) {
    const race = this.race;
    r.dead = true; r.hp = 0; r.state.hp = 0; r.state.dead = true; r.deathAt = this.t;
    race.explode(r);
    const d = Math.hypot(r.state.x - this.me.state.x, r.state.z - this.me.state.z);
    if (d < 100) { const k = 1 - d / 100; this.audio.thump(0.4 + 1.6 * k); this.audio.noiseBurst(0.4, 140, 0.6 * k, 'lowpass'); }
    if (r === this.me) { this.audio.thump(2.2); this.audio.noiseBurst(0.5, 120, 0.9, 'lowpass'); race.shake = 1.6; this.hud.message('{fire} MASHINANGIZ PORTLADI!', 3500, 'big'); this.hud.setFinished(true); }
    this.afterWreck(r);
  }

  afterWreck(r) {
    if (this.isClient) return;
    if (r.isThief) {
      if (this.aliveThieves().length) { this.say(`{fire} ${r.name} mashinasi portladi — qolgan o'g'rilar: ${this.aliveThieves().length}`, 2800, 'small'); return; }
      this.sayRole("{fire} O'g'rining mashinasi portladi!", '{warn} Mashinangiz portladi!', 3000, 'big'); this.finish(true, this.thieves.some(u => u.caught) ? 'busted' : 'wrecked'); return;
    }
    if (r.isPolice) {
      if (this.cfg.role === 'thief') { this.stats.wrecked++; this.say(`{fire} ${r.name} yo'q qilindi`, 2200, 'small'); }
      else this.sayRole(`{warn} ${r.name} avariyaga uchradi`, `{fire} ${r.name} yo'q qilindi`, 2200, 'small');
      if (!this.units.some(u => u.isPolice && !u.dead)) { this.sayRole('{fire} Barcha politsiya mashinalari yo\'q qilindi!', '{trophy} Barcha politsiya yo\'q qilindi — siz yutdingiz!', 3500, 'big'); this.finish(false, 'nopolice'); return; }
      if (r.isHuman && this.units.filter(u => u.isHuman && u.isPolice).every(u => u.dead)) this.finish(false, 'wrecked');
    }
  }

  // ------------------------------------------------------------------ rules (solo / host)
  rules(dt) {
    const me = this.me;
    // ---- arrest: a police car close to a thief while he stays (almost) still for PIN_TIME seconds
    for (const u of this.thieves) {
      if (u.dead) continue;
      const th = u.state; let near = 0;
      for (const p of this.units) if (p.isPolice && !p.dead && Math.hypot(p.state.x - th.x, p.state.z - th.z) < BUST_R) near++;
      const pinned = near > 0 && (th.speed < PIN_SPEED || (near >= 2 && th.speed < 6));
      u.bust = u.bust || 0;
      if (pinned) {
        u.bust = Math.min(1, u.bust + dt / PIN_TIME);
        if (!u.pinMsg) { u.pinMsg = true; this.sayRole(this.thieves.length > 1 ? `{check} ${u.name} qisildi — to'xtatib turing!` : "{check} O'g'ri qisildi — to'xtatib turing!", '{warn} Sizni qisib olishdi — qimirlang!', 1800, 'small'); }
      } else { u.bust = Math.max(0, u.bust - (near > 0 ? 0.12 : 0.3) * dt); if (u.bust < 0.02) u.pinMsg = false; }
      if (u.bust >= 1) { u.bust = 1; this.catchThief(u); if (this.state === 'over') return; }
    }
    this.refreshBust();
    // ---- clock
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.say('{clock} VAQT TUGADI', 3000, 'big'); this.finish(this.cfg.role === 'thief', 'time'); return; }
    for (const s of [60, 30, 10]) if (this.timeLeft <= s && this.cfg.time > s * 1.5 && !this.warned[s]) { this.warned[s] = 1; this.say(`{clock} ${s} soniya qoldi!`, 1600, 'small'); this.audio.beep(880, 0.15, 0.2); }
    // ---- roadblocks
    if (this.t >= this.nextPost) {
      const used = clamp01(1 - this.timeLeft / this.cfg.time);                       // the less time is left, the more (and the more often) posts appear
      this.nextPost += POST_EVERY - (POST_EVERY - POST_MIN) * used;
      const maxPosts = POST_MAX + Math.floor(used * 5), batch = 1 + (used > 0.5 ? 1 : 0) + (used > 0.8 ? 1 : 0);
      let made = 0;
      for (let i = 0; i < batch; i++) {
        const spec = this.posts.plan(); if (!spec) break;
        if (this.posts.list.length >= maxPosts) { const old = this.posts.list[0].id; this.posts.remove(old); if (this.net) this.net.event({ k: 'unpost', id: old }); }
        this.posts.add(spec); this.stats.posts++; made++;
        if (this.net) this.net.event({ k: 'post', spec });
      }
      if (made) {
        this.say(this.stats.posts === made ? "{warn} 1 daqiqa o'tdi — ROBOT politsiya yo'l to'sdi va o'q uzmoqda!" : `{warn} Yangi to'siq${made > 1 ? 'lar' : ''}: robotlar o'g'rining yo'lini to'sdi!`, 2800, 'small');
        this.audio.beep(520, 0.25, 0.22);
      }
    }
    // ---- thief objectives (solo loot game)
    if (this.cfg.role === 'thief') {
      for (const l of this.loot) {
        if (l.got) continue;
        if (Math.hypot(me.state.x - l.x, me.state.z - l.z) < LOOT_R) {
          l.got = true; l.g.visible = false; this.stats.loot++; this.audio.beep(990, 0.12, 0.2); setTimeout(() => this.audio.beep(1320, 0.18, 0.2), 90);
          if (this.stats.loot >= LOOT_N) { this.hide.on = true; this.hide.g.visible = true; this.hud.message("{check} Hammasi yig'ildi — YASHIRIN UYGA boring!", 3200, 'small'); }
          else this.hud.message(`{check} Xalta ${this.stats.loot}/${LOOT_N}`, 1400, 'lap');
        }
      }
      if (this.hide && this.hide.on && Math.hypot(me.state.x - this.hide.x, me.state.z - this.hide.z) < HIDE_R) { this.hud.message('{trophy} QOCHIB QUTULDINGIZ!', 3500, 'big'); this.finish(false, 'escaped'); }
    }
  }

  /** the arrest meter shown on screen: a thief sees his own, the police see the fullest one */
  refreshBust() {
    const mine = this.me && this.me.isThief ? this.me : null;
    this.bust = mine ? (mine.bust || 0) : this.thieves.reduce((m, u) => (u.dead ? m : Math.max(m, u.bust || 0)), 0);
  }
  /** (host / solo) a thief was held long enough: he is out of the game */
  catchThief(u) {
    if (u.dead) return;
    u.caught = true; u.dead = true; u.state.dead = true; u.hp = u.state.hp = Math.max(1, u.hp);
    if (u.v) { u.v.locked = false; }
    const left = this.aliveThieves().length;
    if (this.net && this.net.host) this.net.event({ k: 'caught', id: u.id, left });
    if (u === this.me) { this.hud.message('{warn} USHLANDINGIZ!' + (left ? " — o'yin davom etadi" : ''), 3500, 'big'); this.hud.setFinished(true); }
    if (!left) { this.sayRole("{check} O'G'RI USHLANDI!", '{warn} USHLANDINGIZ!', 3500, 'big'); this.finish(true, 'busted'); return; }
    this.say(`{check} ${u.name} ushlandi! Qolgan o'g'rilar: ${left}`, 2800, 'small');
  }

  /** policeWin: true = the thief was caught / wrecked, false = he got away / survived / the police are out */
  finish(policeWin, reason) {
    if (this.state === 'over') return;
    const win = (this.role === 'police') === policeWin;
    this.state = 'over'; this.endAt = this.clock + 2.4; this.reported = false;
    const frac = this.timeLeft / this.cfg.time, hp = this.me.hp;
    let stars = 0;
    if (win) stars = 1 + (hp >= 50 ? 1 : 0) + (this.role === 'thief' ? (frac >= 0.3 ? 1 : 0) : (frac >= 0.5 ? 1 : 0));
    this.over = {
      win, reason, role: this.role, lootMode: this.cfg.role === 'thief', stars, time: this.t, left: this.timeLeft, limit: this.cfg.time, hp, loot: this.stats.loot, lootN: LOOT_N,
      police: this.units.filter(u => u.isPolice).length, diff: this.D.name, wrecked: this.stats.wrecked, topKmh: Math.round(this.stats.top * 3.6), hits: this.stats.hitsTaken,
      posts: this.stats.posts, friends: this.units.filter(u => u.isHuman && u.isPolice).length,
    };
    if (win) { this.audio.beep(880, 0.5, 0.25); setTimeout(() => this.audio.beep(1100, 0.7, 0.25), 250); }
    this.hud.setFinished(true);
    if (this.net && this.net.host) this.net.event({ k: 'end', pw: policeWin, reason, time: r2(this.t), left: r2(this.timeLeft), stats: this.stats, police: this.over.police });
  }

  /** a friend left the room */
  removeUnit(id) {
    const i = this.units.findIndex(u => u.id === id); if (i < 0) return;
    const u = this.units[i]; this.race.scene.remove(u.vis.group); this.race.racers.delete(id); this.audio.removeRemote(id); this.hud.removeLabel(id); this.units.splice(i, 1);
    if (this.isClient || this.state !== 'play') return;
    if (u.isThief) {
      const ti = this.thieves.indexOf(u); if (ti >= 0) this.thieves.splice(ti, 1);
      if (!this.aliveThieves().length) { this.say("{warn} O'g'ri o'yindan chiqib ketdi", 3000, 'big'); this.finish(true, 'left'); return; }
      this.say(`{warn} ${u.name} o'yindan chiqib ketdi`, 2200, 'small');
    }
    if (!this.units.some(x => x.isHuman && !x.dead)) this.finish(false, 'wrecked');
  }

  /** two cars hit each other hard: the one that was struck (or both, in a huge crash) rolls over and slides away */
  crashFlip(a, b, closing, sa, sb) {
    const power = clamp((closing - FLIP_MIN) / 20, 0.1, 1), both = closing > 30;
    const victims = both ? [[a, b], [b, a]] : (sa < sb ? [[a, b]] : [[b, a]]);
    for (const [u, o] of victims) {
      const dx = o.state.x - u.state.x, dz = o.state.z - u.state.z, rx = Math.cos(u.state.psi), rz = -Math.sin(u.state.psi);
      const side = dx * rx + dz * rz > 0 ? -1 : 1;                                         // rolls away from the side it was hit on
      if (!u.tm.trigger(power, side)) continue;
      const v = u.v, d = Math.hypot(dx, dz) || 1;
      v.vx = v.vx * 0.6 - dx / d * closing * 0.12; v.vz = v.vz * 0.6 - dz / d * closing * 0.12; v.yaw += side * 2.2 * power;       // slides sideways while it rolls
      v.dmg = (v.dmg || 0) + 3.5 * power;
      const cam = this.me.state, dist = Math.hypot(u.state.x - cam.x, u.state.z - cam.z);
      if (dist < 90) { this.audio.thump(0.5 + 1.3 * power * (1 - dist / 90)); this.audio.noiseBurst?.(0.25, 600, 0.35 * (1 - dist / 90), 'bandpass'); }
      if (u === this.me) { this.race.shake = Math.max(this.race.shake, 0.5 + 0.8 * power); this.hud.message('{warn} Mashina dumalab ketdi!', 1400, 'small'); }
    }
  }

  /** a parked car was shoved: sound + sparks (and a little shake when it is the player) */
  propImpact(c, x, z, p, u) {
    const me = this.me; if (!me) return;
    const dist = Math.hypot(x - me.state.x, z - me.state.z); if (dist > 100) return;
    const k = clamp(c / 18, 0.15, 1.2) * (1 - dist / 100);
    this.audio.thump(0.3 + 1.3 * k); if (c > 8) this.audio.noiseBurst?.(0.2, 900, 0.3 * k, 'bandpass');
    if (c > 6) { const s = this.race.sparks; for (let i = 0; i < Math.min(10, c); i++) s.emit(x, 0.7, z, (Math.random() - 0.5) * 7, 1 + Math.random() * 4, (Math.random() - 0.5) * 7, 0.3 + Math.random() * 0.3, 0.3, 0.1, 1, 1, 0.8, 0.3); }
    if (u === me) { this.race.shake = Math.max(this.race.shake, Math.min(0.7, c / 25)); this.stats.parked = (this.stats.parked || 0) + 1; }
  }

  respawn() {
    const me = this.me; if (!me || me.dead || this.state !== 'play') return;
    const nav = this.nav, k = nav.snap(me.v.x, me.v.z); if (k < 0) return;
    const [x, z] = nav.centre(k);
    me.v.place(x, z, this.world.freeHeading(x, z)); me.v.locked = this.race.phase === 'countdown';
    this.hud.message('Mashina yo\'lga qaytarildi', 1200, 'small');
  }

  // ------------------------------------------------------------------ network
  /** every 50 ms: my own car to everybody (relayed by the server), and the host's snapshot of all AI units */
  sendNet(dt) {
    if (!this.net) return;
    this.sendT += dt; if (this.sendT < 0.05) return; this.sendT = 0;
    const f = r2, pack = (r, hp) => { const v = r.v; return [f(v.x), f(v.z), f(v.psi), f(v.vx), f(v.vz), f(v.steer), v.gear, f(v.rpm), f(v.throttle), v.nitroOn ? 1 : 0, f(v.drift), f(v.jy || 0), 0, Math.round(r.hp * 10) / 10]; };
    this.net.send({ t: 'st', s: pack(this.me) });
    if (this.net.host) {
      const u = [];
      for (const r of this.units) if (r.v && r !== this.me) u.push([r.id, ...pack(r)]);
      this.net.send({ t: 'ms', tl: r2(this.timeLeft), b: this.thieves.map(t => r2(t.bust || 0)), u });
    }
  }
  /** client: host snapshot */
  onSnapshot(m) {
    if (!this.isClient || this.state === 'idle') return;
    this.timeLeft = m.tl;
    if (Array.isArray(m.b)) m.b.forEach((b, i) => { if (this.thieves[i]) this.thieves[i].bust = b; });
    this.refreshBust();
    for (const u of m.u) this.race.onState(u[0], u.slice(1));
  }
  /** client: host event */
  onEvent(e) {
    if (!this.isClient || this.state === 'idle') return;
    if (e.k === 'post') this.posts.add(e.spec);
    else if (e.k === 'unpost') this.posts.remove(e.id);
    else if (e.k === 'shot') this.posts.fx(e.p, e.r, e.x, e.z, !!e.h);
    else if (e.k === 'pshot') this.guns.fx(e.u, e.x, e.z, !!e.h);
    else if (e.k === 'caught') {
      const u = this.units.find(q => q.id === e.id); if (!u || u.dead) return;
      u.caught = true; u.dead = true; u.state.dead = true;
      if (u === this.me) { this.hud.message('{warn} USHLANDINGIZ!' + (e.left ? " — o'yin davom etadi" : ''), 3500, 'big'); this.hud.setFinished(true); }
    }
    else if (e.k === 'bomb') this.bombs.add(e.spec);
    else if (e.k === 'boom') { this.bombs.remove(e.id); this.bombs.fx(e.x, e.z, !!e.s); }
    else if (e.k === 'kick') { if (e.id === this.myId && this.me && this.me.v && !this.me.dead) this.bombs.kick(this.me.v, e.vx, e.vz); }
    else if (e.k === 'msg') this.hud.message(e.t, e.ms, e.kind);
    else if (e.k === 'msg2') this.hud.message(this.role === 'thief' ? e.t : e.p, e.ms, e.kind);
    else if (e.k === 'hurt') { if (e.id === this.myId && this.me && !this.me.dead) this.hurt(this.me, Math.abs(e.d), e.d < 0); }
    else if (e.k === 'end') {
      if (this.state === 'over') return;
      this.state = 'over'; this.endAt = this.clock + 2.4; this.reported = false;
      const hp = this.me.hp, frac = e.left / this.cfg.time, win = (this.role === 'police') === e.pw;
      this.over = {
        win, reason: e.reason, role: this.role, lootMode: false, stars: win ? 1 + (hp >= 50 ? 1 : 0) + (this.role === 'thief' ? (frac >= 0.3 ? 1 : 0) : (frac >= 0.5 ? 1 : 0)) : 0, time: e.time, left: e.left, limit: this.cfg.time, hp, loot: 0, lootN: LOOT_N,
        police: e.police, diff: this.D.name, wrecked: 0, topKmh: Math.round(this.stats.top * 3.6), hits: this.stats.hitsTaken, posts: e.stats ? e.stats.posts : 0, friends: this.units.filter(u => u.isHuman && u.isPolice).length,
      };
      this.hud.setFinished(true);
    }
  }

  // ------------------------------------------------------------------ props / lights / siren
  updateProps(dt) {
    const t = this.clock;
    for (const l of this.loot || []) if (!l.got) { l.bag.rotation.y = t * 1.8; l.bag.position.y = 1.7 + Math.sin(t * 2.4 + l.x) * 0.25; }
    if (this.hide && this.hide.on) this.hide.g.children[1].material.opacity = 0.55 + 0.25 * Math.sin(t * 5);
  }

  updateSiren(dt) {
    const t = this.clock, cam = this.race.camera, me = this.me;
    let best = null, bd = 1e9;
    const pos = new THREE.Vector3();
    for (const u of this.units) {
      if (!u.isPolice) continue;
      const on = !u.dead && this.race.phase !== 'idle';
      u.vis.updateSiren(t, on);
      if (!on) continue;
      const d = Math.hypot(u.state.x - cam.position.x, u.state.z - cam.position.z);
      if (d < bd) { bd = d; best = u; }
    }
    // the two shared point lights ride on the nearest police car
    const hi = this.race.quality !== 'low';
    if (best && hi && bd < 90) {
      best.vis.sirenPos(pos);
      const s = best.vis.siren;
      this.pl[0].position.copy(pos); this.pl[1].position.copy(pos);
      this.pl[0].intensity = s.r ? 150 : 0; this.pl[1].intensity = s.b ? 150 : 0;
    } else { this.pl[0].intensity = 0; this.pl[1].intensity = 0; }
    // siren sound: loudest of the nearest car, panned towards it
    if (best && bd < 220) {
      const camDir = new THREE.Vector3(); cam.getWorldDirection(camDir);
      const right = new THREE.Vector3(-camDir.z, 0, camDir.x).normalize();
      const dx = best.state.x - cam.position.x, dz = best.state.z - cam.position.z;
      const vol = clamp(1 - bd / 220, 0, 1), pan = clamp((dx * right.x + dz * right.z) / Math.max(bd, 1), -1, 1) * clamp(bd / 12, 0, 1);
      this.audio.setSiren(vol * vol * 1.4, pan, this.state === 'play' && bd < 60 ? 1.7 : 1);
    } else this.audio.setSiren(0);
  }

  // ------------------------------------------------------------------ HUD
  updateHud(dt, w, h) {
    const race = this.race, me = this.me, v = me.v, hud = this.hud;
    me.shown += (me.hp - me.shown) * (1 - Math.exp(-dt * 6));
    if (this.t - me.hitAt > 0.5) me.ghost += (me.shown - me.ghost) * (1 - Math.exp(-dt * 1.3));
    me.ghost = Math.max(me.ghost, me.shown);
    race.hitFlash = Math.max(0, race.hitFlash - dt * 1.4);
    const gd = { kmh: v.speed * 3.6 | 0, gear: v.reversing ? 'R' : String(v.gear), rpm: v.rpm, rpmRaw: v.rpmRaw, nitro: v.nitro, nitroOn: v.nitroOn, gearLimit: v.overrev, limiter: v.limiter };
    const now = performance.now();
    if (now - (hud.gT || 0) > 32 || hud.cache.gear !== gd.gear) { hud.gT = now; hud.cache.gear = gd.gear; hud.drawGauge(gd); }
    hud.el.nitroFill.style.transform = `scaleX(${v.nitro.toFixed(3)})`;
    hud.el.nitroBox.classList.toggle('on', v.nitroOn);
    const labels = [];
    for (const u of this.units) if (u !== me && this.hud.labels.has(u.id)) labels.push({ id: u.id, x: u.state.x, y: 2.4, z: u.state.z, rank: 0, hp: Math.max(0, u.hp), ghost: Math.max(0, u.hp), dist: u.dead ? 1e9 : Math.hypot(u.state.x - me.state.x, u.state.z - me.state.z) });
    hud.drawLabels({ labels, camera: race.camera, w, h, phase: race.phase });
    hud.drawHealth({ hp: me.shown, ghost: me.ghost, hpReal: me.hp, dmg: race.dmgSum, dmgAge: this.t - race.dmgAt, hitFlash: race.hitFlash });
    hud.set('mode', hud.el.mode, v.auto ? "AVTO  (X — qo'lda)" : "QO'LDA  (X — avto)");
    this.mhud.update({
      m: this, me, w, h, camera: race.camera, pinTime: PIN_TIME,
      timeLeft: this.timeLeft, bust: this.bust, loot: this.loot, hide: this.hide, units: this.units, thief: this.thief, thieves: this.thieves, thievesLeft: this.thieves.filter(u => !u.dead).length, posts: this.posts.list,
      alive: this.units.filter(u => u.isPolice && !u.dead).length, lootGot: this.stats.loot, lootN: LOOT_N, role: this.role, lootMode: this.cfg.role === 'thief', state: this.state,
    });
  }
}
