// yordamchi: sahifani ochib skrinshot oladi. node tools/horror/shot.mjs <url> <out.png> [waitExpr]
import { chromium } from 'playwright';
import { createStatic, attachGameServer } from '../../server.js';
const [url, out, waitExpr] = process.argv.slice(2);
const srv = createStatic(3290); attachGameServer(srv); await new Promise(r => srv.listen(3290, r));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: +(process.env.W||1400), height: +(process.env.H||500) } });
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text()); });
p.on('pageerror', e => console.log('[pageerror]', e.message));
await p.goto('http://localhost:3290' + url);
await p.waitForFunction(waitExpr || 'window.__done', null, { timeout: 60000 });
console.log(JSON.stringify(await p.evaluate(() => window.__done || window.__hz?.frameCount), null, 1));
await p.screenshot({ path: out });
await b.close(); srv.close(); process.exit(0);
