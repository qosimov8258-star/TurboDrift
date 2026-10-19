import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  console.log('==', f);
  for (const t of doc.getRoot().listTextures()) console.log(' ', t.getName().slice(0, 30), t.getMimeType(), t.getSize()?.join('x'), (t.getImage().byteLength / 1e6).toFixed(1) + 'MB');
  const mats = doc.getRoot().listMaterials();
  console.log(' materials', mats.length, mats.map(m => `${m.getName()}[${m.getAlphaMode()}${m.getDoubleSided() ? ',2s' : ''}]`).join(' '));
}
