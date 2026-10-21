// Klaviatura + sichqoncha (pointer lock) + sensorli boshqaruv.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();          // shu kadrda bosilganlar
    this.dx = 0; this.dy = 0;
    this.locked = false;
    this.enabled = false;
    this.touch = { on: false, mx: 0, mz: 0, run: false, hold: false };
    this.onLock = null;
    this.sens = 0.0023;
    const typing = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); };
    addEventListener('keydown', e => {
      if (typing(e)) return;
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => { this.keys.delete(e.code); });
    addEventListener('blur', () => { this.keys.clear(); });
    addEventListener('mousemove', e => { if (this.locked) { this.dx += e.movementX || 0; this.dy += e.movementY || 0; } });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; if (this.onLock) this.onLock(this.locked); });
    document.addEventListener('pointerlockerror', () => { this.locked = false; if (this.onLock) this.onLock(false); });
    canvas.addEventListener('mousedown', e => { if (this.enabled && !this.locked && !this.touch.on) this.lock(); if (e.button === 0) { this.keys.add('Mouse0'); if (this.enabled && this.locked) this.pressed.add('Mouse0'); } if (e.button === 2) this.keys.add('Mouse2'); });
    addEventListener('mouseup', e => { if (e.button === 0) this.keys.delete('Mouse0'); if (e.button === 2) this.keys.delete('Mouse2'); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
  lock() { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
  unlock() { try { document.exitPointerLock(); } catch (e) {} }
  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); this.dx = 0; this.dy = 0; }
  move() {
    let x = 0, z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.touch.on) { x += this.touch.mx; z += this.touch.mz; }
    const l = Math.hypot(x, z); if (l > 1) { x /= l; z /= l; }
    return { x, z };
  }
  get run() { return this.down('ShiftLeft') || this.down('ShiftRight') || this.touch.run; }
  get hold() { return this.down('KeyE') || this.touch.hold; }

  setupTouch(el) {
    this.touch.on = true;
    const joy = el.querySelector('#tJoy'), knob = el.querySelector('#tKnob'), look = el.querySelector('#tLook');
    let jid = null, jx = 0, jy = 0, lid = null, lx = 0, ly = 0;
    joy.addEventListener('touchstart', e => { const t = e.changedTouches[0]; jid = t.identifier; const r = joy.getBoundingClientRect(); jx = r.left + r.width / 2; jy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
    joy.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === jid) { let dx = (t.clientX - jx) / 50, dy = (t.clientY - jy) / 50; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } this.touch.mx = dx; this.touch.mz = -dy; knob.style.transform = `translate(${dx * 40}px,${dy * 40}px)`; } e.preventDefault(); }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === jid) { jid = null; this.touch.mx = this.touch.mz = 0; knob.style.transform = ''; } };
    joy.addEventListener('touchend', end); joy.addEventListener('touchcancel', end);
    look.addEventListener('touchstart', e => { const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; e.preventDefault(); }, { passive: false });
    look.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === lid) { this.dx += (t.clientX - lx) * 1.7; this.dy += (t.clientY - ly) * 1.7; lx = t.clientX; ly = t.clientY; } e.preventDefault(); }, { passive: false });
    look.addEventListener('touchend', e => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null; });
    for (const b of el.querySelectorAll('[data-key]')) {
      const code = b.dataset.key;
      b.addEventListener('touchstart', e => { e.preventDefault(); this.pressed.add(code); this.keys.add(code); if (code === 'ShiftLeft') this.touch.run = true; if (code === 'KeyE') this.touch.hold = true; b.classList.add('on'); }, { passive: false });
      const up = e => { e.preventDefault(); this.keys.delete(code); if (code === 'ShiftLeft') this.touch.run = false; if (code === 'KeyE') this.touch.hold = false; b.classList.remove('on'); };
      b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
    }
  }
}
