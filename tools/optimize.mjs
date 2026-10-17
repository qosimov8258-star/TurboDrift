import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, quantize, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const map = {
  'bmw_m3_competition.glb':'bmw_m3',
  '2001_bmw_m3_gtr.glb':'bmw_gtr',
  'dodge_charger_fast__furious_8.glb':'charger',
  'ferrari_296_gt3__www.vecarz.com.glb':'ferrari',
  'mercedes-amg_gt3_red_bull_racing.glb':'amg',
  'toyota_gr_supra_gt300.glb':'supra_gt300',
  'toyota_supra_mk4.glb':'supra_mk4',
};
for (const [src,dst] of Object.entries(map)) {
  const t=Date.now();
  const doc = await io.read(src);
  await doc.transform(
    dedup(), prune(),
    textureCompress({encoder:sharp, targetFormat:'webp', resize:[1024,1024], quality:80}),
    weld(), quantize({quantizePosition:14, quantizeNormal:10, quantizeTexcoord:12}), meshopt({encoder:MeshoptEncoder, level:'medium'})
  );
  await io.write(`public/models/${dst}.glb`, doc);
  console.log(dst, (fs.statSync(`public/models/${dst}.glb`).size/1e6).toFixed(1)+'MB', ((Date.now()-t)/1000).toFixed(0)+'s');
}
