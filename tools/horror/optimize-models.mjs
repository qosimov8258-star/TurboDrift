// horror/*.glb -> public/horror/models/*.glb  (kichik, tez yuklanadigan nusxalar; asl fayllar o'zgarmaydi)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, quantize, meshopt, weld, simplify, flatten, resample } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import fs from 'fs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
const map = {
  'horror_ghost_character_-_blood_stained_spirit.glb': ['ghost', 0.12],
  'creepy_scarecrow__horror_stylized.glb': ['scarecrow', 0.5],
  'masha_rig_masha_and_the_bear.glb': ['masha', 0.8],
  'pink_rabbit.glb': ['rabbit', 0.6],
  'smily_horror_monster.glb': ['monster', 0.6],
};
for (const [src, [dst, ratio]] of Object.entries(map)) {
  const t = Date.now();
  const doc = await io.read('horror/' + src);
  const fns = [dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 78 }), weld()];
  if (!doc.getRoot().listSkins().length) fns.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }));
  fns.push(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await doc.transform(...fns);
  await io.write(`public/horror/models/${dst}.glb`, doc);
  console.log(dst, (fs.statSync(`public/horror/models/${dst}.glb`).size / 1e6).toFixed(2) + 'MB', ((Date.now() - t) / 1000).toFixed(0) + 's');
}
