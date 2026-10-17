import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Finds the four wheels of an arbitrary car model by geometry (not by node names),
// pulling wheel parts out of meshes that fuse several wheels / the body together.
// Wheels are wrapped in steer + spin pivots and the model is normalised:
// origin = centre between the axles on the ground, nose towards +Z, tyre diameter = TIRE_D.
export const TIRE_D = 0.68;

// ---- bake skinned meshes into plain meshes (rest pose) ----------------------
function bakeSkinned(model) {
  model.updateMatrixWorld(true);
  const list = [];
  model.traverse(o => { if (o.isSkinnedMesh) list.push(o); });
  const v = new THREE.Vector3();
  for (const sm of list) {
    sm.skeleton.update();
    const geo = sm.geometry.clone();
    const pos = geo.attributes.position;
    const np = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
    for (let i = 0; i < pos.count; i++) { sm.getVertexPosition(i, v); np.setXYZ(i, v.x, v.y, v.z); }
    geo.setAttribute('position', np);
    geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight');
    const m = new THREE.Mesh(geo, sm.material);
    m.name = sm.name;
    m.position.copy(sm.position); m.quaternion.copy(sm.quaternion); m.scale.copy(sm.scale);
    sm.parent.add(m);
    sm.parent.remove(sm);
  }
}

// ---- yaw alignment (principal axis of the footprint -> Z) -------------------
function alignYaw(model) {
  model.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const pts = [];
  let mx = 0, mz = 0;
  model.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      pts.push(v.x, v.z); mx += v.x; mz += v.z;
    }
  });
  const n = pts.length / 2;
  mx /= n; mz /= n;
  let sxx = 0, szz = 0, sxz = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - mx, dz = pts[i + 1] - mz;
    sxx += dx * dx; szz += dz * dz; sxz += dx * dz;
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  model.rotation.y = ang - Math.PI / 2;
  model.updateMatrixWorld(true);
}

// ---- connected components of a mesh (by welded position) --------------------
function components(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index ? geo.index.array : null;
  const n = pos.count;
  const triCount = (idx ? idx.length : n) / 3;
  const tv = (t, k) => (idx ? idx[t * 3 + k] : t * 3 + k);
  const w = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    w[i * 3] = v.x; w[i * 3 + 1] = v.y; w[i * 3 + 2] = v.z;
    lo = Math.min(lo, v.x, v.y, v.z); hi = Math.max(hi, v.x, v.y, v.z);
  }
  const eps = Math.max((hi - lo) * 1e-5, 1e-6);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.round(w[i * 3] / eps) + ',' + Math.round(w[i * 3 + 1] / eps) + ',' + Math.round(w[i * 3 + 2] / eps);
    const j = seen.get(key);
    if (j === undefined) seen.set(key, i); else union(i, j);
  }
  for (let t = 0; t < triCount; t++) { union(tv(t, 0), tv(t, 1)); union(tv(t, 1), tv(t, 2)); }
  const comps = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(tv(t, 0));
    let c = comps.get(r);
    if (!c) {
      c = { tris: [], box: new THREE.Box3() };
      comps.set(r, c);
    }
    c.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const i = tv(t, k);
      v.set(w[i * 3], w[i * 3 + 1], w[i * 3 + 2]);
      c.box.expandByPoint(v);
    }
  }
  const list = [...comps.values()];
  for (const c of list) { c.center = c.box.getCenter(new THREE.Vector3()); c.size = c.box.getSize(new THREE.Vector3()); }
  return { list, triCount };
}

function buildMesh(src, triList) {
  const geo = src.geometry;
  const idx = geo.index ? geo.index.array : null;
  const tv = (t, k) => (idx ? idx[t * 3 + k] : t * 3 + k);
  const remap = new Map();
  const order = [];
  const ni = new Array(triList.length * 3);
  for (let q = 0; q < triList.length; q++) {
    for (let k = 0; k < 3; k++) {
      const i = tv(triList[q], k);
      let nidx = remap.get(i);
      if (nidx === undefined) { nidx = order.length; remap.set(i, nidx); order.push(i); }
      ni[q * 3 + k] = nidx;
    }
  }
  const g = new THREE.BufferGeometry();
  for (const name in geo.attributes) {
    const a = geo.attributes[name];
    const na = new THREE.BufferAttribute(new a.array.constructor(order.length * a.itemSize), a.itemSize, a.normalized);
    for (let k = 0; k < order.length; k++) {
      const o = order[k];
      na.setX(k, a.getX(o));
      if (a.itemSize > 1) na.setY(k, a.getY(o));
      if (a.itemSize > 2) na.setZ(k, a.getZ(o));
      if (a.itemSize > 3) na.setW(k, a.getW(o));
    }
    g.setAttribute(name, na);
  }
  g.setIndex(ni);
  const m = new THREE.Mesh(g, src.material);
  m.name = src.name;
  m.position.copy(src.position); m.quaternion.copy(src.quaternion); m.scale.copy(src.scale);
  return m;
}

export function prepareCar(model, cfg = {}) {
  const holder = new THREE.Group();   // identity: wheel pivots live here in world coordinates
  holder.add(model);
  bakeSkinned(model);
  alignYaw(model);
  holder.updateMatrixWorld(true);

  const all = new THREE.Box3();
  const meshes = [];
  model.traverse(o => {
    if (o.isMesh) {
      const b = new THREE.Box3().setFromObject(o, true);
      if (b.isEmpty()) return;
      all.union(b);
      meshes.push({ o, b });
    }
  });
  const total = all.getSize(new THREE.Vector3());
  const unit = total.z / 4.5;               // model units per "metre"
  const ground = all.min.y;
  const midZ = (all.min.z + all.max.z) / 2;

  // pass 1 – components of every mesh that reaches down to the wheel zone
  const low = meshes.filter(m => m.b.min.y - ground < 0.4 * unit);
  for (const m of low) m.comp = components(m.o);

  const isTire = c => {
    const w = c.size.x / unit, h = c.size.y / unit, d = c.size.z / unit, r = h / d;
    return w > 0.15 && w < 0.5 && h > 0.5 && h < 0.95 && r > 0.85 && r < 1.18 &&
      Math.abs(c.center.x) / unit > 0.55 && (c.center.y - ground) / unit < 0.6;
  };
  const corners = {};
  for (const m of low) for (const c of m.comp.list) {
    if (!isTire(c)) continue;
    const k = (c.center.x > 0 ? 'R' : 'L') + (c.center.z > midZ ? 'B' : 'F');
    const cur = corners[k];
    if (!cur || c.size.y * c.size.z > cur.size.y * cur.size.z) corners[k] = c;
  }
  const keys = Object.keys(corners);
  if (keys.length < 4) {
    console.warn('wheel detection incomplete', keys);
    return { ok: false, root: finish(holder, 1, new THREE.Vector3(), cfg), wheels: [], found: keys, total };
  }

  // pivots
  const wheels = keys.map(k => {
    const t = corners[k];
    const steer = new THREE.Object3D(), spin = new THREE.Object3D();
    steer.name = 'steer_' + k; spin.name = 'spin_' + k;
    steer.position.copy(t.center);
    steer.add(spin);
    holder.add(steer);
    return { key: k, steer, spin, front: k[1] === 'F', left: k[0] === 'L', radius: t.size.y / 2, center: t.center.clone(), size: t.size, n: 0 };
  });
  holder.updateMatrixWorld(true);

  // pass 2 – assign every component sitting inside a wheel to that wheel
  const owner = c => {
    for (const w of wheels) {
      if (Math.abs(c.center.y - w.center.y) < w.radius * 0.45 && Math.abs(c.center.z - w.center.z) < w.radius * 0.45 &&
        Math.abs(c.center.x - w.center.x) < 0.4 * unit &&
        c.size.y <= w.size.y * 1.1 && c.size.z <= w.size.z * 1.1 && c.size.x <= 0.6 * unit &&
        Math.sign(c.center.x) === Math.sign(w.center.x)) return w;
    }
    return null;
  };
  for (const m of low) {
    const per = new Map();
    const rest = [];
    for (const c of m.comp.list) {
      const w = owner(c);
      if (w) { if (!per.has(w)) per.set(w, []); per.get(w).push(...c.tris); } else rest.push(...c.tris);
    }
    if (!per.size) continue;
    const parent = m.o.parent;
    for (const [w, tris] of per) {
      let part;
      if (!rest.length && per.size === 1) part = m.o;
      else { part = buildMesh(m.o, tris); parent.add(part); }
      parent.updateMatrixWorld(true);
      w.spin.attach(part);
      w.n++;
    }
    if (rest.length) {
      const remainder = buildMesh(m.o, rest);
      parent.add(remainder);
      parent.remove(m.o);
      m.o.geometry.dispose();
    } else if (per.size > 1) {
      parent.remove(m.o);
    }
  }
  holder.updateMatrixWorld(true);
  simplify(holder, wheels);

  const tireD = wheels.reduce((a, w) => a + w.radius * 2, 0) / 4;
  const s = TIRE_D / tireD;
  const axle = new THREE.Vector3();
  wheels.forEach(w => axle.add(w.center));
  axle.multiplyScalar(1 / 4);
  axle.y = Math.min(...wheels.map(w => w.center.y - w.radius));
  // residual yaw: left->right wheel vectors should be parallel to X
  const get = k => wheels.find(w => w.key === k).center;
  const dF = get('RF').clone().sub(get('LF')), dB = get('RB').clone().sub(get('LB'));
  const yawFix = (Math.atan2(dF.z, dF.x) + Math.atan2(dB.z, dB.x)) / 2;
  return { ok: true, root: finish(holder, s, axle, cfg, yawFix), wheels, found: keys, total, scale: s };
}

function finish(holder, s, origin, cfg, yawFix = 0) {
  const inner = new THREE.Group();
  const fix = new THREE.Group();
  fix.rotation.y = yawFix;
  fix.add(holder);
  inner.add(fix);
  holder.position.copy(origin).multiplyScalar(-1);
  // fix rotates about the axle centre: p -> R(p - origin)
  inner.scale.setScalar(s);
  const root = new THREE.Group();
  root.add(inner);
  // cfg.front = '-z' (default): the nose points to -Z in the aligned model, so turn it round
  if (cfg.front !== '+z') inner.rotation.y = Math.PI;
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return root;
}

// ---- draw-call reduction: merge all non-wheel meshes that share a material ----
function toFloat(geo) {
  const g = new THREE.BufferGeometry();
  for (const name in geo.attributes) {
    const a = geo.attributes[name];
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'uv1' && name !== 'tangent' && name !== 'color') continue;
    const na = new THREE.BufferAttribute(new Float32Array(a.count * a.itemSize), a.itemSize);
    for (let i = 0; i < a.count; i++) {
      na.setX(i, a.getX(i));
      if (a.itemSize > 1) na.setY(i, a.getY(i));
      if (a.itemSize > 2) na.setZ(i, a.getZ(i));
      if (a.itemSize > 3) na.setW(i, a.getW(i));
    }
    g.setAttribute(name, na);
  }
  if (geo.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(geo.index.array), 1));
  return g;
}

function simplify(holder, wheels) {
  const spinSet = new Set(wheels.map(w => w.spin));
  const body = [];
  holder.updateMatrixWorld(true);
  holder.traverse(o => {
    if (!o.isMesh) return;
    for (let p = o.parent; p; p = p.parent) if (spinSet.has(p)) return;
    body.push(o);
  });
  const groups = new Map();
  for (const m of body) {
    // glass: swap expensive transmission for plain transparency
    const mat = m.material;
    if (mat.transmission > 0) { mat.transmission = 0; mat.transparent = true; mat.opacity = 0.35; mat.depthWrite = false; }
    const key = mat.uuid + '|' + Object.keys(m.geometry.attributes).filter(n => ['position', 'normal', 'uv', 'uv1', 'tangent', 'color'].includes(n)).sort().join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map(m => {
      const g = toFloat(m.geometry);
      g.applyMatrix4(m.matrixWorld);
      return g;
    });
    // all geometries must agree on indexed-ness
    const anyIdx = geos.some(g => g.index);
    if (anyIdx) geos.forEach(g => { if (!g.index) { const n = g.attributes.position.count; const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); } });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.name = list[0].name;
    holder.add(mesh);
    list.forEach(m => m.parent && m.parent.remove(m));
  }
}
