import { loadTriangles, bounds } from './raster.mjs';
const [file, g, tol] = process.argv.slice(2);
const T = await loadTriangles(file), G = +g, tl = +tol || 0.06;
let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, n = 0, area = 0;
const hist = {};
for (let i = 0; i < T.length; i += 9) {
  const y = (T[i + 1] + T[i + 4] + T[i + 7]) / 3;
  if (Math.abs(y - G) > tl) continue;
  const ux = T[i + 3] - T[i], uy = T[i + 4] - T[i + 1], uz = T[i + 5] - T[i + 2], vx = T[i + 6] - T[i], vy = T[i + 7] - T[i + 1], vz = T[i + 8] - T[i + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
  if (Math.abs(ny) / l < 0.9) continue;
  const a = l / 2; area += a; n++;
  for (const k of [0, 3, 6]) { x0 = Math.min(x0, T[i + k]); x1 = Math.max(x1, T[i + k]); z0 = Math.min(z0, T[i + k + 2]); z1 = Math.max(z1, T[i + k + 2]); }
  // area-weighted coverage in a 10x10 grid
  const cx = Math.floor(((T[i] + T[i + 3] + T[i + 6]) / 3 + 500) / 40), cz = Math.floor(((T[i + 2] + T[i + 5] + T[i + 8]) / 3 + 500) / 40);
  hist[cx + ',' + cz] = (hist[cx + ',' + cz] || 0) + a;
}
console.log('ground tris', n, 'area', area.toFixed(0), 'extent x', x0.toFixed(1), x1.toFixed(1), 'z', z0.toFixed(1), z1.toFixed(1));
const b = bounds(T); console.log('model bounds x', b.x0.toFixed(1), b.x1.toFixed(1), 'z', b.z0.toFixed(1), b.z1.toFixed(1));
