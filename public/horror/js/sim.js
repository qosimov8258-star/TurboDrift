// O'yin mantig'i (render/audio'siz): o'yinchilar, eshiklar, shkaflar, kalitlar, ruh, otiladigan narsalar, hodisalar.
// View (game.js) shu obyektni o'qiydi va `fx` navbatidan ovoz/effektlarni oladi. Node'da to'liq testlanadi.
import { buildLevel } from './decor.js';
import { Collision } from './nav.js';
import { LEVELS, DIFFS, CELL, WALL_H } from './levels.js';
import { DOOR_W } from './mapgen.js';
import { GhostAI, PHRASES, HOTKEY_PHRASE } from './ghostai.js';
import { hash32 } from './rng.js';
import { roomAt } from './mapgen.js';

export const P = { R: 0.32, EYE: 1.62, WALK: 2.7, RUN: 4.9, GHOST: 4.0, GHOST_RUN: 6.4, SEARCH: 1.5, DOOR_R: 1.9, SEND: 0.075, OBJ_R: 0.15 };
export const CHAR_PITCH = [1.35, 1.15, 0.6, 0.85, 0.7];
const FLAG = { FLASH: 1, RUN: 2, DEAD: 4, INV: 8, ESC: 16, SEARCH: 32 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => Math.round(v * 100) / 100;

export class Sim {
  constructor(o) {
    this.seed = o.seed >>> 0; this.level = o.level; this.diffIdx = o.diff ?? 1;
    this.send = o.send || (() => {});
    this.map = buildLevel(this.seed, this.level);
    this.cfg = LEVELS[this.level];
    this.diff = DIFFS[this.diffIdx];
    this.col = new Collision(this.map);
    this.t = 0; this.fx = []; this.over = null; this.hostId = o.hostId; this.myId = o.me.id;
    this.keysFound = new Set(); this.need = this.map.keysNeeded;
    this.players = new Map(); this.sendT = 0; this.endT = 0; this.stepD = 0; this.msgs = [];
    this.lastSeenAt = -99; this.scareCd = 6; this.fear = 0; this.shake = 0;
    const sorted = [...o.players].sort((a, b) => (a.id < b.id ? -1 : 1));
    sorted.forEach((p, i) => {
      const sp = this.map.spawn[i % this.map.spawn.length];
      this.players.set(p.id, this._mkPlayer(p, sp));
    });
    this.me = this.players.get(o.me.id);
    // ruh
    this.ghostOwner = o.ghostId || null;
    const gs = this.map.ghostStart;
    this.ghost = { x: gs.x, z: gs.z, yaw: 0, visible: false, chase: false, tx: gs.x, tz: gs.z, owner: this.ghostOwner, appearT: 0 };
    if (this.ghostOwner && this.players.has(this.ghostOwner)) { const g = this.players.get(this.ghostOwner); g.x = gs.x; g.z = gs.z; g.tx = gs.x; g.tz = gs.z; g.inv = true; }
    this.ai = null;
    this._maybeSpawnAI();
    // eshiklar
    this.doors = this.map.doors.map(d => {
      const h = DOOR_W / 2;
      const box = d.d === 0 ? { x0: d.x - 0.05, x1: d.x + 0.05, z0: d.z - h, z1: d.z + h } : { x0: d.x - h, x1: d.x + h, z0: d.z - 0.05, z1: d.z + 0.05 };
      const dd = { id: d.id, d: d.d, x: d.x, z: d.z, open: 0, target: 0, lockUntil: 0, holdUntil: 0, side: 1, slam: 0, box: { ...box, on: true, blocksSight: true }, creakT: 0 };
      this.col.setDynamic('d' + d.id, dd.box);
      return dd;
    });
    // chiqish
    const ex = this.map.exit;
    const w = DOOR_W + 0.5;
    this.exit = { open: 0, isOpen: false, box: ex.vertical ? { x0: ex.x - 0.12, x1: ex.x + 0.12, z0: ex.z - w / 2, z1: ex.z + w / 2, on: true } : { x0: ex.x - w / 2, x1: ex.x + w / 2, z0: ex.z - 0.12, z1: ex.z + 0.12, on: true } };
    this.col.setDynamic('exit', this.exit.box);
    this.cabs = this.map.cabinets.map(c => ({ id: c.id, open: false, openAmt: 0, hasKey: c.hasKey, by: null }));
    this.objs = this.map.throwables.map(t => ({ id: t.id, type: t.type, x: t.x, y: t.y, z: t.z, vx: 0, vy: 0, vz: 0, state: 'rest', holder: null, heldT: 0, report: false, near: false, restT: 0 }));
    this.blackoutUntil = 0; this.target = null; this.search = { c: -1, p: 0, snd: 0 };
    this.hitCd = new Map();
    this.fx.push({ t: 'start' });
    this.msg(`${this.cfg.name}`, 'title');
  }
  _mkPlayer(p, sp) {
    return { id: p.id, name: p.name, char: p.char | 0, role: p.role === 'ghost' ? 'ghost' : 'survivor', x: sp.x, z: sp.z, tx: sp.x, tz: sp.z, yaw: 0, pitch: 0, tyaw: 0, tpitch: 0,
      hearts: this.diff.hearts, alive: true, escaped: false, flash: true, running: false, inv: false, searching: false, vx: 0, vz: 0, stamina: 100, tired: false,
      invuln: 0, held: -1, bob: 0, moving: false, lastStep: 0, grabCd: 0, sayCd: 0, local: p.id === this.myId, lastMsg: this.t };
  }
  get isHost() { return this.hostId === this.myId; }
  get humanGhost() { return this.ghostOwner && this.players.has(this.ghostOwner) ? this.players.get(this.ghostOwner) : null; }
  survivors() { return [...this.players.values()].filter(p => p.role === 'survivor'); }
  aliveSurvivors() { return this.survivors().filter(p => p.alive && !p.escaped); }
  _maybeSpawnAI() {
    if (this.ai || this.humanGhost || !this.isHost) return;
    this.ai = new GhostAI(this.map, this.level, this.diffIdx, this.seed);
    this.ghost.owner = null;
  }
  msg(text, kind = 'info') { this.fx.push({ t: 'msg', text, kind }); }

  // ------------------------------------------------------------------ hodisalar
  emit(e) { this.applyEvent(e, this.myId); this.send({ t: 'ev', e }); }

  applyEvent(e, from) {
    const me = this.me;
    switch (e.k) {
      case 'cab': {
        const c = this.cabs[e.c]; if (!c || c.open) break;
        c.open = true; c.by = from;
        const who = this.players.get(from);
        const mc = this.map.cabinets[e.c];
        this.fx.push({ t: 'cabOpen', id: e.c, x: mc.x, z: mc.z, key: c.hasKey });
        if (c.hasKey && !this.keysFound.has(e.c)) {
          this.keysFound.add(e.c);
          this.fx.push({ t: 'chime', kind: 'key' });
          this.msg(`🔑 ${who ? who.name : 'Kimdir'} kalit topdi! (${this.keysFound.size}/${this.need})`, 'good');
          if (this.keysFound.size >= this.need) this.msg("Hamma kalit topildi! Endi chiqish eshigini toping (yashil chiroq)", 'good');
        } else {
          const h = hash32(this.seed, e.c, 3) % 100;
          if (from === this.myId) {
            if (h < 16) { this.fx.push({ t: 'thud', x: mc.x, z: mc.z, v: 1, glass: false }); this.addFear(0.35); this.shake = Math.max(this.shake, 0.5); this.msg('Ichidan nimadir yiqildi!…', 'scare'); }
            else this.msg(['Bo\'sh…', 'Faqat eski latta…', 'Chang va o\'rgimchak to\'ri…', 'Qon bilan yozilgan xat: «ORTGA QAYT»', 'Singan qo\'g\'irchoq… sizga qaradimi?', 'Hech narsa yo\'q'][h % 6], 'info');
          }
        }
        break;
      }
      case 'exitOpen': if (!this.exit.isOpen) { this.exit.isOpen = true; this.fx.push({ t: 'exitOpen', x: this.map.exit.x, z: this.map.exit.z }); this.msg('Chiqish eshigi ochildi! YUGURING!', 'good'); if (this.ai) this.ai.timer = Math.min(this.ai.timer, 4); } break;
      case 'esc': { const p = this.players.get(e.id); if (p && !p.escaped) { p.escaped = true; this.msg(`${p.name} qochib chiqdi!`, 'good'); if (p.local) this.fx.push({ t: 'chime', kind: 'win' }); } break; }
      case 'hit': {
        if (e.to === this.myId) this._takeHit();
        else { const v = this.players.get(e.to); if (v) this.fx.push({ t: 'scream', x: v.x, z: v.z, p: CHAR_PITCH[v.char] || 1, v: 1 }); }
        break;
      }
      case 'dead': { const p = this.players.get(e.id); if (p && p.alive) { p.alive = false; if (!p.local) this.msg(`${p.name} ruhga yem bo'ldi…`, 'scare'); } break; }
      case 'scream': this.fx.push({ t: 'scream', x: e.x, z: e.z, p: e.p || 1, v: 0.9 }); break;
      case 'say': {
        const d = Math.hypot(e.x - me.x, e.z - me.z);
        this.fx.push({ t: 'say', i: e.i, x: e.x, z: e.z, d });
        if (me.role === 'survivor' && me.alive) { const k = clamp(1 - d / 20, 0, 1); this.addFear(0.15 + 0.3 * k); if (d < 6) this.shake = Math.max(this.shake, 0.25); }
        break;
      }
      case 'slam': { const d = this.doors[e.d]; if (d) { d.open = Math.min(d.open, 0.4); d.target = 0; d.lockUntil = this.t + 4; d.slam = 1; this.fx.push({ t: 'slam', x: d.x, z: d.z }); const dist = Math.hypot(d.x - me.x, d.z - me.z); if (dist < 9 && me.role === 'survivor') { this.addFear(0.25); this.shake = Math.max(this.shake, 0.4); } } break; }
      case 'blackout': this.blackoutUntil = this.t + (e.dur || 4); this.fx.push({ t: 'blackout', dur: e.dur || 4 }); if (me.role === 'survivor') this.addFear(0.2); break;
      case 'appear': {
        this.ghost.x = this.ghost.tx = e.x; this.ghost.z = this.ghost.tz = e.z; this.ghost.yaw = e.yaw || 0; this.ghost.visible = true; this.ghost.appearT = this.t;
        this.fx.push({ t: 'appear', x: e.x, z: e.z, far: !!e.far });
        break;
      }
      case 'vanish': this.ghost.visible = false; break;
      case 'sfx': this.fx.push({ t: 'sfx', n: e.n, x: e.x, z: e.z }); break;
      case 'throw': {
        const o = this.objs[e.o]; if (!o) break;
        o.state = 'fly'; o.holder = null; o.x = e.x; o.y = e.y; o.z = e.z; o.vx = e.vx; o.vy = e.vy; o.vz = e.vz; o.report = from === this.myId; o.near = false; o.restT = 0;
        const th = this.players.get(from); if (th && th.held === e.o) th.held = -1;
        break;
      }
      case 'grab': { const o = this.objs[e.o]; if (!o) break; o.state = 'held'; o.holder = from; o.heldT = 0; const g = this.players.get(from); if (g) g.held = e.o; break; }
      case 'rest': { const o = this.objs[e.o]; if (!o || o.report) break; o.state = 'rest'; o.x = e.x; o.y = e.y; o.z = e.z; o.vx = o.vy = o.vz = 0; break; }
      default: break;
    }
  }

  addFear(v) { this.fear = clamp(this.fear + v, 0, 1); }

  _takeHit() {
    const me = this.me;
    if (!me.alive || me.escaped || me.role !== 'survivor' || me.invuln > 0) return;
    me.hearts--; me.invuln = 4; this.fear = 1; this.shake = 1;
    this.fx.push({ t: 'scream', x: null, z: null, p: CHAR_PITCH[me.char] || 1, v: 1, self: true });
    this.fx.push({ t: 'flash', color: 'red', v: 1 });
    this.send({ t: 'ev', e: { k: 'scream', x: r2(me.x), z: r2(me.z), p: CHAR_PITCH[me.char] || 1 } });
    if (me.hearts <= 0) { me.alive = false; this.msg('Ruh sizni tutdi…', 'scare'); this.emit({ k: 'dead', id: me.id }); }
    else this.msg(`Ruh sizni ushladi! Yuraklar: ${me.hearts}`, 'scare');
  }

  // ------------------------------------------------------------------ tarmoq
  handleNet(m) {
    switch (m.t) {
      case 'st': { const p = this.players.get(m.id); if (!p || p.local) break; const s = m.s; p.tx = s[0]; p.tz = s[1]; p.tyaw = s[2]; p.tpitch = s[3]; const f = s[4] | 0; p.flash = !!(f & FLAG.FLASH); p.running = !!(f & FLAG.RUN); p.searching = !!(f & FLAG.SEARCH); if (f & FLAG.DEAD) p.alive = false; if (f & FLAG.ESC) p.escaped = true; p.inv = !!(f & FLAG.INV); p.hearts = s[5]; p.held = s[6] ?? -1; p.lastMsg = this.t;
        if (p.role === 'ghost') { this.ghost.tx = p.tx; this.ghost.tz = p.tz; this.ghost.yaw = p.tyaw + Math.PI; this.ghost.visible = !p.inv; this.ghost.chase = false; }
        break; }
      case 'gs': { if (m.id === this.myId) break; const s = m.s; this.ghost.tx = s[0]; this.ghost.tz = s[1]; this.ghost.yaw = s[2]; this.ghost.chase = !!s[4]; if (!this.humanGhost) this.ghost.visible = !!s[3]; break; }
      case 'ev': this.applyEvent(m.e, m.id); break;
      case 'end': this.finish(!!m.win, m.msg, true); break;
      case 'left': {
        const p = this.players.get(m.id); if (!p) break;
        this.players.delete(m.id);
        this.msg(`${p.name} chiqib ketdi`, 'info');
        if (p.role === 'ghost') { this.ghostOwner = null; this.ghost.owner = null; this.ghost.visible = false; this._maybeSpawnAI(); if (this.ai) { this.ai.setPos(this.ghost.x, this.ghost.z); this.msg('Ruh endi o\'zi harakat qiladi', 'info'); } }
        for (const o of this.objs) if (o.holder === m.id) { o.state = 'rest'; o.holder = null; o.y = P.OBJ_R; }
        break;
      }
      case 'lobby': { if (m.host && m.host !== this.hostId) { this.hostId = m.host; this._maybeSpawnAI(); } break; }
      default: break;
    }
  }

  finish(win, msg, remote = false) {
    if (this.over) return;
    this.over = { win, msg: msg || (win ? 'Siz qochib qutuldingiz!' : 'Ruh g\'alaba qozondi…') };
    this.fx.push({ t: 'end', win, msg: this.over.msg });
    if (!remote) this.send({ t: 'end', win, msg: this.over.msg });
  }

  // ------------------------------------------------------------------ asosiy yangilanish
  // inp: { mx, mz (-1..1), yaw, pitch, run, hold, pressed: Set, flashToggle... }
  update(dt, inp) {
    dt = clamp(dt, 0, 0.05);
    this.t += dt;
    const me = this.me;
    me.yaw = inp.yaw; me.pitch = inp.pitch;
    if (this.over) inp = { ...inp, mx: 0, mz: 0, hold: false, pressed: new Set() };
    this._updateLocal(dt, inp);
    this._updateRemotes(dt);
    this._updateAI(dt);
    this._updateGhostEntity(dt);
    this._updateDoors(dt);
    this._updateObjs(dt);
    this._updateCabinets(dt);
    this._updateExit(dt);
    this._updateFear(dt);
    this._netSend(dt);
    if (!this.over) this._checkEnd(dt);
    this.shake = Math.max(0, this.shake - dt * 1.4);
  }

  _updateLocal(dt, inp) {
    const me = this.me;
    me.invuln = Math.max(0, me.invuln - dt);
    me.grabCd = Math.max(0, me.grabCd - dt); me.sayCd = Math.max(0, me.sayCd - dt);
    const free = me.role === 'ghost' || !me.alive || me.escaped;       // devordan o'tadi (tomoshabin)
    const fwdx = -Math.sin(me.yaw), fwdz = -Math.cos(me.yaw), rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
    let want = 0, moving = false;
    const mlen = Math.hypot(inp.mx, inp.mz);
    if (free) want = (me.role === 'ghost' ? (inp.run ? P.GHOST_RUN : P.GHOST) : (inp.run ? 6.5 : 4.2));
    else {
      const canRun = inp.run && !me.tired && mlen > 0.1 && inp.mz > -0.2;
      me.running = canRun;
      if (canRun) { me.stamina -= 24 * dt; if (me.stamina <= 0) { me.stamina = 0; me.tired = true; } }
      else { me.stamina = Math.min(100, me.stamina + (mlen > 0.1 ? 11 : 22) * dt); if (me.tired && me.stamina > 30) me.tired = false; }
      want = canRun ? P.RUN : P.WALK;
    }
    const tvx = (fwdx * inp.mz + rx * inp.mx) * want, tvz = (fwdz * inp.mz + rz * inp.mx) * want;
    const k = Math.min(1, dt * 11);
    me.vx += (tvx - me.vx) * k; me.vz += (tvz - me.vz) * k;
    const sp = Math.hypot(me.vx, me.vz);
    moving = sp > 0.4;
    let nx = me.x + me.vx * dt, nz = me.z + me.vz * dt;
    if (free) { nx = clamp(nx, 0.5, this.map.sizeX - 0.5); nz = clamp(nz, 0.5, this.map.sizeZ - 0.5); me.x = nx; me.z = nz; }
    else {
      const r = this.col.resolve(nx, nz, P.R);
      me.x = r.x; me.z = r.z;
      if (r.hit) { // devorga tiralganda tezlikni so'ndiramiz
        const ex = (r.x - nx), ez = (r.z - nz);
        if (Math.abs(ex) > 1e-4) me.vx *= 0.3; if (Math.abs(ez) > 1e-4) me.vz *= 0.3;
      }
      // xaritadan chiqish faqat chiqish eshigi orqali
      const ex = this.map.exit;
      if (!this.exit.isOpen) { me.x = clamp(me.x, 0.4, this.map.sizeX - 0.4); me.z = clamp(me.z, 0.4, this.map.sizeZ - 0.4); }
      else { me.x = clamp(me.x, -4, this.map.sizeX + 4); me.z = clamp(me.z, -4, this.map.sizeZ + 4); void ex; }
    }
    me.moving = moving;
    if (moving && !free) {
      me.bob += sp * dt * 1.9; this.stepD += sp * dt;
      const stride = me.running ? 2.1 : 1.55;
      if (this.stepD > stride) { this.stepD = 0; this.fx.push({ t: 'step', self: true, run: me.running }); }
    }
    // ----- rol bo'yicha harakatlar
    if (me.role === 'ghost') this._ghostPowers(dt, inp);
    else if (me.alive && !me.escaped) this._survivorActions(dt, inp);
    if (inp.pressed && inp.pressed.has('KeyF') && me.role === 'survivor' && me.alive) { me.flash = !me.flash; this.fx.push({ t: 'click' }); }
  }

  _survivorActions(dt, inp) {
    const me = this.me;
    // nishon: shkaf yoki chiqish eshigi
    let best = null, bd = 1e9;
    const dirx = -Math.sin(me.yaw), dirz = -Math.cos(me.yaw);
    for (const c of this.map.cabinets) {
      if (this.cabs[c.id].open) continue;
      const sn = Math.sin(c.rot), cs = Math.cos(c.rot);
      const fx = c.x + sn * (c.d + 0.45), fz = c.z + cs * (c.d + 0.45);
      const dx = fx - me.x, dz = fz - me.z, d = Math.hypot(dx, dz);
      if (d > 1.9) continue;
      if ((me.x - c.x) * sn + (me.z - c.z) * cs < 0.05) continue;       // shkafning orqasida emas
      if ((dx * dirx + dz * dirz) / (d || 1) < 0.5 && d > 0.7) continue;
      if (d < bd) { bd = d; best = { kind: 'cab', id: c.id, name: c.kind }; }
    }
    const ex = this.map.exit;
    if (!this.exit.isOpen) {
      const ax = ex.x - ex.nx * 0.9, az = ex.z - ex.nz * 0.9, d = Math.hypot(ax - me.x, az - me.z);
      if (d < 2.4 && d < bd) { bd = d; best = { kind: 'exit' }; }
    }
    this.target = best;
    const s = this.search;
    if (best && best.kind === 'cab' && inp.hold) {
      if (s.c !== best.id) { s.c = best.id; s.p = 0; }
      s.p += dt / P.SEARCH; me.searching = true;
      s.snd -= dt; if (s.snd <= 0) { s.snd = 0.45; const c = this.map.cabinets[best.id]; this.fx.push({ t: 'creak', x: c.x, z: c.z, v: 0.35 }); }
      if (s.p >= 1) { s.p = 0; s.c = -1; me.searching = false; this.emit({ k: 'cab', c: best.id, by: me.id }); }
    } else { s.p = 0; s.c = -1; me.searching = false; }
    if (best && best.kind === 'exit' && inp.pressed && inp.pressed.has('KeyE')) {
      if (this.keysFound.size >= this.need) { this.emit({ k: 'exitOpen' }); }
      else { this.fx.push({ t: 'clank', x: ex.x, z: ex.z }); this.msg(`Eshik qulflangan. Kalitlar: ${this.keysFound.size}/${this.need}`, 'warn'); }
    }
    // qochish
    if (this.exit.isOpen && !me.escaped) {
      const d = (me.x - ex.x) * ex.nx + (me.z - ex.z) * ex.nz;
      if (d > 0.7) { me.escaped = true; this.emit({ k: 'esc', id: me.id }); }
    }
  }

  _ghostPowers(dt, inp) {
    const me = this.me, g = this.ghost, P_ = inp.pressed || new Set();
    g.x = me.x; g.z = me.z;
    g.yaw = Math.atan2(-Math.sin(me.yaw), -Math.cos(me.yaw));
    g.tx = me.x; g.tz = me.z;
    if (P_.has('KeyE')) { me.inv = !me.inv; this.fx.push({ t: 'click' }); this.msg(me.inv ? 'Siz ko\'rinmassiz' : 'Siz ko\'rinasiz', 'info'); }
    g.visible = !me.inv;
    for (const code of Object.keys(HOTKEY_PHRASE)) {
      if (P_.has(code) && me.sayCd <= 0) { me.sayCd = 2.2; this.emit({ k: 'say', i: HOTKEY_PHRASE[code], x: r2(me.x), z: r2(me.z) }); }
    }
    // R — narsani olish / otish
    if (P_.has('KeyR') && me.grabCd <= 0) {
      me.grabCd = 0.5;
      if (me.held >= 0) {
        const o = this.objs[me.held];
        const dx = -Math.sin(me.yaw) * Math.cos(me.pitch), dz = -Math.cos(me.yaw) * Math.cos(me.pitch), dy = Math.sin(me.pitch);
        const sp = 15;
        this.emit({ k: 'throw', o: o.id, x: r2(o.x), y: r2(o.y), z: r2(o.z), vx: r2(dx * sp), vy: r2(dy * sp + 1.5), vz: r2(dz * sp), by: me.id });
      } else {
        const dirx = -Math.sin(me.yaw), dirz = -Math.cos(me.yaw);
        let best = null, bd = 1e9;
        for (const o of this.objs) {
          if (o.state !== 'rest') continue;
          const dx = o.x - me.x, dz = o.z - me.z, d = Math.hypot(dx, dz);
          if (d > 8) continue;
          const c = (dx * dirx + dz * dirz) / (d || 1);
          if (c < 0.55 && d > 2.5) continue;
          const score = d - c * 2;
          if (score < bd) { bd = score; best = o; }
        }
        if (best) this.emit({ k: 'grab', o: best.id, by: me.id });
        else this.msg('Yaqin atrofda narsa yo\'q', 'info');
      }
    }
    // tegib ushlash
    if (g.visible) for (const p of this.survivors()) {
      if (!p.alive || p.escaped || p.invuln > 0) continue;
      if (Math.hypot(p.x - g.x, p.z - g.z) < 1.0 && (this.hitCd.get(p.id) || 0) <= this.t) {
        this.hitCd.set(p.id, this.t + 5);
        this.emit({ k: 'hit', to: p.id, by: me.id });
        this.fx.push({ t: 'msg', text: `${p.name} ushlandi!`, kind: 'info' });
      }
    }
  }

  _updateRemotes(dt) {
    const k = Math.min(1, dt * 13);
    for (const p of this.players.values()) {
      if (p.local) continue;
      const ox = p.x, oz = p.z;
      p.x += (p.tx - p.x) * k; p.z += (p.tz - p.z) * k;
      let dy = p.tyaw - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); p.yaw += dy * k;
      p.pitch += (p.tpitch - p.pitch) * k;
      const sp = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-4);
      p.moving = sp > 0.5; p.speed = sp;
      if (p.moving && p.role === 'survivor') { p.bob += sp * dt * 1.9; p.lastStep = (p.lastStep || 0) + sp * dt; if (p.lastStep > (p.running ? 2.1 : 1.55)) { p.lastStep = 0; this.fx.push({ t: 'step', x: p.x, z: p.z, run: p.running }); } }
      p.invuln = Math.max(0, p.invuln - dt);
    }
  }

  _aiCtx() {
    if (this._ctx) return this._ctx;
    return this._ctx = {
      survivors: () => this.survivors().map(p => ({ id: p.id, x: p.x, z: p.z, yaw: p.yaw, alive: p.alive, escaped: p.escaped })),
      emit: e => this.emit(e),
      los: (a, b, c, d) => this.col.los(a, b, c, d, true),
      objs: () => this.objs,
      doorsNear: (x, z, r) => this.doors.filter(d => Math.hypot(d.x - x, d.z - z) < r),
      roomAt: (x, z) => roomAt(this.map, x, z),
    };
  }
  _updateAI(dt) {
    if (!this.ai || this.over) return;
    this.ai.update(dt, this._aiCtx());
    const a = this.ai, g = this.ghost;
    // AI ba'zan 'appear' hodisasi orqali o'zi joylashadi; bu yerda faqat holatni ko'chiramiz
    g.x = g.tx = a.x; g.z = g.tz = a.z; g.yaw = a.yaw; g.visible = a.visible; g.chase = a.mode === 'chase';
  }
  _updateGhostEntity(dt) {
    const g = this.ghost;
    if (this.ai || (this.humanGhost && this.humanGhost.local)) return;
    const k = Math.min(1, dt * 12);
    g.x += (g.tx - g.x) * k; g.z += (g.tz - g.z) * k;
  }

  _updateDoors(dt) {
    const sv = this.aliveSurvivors();
    for (const d of this.doors) {
      let near = null, nd = P.DOOR_R;
      for (const p of sv) { const dd = Math.hypot(p.x - d.x, p.z - d.z); if (dd < nd) { nd = dd; near = p; } }
      const locked = this.t < d.lockUntil;
      if (locked) d.target = 0;
      else if (near) { if (d.target === 0 && d.open < 0.05) d.side = d.d === 1 ? (near.z < d.z ? -1 : 1) : (near.x < d.x ? 1 : -1); d.target = 1; d.holdUntil = this.t + 2.0; }
      else if (this.t > d.holdUntil) d.target = 0;
      const rate = d.slam > 0 ? 18 : (d.target ? 4.2 : 2.0);
      const prev = d.open;
      d.open += clamp(d.target - d.open, -rate * dt, rate * dt);
      if (d.slam > 0 && d.open <= 0.001) d.slam = 0;
      d.box.on = d.open < 0.5;
      d.creakT -= dt;
      if (prev < 0.05 && d.open >= 0.05 && d.creakT <= 0) { d.creakT = 2; this.fx.push({ t: 'creak', x: d.x, z: d.z, v: 0.4 }); }
    }
  }

  _updateObjs(dt) {
    const me = this.me;
    for (const o of this.objs) {
      if (o.state === 'held') {
        const h = this.players.get(o.holder);
        if (!h) { o.state = 'rest'; o.y = P.OBJ_R; continue; }
        o.heldT += dt;
        const fx = -Math.sin(h.yaw), fz = -Math.cos(h.yaw);
        const tx = h.x + fx * 1.7, tz = h.z + fz * 1.7, ty = 1.45 + Math.sin(this.t * 3) * 0.08;
        const k = Math.min(1, dt * 10); o.x += (tx - o.x) * k; o.z += (tz - o.z) * k; o.y += (ty - o.y) * k;
        if (o.heldT > 9 && h.local) { this.emit({ k: 'throw', o: o.id, x: r2(o.x), y: r2(o.y), z: r2(o.z), vx: r2(fx * 3), vy: 0, vz: r2(fz * 3), by: h.id }); }
        continue;
      }
      if (o.state !== 'fly') continue;
      o.vy -= 12 * dt;
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      const r = this.col.resolve(o.x, o.z, P.OBJ_R);
      if (r.hit) {
        const nx = r.x - o.x, nz = r.z - o.z, l = Math.hypot(nx, nz);
        if (l > 1e-5) { const ux = nx / l, uz = nz / l, dot = o.vx * ux + o.vz * uz; if (dot < 0) { o.vx -= 1.4 * dot * ux; o.vz -= 1.4 * dot * uz; o.vx *= 0.7; o.vz *= 0.7; } }
        o.x = r.x; o.z = r.z;
        if (Math.hypot(o.vx, o.vz) > 2 && this.t - (o.lastHit || 0) > 0.25) { o.lastHit = this.t; this.fx.push({ t: 'thud', x: o.x, z: o.z, v: Math.min(1, Math.hypot(o.vx, o.vz) / 10), glass: o.type === 'bottle' }); }
      }
      o.x = clamp(o.x, 0.2, this.map.sizeX - 0.2); o.z = clamp(o.z, 0.2, this.map.sizeZ - 0.2);
      if (o.y < P.OBJ_R) {
        o.y = P.OBJ_R;
        if (o.vy < -2.5) this.fx.push({ t: 'thud', x: o.x, z: o.z, v: Math.min(1, -o.vy / 8), glass: o.type === 'bottle' && o.vy < -5 });
        o.vy = -o.vy * 0.32; o.vx *= 0.72; o.vz *= 0.72;
      }
      if (o.y > WALL_H - 0.2) { o.y = WALL_H - 0.2; o.vy = -Math.abs(o.vy) * 0.3; }
      const sp = Math.hypot(o.vx, o.vy, o.vz);
      if (o.y <= P.OBJ_R + 0.01 && sp < 0.6) { o.state = 'rest'; o.vx = o.vy = o.vz = 0; if (o.report) { o.report = false; this.send({ t: 'ev', e: { k: 'rest', o: o.id, x: r2(o.x), y: r2(o.y), z: r2(o.z) } }); } continue; }
      o.restT += dt; if (o.restT > 12) { o.state = 'rest'; o.vx = o.vy = o.vz = 0; o.y = P.OBJ_R; }
      // yaqin o'tdi / tegdi (faqat o'zim uchun)
      if (me.role === 'survivor' && me.alive && sp > 4.5) {
        const d = Math.hypot(o.x - me.x, o.z - me.z, o.y - 1.2);
        if (d < 0.55 && this.t - (o.hitAt || 0) > 1.5) { o.hitAt = this.t; this.addFear(0.55); this.shake = 1; this.fx.push({ t: 'scream', x: null, z: null, p: CHAR_PITCH[me.char] || 1, v: 1, self: true }); this.fx.push({ t: 'flash', color: 'red', v: 0.5 }); this.send({ t: 'ev', e: { k: 'scream', x: r2(me.x), z: r2(me.z), p: CHAR_PITCH[me.char] || 1 } }); this.msg('Narsa sizga tegdi!', 'scare'); }
        else if (d < 1.6 && !o.near) { o.near = true; this.addFear(0.3); this.shake = Math.max(this.shake, 0.5); if (((o.id * 7 + Math.floor(this.t)) & 1) === 0) { this.fx.push({ t: 'scream', x: null, z: null, p: CHAR_PITCH[me.char] || 1, v: 0.8, self: true }); } }
      }
    }
  }

  _updateCabinets(dt) { for (const c of this.cabs) c.openAmt += ((c.open ? 1 : 0) - c.openAmt) * Math.min(1, dt * 4); }
  _updateExit(dt) { const e = this.exit; e.open += ((e.isOpen ? 1 : 0) - e.open) * Math.min(1, dt * 2.2); e.box.on = !e.isOpen; }

  // qo'rquv: ruhni to'satdan ko'rish — baland baqiriq
  _updateFear(dt) {
    const me = this.me, g = this.ghost;
    if (me.role !== 'survivor' || !me.alive || me.escaped) { this.fear = Math.max(0, this.fear - dt * 0.3); return; }
    // ruh 5 m ichida bo'lsa (ko'rinmasa ham): yuz oldiga otilib chiqadi va baqiriq
    const gd5 = Math.hypot(g.x - me.x, g.z - me.z);
    if (gd5 < 5 && this.t > (this.jumpCd ?? 8) && this.t > 3) {
      this.jumpCd = this.t + 18;
      this.fx.push({ t: 'jump' }); this.fx.push({ t: 'scream', x: null, z: null, p: CHAR_PITCH[me.char] || 1, v: 1.2, self: true });
      this.fx.push({ t: 'stinger' }); this.fx.push({ t: 'flash', color: 'white', v: 0.9 });
      this.fear = 1; this.shake = 1.6; this.scareCd = this.t + 6; this.lastSeenAt = this.t;
      this.send({ t: 'ev', e: { k: 'scream', x: r2(me.x), z: r2(me.z), p: CHAR_PITCH[me.char] || 1 } });
      this.msg('RUH YAQIN!', 'scare');
    }
    let seen = false, d = 99;
    if (g.visible) {
      d = Math.hypot(g.x - me.x, g.z - me.z);
      if (d < 18 && this.col.los(me.x, me.z, g.x, g.z, true)) {
        const dx = (g.x - me.x) / (d || 1), dz = (g.z - me.z) / (d || 1);
        const dot = dx * -Math.sin(me.yaw) + dz * -Math.cos(me.yaw);
        if (dot > Math.cos(0.9)) seen = true;
      }
    }
    if (seen) {
      if (this.t - this.lastSeenAt > 3.5 && this.t > this.scareCd) {
        this.scareCd = this.t + 6; this.jumpCd = this.t + 12;
        this.fx.push({ t: 'jump' });
        this.fx.push({ t: 'scream', x: null, z: null, p: CHAR_PITCH[me.char] || 1, v: 1, self: true });
        this.fx.push({ t: 'stinger' }); this.fx.push({ t: 'flash', color: 'white', v: 0.8 });
        this.fear = 1; this.shake = 1;
        this.send({ t: 'ev', e: { k: 'scream', x: r2(me.x), z: r2(me.z), p: CHAR_PITCH[me.char] || 1 } });
        this.msg('RUH!', 'scare');
      }
      this.lastSeenAt = this.t;
      this.fear = Math.max(this.fear, clamp(1 - d / 18, 0.2, 0.95) * 0.9);
    } else if (g.visible && d < 8) this.fear = Math.max(this.fear, 0.3);
    this.fear = Math.max(0, this.fear - dt * (seen ? 0 : 0.07));
    this._seen = seen;
  }

  _netSend(dt) {
    this.sendT += dt;
    if (this.sendT < P.SEND) return;
    this.sendT = 0;
    const me = this.me;
    const f = (me.flash && me.role === 'survivor' ? FLAG.FLASH : 0) | (me.running ? FLAG.RUN : 0) | (!me.alive ? FLAG.DEAD : 0) | (me.inv ? FLAG.INV : 0) | (me.escaped ? FLAG.ESC : 0) | (me.searching ? FLAG.SEARCH : 0);
    this.send({ t: 'st', s: [r2(me.x), r2(me.z), r2(me.yaw), r2(me.pitch), f, me.hearts, me.held] });
    if (this.ai) { const s = this.ai.state(); this.send({ t: 'gs', s: [r2(s[0]), r2(s[1]), r2(s[2]), s[3], s[4]] }); }
  }

  _checkEnd(dt) {
    this.endT += dt; if (this.endT < 0.5) return;
    this.endT = 0;
    if (this.t < 2) return;
    const hostLike = this.isHost || (this.humanGhost && this.humanGhost.local && !this.players.get(this.hostId));
    if (!hostLike) return;
    const sv = this.survivors();
    if (!sv.length) return;
    const active = sv.filter(p => p.alive && !p.escaped);
    if (active.length) return;
    const esc = sv.filter(p => p.escaped).length;
    if (esc > 0) this.finish(true, `${esc} ta o'yinchi qochib qutuldi!`);
    else this.finish(false, "Ruh hammani tutdi…");
  }
}
