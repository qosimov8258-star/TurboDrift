import { chromium } from 'playwright';
import { createStatic } from '../../server.js';
import fs from 'fs';
const OUT = process.env.OUT || '/private/tmp/claude-501/-Users-ismoil-Desktop-game/60b90354-d033-477f-866c-49b2a7c6e66d/scratchpad/shots/';
const srv = createStatic(3231); await new Promise(r => srv.listen(3231, r));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', m => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') if (!/GL Driver|GPU stall|swiftshader/i.test(t)) console.log('[console]', t.slice(0, 300)); });
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto('http://localhost:3231/tools/world-test.html');
await p.waitForFunction('window.RESULT', null, { timeout: 300000 });
console.log(JSON.stringify(await p.evaluate('window.RESULT')));
const shots = JSON.parse(process.env.SHOTS || '[]');
for (const [name, pos, look, fov] of shots) {
  await p.evaluate(([pos, look, fov]) => { const { THREE, scene, r } = window.api; const cam = new THREE.PerspectiveCamera(fov || 60, 16 / 9, 0.3, 4000); cam.position.set(...pos); cam.lookAt(...look); r.render(scene, cam); }, [pos, look, fov]);
  const d = await p.evaluate(() => window.api.r.domElement.toDataURL('image/jpeg', 0.85));
  fs.writeFileSync(OUT + name + '.jpg', Buffer.from(d.split(',')[1], 'base64'));
}
await b.close(); srv.close();
