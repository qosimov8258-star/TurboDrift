// Shrinks the three raw city models (≈190 MB) into web-sized GLBs in public/models/.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, quantize, meshopt, weld, simplify, flatten, join } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
await MeshoptEncoder.ready; await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
const ROOT = new URL('../../', import.meta.url).pathname;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const JOBS = [
  { src: 'city.glb', dst: 'city_a', tex: 2048, simp: 0 },
  { src: 'mession/police/ruined_city_free_5.glb', dst: 'city_b', tex: 1024, simp: 0.4 },
  { src: 'mession/police/simple_city_free.glb', dst: 'city_c', tex: 1024, simp: 0 },
  { src: 'mession/police/police_car_suv.glb', dst: 'police_suv', tex: 1024, simp: 0.3 },
  { src: 'mession/police/robot_police_unit_animated.glb', dst: 'robot', tex: 1024, simp: 0, noQuant: true },
];
const only = process.argv[2];
for (const j of JOBS) {
  if (only && j.dst !== only) continue;
  const t = Date.now();
  const doc = await io.read(ROOT + j.src);
  const steps = [dedup(), prune()];
  if (j.simp) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: j.simp, error: 0.002, lockBorder: false }));
  steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [j.tex, j.tex], quality: 78 }), weld(), ...(j.noQuant ? [] : [quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 })]), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await doc.transform(...steps);
  let tris = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  await io.write(`${ROOT}public/models/${j.dst}.glb`, doc);
  console.log(j.dst, (fs.statSync(`${ROOT}public/models/${j.dst}.glb`).size / 1e6).toFixed(1) + 'MB', 'tris', tris | 0, ((Date.now() - t) / 1000).toFixed(0) + 's');
}
