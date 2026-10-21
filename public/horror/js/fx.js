// Kadr (cutscene) uchun kino sifatidagi effektlar: post-ishlov (bloom, rang berish, don, vinyetka, xromatik aberratsiya),
// fanar nurlari (hajmli konuslar), nurda suzuvchi chang, o't ochish tutuni, gilza va uchqunlar.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const hash = (n) => { n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16; return (n >>> 0) / 4294967296; };

// ---------------------------------------------------------------------------------------------------- post-ishlov
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vig: { value: 0.55 }, grain: { value: 0.055 }, ca: { value: 0.0016 }, fear: { value: 0 }, flash: { value: 0 }, sat: { value: 0.86 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, vig, grain, ca, fear, flash, sat; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 off = c * ca * (1.0 + 5.0 * r2);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, sat);
      col = mix(col * vec3(0.90, 1.0, 1.08), col * vec3(1.07, 1.0, 0.90), smoothstep(0.22, 0.85, l));   // soyalar — firuza, yorqin joylar — iliq
      col = (col - 0.5) * 1.08 + 0.5;
      float v = smoothstep(0.86, 0.16, length(c * vec2(1.0, 0.92)));
      col *= mix(1.0, v, vig + fear * 0.4);
      col += vec3(0.55, 0.01, 0.01) * flash * (0.25 + r2 * 2.4);
      float g = h(vUv * vec2(1920.0, 1080.0) + fract(time * 61.7) * 113.0) - 0.5;
      col += g * grain * (1.0 - l * 0.55);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.r = renderer; this.size = new THREE.Vector2(); renderer.getSize(this.size); this.pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(this.size.x * this.pr, this.size.y * this.pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(this.pr); this.composer.setSize(this.size.x, this.size.y);
    this.pass = new RenderPass(scene, camera); this.composer.addPass(this.pass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.size.x, this.size.y), 0.4, 0.5, 0.86); this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.final = new ShaderPass(FinalShader); this.composer.addPass(this.final);
    this.u = this.final.uniforms;
  }
  render(dt, time, p = {}) {
    const s = this.r.getSize(_s2); if (s.x !== this.size.x || s.y !== this.size.y || this.r.getPixelRatio() !== this.pr) { this.size.copy(s); this.pr = this.r.getPixelRatio(); this.composer.setPixelRatio(this.pr); this.composer.setSize(s.x, s.y); }
    this.u.time.value = time; this.u.fear.value = p.fear || 0; this.u.flash.value = p.flash || 0;
    if (p.bloom != null) this.bloom.strength = p.bloom;
    this.composer.render(dt);
  }
  setScene(scene, camera) { this.pass.scene = scene; this.pass.camera = camera; }
  dispose() { try { this.composer.dispose(); } catch (e) { /* */ } }
}
const _s2 = new THREE.Vector2();

// ---------------------------------------------------------------------------------------------------- nur konuslari va chang
const BeamShader = {
  vertexShader: `varying float vZ; varying vec3 vN; varying vec3 vV;
    void main(){ vZ = position.z; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 color; uniform float intensity; uniform float time; varying float vZ; varying vec3 vN; varying vec3 vV;
    void main(){
      float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.4) * smoothstep(0.4, 2.2, length(vV));
      float a = f * pow(clamp(1.0 - vZ, 0.0, 1.0), 1.5) * smoothstep(0.0, 0.06, vZ) * intensity;
      a *= 0.88 + 0.12 * sin(time * 1.7 + vZ * 9.0);
      gl_FragColor = vec4(color * a, a);
    }`,
};

export class Beams {
  constructor(group, n) {
    this.g = group; this.list = [];
    const geo = new THREE.ConeGeometry(1, 1, 32, 1, true); geo.translate(0, -0.5, 0); geo.rotateX(-Math.PI / 2);      // uchi (0,0,0), +z ga cho'ziladi, asosi z=1 da
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({ ...BeamShader, uniforms: { color: { value: new THREE.Color(1, 1, 1) }, intensity: { value: 0 }, time: { value: 0 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.visible = false; group.add(m); this.list.push(m);
    }
  }
  // i-nur: uchi pos, yo'nalishi dir, yarim burchagi ang, uzunligi len (G koordinatalarida)
  set(i, pos, dir, ang, len, color, intensity, time) {
    const m = this.list[i]; m.visible = intensity > 0.002;
    if (!m.visible) return;
    const r = Math.tan(ang) * len; m.position.copy(pos); m.scale.set(r, r, len); m.quaternion.setFromUnitVectors(_z, dir);
    m.material.uniforms.color.value.set(color); m.material.uniforms.intensity.value = intensity; m.material.uniforms.time.value = time;
  }
  hide() { for (const m of this.list) m.visible = false; }
}
const _z = new THREE.Vector3(0, 0, 1);

export class Dust {
  constructor(group, n = 380) {
    this.N = 4;
    const pos = new Float32Array(n * 3), ph = new Float32Array(n), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = -3.2 + hash(i * 3 + 1) * 6.4; pos[i * 3 + 1] = 0.1 + hash(i * 3 + 2) * 3.1; pos[i * 3 + 2] = -3.9 + hash(i * 3 + 3) * 8; ph[i] = hash(i + 77) * 6.28; sz[i] = 0.006 + hash(i + 191) * 0.012; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1)); g.setAttribute('aSz', new THREE.BufferAttribute(sz, 1));
    this.u = { time: { value: 0 }, sPos: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) }, sDir: { value: Array.from({ length: 4 }, () => new THREE.Vector3(0, 0, 1)) }, sCos: { value: [1, 1, 1, 1] }, sInt: { value: [0, 0, 0, 0] }, sCol: { value: Array.from({ length: 4 }, () => new THREE.Color(1, 1, 1)) }, scale: { value: 500 }, amb: { value: 0.05 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float time; uniform vec3 sPos[4]; uniform vec3 sDir[4]; uniform float sCos[4]; uniform float sInt[4]; uniform vec3 sCol[4]; uniform float scale, amb;
        attribute float aPh; attribute float aSz; varying vec3 vC; varying float vA;
        void main(){
          vec3 p = position + vec3(sin(time * 0.31 + aPh * 5.0), sin(time * 0.23 + aPh * 8.0) * 0.5 + time * 0.02 * sin(aPh), cos(time * 0.27 + aPh * 7.0)) * 0.22;
          vec3 c = vec3(0.0); float a = amb;
          for (int i = 0; i < 4; i++) {
            vec3 d = p - sPos[i]; float dist = max(length(d), 0.001); float k = dot(d / dist, sDir[i]);
            float v = smoothstep(sCos[i], sCos[i] + 0.06, k) * (1.0 - smoothstep(0.0, 8.0, dist)) * sInt[i];
            a += v * 0.9; c += sCol[i] * v;
          }
          vC = vec3(0.7) * amb + c; vA = a;
          vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
          gl_PointSize = aSz * scale / max(-mv.z, 0.3); gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q); float s = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * s * 0.9, s * min(vA, 1.0) * 0.55); }`,
    });
    this.pts = new THREE.Points(g, mat); this.pts.frustumCulled = false; group.add(this.pts);
  }
  setVisible(v) { this.pts.visible = v; }
}

// ---------------------------------------------------------------------------------------------------- tutun, gilza, uchqun
function softTex(inner, outer) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner); g.addColorStop(1, outer); c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function starTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,235,1)'); g.addColorStop(0.18, 'rgba(255,215,120,.9)'); g.addColorStop(0.55, 'rgba(255,120,30,.25)'); g.addColorStop(1, 'rgba(255,90,10,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  c.translate(64, 64); c.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 6; k++) { c.rotate(Math.PI / 3 + (k % 2) * 0.12); const l = c.createLinearGradient(0, 0, 62, 0); l.addColorStop(0, 'rgba(255,240,200,.95)'); l.addColorStop(1, 'rgba(255,160,40,0)'); c.fillStyle = l; c.beginPath(); c.moveTo(0, -3); c.lineTo(62 * (k % 2 ? 0.7 : 1), 0); c.lineTo(0, 3); c.closePath(); c.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Smoke {                // o't ochgandan keyin ko'tariladigan tutun bo'laklari
  constructor(group, max = 42) {
    this.tex = softTex('rgba(200,200,205,1)', 'rgba(150,150,160,0)');
    this.sp = []; for (let i = 0; i < max; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0, fog: true, color: 0x9a9aa6 })); s.visible = false; group.add(s); this.sp.push(s); }
    this.puffs = [];
  }
  spawn(t, p, n = 3) { for (let k = 0; k < n; k++) this.puffs.push({ t, x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 0.25, vy: 0.12 + Math.random() * 0.22, vz: (Math.random() - 0.3) * 0.3, s: 0.12 + Math.random() * 0.12 }); if (this.puffs.length > this.sp.length) this.puffs.splice(0, this.puffs.length - this.sp.length); }
  reset() { this.puffs.length = 0; for (const s of this.sp) s.visible = false; }
  update(t) {
    this.sp.forEach((s, i) => {
      const p = this.puffs[i]; if (!p) { s.visible = false; return; }
      const a = t - p.t; if (a < 0 || a > 3) { s.visible = false; return; }
      s.visible = true; s.position.set(p.x + p.vx * a, p.y + p.vy * a, p.z + p.vz * a); s.scale.setScalar(p.s + a * 0.35); s.material.opacity = 0.22 * Math.min(1, a * 6) * (1 - a / 3);
    });
  }
}

export class Casings {              // gilzalar: otilib chiqadi, polga tushib sakraydi
  constructor(group, max = 12) {
    this.max = max; this.list = [];
    this.mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.022, 8), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.9, roughness: 0.3 }), max);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; group.add(this.mesh); this.d = new THREE.Object3D(); this.hide = new THREE.Matrix4().makeScale(0, 0, 0);
  }
  spawn(t, p, rx, rz) { this.list.push({ t, x: p.x, y: p.y, z: p.z, vx: rx * (1.1 + Math.random() * 0.6), vy: 1.2 + Math.random() * 0.7, vz: rz * (1.1 + Math.random() * 0.6), seed: Math.random() * 6 }); if (this.list.length > this.max) this.list.shift(); }
  reset() { this.list.length = 0; for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, this.hide); this.mesh.instanceMatrix.needsUpdate = true; }
  update(t) {
    for (let i = 0; i < this.max; i++) {
      const c = this.list[i]; if (!c || t < c.t) { this.mesh.setMatrixAt(i, this.hide); continue; }
      let x = c.x, y = c.y, z = c.z, vx = c.vx, vy = c.vy, vz = c.vz, tau = Math.min(t - c.t, 2.5), dt = 1 / 90, rest = 0;
      for (let s = 0; s * dt < tau; s++) {
        vy -= 9.8 * dt; x += vx * dt; y += vy * dt; z += vz * dt;
        if (y < 0.012) { y = 0.012; if (Math.abs(vy) > 0.5) { vy = -vy * 0.36; vx *= 0.6; vz *= 0.6; } else { vy = 0; vx *= 0.8; vz *= 0.8; rest = 1; } }
      }
      this.d.position.set(x, y, z); this.d.rotation.set(c.seed + tau * 14 * (1 - rest), c.seed * 2, c.seed + tau * 9 * (1 - rest)); this.d.scale.setScalar(1); this.d.updateMatrix(); this.mesh.setMatrixAt(i, this.d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Sparks {               // uchqunlar (lampa portlashi, o'q tekkanda)
  constructor(group, max = 160) {
    this.max = max; this.list = [];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3)); g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(max), 1));
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 22.0 * aA / max(-mv.z, 0.3) + 1.0; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0, 0.7, 0.3) * smoothstep(0.5, 0.0, d) * vA * 3.0, 1.0); }' }));
    this.pts.frustumCulled = false; group.add(this.pts);
  }
  burst(t, p, n, speed, dir = null) { for (let k = 0; k < n; k++) { const a = Math.random() * 6.28, u = Math.random() * 2 - 1, s = speed * (0.4 + Math.random()); this.list.push({ t, x: p.x, y: p.y, z: p.z, vx: dir ? dir.x * s + (Math.random() - 0.5) * s * 0.5 : Math.cos(a) * Math.sqrt(1 - u * u) * s, vy: dir ? dir.y * s + Math.random() * s * 0.4 : u * s, vz: dir ? dir.z * s + (Math.random() - 0.5) * s * 0.5 : Math.sin(a) * Math.sqrt(1 - u * u) * s, life: 0.35 + Math.random() * 0.5 }); } while (this.list.length > this.max) this.list.shift(); }
  reset() { this.list.length = 0; this.pts.geometry.attributes.aA.array.fill(0); this.pts.geometry.attributes.aA.needsUpdate = true; }
  update(t) {
    const P = this.pts.geometry.attributes.position, A = this.pts.geometry.attributes.aA;
    for (let i = 0; i < this.max; i++) {
      const s = this.list[i]; const a = s ? t - s.t : -1;
      if (!s || a < 0 || a > s.life) { A.array[i] = 0; continue; }
      P.array[i * 3] = s.x + s.vx * a; P.array[i * 3 + 1] = Math.max(0.01, s.y + s.vy * a - 4.9 * a * a); P.array[i * 3 + 2] = s.z + s.vz * a; A.array[i] = 1 - a / s.life;
    }
    P.needsUpdate = true; A.needsUpdate = true;
  }
}
