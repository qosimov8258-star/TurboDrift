import { loadTriangles, bounds, rasterSlab, edt } from './raster.mjs';
import sharp from 'sharp';
const [file, gArg, sArg, outPng] = process.argv.slice(2);
const g = +gArg, s = +sArg;
const T = await loadTriangles(file), b = bounds(T);
const span = Math.max(b.x1 - b.x0, b.z1 - b.z0);
const targetCellM = 0.5;                       // 0.5 m cells in final units
const cell = targetCellM / s;
const t0 = Date.now();
const ya = process.env.YA ? +process.env.YA : g + 0.45 / s, yb = process.env.YB ? +process.env.YB : g + 2.2 / s;
const R = rasterSlab(T, b, cell, ya, yb);
console.log('grid', R.W, R.H, 'raster ms', Date.now() - t0);
const E = edt(R.mask, R.W, R.H);
// ridge cells: local maxima of E (3x3), widths in metres
const widths = [];
for (let z = 1; z < R.H - 1; z++) for (let x = 1; x < R.W - 1; x++) {
  const i = z * R.W + x, e = E[i]; if (e < 1) continue;
  let ok = true;
  for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && E[i + dz * R.W + dx] > e) { ok = false; break; }
  if (ok) widths.push(2 * e * targetCellM);
}
widths.sort((a, b) => a - b);
const pct = p => widths[Math.floor(widths.length * p)]?.toFixed(1);
const hist = {}; for (const w of widths) { const k = Math.min(30, Math.floor(w / 1) * 1); hist[k] = (hist[k] || 0) + 1; }
console.log('ridge cells', widths.length, 'p5', pct(0.05), 'p10', pct(0.1), 'p25', pct(0.25), 'p50', pct(0.5), 'p75', pct(0.75), 'p95', pct(0.95));
console.log('hist (m:count)', Object.entries(hist).map(([k, v]) => `${k}:${v}`).join(' '));
if (outPng) {
  const buf = Buffer.alloc(R.W * R.H);
  for (let i = 0; i < buf.length; i++) buf[i] = R.mask[i] ? 30 : Math.min(255, 80 + E[i] * 12);
  await sharp(buf, { raw: { width: R.W, height: R.H, channels: 1 } }).resize(R.W * 3, R.H * 3, { kernel: 'nearest' }).png().toFile(outPng);
}
