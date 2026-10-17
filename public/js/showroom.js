import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CarVisual } from './car.js';

// Garage scene: rotating turntable, car swaps with a slide animation, spinning wheels.
export class Showroom {
  constructor(renderer, protos, defs) {
    this.renderer = renderer; this.protos = protos; this.defs = defs;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090d);
    scene.fog = new THREE.Fog(0x07090d, 14, 38);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    scene.environmentIntensity = 0.9;
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);

    // floor
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.42, metalness: 0.6, envMapIntensity: 0.45 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    // turntable
    this.table = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.7, 0.18, 64), new THREE.MeshStandardMaterial({ color: 0x1b1f28, roughness: 0.4, metalness: 0.8 }));
    disc.position.y = -0.09; this.table.add(disc);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(3.62, 0.05, 12, 96), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    this.ring.rotation.x = Math.PI / 2; this.ring.position.y = 0.01; this.table.add(this.ring);
    scene.add(this.table);
    // lights
    const key = new THREE.SpotLight(0xffffff, 120, 40, 0.5, 0.6, 1.6); key.position.set(5, 9, 6); key.target.position.set(0, 0.5, 0); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    const rim = new THREE.SpotLight(0x4f8cff, 160, 40, 0.6, 0.7, 1.6); rim.position.set(-7, 5, -6); rim.target.position.set(0, 0.5, 0);
    const rim2 = new THREE.SpotLight(0xff4a3a, 110, 40, 0.6, 0.7, 1.6); rim2.position.set(7, 4, -5); rim2.target.position.set(0, 0.5, 0);
    scene.add(key, key.target, rim, rim.target, rim2, rim2.target);
    this.key = key; this.rim2 = rim2;
    // light "pillars" in the background
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, bar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 9, 0.15), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x2a6bff : 0xff3b30 }));
      bar.position.set(Math.cos(a) * 17, 4.5, Math.sin(a) * 17); scene.add(bar);
    }
    this.t = 0; this.cur = null; this.old = null; this.anim = 1; this.index = -1; this.dir = 1;
    this.orbit = 0;
    this.paint = -1;                     // body colour index (see paint.js), -1 = factory
    this.initView();
  }

  // ---------------------------------------------------------------- free 3D view (drag = rotate, wheel / pinch = zoom)
  initView() {
    const V = this.view = { az: 0, el: 0.17, r: 9.6, vAz: 0, vEl: 0, tr: 9.6, idle: 0, auto: true, on: false, drag: false };
    this.DEF = { az: 0, el: 0.17, r: 9.6 };
    const cv = this.renderer.domElement, ptrs = new Map();
    let pinch = 0;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => {
      if (!V.on) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      V.drag = true; V.vAz = V.vEl = 0; V.idle = 0; cv.style.cursor = 'grabbing';
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    cv.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId);
      if (!p || !V.on) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY; V.idle = 0;
      if (ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) V.tr = Math.min(16, Math.max(4.6, V.tr * (pinch / Math.max(d, 1))));
        pinch = d;
      } else {
        V.az -= dx * 0.0085; V.el = Math.min(1.3, Math.max(0.02, V.el + dy * 0.006));
        V.vAz = -dx * 0.0085 * 60; V.vEl = 0;
      }
    });
    const up = e => { ptrs.delete(e.pointerId); pinch = 0; if (!ptrs.size) { V.drag = false; cv.style.cursor = V.on ? 'grab' : ''; } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('lostpointercapture', up);
    cv.addEventListener('wheel', e => { if (!V.on) return; e.preventDefault(); V.tr = Math.min(16, Math.max(4.6, V.tr * Math.exp(e.deltaY * 0.0012))); V.idle = 0; }, { passive: false });
    cv.addEventListener('dblclick', () => { if (V.on) this.resetView(); });
  }

  /** garage = interactive (drag to look around), menu = cinematic drift */
  setInteractive(on) {
    const V = this.view;
    V.on = !!on; V.drag = false;
    this.offsetY = on ? 0.085 : 0;     // garage: lift the car above the bottom car-selector bar
    this.renderer.domElement.style.cursor = on ? 'grab' : '';
    if (!on) this.resetView(true);
  }
  resetView(instant = false) {
    const V = this.view, D = this.DEF;
    V.tr = D.r; V.vAz = 0; V.idle = 0;
    V.az = Math.atan2(Math.sin(V.az), Math.cos(V.az));       // shortest way back
    V.home = true;
    if (instant) { V.az = D.az; V.el = D.el; V.r = D.r; V.home = false; }
  }
  setAutoRotate(on) { this.view.auto = !!on; this.view.idle = 0; }

  /** body colour of the shown car (index into PAINTS, -1 = factory) */
  setPaint(idx) { this.paint = idx; if (this.cur) this.cur.setPaint(idx); }

  show(index) {
    if (index === this.index) return;
    const dir = index > this.index ? 1 : -1;
    this.dir = dir;
    if (this.old) { this.table.remove(this.old.group); }
    this.old = this.cur;
    this.index = index;
    const def = this.defs[index];
    const vis = new CarVisual(this.protos[index], def, this.paint);
    vis.group.scale.setScalar(1.25);
    this.cur = vis;
    this.table.add(vis.group);
    this.anim = 0;
    this.ring.material.color.set(def.color);
    this.rim2.color.set(def.color);
  }

  setOffset(f) { this.offset = f; }

  update(dt, w, h) {
    this.t += dt;
    const off = this.offset ?? 0;
    const short = h < 560, offY = (this.offsetY ?? 0) * (short ? 1.7 : 1);
    if (off || offY) this.camera.setViewOffset(w, h, -w * off, h * offY, w, h); else this.camera.clearViewOffset();
    if (this.camera.aspect !== w / h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.anim = Math.min(1, this.anim + dt * 2.2);
    const e = 1 - Math.pow(1 - this.anim, 3);
    const spin = 0.6;   // fixed three-quarter view, no turntable rotation
    if (this.cur) {
      this.cur.group.position.x = (1 - e) * 9 * this.dir;
      this.cur.group.rotation.y = spin + (1 - e) * 1.4 * this.dir;
      this.cur.group.position.y = 0;
      this.cur.update(dt, { x: this.cur.group.position.x, z: 0, psi: this.cur.group.rotation.y, steerAngle: 0, wheelSpin: 0, latG: 0, accG: 0, handbrake: false });
      this.cur.group.position.set((1 - e) * 9 * this.dir, 0, 0);
      this.cur.group.rotation.set(0, spin + (1 - e) * 1.4 * this.dir, 0);
    }
    if (this.old) {
      this.old.group.position.x = -e * 9 * this.dir;
      
      if (this.anim >= 1) { this.table.remove(this.old.group); this.old = null; }
    }
    const V = this.view;
    if (V.on) {
      // inertia + slow auto-rotation when the visitor leaves the car alone
      if (!V.drag) {
        V.idle += dt;
        V.az += V.vAz * dt; V.vAz *= Math.exp(-dt * 4.5);
        if (V.home) {
          const k = 1 - Math.exp(-dt * 6);
          V.az += (this.DEF.az - V.az) * k; V.el += (this.DEF.el - V.el) * k;
          if (Math.abs(V.az - this.DEF.az) < 0.01 && Math.abs(V.r - V.tr) < 0.02) V.home = false;
        } else if (V.auto && V.idle > 3.5) V.az += dt * 0.32;
      } else V.home = false;
      V.r += (V.tr - V.r) * (1 - Math.exp(-dt * 8));
      const ce = Math.cos(V.el);
      const asp = w / h, rr = V.r * (short ? 1.16 : 1) * (asp < 1.25 ? Math.min(2.3, 1.25 / asp) : 1);   // portrait screens: back off so the whole car fits
      this.camera.position.set(Math.sin(V.az) * ce * rr, 0.8 + Math.sin(V.el) * rr, Math.cos(V.az) * ce * rr);
    } else {
      // menu: gentle camera drift
      this.orbit += dt * 0.12;
      this.camera.position.set(Math.sin(this.orbit) * 1.5, 2.3 + Math.sin(this.orbit * 1.3) * 0.2, 9.3);
    }
    this.camera.lookAt(0, 0.8, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
