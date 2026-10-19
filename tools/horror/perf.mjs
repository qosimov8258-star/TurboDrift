import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../../server.js';
const srv = createStatic(3298); attachGameServer(srv); await new Promise(r => srv.listen(3298, r));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
for (const lv of [0, 4, 9]) {
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  p.on('pageerror', e => console.log('[pageerror]', e.message));
  const t0 = Date.now();
  await p.goto(`http://localhost:3298/horror?solo=${lv}&seed=42&nopause`);
  await p.waitForFunction('window.__hz && window.__hz.frameCount>5', null, { timeout: 120000 });
  const load = Date.now() - t0;
  await p.waitForTimeout(2000);
  console.log('L' + (lv + 1), 'yuklash', load + 'ms', JSON.stringify(await p.evaluate(() => { const g = window.__hz, i = g.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, rooms: g.sim.map.rooms.length, cabs: g.sim.map.cabinets.length, verts: g.sim.map.geo.vertexCount }; })));
  await p.close();
}
await b.close(); srv.close(); process.exit(0);
