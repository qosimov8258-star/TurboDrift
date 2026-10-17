import { Track, WALL_D } from '../public/js/track.js';
import { TRACKS } from '../public/js/trackdata.js';
let bad = 0;
for (const def of TRACKS) {
  const t = new Track(def), N = t.N, st = t.step;
  let kmax = 0, kAt = 0; for (let i = 0; i < N; i++) { const k = Math.abs(t.K[i]); if (k > kmax) { kmax = k; kAt = i; } }
  const minR = 1 / kmax;
  // clearance between far-apart parts of the track (walls must never overlap)
  let clear = 1e9, ci = 0;
  const skip = Math.round(220 / st);
  for (let i = 0; i < N; i += 2) for (let j = i + skip; j < N - skip + i && j < N; j += 2) {
    const d = Math.hypot(t.P[i].x - t.P[j].x, t.P[i].z - t.P[j].z); if (d < clear) { clear = d; ci = i; }
  }
  // sharpest change of heading between neighbouring samples (kinks)
  let kink = 0; for (let i = 0; i < N; i++) { const a = t.T[i], b = t.T[(i + 1) % N]; kink = Math.max(kink, Math.acos(Math.min(1, a.x * b.x + a.z * b.z)) * 180 / Math.PI); }
  // signed area -> direction + straightness
  let straight = 0; for (let i = 0; i < N; i++) if (Math.abs(t.K[i]) < 0.0012) straight++;
  const startK = Math.abs(t.K[0]) + Math.abs(t.K[N - 25]) + Math.abs(t.K[N - 12]);
  const warn = [];
  if (minR < WALL_D + 0.7 + 14) warn.push('minR small');
  if (clear < 2 * (WALL_D + 0.7) + 25) warn.push('overlap');
  if (kink > 4.5) warn.push('kink');
  if (startK > 0.02 && def.group !== 'arena') warn.push('start in corner');
  if (warn.length) bad++;
  console.log(def.id.padEnd(8), 'len', (t.length / 1000).toFixed(2) + 'km', 'N', N, 'minR', minR.toFixed(0) + 'm@' + kAt, 'clear', clear.toFixed(0) + 'm@' + ci, 'kink', kink.toFixed(2) + '°', 'straight', (100 * straight / N).toFixed(0) + '%', warn.length ? '⚠ ' + warn.join(',') : 'ok');
}
console.log(bad ? `${bad} track(s) with warnings` : 'ALL TRACKS OK');
