// lists node-name families of the optimised city models (to find the parked cars)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const ROOT = new URL('../../', import.meta.url).pathname;
for (const f of process.argv.slice(2)) {
  const doc = await io.read(ROOT + f), fam = new Map();
  for (const n of doc.getRoot().listNodes()) {
    const base = n.getName().replace(/[._]?\d+/g, '').replace(/\s+$/, '');
    const e = fam.get(base) || { n: 0, mesh: 0 }; e.n++; if (n.getMesh()) e.mesh++; fam.set(base, e);
  }
  console.log('==', f, doc.getRoot().listNodes().length);
  console.log([...fam.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 70).map(([k, v]) => `${k}:${v.n}/${v.mesh}`).join('  '));
}
