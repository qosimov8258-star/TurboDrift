// On-screen driving controls (phones / tablets) — they feed the same input object as the keyboard.
export const touch = { steer: 0, thr: 0, brk: 0, hb: false, nitro: false };

const held = new Set();

function recompute() {
  touch.steer = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  touch.thr = held.has('gas') ? 1 : 0;
  touch.brk = held.has('brake') ? 1 : 0;
  touch.hb = held.has('hb');
  touch.nitro = held.has('nitro');
}

/** onTap(dir)  -> gear shift buttons (dir = +1 / -1) */
export function initTouch(root, onTap) {
  for (const b of root.querySelectorAll('[data-hold]')) {
    const k = b.dataset.hold;
    const down = e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } held.add(k); b.classList.add('down'); recompute(); if (navigator.vibrate && k !== 'left' && k !== 'right') navigator.vibrate(8); };
    const up = e => { e.preventDefault(); held.delete(k); b.classList.remove('down'); recompute(); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  for (const b of root.querySelectorAll('[data-tap]')) {
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('down'); onTap(b.dataset.tap === 'up' ? 1 : -1); });
    const off = () => b.classList.remove('down');
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  window.addEventListener('blur', releaseAll);
}

export function releaseAll() {
  held.clear(); recompute();
  document.querySelectorAll('.tbtn.down').forEach(b => b.classList.remove('down'));
}

/** a device that is driven by finger rather than keyboard */
export function isTouchDevice() {
  return (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && window.matchMedia('(pointer: coarse)').matches;
}
