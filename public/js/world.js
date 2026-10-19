import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as TX from './textures.js';
import { wallDamage } from './car.js';

// =====================================================================================================================
//  Mission world: three cities (scaled so every street fits a car) joined by connector roads.
//  Collision comes from one signed-distance field baked by tools/city/build-world.mjs (public/mission/world.sdf):
//  positive = free space (metres to the nearest wall), negative = inside a wall / building / outside the map.
// =====================================================================================================================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _n = { x: 0, z: 0 };

export class World {
  constructor(meta, sdf) {
    this.m = meta; this.sdf = sdf; this.isWorld = true;
    this.W = meta.w; this.H = meta.h; this.cell = meta.cell;
    this.root = new THREE.Group(); this.root.name = 'missionWorld';
    this.cities = meta.cities; this.connectors = meta.connectors;
    this.x0 = meta.x0; this.z0 = meta.z0;
    this.x1 = meta.x0 + meta.w * meta.cell; this.z1 = meta.z0 + meta.h * meta.cell;
    this.nav = null; this.obs = [];                         // dynamic obstacles (roadblock cars): {x, z, r}
    this.propNodes = new Map();
  }

  static async load(renderer, onProgress = () => {}) {
    const [meta, buf] = await Promise.all([fetch('/mission/world.json').then(r => r.json()), fetch('/mission/world.sdf').then(r => r.arrayBuffer())]);
    const w = new World(meta, new Uint8Array(buf));
    await w.build(renderer, onProgress);
    return w;
  }

  // ------------------------------------------------------------------ signed distance field
  /** metres to the nearest wall (bilinear); negative inside walls. Outside the map: -4 */
  dist(x, z, noObs = false) {
    const m = this.m, W = this.W;
    const fx = (x - this.x0) / this.cell - 0.5, fz = (z - this.z0) / this.cell - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= W - 1 || iz >= this.H - 1) return -4;
    const tx = fx - ix, tz = fz - iz, o = iz * W + ix, b = this.sdf;
    const v = (b[o] * (1 - tx) + b[o + 1] * tx) * (1 - tz) + (b[o + W] * (1 - tx) + b[o + W + 1] * tx) * tz;
    let d = v / m.sdfK + m.sdfLo;
    if (!noObs) for (const q of this.obs) { const ex = x - q.x; if (ex > d + q.r || ex < -d - q.r) continue; const e = Math.hypot(ex, z - q.z) - q.r; if (e < d) d = e; }
    return d;
  }

  /** the parked car described by world.json `props[i]` as a movable pivot (origin = centre of its footprint, +z = its long axis); null when the model has no such node */
  propPivot(spec) {
    const node = this.propNodes.get(THREE.PropertyBinding.sanitizeNodeName(spec.n));
    if (!node) return null;
    if (node.userData.pivot) return node.userData.pivot;
    const piv = new THREE.Group(); piv.rotation.y = spec.psi; piv.position.set(spec.x, 0, spec.z);
    this.root.add(piv); this.root.updateMatrixWorld(true);
    piv.attach(node); node.userData.pivot = piv;
    return piv;
  }

  /** roadblocks: circles that count as walls for cars, AI feelers and the nav grid */
  setObstacles(list) { this.obs = list; }

  /** unit vector pointing away from the nearest wall (into free space) */
  grad(x, z, out = _n, noObs = false) {
    const h = 0.4;
    let gx = this.dist(x + h, z, noObs) - this.dist(x - h, z, noObs), gz = this.dist(x, z + h, noObs) - this.dist(x, z - h, noObs);
    let l = Math.hypot(gx, gz);
    if (l < 1e-4) {                                  // flat (deep inside a wall): head for the closest open ground
      let best = -1e9; gx = 0; gz = 0;
      for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, d = this.dist(x + Math.cos(a) * 3, z + Math.sin(a) * 3); if (d > best) { best = d; gx = Math.cos(a); gz = Math.sin(a); } }
      l = 1;
    }
    out.x = gx / l; out.z = gz / l; return out;
  }

  /** how far (0..1) along the segment a->b a circle of radius r stays clear of every wall */
  rayFree(ax, az, bx, bz, r = 0.9, noObs = false) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 0.6));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (this.dist(ax + (bx - ax) * t, az + (bz - az) * t, noObs) < r) return (i - 1) / n;
    }
    return 1;
  }

  // ------------------------------------------------------------------ Vehicle interface (see Vehicle.wallHit / update)
  nearest(x, z, i, out) { out.i = 0; out.d = 0; out.a = 0; return out; }

  /** push a car (3 circles along its length) out of the walls, bounce, slide along them and report the hit */
  collide(v, dt) {
    const R = 0.95, sp = Math.sin(v.psi), cp = Math.cos(v.psi);
    let worst = 0, nx0 = 0, nz0 = 0, any = false;
    for (const off of [1.5, -1.5, 0]) {
      const cx = v.x + sp * off, cz = v.z + cp * off, d = this.dist(cx, cz, true);   // roadblock cars are soft: Posts.pushCars() moves them
      if (d >= R) continue;
      const n = this.grad(cx, cz, _n, true), pen = R - d;
      v.x += n.x * pen; v.z += n.z * pen;
      const vn = v.vx * n.x + v.vz * n.z;
      if (vn < 0) {
        v.vx -= 1.18 * vn * n.x; v.vz -= 1.18 * vn * n.z;                         // a little bounce
        const tx = -n.z, tz = n.x, vt = v.vx * tx + v.vz * tz;
        v.vx -= vt * tx * 0.05; v.vz -= vt * tz * 0.05;                            // scraping costs speed
        if (-vn > worst) { worst = -vn; nx0 = n.x; nz0 = n.z; }
        // nose is thrown away from a wall it hit with the front, tail away when hit with the back
        v.yaw += (sp * off * n.z - cp * off * n.x) * vn * 0.05;
      }
      any = true;
    }
    if (!any) { v.hit = Math.max(0, v.hit - dt * 3); return; }
    if (worst > 0) {
      v.hit = Math.min(1, worst / 20);
      v.hitEvent = Math.max(v.hitEvent || 0, worst);
      v.dmg = (v.dmg || 0) + wallDamage(worst);
      const tx = -nz0, tz = nx0, wallAng = Math.atan2(tx, tz);                    // turn the nose along the wall instead of digging in
      let da = wallAng - v.psi; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > Math.PI / 2) da = Math.atan2(Math.sin(da + Math.PI), Math.cos(da + Math.PI));
      v.yaw += da * Math.min(1, worst / 14) * 1.6;
      v.psi += da * Math.min(1, dt * 7);
    }
  }

  /** chase camera: keep the lens out of buildings (ray from the car to the wanted camera spot) */
  pushCamera(cam, tx, tz) {
    const f = this.rayFree(tx, tz, cam.position.x, cam.position.z, 0.7);
    if (f >= 1) return false;
    const k = Math.max(0.08, f - 0.05);
    cam.position.x = tx + (cam.position.x - tx) * k; cam.position.z = tz + (cam.position.z - tz) * k;
    cam.position.y += (1 - k) * 2.4;
    return true;
  }

  /** index of the city a point lies in (or -1) */
  cityAt(x, z) { return this.cities.findIndex(c => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1); }

  /** longest free direction from a point = along the street; returns heading psi (forward = (sin, cos)) */
  freeHeading(x, z) {
    let best = -1, bp = 0;
    for (let k = 0; k < 24; k++) {
      const a = k * Math.PI / 12, dx = Math.sin(a), dz = Math.cos(a);
      let d = 0; while (d < 60 && this.dist(x + dx * d, z + dz * d) > 1.2) d += 1.5;
      if (d > best + 0.01) { best = d; bp = a; }
    }
    return bp;
  }

  // ------------------------------------------------------------------ scene
  async build(renderer, onProgress) {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    const frac = this.cities.map(() => 0);
    const groups = await Promise.all(this.cities.map((c, i) => new Promise((res, rej) => {
      loader.load(c.glb, g => { frac[i] = 1; onProgress(frac.reduce((a, b) => a + b, 0) / frac.length); res(g.scene); },
        e => { if (e.total) { frac[i] = e.loaded / e.total; onProgress(frac.reduce((a, b) => a + b, 0) / frac.length); } }, rej);
    })));
    this.cities.forEach((c, i) => {
      const g = new THREE.Group(), s = c.scale;
      g.scale.setScalar(s); g.position.set(c.x0 - c.minX * s, -c.ground * s, c.z0 - c.minZ * s);
      g.add(groups[i]);
      groups[i].traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true; o.matrixAutoUpdate = false; o.updateMatrix();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) { for (const k of ['map', 'normalMap', 'emissiveMap']) if (m[k]) m[k].anisotropy = aniso; if (m.envMapIntensity != null) m.envMapIntensity = 0.7; }
      });
      g.name = 'city_' + c.id;
      this.root.add(g);
      if (c.id === 'a') groups[i].traverse(o => { if (!o.isMesh) this.propNodes.set(o.name, o); });      // parked cars: see propPivot()
    });
    this.root.updateMatrixWorld(true);
    this.buildTerrain();
    this.buildConnectors(aniso);
    this.buildBarriers();
    this.buildVerge();
  }

  buildTerrain() {
    const tex = TX.grassTexture({ tint: '#6e7a5a', lift: 'rgba(160,170,140,0.10)' }); tex.repeat.set(400, 400);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set((this.x0 + this.x1) / 2, -0.12, (this.z0 + this.z1) / 2); ground.receiveShadow = true;
    this.root.add(ground);
  }

  /** asphalt strips + sidewalk curbs for every connector (the SDF already has walls at +-width/2) */
  buildConnectors(aniso) {
    const road = TX.roadTexture(); road.anisotropy = aniso;
    const mat = new THREE.MeshStandardMaterial({ map: road, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const cn of this.connectors) {
      const hw = cn.width / 2 + 0.25, P = cn.pts, pos = [], uv = [], idx = [];
      let run = 0;
      for (let i = 0; i < P.length; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        if (i) run += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
        pos.push(P[i][0] + tz * hw, 0.015, P[i][1] - tx * hw, P[i][0] - tz * hw, 0.015, P[i][1] + tx * hw);
        uv.push(0, run / 24, 1, run / 24);
        if (i) { const o = i * 2; idx.push(o - 2, o - 1, o, o - 1, o + 1, o); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      // the normals of an upward facing strip must point up whatever the winding
      const nrm = g.attributes.normal; for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.frustumCulled = false;
      this.root.add(m);
    }
  }

  /** instanced concrete barriers: along both sides of every connector and round the city rectangles (gaps where roads enter) */
  buildBarriers() {
    const spots = [];                                                      // {x, z, ang}
    for (const cn of this.connectors) {
      const P = cn.pts, off = cn.width / 2 + 0.3;
      let acc = 0;
      for (let i = 1; i < P.length; i++) {
        const dx = P[i][0] - P[i - 1][0], dz = P[i][1] - P[i - 1][1], l = Math.hypot(dx, dz) || 1, ang = Math.atan2(dx, dz);
        acc += l; if (acc < 3.9) continue; acc = 0;
        const nx = dz / l, nz = -dx / l;
        for (const s of [-1, 1]) {
          const x = P[i][0] + nx * off * s, z = P[i][1] + nz * off * s;
          if (this.cityAt(x, z) >= 0) continue;                              // inside a city the road is open
          spots.push({ x, z, ang });
        }
      }
    }
    const nearRoad = (x, z) => this.connectors.some(cn => cn.pts.some((p, k) => k % 2 === 0 && Math.hypot(p[0] - x, p[1] - z) < cn.width / 2 + 6));
    for (const c of this.cities) {
      for (const [ax, az, bx, bz, ang] of [[c.x0, c.z0, c.x1, c.z0, Math.PI / 2], [c.x0, c.z1, c.x1, c.z1, Math.PI / 2], [c.x0, c.z0, c.x0, c.z1, 0], [c.x1, c.z0, c.x1, c.z1, 0]]) {
        const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 4);
        const side = ax === bx ? (ax === c.x0 ? -1 : 1) : (az === c.z0 ? -1 : 1);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n; let x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          if (nearRoad(x, z)) continue;
          if (ax === bx) x += side * 0.35; else z += side * 0.35;
          spots.push({ x, z, ang });
        }
      }
    }
    const geo = new THREE.BoxGeometry(0.6, 0.9, 4);
    const mat = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.9, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    const o = new THREE.Object3D();
    spots.forEach((s, i) => { o.position.set(s.x, 0.43, s.z); o.rotation.set(0, s.ang, 0); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.root.add(mesh);
    this.barrierCount = spots.length;
  }

  /** a few trees along the open roads so the countryside is not bare */
  buildVerge() {
    const spots = []; let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (const cn of this.connectors) {
      const P = cn.pts;
      for (let i = 2; i < P.length - 2; i++) {
        const a = P[i - 1], b = P[i + 1]; let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        for (const s of [-1, 1]) {
          if (rnd() < 0.45) continue;
          const off = cn.width / 2 + 3 + rnd() * 14;
          const x = P[i][0] + tz * off * s + (rnd() - 0.5) * 3, z = P[i][1] - tx * off * s + (rnd() - 0.5) * 3;
          if (this.cityAt(x, z) >= 0 || this.dist(x, z) > -1.5) continue;     // only on the solid side (never on the road)
          spots.push({ x, z, s: 0.8 + rnd() * 0.9 });
        }
      }
    }
    if (!spots.length) return;
    const trunk = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6); trunk.translate(0, 1.2, 0);
    const crown = new THREE.ConeGeometry(1.7, 5.2, 7); crown.translate(0, 4.6, 0);
    const tm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 }), spots.length);
    const cm = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 1 }), spots.length);
    const o = new THREE.Object3D();
    spots.forEach((s, i) => { o.position.set(s.x, 0, s.z); o.rotation.set(0, i * 2.4, 0); o.scale.setScalar(s.s); o.updateMatrix(); tm.setMatrixAt(i, o.matrix); cm.setMatrixAt(i, o.matrix); });
    for (const m of [tm, cm]) { m.castShadow = true; m.frustumCulled = false; this.root.add(m); }
  }

  dispose() {
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) { for (const k of ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].dispose(); m.dispose(); }
    });
  }
}

// =====================================================================================================================
//  Navigation: 2 m grid over the world; time-sliced Dijkstra fields (distance to a target / from the police) that AIs
//  descend. Edge cost grows near walls so drivers keep to the middle of the street.
// =====================================================================================================================
export class Nav {
  constructor(world) {
    this.w = world; this.step = 2;
    this.gw = Math.ceil((world.x1 - world.x0) / this.step); this.gh = Math.ceil((world.z1 - world.z0) / this.step);
    const n = this.gw * this.gh;
    this.clear = new Float32Array(n);             // min clearance over the cell (metres)
    this.open = new Uint8Array(n);
    this.pen = new Float32Array(n);
    for (let j = 0; j < this.gh; j++) for (let i = 0; i < this.gw; i++) {
      const cx = world.x0 + (i + 0.5) * this.step, cz = world.z0 + (j + 0.5) * this.step;
      const c = world.dist(cx, cz), k = j * this.gw + i;
      this.clear[k] = c; this.open[k] = c >= 1.25 ? 1 : 0;
      this.pen[k] = Math.max(0, 3.4 - world.dist(cx, cz)) * 0.45;        // prefer the middle of the street
    }
    // main component only (everything the baked world marks drivable is one piece, but be safe after rounding)
    this.label = new Int32Array(n);
  }
  cellOf(x, z) { const i = Math.floor((x - this.w.x0) / this.step), j = Math.floor((z - this.w.z0) / this.step); return (i < 0 || j < 0 || i >= this.gw || j >= this.gh) ? -1 : j * this.gw + i; }
  centre(k) { return [this.w.x0 + ((k % this.gw) + 0.5) * this.step, this.w.z0 + (((k / this.gw) | 0) + 0.5) * this.step]; }
  /** nearest open cell to a point (spiral search) */
  snap(x, z) {
    let k = this.cellOf(x, z); if (k >= 0 && this.open[k]) return k;
    const i0 = Math.floor((x - this.w.x0) / this.step), j0 = Math.floor((z - this.w.z0) / this.step);
    for (let r = 1; r < 40; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) continue;
      if (this.open[j * this.gw + i]) return j * this.gw + i;
    }
    return -1;
  }
  /** recompute open / penalty for the cells around (x,z) after obstacles changed */
  refresh(x, z, r) {
    const w = this.w, i0 = Math.max(0, Math.floor((x - r - w.x0) / this.step)), i1 = Math.min(this.gw - 1, Math.floor((x + r - w.x0) / this.step));
    const j0 = Math.max(0, Math.floor((z - r - w.z0) / this.step)), j1 = Math.min(this.gh - 1, Math.floor((z + r - w.z0) / this.step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = w.x0 + (i + 0.5) * this.step, cz = w.z0 + (j + 0.5) * this.step, k = j * this.gw + i, c = w.dist(cx, cz);
      this.clear[k] = c; this.open[k] = c >= 1.25 ? 1 : 0; this.pen[k] = Math.max(0, 3.4 - c) * 0.45;
    }
  }
  field() { return new Field(this); }
}

const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414], [-1, -1, 1.414]];

/** time-sliced multi-source Dijkstra. dist[] in metres (Infinity = unreached); par[] = previous cell towards a source */
export class Field {
  constructor(nav) {
    this.nav = nav; const n = nav.gw * nav.gh;
    this.dist = new Float32Array(n).fill(Infinity); this.par = new Int32Array(n).fill(-1);
    this.hk = new Float32Array(n * 8 + 64); this.hv = new Int32Array(n * 8 + 64); this.hn = 0;
    this.done = true; this.limit = Infinity; this.stamp = 0; this.age = 0;
  }
  push(key, v) {
    let i = this.hn++; const hk = this.hk, hv = this.hv;
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= key) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
    hk[i] = key; hv[i] = v;
  }
  pop() {
    const hk = this.hk, hv = this.hv, top = hv[0], key = hk[0], n = --this.hn;
    if (n > 0) {
      const lk = hk[n], lv = hv[n]; let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hk[c + 1] < hk[c]) c++; if (hk[c] >= lk) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; }
      hk[i] = lk; hv[i] = lv;
    }
    this.popKey = key; return top;
  }
  /** (re)start from `sources` (cell indices) */
  start(sources, limit = Infinity) {
    this.dist.fill(Infinity); this.par.fill(-1); this.hn = 0; this.done = false; this.limit = limit; this.age = 0;
    for (const s of sources) if (s >= 0) { this.dist[s] = 0; this.push(0, s); }
  }
  /** run for at most `ms` milliseconds; returns true when finished */
  run(ms) {
    if (this.done) return true;
    const t0 = performance.now(), nav = this.nav, gw = nav.gw, gh = nav.gh, open = nav.open, pen = nav.pen, dist = this.dist, par = this.par, S = nav.step;
    let it = 0;
    while (this.hn > 0) {
      if ((++it & 255) === 0 && performance.now() - t0 > ms) return false;
      const u = this.pop(), du = this.popKey;
      if (du > dist[u]) continue;
      if (du > this.limit) { this.hn = 0; break; }
      const ui = u % gw, uj = (u / gw) | 0;
      for (let q = 0; q < 8; q++) {
        const nb = NB[q], vi = ui + nb[0], vj = uj + nb[1];
        if (vi < 0 || vj < 0 || vi >= gw || vj >= gh) continue;
        const v = vj * gw + vi; if (!open[v]) continue;
        if (q >= 4 && (!open[uj * gw + vi] || !open[vj * gw + ui])) continue;            // no corner cutting through walls
        const nd = du + nb[2] * S * (1 + pen[v]);
        if (nd < dist[v]) { dist[v] = nd; par[v] = u; this.push(nd, v); }
      }
    }
    this.done = true; this.age = 0; return true;
  }
  runAll() { while (!this.run(1e9)); }
  /** best neighbour (lowest distance) of the cell under (x,z); the point we should drive towards, `ahead` metres along the descent */
  descend(x, z, ahead = 20) {
    const nav = this.nav; let k = nav.cellOf(x, z);
    if (k < 0) return null;
    if (!nav.open[k] || !isFinite(this.dist[k])) { k = nav.snap(x, z); if (k < 0 || !isFinite(this.dist[k])) return null; }
    const gw = nav.gw, gh = nav.gh, pts = [nav.centre(k)];
    let steps = Math.max(1, Math.round(ahead / nav.step));
    while (steps-- > 0) {
      const ui = k % gw, uj = (k / gw) | 0; let best = k, bd = this.dist[k];
      for (let q = 0; q < 8; q++) {
        const vi = ui + NB[q][0], vj = uj + NB[q][1]; if (vi < 0 || vj < 0 || vi >= gw || vj >= gh) continue;
        const v = vj * gw + vi, d = this.dist[v];
        if (d < bd) { bd = d; best = v; }
      }
      if (best === k) break;
      k = best; pts.push(nav.centre(k));
    }
    return pts;
  }
}
