import * as THREE from 'three';

// GPU-friendly particle pool rendered as a single THREE.Points
export class Particles {
  constructor(scene, texture, max = 700, additive = false) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.col = new Float32Array(max * 3); this.acc = new Float32Array(max * 2);
    this.aSize = new Float32Array(max); this.aAlpha = new Float32Array(max);
    this.drag = 1.2; this.rise = 0.0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: texture }, scale: { value: 500 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; varying float vA; varying vec3 vC; uniform float scale;
        void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * scale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); if (gl_FragColor.a < 0.003) discard; }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
    for (let k = 0; k < max; k++) this.pos[k * 3 + 1] = -999;
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, alpha, r = 1, g = 1, b = 1, ax = 0, az = 0) {
    const k = this.i; this.i = (this.i + 1) % this.max;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    this.life[k] = life; this.maxLife[k] = life; this.s0[k] = s0; this.s1[k] = s1; this.a0[k] = alpha;
    this.acc[k * 2] = ax; this.acc[k * 2 + 1] = az;
    this.col[k * 3] = r; this.col[k * 3 + 1] = g; this.col[k * 3 + 2] = b;
  }

  update(dt, camera, viewportH) {
    const d = Math.exp(-this.drag * dt);
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) { this.aAlpha[k] = 0; continue; }
      this.life[k] -= dt;
      const t = 1 - Math.max(this.life[k], 0) / this.maxLife[k];
      this.vel[k * 3] += this.acc[k * 2] * dt; this.vel[k * 3 + 2] += this.acc[k * 2 + 1] * dt;
      this.vel[k * 3] *= d; this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * d + this.rise * dt; this.vel[k * 3 + 2] *= d;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      this.aSize[k] = this.s0[k] + (this.s1[k] - this.s0[k]) * Math.sqrt(t);
      const fadeIn = Math.min(1, t * 8);
      this.aAlpha[k] = this.a0[k] * fadeIn * (1 - t) * (1 - t * 0.3);
      if (this.life[k] <= 0) this.aAlpha[k] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.mat.uniforms.scale.value = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}

// Tyre marks: ring buffer of quads
export class SkidMarks {
  constructor(scene, maxQuads = 5000) {
    this.max = maxQuads; this.n = 0;
    this.pos = new Float32Array(maxQuads * 4 * 3);
    this.colr = new Float32Array(maxQuads * 4 * 4);
    const idx = new Uint32Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) { const a = q * 4; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], q * 6); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colr, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    for (let i = 0; i < this.pos.length; i += 3) this.pos[i + 1] = -999;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.last = new Map();
    this.dirty = false;
  }

  add(id, x, z, lx, lz, alpha) {
    const prev = this.last.get(id);
    if (alpha <= 0.02) { if (prev) this.last.delete(id); return; }
    const w = 0.17;
    const cur = { x, z, lx, lz, alpha };
    this.last.set(id, cur);
    if (!prev) return;
    const dx = x - prev.x, dz = z - prev.z;
    if (dx * dx + dz * dz > 25) return;           // teleport / respawn
    const q = this.n % this.max; this.n++;
    const y = 0.045, o = q * 12, c = q * 16;
    const P = this.pos;
    P[o] = prev.x + prev.lx * w; P[o + 1] = y; P[o + 2] = prev.z + prev.lz * w;
    P[o + 3] = prev.x - prev.lx * w; P[o + 4] = y; P[o + 5] = prev.z - prev.lz * w;
    P[o + 6] = x + lx * w; P[o + 7] = y; P[o + 8] = z + lz * w;
    P[o + 9] = x - lx * w; P[o + 10] = y; P[o + 11] = z - lz * w;
    const C = this.colr, a0 = prev.alpha * 0.55, a1 = alpha * 0.55;
    C.set([0.04, 0.04, 0.045, a0, 0.04, 0.04, 0.045, a0, 0.04, 0.04, 0.045, a1, 0.04, 0.04, 0.045, a1], c);
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; this.dirty = false;
  }
}
