// badroom kadrini turli paytlarda skrinshotga oladi: node tools/horror/cine-shots.mjs <chiqish papkasi> t1 t2 ...
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../../server.js';
const [dir, ...ts] = process.argv.slice(2);
const srv = createStatic(3291); attachGameServer(srv); await new Promise(r => srv.listen(3291, r));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text()); });
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto('http://localhost:3291/tools/horror/cine-test.html' + (process.env.Q || ''));
await p.waitForFunction('window.__done', null, { timeout: 90000 });
for (const t of ts) {
  if (process.env.EXT) { const [x, y, z, tx, ty, tz] = process.env.EXT.split(',').map(Number); await p.evaluate(([t, a]) => window.__ext(+t, ...a), [t, [x, y, z, tx, ty, tz]]); await p.screenshot({ path: `${dir}/ext_${t}.png` }); console.log('ext', t); continue; } const pos = await p.evaluate(t => window.__shot(+t), t); await p.screenshot({ path: `${dir}/cine_${t}.png` }); console.log(t, pos); if (process.env.NAN) console.log(JSON.stringify(await p.evaluate(() => window.__nan()))); }
await b.close(); srv.close(); process.exit(0);
