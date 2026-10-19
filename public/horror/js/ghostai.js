// Ruh sun'iy intellekti (yakka o'yin yoki ruh o'yinchisi bo'lmaganda xona egasida ishlaydi).
// Sof mantiq: tashqi dunyo `ctx` orqali beriladi => Node'da testlanadi.
import { LEVELS, DIFFS, CELL } from './levels.js';
import { Rng, hash32 } from './rng.js';

export const PHRASES = [
  "Orqangga qarama…",
  "Men seni ortingdaman…",
  "Sen bu yerdan chiqib ketolmaysan…",
  "Kalitni topdim deb o'ylaysanmi?",
  "Menga qara…",
  "Qayerga qochding? Men shu yerdaman…",
  "Xa xa xa xa xa xa",
  "Ketma… biz bilan qol…",
];
// ruh o'yinchisi tugmalari: 1 -> 0, 2 -> 1, 3 -> 2, 4 -> 6 (kulgi)
export const HOTKEY_PHRASE = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 6 };

export class GhostAI {
  constructor(map, level, diff, seed) {
    this.map = map; this.cfg = LEVELS[level].ghost; this.d = DIFFS[diff] || DIFFS[1];
    this.rng = new Rng(hash32(seed, level, 555));
    this.x = map.ghostStart.x; this.z = map.ghostStart.z; this.yaw = 0;
    this.visible = false; this.mode = 'stalk'; this.t = 0;
    this.timer = 20 + this.rng.range(0, 10) * this.d.gap;       // birinchi hodisagacha tinchlik
    this.chaseT = 0; this.stareT = 0; this.hitCd = new Map(); this.retreatT = 0;
    this.lastEvent = 0; this.dirty = false;
  }
  speed() { return this.cfg.speed * this.d.speed; }
  chaseSpeed() { return this.cfg.chase * this.d.speed; }
  state() { return [this.x, this.z, this.yaw, this.visible ? 1 : 0, this.mode === 'chase' ? 1 : 0]; }
  setPos(x, z) { this.x = x; this.z = z; }

  update(dt, ctx) {
    this.t += dt;
    const S = ctx.survivors().filter(p => p.alive && !p.escaped);
    if (!S.length) { this.visible = false; return; }
    let near = S[0], nd = Infinity;
    for (const p of S) { const d = Math.hypot(p.x - this.x, p.z - this.z); if (d < nd) { nd = d; near = p; } }
    const toX = near.x - this.x, toZ = near.z - this.z;
    const face = (tx, tz) => { this.yaw = Math.atan2(tx, tz); };       // model +z ga qaraydi
    for (const [id, v] of this.hitCd) if (v > 0) this.hitCd.set(id, v - dt);
    const agg = 1 - Math.min(0.35, this.t / 900);                      // vaqt o'tishi bilan kuchayadi

    switch (this.mode) {
      case 'stalk': {
        this.visible = false;
        this.stalkT = (this.stalkT || 0) + dt;
        const want = Math.max(4, 13 - this.stalkT * 0.45);          // sekin yaqinlashadi (ko'rinmas)
        if (nd < 4.8) { this.mode = 'retreat'; this.retreatT = 5 + this.rng.range(0, 3); this.stalkT = 0; break; }
        if (nd > want) { const k = this.speed() * dt / nd; this.x += toX * k; this.z += toZ * k; face(toX, toZ); }
        else { // aylanib yuradi
          const a = Math.atan2(toZ, toX) + dt * 0.35; this.x = near.x - Math.cos(a) * want; this.z = near.z - Math.sin(a) * want; face(toX, toZ);
        }
        this.timer -= dt;
        if (this.timer <= 0) this.pickEvent(near, S, nd, ctx);
        break;
      }
      case 'chase': {
        this.visible = true;
        const k = this.chaseSpeed() * dt / Math.max(nd, 0.01); this.x += toX * k; this.z += toZ * k; face(toX, toZ);
        this.chaseT -= dt;
        // eng yaqin emas, ketma-ket tekshirib: yetgan odamni uradi
        for (const p of S) {
          if (Math.hypot(p.x - this.x, p.z - this.z) < 0.95 && (this.hitCd.get(p.id) || 0) <= 0) {
            this.hitCd.set(p.id, 6);
            ctx.emit({ k: 'hit', to: p.id, by: 'ai' });
            this.mode = 'retreat'; this.retreatT = 6 + this.rng.range(0, 3); this.visible = false; break;
          }
        }
        if (this.mode === 'chase' && this.chaseT <= 0) { this.mode = 'stalk'; this.visible = false; this.timer = this.nextGap(); ctx.emit({ k: 'vanish' }); }
        break;
      }
      case 'stare': {
        this.visible = true; face(toX, toZ);
        this.stareT -= dt;
        if (this.stareT <= 0 || nd < 6) { this.mode = 'stalk'; this.visible = false; this.timer = this.nextGap() * 0.8; ctx.emit({ k: 'vanish' }); }
        break;
      }
      case 'retreat': {
        this.visible = false; this.stalkT = 0;
        const k = this.speed() * 1.6 * dt / Math.max(nd, 0.01); this.x -= toX * k; this.z -= toZ * k;
        this.retreatT -= dt;
        if (this.retreatT <= 0) { this.mode = 'stalk'; this.timer = this.nextGap(); }
        break;
      }
      default: this.mode = 'stalk';
    }
    // xarita chegarasidan chiqmasin
    this.x = Math.max(1, Math.min(this.map.sizeX - 1, this.x)); this.z = Math.max(1, Math.min(this.map.sizeZ - 1, this.z));
    void agg;
  }
  nextGap() { const agg = 1 - Math.min(0.35, this.t / 900); return Math.max(5, this.cfg.gap * this.d.gap * agg * this.rng.range(0.6, 1.3)); }

  pickEvent(near, S, nd, ctx) {
    const r = this.rng.next();
    this.timer = this.nextGap();
    const room = ctx.roomAt ? ctx.roomAt(near.x, near.z) : -1;
    if (r < 0.34) return this.appear(near, ctx);
    if (r < 0.50) return this.stare(near, ctx);
    if (r < 0.68) {      // orqadan ovoz
      const bx = near.x + Math.sin(near.yaw) * 1.8, bz = near.z + Math.cos(near.yaw) * 1.8;
      ctx.emit({ k: 'say', i: [0, 1, 1, 2, 4, 5, 7][this.rng.int(0, 6)], x: bx, z: bz }); return;
    }
    if (r < 0.80) { // narsa otish
      const objs = ctx.objs().filter(o => o.state === 'rest' && Math.hypot(o.x - near.x, o.z - near.z) < 9 && Math.hypot(o.x - near.x, o.z - near.z) > 2.5);
      if (objs.length) {
        const o = this.rng.pick(objs), dx = near.x - o.x, dz = near.z - o.z, d = Math.hypot(dx, dz) || 1, sp = 8 + this.rng.range(0, 3);
        const miss = this.rng.chance(0.65) ? this.rng.range(0.9, 1.8) * (this.rng.chance(0.5) ? 1 : -1) : 0;      // ko'pincha yonidan o'tib ketadi
        const ax = dx / d, az = dz / d;
        ctx.emit({ k: 'throw', o: o.id, x: o.x, y: 0.5, z: o.z, vx: ax * sp - az * miss, vy: 3.5, vz: az * sp + ax * miss, by: 'ai' });
        return;
      }
    }
    if (r < 0.88) { const ds = ctx.doorsNear(near.x, near.z, 11); if (ds.length) { ctx.emit({ k: 'slam', d: this.rng.pick(ds).id }); return; } }
    if (r < 0.93) { ctx.emit({ k: 'blackout', dur: 3 + this.rng.range(0, 3) }); return; }
    ctx.emit({ k: 'sfx', n: this.rng.pick(['creak', 'knock', 'bell', 'whisper', 'growl']), x: near.x + this.rng.range(-8, 8), z: near.z + this.rng.range(-8, 8) });
  }
  appear(near, ctx) {
    // nishon ko'rish yo'nalishida, ko'rinish chizig'ida paydo bo'ladi
    let best = null;
    for (let i = 0; i < 16; i++) {
      const a = near.yaw + this.rng.range(-0.55, 0.55), d = this.rng.range(5.5, 10);
      const x = near.x - Math.sin(a) * d, z = near.z - Math.cos(a) * d;      // kamera oldinga: (-sin, -cos)
      if (x < 1 || z < 1 || x > this.map.sizeX - 1 || z > this.map.sizeZ - 1) continue;
      if (ctx.los(near.x, near.z, x, z)) { best = { x, z }; break; }
      if (!best) best = { x, z };
    }
    if (!best) return;
    this.x = best.x; this.z = best.z; this.visible = true; this.mode = 'chase'; this.chaseT = 3.2 + this.rng.range(0, 3);
    this.yaw = Math.atan2(near.x - this.x, near.z - this.z);
    ctx.emit({ k: 'appear', x: this.x, z: this.z, yaw: this.yaw });
  }
  stare(near, ctx) {
    for (let i = 0; i < 12; i++) {
      const a = near.yaw + this.rng.range(-0.6, 0.6), d = this.rng.range(11, 16);
      const x = near.x - Math.sin(a) * d, z = near.z - Math.cos(a) * d;
      if (x < 1 || z < 1 || x > this.map.sizeX - 1 || z > this.map.sizeZ - 1) continue;
      if (!ctx.los(near.x, near.z, x, z)) continue;
      this.x = x; this.z = z; this.visible = true; this.mode = 'stare'; this.stareT = 2.5 + this.rng.range(0, 2);
      this.yaw = Math.atan2(near.x - x, near.z - z);
      ctx.emit({ k: 'appear', x, z, yaw: this.yaw, far: 1 });
      return;
    }
    this.timer = 3;     // yaxshi joy topilmadi — tez orada qayta uriniladi
  }
}
