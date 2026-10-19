import { loadTriangles, bounds } from './raster.mjs';
const T = await loadTriangles(process.argv[2]);
const H = {};
let vert = 0;
for (let i = 0; i < T.length; i += 9) {
  const ux = T[i + 3] - T[i], uy = T[i + 4] - T[i + 1], uz = T[i + 5] - T[i + 2], vx = T[i + 6] - T[i], vy = T[i + 7] - T[i + 1], vz = T[i + 8] - T[i + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
  if (Math.abs(ny) / l < 0.3) { vert++; const lo = Math.min(T[i + 1], T[i + 4], T[i + 7]), hi = Math.max(T[i + 1], T[i + 4], T[i + 7]); const k = Math.floor(lo / 2) * 2 + '-' + Math.floor(hi / 2) * 2; H[k] = (H[k] || 0) + 1; }
}
console.log('vertical tris', vert, Object.entries(H).sort((a, b) => b[1] - a[1]).slice(0, 15).map(e => e.join(':')).join('  '));
