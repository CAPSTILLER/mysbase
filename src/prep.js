// Avatar Prep: in-browser glTF-Transform pass that shrinks rigged GLBs and closes seams before upload.
// Keeps skins + every animation clip. Environment-agnostic: the image encoder is injected (canvas in browser, sharp in Node tests).
import { WebIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, weld, simplify, prune, getBounds } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'

export const PREP_SUGGEST_BYTES = 15 * 1024 * 1024

/** Counts used for the before/after table. */
export function docStats(doc, bytes) {
  const root = doc.getRoot(); let tris = 0, verts = 0, tex = 0, open = 0
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION'); if (!pos) continue
    verts += pos.getCount(); const idx = p.getIndices(); const n = idx ? idx.getCount() : pos.getCount(); tris += n / 3
    open += openEdges(p)
  }
  for (const t of root.listTextures()) { const s = t.getSize(); if (s) tex = Math.max(tex, s[0], s[1]) }
  return { bytes, tris: Math.round(tris), verts, maxTex: tex, textures: root.listTextures().length, clips: root.listAnimations().length, skins: root.listSkins().length, joints: root.listSkins().reduce((a, s) => a + s.listJoints().length, 0), openEdges: open }
}
// Edges used by only one triangle, by *position* (what shows as a crack/see-through slit).
function openEdges(p) {
  const pos = p.getAttribute('POSITION'), idx = p.getIndices(), n = idx ? idx.getCount() : pos.getCount()
  const key = new Map(), id = new Uint32Array(pos.getCount()), v = []
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); const k = v.map(x => Math.round(x * 1e5)).join(','); let q = key.get(k); if (q === undefined) key.set(k, q = key.size); id[i] = q }
  const e = new Map(); const g = i => id[idx ? idx.getScalar(i) : i]
  for (let t = 0; t < n; t += 3) { const a = g(t), b = g(t + 1), c = g(t + 2); for (const [x, y] of [[a, b], [b, c], [c, a]]) { const k = x < y ? x * 4294967296 + y : y * 4294967296 + x; e.set(k, (e.get(k) || 0) + 1) } }
  let o = 0; for (const c of e.values()) if (c === 1) o++; return o
}

/**
 * opts: { texSize: 2048|1024, ratio: 0.5 (target tri fraction, 1 = off), error: 0.001, doubleSided: true,
 *         targetHeight: 1.8, normalize: true, encodeImage: async (bytes, mime, maxSize) => ({ bytes, mime }) , onStep }
 */
export async function prepGLB(input, opts = {}) {
  const o = { texSize: 2048, ratio: 0.5, error: 0.001, doubleSided: true, targetHeight: 1.8, normalize: true, ...opts }
  const step = o.onStep || (() => {})
  await MeshoptSimplifier.ready
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS)
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input)
  const doc = await io.readBinary(u8)
  const before = docStats(doc, u8.byteLength)
  step('seal seams')
  let seamFixed = 0
  if (o.sealSeams !== false) for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) seamFixed += unifySeamSkin(p)
  step('weld + dedup')
  // weld merges vertices that are identical in every attribute (incl. JOINTS/WEIGHTS) -> safe for skinning.
  await doc.transform(dedup(), weld())
  if (o.ratio < 1) { step('simplify'); await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: o.ratio, error: o.error, lockBorder: true })) }
  if (o.doubleSided) for (const m of doc.getRoot().listMaterials()) m.setDoubleSided(true)
  if (o.encodeImage) {
    step('textures')
    for (const t of doc.getRoot().listTextures()) {
      const img = t.getImage(); if (!img) continue
      const r = await o.encodeImage(img, t.getMimeType(), o.texSize)
      if (r && r.bytes && r.bytes.byteLength < img.byteLength) { t.setImage(r.bytes).setMimeType(r.mime); if (r.mime === 'image/webp') t.setURI(t.getURI().replace(/\.\w+$/, '.webp')) }
    }
    if (doc.getRoot().listTextures().some(t => t.getMimeType() === 'image/webp')) doc.createExtension(ALL_EXTENSIONS.find(e => e.EXTENSION_NAME === 'EXT_texture_webp')).setRequired(true)
  }
  let scaled = 1
  if (o.normalize) {
    step('scale')
    const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]
    const b = getBounds(scene), h = b.max[1] - b.min[1]
    if (h > 0) {
      scaled = (h < 0.5 || h > 3) ? o.targetHeight / h : 1 // only rescale nonsense heights; uniform so nothing distorts
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2
      const wrap = doc.createNode('AvatarPrepRoot').setScale([scaled, scaled, scaled]).setTranslation([-cx * scaled, -b.min[1] * scaled, -cz * scaled])
      for (const n of scene.listChildren()) { scene.removeChild(n); wrap.addChild(n) }
      scene.addChild(wrap)
    }
  }
  await doc.transform(prune({ keepAttributes: true }))
  const out = await io.writeBinary(doc)
  const after = docStats(await io.readBinary(out.slice()), out.byteLength)
  if (after.clips !== before.clips || after.skins !== before.skins) throw new Error(`prep lost animation data (${before.clips}→${after.clips} clips)`)
  return { glb: out, before, after, scaled, seamFixed }
}

// Cracks while animating: UV/normal seams split a vertex into copies at the same position, and AI auto-riggers
// often give those copies different JOINTS/WEIGHTS, so they move apart under skinning and open a slit.
// Give every copy at one position the same averaged (top-4, renormalised) skin weights. Returns #positions fixed.
export function unifySeamSkin(p) {
  const P = p.getAttribute('POSITION'), J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0'); if (!P || !J || !W) return 0
  const groups = new Map(), v = [0, 0, 0]
  for (let i = 0; i < P.getCount(); i++) { P.getElement(i, v); const k = Math.round(v[0] * 1e5) + ',' + Math.round(v[1] * 1e5) + ',' + Math.round(v[2] * 1e5); const g = groups.get(k); g ? g.push(i) : groups.set(k, [i]) }
  let fixed = 0; const j = [], w = []
  for (const g of groups.values()) {
    if (g.length < 2) continue
    const acc = new Map(); let sig0 = null, differ = false
    for (const i of g) { J.getElement(i, j); W.getElement(i, w); const sig = j.map((x, n) => w[n] > 1e-4 ? x + ':' + w[n].toFixed(4) : '').sort().join(); if (sig0 === null) sig0 = sig; else if (sig !== sig0) differ = true
      for (let n = 0; n < 4; n++) if (w[n] > 0) acc.set(j[n], (acc.get(j[n]) || 0) + w[n]) }
    if (!differ) continue
    const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, x) => a + x[1], 0) || 1
    const nj = [0, 0, 0, 0], nw = [0, 0, 0, 0]; top.forEach(([jt, wt], n) => { nj[n] = jt; nw[n] = wt / sum })
    for (const i of g) { J.setElement(i, nj); W.setElement(i, nw) }
    fixed++
  }
  return fixed
}

/** Browser image encoder: resize to maxSize and re-encode WebP (falls back to JPEG/PNG if the browser can't write WebP). */
export async function canvasEncode(bytes, mime, maxSize) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }))
  const k = Math.min(1, maxSize / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k)
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
  c.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close?.()
  const toBlob = (type, q) => c.convertToBlob ? c.convertToBlob({ type, quality: q }) : new Promise(r => c.toBlob(r, type, q))
  let b = await toBlob('image/webp', 0.85)
  if (!b || b.type !== 'image/webp') b = await toBlob(mime === 'image/png' ? 'image/png' : 'image/jpeg', 0.85)
  return { bytes: new Uint8Array(await b.arrayBuffer()), mime: b.type }
}
