import { Track } from '../public/js/track.js';
import { Vehicle } from '../public/js/car.js';
import { Bot } from '../public/js/bot.js';
const t = new Track();
for (const skill of [0, 0.5, 1]) {
  const v = new Vehicle(); const s = t.gridSlot(0); v.place(s.x, s.z, s.psi);
  const bot = new Bot(v, t, skill);
  let lap = 0, last = s.i, tm = 0, hits = 0, maxDrift = 0, gravel = 0, lapT = [];
  for (let i = 0; i < 120 * 400 && lap < 3; i++) {
    bot.control(1 / 120, bot.inp, [], 1, true);
    v.update(1 / 120, bot.inp, t);
    tm += 1 / 120;
    if (v.hitEvent > 1) { hits++; } v.hitEvent = 0;
    maxDrift = Math.max(maxDrift, v.drift); if (v.surface === 'gravel') gravel += 1 / 120;
    const idx = v.nearest.i; if (idx - last < -t.N / 2) { lap++; lapT.push(tm.toFixed(1)); } last = idx;
  }
  console.log('skill', skill, 'laps at', lapT.join(','), 'hits', hits, 'maxDrift', maxDrift.toFixed(2), 'gravel s', gravel.toFixed(1), 'len', t.length.toFixed(0));
}
