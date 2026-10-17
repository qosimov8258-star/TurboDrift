import * as THREE from 'three';
import sharp from 'sharp';
import { TRACKS } from '../public/js/trackdata.js';
const CONTROL = TRACKS[0].points;
const pts = CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z));
const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
const L = curve.getLength();
const N = Math.round(L / 3);
const P = curve.getSpacedPoints(N).slice(0, N);
let minR = 1e9, minRi = 0;
for (let i = 0; i < N; i++) {
  const a = P[(i - 4 + N) % N], b = P[i], c = P[(i + 4) % N];
  const ab = b.clone().sub(a), bc = c.clone().sub(b);
  const ang = Math.abs(Math.atan2(ab.x * bc.z - ab.z * bc.x, ab.dot(bc)));
  const R = (ab.length() + bc.length()) / 2 / Math.max(ang, 1e-6);
  if (R < minR) { minR = R; minRi = i; }
}
let minD = 1e9, mi = 0, mj = 0;
for (let i = 0; i < N; i += 2) for (let j = i + 1; j < N; j += 2) {
  const arc = Math.min(j - i, N - (j - i)) * 3;
  if (arc < 200) continue;
  const d = P[i].distanceTo(P[j]);
  if (d < minD) { minD = d; mi = i; mj = j; }
}
console.log('length', L.toFixed(0), 'minRadius', minR.toFixed(1), 'at', minRi, 'minGap', minD.toFixed(0), mi, mj);
const xs = P.map(p => p.x), zs = P.map(p => p.z);
const x0 = Math.min(...xs) - 60, x1 = Math.max(...xs) + 60, z0 = Math.min(...zs) - 60, z1 = Math.max(...zs) + 60;
const sc = 900 / Math.max(x1 - x0, z1 - z0);
const W = Math.ceil((x1 - x0) * sc), H = Math.ceil((z1 - z0) * sc);
const tx = x => (x - x0) * sc, tz = z => H - (z - z0) * sc;
const path = P.map((p, i) => (i ? 'L' : 'M') + tx(p.x).toFixed(1) + ',' + tz(p.z).toFixed(1)).join('') + 'Z';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#223"/><path d="${path}" stroke="#ddd" stroke-width="${18 * sc}" fill="none" stroke-linejoin="round"/><circle cx="${tx(P[0].x)}" cy="${tz(P[0].z)}" r="6" fill="red"/><circle cx="${tx(P[minRi].x)}" cy="${tz(P[minRi].z)}" r="6" fill="orange"/></svg>`;
await sharp(Buffer.from(svg)).png().toFile('/private/tmp/claude-501/-Users-ismoil-Desktop-game/d6b86078-6f3f-4632-b4d0-25766dfeb358/scratchpad/track.png');
