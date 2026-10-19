// Shared helpers: load a GLB with gltf-transform and rasterise the "car-collidable slab" of a city into a top-down solid mask.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

/** every triangle of the scene in world space (model units): Float32Array [x0,y0,z0,x1,y1,z1,x2,y2,z2,...].
 *  With `isVehicle(name)` the subtrees of matching nodes are left out and returned separately: { T, V:[{name, T}] } */
export async function loadTriangles(file, isVehicle = null) {
  const doc = await io.read(file);
  const out = [], vehicles = [];
  const scene = doc.getRoot().listScenes()[0];
  const emit = (n, dst) => {
    const mesh = n.getMesh();
    if (mesh) {
      const m = n.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION'); if (!pos) continue;
        const idx = prim.getIndices(), cnt = idx ? idx.getCount() : pos.getCount();
        const P = new Float32Array(pos.getCount() * 3), tmp = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, tmp);
          P[i * 3] = m[0] * tmp[0] + m[4] * tmp[1] + m[8] * tmp[2] + m[12];
          P[i * 3 + 1] = m[1] * tmp[0] + m[5] * tmp[1] + m[9] * tmp[2] + m[13];
          P[i * 3 + 2] = m[2] * tmp[0] + m[6] * tmp[1] + m[10] * tmp[2] + m[14];
        }
        for (let t = 0; t + 2 < cnt; t += 3) {
          const a = idx ? idx.getScalar(t) : t, b = idx ? idx.getScalar(t + 1) : t + 1, c = idx ? idx.getScalar(t + 2) : t + 2;
          dst.push(P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2], P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
        }
      }
    }
  };
  const walkAll = (n, dst) => { emit(n, dst); n.listChildren().forEach(c => walkAll(c, dst)); };
  const walk = n => {
    if (isVehicle && isVehicle(n.getName())) { const dst = []; walkAll(n, dst); vehicles.push({ name: n.getName(), T: Float32Array.from(dst) }); return; }
    emit(n, out);
    n.listChildren().forEach(walk);
  };
  scene.listChildren().forEach(walk);
  return isVehicle ? { T: Float32Array.from(out), V: vehicles } : Float32Array.from(out);
}

export function bounds(T) {
  const b = { x0: 1e18, x1: -1e18, y0: 1e18, y1: -1e18, z0: 1e18, z1: -1e18 };
  for (let i = 0; i < T.length; i += 3) {
    b.x0 = Math.min(b.x0, T[i]); b.x1 = Math.max(b.x1, T[i]);
    b.y0 = Math.min(b.y0, T[i + 1]); b.y1 = Math.max(b.y1, T[i + 1]);
    b.z0 = Math.min(b.z0, T[i + 2]); b.z1 = Math.max(b.z1, T[i + 2]);
  }
  return b;
}

/** ground level = the most common height of big, upward facing, low triangles (area weighted, 5 cm bins) */
export function findGround(T, bnd, binSize) {
  const lo = bnd.y0, H = new Map();
  for (let i = 0; i < T.length; i += 9) {
    const ux = T[i + 3] - T[i], uy = T[i + 4] - T[i + 1], uz = T[i + 5] - T[i + 2], vx = T[i + 6] - T[i], vy = T[i + 7] - T[i + 1], vz = T[i + 8] - T[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
    if (l < 1e-12 || Math.abs(ny) / l < 0.95) continue;
    const y = (T[i + 1] + T[i + 4] + T[i + 7]) / 3, k = Math.round((y - lo) / binSize);
    H.set(k, (H.get(k) || 0) + l / 2);
  }
  const best = [...H.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, a]) => ({ y: lo + k * binSize, area: a }));
  return best;
}

/** clip triangle to y in [ya,yb]; returns polygon (array of [x,z]) or null */
function clipSlab(T, i, ya, yb) {
  let poly = [[T[i], T[i + 1], T[i + 2]], [T[i + 3], T[i + 4], T[i + 5]], [T[i + 6], T[i + 7], T[i + 8]]];
  for (const [axis, val, keepAbove] of [[1, ya, true], [1, yb, false]]) {
    const next = [];
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      const pin = keepAbove ? p[axis] >= val : p[axis] <= val, qin = keepAbove ? q[axis] >= val : q[axis] <= val;
      if (pin) next.push(p);
      if (pin !== qin) { const t = (val - p[axis]) / (q[axis] - p[axis]); next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
    }
    poly = next; if (!poly.length) return null;
  }
  return poly.map(p => [p[0], p[2]]);
}

function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 > 1e-18 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** conservative rasterisation of the part of every triangle between y=ya..yb. mask[z*W+x] = 1 solid. */
export function rasterSlab(T, bnd, cell, ya, yb, pad = 2) {
  const W = Math.ceil((bnd.x1 - bnd.x0) / cell) + pad * 2, H = Math.ceil((bnd.z1 - bnd.z0) / cell) + pad * 2;
  const ox = bnd.x0 - pad * cell, oz = bnd.z0 - pad * cell;
  const mask = new Uint8Array(W * H);
  const tol = cell * 0.72;
  for (let i = 0; i < T.length; i += 9) {
    const ymin = Math.min(T[i + 1], T[i + 4], T[i + 7]), ymax = Math.max(T[i + 1], T[i + 4], T[i + 7]);
    if (ymax < ya || ymin > yb) continue;
    const poly = clipSlab(T, i, ya, yb); if (!poly) continue;
    let x0 = 1e18, x1 = -1e18, z0 = 1e18, z1 = -1e18;
    for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const cx0 = Math.max(0, Math.floor((x0 - tol - ox) / cell)), cx1 = Math.min(W - 1, Math.floor((x1 + tol - ox) / cell));
    const cz0 = Math.max(0, Math.floor((z0 - tol - oz) / cell)), cz1 = Math.min(H - 1, Math.floor((z1 + tol - oz) / cell));
    const n = poly.length;
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      if (mask[cz * W + cx]) continue;
      const px = ox + (cx + 0.5) * cell, pz = oz + (cz + 0.5) * cell;
      let hit = false;
      for (let k = 0; k < n && !hit; k++) { const a = poly[k], b = poly[(k + 1) % n]; if (distSeg(px, pz, a[0], a[1], b[0], b[1]) <= tol) hit = true; }
      if (!hit && n >= 3) {          // inside test (convex polygon, any winding)
        let pos = 0, neg = 0;
        for (let k = 0; k < n; k++) { const a = poly[k], b = poly[(k + 1) % n]; const c = (b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0]); if (c > 0) pos++; else if (c < 0) neg++; }
        if (pos === 0 || neg === 0) hit = true;
      }
      if (hit) mask[cz * W + cx] = 1;
    }
  }
  return { mask, W, H, ox, oz, cell };
}

/** exact euclidean distance (in cells) from every cell to the nearest cell where `on[i]` is 1 (Felzenszwalb) */
export function edt(on, W, H) {
  const INF = 1e12, f = new Float64Array(Math.max(W, H)), d = new Float64Array(Math.max(W, H)), v = new Int32Array(Math.max(W, H)), z = new Float64Array(Math.max(W, H) + 1);
  const g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = on[i] ? 0 : INF;
  const pass = (len, get, set) => {
    for (let i = 0; i < len; i++) f[i] = get(i);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k] && k > 0) k--; else break; }
      if (s <= z[k] && k === 0) { v[0] = q; z[0] = -INF; z[1] = INF; continue; }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; set(q, (q - p) * (q - p) + f[p]); }
  };
  for (let x = 0; x < W; x++) pass(H, i => g[i * W + x], (i, val) => { g[i * W + x] = val; });
  for (let y = 0; y < H; y++) pass(W, i => g[y * W + i], (i, val) => { g[y * W + i] = val; });
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = Math.sqrt(g[i]);
  return out;
}
