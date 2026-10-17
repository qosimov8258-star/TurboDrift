import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { getBounds } from '@gltf-transform/functions';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const f=process.argv[2];
const doc=await io.read(f);
const scene=doc.getRoot().listScenes()[0];
const b=getBounds(scene);
const fm=a=>a.map(x=>x.toFixed(2)).join(',');
console.log('==',f,'min',fm(b.min),'max',fm(b.max),'size',fm(b.max.map((m,i)=>m-b.min[i])));
const re=new RegExp(process.argv[3]||'wheel|tire|tyre|rim|rotor|disc|tormoz|brake_|caliper','i');
function walk(n,d,path){
  const nm=n.getName();
  if(re.test(nm)&&!/light/i.test(nm)){const bb=getBounds(n);console.log(' '.repeat(d)+nm,'| c',fm(bb.min.map((m,i)=>(m+bb.max[i])/2)),'s',fm(bb.max.map((m,i)=>m-bb.min[i])), n.getMesh()?'M':'', n.listChildren().length+'ch');}
  n.listChildren().forEach(c=>walk(c,d+1));
}
scene.listChildren().forEach(c=>walk(c,0));
