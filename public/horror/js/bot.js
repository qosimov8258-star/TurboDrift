// Sinov uchun bot: Sim ichidagi mahalliy o'yinchini boshqaradi (yo'l topish A*, shkaflarni qidirish, chiqishga yugurish).
// O'yin ichida ham `?bot` bilan avtomatik o'ynash uchun ishlatiladi (testlar).
import { Collision } from './nav.js';
import { P } from './sim.js';
import { CELL } from './levels.js';

const NSTEP = 0.3;
function navFor(map) {
  if (map.__nav) return map.__nav;
  const col = new Collision(map);
  const gw = Math.ceil((map.sizeX + 8) / NSTEP) + 1, gh = Math.ceil((map.sizeZ + 8) / NSTEP) + 1, off = 4;
  const ok = new Uint8Array(gw * gh);
  for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
    const wx = x * NSTEP - off, wz = z * NSTEP - off;
    const r = col.resolve(wx, wz, P.R + 0.04);
    ok[z * gw + x] = (Math.abs(r.x - wx) < 0.01 && Math.abs(r.z - wz) < 0.01) ? 1 : 0;
  }
  // xaritadan tashqarisi faqat chiqish eshigi oldida mumkin
  const ex = map.exit;
  for (let z = 0; z < gh; z++) for (let x = 0; x < gw; x++) {
    const wx = x * NSTEP - off, wz = z * NSTEP - off;
    if (wx < 0.4 || wz < 0.4 || wx > map.sizeX - 0.4 || wz > map.sizeZ - 0.4) {
      const d = (wx - ex.x) * ex.nx + (wz - ex.z) * ex.nz, lat = Math.abs(ex.vertical ? wz - ex.z : wx - ex.x);
      ok[z * gw + x] = (d > -0.5 && d < 3 && lat < 0.6) ? 1 : 0;
      if (d > -0.5 && d < 3 && lat < 0.6) ok[z * gw + x] = 1;
    }
  }
  return map.__nav = { gw, gh, off, ok };
}

export class Bot {
  constructor(sim, rng, opts = {}) {
    this.sim = sim; this.rng = rng; this.nav = navFor(sim.map);
    this.path = null; this.pi = 0; this.goal = null; this.stuckT = 0; this.lastPos = [sim.me.x, sim.me.z]; this.replan = 0;
    this.yaw = rng() * 6.28; this.skip = new Set(); this.pressed = new Set(); this.phase = 'keys'; this.lookT = 0;
    this.opts = opts; this.holdT = 0; this.wander = 0;
  }
  cell(x, z) { const n = this.nav; return [Math.round((x + n.off) / NSTEP), Math.round((z + n.off) / NSTEP)]; }
  world(cx, cz) { return [cx * NSTEP - this.nav.off, cz * NSTEP - this.nav.off]; }
  plan(gx, gz) {
    const n = this.nav, me = this.sim.me;
    const [sx, sz] = this.cell(me.x, me.z), [tx, tz] = this.cell(gx, gz);
    const idx = (x, z) => z * n.gw + x;
    if (sx < 0 || sz < 0 || sx >= n.gw || sz >= n.gh) return null;
    // yaqin bo'sh nuqtani topish (maqsad devorga tushgan bo'lsa)
    let T = [tx, tz];
    if (!n.ok[idx(tx, tz)]) { let found = null; for (let r = 1; r < 8 && !found; r++) for (let dz = -r; dz <= r && !found; dz++) for (let dx = -r; dx <= r; dx++) { const x = tx + dx, z = tz + dz; if (x >= 0 && z >= 0 && x < n.gw && z < n.gh && n.ok[idx(x, z)]) { found = [x, z]; break; } } if (!found) return null; T = found; }
    const gS = new Float32Array(n.gw * n.gh).fill(1e9), from = new Int32Array(n.gw * n.gh).fill(-1), closed = new Uint8Array(n.gw * n.gh);
    // ikkilik kucha
    const heap = [[0, idx(sx, sz)]]; gS[idx(sx, sz)] = 0;
    const push = it => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const goalI = idx(T[0], T[1]);
    let found = false, it = 0;
    while (heap.length && it++ < 400000) {
      const [, ci] = pop(); if (closed[ci]) continue; closed[ci] = 1;
      if (ci === goalI) { found = true; break; }
      const cx = ci % n.gw, cz = (ci / n.gw) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= n.gw || nz >= n.gh) continue;
        const ni = idx(nx, nz); if (!n.ok[ni] || closed[ni]) continue;
        if (dx && dz && (!n.ok[idx(cx + dx, cz)] || !n.ok[idx(cx, cz + dz)])) continue;
        const g = gS[ci] + (dx && dz ? 1.414 : 1);
        if (g < gS[ni]) { gS[ni] = g; from[ni] = ci; push([g + Math.hypot(nx - T[0], nz - T[1]), ni]); }
      }
    }
    if (!found) return null;
    const pts = []; for (let c = goalI; c !== -1; c = from[c]) pts.push(this.world(c % n.gw, (c / n.gw) | 0));
    pts.reverse();
    // siyraklashtirish
    const out = []; for (let i = 0; i < pts.length; i += 3) out.push(pts[i]); out.push(pts[pts.length - 1]);
    return out;
  }
  setGoal(x, z, tag) { this.goal = { x, z, tag }; this.path = this.plan(x, z); this.pi = 0; this.stuckT = 0; }

  // -> inp
  step(dt) {
    const sim = this.sim, me = sim.me, map = sim.map;
    const pressed = new Set();
    let mx = 0, mz = 0, hold = false, run = false;
    if (me.role === 'ghost') return this.ghostStep(dt, pressed);
    if (sim.cine) { this.stuckT = 0; this.stuckCount = 0; this.lastPos = [me.x, me.z]; return { mx: 0, mz: 0, yaw: this.yaw, pitch: 0, run: false, hold: false, pressed }; }      // kadr paytida kutadi
    if (me.frozen > 0) { this.stuckT = 0; this.lastPos = [me.x, me.z]; }
    if (!me.alive || me.escaped) return { mx: 0, mz: 0, yaw: me.yaw, pitch: 0, run: false, hold: false, pressed };
    // ruh kimnidir tishlagan: qurol bilan qutqarish (yoki o'zi tishlangan bo'lsa — qarshilik)
    const bite = sim.bite, gh0 = sim.ghost;
    if (bite) {
      const victim = bite.to === me.id, dx = gh0.x - me.x, dz = gh0.z - me.z, dg = Math.hypot(dx, dz);
      const reach = me.weapon === 'pistol' ? 6 : 1.6;
      if (victim || (me.weapon && dg < reach && sim.col.los(me.x, me.z, gh0.x, gh0.z, true))) {
        if (dg > 0.2) this.yaw = Math.atan2(-dx, -dz);
        this.atkT = (this.atkT || 0) - dt;
        if (this.atkT <= 0) { this.atkT = 0.3; pressed.add('Mouse0'); }
        return { mx: 0, mz: 0, yaw: this.yaw, pitch: 0, run: false, hold: false, pressed };
      }
      if (me.weapon && !victim) {
        if (!this.goal || this.goal.tag !== 'rescue' || this.rescueT <= 0) { this.setGoal(gh0.x, gh0.z, 'rescue'); this.rescueT = 1; }
        this.rescueT -= dt;
      }
    } else if (this.goal && this.goal.tag === 'rescue') this.goal = null;
    // qurol olish: yaqin (25 m gacha) bo'sh qurol bo'lsa
    if (!me.weapon && !bite) {
      if (this.goal && this.goal.tag === 'wep' && sim.weps[this.goal.id].by) this.goal = null;
      if (!this.goal || this.goal.tag !== 'wep') {
        let bw = null, bd2 = 25;
        for (const w of sim.weps) { if (w.by || this.skip.has('w' + w.id)) continue; const d = Math.hypot(w.x - me.x, w.z - me.z); if (d < bd2) { bd2 = d; bw = w; } }
        if (bw) { this.setGoal(bw.x, bw.z, 'wep'); this.goal.id = bw.id; }
      }
    }
    if (me.weapon && this.goal && this.goal.tag === 'wep') this.goal = null;
    // maqsad tanlash
    const need = sim.keysFound.size >= sim.need;
    if (this.goal && (this.goal.tag === 'wep' || this.goal.tag === 'rescue')) { /* maxsus maqsad */ }
    else if (need && sim.exit.isOpen) {
      const ex = map.exit;
      if (!this.goal || this.goal.tag !== 'out') this.setGoal(ex.x + ex.nx * 1.6, ex.z + ex.nz * 1.6, 'out');
    } else if (need) {
      const ex = map.exit;
      if (!this.goal || this.goal.tag !== 'exit') this.setGoal(ex.x - ex.nx * 0.9, ex.z - ex.nz * 0.9, 'exit');
    } else if (!this.goal || this.goal.tag !== 'cab' || sim.cabs[this.goal.id].open || this.skip.has(this.goal.id)) {
      let best = null, bd = 1e9;
      for (const c of map.cabinets) {
        if (sim.cabs[c.id].open || this.skip.has(c.id)) continue;
        const fx = c.x + Math.sin(c.rot) * (c.d + 0.8), fz = c.z + Math.cos(c.rot) * (c.d + 0.8);
        const d = Math.hypot(fx - me.x, fz - me.z) + this.rng() * 8;
        if (d < bd) { bd = d; best = { c, fx, fz }; }
      }
      if (best) { this.setGoal(best.fx, best.fz, 'cab'); this.goal.id = best.c.id; } else this.goal = null;
    }
    const g = this.goal;
    if (g) {
      const dg = Math.hypot(g.x - me.x, g.z - me.z);
      if (g.tag === 'wep' && dg < 0.8) {
        pressed.add('KeyE'); this.holdT += dt; if (this.holdT > 1.5) { this.skip.add('w' + g.id); this.goal = null; this.holdT = 0; }
        if (me.weapon) this.goal = null;
      } else if (g.tag === 'cab' && dg < 0.5) {
        const c = map.cabinets[g.id]; this.yaw = Math.atan2(-(c.x - me.x), -(c.z - me.z)); hold = true;       // shkafga qaraydi
        if (sim.cabs[g.id].open) this.goal = null;
      } else if (g.tag === 'exit' && dg < 0.6) {
        const ex = map.exit; this.yaw = Math.atan2(-(ex.x - me.x), -(ex.z - me.z)); this.holdT += dt; if (this.holdT > 0.3) { pressed.add('KeyE'); this.holdT = 0; }
      } else if (this.path) {
        // yo'l bo'ylab yurish
        while (this.pi < this.path.length - 1 && Math.hypot(this.path[this.pi][0] - me.x, this.path[this.pi][1] - me.z) < 0.55) this.pi++;
        const wp = this.path[Math.min(this.pi, this.path.length - 1)];
        const dx = wp[0] - me.x, dz = wp[1] - me.z;
        this.yaw = Math.atan2(-dx, -dz); mz = 1;
      } else { this.replan -= dt; if (this.replan <= 0) { this.replan = 1; this.path = this.plan(g.x, g.z); this.pi = 0; if (!this.path && g.tag === 'cab') { this.skip.add(g.id); this.goal = null; } } }
      // tiqilib qolishni tekshirish
      this.stuckT += dt;
      if (this.stuckT > 2) { const moved = Math.hypot(me.x - this.lastPos[0], me.z - this.lastPos[1]); this.lastPos = [me.x, me.z]; this.stuckT = 0; if (moved < 0.3 && !hold && !(g.tag === 'exit' && dg < 0.8)) {
        if (g.tag === 'wep') { this.skip.add('w' + g.id); this.goal = null; this.stuckCount = 0; } else { this.stuckCount = (this.stuckCount || 0) + 1; this.setGoal(g.x, g.z, g.tag); if (g.tag === 'cab') this.goal.id = g.id; if (this.stuckCount > 6 && g.tag === 'cab') { this.skip.add(g.id); this.goal = null; this.stuckCount = 0; } } } }
    } else {
      // maqsad yo'q: aylanib yuramiz
      this.wander -= dt; if (this.wander <= 0) { this.wander = 2; this.yaw += this.rng() * 2 - 1; }
      mz = 1;
    }
    // ruhdan qochish: yaqin bo'lsa yugurish
    const gh = sim.ghost; if (gh.visible && Math.hypot(gh.x - me.x, gh.z - me.z) < 9) run = true;
    if (!me.flash) pressed.add('KeyF');
    return { mx, mz, yaw: this.yaw, pitch: 0, run, hold, pressed };
  }

  ghostStep(dt, pressed) {
    const sim = this.sim, me = sim.me;
    this.lookT -= dt;
    const sv = sim.aliveSurvivors();
    if (!sv.length) return { mx: 0, mz: 0, yaw: me.yaw, pitch: 0, run: false, hold: false, pressed };
    let near = sv[0], nd = 1e9; for (const p of sv) { const d = Math.hypot(p.x - me.x, p.z - me.z); if (d < nd) { nd = d; near = p; } }
    this.yaw = Math.atan2(-(near.x - me.x), -(near.z - me.z));
    if (this.lookT <= 0) {
      this.lookT = 2 + this.rng() * 3;
      if (this.rng() < 0.5 && me.inv === (nd < 14 ? true : false)) pressed.add('KeyE');
      else if (this.rng() < 0.3) pressed.add(['Digit1', 'Digit2', 'Digit3', 'Digit4'][Math.floor(this.rng() * 4)]);
      else if (this.rng() < 0.5) pressed.add('KeyR');
    }
    if (nd < 6 && me.inv && this.rng() < 0.05) pressed.add('KeyE');
    if (this.rng() < 0.01) pressed.add('KeyT');
    return { mx: 0, mz: nd > 0.5 ? 1 : 0, yaw: this.yaw, pitch: -0.1, run: nd > 8, hold: false, pressed };
  }
}
