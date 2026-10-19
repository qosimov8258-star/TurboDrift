// To'qnashuv (aylana vs AABB), ko'rinish chizig'i va yordamchi geometriya. Sof JS.
import { CELL } from './levels.js';

export class Collision {
  constructor(map) {
    this.map = map;
    this.W = map.W; this.H = map.H;
    this.cells = new Array(this.W * this.H);
    this.walls = [];          // faqat devorlar (ko'rinish chizig'i uchun)
    this.dynamic = new Map(); // id -> {x0,z0,x1,z1,on}
    for (const w of map.walls) w.wall = true;
    for (const w of map.colliders) this._add(w);
    for (const w of map.walls) this.walls.push(w);
    // tashqi chegara: katta kenglikdagi "devorlar" (xaritadan chiqmaslik) — chiqish eshigidan tashqari
  }
  _add(c) {
    const x0 = Math.max(0, Math.floor((c.x0 - 0.01) / CELL)), x1 = Math.min(this.W - 1, Math.floor((c.x1 + 0.01) / CELL));
    const z0 = Math.max(0, Math.floor((c.z0 - 0.01) / CELL)), z1 = Math.min(this.H - 1, Math.floor((c.z1 + 0.01) / CELL));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const i = z * this.W + x; (this.cells[i] || (this.cells[i] = [])).push(c); }
  }
  setDynamic(id, box) { this.dynamic.set(id, box); }
  // aylana (x,z,r) ni to'siqlardan itarib chiqaradi. natija {x,z,hit}
  resolve(x, z, r) {
    let hit = false;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      const cx0 = Math.max(0, Math.floor((x - r) / CELL)), cx1 = Math.min(this.W - 1, Math.floor((x + r) / CELL));
      const cz0 = Math.max(0, Math.floor((z - r) / CELL)), cz1 = Math.min(this.H - 1, Math.floor((z + r) / CELL));
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells[cz * this.W + cx]; if (!list) continue;
        for (const c of list) { const p = push(c, x, z, r); if (p) { x = p[0]; z = p[1]; moved = true; hit = true; } }
      }
      for (const c of this.dynamic.values()) if (c.on) { const p = push(c, x, z, r); if (p) { x = p[0]; z = p[1]; moved = true; hit = true; } }
      if (!moved) break;
    }
    return { x, z, hit };
  }
  // devor orqali ko'rinishmi? (past buyumlar to'sqinlik qilmaydi)
  los(x0, z0, x1, z1, withDoors = true) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 1e-6) return true;
    const steps = Math.ceil(len / (CELL * 0.5));
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, px = x0 + dx * t, pz = z0 + dz * t;
      const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
        const x = cx + ox, z = cz + oz; if (x < 0 || z < 0 || x >= this.W || z >= this.H) continue;
        const list = this.cells[z * this.W + x]; if (!list) continue;
        for (const c of list) { if (!c.wall || seen.has(c)) continue; seen.add(c); if (segBox(x0, z0, x1, z1, c)) return false; }
      }
    }
    if (withDoors) for (const c of this.dynamic.values()) if (c.on && c.blocksSight && segBox(x0, z0, x1, z1, c)) return false;
    return true;
  }
}
function push(c, x, z, r) {
  const nx = Math.max(c.x0, Math.min(x, c.x1)), nz = Math.max(c.z0, Math.min(z, c.z1));
  let dx = x - nx, dz = z - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (r - d) / d; return [x + dx * k, z + dz * k]; }
  // markaz ichida: eng yaqin tomonga chiqaramiz
  const l = x - c.x0, rr = c.x1 - x, t = z - c.z0, b = c.z1 - z, m = Math.min(l, rr, t, b);
  if (m === l) return [c.x0 - r, z]; if (m === rr) return [c.x1 + r, z]; if (m === t) return [x, c.z0 - r]; return [x, c.z1 + r];
}
export function segBox(x0, z0, x1, z1, c) {
  let tmin = 0, tmax = 1;
  const dx = x1 - x0, dz = z1 - z0;
  for (const [p, d, lo, hi] of [[x0, dx, c.x0, c.x1], [z0, dz, c.z0, c.z1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
    else { let a = (lo - p) / d, b = (hi - p) / d; if (a > b) [a, b] = [b, a]; tmin = Math.max(tmin, a); tmax = Math.min(tmax, b); if (tmin > tmax) return false; }
  }
  return true;
}
export function angDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
