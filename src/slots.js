// Template slots: named holes in a template that get filled by assets with the same name (see docs/templates.md).
export const SLOT_TARGETS = ['wall', 'floor', 'ceiling', 'wall-mount', 'ceiling-mount', 'decal', 'placed model']
export const SLOT_CAT = { wall: 'wall-layer', floor: 'floor-layer', ceiling: 'ceiling-layer', 'wall-mount': 'wall-mount', decal: 'wall-mount', 'ceiling-mount': 'ceiling-mount', 'placed model': 'prop' }
const NAME = /^[a-z0-9][a-z0-9_.-]{0,59}$/i
const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? Math.min(+v, 50) : d)
export function normSlot(s) {
  if (!s || !NAME.test(String(s.name || ''))) return null
  const target = SLOT_TARGETS.includes(s.target) ? s.target : s.target === 'surface' ? 'wall' : s.type === 'image' ? 'wall-mount' : 'placed model'
  const type = s.type === 'image' || s.type === 'model' ? s.type : ['wall', 'floor', 'ceiling', 'decal'].includes(target) ? 'image' : 'model'
  const z = Array.isArray(s.sizeM) ? s.sizeM : [s.sizeM, s.sizeM]
  const out = { name: String(s.name), type, sizeM: [num(z[0], 1), num(z[1], 1)], tileable: !!s.tileable, target }
  if (z[2] != null && Number.isFinite(+z[2])) out.sizeM.push(Math.max(0, Math.min(+z[2], 50)))
  for (const k of ['folder', 'file', 'category', 'note', 'prompt']) if (s[k] != null && s[k] !== '') out[k] = String(s[k]).slice(0, 400)
  if (s.alpha != null) out.alpha = !!s.alpha
  if (s.ceiling === 'flat' || s.ceiling === 'hang') out.ceiling = s.ceiling // image on the ceiling: flat layer (default) or hanging panel
  if (s.implicit) out.implicit = true
  return out
}
export const normSlots = a => { const seen = new Set(); return (Array.isArray(a) ? a : []).map(normSlot).filter(s => s && !seen.has(s.name) && seen.add(s.name)) }
/** A {name, folder} reference used directly in a layout becomes an implicit slot with that name. */
export function implicitSlot(ref, o = {}) {
  const name = String(ref?.name || 'asset').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 60) || 'asset'
  return normSlot({ name, file: ref?.name, folder: ref?.folder, sizeM: o.sizeM || [0.5, 0.5, 0.5], ...o, implicit: true })
}
const px = ([w, h]) => { const k = 1024 / Math.max(w, h); return `${Math.round(w * k)}×${Math.round(h * k)} px` }
const WHAT = {
  wall: 'wall surface texture', floor: 'floor surface texture', ceiling: 'ceiling surface texture', 'wall-mount': 'wall-mounted item (hangs flat on a wall, back against the wall)',
  decal: 'decal / sticker on a wall (transparent background)', 'ceiling-mount': 'ceiling-mounted item (top touches the ceiling)', 'placed model': 'object standing on the floor',
}
/** Plain-text spec an AI (or a person) can follow to produce the files for every slot. */
export function slotSpec(tpl, status = []) {
  if (!tpl?.slots?.length) return 'This room has no slots. Load a template (Template & slots → Load template) first.'
  const st = new Map(status.map(s => [s.name, s]))
  const L = [`# Asset spec for template "${tpl.name || 'untitled'}"${tpl.folder ? ` (put files in folder "${tpl.folder}")` : ''}`, '',
    'Make one file per slot. The FILE NAME must equal the slot name (any extension, case-insensitive), e.g. wall_pad.png.',
    'Upload them one by one or as a single .zip in Mysbase → My assets; the room fills itself. Units are metres; pivot = base centre, front faces +z.', '']
  for (const s of tpl.slots) {
    const f = st.get(s.name)
    const size = s.sizeM.length > 2 ? `${s.sizeM[0]} × ${s.sizeM[1]} × ${s.sizeM[2]} m (w × h × d)` : `${s.sizeM[0]} × ${s.sizeM[1]} m (w × h)`
    const lines = [`## ${s.name}${f ? (f.filled ? `  [filled by ${f.filled}]` : '  [EMPTY]') : ''}`, `- What: ${WHAT[s.target] || s.target}`]
    if (s.type === 'image') {
      lines.push(`- File: ${s.name}.png (or .jpg/.webp), image, about ${px(s.sizeM)}`)
      if (['wall', 'floor', 'ceiling'].includes(s.target)) lines.push(s.tileable ? `- Seamless TILEABLE texture; one tile covers ${s.sizeM[0]} × ${s.sizeM[1]} m and repeats across the ${s.target}. No borders, no lighting gradients, edges must wrap.` : `- Stretched once over the whole ${s.target} (not tiled).`)
      else lines.push(`- Real-world size ${size}. ${s.target === 'decal' ? 'PNG with transparent background (alpha); only the artwork is visible.' : 'Front-on, flat, no perspective; fills the frame.'}`)
    } else {
      lines.push(`- File: ${s.name}.glb (GLB 3D model, metres, Y up, base at y=0, front faces +z), real size ${size}`)
      lines.push(`- If you can only make an image: ${s.name}.png with a transparent background; it is shown as a flat standing cutout.`)
    }
    if (s.note) lines.push(`- Note: ${s.note}`)
    if (s.prompt) lines.push(`- Look: ${s.prompt}`)
    L.push(...lines, '')
  }
  return L.join('\n')
}
