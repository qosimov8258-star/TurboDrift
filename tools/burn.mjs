import { Track } from '../public/js/track.js';
import { Vehicle } from '../public/js/car.js';
const t = new Track(); const v = new Vehicle(); const s = t.gridSlot(0); v.place(s.x, s.z, s.psi);
const inp = { throttle: 1, brake: 1, steer: 0, handbrake: false, nitro: false };
for (let i = 0; i < 120 * 14; i++) { v.update(1/120, inp, t);
  if (i % 120 === 0) console.log((i/120)+'s', 'burnout', v.burnout, 'burn', v.burn.toFixed(2), 'fire', v.fire.toFixed(1), 'kmh', (v.speed*3.6).toFixed(1), 'pos', (Math.hypot(v.x-s.x, v.z-s.z)).toFixed(1), 'rearSpin', v.rearSpin.toFixed(0)); }
// slow-down auto downshift check is in race.js; steering agility:
const w = new Vehicle(); w.place(s.x, s.z, s.psi); const i2 = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false };
for (let i = 0; i < 120 * 5; i++) { w.update(1/120, i2, t); if (w.rpmRaw > .93 && w.gear < 3) w.shift(1); }
i2.steer = 1; const p0 = w.psi; for (let i = 0; i < 120; i++) w.update(1/120, i2, t);
console.log('speed', (w.speed*3.6).toFixed(0), 'turned deg in 1s', ((p0 - w.psi) * 57.3).toFixed(0));
