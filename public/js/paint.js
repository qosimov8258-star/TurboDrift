import * as THREE from 'three';

// Body-paint recolouring. Every car model has one (or a few) "paint" materials (named in CAR_DEFS[i].paint).
// A recoloured CarVisual gets its own clones of those materials, everything else (glass, tyres, rims, interior)
// keeps the shared originals. Textured paint (liveries) is turned into a grey-scale map first, so number plates and
// sponsor logos stay visible while the base colour becomes exactly the chosen one.

export const PAINTS = [
  { id: 'red',    name: 'Qizil', hex: '#d3121b' },
  { id: 'blue',   name: "Ko'k",  hex: '#1458d8' },
  { id: 'yellow', name: 'Sariq', hex: '#f4c20d' },
  { id: 'black',  name: 'Qora',  hex: '#16171b' },
];

const grayCache = new WeakMap();      // original THREE.Texture -> grey-scale clone
const matCache = new WeakMap();       // original material -> Map(paintIndex -> recoloured clone)
const origOf = new WeakMap();         // mesh -> its original (shared) material
const GRAY_MAX = 2048;

function imageSize(img) { return [img.videoWidth || img.naturalWidth || img.width, img.videoHeight || img.naturalHeight || img.height]; }

/** grey-scale copy of a colour texture, normalised so that its most common brightness becomes (almost) white */
function grayTexture(src) {
  if (grayCache.has(src)) return grayCache.get(src);
  let out = null;
  try {
    const img = src.image;
    const [w0, h0] = imageSize(img);
    if (w0 && h0) {
      const k = Math.min(1, GRAY_MAX / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h);
      const px = data.data, hist = new Uint32Array(256);
      for (let i = 0; i < px.length; i += 4) {
        const l = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
        px[i] = l; hist[l]++;
      }
      // dominant brightness (ignores the very dark / very bright tail)
      let mode = 128, best = 0;
      for (let l = 24; l < 250; l++) if (hist[l] > best) { best = hist[l]; mode = l; }
      const gain = 238 / Math.max(mode, 40);
      for (let i = 0; i < px.length; i += 4) {
        const l = Math.min(255, px[i] * gain) | 0;
        px[i] = px[i + 1] = px[i + 2] = l;
      }
      g.putImageData(data, 0, 0);
      out = new THREE.CanvasTexture(cv);
      out.colorSpace = src.colorSpace;
      out.flipY = src.flipY;
      out.wrapS = src.wrapS; out.wrapT = src.wrapT;
      out.repeat.copy(src.repeat); out.offset.copy(src.offset); out.rotation = src.rotation; out.center.copy(src.center);
      out.channel = src.channel;
      out.anisotropy = 8;
    }
  } catch (e) { out = null; }
  grayCache.set(src, out);
  return out;
}

function recoloured(orig, paintIdx) {
  let per = matCache.get(orig);
  if (!per) { per = new Map(); matCache.set(orig, per); }
  let m = per.get(paintIdx);
  if (m) return m;
  m = orig.clone();
  m.color.set(PAINTS[paintIdx].hex);
  if (m.emissive) m.emissive.setRGB(0, 0, 0);
  if (m.map) { const gt = grayTexture(m.map); if (gt) m.map = gt; else m.map = null; }
  m.name = orig.name + '#' + PAINTS[paintIdx].id;
  per.set(paintIdx, m);
  return m;
}

/** swap the paint materials of a cloned car (root) for the recoloured ones. paintIdx < 0 -> factory colours */
export function applyPaint(root, paintNames, paintIdx) {
  if (!paintNames || !paintNames.length) return;
  root.traverse(o => {
    if (!o.isMesh) return;
    if (!origOf.has(o)) origOf.set(o, o.material);
    const orig = origOf.get(o);
    if (!paintNames.includes(orig.name)) return;
    for (let p = o.parent; p; p = p.parent) if (p.name && p.name.startsWith('spin_')) return;   // never the wheels
    o.material = paintIdx >= 0 && paintIdx < PAINTS.length ? recoloured(orig, paintIdx) : orig;
  });
}
