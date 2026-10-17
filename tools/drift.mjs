import { Track } from '../public/js/track.js';
import { Vehicle } from '../public/js/car.js';
import { Bot } from '../public/js/bot.js';
const t = new Track(); const v = new Vehicle(); const s = t.gridSlot(0); v.place(s.x, s.z, s.psi);
const bot = new Bot(v, t, 1);
for (let i = 0; i < 120 * 7; i++) { bot.control(1/120, bot.inp, [], 1, true); v.update(1/120, bot.inp, t); }
console.log('cruise', (v.speed*3.6).toFixed(0), 'd', v.nearest.d.toFixed(1));
const inp = { throttle: 1, brake: 0, steer: 1, handbrake: true, nitro: false };
for (let i = 0; i < 120 * 2.4; i++) {
  if (i === 36) inp.handbrake = false;
  v.update(1/120, inp, t);
  if (i % 24 === 0) console.log((i/120).toFixed(2), 'kmh', (v.speed*3.6).toFixed(0), 'slip', v.slip.toFixed(2), 'drift', v.drift.toFixed(2), 'yaw', v.yaw.toFixed(2), 'd', v.nearest.d.toFixed(1), 'nitro', v.nitro.toFixed(2));
}
console.log('--- wall debug');
{
  const v2 = new Vehicle(); v2.place(s.x, s.z, s.psi);
  const b2 = new Bot(v2, t, 1);
  for (let i = 0; i < 120 * 7; i++) { b2.control(1/120, b2.inp, [], 1, true); v2.update(1/120, b2.inp, t); }
  const i2 = { throttle: 1, brake: 0, steer: 1, handbrake: false, nitro: false };
  for (let i = 0; i < 120 * 2; i++) {
    const before = v2.speed; v2.update(1/120, i2, t);
    if (v2.hit > 0.01 && i % 3 === 0) console.log(i, 'kmh', (v2.speed*3.6).toFixed(0), 'hit', v2.hit.toFixed(2), 'psi', v2.psi.toFixed(2), 'vf', v2.vf.toFixed(1), 'vl', v2.vl.toFixed(1), 'd', v2.nearest.d.toFixed(1));
  }
}
