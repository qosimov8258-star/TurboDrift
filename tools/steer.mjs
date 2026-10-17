import { Track } from '../public/js/track.js';
import { Vehicle } from '../public/js/car.js';
import { Bot } from '../public/js/bot.js';
const t = new Track(); const v = new Vehicle(); const s = t.gridSlot(0); v.place(s.x, s.z, s.psi);
const bot = new Bot(v, t, 1);
for (const target of [60, 110, 160]) {
  while (v.speed * 3.6 < target) { bot.control(1/120, bot.inp, [], 1, true); v.update(1/120, bot.inp, t); }
  const inp = { throttle: 0.4, brake: 0, steer: 1, handbrake: false, nitro: false }; const p0 = v.psi; const sp = v.speed;
  for (let i = 0; i < 60; i++) v.update(1/120, inp, t);
  console.log('at', target, 'km/h: turned', ((p0 - v.psi) * 57.3).toFixed(0), 'deg in 0.5s');
  v.place(s.x, s.z, s.psi);
  for (let i = 0; i < 120*3; i++) { bot.control(1/120, bot.inp, [], 1, true); v.update(1/120, bot.inp, t); }
}
