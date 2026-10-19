import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { getBounds } from '@gltf-transform/core';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f), r = doc.getRoot(), sc = r.listScenes()[0], b = getBounds(sc);
  console.log('==', f, 'meshes', r.listMeshes().length, 'skins', r.listSkins().length, 'anims', r.listAnimations().map(a => a.getName() + ':' + a.listChannels().length), 'nodes', r.listNodes().length, 'ext', r.listExtensionsUsed().map(e => e.extensionName));
  console.log(' size', b.max.map((m, i) => (m - b.min[i]).toFixed(2)), 'min', b.min.map(v => v.toFixed(2)));
  let t = 0; for (const m of r.listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  console.log(' tris', t | 0, 'tex', r.listTextures().map(x => x.getSize()?.join('x')).join(' '));
  const names = []; r.listNodes().forEach(n => names.push(n.getName())); console.log(' nodes', names.filter(n => /wheel|tire|tyre|rim|door|light|siren|bar|root|armature|hips|gun|weapon|hand/i.test(n)).slice(0, 40).join(', '));
}
