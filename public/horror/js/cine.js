// Kadr (kinematografik sahna): o'yin boshlanishi bilan "badroom" xonasida ikki qahramon bilan sahna o'ynaladi; hamma o'yinchi ko'radi.
//   0–4 s     eshikdan chiroq nuri ichidan chiqib kirishadi (fanar ushlab yurishadi), eshik yopiladi
//   5–10 s    xonani aylanib ko'rishadi, 9.9 da lyuminessent lampa portlab o'chadi
//   10.9 s    shiftdan qon tomadi (2 tomchi)
//   18 s      kamera eshikka buriladi; eshik ochiladi, ichidan killer chiqib sekin yaqinlashadi
//   20–22.7 s qahramonlar ikki qo'llab to'pponchadan o't ochadi; killer o'girilib orqaga yugurib qochadi, eshik yopiladi
// Hamma narsa vaqtning (musiqaning) funksiyasi — shuning uchun hamma o'yinchida bir xil ko'rinadi.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createActor, KILLER_DEF } from './actors.js';
import { poseRig, handPos, ikArm } from './rig.js';
import { CINE_DUR } from './sim.js';
import { Post, Beams, Dust, Smoke, Casings, Sparks, starTex } from './fx.js';

const OX = 520, OZ = 520;               // sahna xaritadan juda uzoqda (hech qachon ko'rinmaydi)
const MODEL_OFF = [0.49, 0, -0.04];     // xona markazi (0,0) bo'lishi uchun
const WALL_Z = 4.12;                    // janubiy devorning ichki yuzi
const DEPTH = 0.95;                     // eshik orti xonachasi (alcove) chuqurligi: killer shu yerda turadi
const DOOR = { x: -0.5, z: WALL_Z - DEPTH, w: 1.1, h: 2.75 };
const HINGE = 0.55;
const CEIL = 3.3;
const T_SLAM = 4.2, T_TUBE = 9.9, T_BLOOD = 10.9, T_DROP2 = 13.4, T_RATTLE = 16.4, T_OPEN = 17.3, T_TURN = 18.0, T_DRAW = 19.7, T_FLEE = 22.8, T_SLAM2 = 24.35, T_DARK = 25.4;
const SHOTS = [[20.75, 0], [21.1, 1], [21.4, 0], [21.8, 1], [22.1, 0], [22.4, 1], [22.65, 0]];     // [vaqt, kim otadi]
const LEAKS = [[-0.95, 0.3], [-0.2, 0.9]];            // shiftdagi ikki tomchi joyi

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sm = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const seg = (t, a, b) => sm((t - a) / (b - a));
const mix = (a, b, k) => a + (b - a) * k;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const angMix = (a, b, k) => a + wrap(b - a) * k;
const hash = (n) => { n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16; return (n >>> 0) / 4294967296; };
const nz = (t, s) => Math.sin(t * 1.3 + s) * 0.5 + Math.sin(t * 2.9 + s * 2.1) * 0.3 + Math.sin(t * 5.3 + s * 3.7) * 0.2;      // yumshoq "qo'l titrashi"
const PI = Math.PI;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// [vaqt, x, z, yaw] — model old tomoni +z (yaw=0 eshikka qaraydi, yaw=PI xona ichiga). Harakat paytida yaw yurish yo'nalishiga burilib boradi.
const KEYS = [
  [[0, -0.72, 3.95, PI], [0.7, -0.72, 3.95, PI], [4.0, -0.66, 1.55, PI], [5.0, -0.66, 1.25, 0.2], [6.0, -0.66, 1.25, 0.2], [8.0, -1.85, 0.7, -2.2], [9.6, -1.25, 0.25, 0.4], [11.0, -1.0, 0.45, 0],
    [12.0, -0.75, 0.55, 0], [17.9, -0.45, 0.5, 0], [19.0, -0.45, 0.5, 0], [22.2, -0.5, 0.3, 0], [22.8, -0.56, 0.22, 0], [24.6, -0.56, 0.22, 0.8], [60, -0.56, 0.22, 0.8]],
  [[0, -0.28, 4.1, PI], [1.3, -0.28, 4.1, PI], [4.0, -0.25, 1.95, PI], [5.2, 0.45, 1.2, 0], [6.4, 0.45, 1.2, 0], [8.0, 1.05, 0.7, 2.2], [9.8, 1.2, 0.35, -0.4], [11.0, 0.9, 0.55, 0],
    [12.0, 0.4, 0.6, 0], [17.9, 0.3, 0.55, 0], [19.0, 0.3, 0.52, 0], [22.2, 0.3, 0.38, 0], [22.8, 0.34, 0.3, 0], [24.6, 0.34, 0.3, -0.8], [60, 0.34, 0.3, -0.8]],
];
const ORBIT_C = [-0.1, 0.62];

// ---------------------------------------------------------------------------------------------------- qahramon yo'li va yurish fazasi
function keyAt(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) { const a = keys[i - 1], b = keys[i], k = sm((t - a[0]) / (b[0] - a[0])); return [mix(a[1], b[1], k), mix(a[2], b[2], k), angMix(a[3], b[3], k)]; }
  }
  return keys[keys.length - 1].slice(1);
}
function basePath(i, t) {                  // asosiy yo'l (titroqsiz): joy va yo'nalish
  const k = keyAt(KEYS[i], t);
  let x = k[0], z = k[1], yaw = k[2];
  const wo = seg(t, 11.8, 13.2) * (1 - seg(t, 17.0, 17.9));          // 12–17.5: bir-biriga orqa qilib sekin aylanishadi
  if (wo > 0) {
    const th = (i ? PI : 0) + 0.3 * (t - 12) + 0.6, r = mix(0.8, 0.36, seg(t, 12, 14));
    x = mix(x, ORBIT_C[0] + Math.cos(th) * r, wo); z = mix(z, ORBIT_C[1] + Math.sin(th) * r, wo);
    yaw = angMix(yaw, Math.atan2(Math.cos(th), Math.sin(th)), wo);
  }
  return { x, z, yaw };
}
function motion(i, t) {                     // tezlik (m/s) va yurish yo'nalishi
  const a = basePath(i, t - 0.06), b = basePath(i, t + 0.06), v = Math.hypot(b.x - a.x, b.z - a.z) / 0.12;
  return { v, heading: Math.atan2(b.x - a.x, b.z - a.z) };
}
const stepLen = v => 0.42 + 0.3 * clamp((v - 0.8) / 2, 0, 1);
function buildPhase(i) {                    // yurish fazasi jadvali: har 0.04 s da yig'iladi (masofa / qadam uzunligi)
  const n = Math.ceil((CINE_DUR + 2) / 0.04), ph = new Float32Array(n + 1); let acc = 0, prev = basePath(i, 0);
  for (let k = 1; k <= n; k++) {
    const p = basePath(i, k * 0.04), v = Math.hypot(p.x - prev.x, p.z - prev.z) / 0.04;
    acc += PI * Math.hypot(p.x - prev.x, p.z - prev.z) / stepLen(v) + Math.abs(wrap(p.yaw - prev.yaw)) * 0.5 * (v < 0.25 ? 1 : 0);
    ph[k] = acc; prev = p;
  }
  return ph;
}
const phaseAt = (ph, t) => { const f = clamp(t / 0.04, 0, ph.length - 1.001), i = Math.floor(f); return mix(ph[i], ph[i + 1], f - i); };

// ---------------------------------------------------------------------------------------------------- qon
function splatTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#fff';
  c.beginPath(); for (let a = 0; a <= 24; a++) { const th = a / 24 * PI * 2, r = 30 + hash(a * 5 + 3) * 14; c[a ? 'lineTo' : 'moveTo'](64 + Math.cos(th) * r, 64 + Math.sin(th) * r); } c.closePath(); c.fill();
  for (let k = 0; k < 14; k++) { const th = hash(k * 11 + 1) * PI * 2, r0 = 36, r1 = 46 + hash(k * 7 + 2) * 16, w = 2 + hash(k * 3 + 5) * 3; c.beginPath(); c.moveTo(64 + Math.cos(th - 0.07) * r0, 64 + Math.sin(th - 0.07) * r0); c.lineTo(64 + Math.cos(th) * r1, 64 + Math.sin(th) * r1); c.lineTo(64 + Math.cos(th + 0.07) * r0, 64 + Math.sin(th + 0.07) * r0); c.fill(); c.beginPath(); c.arc(64 + Math.cos(th) * (r1 + 5), 64 + Math.sin(th) * (r1 + 5), w, 0, 7); c.fill(); }
  return new THREE.CanvasTexture(cv);
}
class Blood {
  constructor(group) {
    this.fall = Math.sqrt(2 * CEIL / 9.8); this.ts = [T_BLOOD, T_DROP2];
    const red = new THREE.MeshPhysicalMaterial({ color: 0x700606, emissive: 0x1e0000, roughness: 0.28, clearcoat: 0.5, clearcoatRoughness: 0.2 });
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 10, 8), red, 2); this.drops.frustumCulled = false;
    const fl = new THREE.PlaneGeometry(1, 1); fl.rotateX(-PI / 2);
    this.splats = new THREE.InstancedMesh(fl, new THREE.MeshStandardMaterial({ color: 0x5c0505, emissive: 0x1a0000, roughness: 0.12, alphaMap: splatTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 2); this.splats.frustumCulled = false;
    this.crown = new THREE.InstancedMesh(new THREE.SphereGeometry(0.011, 6, 5), red, 24); this.crown.frustumCulled = false;
    this.spray = new THREE.InstancedMesh(new THREE.SphereGeometry(0.017, 6, 5), red, SHOTS.length * 16); this.spray.frustumCulled = false;
    group.add(this.drops, this.splats, this.crown, this.spray);
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const cx = cv.getContext('2d'), gr = cx.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(60,0,0,1)'); gr.addColorStop(0.6, 'rgba(85,4,4,.7)'); gr.addColorStop(1, 'rgba(85,4,4,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.stain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
    this.stain.rotation.x = PI / 2; this.stain.position.set(LEAKS[0][0], CEIL - 0.015, LEAKS[0][1]); group.add(this.stain);
    this.bulges = LEAKS.map(([x, z]) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), red); m.position.set(x, CEIL - 0.03, z); m.scale.setScalar(0.001); group.add(m); return m; });
    this.d = new THREE.Object3D(); this.hide = new THREE.Matrix4().makeScale(0, 0, 0);
  }
  setVisible(v) { this.drops.visible = this.splats.visible = this.crown.visible = this.spray.visible = this.stain.visible = v; for (const m of this.bulges) m.visible = v; }
  dropPos(k, t) { const tau = t - this.ts[k]; return tau < 0 ? null : tau < this.fall ? V(LEAKS[k][0], CEIL - 4.9 * tau * tau, LEAKS[k][1]) : V(LEAKS[k][0], 0.02, LEAKS[k][1]); }
  update(t, hits) {
    const d = this.d;
    for (let k = 0; k < 2; k++) {
      const ts = this.ts[k], tau = t - ts, L = LEAKS[k];
      // shiftdagi bo'rtma: asta kattalashadi, cho'zilib osiladi
      const grow = seg(t, ts - 2.6, ts - 0.1) * (1 - seg(t, ts, ts + 0.1)), sag = seg(t, ts - 1.0, ts);
      this.bulges[k].scale.set(Math.max(1e-4, grow * 1.5), Math.max(1e-4, grow * (1.5 + 1.3 * sag)), Math.max(1e-4, grow * 1.5)); this.bulges[k].position.y = CEIL - 0.03 - 0.025 * sag;
      if (tau < 0) { this.drops.setMatrixAt(k, this.hide); this.splats.setMatrixAt(k, this.hide); for (let j = 0; j < 12; j++) this.crown.setMatrixAt(k * 12 + j, this.hide); continue; }
      if (tau < this.fall) {
        d.position.set(L[0], CEIL - 0.06 - 4.9 * tau * tau, L[1]); d.scale.set(1.1, 1.3 + tau * 2.2, 1.1); d.rotation.set(0, 0, 0); d.updateMatrix(); this.drops.setMatrixAt(k, d.matrix); this.splats.setMatrixAt(k, this.hide);
        for (let j = 0; j < 12; j++) this.crown.setMatrixAt(k * 12 + j, this.hide);
      } else {
        const age = tau - this.fall, r = (k ? 0.19 : 0.25) * (1 - Math.exp(-age * 14)) * (1 + 0.04 * Math.sin(age * 3));
        this.drops.setMatrixAt(k, this.hide);
        d.position.set(L[0], 0.013 + k * 0.0006, L[1]); d.scale.set(r * 2, 1, r * 2); d.rotation.set(0, k * 2.1 + 0.5, 0); d.updateMatrix(); this.splats.setMatrixAt(k, d.matrix);
        for (let j = 0; j < 12; j++) {      // tushganda tojsimon sachrashlar
          if (age > 0.5) { this.crown.setMatrixAt(k * 12 + j, this.hide); continue; }
          const a = j / 12 * PI * 2 + hash(j + k * 31) * 0.4, sp = 0.5 + hash(j * 3 + k) * 0.9, up = 1.4 + hash(j * 7 + k) * 1.3;
          d.position.set(L[0] + Math.cos(a) * sp * age * 0.55, Math.max(0.013, up * age - 4.9 * age * age), L[1] + Math.sin(a) * sp * age * 0.55); d.scale.setScalar(0.8 + hash(j + 5) * 0.6); d.rotation.set(0, 0, 0); d.updateMatrix(); this.crown.setMatrixAt(k * 12 + j, d.matrix);
        }
      }
    }
    this.stain.material.opacity = 0.75 * seg(t, T_BLOOD - 2.4, T_BLOOD - 0.2); this.stain.scale.setScalar(0.35 + 0.5 * seg(t, T_BLOOD - 2.6, T_BLOOD));
    this.drops.instanceMatrix.needsUpdate = true; this.splats.instanceMatrix.needsUpdate = true; this.crown.instanceMatrix.needsUpdate = true;
    // otilgan joydan qon sachrashi
    let n = 0;
    for (const h of hits) {
      const age = t - h.t;
      for (let j = 0; j < 16; j++, n++) {
        if (age < 0 || age > 0.9) { this.spray.setMatrixAt(n, this.hide); continue; }
        const a = hash(h.id * 31 + j) * PI * 2, sp = 0.8 + hash(h.id * 17 + j) * 1.6, up = 0.6 + hash(h.id * 13 + j) * 1.4;
        d.position.set(h.x + Math.cos(a) * sp * age * 0.6, Math.max(0.03, h.y + up * age - 4.9 * age * age), h.z + 0.3 * age * sp + Math.sin(a) * sp * age * 0.4 + 0.2 * age);
        d.scale.setScalar(0.7 + hash(j + h.id) * 0.8); d.rotation.set(0, 0, 0); d.updateMatrix(); this.spray.setMatrixAt(n, d.matrix);
      }
    }
    for (; n < this.spray.count; n++) this.spray.setMatrixAt(n, this.hide);
    this.spray.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------------- buyumlar: fanar va to'pponcha
function mkTorch() {
  const g = new THREE.Group(), met = new THREE.MeshStandardMaterial({ color: 0x23252a, metalness: 0.75, roughness: 0.35 }), rub = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.9 });
  const cyl = (r1, r2, h, m, z) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 14), m); c.rotation.x = PI / 2; c.position.z = z; c.castShadow = true; g.add(c); return c; };
  cyl(0.022, 0.022, 0.19, met, 0); for (const z of [-0.06, -0.02, 0.02]) cyl(0.0235, 0.0235, 0.018, rub, z);
  cyl(0.04, 0.026, 0.06, met, 0.12);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.036, 20), new THREE.MeshBasicMaterial({ color: 0xfff6dc })); lens.position.z = 0.152; g.add(lens);
  return g;
}
function mkGun() {
  const g = new THREE.Group(), met = new THREE.MeshStandardMaterial({ color: 0x14151a, metalness: 0.85, roughness: 0.3 }), poly = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.7 });
  const box = (w, h, d, x, y, z, m, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; b.castShadow = true; g.add(b); return b; };
  g.slide = box(0.03, 0.034, 0.18, 0, 0.034, 0.06, met);
  box(0.028, 0.026, 0.17, 0, 0.005, 0.055, poly);                 // ramka
  box(0.027, 0.085, 0.036, 0, -0.04, -0.015, poly, -0.22);          // dasta
  box(0.004, 0.012, 0.004, 0, 0.056, 0.14, met); box(0.012, 0.01, 0.006, 0, 0.056, -0.018, met);      // nishon tishlari
  const tg = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0028, 6, 12, PI), met); tg.rotation.set(0, PI / 2, PI); tg.position.set(0, -0.012, 0.045); g.add(tg);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 10), met); bar.rotation.x = PI / 2; bar.position.set(0, 0.034, 0.165); g.add(bar);
  return g;
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();

export class Cine {
  static async create(scene) {
    const c = new Cine(scene);
    try { await c._build(); } catch (e) { console.warn('badroom', e); return null; }
    return c;
  }
  constructor(scene) {
    this.scene = scene; this.active = false; this.ct = 0; this.audioH = null; this.fired = new Set(); this.env = null; this.shake = 0; this.post = null;
    this.G = new THREE.Group(); this.G.position.set(OX, 0, OZ); this.G.visible = false; scene.add(this.G);
    this.lights = new THREE.Group(); scene.add(this.lights);      // yorug'liklar doim sahnada (soni o'zgarmasin) — faqat intensivligi o'zgaradi
    const pl = (col, dist) => { const l = new THREE.PointLight(col, 0, dist, 2); this.lights.add(l); return l; };
    const sp = (col, dist, ang, pen, ms = 1024) => { const s = new THREE.SpotLight(col, 0, dist, ang, pen, 1.6); s.shadow.mapSize.set(ms, ms); s.shadow.bias = -0.0004; s.shadow.normalBias = 0.025; s.shadow.camera.near = 0.15; this.lights.add(s, s.target); return s; };
    this.tubeL = pl(0xdbe6ff, 9); this.tubeL.position.set(OX - 0.4, 3.05, OZ + 0.25);
    this.red = pl(0xff1a14, 13); this.red.position.set(OX + 0.3, 2.9, OZ - 0.9);
    this.doorL = pl(0x7a9cff, 6); this.doorL.position.set(OX + DOOR.x, 1.8, OZ + WALL_Z - 0.3);
    this.muz = [pl(0xffb050, 6), pl(0xffb050, 6)];
    this.key = pl(0xffe0c4, 8);                     // kameraga biriktirilgan yumshoq "asosiy" yorug'lik (yaqin planlarda yuzlar ko'rinishi uchun)
    this.spots = [sp(0xfff1d6, 15, 0.46, 0.55), sp(0xfff1d6, 15, 0.46, 0.55)];
    this.moon = sp(0x7f9dff, 14, 0.62, 0.6, 1024); this.moon.position.set(OX - 0.5, 3.0, OZ - 3.85); this.moon.target.position.set(OX - 0.5, 0, OZ + 0.7);
    const st = document.createElement('canvas'); st.width = 64; st.height = 256; const sx = st.getContext('2d'); sx.fillStyle = '#fff'; sx.fillRect(0, 0, 64, 256); sx.fillStyle = '#707070';
    for (let k = 0; k < 16; k++) sx.fillRect(0, k * 16 + 9, 64, 7);       // jalyuzi plastinkalari
    this.moon.map = new THREE.CanvasTexture(st);
    this.doorS = sp(0xffd9a0, 12, 0.55, 0.6, 1024); this.doorS.position.set(OX + DOOR.x, 2.4, OZ + WALL_Z - 0.22); this.doorS.target.position.set(OX + DOOR.x + 0.1, 0.1, OZ + 0.4);
    this.focus = new THREE.Vector3(); this.camTmp = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.el = { fade: document.getElementById('hzFade'), bars: document.getElementById('hzBars') };
    this.casters = [...this.spots, this.moon, this.doorS];
  }
  async _build() {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync('/horror/models/badroom.glb');
    const model = gltf.scene; model.position.set(...MODEL_OFF);
    model.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; const m = o.material; if (m && m.map) m.map.anisotropy = 4; } });
    this.G.add(model);
    // --- eshik xonachasi: devordan xonaga chiqib turgan qorong'i "kirish" (killer shu yerdan chiqadi)
    const wallM = new THREE.MeshStandardMaterial({ color: 0x25352f, roughness: 1 }), black = new THREE.MeshStandardMaterial({ color: 0x050404, roughness: 1, side: THREE.DoubleSide });
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1f, roughness: 0.85 });
    const al = new THREE.Group(); this.G.add(al);
    const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; al.add(b); return b; };
    const cz = WALL_Z - DEPTH / 2, ax = DOOR.x, hw = DOOR.w / 2;
    box(0.14, DOOR.h + 0.2, DEPTH, ax - hw - 0.07, (DOOR.h + 0.2) / 2, cz, wallM); box(0.14, DOOR.h + 0.2, DEPTH, ax + hw + 0.07, (DOOR.h + 0.2) / 2, cz, wallM);
    box(DOOR.w + 0.28, 0.2, DEPTH, ax, DOOR.h + 0.1, cz, wallM);
    const inner = (w, h, x, y, z, ry) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), black); p.position.set(x, y, z); p.rotation.y = ry; al.add(p); };
    inner(DEPTH, DOOR.h, ax - hw, DOOR.h / 2, cz, PI / 2); inner(DEPTH, DOOR.h, ax + hw, DOOR.h / 2, cz, PI / 2); inner(DOOR.w, DOOR.h, ax, DOOR.h / 2, WALL_Z - 0.01, 0);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.w, DEPTH), new THREE.MeshStandardMaterial({ color: 0x120e0d, roughness: 0.6 })); fl.rotation.x = -PI / 2; fl.position.set(ax, 0.015, cz); fl.receiveShadow = true; al.add(fl);
    const ce = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.w, DEPTH), black); ce.rotation.x = PI / 2; ce.position.set(ax, DOOR.h, cz); al.add(ce);
    // ramka va panjara (sharnir o'ng tomonda, panjara xonaga ochiladi)
    const dg = new THREE.Group(); dg.position.set(ax, 0, DOOR.z); this.G.add(dg);
    const fr = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.16), wood); m.position.set(x, y, 0); m.castShadow = true; dg.add(m); };
    fr(0.1, DOOR.h + 0.1, -hw - 0.05, DOOR.h / 2 + 0.05); fr(0.1, DOOR.h + 0.1, hw + 0.05, DOOR.h / 2 + 0.05); fr(DOOR.w + 0.2, 0.1, 0, DOOR.h + 0.05);
    this.hinge = new THREE.Group(); this.hinge.position.set(HINGE, 0, 0); dg.add(this.hinge);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w, DOOR.h, 0.06), wood); leaf.position.set(-HINGE, DOOR.h / 2, 0); leaf.castShadow = leaf.receiveShadow = true; this.hinge.add(leaf);
    const panelM = new THREE.MeshStandardMaterial({ color: 0x35201a, roughness: 0.9 });
    for (const [py, ph] of [[0.62, 0.8], [1.95, 0.9]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(DOOR.w - 0.3, ph, 0.02), panelM); p.position.set(-HINGE, py, -0.035); this.hinge.add(p); }
    this.knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.85, roughness: 0.28 })); this.knob.position.set(-DOOR.w + 0.12, 1.0, -0.07); this.hinge.add(this.knob);
    // shiftdagi lyuminessent lampa (9.9 da portlaydi)
    const fx = new THREE.Group(); fx.position.set(-0.4, CEIL - 0.04, 0.25); this.G.add(fx);
    const hous = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.07, 0.2), new THREE.MeshStandardMaterial({ color: 0x8a8d8a, roughness: 0.6, metalness: 0.4 })); fx.add(hous);
    this.tubeMat = new THREE.MeshBasicMaterial({ color: 0xdfe9ff }); const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.15, 10), this.tubeMat); tube.rotation.z = PI / 2; tube.position.y = -0.045; fx.add(tube);
    this.blood = new Blood(this.G); this.blood.setVisible(false);
    // effektlar
    this.beams = new Beams(this.G, 4); this.dust = new Dust(this.G); this.dust.setVisible(false);
    this.smoke = new Smoke(this.G); this.casings = new Casings(this.G); this.sparks = new Sparks(this.G);
    const stt = starTex();
    this.flashSp = [0, 1].map(() => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: stt, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); s.scale.setScalar(0.01); this.G.add(s); return s; });
    this.tracers = SHOTS.map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 1), new THREE.MeshBasicMaterial({ color: 0xffe9a8, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); m.visible = false; this.G.add(m); return m; });
    this.phase = [buildPhase(0), buildPhase(1)];
  }

  async begin({ aDef, bDef, audio, pitchA = 1, pitchB = 1 }) {
    this.end(true);
    this.audio = audio; this.pitch = [pitchA, pitchB];
    const [A, B, K] = await Promise.all([createActor(aDef, { rig: true }), createActor(bDef, { rig: true }), createActor(KILLER_DEF)]);
    this.actors = [A, B]; this.killer = K;
    for (const a of [A, B]) a.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    K.root.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0x1a0f0f); o.material.emissiveIntensity = 0.55; } } });
    this.pg = [A, B].map(a => { const g = new THREE.Group(); g.add(a.root); this.G.add(g); return g; });
    this.killerG = new THREE.Group(); this.killerG.add(K.root); this.G.add(this.killerG); this.killerG.visible = false;
    if (K.actions[0]) K.actions[0].paused = false;
    this.kFeet = []; K.inner.traverse(o => { if (o.isBone && /(toe|hand_J)/i.test(o.name) && !/(thumb|index|middle|ring|pinkie)/i.test(o.name)) this.kFeet.push(o); }); this.groundY = null;
    const kb = n => { let f = null; K.inner.traverse(o => { if (!f && o.isBone && o.name.includes(n)) f = o; }); return f; };
    this.kb = { jaw: kb('C_jaw__J_026'), head: kb('C_Head_J_023'), neck: kb('C_Neck_J_022'), s3: kb('C_spine_03'), s4: kb('C_spine_04') };
    this.torch = [mkTorch(), mkTorch()]; this.gun = [mkGun(), mkGun()];
    for (const p of [...this.torch, ...this.gun]) this.G.add(p);
    for (const g of this.gun) g.visible = false;
    for (const l of this.casters) l.castShadow = true;               // soyalar faqat kadr paytida (asosiy o'yinda qo'shimcha yuk bo'lmasin)
    this.G.visible = true; this.blood.setVisible(true); this.dust.setVisible(true); this.smoke.reset(); this.casings.reset(); this.sparks.reset();
    this.lowFx = false; this._n = 0; this._ema = 0; this._lt = 0;
    this.fired = new Set(); this.ct = 0; this.active = true; this.prevT = 0; this.stepIdx = [0, 0]; this._kAnim = 0; this._ks = 0;
    this.audioH = audio && audio.ready ? audio.playCine() : null;
    this.env = this.audioH && this.audioH.env ? this.audioH.env : null;
    document.body.classList.add('cine');
  }
  end(silent = false) {
    if (this.audioH && this.audio) { this.audio.stopCine(this.audioH); }
    this.audioH = null;
    if (this.pg) { for (const g of this.pg) this.G.remove(g); this.pg = null; }
    if (this.killerG) { this.G.remove(this.killerG); this.killerG = null; }
    for (const p of [...(this.torch || []), ...(this.gun || [])]) this.G.remove(p);
    this.torch = this.gun = null;
    this.actors = null; this.killer = null;
    this.G.visible = false; this.active = false; if (this.blood) this.blood.setVisible(false); if (this.dust) this.dust.setVisible(false); if (this.beams) this.beams.hide();
    for (const l of this.lights.children) if (l.isLight) l.intensity = 0;
    for (const l of this.casters) l.castShadow = false;
    document.body.classList.remove('cine');
    if (this.el.fade && !silent) { const f = this.el.fade; f.style.transition = 'opacity .9s ease'; f.style.opacity = 0; setTimeout(() => { f.style.transition = 'none'; }, 1000); } else if (this.el.fade) this.el.fade.style.opacity = 0;
    if (!silent && this.el.bars) this.el.bars.classList.remove('on');
  }
  dispose() { this.end(true); if (this.post) { this.post.dispose(); this.post = null; } }

  envAt(t) {
    if (this.env) { const i = t * 10, a = this.env[clamp(Math.floor(i), 0, this.env.length - 1)] || 0, b = this.env[clamp(Math.floor(i) + 1, 0, this.env.length - 1)] || 0; return mix(a, b, i - Math.floor(i)); }
    return 0.5 + 0.3 * Math.sin(t * 5.1) * Math.sin(t * 1.7);
  }
  _time(dt) {
    if (this.forceT != null) return this.forceT;
    if (this.audioH && this.audio && this.audio.ctx) return Math.max(0, this.audio.ctx.currentTime - this.audioH.startAt);
    return this.ct + dt;
  }

  // killer joyi (xona koordinatalarida): yaqinlashadi (0.62 m/s), o't ochilgach o'girilib orqaga yugurib eshikka qochadi
  _killerPos(t) {
    const zf = 3.98 - 0.62 * (T_FLEE - 18.4);
    let z, fleeing = false, turn = 0;
    if (t < T_FLEE) z = 3.98 - 0.62 * Math.max(0, t - 18.4);
    else { const tau = Math.max(0, t - T_FLEE - 0.4); turn = seg(t, T_FLEE, T_FLEE + 0.4); z = zf + 2.4 * tau + 2.6 * tau * tau; fleeing = tau > 0; }
    const p = 1 - clamp((z - 1) / 3, 0, 1);
    return { x: mix(DOOR.x, -0.12, p), z, fleeing, turn, walking: t > 18.4 && t < T_FLEE };
  }

  // qayerga qarayapti (xona koordinatalarida) — bosh va fanar shu tomonga buriladi
  _lookPoint(i, t, bp, kp, A, B) {
    const L0 = LEAKS[0], L1 = LEAKS[1], other = i ? A : B;
    const drop = (k, ts) => { const tau = t - ts; return V(LEAKS[k][0], Math.max(0.05, CEIL - 4.9 * tau * tau), LEAKS[k][1]); };
    const ph = [
      [0, () => V(bp.x + Math.sin(bp.yaw) * 3 + Math.sin(t * 0.9 + i * 1.7) * 1.1, 1.25, bp.z + Math.cos(bp.yaw) * 3)],
      [4.0, () => V(DOOR.x, 1.4, DOOR.z)],
      [5.3, () => i ? V(2.6, 0.9, 0.6 + 2.2 * Math.sin(t * 0.62 + 1)) : V(-2.8, 0.9 + 0.3 * Math.sin(t * 1.3), 0.6 + 2.2 * Math.sin(t * 0.75))],
      [9.5, () => V(-0.4, CEIL, 0.25)],
      [10.15, () => V(L0[0], CEIL, L0[1])],
      [T_BLOOD + 0.05, () => drop(0, T_BLOOD)],
      [T_BLOOD + 0.84, () => V(L0[0], 0.03, L0[1])],
      [12.5, () => V(L0[0], CEIL, L0[1])],
      [13.0, () => V(L1[0], CEIL, L1[1])],
      [T_DROP2 + 0.05, () => drop(1, T_DROP2)],
      [T_DROP2 + 0.84, () => V(L1[0], 0.03, L1[1])],
      [15.0, () => V(other.x, 1.15, other.z)],
      [15.9, () => V(bp.x + Math.sin(bp.yaw) * 3, 1.2, bp.z + Math.cos(bp.yaw) * 3 + Math.sin(t * 1.4) * 1.5)],
      [16.35, () => V(DOOR.x - 0.4, 1.0, DOOR.z)],
      [T_TURN, () => V(kp.x, 1.5, kp.z)],
    ];
    let k = 0; for (let j = 0; j < ph.length; j++) if (t >= ph[j][0]) k = j;
    const cur = ph[k][1]();
    if (k > 0) cur.lerp(ph[k - 1][1](), 1 - seg(t, ph[k][0], ph[k][0] + 0.3));
    return cur;
  }

  // qahramonning t paytdagi holati
  _pose(i, t, env, kp, A, B) {
    const bp = basePath(i, t), mo = motion(i, t), a = this.actors[i];
    let x = bp.x, z = bp.z, yaw = bp.yaw;
    const mv = clamp((mo.v - 0.22) / 0.25, 0, 1) * (1 - seg(t, 11.8, 13.2) * (1 - seg(t, 17.0, 17.9)));
    if (mv > 0) yaw = angMix(yaw, mo.heading, mv);
    const phi = phaseAt(this.phase[i], t);
    const run = clamp((mo.v - 1.0) / 1.5, 0, 1), ampW = clamp(mo.v / 0.45, 0, 1);
    const fear = clamp(seg(t, 4.2, 18) * 0.55 + seg(t, 9.9, 18) * 0.35, 0, 1);
    const aim = seg(t, T_DRAW, T_DRAW + 0.45) * (1 - seg(t, T_FLEE + 0.9, T_FLEE + 1.6));
    const sw = (0.4 + 0.5 * run) * ampW, kn = (0.5 + 0.6 * run) * ampW, asw = (0.45 + 0.55 * run) * ampW;
    // qarash nuqtasi -> bosh va tana burilishi
    const lp = this._lookPoint(i, t, bp, kp, A, B), hx = lp.x - x, hz = lp.z - z, hy = lp.y - 1.15;
    const rel = wrap(Math.atan2(hx, hz) - yaw), pitch = Math.atan2(hy, Math.hypot(hx, hz));
    const hasHead = !!(a.rig && a.rig.b.head);
    const twist = hasHead ? clamp(rel * 0.45, -0.6, 0.6) : 0, headYaw = hasHead ? clamp(rel - twist, -1.05, 1.05) : 0;
    if (!hasHead) yaw += clamp(rel * 0.4, -0.7, 0.7) * (1 - mv);              // quyonda bosh alohida emas: butun gavda biroz buriladi
    const headPitch = clamp(pitch, -0.7, 0.85);
    const s0 = Math.sin(phi), s1 = Math.sin(phi + PI);
    const L = { lLeg: sw * s0, rLeg: sw * s1, lKnee: kn * Math.max(0, Math.cos(phi) * 0.9) + 0.04, rKnee: kn * Math.max(0, Math.cos(phi + PI) * 0.9) + 0.04 };
    const torchUp = 1.1 + clamp(pitch, 0, 1) * 0.9, breathe = Math.sin(t * 1.9 + i) * 0.03;
    L.lArm = mix(torchUp + 0.07 * s1 * ampW, 1.3, aim) + breathe; L.lElbow = mix(0.5 - 0.1 * clamp(pitch, 0, 1), 0.55, aim) + 0.05 * Math.abs(s1) * ampW;
    const free = -asw * s0 + 0.05 * Math.sin(t * 1.4 + i * 2) * (1 - ampW);
    const kick = SHOTS.reduce((m, [ts, who]) => (who === i ? Math.max(m, Math.exp(-(t - ts) * 14) * (t >= ts ? 1 : 0)) : m), 0);
    L.rArm = mix(free, 1.5 + 0.22 * kick, aim); L.rElbow = mix(0.12 + 0.35 * Math.max(0, -s0) * ampW, 0.1 + 0.15 * kick, aim);
    // gavda: qadam tebranishi, nafas, cho'chish, qo'rquvdan titrash
    let y = 0.03 * Math.abs(Math.sin(phi)) * ampW * (1 + run);
    const beat = Math.abs(Math.sin(t * 5.2 + i * 1.3)); y += env * 0.01 * beat * seg(t, 5, 7) * (1 - ampW);
    const startle = (t0, h = 0.14, d = 0.5) => (t > t0 && t < t0 + d ? h * Math.sin(PI * (t - t0) / d) : 0);
    y += startle(T_SLAM, 0.28, 0.7) + startle(T_TURN, 0.18, 0.6) + startle(T_BLOOD + 0.82, 0.1, 0.5) + startle(T_TUBE, 0.12, 0.4);
    const shake = fear * (0.5 + env) * 0.007 * (1 - ampW);
    x += Math.sin(t * 47 + i * 5) * shake; z += Math.cos(t * 41 + i * 3) * shake; yaw += Math.sin(t * 29 + i) * shake * 2.5;
    // cho'chib orqaga tisarilish (18.0 da)
    const back = t > T_TURN && t < T_TURN + 0.9 ? 0.22 * Math.sin(PI * (t - T_TURN) / 0.9) : 0;
    x -= Math.sin(yaw) * back; z -= Math.cos(yaw) * back;
    const flinch = Math.max(startle(T_SLAM, 1, 0.5), startle(T_TURN, 1, 0.6), startle(T_TUBE, 1, 0.4));
    const lean = -0.2 * flinch - 0.2 * clamp(pitch, 0, 1) * (1 - aim) + 0.12 * run + 0.16 * kick - 0.03 * aim;
    const sway = Math.sin(t * 2.6 + i * 1.7) * 0.025 * (0.3 + env * 1.2) * seg(t, 5, 7) * (1 - ampW) + Math.sin(phi) * 0.045 * ampW;
    L.twist = twist + Math.sin(phi) * 0.14 * ampW; L.headYaw = headYaw - Math.sin(phi) * 0.07 * ampW; L.headPitch = headPitch; L.spinePitch = -0.22 * flinch + 0.12 * kick + 0.04 * fear; L.breath = Math.sin(t * 2.1 + i * 0.8) * 0.045 * (0.6 + fear);
    return { x, z, yaw, y, sway, lean, aim, L, ampW, phi, run, kick, lp, faceYaw: yaw + (L.twist || 0) + (L.headYaw || 0) };
  }

  _sound(t, dt, fear) {
    const a = this.audio; if (!a || !a.ready) return;
    const once = (key, at, fn) => { if (t >= at && !this.fired.has(key)) { this.fired.add(key); if (t < at + 1.5) fn(); } };
    once('c0', 0.1, () => a.creak(null, null, 0.5));
    once('slam', T_SLAM, () => { a.slam(null, null, 1); a.stinger(0.7); this.shake = 1; });
    once('gA', T_SLAM + 0.05, () => a.gasp(this.pitch[0]));
    once('zap', T_TUBE, () => { a.zap(); this.shake = 0.5; });
    once('gB', T_TUBE + 0.12, () => a.gasp(this.pitch[1]));
    once('b1', T_BLOOD + 0.82, () => { a.drip(1); this.shake = 0.4; });
    once('b2', T_DROP2 + 0.82, () => { a.drip(0.9); });
    once('rat', T_RATTLE, () => { a.thud(null, null, 0.5, 1.1); a.creak(null, null, 0.4); });
    once('open', T_OPEN, () => a.creak(null, null, 0.9));
    once('stg', T_TURN, () => { a.stinger(1); this.shake = 1.2; a.gasp(this.pitch[0]); });
    once('gr', 18.5, () => a.growl(null, null, 0.9));
    once('sA', 18.35, () => a.scream({ pitch: this.pitch[0], vol: 1.1, loud: true }));
    once('sB', 18.7, () => a.scream({ pitch: this.pitch[1], vol: 1.1, loud: true }));
    SHOTS.forEach(([ts], k) => { once('shot' + k, ts, () => { a.shot(null, null); this.shake = Math.max(this.shake, 0.5); if (k === 0) this.onEvent && this.onEvent('splat', 2); }); once('cas' + k, ts + 0.38, () => a.casing()); });
    once('roar', T_FLEE, () => { a.growl(null, null, 1.2); a.scream({ pitch: 0.45, vol: 1.3, loud: true }); a.stinger(1); this.shake = 1.2; this.onEvent && this.onEvent('splat', 6); });
    once('open2', 19.35, () => a.creak(null, null, 0.8));
    once('hitwall', 20.35, () => { a.thud(null, null, 0.7, 1.4); this.shake = 0.7; });
    once('dark', T_SLAM2, () => { a.slam(null, null, 1.2); a.thud(null, null, 1, 1.5); this.shake = 1.5; });
    once('far', T_SLAM2 + 0.6, () => a.growl(null, null, 0.5));
    // yurak urishi (qo'rquv kuchayib boradi)
    if (t > 5 && t < T_DARK) a.heartbeat(fear, dt);
    // qadam tovushlari (oyoq yerga tekkanda) va killerning og'ir qadamlari
    for (let i = 0; i < 2; i++) {
      const p = this._cache ? this._cache[i] : null; if (!p) continue;
      const idx = Math.floor(p.phi / PI);
      if (idx !== this.stepIdx[i]) { if (p.ampW > 0.3 && t < T_DARK) a.step(null, null, 0.07 + 0.1 * p.run, p.run > 0.4); this.stepIdx[i] = idx; }
    }
    this._ks -= dt; const kp = this._killerPos(t);
    if ((kp.walking || kp.fleeing) && this._ks <= 0 && t > 18.6 && kp.z < 3.6) { this._ks = kp.fleeing ? 0.3 : 0.95; a.thud(null, null, kp.fleeing ? 0.6 : 0.4, 1.3); }
  }

  // ---------------------------------------------------------------------------------------------------- kamera rejasi (kesishlar)
  _camera(t, poses, kp) {
    const o = this.camTmp, A = poses[0], B = poses[1], mid = V((A.x + B.x) / 2, 1.0, (A.z + B.z) / 2), out = { fov: 50, roll: 0, sh: 0.004, cut: 0 };
    const door = V(DOOR.x + 0.1, 1.3, mix(3.0, 1.5, seg(t, 19, 22.4)));
    const L0 = LEAKS[0], face = (p, d) => V(p.x + Math.sin(p.faceYaw) * d, 1.02, p.z + Math.cos(p.faceYaw) * d);
    let pos, tgt;
    if (t < 3.4) {                                           // 1) eshik tomon: yorug' eshikdan siluet bo'lib chiqishadi
      pos = V(DOOR.x + 0.8, 1.0 + 0.05 * seg(t, 0, 3.4), 0.5 - 0.5 * seg(t, 0, 3.4));
      tgt = V(DOOR.x - 0.05, 1.12, 3.6).lerp(V(mid.x, 1.05, mid.z), seg(t, 1.2, 3.2)); out.fov = 50 - 4 * seg(t, 0, 3.4); out.sh = 0.003; out.cut = 1;
    } else if (t < 6.2) {                                    // 2) burchakdan keng ko'rinish: eshik yopilishi
      pos = V(mix(-3.0, -2.7, seg(t, 3.4, 6.2)), mix(2.35, 2.2, seg(t, 3.4, 6.2)), mix(-3.55, -3.3, seg(t, 3.4, 6.2)));
      tgt = V(-0.6, 1.15, 1.8).lerp(V(mid.x, 1.0, mid.z), seg(t, 4.6, 6.2)); out.fov = 56; out.cut = 2;
    } else if (t < 9.6) {                                    // 3) yon tomondan kuzatish (aylanib)
      const th = mix(4.3, 5.1, seg(t, 6.2, 9.6)); pos = V(mid.x + Math.cos(th) * 2.9, 1.3, mid.z + Math.sin(th) * 2.9);
      tgt = V(mid.x, 1.0, mid.z); out.fov = 46; out.cut = 3;
    } else if (t < 10.1) {                                   // 4a) lyuminessent lampa portlaydi
      pos = V(-1.6, 1.5, -0.9); tgt = V(-0.4, 3.0, 0.25); out.fov = 50; out.sh = 0.006; out.cut = 4;
    } else if (t < T_BLOOD) {                                // 4b) shiftdagi qon bo'rtmasi
      pos = V(-1.75, 1.95, -0.95); tgt = V(L0[0], CEIL - 0.1, L0[1]); out.fov = 34; out.cut = 5;
    } else if (t < T_BLOOD + 0.84) {                         // 4c) tomchi bilan birga pastga
      const dp = this.blood.dropPos(0, t); pos = V(-1.45, 1.55, -1.3); tgt = dp ? dp.clone() : V(L0[0], 0.05, L0[1]); out.fov = 36; out.cut = 5;
    } else if (t < 12.5) {                                   // 4d) yerdagi dog'
      pos = V(mix(-1.2, -1.0, seg(t, 11.74, 12.5)), 0.65, -1.4); tgt = V(L0[0], 0.14, L0[1]); out.fov = 36; out.cut = 6;
    } else if (t < 14.0) {                                   // 5) Mashaning yuzi (yaqin plan)
      const f = face(A, 1.3 - 0.15 * seg(t, 12.5, 14)); pos = V(f.x + Math.cos(A.faceYaw) * 0.15, 1.02, f.z); tgt = V(A.x, 1.08, A.z); out.fov = 32; out.cut = 7;
    } else if (t < T_RATTLE - 0.1) {                         // 6) ikkalasiga sekin yaqinlashish
      const k = seg(t, 14.0, T_RATTLE); pos = V(mix(-2.55, -2.0, k), 1.3, mix(-1.25, -0.8, k)); tgt = V(mid.x, 1.0, mid.z); out.fov = 40; out.cut = 8;
    } else if (t < 17.55) {                                  // 7) eshik tutqichi qaltiraydi (yaqin plan)
      const k = seg(t, T_RATTLE, 17.55); pos = V(DOOR.x + 0.55 - 0.15 * k, 1.15, 1.55 + 0.1 * k); tgt = V(-0.93, 1.0, DOOR.z - 0.07); out.fov = 30; out.sh = 0.005; out.cut = 9;
    } else if (t < T_TURN) {                                 // 8) Mashaning ko'zlari — eshikka qaraydi
      const k = seg(t, 17.55, T_TURN); const f = face(A, 1.2 - 0.1 * k); pos = V(f.x - 0.1, 1.04, f.z); tgt = V(A.x, 1.1, A.z); out.fov = 28; out.cut = 10;
    } else {                                                 // 9) 18-soniya: kamera eshikka burilib qoladi (elka ustidan)
      const k = seg(t, T_TURN, 25.5);
      pos = V(mix(-2.75, -2.35, k), mix(1.7, 1.55, k), mix(-2.3, -1.6, k));      // orqa-yon diagonal: eshik chapda, qurolli ikkalasi o'ngda, killer ular tomon yuradi
      const kt = V(kp.x, 1.2, Math.min(kp.z, 3.2)); tgt = V(0.05, 1.15, 1.4).lerp(kt, 0.3 * seg(t, 22.5, 24)); out.fov = mix(46, 38, k); out.roll = 0.03 * seg(t, T_TURN, 24); out.sh = 0.004; out.cut = 11;
    }
    o.pos.copy(pos); o.target.copy(tgt); out.pos = o.pos; out.target = o.target; return out;
  }

  // har kadr: qahramonlar, killer, yorug'lik, kamera. Qaytaradi: tugadimi
  update(dt, camera, game) {
    const t = this.ct = this._time(dt);
    const env = this.envAt(t), G = this.G, Gp = G.position;
    this.shake = Math.max(0, (this.shake || 0) - dt * 1.6);
    // --- eshik
    let ang = -1.45;
    if (t >= T_SLAM) ang = mix(-1.45, 0, seg(t, T_SLAM - 0.05, T_SLAM + 0.12));
    const knock = (t0) => t > t0 && t < t0 + 0.35 ? Math.sin(PI * (t - t0) / 0.35) * 0.05 : 0;
    this.knob.rotation.z = t > T_RATTLE && t < T_OPEN ? Math.sin(t * 60) * 0.35 * seg(t, T_RATTLE, T_RATTLE + 0.3) : 0;
    if (t > T_RATTLE && t < T_OPEN) ang -= knock(16.75) + knock(17.0);
    if (t > T_OPEN) {
      const crack = -0.5 * seg(t, T_OPEN, 18.9) + 0.03 * Math.sin((t - T_OPEN) * 11) * seg(t, T_OPEN, T_OPEN + 0.5) * (1 - seg(t, 18.4, 18.9));
      const push = -1.12 * seg(t, 19.3, 20.35), bounce = 0.1 * Math.sin(PI * clamp((t - 20.35) / 0.55, 0, 1)) * (1 - clamp((t - 20.35) / 0.55, 0, 1));
      ang = crack + push + bounce;
    }
    if (t > T_SLAM2 - 0.1) { const k = clamp((t - (T_SLAM2 - 0.1)) / 0.16, 0, 1); ang = mix(ang, 0, k * k) - 0.16 * Math.sin(PI * clamp((t - T_SLAM2 - 0.06) / 0.3, 0, 1)) * (1 - clamp((t - T_SLAM2) / 0.5, 0, 1)); }
    this.hinge.rotation.y = ang;
    // --- killer va qahramonlar
    const kp = this._killerPos(t), K = this.killer;
    const pa = basePath(0, t), pb = basePath(1, t);
    const poses = [this._pose(0, t, env, kp, pa, pb), this._pose(1, t, env, kp, pa, pb)]; this._cache = poses;
    const fresh = SHOTS.reduce((m, [ts]) => Math.max(m, t >= ts ? Math.exp(-(t - ts) * 9) : 0), 0);
    const hits = SHOTS.map(([ts], id) => ({ id, t: ts + 0.08, x: kp.x, y: 1.3, z: kp.z - 0.35 }));
    const tipK = V(OX + kp.x, 1.3, OZ + kp.z);
    const aimDirs = [];
    for (let i = 0; i < 2; i++) {
      const p = poses[i], g = this.pg[i], a = this.actors[i];
      g.position.set(p.x, p.y, p.z); g.rotation.y = p.yaw; g.updateMatrixWorld(true);
      a.root.rotation.set(p.lean, 0, p.sway);
      if (a.rig) {
        poseRig(a.rig, p.L);
        // nishonga olish: o'ng qo'l to'pponcha bilan to'g'ri, chap qo'l (fanar) uni tutib turadi — ikki qo'llab
        if (p.aim > 0.001) {
          const kt = tipK.clone(); kt.y += p.kick * 0.28 + nz(t * 3, i) * 0.012;
          const S = a.rig.b.rArm.getWorldPosition(_v1).clone(), dir = kt.clone().sub(S).normalize();
          ikArm(a.rig, 'r', S.clone().addScaledVector(dir, 4), p.aim, 0.985);
          const rh = handPos(a.rig, 'r', _v2).clone(); const right = _v3.crossVectors(dir, UP).normalize();
          const tl = rh.clone().addScaledVector(right, -0.035).addScaledVector(UP, -0.045).addScaledVector(dir, -0.02);
          if (a.rig.noFore) ikArm(a.rig, 'l', S.clone().addScaledVector(dir, 4), p.aim); else ikArm(a.rig, 'l', tl, p.aim, 0.97);
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      const p = poses[i], a = this.actors[i];
      const lp = handPos(a.rig, 'l', _v1).clone(), rp = handPos(a.rig, 'r', _v2).clone();
      const fy = p.yaw, fx = Math.sin(fy), fz = Math.cos(fy);
      // fanar yo'nalishi: qarayotgan tomonga (tana oldiga qarab chegaralangan), nishonlashda — killerga
      const lookW = V(OX + p.lp.x, p.lp.y, OZ + p.lp.z), dirLook = lookW.clone().sub(lp).normalize();
      const fwd = V(fx, 0, fz), ang = Math.acos(clamp(dirLook.dot(fwd), -1, 1));
      const dirIdle = dirLook.clone().lerp(V(fx, -0.1, fz), clamp((ang - 0.9) / 0.9, 0, 1)).normalize();
      const dirAimT = tipK.clone().sub(lp).normalize(), dirAimG = tipK.clone().sub(rp).normalize();
      const td = dirIdle.clone().lerp(dirAimT, p.aim).normalize();
      const torch = this.torch[i]; torch.position.copy(lp).addScaledVector(td, 0.05).sub(Gp); torch.quaternion.setFromUnitVectors(Z, td);
      const gun = this.gun[i]; gun.visible = p.aim > 0.08;
      const gdir = V(fx, -0.25, fz).normalize().lerp(dirAimG, clamp(p.aim * 1.2, 0, 1)).normalize();
      gun.position.copy(rp).sub(Gp).addScaledVector(gdir, 0.045); gun.quaternion.setFromUnitVectors(Z, gdir); gun.slide.position.z = 0.06 - 0.025 * p.kick;
      aimDirs[i] = { td, gdir, lp, rp };
      // fanar: nur (soya bilan), oldinga yo'nalgan
      const s = this.spots[i], dark = t > T_DARK - 0.1;
      const flick = (t > 18 && Math.sin(t * 53 + i * 9) * Math.sin(t * 17) > 0.74) ? 0.2 : 1;
      s.position.copy(lp).addScaledVector(td, 0.18); s.target.position.copy(lp).addScaledVector(td, 4);
      s.intensity = dark ? 0 : (30 - 12 * p.aim) * flick * seg(t, 0.3, 1.0);
      // o't ochish: yorug'lik, chaqnash, tutun, gilza
      let mf = 0;
      SHOTS.forEach(([ts, who], k) => {
        if (who !== i || t < ts) return;
        if (t - ts < 0.07) mf = 1 - (t - ts) / 0.07;
        if (!this.fired.has('fx' + k)) {
          this.fired.add('fx' + k);
          if (t < ts + 0.3) {
            const m = rp.clone().addScaledVector(gdir, 0.2).sub(Gp); this.smoke.spawn(ts, m, 3);
            const right = _v3.crossVectors(gdir, UP).normalize(); this.casings.spawn(ts, rp.clone().sub(Gp).addScaledVector(gdir, 0.06), right.x, right.z);
            this.sparks.burst(ts + 0.08, V(kp.x, 1.3, kp.z - 0.4), 6, 1.6);
          }
        }
      });
      const mz = rp.clone().addScaledVector(gdir, 0.2);
      this.muz[i].position.copy(mz); this.muz[i].intensity = mf * 9;
      const sp = this.flashSp[i]; sp.position.copy(mz).sub(Gp); sp.scale.setScalar(0.04 + 0.4 * mf); sp.material.opacity = mf; sp.material.rotation = t * 40 + i;
    }
    // o'q izlari
    SHOTS.forEach(([ts, who], k) => {
      const tr = this.tracers[k], age = t - ts;
      if (age < 0 || age > 0.09) { tr.visible = false; return; }
      const gp = this.gun[who].position, from = _v1.copy(gp).addScaledVector(aimDirs[who].gdir, 0.2), to = _v2.set(kp.x, 1.3, kp.z - 0.3);
      const q = age / 0.09, head = from.clone().lerp(to, q), tail = from.clone().lerp(to, Math.max(0, q - 0.35));
      tr.visible = true; tr.position.copy(head).add(tail).multiplyScalar(0.5); tr.scale.set(1, 1, Math.max(0.01, head.distanceTo(tail))); tr.lookAt(Gp.clone().add(head));
    });
    this.smoke.update(t); this.casings.update(t); this.sparks.update(t);
    // --- qon
    this.blood.update(t, hits);
    // --- lyuminessent lampa: miltillaydi, 9.9 da uchqun bilan portlaydi
    const tubeOn = t < T_TUBE;
    let tf = 1; if (tubeOn) { tf = 0.85 + 0.15 * Math.sin(t * 90); const g = Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1) + Math.sin(t * 19); if (g > 1.0 || (t > 8.7 && Math.sin(t * 41) > 0.3) || (t > 9.55 && Math.sin(t * 70) > -0.2)) tf = 0.08; }
    this.tubeMat.color.setHex(tubeOn ? (tf > 0.5 ? 0xdfe9ff : 0x2a3140) : 0x0c0d10);
    this.tubeL.intensity = tubeOn ? 22 * tf * seg(t, 0.2, 1.0) : 0;
    if (t >= T_TUBE && !this.fired.has('sp1')) { this.fired.add('sp1'); if (t < T_TUBE + 0.4) this.sparks.burst(T_TUBE, V(-0.4, CEIL - 0.1, 0.25), 40, 2.2); }
    // --- killer
    if (K) {
      const vis = t > T_OPEN + 0.4 && kp.z < 3.75;
      this.killerG.visible = vis;
      const stag = fresh * 0.05;
      this.killerG.position.set(kp.x, 0.0, kp.z + stag);
      this.killerG.rotation.set(0, PI * (1 - kp.turn) + Math.sin(t * 0.8) * 0.06, Math.sin(t * 6) * 0.01 + stag * 0.4);
      if (K.mixer && K.actions[0]) K.mixer.setTime(this._kAnim = (this._kAnim || 0) + dt * (kp.fleeing ? 2.6 : kp.walking ? 0.95 : 0.4));
      // o'q tekkanda boshi va yelkasi orqaga tebranadi; qochayotganda og'zini ochib qichqiradi
      const hitK = fresh, roar = seg(t, T_FLEE, T_FLEE + 0.25) * (1 - seg(t, T_FLEE + 1.0, T_FLEE + 1.5));
      const rx = (b, an) => { if (b) b.quaternion.premultiply(_q.setFromAxisAngle(_v4.set(1, 0, 0), an)); };
      rx(this.kb.s4, -0.18 * hitK); rx(this.kb.neck, -0.25 * hitK - 0.2 * roar); rx(this.kb.head, -0.2 * hitK - 0.15 * roar); rx(this.kb.jaw, 0.55 * roar);
      this.killerG.updateMatrixWorld(true); let lo = 1e9;
      for (const b of this.kFeet) { b.getWorldPosition(_v1); lo = Math.min(lo, _v1.y); }
      this.groundY = this.groundY == null ? -lo : mix(this.groundY, -lo, 0.35); this.killerG.position.y += this.groundY - this.killerG.position.y;
      this.killerG.scale.setScalar(1 + 0.05 * Math.sin(PI * clamp((t - T_FLEE) / 0.5, 0, 1)));
    }
    // --- eshik ortidan nur: avval iliq (koridor), keyin sovuq (killer ortidan, uzun soya bilan)
    const out = t > T_DARK;
    const flick2 = (t > 19 && t < T_DARK && Math.sin(t * 31) * Math.sin(t * 11.3) > 0.7) ? 0.25 : 1;
    const warm = t < T_SLAM + 0.15;
    this.doorS.color.setHex(warm ? 0xffd9a0 : 0x7ea2ff);
    this.doorS.intensity = warm ? 95 * seg(t, 0, 0.6) * (1 - seg(t, T_SLAM - 0.05, T_SLAM + 0.1)) : (t > T_OPEN && t < T_SLAM2 + 0.05 ? 85 * seg(t, T_OPEN + 0.3, 19.6) * flick2 : 0);
    this.doorL.intensity = t > T_OPEN && t < T_SLAM2 ? 5 * seg(t, T_OPEN, 19.8) : 0;
    // oy nuri (jalyuzi orqali), favqulodda qizil chiroq lampa o'chgach yonadi
    this.moon.intensity = out ? 0 : 32 * seg(t, 0, 1.5) * (t > 19 ? flick2 : 1);
    this.red.intensity = out ? (t < 26.3 ? 0.8 : 0) : seg(t, T_TUBE + 0.05, T_TUBE + 0.7) * (1.6 + env * 3.2 + (t > T_TURN ? 1.8 : 0)) * flick2;
    // --- kamera
    const cam = this._camera(t, poses, kp);
    const sh = this.shake * 0.05 + cam.sh * (0.6 + env) + (t > 17 && t < T_TURN ? 0.006 : 0);
    const hh = V(nz(t, 1.0), nz(t, 3.0) * 0.8, nz(t, 5.0)).multiplyScalar(sh * 0.7);
    camera.position.copy(cam.pos).add(hh).add(Gp); camera.up.set(0, 1, 0); camera.lookAt(cam.target.clone().add(Gp));
    camera.rotateZ(cam.roll + nz(t, 7.0) * sh * 0.4 + (Math.random() - 0.5) * this.shake * 0.02);
    if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    // kameraga biriktirilgan yumshoq yorug'lik: yaqin planlarda kuchliroq
    const keyI = { 5: 1.2, 6: 1.4, 7: 3.2, 9: 1.8, 10: 1.1 }[cam.cut] ?? 0.5;
    this.key.position.copy(camera.position).addScaledVector(_v1.set(0, 1, 0), 0.25).addScaledVector(_v2.setFromMatrixColumn(camera.matrixWorld, 0), -0.35);
    this.key.intensity = (t > T_DARK - 0.2 ? 0 : keyI) * seg(t, 0.2, 0.8);
    // --- hajmli nur va chang (spotlar shu yerda ulanadi)
    const spotsL = [this.spots[0], this.spots[1], this.doorS, this.moon];
    const cols = [0xfff1d6, 0xfff1d6, this.doorS.color.getHex(), 0x7f9dff];
    const du = this.dust.u; du.time.value = t; du.scale.value = (this.post ? this.post.size.y * this.post.pr : 720) / (2 * Math.tan(camera.fov * PI / 360));
    for (let k = 0; k < 4; k++) {
      const l = spotsL[k], I = l.intensity;
      const pos = l.position.clone().sub(Gp), dir = l.target.position.clone().sub(l.position).normalize();
      const vis = clamp(I / (k < 2 ? 30 : k === 2 ? 85 : 42), 0, 1) * (k < 2 ? 1 : 1);
      this.beams.set(k, pos, dir, l.angle * 0.95, k === 3 ? 6.5 : 5.2, cols[k], vis * (k < 2 ? 0.3 : k === 2 ? 0.12 : 0.07), t);
      du.sPos.value[k].copy(pos); du.sDir.value[k].copy(dir); du.sCos.value[k] = Math.cos(l.angle); du.sInt.value[k] = vis * (k === 3 ? 0.5 : 1.2); du.sCol.value[k].setHex(cols[k]);
    }
    du.amb.value = 0.035 + 0.02 * env;
    this._fear = clamp(0.1 + seg(t, 5, 18) * 0.5 + seg(t, 18, 23) * 0.4, 0, 1);
    this._sound(t, dt, this._fear);
    this.prevT = t;
    // --- qora parda va kinematografik chiziqlar
    const fade = Math.max(1 - seg(t, 0, 1.0), seg(t, CINE_DUR - 1.6, CINE_DUR - 0.2));
    if (this.el.fade) this.el.fade.style.opacity = fade.toFixed(3);
    if (this.el.bars) this.el.bars.classList.toggle('on', t < CINE_DUR - 0.8);
    if (game) { game.scene.fog.density = 0.05; game.scene.fog.color.setHex(0x06090b); game.hemi.intensity = out ? 0.03 : 0.2; game.hemi.color.set(0x405a66); game.hemi.groundColor.set(0x180c0c); }
    return t >= CINE_DUR;
  }

  // post-ishlov bilan chizish (bloom, rang berish, don...). Muvaffaqiyatsiz bo'lsa — oddiy chizish
  render(renderer, scene, camera, dt) {
    // zaif qurilmalarda avtomatik soddalashtirish: kadr tezligi past bo'lsa post-ishlov va ikkita soya o'chiriladi
    const now = performance.now();
    if (this._lt) { const d = now - this._lt; this._ema = this._ema ? this._ema * 0.9 + d * 0.1 : d; }
    this._lt = now; this._n = (this._n || 0) + 1;
    if (!this.lowFx && this._n > 24 && this._ema > 55) { this.lowFx = true; this.moon.castShadow = false; this.doorS.castShadow = false; }
    if (this.lowFx) { renderer.render(scene, camera); return; }
    if (!this.post && !this.postFail) { try { this.post = new Post(renderer, scene, camera); } catch (e) { console.warn('post', e); this.postFail = true; } }
    if (this.post) { try { this.post.render(dt, this.ct, { fear: this._fear || 0, bloom: 0.45 + 0.35 * (this.shake || 0) }); return; } catch (e) { console.warn('post render', e); this.post = null; this.postFail = true; } }
    renderer.render(scene, camera);
  }
}

// blood.mp3 dan 0.1 s lik quvvat egri chizig'i (0..1): animatsiya shu bilan musiqaga mos keladi
export function envelopeFrom(buf) {
  const d = buf.getChannelData(0), n = Math.floor(buf.sampleRate * 0.1), out = [];
  let mx = 1e-6;
  for (let i = 0; i + n <= d.length; i += n) { let s = 0; for (let j = 0; j < n; j += 4) s += d[i + j] * d[i + j]; const v = Math.sqrt(s / (n / 4)); out.push(v); if (v > mx) mx = v; }
  return out.map(v => clamp(v / mx, 0, 1));
}
