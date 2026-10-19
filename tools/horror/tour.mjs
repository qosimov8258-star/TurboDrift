// Xonalar bo'ylab sayr: teleport + skrinshot. node tour.mjs <level> <seed> <outPrefix> <roomIdx,roomIdx,...>
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../../server.js';
const [level, seed, out, rooms] = process.argv.slice(2);
const srv = createStatic(3292); attachGameServer(srv); await new Promise(r => srv.listen(3292, r));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1024, height: 576 } });
p.on('console', m => { const t = m.text(); if (!t.includes('GL Driver') && m.type() !== 'log') console.log('[console]', m.type(), t.slice(0, 300)); });
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto(`http://localhost:3292/horror?solo=${level}&seed=${seed}&nopause`);
await p.waitForFunction('window.__hz && window.__hz.frameCount>3', null, { timeout: 90000 });
await p.evaluate(() => { document.getElementById('hzIntro').classList.add('hidden'); });
const info = await p.evaluate(() => { const s = window.__hz.sim; return { rooms: s.map.rooms.length, types: s.map.rooms.map(r => r.type + (r.lamp ? '*' : '')).join(','), start: s.map.start }; });
console.log(JSON.stringify(info));
let i = 0;
for (const spec of rooms.split(',')) {
  const [ri, yawDeg] = spec.split(':');
  await p.evaluate(([ri, yaw]) => { const g = window.__hz, s = g.sim, r = s.map.rooms[ri]; s.me.x = r.cx - Math.sin(yaw) * 0 + 0.01; s.me.z = r.cz + 0.01; g.lookYaw = yaw; g.lookPitch = -0.05; s.me.vx = s.me.vz = 0; }, [+ri, (+yawDeg || 0) * Math.PI / 180]);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}-${i++}.png` });
}
await b.close(); srv.close(); process.exit(0);
