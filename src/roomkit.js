// Room Kit: drop images / 3D files / a zip → tag them → auto-layout a room → Save (uploads + room by asset name) → share / starter.
// Export kit zip = assets + room.json + README.md; Import kit zip rebuilds the room. Cap never touches JSON or ids.
import { unzipSync, zipSync, strToU8 } from 'fflate'
import * as cloud from './cloud.js'
import { SLOT_CAT } from './slots.js'

export const TAGS = ['wall-layer', 'floor-layer', 'ceiling-layer', 'wall-mount', 'ceiling-mount', 'prop', 'decal']
export const TAG_LABEL = { 'wall-layer': '🧱 wall layer', 'floor-layer': '⬛ floor layer', 'ceiling-layer': '⬜ ceiling layer', 'wall-mount': '🖼 wall-mount', 'ceiling-mount': '💡 ceiling-mount', prop: '🪑 prop', decal: '🏷 decal' }
export const TAG_TARGET = { 'wall-layer': 'wall', 'floor-layer': 'floor', 'ceiling-layer': 'ceiling', 'wall-mount': 'wall-mount', 'ceiling-mount': 'ceiling-mount', prop: 'placed model', decal: 'decal' }
const TARGET_TAG = Object.fromEntries(Object.entries(TAG_TARGET).map(([k, v]) => [v, k]))
const ROOM = { w: 5, d: 6, h: 3, wallT: 0.12, door: { w: 0.9, h: 2.1, x: 1.2 }, units: 'm' }
const r3 = v => Math.round(v * 1000) / 1000

export const slotName = s => String(s || 'asset').toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '').replace(/[^a-z0-9_.-]+/g, '_').replace(/^[^a-z0-9]+/, '').slice(0, 60) || 'asset'
export const folderName = s => String(s || 'room').replace(/[^\w .()&+,'-]/g, '_').trim().slice(0, 54) || 'room'
export const roomSlug = s => String(s || 'room').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'room'

/** Image stats on a 64×64 copy: share of transparent pixels, and how well opposite edges wrap (≈1 = seamless). */
export function imageStats(bmp) {
  const N = 64, c = document.createElement('canvas'); c.width = c.height = N
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, N, N)
  const d = x.getImageData(0, 0, N, N).data, px = (i, j) => (j * N + i) * 4
  let alpha = 0; for (let k = 3; k < d.length; k += 4) if (d[k] < 240) alpha++
  const diff = (a, b) => Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2])
  let wrap = 0, inner = 0
  for (let t = 0; t < N; t++) { wrap += diff(px(0, t), px(N - 1, t)) + diff(px(t, 0), px(t, N - 1)); inner += diff(px(N / 2, t), px(N / 2 - 1, t)) + diff(px(t, N / 2), px(t, N / 2 - 1)) }
  return { alpha: alpha / (N * N), seam: (wrap + 1) / (inner + 1), aspect: bmp.width / bmp.height }
}
/** Best-guess tag from the file name, image stats or model size. */
export function guessTag({ name, kind, sizeM = [0.5, 0.5, 0.5], stats }) {
  const n = String(name).toLowerCase(), layerish = /pad|tile|layer|panel|paper|texture|brick|plank|wood|carpet|concrete|marble|pattern|seamless/.test(n)
  if (/decal|sticker|graffiti|stencil/.test(n)) return 'decal'
  if (/ceil/.test(n) && (layerish || kind === 'image')) return 'ceiling-layer'
  if (/floor|ground|carpet/.test(n) && (layerish || kind === 'image')) return 'floor-layer'
  if (/wall/.test(n) && (layerish || kind === 'image')) return 'wall-layer'
  if (/light|lamp|chandelier|pendant|ceiling|fan\b|bulb/.test(n)) return 'ceiling-mount'
  if (/door|window|poster|painting|frame|sign|mirror|clock|tv|screen|shelf|art|photo|print/.test(n)) return 'wall-mount'
  if (kind === 'image') {
    if (stats?.alpha > 0.12) return 'decal'
    if (stats && stats.seam < 1.6 && Math.abs(Math.log(stats.aspect)) < 0.2) return /floor/.test(n) ? 'floor-layer' : 'wall-layer'
    return 'wall-mount'
  }
  const [w, h, d] = sizeM
  if (layerish && h < 0.08) return 'floor-layer'
  if (layerish && d < 0.08) return 'wall-layer'
  if (d < 0.15 && h > 0.25 && w > 0.2) return 'wall-mount'
  return 'prop'
}

/** Room template (round-3 format, assets by name) from tagged kit items. items: [{name, tag, kind, sizeM, tiles}] */
export function autoLayout(items, { name = 'My room', folder } = {}) {
  const W = ROOM.w, D = ROOM.d, H = ROOM.h, DX = ROOM.door.x, notes = {}
  const slots = items.map(it => {
    const target = TAG_TARGET[it.tag], s = { name: it.name, type: it.kind === 'image' ? 'image' : 'model', target }
    const z = it.sizeM || [0.6, 0.6, 0.05]
    if (target === 'floor' || target === 'ceiling') s.sizeM = it.kind === 'image' ? [z[0], z[1]] : [z[0], z[2], z[1]]
    else s.sizeM = it.kind === 'image' ? [z[0], z[1]] : [z[0], z[1], z[2]]
    if (['wall', 'floor', 'ceiling'].includes(target)) s.tileable = it.kind === 'model' ? true : !!it.tiles
    if (target === 'decal' || (it.kind === 'image' && it.tag === 'prop')) s.alpha = true
    s.sizeM = s.sizeM.map(r3); return s
  })
  const by = t => slots.filter(s => s.target === t)
  const base = { walls: { asset: 'core-layer:plaster', offsetM: 0, uvScale: [1, 1], color: '#f4f2ec' }, floor: { asset: 'core-layer:plaster', offsetM: 0, uvScale: [1, 1], color: '#eeece6' }, ceiling: { asset: 'core-layer:plaster', offsetM: 0, uvScale: [1, 1], color: '#f7f6f2' } }
  const layer = s => ({ asset: 'slot:' + s.name, offsetM: 0.005, uvScale: [1, 1], color: null })
  const surfaces = { overrides: {} }
  for (const [key, t] of [['walls', 'wall'], ['floor', 'floor'], ['ceiling', 'ceiling']]) { const L = by(t); surfaces[key] = [base[key], L[0] ? layer(L[0]) : null, null]; if (key !== 'walls') L.slice(1).forEach(s => { notes[s.name] = 'not placed: one layer per floor/ceiling' }) }
  // extra wall layers: one wall each (north, east, west, south)
  by('wall').slice(1, 5).forEach((s, i) => { surfaces.overrides[['north', 'east', 'west', 'south'][i]] = [base.walls, layer(s), null] })
  let id = 1; const out = []
  const walls = { north: { len: W, rot: 0, at: a => [a, -D / 2 + 0.02] }, west: { len: D, rot: 90, at: a => [-W / 2 + 0.02, a] }, east: { len: D, rot: -90, at: a => [W / 2 - 0.02, a] }, south: { len: W, rot: 180, at: a => [a, D / 2 - 0.02], span: [-W / 2, DX - ROOM.door.w / 2 - 0.15] } }
  // doors go in the doorway, windows high on the side walls; the rest spread round-robin across the walls at eye height
  const wm = by('wall-mount'), doors = wm.filter(s => /door/.test(s.name)), rest = wm.filter(s => !doors.includes(s))
  doors.forEach((s, i) => { if (i === 0) out.push({ id: id++, slot: s.name, pos: [DX, 0, r3(D / 2 - 0.02)], rotY: 180, wall: true, face: 'south' }); else rest.push(s) })
  const spread = (list, order, yOf) => {
    const per = Object.fromEntries(order.map(f => [f, []])); list.forEach((s, i) => per[order[i % order.length]].push(s))
    for (const f of order) { const w = walls[f], [a0, a1] = w.span || [-w.len / 2, w.len / 2], n = per[f].length
      per[f].forEach((s, k) => { const a = a0 + (a1 - a0) * (k + 0.5) / n, [x, z] = w.at(a); out.push({ id: id++, slot: s.name, pos: [r3(x), r3(yOf(s)), r3(z)], rotY: w.rot, wall: true, face: f }) }) }
  }
  spread(rest, ['north', 'west', 'east', 'south'], s => s.sizeM[1] > 1.8 ? 0 : /window/.test(s.name) ? 0.9 : Math.max(0.05, 1.5 - s.sizeM[1] / 2))
  spread(by('decal'), ['east', 'west', 'south', 'north'], s => Math.max(0.2, 0.75 - s.sizeM[1] / 2))
  // ceiling-mounts evenly spaced down the middle (two rows when there are many)
  const cm = by('ceiling-mount'), cols = cm.length > 3 ? 2 : 1, rows = Math.ceil(cm.length / cols)
  cm.forEach((s, i) => { const c = i % cols, r = Math.floor(i / cols), x = cols === 1 ? 0 : (c ? 1 : -1) * W / 4, z = -D / 2 + D * (r + 0.5) / rows; out.push({ id: id++, slot: s.name, pos: [r3(x), r3(H - s.sizeM[1]), r3(z)], rotY: 0, mount: 'ceiling' }) })
  // props: backs against the walls (north, west, east, then south left of the door); the middle stays a walkway
  const props = by('placed model').sort((a, b) => b.sizeM[0] - a.sizeM[0]), gap = 0.15
  const runs = [{ f: 'north', a: -W / 2 + 0.1, b: W / 2 - 0.1 }, { f: 'west', a: -D / 2 + 1.0, b: D / 2 - 0.4 }, { f: 'east', a: -D / 2 + 1.0, b: D / 2 - 0.4 }, { f: 'south', a: -W / 2 + 0.4, b: DX - ROOM.door.w / 2 - 0.5 }]
  let mid = 0
  for (const s of props) {
    const w = s.sizeM[0], d = s.sizeM[2] ?? 0.5, run = runs.find(r => r.b - r.a >= w)
    if (!run) { out.push({ id: id++, slot: s.name, pos: [r3(-1 + (mid++ % 3)), 0, r3(-0.5 + 1.2 * Math.floor(mid / 3))], rotY: 0 }); continue }
    const a = run.a + w / 2; run.a += w + gap
    const off = d / 2 + 0.05, pos = run.f === 'north' ? [a, -D / 2 + off] : run.f === 'south' ? [a, D / 2 - off] : run.f === 'west' ? [-W / 2 + off, a] : [W / 2 - off, a]
    out.push({ id: id++, slot: s.name, pos: [r3(pos[0]), 0, r3(pos[1])], rotY: walls[run.f].rot })
  }
  const lights = (cm.length ? out.filter(i => i.mount === 'ceiling').slice(0, 4).map(i => [i.pos[0], H - 0.6, i.pos[2]]) : [[0, 2.5, 0]]).map((p, i) => ({ id: 900 + i, typeId: 'core:light-point', pos: p.map(r3), rotY: 0, kind: 'point', color: '#fff4e0', intensity: cm.length > 1 ? 2 : 3, distance: 8, angle: 45, penumbra: 0.4 }))
  return { layout: { version: 2, kind: 'template', name, folder: folder ?? folderName(name), slots, room: { ...ROOM, door: { ...ROOM.door } },
    ambience: { background: '#e9ecef', hemiSky: '#ffffff', hemiGround: '#d8d6d0', hemi: 1, key: 1.2, fill: 6, env: 0.4, exposure: 1.05 },
    wallPaint: '#f4f2ec', presets: [{ name: 'Tabletop', ratio: 0.1 }], lights, surfaces, items: out }, notes }
}

export const README = (layout, files) => `# ${layout.name}: Mysbase room kit

This zip rebuilds the room **${layout.name}** in Mysbase (https://mysbase.gearup.wtf).

## Rebuild it
1. Open Mysbase → **🧰 Room Kit** → **Import kit zip** → pick this zip.
2. The room appears straight away (preview). Tap **Save** to upload the assets into your
   My assets folder "${layout.folder}" (files you already have are not uploaded again) and save the room.
3. Optional: **Get share code** (anyone can open it) or **Save as starter room** (admins).

## What is inside
- \`room.json\`: the room. Assets are referenced **by name** (round-3 template format, see docs/templates.md),
  so it works for anyone who has assets with these names.
- \`assets/\`: one file per slot. The file name (without extension) is the asset name:
${files.map(f => `  - ${f}`).join('\n')}
- \`README.md\`: this file.

To change an asset, replace its file with one that has the same name (e.g. a new \`${files[0] || 'poster.png'}\`) and import again.
`

/** Read a kit (or plain) zip: { layout|null, files: [{name, ext, bytes}] } */
export function readZip(u8) {
  const all = unzipSync(u8), files = []; let layout = null
  for (const [p, d] of Object.entries(all)) {
    if (p.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(p) || !d.length) continue
    const base = p.split('/').pop(), ext = (base.split('.').pop() || '').toLowerCase()
    if (ext === 'json') { try { const j = JSON.parse(new TextDecoder().decode(d)); if (j?.version === 2 && (j.slots || j.items)) { if (!layout || /room\.json$/i.test(base)) layout = j } } catch { /* not a room */ } continue }
    if ([...cloud.MODEL_EXT, ...cloud.IMG_EXT].includes(ext)) files.push({ name: base, ext, bytes: d })
  }
  return { layout, files }
}
/** Build a kit zip (Uint8Array) for a template layout: every slot's asset (by name) + room.json + README.md. */
export async function buildKitZip(layout, onStep = () => {}) {
  const out = {}, names = [], missing = []
  for (const s of layout.slots || []) {
    const m = cloud.findAsset(s.file || s.name, s.folder ?? layout.folder)
    if (!m) { missing.push(s.name); continue }
    onStep(s.name)
    const { bytes, ext } = await cloud.assetBytes(m), f = `${s.file || s.name}.${ext}`
    out['assets/' + f] = bytes; names.push(f)
  }
  const room = structuredClone(layout)
  out['room.json'] = strToU8(JSON.stringify(room, null, 1)); out['README.md'] = strToU8(README(layout, names))
  return { zip: zipSync(out, { level: 6 }), missing, files: names }
}

// ---------------- UI ----------------
let A = null // app hooks: serialize, deserialize, toast
const K = { name: '', items: [], laid: false, layout: null, imported: false }
const $ = id => document.getElementById(id)
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

async function addFile(name, ext, bytes, preset = {}) {
  const it = { key: crypto.randomUUID(), file: name, ext, name: slotName(preset.name || name), status: 'reading…', tag: 'prop', guessed: true }
  K.items.push(it); render()
  try {
    const p = await cloud.prepare(name, ext, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), folderName(K.name), { category: 'prop' })
    it.prep = p; it.kind = p.meta.kind
    if (p.meta.kind === 'image') { it.stats = imageStats(p.image); it.thumb = URL.createObjectURL(p.blobs[p.meta.original.file]); it.sizeM = p.meta.sizeM.slice(0, 2) }
    else { it.sizeM = p.meta.sizeM; if (p.blobs['thumb.png']) it.thumb = URL.createObjectURL(p.blobs['thumb.png']) }
    if (preset.tag) { it.tag = preset.tag; it.guessed = false } else it.tag = guessTag({ name: it.name, kind: it.kind, sizeM: it.sizeM, stats: it.stats })
    it.tiles = preset.tiles ?? (it.kind === 'image' ? (it.stats.seam < 1.6) : true)
    if (it.kind === 'image') { const w = preset.sizeM?.[0] || (it.tag.endsWith('layer') ? (it.tiles ? 0.6 : 1) : it.tag === 'decal' ? 0.5 : 0.8); setWidth(it, w) }
    it.status = p.meta.needsConverter ? '⚠ ' + (p.meta.note || 'needs converter') : ''
  } catch (e) { it.status = '❌ ' + (e?.message || e) }
  dedupe(); render()
}
function setWidth(it, w) { const a = it.stats?.aspect || 1; it.sizeM = [r3(w), r3(w / a)] }
function dedupe() { const seen = new Set(); for (const it of K.items) { let n = it.name, i = 2; while (seen.has(n)) n = `${it.name}_${i++}`; it.name = n; seen.add(n) } }
async function addFiles(fileList) {
  for (const f of fileList) {
    const ext = (f.name.split('.').pop() || '').toLowerCase(), bytes = new Uint8Array(await f.arrayBuffer())
    if (ext === 'zip') { await importZip(bytes, f.name); continue }
    if (![...cloud.MODEL_EXT, ...cloud.IMG_EXT].includes(ext)) { A.toast(`Skipped ${f.name} (use images, 3D files or a zip)`); continue }
    await addFile(f.name, ext, bytes)
  }
}
async function importZip(bytes, zipName) {
  let z; try { z = readZip(bytes) } catch (e) { return A.toast('❌ Not a readable zip: ' + (e?.message || e)) }
  if (z.layout) { // a kit: restore name, tags and the saved layout
    K.name = z.layout.name || zipName.replace(/\.zip$/i, ''); K.layout = z.layout; K.imported = true
    const slotOf = n => (z.layout.slots || []).find(s => slotName(s.file || s.name) === slotName(n))
    await Promise.all(z.files.map(f => { const s = slotOf(f.name); return addFile(f.name, f.ext, f.bytes, s ? { name: s.file || s.name, tag: s.target === 'decal' ? 'decal' : TARGET_TAG[s.target], tiles: s.tileable, sizeM: s.sizeM } : {}) }))
    $('rkName').value = K.name; apply(true); A.toast(`✅ Kit "${K.name}" imported: ${z.files.length} files. Tap Save to keep it.`, 4000)
  } else {
    if (!K.name) { K.name = zipName.replace(/\.zip$/i, ''); $('rkName').value = K.name }
    await Promise.all(z.files.map(f => addFile(f.name, f.ext, f.bytes)))
  }
}
function render() {
  const g = $('rkGrid'); if (!g) return
  g.innerHTML = K.items.length ? '' : '<div class="small rkEmpty">Drop images, 3D files (GLB, OBJ, FBX, STL…) or a zip here, or tap <b>Add files</b>.</div>'
  for (const it of K.items) {
    const c = document.createElement('div'); c.className = 'rkCard' + (it.status.startsWith('❌') || it.status.startsWith('⚠') ? ' bad' : '')
    const size = it.sizeM ? it.sizeM.map(v => +(+v).toFixed(2)).join('×') + ' m' : ''
    c.innerHTML = `<div class="rkThumb">${it.thumb ? `<img src="${it.thumb}" alt="">` : `<span>${it.status ? esc(it.status) : it.kind === 'image' ? '🖼' : '📦'}</span>`}</div>
      <input class="rkN" value="${esc(it.name)}" aria-label="name">
      <select class="rkT" aria-label="tag">${TAGS.map(t => `<option value="${t}" ${t === it.tag ? 'selected' : ''}>${TAG_LABEL[t]}</option>`).join('')}</select>
      <div class="rkMeta small">${it.guessed ? '<span class="rkG" title="guessed from name/size">auto</span> ' : ''}${esc(it.kind || '')} · ${esc(size)}
      ${it.kind === 'image' ? `<label>w <input class="rkW" type="number" step="0.05" min="0.05" max="10" value="${it.sizeM?.[0] ?? ''}"> m</label>${it.tag.endsWith('layer') ? `<label><input class="rkTile" type="checkbox" ${it.tiles ? 'checked' : ''}> tiles</label>` : ''}` : ''}
      ${it.note ? `<div class="err">${esc(it.note)}</div>` : ''}${it.status && it.thumb ? `<div>${esc(it.status)}</div>` : ''}</div>
      <button class="rkX" title="Remove">✕</button>`
    c.querySelector('.rkN').onchange = e => { it.name = slotName(e.target.value); dedupe(); render() }
    c.querySelector('.rkT').onchange = e => { it.tag = e.target.value; it.guessed = false; render() }
    c.querySelector('.rkW')?.addEventListener('change', e => { setWidth(it, Math.max(0.05, +e.target.value || 0.5)); render() })
    c.querySelector('.rkTile')?.addEventListener('change', e => { it.tiles = e.target.checked })
    c.querySelector('.rkX').onclick = () => { K.items.splice(K.items.indexOf(it), 1); render() }
    c.dataset.name = it.name; c.dataset.tag = it.tag
    g.appendChild(c)
  }
  const ok = K.items.filter(i => i.prep && !i.prep.meta.needsConverter).length
  $('rkCount').textContent = K.items.length ? `${K.items.length} files · ${ok} ready` : ''
}
/** Fold the kit's names/tags/sizes into the prepared metas and show them in the room (local preview, nothing uploaded). */
function preps() {
  const folder = folderName(K.name)
  return K.items.filter(i => i.prep && !i.prep.meta.needsConverter).map(i => {
    const cat = SLOT_CAT[TAG_TARGET[i.tag]], m = { ...i.prep.meta, name: i.name, folder, category: cat, wall: cat === 'wall-mount' }
    if (i.kind === 'image') m.sizeM = [i.sizeM[0], i.sizeM[1], 0.02]
    return { meta: m, blobs: i.prep.blobs, item: i }
  })
}
function apply(keepLayout = false) {
  K.name = $('rkName').value.trim() || K.name || 'My room'; $('rkName').value = K.name
  const P = preps(); if (!P.length) return A.toast('Add some images or 3D files first')
  cloud.setLocalAssets(P)
  let layout
  if (keepLayout && K.layout) { layout = { ...K.layout, name: K.name, folder: folderName(K.name) }; for (const s of layout.slots || []) delete s.folder }
  else { const r = autoLayout(P.map(p => ({ name: p.item.name, tag: p.item.tag, kind: p.item.kind, sizeM: p.item.sizeM, tiles: p.item.tiles })), { name: K.name }); layout = r.layout; for (const it of K.items) it.note = r.notes[it.name] || '' }
  A.deserialize(layout); K.laid = true; K.layout = layout
  const sel = $('roomSel'); let o = sel.querySelector('option[value="__kit"]'); if (!o) { o = document.createElement('option'); o.value = '__kit'; sel.appendChild(o) }
  o.textContent = `🧰 ${K.name} (Room Kit)`; sel.value = '__kit'
  close(); $('rkBar').classList.remove('hidden'); render()
  A.toast(`🧰 ${K.name}: ${P.length} assets laid out (preview, not saved). Tweak in Dev mode, then Save.`, 3800)
}
async function save() {
  const out = $('rkOut'); out.classList.remove('hidden')
  try {
    if (!K.laid) apply()
    const P = preps(), folder = folderName(K.name), slug = roomSlug(K.name)
    await cloud.ensureWallet()
    out.innerHTML = `<b>Saving "${esc(K.name)}"…</b><div id="rkRows"></div>`
    const rows = P.map(p => { const r = document.createElement('div'); r.className = 'small'; r.textContent = `${p.meta.name}: waiting`; $('rkRows').appendChild(r); return r })
    const ids = await cloud.uploadKit(P, folder, (i, t) => { rows[i].textContent = `${P[i].meta.name}: ${t}` })
    const layout = A.serialize(); layout.name = K.name; layout.folder = folder
    await cloud.saveRoomAs(slug, layout); K.layout = layout
    out.innerHTML = `<b>✅ Saved room "${esc(K.name)}"</b> · ${ids.length} assets in 📁 ${esc(folder)} · server room <code>${esc(slug)}</code>
      <div class="row"><button id="rkShare">Get share code</button><button id="rkStar" class="hidden">Save as starter room</button><button id="rkOutX">Close</button></div><div id="rkLink" class="small"></div>`
    $('rkOutX').onclick = () => out.classList.add('hidden')
    $('rkShare').onclick = async () => { try { const { code } = await cloud.shareLayout(layout, { name: K.name, kind: 'template', assetIds: ids }); const u = `${location.origin}/?room=${code}`; $('rkLink').innerHTML = `Code <b>${code}</b> · <a href="${u}">${esc(u)}</a>`; navigator.clipboard?.writeText(u).catch(() => {}) } catch (e) { A.toast('❌ ' + e.message) } }
    $('rkStar').onclick = async () => {
      try {
        await cloud.saveStarterRoom(slug, layout, { name: K.name, assetIds: ids })
        const priv = ids.filter(id => !cloud.allAssets().find(m => m.id === id)?.public)
        if (priv.length && confirm(`Make the ${priv.length} assets of "${K.name}" public so visitors don't see placeholders?`)) await cloud.setAssetsPublic(priv, true)
        const u = `${location.origin}/?room=${slug}`; $('rkLink').innerHTML = `★ Starter room: <a href="${u}">${esc(u)}</a>`; A.starterAdded?.(slug, K.name)
      } catch (e) { A.toast('❌ ' + e.message) }
    }
    cloud.whoAmI().then(m => { if (m?.admin) $('rkStar').classList.remove('hidden') }).catch(() => {})
    A.toast(`✅ Saved "${K.name}"`)
  } catch (e) { out.innerHTML = `<span class="err">❌ ${esc(e?.shortMessage || e?.message || e)}</span> <button onclick="this.parentNode.classList.add('hidden')">Close</button>` }
}
async function exportZip() {
  try {
    if (!K.laid && K.items.length) apply()
    const layout = A.serialize(); if (!layout.slots?.length) return A.toast('This room has no named assets to export (load a template or use Room Kit)')
    if (K.name) { layout.name = K.name; layout.folder = folderName(K.name) }
    A.toast('Packing kit…')
    const { zip, missing } = await buildKitZip(layout, n => A.toast(`Packing ${n}…`, 800))
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' })); a.download = `${roomSlug(layout.name)}-kit.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000)
    A.toast(`✅ ${a.download}${missing.length ? ` · missing: ${missing.join(', ')}` : ''}`, 3500)
    return { zip, missing }
  } catch (e) { A.toast('❌ ' + (e?.message || e)) }
}
function open() { $('rk').classList.remove('hidden'); render() }
function close() { $('rk').classList.add('hidden') }
function reset() { K.items = []; K.name = ''; K.laid = false; K.layout = null; K.imported = false; $('rkName').value = ''; render() }

export function initRoomKit(app) {
  A = app
  document.body.insertAdjacentHTML('beforeend', `
<div id="rk" class="hidden"><div class="rkBox">
  <div class="devhead"><b>🧰 Room Kit</b><button id="rkClose">✕ Close</button></div>
  <label class="rkNameL">Room name <input id="rkName" placeholder="e.g. Never Happier" maxlength="54"></label>
  <div class="row"><button id="rkAdd" class="pri">＋ Add files</button><button id="rkImport">Import kit zip</button><button id="rkReset">Clear</button><span id="rkCount" class="small"></span></div>
  <input id="rkFiles" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.glb,.gltf,.obj,.stl,.ply,.fbx,.usdz,.zip" hidden>
  <div id="rkGrid"></div>
  <div class="row rkActions"><button id="rkLayout" class="pri">✨ Auto-layout</button><button id="rkSave">💾 Save</button><button id="rkExport">⬇ Export kit zip</button></div>
  <div class="small">Tags are guessed from the name, picture and size; change any that are wrong. Auto-layout fills the 5×6×3 m room; tweak it in Dev mode, then Save uploads everything into a folder named after the room.</div>
</div></div>
<div id="rkBar" class="hidden"><b>🧰</b><button id="rkBack">Kit</button><button id="rkSave2" class="pri">💾 Save</button><button id="rkExport2">⬇ Zip</button></div>
<div id="rkOut" class="hidden"></div>`)
  $('top').insertBefore(Object.assign(document.createElement('button'), { id: 'bKit', textContent: '🧰 Room Kit', onclick: open }), $('roomSel'))
  $('rkClose').onclick = close; $('rkBack').onclick = open
  $('rkAdd').onclick = $('rkImport').onclick = () => $('rkFiles').click()
  $('rkFiles').onchange = e => { const f = [...e.target.files]; e.target.value = ''; addFiles(f) }
  $('rkReset').onclick = reset
  $('rkName').onchange = e => { K.name = e.target.value.trim() }
  $('rkLayout').onclick = () => { if (K.laid && !confirm('Re-run auto-layout? Your tweaks in the room will be replaced.')) return; K.imported = false; apply() }
  $('rkSave').onclick = $('rkSave2').onclick = () => { close(); save() }
  $('rkExport').onclick = $('rkExport2').onclick = exportZip
  const box = $('rk')
  box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('drag') })
  box.addEventListener('dragleave', () => box.classList.remove('drag'))
  box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('drag'); addFiles([...e.dataTransfer.files]) })
  if (new URLSearchParams(location.search).has('kit')) open()
  return { open, close, state: K, addFiles, apply, save, exportZip, importZip }
}
