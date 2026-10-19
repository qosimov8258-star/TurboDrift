// Bakes the Police-mission world: 3 city models are rasterised (what a car can hit between 0.45 m and 2.2 m above the road),
// scaled so every street fits a car, placed in a triangle, joined with connector roads, and turned into one signed-distance
// field (public/mission/world.sdf) + world.json (placement, connectors, bounds).
//   node tools/city/build-world.mjs            -> bake
//   node tools/city/build-world.mjs --png      -> also write a debug picture
import { loadTriangles, bounds, rasterSlab, edt } from './raster.mjs';
import sharp from 'sharp';
import fs from 'fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = ROOT + 'public/mission/';
fs.mkdirSync(OUT, { recursive: true });

const CELL = 0.5;                       // metres per world cell
const SDF_LO = -4, SDF_K = 16;          // byte = (sdf + 4) * 16  -> -4 m .. +11.9 m, 6 cm resolution
const CONN_W = 8;                       // connector road width (2 lanes, ~4 car widths)
const CAR_R = 0.95;                     // collision circle radius used by the game (car is ~1.85 m wide)
const MIN_HALF = 1.6;                   // every street / gap must be at least 2 x this wide (3.2 m = one car with room to spare), narrower gaps are walled up

// s = model units -> metres; g = road level in model units. Streets: A p5 3.6 m * 1.25, B avenue 2 m * 4.5, C 10.6 m * 0.7
const CITIES = [
  { id: 'a', name: 'Markaziy shahar', raw: 'city.glb', glb: 'city_a.glb', s: 1.25, g: -0.101, off: [0, 0] },
  { id: 'b', name: 'Xarobalar', raw: 'mession/police/ruined_city_free_5.glb', glb: 'city_b.glb', s: 4.5, g: 0.04, off: [740, 330] },
  { id: 'c', name: 'Kichik shahar', raw: 'mession/police/simple_city_free.glb', glb: 'city_c.glb', s: 0.7, g: 5.0, off: [820, 40] },
];
const MARGIN = 40;
const PAD = 2;

// ---------------------------------------------------------------- 1. rasterise every city
const info = {};
// parked / standing vehicles of the first city are NOT walls: they are left out of the collision raster and become movable props
const VEHICLE = /^(white sedan|black sedan|blue sedan|van|suv|police|fire truck)/i;
const props = [];
for (const c of CITIES) {
  const L = await loadTriangles(ROOT + c.raw, c.id === 'a' ? n => VEHICLE.test(n) : null);
  const T = c.id === 'a' ? L.T : L, V = c.id === 'a' ? L.V : [];
  let b = bounds(T);
  for (const v of V) { const vb = bounds(v.T); b = { x0: Math.min(b.x0, vb.x0), x1: Math.max(b.x1, vb.x1), y0: Math.min(b.y0, vb.y0), y1: Math.max(b.y1, vb.y1), z0: Math.min(b.z0, vb.z0), z1: Math.max(b.z1, vb.z1) }; }
  const R = rasterSlab(T, b, CELL / c.s, c.g + 0.45 / c.s, c.g + 2.2 / c.s, PAD);
  const wm = (b.x1 - b.x0) * c.s, hm = (b.z1 - b.z0) * c.s;
  info[c.id] = { ...c, b, R, w: wm, h: hm, gx: Math.round(c.off[0] / CELL), gz: Math.round(c.off[1] / CELL) };
  // oriented box of every vehicle (principal axis of its footprint), in world metres
  for (const v of V) {
    const pts = []; for (let i = 0; i < v.T.length; i += 3) pts.push([v.T[i], v.T[i + 1], v.T[i + 2]]);
    let mx = 0, mz = 0, y0 = 1e18, y1 = -1e18; for (const p of pts) { mx += p[0]; mz += p[2]; y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    mx /= pts.length; mz /= pts.length;
    let sxx = 0, szz = 0, sxz = 0; for (const p of pts) { const dx = p[0] - mx, dz = p[2] - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);        // long axis (x, z)
    let a0 = 1e18, a1 = -1e18, b0 = 1e18, b1 = -1e18; for (const p of pts) { const dx = p[0] - mx, dz = p[2] - mz, a = dx * ux + dz * uz, bb = -dx * uz + dz * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, bb); b1 = Math.max(b1, bb); }
    const cxm = mx + ux * (a0 + a1) / 2 - uz * (b0 + b1) / 2, czm = mz + uz * (a0 + a1) / 2 + ux * (b0 + b1) / 2;
    const hl = (a1 - a0) / 2 * c.s, hw = (b1 - b0) / 2 * c.s, h = (y1 - y0) * c.s;
    if (hl < 1.2 || hl > 6 || hw < 0.6 || hw > 2.2) continue;               // not a car-sized object (skip trains, odd bits)
    const wx = c.off[0] + (cxm - b.x0) * c.s, wz = c.off[1] + (czm - b.z0) * c.s;
    props.push({ n: v.name, c: c.id, x: +wx.toFixed(2), z: +wz.toFixed(2), psi: +Math.atan2(ux, uz).toFixed(3), hl: +hl.toFixed(2), hw: +hw.toFixed(2), h: +h.toFixed(2), y: +((y0 - c.g) * c.s).toFixed(2), kind: v.name.replace(/[._]?\d+.*$/, '').trim().toLowerCase() });
  }
  console.log(c.id, 'size', wm.toFixed(0), 'x', hm.toFixed(0), 'm  grid', R.W, R.H, V.length ? `vehicles ${V.length} -> props ${props.length}` : '');
}
let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
for (const c of Object.values(info)) { minX = Math.min(minX, c.off[0]); minZ = Math.min(minZ, c.off[1]); maxX = Math.max(maxX, c.off[0] + c.w); maxZ = Math.max(maxZ, c.off[1] + c.h); }
const WX0 = Math.floor((minX - MARGIN) / CELL), WZ0 = Math.floor((minZ - MARGIN) / CELL);
const WW = Math.ceil((maxX + MARGIN) / CELL) - WX0, WH = Math.ceil((maxZ + MARGIN) / CELL) - WZ0;
console.log('world cells', WW, 'x', WH, '=', (WW * WH / 1e6).toFixed(1), 'M', ' origin(m)', WX0 * CELL, WZ0 * CELL);
const wx = gx => (gx + 0.5) * CELL, wz = gz => (gz + 0.5) * CELL;       // world metres of a global cell
const idx = (gx, gz) => (gz - WZ0) * WW + (gx - WX0);

const solid = new Uint8Array(WW * WH).fill(1);
const inCity = new Int8Array(WW * WH).fill(-1);
CITIES.forEach((cc, ci) => {
  const c = info[cc.id], { R } = c;
  for (let j = PAD; j < R.H - PAD; j++) for (let i = PAD; i < R.W - PAD; i++) {
    const gx = c.gx + i - PAD, gz = c.gz + j - PAD;
    if (gx < WX0 || gx >= WX0 + WW || gz < WZ0 || gz >= WZ0 + WH) continue;
    const k = idx(gx, gz);
    solid[k] = R.mask[j * R.W + i]; inCity[k] = ci;
  }
  c.mx0 = c.gx * CELL; c.mx1 = c.mx0 + (R.W - 2 * PAD) * CELL; c.mz0 = c.gz * CELL; c.mz1 = c.mz0 + (R.H - 2 * PAD) * CELL;
});

function sdfOf(sol) {
  const dToSolid = edt(sol, WW, WH);                       // for free cells: distance to the nearest solid cell
  const free = new Uint8Array(sol.length); for (let i = 0; i < sol.length; i++) free[i] = sol[i] ? 0 : 1;
  const dToFree = edt(free, WW, WH);
  const out = new Float32Array(sol.length);
  for (let i = 0; i < sol.length; i++) out[i] = sol[i] ? -(dToFree[i] - 0.5) * CELL : (dToSolid[i] - 0.5) * CELL;
  return out;
}
let sdf = sdfOf(solid);
const sample = (S, x, z) => {                              // nearest-cell lookup in metres
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  if (gx < WX0 || gx >= WX0 + WW || gz < WZ0 || gz >= WZ0 + WH) return -9;
  return S[idx(gx, gz)];
};

async function writePng(file) {
  const k = 2, W2 = (WW / k) | 0, H2 = (WH / k) | 0, buf = Buffer.alloc(W2 * H2 * 3);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const v = sdf[(y * k) * WW + x * k], o = (y * W2 + x) * 3;
    if (v < 0) { buf[o] = 20; buf[o + 1] = 22; buf[o + 2] = 28; }
    else { const g = v >= 3.2 ? 200 : v >= 1.4 ? 130 : 70; buf[o] = g; buf[o + 1] = g; buf[o + 2] = v >= 1.4 ? g : 255; }
  }
  await sharp(buf, { raw: { width: W2, height: H2, channels: 3 } }).png().toFile(file);
}
if (process.env.STAGE1) { await writePng(process.env.STAGE1); process.exit(0); }

// ---------------------------------------------------------------- 2. connector roads between the cities
/** find a spot on city `c`'s `side` edge (E/W/N/S) whose straight way inwards is open, closest to `target` along that edge */
function findEntry(c, side, target, taken = []) {
  const horiz = side === 'E' || side === 'W';
  const edge = side === 'E' ? c.mx1 : side === 'W' ? c.mx0 : side === 'S' ? c.mz1 : c.mz0;
  const inward = side === 'E' || side === 'S' ? -1 : 1;
  const a0 = horiz ? c.mz0 : c.mx0, a1 = horiz ? c.mz1 : c.mx1;
  let best = null;
  for (let a = a0 + 10; a <= a1 - 10; a += 1) {
    if (taken.some(t => Math.abs(t - a) < 70)) continue;
    let ok = true, minClear = 99;
    for (let d = 12; d <= 45 && ok; d += 1) {             // the first 12 m (perimeter fence / lamp posts) are ignored: the road punches through them
      const x = horiz ? edge + inward * d : a, z = horiz ? a : edge + inward * d;
      const v = sample(sdf, x, z); minClear = Math.min(minClear, v);
      if (v < CONN_W / 2 - 0.2) ok = false;
    }
    if (!ok) continue;
    const score = Math.abs(a - target) - minClear * 0.5;
    if (!best || score < best.score) best = { a, score, side, edge, inward, horiz };
  }
  if (!best) {
    const rep = [];
    for (let a = a0 + 10; a <= a1 - 10; a += 20) { let mc = 99; for (let d = 12; d <= 45; d++) mc = Math.min(mc, sample(sdf, horiz ? edge + inward * d : a, horiz ? a : edge + inward * d)); rep.push(a.toFixed(0) + ':' + mc.toFixed(1)); }
    throw new Error(`no entry on ${c.id} ${side}; clearances ${rep.join(' ')}`);
  }
  const p = best.horiz ? [best.edge, best.a] : [best.a, best.edge];
  const n = best.horiz ? [-best.inward, 0] : [0, -best.inward];   // outward normal
  return { p, n, a: best.a };
}
const C = Object.fromEntries(CITIES.map(c => [c.id, info[c.id]]));
const mid = c => [(c.mx0 + c.mx1) / 2, (c.mz0 + c.mz1) / 2];
const takenE = [];
const eAC = findEntry(C.a, 'E', mid(C.c)[1]); takenE.push(eAC.a);
const wAC = findEntry(C.c, 'W', mid(C.a)[1]);
const eAB = findEntry(C.a, 'E', mid(C.b)[1] + 40, takenE);
const wAB = findEntry(C.b, 'W', mid(C.a)[1]);
const sCB = findEntry(C.c, 'S', mid(C.b)[0]);
const nCB = findEntry(C.b, 'N', mid(C.c)[0]);
const LINKS = [['a', 'c', eAC, wAC], ['a', 'b', eAB, wAB], ['c', 'b', sCB, nCB]];

function bezier(p0, n0, p1, n1) {
  const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), L = d * 0.38;
  const a = [p0[0] + n0[0] * L, p0[1] + n0[1] * L], b = [p1[0] + n1[0] * L, p1[1] + n1[1] * L];
  const pts = [], N = Math.max(8, Math.ceil(d / 6));
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    pts.push([u * u * u * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * p1[1]]);
  }
  return pts;
}
const connectors = LINKS.map(([A, B, ea, eb]) => {
  // start / end a little inside each city so the road runs out of the open street
  const s0 = [ea.p[0] - ea.n[0] * 10, ea.p[1] - ea.n[1] * 10], s1 = [eb.p[0] - eb.n[0] * 10, eb.p[1] - eb.n[1] * 10];
  const pts = bezier(s0, ea.n, s1, eb.n);
  let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return { from: A, to: B, width: CONN_W, length: Math.round(len), pts: pts.map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]) };
});
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
for (const cn of connectors) {
  const hw = cn.width / 2;
  for (let i = 1; i < cn.pts.length; i++) {
    const [ax, az] = cn.pts[i - 1], [bx, bz] = cn.pts[i];
    const x0 = Math.floor((Math.min(ax, bx) - hw - 1) / CELL), x1 = Math.ceil((Math.max(ax, bx) + hw + 1) / CELL), z0 = Math.floor((Math.min(az, bz) - hw - 1) / CELL), z1 = Math.ceil((Math.max(az, bz) + hw + 1) / CELL);
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      if (gx < WX0 || gx >= WX0 + WW || gz < WZ0 || gz >= WZ0 + WH) continue;
      if (distSeg(wx(gx), wz(gz), ax, az, bx, bz) <= hw) solid[idx(gx, gz)] = 0;
    }
  }
}

// ---------------------------------------------------------------- 3. only keep what a car can actually reach
sdf = sdfOf(solid);
const reach = new Uint8Array(WW * WH);
{ // largest 4-connected region of cells a car's centre may occupy = the drivable world
  const label = new Int32Array(WW * WH); let nl = 0, bestL = 0, bestN = 0;
  for (let s0 = 0; s0 < label.length; s0++) {
    if (label[s0] || sdf[s0] < MIN_HALF) continue;
    const L = ++nl, stack = [s0]; label[s0] = L; let n = 0;
    while (stack.length) {
      const k = stack.pop(); n++;
      const x = k % WW, z = (k / WW) | 0;
      if (x > 0 && !label[k - 1] && sdf[k - 1] >= MIN_HALF) { label[k - 1] = L; stack.push(k - 1); }
      if (x < WW - 1 && !label[k + 1] && sdf[k + 1] >= MIN_HALF) { label[k + 1] = L; stack.push(k + 1); }
      if (z > 0 && !label[k - WW] && sdf[k - WW] >= MIN_HALF) { label[k - WW] = L; stack.push(k - WW); }
      if (z < WH - 1 && !label[k + WW] && sdf[k + WW] >= MIN_HALF) { label[k + WW] = L; stack.push(k + WW); }
    }
    if (n > bestN) { bestN = n; bestL = L; }
  }
  for (let i = 0; i < label.length; i++) if (label[i] === bestL) reach[i] = 1;
  console.log('regions', nl, 'largest', bestN, 'cells');
}
let freeCells = 0, reached = 0;
for (let i = 0; i < solid.length; i++) if (!solid[i]) { freeCells++; if (reach[i]) reached++; }
// dilate the drivable core back out to the walls; everything else that is free becomes wall (too-narrow gaps, closed pockets, ...)
const keep = new Uint8Array(WW * WH);
{ const d = edt(reach, WW, WH); for (let i = 0; i < keep.length; i++) keep[i] = d[i] <= (MIN_HALF + 0.35) / CELL ? 1 : 0; }
let filled = 0;
for (let i = 0; i < solid.length; i++) if (!solid[i] && !keep[i]) { solid[i] = 1; filled++; }
console.log('free cells', freeCells, 'reachable', reached, `(${(100 * reached / freeCells).toFixed(1)}%)`, 'filled pockets', filled);
sdf = sdfOf(solid);

// ---------------------------------------------------------------- 4. write
const bytes = new Uint8Array(WW * WH);
for (let i = 0; i < bytes.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round((sdf[i] - SDF_LO) * SDF_K)));
fs.writeFileSync(OUT + 'world.sdf', bytes);
const meta = {
  cell: CELL, w: WW, h: WH, x0: WX0 * CELL, z0: WZ0 * CELL, sdfLo: SDF_LO, sdfK: SDF_K, carR: CAR_R,
  cities: CITIES.map(c => { const i = info[c.id]; return { id: c.id, name: c.name, glb: '/models/' + c.glb, scale: c.s, ground: c.g, minX: i.b.x0, minZ: i.b.z0, x0: i.mx0, z0: i.mz0, x1: i.mx1, z1: i.mz1 }; }),
  connectors, props,
};
fs.writeFileSync(OUT + 'world.json', JSON.stringify(meta));
console.log('wrote', (bytes.length / 1e6).toFixed(1) + 'MB sdf,', connectors.map(c => `${c.from}-${c.to} ${c.length}m`).join(' '));

if (process.argv.includes('--png')) await writePng(process.env.PNG || '/tmp/world.png');
