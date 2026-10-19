// Bitta sahnani sozlab skrinshot olish. node scene.mjs <level> <seed> <out> <js-before-each-shot> ...  (js ';;' bilan ajratiladi)
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../../server.js';
const [level, seed, out, ...shots] = process.argv.slice(2);
const srv = createStatic(3293); attachGameServer(srv); await new Promise(r => srv.listen(3293, r));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1024, height: 576 } });
p.on('console', m => { const t = m.text(); if (!t.includes('GL Driver') && m.type() !== 'log') console.log('[console]', m.type(), t.slice(0, 300)); });
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto(`http://localhost:3293/horror?solo=${level}&seed=${seed}&nopause`);
await p.waitForFunction('window.__hz && window.__hz.frameCount>3', null, { timeout: 90000 });
await p.evaluate(() => { document.getElementById('hzIntro').classList.add('hidden'); window.tp = (x, z, yawDeg) => { const g = window.__hz, s = g.sim; s.me.x = x; s.me.z = z; s.me.vx = s.me.vz = 0; g.lookYaw = yawDeg * Math.PI / 180; g.lookPitch = -0.08; }; window.cabFront = (id, dist = 1.6) => { const c = window.__hz.sim.map.cabinets[id]; return [c.x + Math.sin(c.rot) * (c.d + dist), c.z + Math.cos(c.rot) * (c.d + dist), Math.atan2(-(c.x - (c.x + Math.sin(c.rot))), -(c.z - (c.z + Math.cos(c.rot)))) * 180 / Math.PI]; }; });
let i = 0;
for (const js of shots) {
  const r = await p.evaluate(js); if (r !== undefined) console.log(JSON.stringify(r));
  await p.waitForTimeout(1600);
  await p.screenshot({ path: `${out}-${i++}.png` });
}
await b.close(); srv.close(); process.exit(0);
