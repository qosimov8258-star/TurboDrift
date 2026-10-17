import { chromium } from 'playwright';
import { createStatic } from '../server.js';
import fs from 'fs';
const srv=createStatic().listen(3111);
const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const names=process.argv.slice(2);
for(const n of names){
  const p=await b.newPage();p.on('console',m=>console.log('console',m.text()));p.on('pageerror',e=>console.log('pageerror',e.message));
  await p.goto('http://localhost:3111/tools/inspect.html?m='+n+(process.env.F?'&f='+process.env.F:''));
  await p.waitForFunction('window.RESULT',null,{timeout:120000});
  const r=await p.evaluate('window.RESULT');
  console.log('=====',n,r.err||'');
  if(r.out){console.log(JSON.stringify(r.out,null,1));}
  (r.imgs||[]).forEach((d,i)=>fs.writeFileSync(`/private/tmp/claude-501/-Users-ismoil-Desktop-game/d6b86078-6f3f-4632-b4d0-25766dfeb358/scratchpad/${n}_${i}.jpg`,Buffer.from(d.split(',')[1],'base64')));
  await p.close();
}
await b.close();srv.close();
