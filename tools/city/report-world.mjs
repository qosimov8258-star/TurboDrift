// Prints how wide the streets of each city are in the baked world (centre-line widths in metres, car = 1.85 m wide).
import fs from 'fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const meta = JSON.parse(fs.readFileSync(ROOT + 'public/mission/world.json')), sdf = fs.readFileSync(ROOT + 'public/mission/world.sdf');
const W = meta.w, H = meta.h, d = (x, z) => sdf[z * W + x] / meta.sdfK + meta.sdfLo;
const cityOf = (x, z) => meta.cities.findIndex(c => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1);
const widths = meta.cities.map(() => []), conn = [];
for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
  const v = d(x, z); if (v < 1.0) continue;
  let ridge = true;
  for (let dz = -1; dz <= 1 && ridge; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && d(x + dx, z + dz) > v) { ridge = false; break; }
  if (!ridge) continue;
  const wx = meta.x0 + (x + 0.5) * meta.cell, wz = meta.z0 + (z + 0.5) * meta.cell, ci = cityOf(wx, wz);
  (ci >= 0 ? widths[ci] : conn).push(2 * v);
}
const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(1) : '-';
const row = (name, a) => { a.sort((x, y) => x - y); console.log(name.padEnd(18), 'min', pct(a, 0).padStart(5), ' p10', pct(a, .1).padStart(5), ' p50', pct(a, .5).padStart(5), ' p90', pct(a, .9).padStart(5), ' (m, street width at its centre line)'); };
meta.cities.forEach((c, i) => row(c.name + ` x${c.scale}`, widths[i]));
row('connector roads', conn);
console.log('car width 1.85 m, tight lane limit baked in: 3.2 m');
