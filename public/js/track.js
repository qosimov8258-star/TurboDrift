import * as THREE from 'three';
import { TRACKS, THEME } from './trackdata.js';
import { decorate } from './scenery.js';
import * as TX from './textures.js';

export const ROAD_W = 18, HALF = ROAD_W / 2, CURB_W = 1.6, RUNOFF_W = 4.2;
export const WALL_D = HALF + CURB_W + RUNOFF_W;   // distance of the barrier from the centre line
const STEP = 2;                                    // metres between samples

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Track {
  constructor(def = TRACKS[0]) {
    this.def = def; this.theme = THEME(def.theme);
    const sc = def.scale ?? 1;
    const pts = def.points.map(([x, z]) => V(x * sc, 0, z * sc));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.curve.arcLengthDivisions = 6000;
    this.curve.updateArcLengths();
    this.length = this.curve.getLength();
    // open arena: only the OUTER barrier exists, the infield is one big drivable disc
    this.open = !!def.open;
    this.N = Math.round(this.length / STEP);
    this.step = this.length / this.N;
    this.P = this.curve.getSpacedPoints(this.N).slice(0, this.N);
    const N = this.N;
    this.T = []; this.L = []; this.K = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.P[(i + 1) % N], b = this.P[(i - 1 + N) % N];
      const t = a.clone().sub(b); t.y = 0; t.normalize();
      this.T.push(t);
      this.L.push(V(t.z, 0, -t.x));
    }
    this.outerSg = this.open ? (this.L[0].x * this.P[0].x + this.L[0].z * this.P[0].z >= 0 ? 1 : -1) : 0;   // lateral sign that points away from the middle
    for (let i = 0; i < N; i++) {      // signed curvature, + = turning left
      const t0 = this.T[(i - 6 + N) % N], t1 = this.T[(i + 6) % N];
      this.K[i] = Math.atan2(t0.x * t1.z - t0.z * t1.x, t0.dot(t1)) / (12 * this.step);
    }
  }

  wrap(i) { const N = this.N; return ((i % N) + N) % N; }

  /** nearest sample + signed lateral offset (positive = left of travel direction) */
  nearest(x, z, hint, out = {}) {
    const N = this.N, P = this.P;
    let best = 1e18, bi = 0;
    if (hint === undefined || hint < 0) {
      for (let i = 0; i < N; i += 4) { const dx = P[i].x - x, dz = P[i].z - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
      hint = bi; best = 1e18;
    }
    for (let k = -30; k <= 30; k++) {
      const i = this.wrap(hint + k), dx = P[i].x - x, dz = P[i].z - z, d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    const p = P[bi], l = this.L[bi], t = this.T[bi];
    out.i = bi;
    out.d = (x - p.x) * l.x + (z - p.z) * l.z;       // lateral
    out.a = (x - p.x) * t.x + (z - p.z) * t.z;       // along (sub-sample)
    return out;
  }

  /** point at sample i, shifted sideways by `off` metres (left positive) */
  at(i, off = 0, out = new THREE.Vector3()) {
    const j = this.wrap(i);
    return out.copy(this.P[j]).addScaledVector(this.L[j], off);
  }

  heading(i) { const t = this.T[this.wrap(i)]; return Math.atan2(t.x, t.z); }

  /** start-grid slot k (0 = pole) -> { x, z, psi } */
  gridSlot(k) {
    const row = k >> 1, col = k & 1;
    const back = 8 + row * 9 + (col ? 4.5 : 0);
    const i = this.wrap(-Math.round(back / this.step));
    const p = this.at(i, col ? -3.6 : 3.6);
    return { x: p.x, z: p.z, psi: this.heading(i), i };
  }

  // ------------------------------------------------------------------ geometry
  _strip(offA, yA, offB, yB, vScale, expectUp, uA = 0, uB = 1) {
    const N = this.N, pos = [], uv = [], idx = [];
    let s = 0;
    for (let i = 0; i <= N; i++) {
      const j = i % N, p = this.P[j], l = this.L[j];
      pos.push(p.x + l.x * offA, yA, p.z + l.z * offA, p.x + l.x * offB, yB, p.z + l.z * offB);
      uv.push(uA, s / vScale, uB, s / vScale);
      s += this.step;
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make sure faces look towards `expectUp` (a Vector3)
    const n = new THREE.Vector3(g.attributes.normal.getX(0), g.attributes.normal.getY(0), g.attributes.normal.getZ(0));
    if (n.dot(expectUp) < 0) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.setIndex(idx); g.computeVertexNormals();
    }
    return g;
  }

  build(scene, { quality = 'high' } = {}) {
    const root = new THREE.Group();
    const UP = V(0, 1, 0);
    const mats = {};

    // ground
    const grass = TX.grassTexture(this.theme.ground); grass.repeat.set(500, 500);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ map: grass, color: this.theme.grass, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.08; ground.receiveShadow = true;
    ground.material.depthWrite = false; ground.renderOrder = -5;   // drawn first, never occludes the road (avoids depth-buffer fights at low camera angles)
    root.add(ground);

    // asphalt
    const roadTex = TX.roadTexture();
    const road = new THREE.Mesh(this._strip(-HALF, 0, HALF, 0, 16, UP), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.88, metalness: 0 }));
    road.receiveShadow = true; root.add(road);

    // gravel run-off
    const gr = TX.gravelTexture();
    const gmat = new THREE.MeshStandardMaterial({ map: gr, roughness: 1 });
    const sides = this.open ? [this.outerSg] : [1, -1];
    if (this.open) {                                   // paved infield disc (radius = inner edge of the road)
      let cx = 0, cz = 0; for (const p of this.P) { cx += p.x; cz += p.z; } cx /= this.N; cz /= this.N;
      let R = 0; for (const p of this.P) R += Math.hypot(p.x - cx, p.z - cz); R = R / this.N - HALF;
      const ft = TX.roadTexture().clone(); ft.needsUpdate = true; ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(R / 6, R / 6);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.9, metalness: 0 }));
      disc.rotation.x = -Math.PI / 2; disc.position.set(cx, 0.004, cz); disc.receiveShadow = true; root.add(disc);
    }
    for (const sg of sides) {
      const a = sg * (HALF + CURB_W), b = sg * WALL_D;
      const m = new THREE.Mesh(this._strip(Math.min(a, b), 0.005, Math.max(a, b), 0.005, 8, UP, 0, 0.5), gmat);
      m.receiveShadow = true; root.add(m);
    }

    // curbs
    const ct = TX.curbTexture();
    const cmat = new THREE.MeshStandardMaterial({ map: ct, roughness: 0.7 });
    for (const sg of [1, -1]) {
      const a = sg * HALF, b = sg * (HALF + CURB_W);
      const m = new THREE.Mesh(this._strip(Math.min(a, b), 0.025, Math.max(a, b), 0.025, 4, UP, 0, 1), cmat);
      m.receiveShadow = true; root.add(m);
    }

    // barriers (inner face, top, outer face)
    const bt = TX.barrierTexture(); bt.repeat.set(1, 1);
    const bmat = new THREE.MeshStandardMaterial({ map: bt, roughness: 0.6, metalness: 0.05 });
    const topmat = new THREE.MeshStandardMaterial({ color: 0xd9dce0, roughness: 0.6 });
    const H = 1.15, TH = 0.7;
    for (const sg of sides) {
      const o0 = sg * WALL_D, o1 = sg * (WALL_D + TH);
      const inner = this._vstrip(o0, 0, H, 8, sg, -1);
      const top = this._strip(Math.min(o0, o1), H, Math.max(o0, o1), H, 8, UP, 0, 0.05);
      const outer = this._vstrip(o1, 0, H, 8, sg, 1);
      for (const [g, m] of [[inner, bmat], [top, topmat], [outer, bmat]]) {
        const mesh = new THREE.Mesh(g, m); mesh.castShadow = (quality === 'high' || quality === 'ultra'); mesh.receiveShadow = true; root.add(mesh);
      }
    }

    this._scenery(root, quality);
    this._startArea(root);
    scene.add(root);
    return root;
  }

  /** vertical wall strip at lateral offset `off` from y0 to y1; face normal points toward -dir*left (dir=-1: towards track side) */
  _vstrip(off, y0, y1, vScale, sg, dir) {
    const N = this.N, pos = [], uv = [], idx = [];
    let s = 0;
    for (let i = 0; i <= N; i++) {
      const j = i % N, p = this.P[j], l = this.L[j];
      const x = p.x + l.x * off, z = p.z + l.z * off;
      pos.push(x, y0, z, x, y1, z);
      uv.push(s / (vScale * 4), 0, s / (vScale * 4), 1);
      s += this.step;
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // wanted normal: toward track for inner (dir -1) => -sg*left ; outward for outer (dir 1) => +sg*left
    const want = V(0, 0, 0).set(this.L[0].x * sg * (dir === -1 ? -1 : 1), 0, this.L[0].z * sg * (dir === -1 ? -1 : 1));
    const nrm = g.attributes.normal;
    const n = V(nrm.getX(0), nrm.getY(0), nrm.getZ(0));
    if (n.dot(want) < 0) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.setIndex(idx); g.computeVertexNormals();
    }
    return g;
  }

  _scenery(root, quality) {
    const N = this.N, P = this.P;
    // trees (pines): forest / mountain / snow themes; other themes get their own decor
    const th = this.theme;
    decorate(this, root, th, quality);
    const treeKind = th.decor === 'forest' || th.decor === 'snow';
    const count = !treeKind ? 0 : (quality === 'high' || quality === 'ultra') ? 900 : 350;
    const trunkG = new THREE.CylinderGeometry(0.35, 0.5, 3.2, 6); trunkG.translate(0, 1.6, 0);
    const leafG = new THREE.ConeGeometry(2.6, 6.5, 7); leafG.translate(0, 6, 0);
    const leaf2G = new THREE.ConeGeometry(2.0, 5, 7); leaf2G.translate(0, 9, 0);
    const leafAll = new THREE.BufferGeometry();
    {
      const g1 = leafG.toNonIndexed(), g2 = leaf2G.toNonIndexed();
      const pos = new Float32Array(g1.attributes.position.count * 3 + g2.attributes.position.count * 3);
      const nor = new Float32Array(pos.length);
      pos.set(g1.attributes.position.array, 0); pos.set(g2.attributes.position.array, g1.attributes.position.array.length);
      nor.set(g1.attributes.normal.array, 0); nor.set(g2.attributes.normal.array, g1.attributes.normal.array.length);
      leafAll.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      leafAll.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    }
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 }), count);
    const leaves = new THREE.InstancedMesh(leafAll, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3(), col = new THREE.Color();
    let seed = 12345; const r = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 30) {
      tries++;
      const i = Math.floor(r() * N), sg = r() > 0.5 ? 1 : -1, off = WALL_D + 10 + r() * (r() > 0.7 ? 160 : 60);
      this.at(i, sg * off, pp);
      let ok = true;
      for (let k = 0; k < N; k += 3) { const dx = P[k].x - pp.x, dz = P[k].z - pp.z; if (dx * dx + dz * dz < (WALL_D + 8) ** 2) { ok = false; break; } }
      if (!ok) continue;
      const s = 0.7 + r() * 0.9;
      q.setFromEuler(new THREE.Euler(0, r() * 6.28, 0)); sc.set(s, s * (0.9 + r() * 0.4), s);
      m4.compose(pp, q, sc);
      trunks.setMatrixAt(placed, m4); leaves.setMatrixAt(placed, m4);
      col.setHSL(th.leaf[0] + r() * th.leaf[1], th.leaf[2] + r() * 0.2, th.leaf[3] + r() * 0.1); leaves.setColorAt(placed, col);
      placed++;
    }
    trunks.count = leaves.count = placed;
    trunks.castShadow = leaves.castShadow = quality === 'high' || quality === 'ultra';
    root.add(trunks, leaves);

    // billboards
    const names = [['TURBO', '#e53935'], ['NITRO X', '#1e88e5'], ['DRIFT KING', '#111'], ['SPEEDLAB', '#f9a825'], ['APEX', '#00897b'], ['OCTANE', '#6a1b9a'], ['REDLINE', '#c62828'], ['GRIP', '#ef6c00']];
    for (let k = 0; k < 16; k++) {
      const i = Math.floor((k + 0.5) * N / 16), sg = k % 2 ? 1 : -1;
      const [txt, bg] = names[k % names.length];
      const b = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshStandardMaterial({ map: TX.textBanner(txt, bg, '#fff', 1024, 256, 'italic 900 140px Arial Black, Impact, sans-serif'), roughness: 0.6, emissive: 0x111111 }));
      const p = this.at(i, sg * (WALL_D + 5.5));
      b.position.set(p.x, 4.4, p.z);
      b.rotation.y = Math.atan2(-sg * this.L[i].x, -sg * this.L[i].z);
      const back = b.clone(); back.material = new THREE.MeshStandardMaterial({ color: 0x333840, roughness: 1 }); back.rotation.y += Math.PI; back.position.addScaledVector(V(this.L[i].x, 0, this.L[i].z), sg * 0.05);
      const legG = new THREE.CylinderGeometry(0.18, 0.18, 4.4, 6), legM = new THREE.MeshStandardMaterial({ color: 0x444a52 });
      for (const dx of [-5.5, 5.5]) { const leg = new THREE.Mesh(legG, legM); leg.position.set(dx, -2.2 + 0.0, -0.1); b.add(leg); leg.position.y = -2.2; }
      b.castShadow = (quality === 'high' || quality === 'ultra');
      root.add(b, back);
    }

    // mountains
    const mm = new THREE.MeshStandardMaterial({ color: th.mount, roughness: 1, flatShading: true });
    const snowM = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.9, flatShading: true });
    for (let k = 0; k < 34; k++) {
      const a = (k / 34) * Math.PI * 2 + Math.sin(k * 7.3) * 0.08, d = 2300 + (Math.sin(k * 3.1) * 0.5 + 0.5) * 700;
      const h = 220 + (Math.sin(k * 5.7) * 0.5 + 0.5) * 380, w = 380 + (Math.cos(k * 2.3) * 0.5 + 0.5) * 360;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6 + (k % 3)), mm);
      cone.position.set(Math.cos(a) * d + this.centre.x, h / 2 - 3, Math.sin(a) * d + this.centre.z);
      cone.rotation.y = k;
      root.add(cone);
      if (th.mountSnow) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.34, h * 0.36, 6 + (k % 3)), snowM);
        cap.position.set(cone.position.x, cone.position.y + h * 0.32, cone.position.z); cap.rotation.y = k; root.add(cap);
      }
    }
  }

  get centre() {
    if (!this._c) { const c = new THREE.Vector3(); this.P.forEach(p => c.add(p)); this._c = c.multiplyScalar(1 / this.N); }
    return this._c;
  }

  _startArea(root) {
    const p0 = this.P[0], t = this.T[0], l = this.L[0], psi = Math.atan2(t.x, t.z);
    // checkered line
    const ct = TX.checkerTexture(); ct.repeat.set(2.25, 1);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 2), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.8 }));
    line.rotation.x = -Math.PI / 2; line.rotation.z = -psi; line.rotation.order = 'YXZ';
    line.rotation.set(-Math.PI / 2, psi, 0, 'YXZ');
    line.position.set(p0.x, 0.03, p0.z); line.receiveShadow = true; root.add(line);

    // grid slots
    const st = TX.slotTexture();
    const sm = new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let k = 0; k < 8; k++) {
      const s = this.gridSlot(k);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 5.6), sm);
      m.rotation.set(-Math.PI / 2, s.psi, 0, 'YXZ');
      m.position.set(s.x, 0.035, s.z); root.add(m);
    }

    // gantry
    const g = new THREE.Group();
    g.position.set(p0.x, 0, p0.z); g.rotation.y = psi;
    const steel = new THREE.MeshStandardMaterial({ color: 0x2d3138, roughness: 0.5, metalness: 0.6 });
    const W2 = HALF + 2.2;
    for (const sx of [-W2, W2]) { const pole = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9, 0.9), steel); pole.position.set(sx, 4.5, 0); pole.castShadow = true; g.add(pole); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W2 * 2 + 1, 2.6, 1.2), steel); beam.position.set(0, 9, 0); beam.castShadow = true; g.add(beam);
    const bt = TX.textBanner('START / FINISH', '#f5f5f5', '#111', 1024, 256, 'italic 900 120px Arial Black, Impact, sans-serif');
    for (const side of [1, -1]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(W2 * 2 - 1, 2.3), new THREE.MeshStandardMaterial({ map: bt, roughness: 0.6, emissive: 0x222222 }));
      b.position.set(0, 9, 0.62 * side); if (side < 0) b.rotation.y = Math.PI; g.add(b);
    }
    // start lights bar
    this.lights = [];
    for (let k = 0; k < 5; k++) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, roughness: 0.3 }));
      lamp.position.set(-3.6 + k * 1.8, 7.3, 0.2); g.add(lamp); this.lights.push(lamp);
    }
    root.add(g);

    if (this.open) { root.add(g); return; }
    // grandstand (left of the main straight)
    const crowd = TX.crowdTexture(); crowd.repeat.set(12, 1);
    const gs = new THREE.Group();
    const pS = this.at(Math.round(25 / this.step), 0);
    gs.position.set(pS.x, 0, pS.z); gs.rotation.y = psi;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.9 });
    const front = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 });
    for (let tier = 0; tier < 6; tier++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1 * (tier + 1), 130), [concrete, concrete, concrete, concrete, front, front].map(m => m));
      box.position.set(WALL_D + 14 + tier * 2.2, 0.55 * (tier + 1), 0);
      // faces: +x,-x,+y,-y,+z,-z ; give the track-facing -x side the crowd
      box.material = [concrete, new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 }), concrete, concrete, concrete];
      box.receiveShadow = true; box.castShadow = true; gs.add(box);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 132), new THREE.MeshStandardMaterial({ color: 0xe8eaed, roughness: 0.4, metalness: 0.2 }));
    roof.position.set(WALL_D + 21, 11, 0); roof.rotation.z = 0.06; roof.castShadow = true; gs.add(roof);
    for (const z of [-60, -20, 20, 60]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 11, 8), steel); pole.position.set(WALL_D + 14.5, 5.5, z); gs.add(pole); }
    root.add(gs);
  }

  setLights(n, go = false) {
    this.lights.forEach((l, i) => {
      const on = i < n;
      l.material.color.set(go ? 0x00ff55 : on ? 0xff1a1a : 0x220000);
      l.material.emissive.set(go ? 0x00ff55 : on ? 0xff1a1a : 0x000000);
      l.material.emissiveIntensity = (on || go) ? 2.5 : 0;
    });
  }
}

export function makeSky(renderer, scene) {
  const sunDir = new THREE.Vector3(-0.45, 0.55, 0.7).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2f6fd0) }, mid: { value: new THREE.Color(0x8ec1f0) }, hor: { value: new THREE.Color(0xdfeaf4) }, sun: { value: sunDir }, night: { value: 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vD; uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sun; uniform float night;
      void main(){ float h = clamp(vD.y, -0.2, 1.0);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.25, h)); c = mix(c, top, smoothstep(0.2, 0.9, h));
        float sd = max(dot(normalize(vD), normalize(sun)), 0.0);
        c += vec3(1.0,0.92,0.75) * (pow(sd, 900.0) * 6.0 + pow(sd, 40.0) * 0.35 + pow(sd, 6.0) * 0.12);
        if (night > 0.0) {
          vec3 p = floor(normalize(vD) * 260.0);
          float hs = fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          c += vec3(0.9, 0.95, 1.0) * step(0.9972, hs) * smoothstep(0.08, 0.5, vD.y) * night * (0.5 + 0.5 * fract(hs * 91.7));
        }
        if (vD.y < 0.0) c = mix(hor, mix(vec3(0.30,0.42,0.28), hor * 0.45, night), smoothstep(0.0,-0.2,vD.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
  sky.renderOrder = -10;
  scene.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  const api = { sky, sunDir, mat };
  // (re)paint the sky + image based lighting for a track theme
  api.setTheme = th => {
    mat.uniforms.top.value.set(th.sky[0]); mat.uniforms.mid.value.set(th.sky[1]); mat.uniforms.hor.value.set(th.sky[2]);
    sunDir.set(th.sun[0], th.sun[1], th.sun[2]).normalize();
    mat.uniforms.night.value = th.night ? 1 : 0;
    const envMat = mat.clone(); envMat.uniforms.sun.value = sunDir.clone();
    const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envMat));
    const old = scene.environment;
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = th.night ? 0.55 : 0.85;
    if (old) old.dispose();
    envMat.dispose();
  };
  api.setTheme(THEME('forest'));
  return api;
}
