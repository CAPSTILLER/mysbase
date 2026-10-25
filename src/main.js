import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { initCloud, assetType, assetMetas, layerSource, ensureAssets, snapOfMeta, findAsset, allAssets } from './cloud.js'
import { LAYERS, layerParts, buildVaultDoor, buildTally, buildWindow } from './builtins.js'

// ---------- SIZE KEY (1 unit = 1 m) ----------
const ROOM = { w: 5, d: 6, h: 3, wallT: 0.12 }
const DOOR = { w: 0.9, h: 2.1, x: 1.2 } // doorway in the south wall (z = +d/2)
const AVATAR = { h: 1.8, r: 0.25, eye: 1.65 }
const MAX_LIGHTS = 8, MAX_OFFSET = 0.05
const SNAP_POS = 0.01, SNAP_ROT = 1
const $ = id => document.getElementById(id)
const snap = v => Math.round(v / SNAP_POS) * SNAP_POS
const r3 = v => Math.round(v * 1000) / 1000
const DEG = Math.PI / 180
const V = (x, y, z) => new THREE.Vector3(x, y, z)
const { w: W, d: D, h: H, wallT: T } = ROOM

// ---------- renderer / scene ----------
const canvas = $('c')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
const scene = new THREE.Scene()
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
const camera = new THREE.PerspectiveCamera(70, 1, 0.03, 60)
const hemi = new THREE.HemisphereLight('#fff1dc', '#5a4f45', 0.9); scene.add(hemi)
const key = new THREE.DirectionalLight('#ffe2b8', 1.6)
key.position.set(-6, 5, -2); key.castShadow = true
key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6; key.shadow.bias = -0.0005
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 })
scene.add(key)
const fill = new THREE.PointLight('#ffd9a8', 6, 8, 1.6); fill.position.set(0.5, 2.7, 0.5); scene.add(fill)
const AMB_DEFAULT = { background: '#2a2622', hemiSky: '#fff1dc', hemiGround: '#5a4f45', hemi: 0.9, key: 1.6, fill: 6, env: 0.35, exposure: 1.05 }
let ambience = { ...AMB_DEFAULT }
function applyAmbience(a) {
  ambience = { ...AMB_DEFAULT, ...(a || {}) }
  scene.background = new THREE.Color(ambience.background); hemi.color.set(ambience.hemiSky); hemi.groundColor.set(ambience.hemiGround)
  hemi.intensity = ambience.hemi; key.intensity = ambience.key; key.visible = ambience.key > 0; fill.intensity = ambience.fill; fill.visible = ambience.fill > 0
  scene.environmentIntensity = ambience.env; renderer.toneMappingExposure = ambience.exposure
}

// ---------- room shell (pick targets) ----------
const pickables = []
const wallMat = new THREE.MeshStandardMaterial({ color: '#d9cfc0', roughness: 0.95 })
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.9 }))
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.userData.kind = 'floor'; scene.add(floor); pickables.push(floor)
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: '#cfcac2', roughness: 1 }))
ceil.rotation.x = Math.PI / 2; ceil.position.y = H; ceil.userData.kind = 'ceiling'; scene.add(ceil); pickables.push(ceil)
const walls = []
function wallBox(w, h, d, x, y, z, face) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat)
  m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = true
  m.userData.kind = 'wall'; m.userData.face = face
  scene.add(m); pickables.push(m); walls.push(m)
}
wallBox(W + 2 * T, H, T, 0, H / 2, -D / 2 - T / 2, 'north')
wallBox(T, H, D, -W / 2 - T / 2, H / 2, 0, 'west')
wallBox(T, H, D, W / 2 + T / 2, H / 2, 0, 'east')
{ const z = D / 2 + T / 2, L = -W / 2 - T, R = W / 2 + T, dl = DOOR.x - DOOR.w / 2, dr = DOOR.x + DOOR.w / 2
  wallBox(dl - L, H, T, (L + dl) / 2, H / 2, z, 'south'); wallBox(R - dr, H, T, (dr + R) / 2, H / 2, z, 'south')
  wallBox(DOOR.w, H - DOOR.h, T, DOOR.x, DOOR.h + (H - DOOR.h) / 2, z, 'south')
  const frame = new THREE.MeshStandardMaterial({ color: '#5b4330' })
  for (const [w, h, x, y] of [[0.05, DOOR.h, dl, DOOR.h / 2], [0.05, DOOR.h, dr, DOOR.h / 2], [DOOR.w + 0.1, 0.05, DOOR.x, DOOR.h]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, T + 0.2), frame); f.position.set(x, y, z - 0.04); scene.add(f) }
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.w, DOOR.h), new THREE.MeshBasicMaterial({ color: '#1b1814' }))
  outside.position.set(DOOR.x, DOOR.h / 2, z + T / 2 + 0.01); outside.rotation.y = Math.PI; scene.add(outside) }

// ---------- surfaces: 3 layers per flat surface ----------
// Face frame: point = o + u*U + v*V + n*N (n points into the room). Shape UVs are metres.
const FACES = {
  north: { o: V(0, 0, -D / 2), u: V(1, 0, 0), v: V(0, 1, 0), n: V(0, 0, 1), U: [-W / 2, W / 2], Vr: [0, H] },
  south: { o: V(0, 0, D / 2), u: V(-1, 0, 0), v: V(0, 1, 0), n: V(0, 0, -1), U: [-W / 2, W / 2], Vr: [0, H], hole: [-DOOR.x - DOOR.w / 2, 0, -DOOR.x + DOOR.w / 2, DOOR.h] },
  west: { o: V(-W / 2, 0, 0), u: V(0, 0, -1), v: V(0, 1, 0), n: V(1, 0, 0), U: [-D / 2, D / 2], Vr: [0, H] },
  east: { o: V(W / 2, 0, 0), u: V(0, 0, 1), v: V(0, 1, 0), n: V(-1, 0, 0), U: [-D / 2, D / 2], Vr: [0, H] },
  floor: { o: V(0, 0, 0), u: V(1, 0, 0), v: V(0, 0, -1), n: V(0, 1, 0), U: [-W / 2, W / 2], Vr: [-D / 2, D / 2] },
  ceiling: { o: V(0, H, 0), u: V(1, 0, 0), v: V(0, 0, 1), n: V(0, -1, 0), U: [-W / 2, W / 2], Vr: [-D / 2, D / 2] },
}
const WALL_FACES = ['north', 'south', 'east', 'west']
const layer = (asset, o = {}) => ({ asset, offsetM: 0, uvScale: [1, 1], color: null, ...o })
const DEFAULT_SURFACES = () => ({ walls: [layer('core-layer:plaster'), null, null], floor: [layer('core-layer:wood-floor'), null, null],
  ceiling: [layer('core-layer:plaster', { color: '#efe8dc' }), null, null], overrides: {} })
let surfaces = DEFAULT_SURFACES()
const outer = { north: 0, south: 0, east: 0, west: 0, floor: 0, ceiling: 0 } // outermost layer depth per face (m)
const bounds = () => ({ x0: -W / 2 + outer.west, x1: W / 2 - outer.east, z0: -D / 2 + outer.north, z1: D / 2 - outer.south, y0: outer.floor, y1: H - outer.ceiling })
function normLayers(a) { const out = [0, 1, 2].map(i => { const L = a?.[i]; if (!L || !L.asset) return null
  return { asset: String(L.asset), offsetM: Math.max(0, Math.min(MAX_OFFSET, +L.offsetM || 0)), uvScale: Array.isArray(L.uvScale) ? [+L.uvScale[0] || 1, +(L.uvScale[1] ?? L.uvScale[0]) || 1] : [+L.uvScale || 1, +L.uvScale || 1], color: L.color || null } }); return out }
function normSurfaces(s) {
  const d = DEFAULT_SURFACES(), o = { walls: normLayers(s?.walls ?? d.walls), floor: normLayers(s?.floor ?? d.floor), ceiling: normLayers(s?.ceiling ?? d.ceiling), overrides: {} }
  for (const f of WALL_FACES) if (s?.overrides?.[f]) o.overrides[f] = normLayers(s.overrides[f])
  return o
}
const layersFor = f => f === 'floor' ? surfaces.floor : f === 'ceiling' ? surfaces.ceiling : surfaces.overrides[f] || surfaces.walls
const catFor = f => f === 'floor' ? 'floor-layer' : f === 'ceiling' ? 'ceiling-layer' : 'wall-layer'
const shapeGeo = {}
function faceGeo(f) {
  if (shapeGeo[f]) return shapeGeo[f]
  const F = FACES[f], s = new THREE.Shape()
  s.moveTo(F.U[0], F.Vr[0]); s.lineTo(F.U[1], F.Vr[0]); s.lineTo(F.U[1], F.Vr[1]); s.lineTo(F.U[0], F.Vr[1]); s.closePath()
  if (F.hole) { const [a, b, c, d] = F.hole, h = new THREE.Path(); h.moveTo(a, b + 0.001); h.lineTo(a, d); h.lineTo(c, d); h.lineTo(c, b + 0.001); h.closePath(); s.holes.push(h) }
  return (shapeGeo[f] = new THREE.ShapeGeometry(s))
}
const resolved = new Map() // 'asset:<id>' -> {kind,tex,sizeM}|{kind:'model',obj}
let surfGroup = null
function layerMaterial(f, L) {
  const b = LAYERS[L.asset], up = resolved.get(L.asset)
  let parts, tile
  if (b) { parts = layerParts(L.asset); tile = b.tileM } else if (up?.kind === 'image') { parts = { map: up.tex }; tile = [up.sizeM[0] || 1, up.sizeM[1] || 1] } else return null
  const o = { roughness: 0.9, ...parts }
  for (const k of ['map', 'emissiveMap']) if (parts[k]) { const t = parts[k].clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / (tile[0] * L.uvScale[0]), 1 / (tile[1] * L.uvScale[1])); t.needsUpdate = true; o[k] = t }
  o.color = L.color || (b?.paintable && WALL_FACES.includes(f) ? '#' + wallMat.color.getHexString() : '#ffffff')
  return new THREE.MeshStandardMaterial(o)
}
function modelTiles(f, L, obj) {
  const F = FACES[f], wrap = new THREE.Group(), inner = obj.clone(true)
  if (f === 'floor' || f === 'ceiling') inner.rotation.x = Math.PI / 2
  wrap.add(inner); wrap.scale.set(L.uvScale[0], L.uvScale[1], 1); wrap.updateMatrixWorld(true)
  const bb = new THREE.Box3().setFromObject(wrap), sz = bb.getSize(V()); inner.position.sub(bb.min.clone().divide(wrap.scale))
  const tw = Math.max(sz.x, 0.05), th = Math.max(sz.y, 0.05), nu = Math.ceil((F.U[1] - F.U[0]) / tw), nv = Math.ceil((F.Vr[1] - F.Vr[0]) / th)
  const g = new THREE.Group()
  if (nu * nv > 400) { toast(`Layer tile too small (${nu * nv} copies) — raise uvScale`); return { g, t: sz.z } }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const c = wrap.clone(true); c.position.set(F.U[0] + i * tw, F.Vr[0] + j * th, 0); g.add(c) }
  g.traverse(o => { if (o.isMesh) o.receiveShadow = true })
  return { g, t: sz.z }
}
function buildSurfaces() {
  if (surfGroup) { scene.remove(surfGroup); surfGroup.traverse(o => { if (o.isMesh && o.material?.isMaterial && !o.userData.shared) o.material.dispose() }) }
  surfGroup = new THREE.Group(); scene.add(surfGroup)
  for (const f of Object.keys(FACES)) {
    const F = FACES[f], basis = new THREE.Matrix4().makeBasis(F.u, F.v, F.n)
    let depth = 0, n = 0
    for (const L of layersFor(f)) {
      if (!L) continue
      depth += L.offsetM; n++
      const N = depth + n * 0.0006
      let obj = null, thick = 0
      if (L.asset.startsWith('asset:') && !resolved.has(L.asset)) {
        layerSource(L.asset.slice(6)).then(r => { resolved.set(L.asset, r); buildSurfaces(); reflow() }).catch(() => {})
      }
      const up = resolved.get(L.asset)
      if (up?.kind === 'model') { const t = modelTiles(f, L, up.obj); obj = t.g; thick = t.t }
      else { const m = layerMaterial(f, L); if (m) { obj = new THREE.Mesh(faceGeo(f), m); obj.receiveShadow = true; obj.userData.shared = false } }
      if (!obj) continue
      obj.matrixAutoUpdate = false; obj.matrix.copy(basis).setPosition(F.o.clone().addScaledVector(F.n, N)); surfGroup.add(obj)
      depth += thick
    }
    outer[f] = r3(depth + n * 0.0006)
  }
}

// ---------- catalog (real sizes; pivot = base centre; front faces +z) ----------
const std = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })
function box(g, w, h, d, x, y, z, c) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(c)); m.position.set(x, y, z); g.add(m); return m }
let rockTemplate = null
const CATALOG = {
  'core:bed': { name: 'Bed', category: 'prop', size: [1.5, 0.95, 2.0], top: 0.55, holds: true, build(g) {
    box(g, 1.5, 0.35, 2.0, 0, 0.175, 0, '#6b4a33'); box(g, 1.44, 0.2, 1.9, 0, 0.45, 0.03, '#e9e4da')
    box(g, 1.5, 0.95, 0.06, 0, 0.475, -0.97, '#5b3d29'); box(g, 0.55, 0.1, 0.35, -0.38, 0.6, -0.72, '#fff'); box(g, 0.55, 0.1, 0.35, 0.38, 0.6, -0.72, '#fff')
    box(g, 1.46, 0.04, 1.1, 0, 0.57, 0.42, '#3b5f8a') } },
  'core:desk': { name: 'Desk', category: 'prop', size: [1.4, 0.75, 0.7], top: 0.75, holds: true, build(g) {
    box(g, 1.4, 0.04, 0.7, 0, 0.73, 0, '#9a7350')
    for (const [x, z] of [[-0.66, -0.31], [0.66, -0.31], [-0.66, 0.31], [0.66, 0.31]]) box(g, 0.05, 0.71, 0.05, x, 0.355, z, '#3a2c22') } },
  'core:bookshelf': { name: 'Bookshelf', category: 'prop', size: [0.9, 2.0, 0.35], top: 2.0, holds: true, build(g) {
    box(g, 0.9, 2.0, 0.03, 0, 1.0, -0.16, '#6b4a33'); box(g, 0.03, 2.0, 0.35, -0.435, 1, 0, '#6b4a33'); box(g, 0.03, 2.0, 0.35, 0.435, 1, 0, '#6b4a33')
    const cols = ['#8a3b2e', '#2f5d7c', '#c9a227', '#4f7a4a', '#7a4f8a']
    for (let i = 0; i < 5; i++) { const y = 0.015 + i * 0.4; box(g, 0.84, 0.03, 0.33, 0, y, 0, '#7b583d')
      if (i < 4) for (let b = 0; b < 9; b++) box(g, 0.07, 0.22 + (b % 3) * 0.04, 0.24, -0.36 + b * 0.085, y + 0.14 + (b % 3) * 0.02, 0.02, cols[(b + i) % 5]) }
    box(g, 0.84, 0.03, 0.35, 0, 1.985, 0, '#6b4a33') } },
  'core:ent': { name: 'Entertainment center', category: 'prop', size: [1.8, 0.6, 0.5], top: 0.6, holds: true, build(g) {
    box(g, 1.8, 0.6, 0.5, 0, 0.3, 0, '#3d3029'); box(g, 0.56, 0.4, 0.01, -0.58, 0.3, 0.251, '#54443a'); box(g, 0.56, 0.4, 0.01, 0.58, 0.3, 0.251, '#54443a') } },
  'core:tv': { name: 'TV 55"', category: 'prop', size: [1.23, 0.75, 0.2], top: 0.75, build(g) {
    box(g, 1.23, 0.71, 0.04, 0, 0.42, 0, '#111'); box(g, 0.3, 0.05, 0.2, 0, 0.025, 0, '#222') } },
  'core:painting': { name: 'Painting', category: 'wall-mount', size: [0.8, 0.6, 0.04], top: 0.6, wallOnly: true, build(g) {
    box(g, 0.8, 0.6, 0.04, 0, 0.3, 0, '#2b2219'); const c = box(g, 0.72, 0.52, 0.01, 0, 0.3, 0.021, '#c96f3b')
    c.material = new THREE.MeshStandardMaterial({ map: paintingTex(), roughness: 0.9 }) } },
  'core:window': { name: 'Glowing window', category: 'wall-mount', size: [1.5, 1.25, 0.04], top: 1.25, wallOnly: true, build: buildWindow },
  'core:vault-door': { name: 'Round bronze vault door', category: 'wall-mount', size: [1.8, 1.8, 0.22], top: 1.8, wallOnly: true, lights: 1, build: buildVaultDoor },
  'core:tally7': { name: 'Tally marks (7)', category: 'wall-mount', size: [0.5, 0.25, 0.004], top: 0.25, wallOnly: true, build: buildTally },
  'core:figure': { name: 'Avatar figure 1.8 m', category: 'prop', size: [0.5, 1.8, 0.3], top: 1.8, presets: ['Tabletop'], build(g) { g.add(makeAvatarMesh('#9fb7d9')) } },
  'core:rock': { name: 'CAPs Rock avatar', category: 'prop', size: [0.6, 2.08, 0.4], top: 2.08, presets: ['Tabletop'], build(g) {
    if (rockTemplate) g.add(rockTemplate.clone(true)); else box(g, 0.6, 2.08, 0.4, 0, 1.04, 0, '#aaa') } },
  'core:light-point': { name: 'Point light', category: 'light', size: [0.12, 0.12, 0.12], top: 0.12, light: 'point', build: g => bulb(g) },
  'core:light-spot': { name: 'Spot light', category: 'light', size: [0.14, 0.12, 0.14], top: 0.12, light: 'spot', build: g => bulb(g, true) },
}
function bulb(g, spot) {
  const m = new THREE.Mesh(spot ? new THREE.ConeGeometry(0.07, 0.12, 16, 1, true) : new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff', side: THREE.DoubleSide }))
  m.position.y = 0.06; m.userData.bulb = true; g.add(m)
}
function paintingTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 96; const x = c.getContext('2d')
  const gr = x.createLinearGradient(0, 0, 0, 96); gr.addColorStop(0, '#f2a65a'); gr.addColorStop(1, '#5b2a6e'); x.fillStyle = gr; x.fillRect(0, 0, 128, 96)
  x.fillStyle = '#ffe9a8'; x.beginPath(); x.arc(84, 40, 14, 0, 7); x.fill(); x.fillStyle = '#2b1a33'; x.fillRect(0, 70, 128, 26)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}
function makeAvatarMesh(color) {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(AVATAR.r, AVATAR.h - 2 * AVATAR.r, 6, 16), std(color))
  body.position.y = AVATAR.h / 2; body.castShadow = true; g.add(body)
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.1), std('#1f2a44')); visor.position.set(0, AVATAR.eye, 0.2); g.add(visor)
  return g
}
const def = t => CATALOG[t] || (String(t).startsWith('asset:') ? (CATALOG[t] = assetType(t)) : null)

// ---------- items ----------
let items = [] // {id,type,group,preset,scale,parent,wall,face,allowed,light?,pending?}
let presets = [{ name: 'Tabletop', ratio: 0.1 }]
let nextId = 1
const isLight = it => !!def(it.type).light
const WALL_SIDES = { back: 0, front: 180, left: 90, right: -90 } // yaw offset so that local side faces into the wall
const snapOf = it => { const d = def(it.type); return d.snap || (d.wallOnly ? 'back' : d.light ? 'center' : 'bottom') }
const floating = it => it.mount === 'ceiling' || it.mount === 'free' || it.mount === 'object'
const solid = it => !it.wall && !it.pending && !isLight(it) && !floating(it) && !it.unresolved
function topOf(it) { return it.group.position.y + def(it.type).top * it.scale }
function addItem(type, opts = {}) {
  const d = def(type), g = new THREE.Group(); d.build(g)
  g.traverse(o => { if (o.isMesh && !o.userData.bulb) o.castShadow = o.receiveShadow = true })
  const it = { id: opts.id ?? nextId++, type, group: g, preset: null, scale: 1, parent: null, wall: false, face: null, mount: null, unresolved: !!d.unresolved,
    allowed: opts.allowed ?? [...(d.presets || d.allowedPresets || [])] }
  if (d.light) { it.light = { kind: d.light, color: '#ffe8c4', intensity: 3, distance: 6, angle: 45, penumbra: 0.4, ...(opts.light || {}) }; applyLight(it) }
  nextId = Math.max(nextId, it.id + 1)
  g.userData.item = it; scene.add(g); items.push(it)
  return it
}
function lightCount() { return items.reduce((n, it) => n + (isLight(it) ? 1 : def(it.type).lights || 0), 0) }
function applyLight(it) {
  const g = it.group, L = it.light
  for (const c of [...g.children]) if (c.isLight || c.userData.lightTarget) g.remove(c)
  const col = new THREE.Color(L.color)
  const l = L.kind === 'spot' ? new THREE.SpotLight(col, L.intensity, L.distance, Math.max(1, Math.min(89, L.angle)) * DEG, L.penumbra, 1.5) : new THREE.PointLight(col, L.intensity, L.distance, 1.5)
  l.position.y = 0.06; g.add(l)
  if (l.isSpotLight) { const t = new THREE.Object3D(); t.userData.lightTarget = true; t.position.set(0, it.wall ? -0.6 : -1, it.wall ? 1 : 0.0001); g.add(t); l.target = t }
  g.traverse(o => { if (o.userData.bulb) o.material.color.copy(col) })
}
function setScale(it, s) { it.scale = s; it.group.scale.setScalar(s) }
const ibox = it => new THREE.Box3().setFromObject(it.group)
function footprintHas(it, x, z) { const b = ibox(it); return x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z }
function descendants(it) { const out = []; for (const o of items) if (o.parent === it.id) out.push(o, ...descendants(o)); return out }
function ancestors(it) { const out = []; let p = it.parent; while (p != null) { const o = items.find(i => i.id === p); if (!o || out.includes(o)) break; out.push(o); p = o.parent } return out }
function drop(it) {
  if (it.wall || isLight(it) || floating(it) || it.unresolved) return
  const bottom = it.group.position.y, p = it.group.position, ex = new Set([it, ...descendants(it)])
  let best = bounds().y0, parent = null
  for (const o of items) {
    if (ex.has(o) || !def(o.type).holds || o.pending) continue
    const t = topOf(o)
    if (t <= bottom + 0.05 && t > best && footprintHas(o, p.x, p.z)) { best = t; parent = o.id }
  }
  moveTo(it, p.x, best, p.z); it.group.position.y = best; it.parent = parent
}
function clampRoom(x, z, it) {
  const b = ibox(it), c = it.group.position, B = bounds()
  const lx = c.x - b.min.x, rx = b.max.x - c.x, lz = c.z - b.min.z, rz = b.max.z - c.z
  return [Math.min(B.x1 - rx, Math.max(B.x0 + lx, x)), Math.min(B.z1 - rz, Math.max(B.z0 + lz, z))]
}
function moveTo(it, x, y, z) {
  const p = it.group.position, dx = snap(x) - p.x, dy = y - p.y, dz = snap(z) - p.z
  for (const o of [it, ...descendants(it)]) o.group.position.set(snap(o.group.position.x + dx), o.group.position.y + dy, snap(o.group.position.z + dz))
}
// object-object collision: push `it` (with whatever sits on it) out of other solid items' AABBs
function resolve(it) {
  if (!solid(it)) return
  const skip = new Set([it, ...descendants(it), ...ancestors(it)])
  for (let k = 0; k < 6; k++) {
    const b = ibox(it); let moved = false
    for (const o of items) {
      if (skip.has(o) || !solid(o) || descendants(o).includes(it)) continue
      const q = ibox(o)
      if (b.min.y >= q.max.y - 0.01 || b.max.y <= q.min.y + 0.01) continue
      const px = Math.min(b.max.x - q.min.x, q.max.x - b.min.x), pz = Math.min(b.max.z - q.min.z, q.max.z - b.min.z)
      if (px <= 0.001 || pz <= 0.001) continue
      const p = it.group.position, cb = b.getCenter(V()), cq = q.getCenter(V())
      let x = p.x, z = p.z
      if (px < pz) x += (cb.x >= cq.x ? 1 : -1) * (px + 0.01); else z += (cb.z >= cq.z ? 1 : -1) * (pz + 0.01)
      ;[x, z] = clampRoom(x, z, it); moveTo(it, x, p.y, z); moved = true; break
    }
    if (!moved) return
  }
}
function rotate(it, deg) {
  const r = Math.round((it.group.rotation.y / DEG + deg) / SNAP_ROT) * SNAP_ROT
  const c = it.group.position, dr = r * DEG - it.group.rotation.y
  for (const o of descendants(it)) { const v = o.group.position.clone().sub(c).applyAxisAngle(V(0, 1, 0), dr); o.group.position.set(snap(c.x + v.x), o.group.position.y, snap(c.z + v.z)); o.group.rotation.y += dr }
  it.group.rotation.y = r * DEG
}
// put an item flat against a wall face at a hit point (respects the outermost surface layer)
function wallPose(it, face, pt, mount) {
  const d = def(it.type), F = FACES[face], n = F.n, B = bounds(), h = d.size[1] * it.scale
  const side = mount && WALL_SIDES[snapOf(it)] !== undefined ? snapOf(it) : 'back'
  it.group.rotation.y = Math.atan2(n.x, n.z) + WALL_SIDES[side] * DEG
  const lb = new THREE.Box3().setFromObject(it.group), gp = it.group.position // extent behind the pivot along -n (real bbox, any snap side)
  const dep = side === 'back' && !d.snap ? (d.size[2] || 0.3) * it.scale / 2 : Math.max(0.001, -((n.x ? (n.x > 0 ? lb.min.x - gp.x : -(lb.max.x - gp.x)) : (n.z > 0 ? lb.min.z - gp.z : -(lb.max.z - gp.z)))))
  let y = mount ? Math.max(B.y0, Math.min(B.y1 - h, pt.y - h / 2)) : it.group.position.y
  if (isLight(it)) y = Math.max(B.y0, Math.min(B.y1 - h, pt.y))
  it.group.position.y = y
  let [x, z] = clampRoom(pt.x, pt.z, it)
  const off = outer[face] + dep + 0.001
  if (n.x) x = F.o.x + n.x * off; if (n.z) z = F.o.z + n.z * off
  moveTo(it, x, y, z); it.group.position.set(it.group.position.x, y, it.group.position.z)
}
// hang flush from the ceiling (top snap): bbox top touches the outermost ceiling layer at x/z
function ceilingPose(it, x, z, y1 = bounds().y1) {
  it.wall = false; it.face = null; it.parent = null; it.mount = 'ceiling'
  ;[x, z] = clampRoom(x, z, it); moveTo(it, x, it.group.position.y, z)
  const b = ibox(it), up = b.max.y - it.group.position.y
  it.group.position.y = r3(y1 - up)
}
// lock the snap side flush onto any surface (object faces, free placement). n = axis-aligned surface normal.
function surfacePose(it, pt, n) {
  const side = snapOf(it)
  if (WALL_SIDES[side] !== undefined && Math.abs(n.y) < 0.5) it.group.rotation.y = Math.atan2(n.x, n.z) + WALL_SIDES[side] * DEG
  const p = it.group.position; p.copy(pt); it.group.updateMatrixWorld(true)
  const b = ibox(it), c = b.getCenter(V())
  if (side === 'center') { p.add(pt.clone().sub(c)) } // bbox centre on the clicked point
  else {
    const ext = n.x > 0 ? b.min.x : n.x < 0 ? b.max.x : n.y > 0 ? b.min.y : n.y < 0 ? b.max.y : n.z > 0 ? b.min.z : b.max.z
    const comp = n.x ? 'x' : n.y ? 'y' : 'z'
    const sh = pt.clone().sub(c); sh[comp] = pt[comp] - ext + Math.sign(n[comp]) * 0.001; p.add(sh)
  }
  p.set(snap(p.x), r3(p.y), snap(p.z))
}
const axisN = v => { const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)], i = a.indexOf(Math.max(...a)), o = V(0, 0, 0); o.setComponent(i, Math.sign(v.getComponent(i))); return o }
function placeAt(it, hit, preview = false) {
  const kind = hit.object.userData.kind, d = def(it.type)
  if (it.unresolved) { if (!preview) toast('Asset not loaded yet — connect + sign in first'); return false }
  const side = snapOf(it)
  if (d.ceilOnly || side === 'top') { // ceiling mounts: ceiling, or the underside of an object
    if (kind === 'ceiling') { ceilingPose(it, hit.point.x, hit.point.z); return true }
    if (kind === 'item' && !preview) { const o = hit.object.userData.itemRef, nn = axisN(hit.face.normal.clone().transformDirection(hit.object.matrixWorld))
      if (o !== it && nn.y < 0) { it.wall = false; it.face = null; it.parent = null; surfacePose(it, hit.point, nn); it.mount = 'object'; return true } }
    if (!preview) toast(`${d.name}: tap the ceiling`); return false
  }
  if (side === 'center' && !isLight(it)) { // free: centre on the clicked point, height kept
    if (preview) return false
    const nn = kind === 'item' ? axisN(hit.face.normal.clone().transformDirection(hit.object.matrixWorld)) : kind === 'wall' ? FACES[hit.object.userData.face].n : kind === 'ceiling' ? V(0, -1, 0) : V(0, 1, 0)
    it.wall = false; it.face = null; it.parent = null; it.mount = 'free'; surfacePose(it, hit.point, nn); return true
  }
  if (d.wallOnly && kind === 'item' && !preview) { // wall snap onto an object's vertical face
    const o = hit.object.userData.itemRef, nn = axisN(hit.face.normal.clone().transformDirection(hit.object.matrixWorld))
    if (o !== it && Math.abs(nn.y) < 0.5) { it.wall = false; it.face = null; it.parent = null; it.mount = 'object'; surfacePose(it, hit.point, nn); return true }
  }
  it.mount = null
  if (kind === 'wall') {
    for (const o of descendants(it)) o.parent = null
    const mount = !!d.wallOnly || isLight(it)
    wallPose(it, hit.object.userData.face, hit.point, mount)
    if (preview) return true
    it.wall = mount; it.face = mount ? hit.object.userData.face : null; it.parent = null; it.mount = mount ? 'wall' : null
    if (isLight(it)) applyLight(it)
    if (!mount) { it.group.position.y = bounds().y0; resolve(it) }
    return true
  }
  if (preview) return false
  if (d.wallOnly) { toast(`${d.name}: tap a wall`); return false }
  if (kind === 'ceiling') { if (!isLight(it)) { toast('Only lights go on the ceiling'); return false }
    it.wall = false; it.face = null; moveTo(it, ...[...clampRoom(hit.point.x, hit.point.z, it)].flatMap((v, i) => i ? [v] : [v, bounds().y1 - 0.14])); applyLight(it); return true }
  if (isLight(it)) { const [x, z] = clampRoom(hit.point.x, hit.point.z, it); it.wall = false; it.face = null; moveTo(it, x, Math.max(it.group.position.y, bounds().y0 + 0.3), z); applyLight(it); return true }
  let y = bounds().y0, parent = null
  if (kind === 'item') {
    const o = hit.object.userData.itemRef
    if (o === it || descendants(it).includes(o)) return false
    if (!def(o.type).holds || hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y < 0.7) { toast(`${def(o.type).name} can't hold things there`); return false }
    y = topOf(o); parent = o.id
  }
  it.wall = false; it.face = null
  const [x, z] = clampRoom(hit.point.x, hit.point.z, it)
  moveTo(it, x, y, z); it.group.position.y = y; it.parent = parent
  if (parent == null) drop(it)
  resolve(it)
  return true
}
// re-seat everything after surface layers change
function reflow() {
  for (const it of items) {
    if (it.pending || it.unresolved) continue // placeholders keep their imported pose until the asset loads
    if (it.mount === 'ceiling') { ceilingPose(it, it.group.position.x, it.group.position.z); continue }
    if (floating(it)) continue
    if (it.wall && it.face) { const p = it.group.position; wallPose(it, it.face, V(p.x, p.y + def(it.type).size[1] * it.scale / 2, p.z), true); if (isLight(it)) it.group.position.y = p.y }
    else if (!isLight(it) && it.parent == null) { const p = it.group.position; const [x, z] = clampRoom(p.x, p.z, it); moveTo(it, x, bounds().y0, z) }
  }
  for (const it of items) if (!it.wall && !isLight(it) && !floating(it) && !it.unresolved && it.parent != null) { const o = items.find(i => i.id === it.parent); if (o) moveTo(it, it.group.position.x, topOf(o), it.group.position.z) }
  for (const it of items) resolve(it)
  if (sel) refreshSel()
}

// ---------- ghost preview ----------
function setGhost(it, on) {
  it.group.traverse(o => {
    if (!o.isMesh) return
    if (on) { o.userData.realMat = o.material; o.material = (Array.isArray(o.material) ? o.material : [o.material]).map(m => { const c = m.clone(); c.transparent = true; c.opacity = 0.4; c.depthWrite = false; return c }); if (o.material.length === 1) o.material = o.material[0]; o.castShadow = false }
    else if (o.userData.realMat) { o.material = o.userData.realMat; delete o.userData.realMat; o.castShadow = !o.userData.bulb }
  })
}

// ---------- avatar / camera ----------
const player = { pos: V(0, 0, 2.2), yaw: Math.PI, pitch: -0.1, third: false }
const avatar = makeAvatarMesh('#2563eb'); avatar.userData.localPlayer = true; scene.add(avatar)
function updateCamera() {
  avatar.position.copy(player.pos).setY(bounds().y0); avatar.rotation.y = player.yaw
  avatar.visible = player.third // never draw your own body in first person
  const dir = V(Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), Math.cos(player.yaw) * Math.cos(player.pitch))
  const eye = player.pos.clone().setY(bounds().y0 + AVATAR.eye), B = bounds()
  if (!player.third) { camera.position.copy(eye); camera.lookAt(eye.clone().add(dir)) }
  else {
    const back = eye.clone().addScaledVector(dir, -2.6).add(V(0, 0.5, 0))
    back.x = Math.max(B.x0 + 0.1, Math.min(B.x1 - 0.1, back.x)); back.z = Math.max(B.z0 + 0.1, Math.min(B.z1 - 0.1, back.z)); back.y = Math.min(B.y1 - 0.1, back.y)
    camera.position.copy(back); camera.lookAt(eye.clone().addScaledVector(dir, 1))
  }
}
// avatar vs furniture (AABB in x/z, things you can't step over)
function collideAvatar() {
  const p = player.pos, r = AVATAR.r, y0 = bounds().y0
  for (const it of items) {
    if (!solid(it)) continue
    const b = ibox(it); if (b.max.y < y0 + 0.25 || b.min.y > y0 + 1.2) continue
    const x0 = b.min.x - r, x1 = b.max.x + r, z0 = b.min.z - r, z1 = b.max.z + r
    if (p.x <= x0 || p.x >= x1 || p.z <= z0 || p.z >= z1) continue
    const m = [[p.x - x0, 'x', x0], [x1 - p.x, 'x', x1], [p.z - z0, 'z', z0], [z1 - p.z, 'z', z1]].sort((a, b) => a[0] - b[0])[0]
    p[m[1]] = m[2]
  }
  const B = bounds(); p.x = Math.max(B.x0 + r, Math.min(B.x1 - r, p.x)); p.z = Math.max(B.z0 + r, Math.min(B.z1 - r, p.z))
}

// ---------- input ----------
const keys = {}, moveIn = { x: 0, y: 0 }, lookIn = { x: 0, y: 0 }
const typing = e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
addEventListener('keydown', e => {
  if (typing(e)) return
  keys[e.code] = true
  if (e.code === 'KeyV') toggleView(); if (e.code === 'KeyB') toggleDev()
  if (sel && (e.code === 'Delete' || e.code === 'Backspace')) delSel()
  if (sel && e.code === 'BracketLeft') { rotate(sel, e.shiftKey ? -15 : -1); resolve(sel); refreshSel() }
  if (sel && e.code === 'BracketRight') { rotate(sel, e.shiftKey ? 15 : 1); resolve(sel); refreshSel() }
  if (e.code === 'Escape' && sel?.pending) delSel()
})
addEventListener('keyup', e => keys[e.code] = false)
const locked = () => document.pointerLockElement === canvas
let down = null, rdrag = false, aim = null
canvas.addEventListener('contextmenu', e => e.preventDefault())
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, id: e.pointerId }; rdrag = e.button === 2 })
addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') aim = { x: e.clientX, y: e.clientY }
  if (locked()) { look(e.movementX, e.movementY); return }
  if (down && down.id === e.pointerId && (rdrag || (e.pointerType === 'mouse' && !dev && e.buttons === 1))) look(e.movementX, e.movementY)
})
canvas.addEventListener('pointerup', e => {
  if (!down || down.id !== e.pointerId) return
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const wasR = rdrag; down = null; rdrag = false
  if (wasR || moved > 8) return
  if (e.pointerType === 'mouse' && !dev && !locked()) { canvas.requestPointerLock?.(); return }
  if (dev) pickAt(locked() ? innerWidth / 2 : e.clientX, locked() ? innerHeight / 2 : e.clientY)
})
document.addEventListener('pointerlockchange', () => $('cross').style.display = locked() ? 'block' : 'none')
function look(dx, dy) { player.yaw -= dx * 0.0025; player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch - dy * 0.0025)) }
const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
if (touch) document.body.classList.add('touch')
function stick(el, out) {
  const knob = el.firstElementChild; let pid = null, cx = 0, cy = 0
  el.addEventListener('pointerdown', e => { pid = e.pointerId; el.setPointerCapture(pid); const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; mv(e) })
  const mv = e => { if (e.pointerId !== pid) return; let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy), m = 45; if (l > m) { dx *= m / l; dy *= m / l }
    knob.style.transform = `translate(${dx}px,${dy}px)`; out.x = dx / m; out.y = dy / m }
  el.addEventListener('pointermove', mv)
  const end = e => { if (e.pointerId !== pid) return; pid = null; out.x = out.y = 0; knob.style.transform = '' }
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end)
}
stick($('stickL'), moveIn); stick($('stickR'), lookIn)

// ---------- picking / selection ----------
const ray = new THREE.Raycaster()
let sel = null, placing = false, helper = null
function castFrom(cx, cy, targets) { ray.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, -cy / innerHeight * 2 + 1), camera); return ray.intersectObjects(targets, false) }
function pickAt(cx, cy) {
  const targets = [...pickables]
  for (const it of items) it.group.traverse(o => { if (o.isMesh) { o.userData.kind = 'item'; o.userData.itemRef = it; targets.push(o) } })
  const hits = (placing && sel?.pending) ? castFrom(cx, cy, def(sel.type).ceilOnly ? [ceil] : walls) : castFrom(cx, cy, targets).filter(h => !(placing && sel && h.object.userData.itemRef === sel))
  const hit = hits[0]; if (!hit) { if (placing && sel?.pending) toast(def(sel.type).ceilOnly ? 'Tap the ceiling to hang it' : 'Tap a wall to hang it'); return }
  if (placing && sel) {
    if (placeAt(sel, hit)) { const was = sel.pending; if (was) { sel.pending = false; setGhost(sel, false) } placing = false; refreshSel(); toast(sel.wall ? `Placed on the ${sel.face} wall` : sel.mount === 'ceiling' ? 'Hung from the ceiling' : 'Placed') }
    return
  }
  if (hit.object.userData.kind === 'item') select(hit.object.userData.itemRef); else select(null)
}
function select(it) {
  if (sel && sel !== it && sel.pending) { const p = sel; sel = null; removeItem(p) }
  sel = it; placing = false
  if (helper) { scene.remove(helper); helper = null }
  if (it) { helper = new THREE.BoxHelper(it.group, '#2563eb'); scene.add(helper) }
  refreshSel()
}
function removeItem(it) {
  for (const o of items) if (o.parent === it.id) o.parent = null
  scene.remove(it.group); items = items.filter(o => o !== it)
}
function delSel() { if (!sel) return; const it = sel; sel = null; removeItem(it); select(null); for (const o of items) drop(o) }

// ---------- UI ----------
let dev = false
function toggleView() { player.third = !player.third; $('bView').textContent = player.third ? '1st person' : '3rd person' }
function toggleDev() { dev = !dev; $('bDev').textContent = 'Dev mode: ' + (dev ? 'on' : 'off'); $('bDev').classList.toggle('on', dev); $('dev').classList.toggle('hidden', !dev); if (!dev) select(null); fitPanels() }
function toggleHelp(force) {
  const open = force ?? $('help').classList.contains('hidden'); $('help').classList.toggle('hidden', !open); document.body.classList.toggle('help-open', open)
  if (open && innerWidth <= 700) setDevMin(true); fitPanels()
}
function setDevMin(min) { $('devBody').classList.toggle('hidden', min); $('bDevMin').textContent = min ? '▸ Show' : '▾ Hide' }
$('bView').onclick = toggleView; $('bDev').onclick = toggleDev; $('bHelp').onclick = () => toggleHelp(); $('bHelpX').onclick = () => toggleHelp(false)
$('bDevMin').onclick = () => { const min = !$('devBody').classList.contains('hidden'); setDevMin(min); if (!min && innerWidth <= 700) toggleHelp(false) }
let tt; function toast(t, ms = 2200) { const m = $('msg'); m.textContent = t; m.style.opacity = 1; clearTimeout(tt); tt = setTimeout(() => m.style.opacity = 0, ms) }
function spawn(k) {
  const d = def(k); if (!d) return
  if ((d.light || d.lights) && lightCount() + (d.lights || 1) > MAX_LIGHTS) return toast(`Max ${MAX_LIGHTS} lights (phone performance)`)
  if (sel?.pending) { const p = sel; sel = null; removeItem(p) }
  const it = addItem(k), f = V(Math.sin(player.yaw), 0, Math.cos(player.yaw))
  it.group.rotation.y = Math.round((player.yaw + Math.PI) / DEG) * DEG
  if (d.wallOnly || d.ceilOnly) { // ghost until a wall / the ceiling is tapped
    it.pending = true; setGhost(it, true); moveTo(it, player.pos.x + f.x * 1.5, d.ceilOnly ? bounds().y1 - d.size[1] : 1.2, player.pos.z + f.z * 1.5)
    select(it); placing = true; toast(d.ceilOnly ? 'Ghost preview — tap the ceiling to hang it' : 'Ghost preview — tap a wall to hang it'); return
  }
  if (d.free) { const [x, z] = clampRoom(player.pos.x + f.x * 1.5, player.pos.z + f.z * 1.5, it); it.mount = 'free'; moveTo(it, x, 1.0, z); select(it); placing = true; toast('Tap any surface: its centre goes there'); return }
  const [x, z] = clampRoom(player.pos.x + f.x * 1.5, player.pos.z + f.z * 1.5, it)
  moveTo(it, x, d.light ? bounds().y1 - 0.3 : bounds().y0, z); if (d.light) applyLight(it); else resolve(it)
  select(it); placing = true; toast(d.light ? 'Tap the ceiling, a wall or the floor to place the light' : 'Tap a spot to place it')
}
function buildPalette() {
  $('palette').innerHTML = ''
  for (const [k, d] of Object.entries(CATALOG)) {
    if (k.startsWith('asset:')) continue
    const b = document.createElement('button'); b.textContent = '+ ' + d.name; b.onclick = () => spawn(k); $('palette').appendChild(b)
  }
}
buildPalette()
let step = 0.01
document.querySelectorAll('.step').forEach(b => b.onclick = () => { step = +b.dataset.s; document.querySelectorAll('.step').forEach(o => o.classList.toggle('on', o === b)) })
document.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
  if (!sel || sel.pending) return; const p = sel.group.position, n = b.dataset.n, s = n[1] === '+' ? step : -step, B = bounds()
  let x = p.x, y = p.y, z = p.z; if (n[0] === 'x') x += s; if (n[0] === 'z') z += s; if (n[0] === 'y') y = Math.max(B.y0, Math.min(B.y1 - 0.1, y + s))
  if (sel.mount === 'ceiling') { ceilingPose(sel, x, z) }
  else if (floating(sel)) { moveTo(sel, x, y, z); sel.group.position.y = r3(y) }
  else if (sel.wall || isLight(sel)) { moveTo(sel, x, y, z); if (sel.wall && sel.face) wallPose(sel, sel.face, V(sel.group.position.x, sel.group.position.y + def(sel.type).size[1] * sel.scale / 2, sel.group.position.z), true) }
  else { [x, z] = clampRoom(x, z, sel); moveTo(sel, x, p.y, z); sel.group.position.y += 5; drop(sel); resolve(sel) }
  refreshSel()
})
document.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { if (sel && !sel.wall && sel.mount !== 'object') { rotate(sel, +b.dataset.r); if (sel.mount === 'ceiling') ceilingPose(sel, sel.group.position.x, sel.group.position.z); resolve(sel); refreshSel() } })
$('bMove').onclick = () => { if (sel) { placing = !placing; refreshSel(); if (placing) toast('Tap a floor, a surface or a wall') } }
$('bDel').onclick = delSel; $('bDesel').onclick = () => select(null)
function applyScale(it, s, presetName) {
  const base = it.group.position.y; setScale(it, s); it.preset = presetName
  for (const o of descendants(it)) { o.parent = null; o.group.position.y += 5; drop(o) }
  it.group.position.y = base; resolve(it); refreshSel()
}
$('scale').oninput = e => { if (sel) applyScale(sel, +e.target.value, null) }
$('bPreset').onclick = () => {
  if (!sel || sel.scale === 1) return toast('Move the Scale slider first')
  const name = prompt(`Name this size preset (1:${Math.round(1 / sel.scale)})`, 'Tabletop'); if (!name) return
  const ratio = sel.scale, ex = presets.find(p => p.name === name); if (ex) ex.ratio = ratio; else presets.push({ name, ratio })
  if (!sel.allowed.includes(name)) sel.allowed.push(name); sel.preset = name; refreshSel(); toast(`Preset "${name}" saved`)
}
for (const [id, k, f] of [['lColor', 'color', v => v], ['lInt', 'intensity', v => Math.max(0, Math.min(50, +v))], ['lDist', 'distance', v => Math.max(0, Math.min(30, +v))], ['lAng', 'angle', v => Math.max(1, Math.min(89, +v))]])
  $(id).oninput = e => { if (sel?.light) { sel.light[k] = f(e.target.value); applyLight(sel) } }
$('lKind').onchange = e => { if (!sel?.light) return; const t = e.target.value === 'spot' ? 'core:light-spot' : 'core:light-point'
  sel.type = t; sel.light.kind = e.target.value; sel.group.clear(); def(t).build(sel.group); applyLight(sel); refreshSel() }
function onWhat(it) {
  if (it.pending) return 'not placed yet — tap a wall (ghost preview)'
  if (it.unresolved) return 'placeholder — asset not loaded (connect + sign in)'
  if (it.wall) return `${it.face || ''} wall`
  if (it.mount === 'ceiling') return 'ceiling'
  if (it.mount === 'free') return 'free (stays where put)'
  if (it.mount === 'object') return 'side of an object'
  if (isLight(it)) return 'free-floating light'
  return it.parent ? def(items.find(o => o.id === it.parent)?.type)?.name ?? 'floor' : 'floor'
}
function refreshSel() {
  $('sel').classList.toggle('hidden', !sel); if (!sel) return
  if (helper) helper.update()
  const d = def(sel.type), p = sel.group.position
  $('selName').textContent = d.name + ' #' + sel.id; $('bMove').classList.toggle('on', placing)
  document.querySelectorAll('.wallonly').forEach(b => b.style.display = sel.wall || isLight(sel) || sel.mount === 'free' || sel.mount === 'object' ? '' : 'none')
  $('lightRow').classList.toggle('hidden', !sel.light)
  if (sel.light) { $('lKind').value = sel.light.kind; $('lColor').value = sel.light.color; $('lInt').value = sel.light.intensity; $('lDist').value = sel.light.distance; $('lAng').value = sel.light.angle; $('lAng').disabled = sel.light.kind !== 'spot' }
  $('scale').value = sel.scale; $('scaleVal').textContent = sel.scale === 1 ? '1:1' : '1:' + (1 / sel.scale).toFixed(1).replace(/\.0$/, '')
  const bx = $('presets'); bx.innerHTML = ''
  const real = document.createElement('button'); real.textContent = 'Real size'; real.classList.toggle('on', !sel.preset && sel.scale === 1)
  real.onclick = () => applyScale(sel, 1, null); bx.appendChild(real)
  for (const pr of presets) {
    const ok = sel.allowed.includes(pr.name), b = document.createElement('button')
    b.textContent = `${pr.name} 1:${+(1 / pr.ratio).toFixed(1)}`; b.classList.toggle('on', sel.preset === pr.name); b.disabled = !ok
    b.onclick = () => applyScale(sel, pr.ratio, pr.name); bx.appendChild(b)
    const a = document.createElement('label'); a.className = 'small'
    a.innerHTML = `<input type="checkbox" ${ok ? 'checked' : ''}> allow`
    a.firstChild.onchange = e => { sel.allowed = e.target.checked ? [...sel.allowed, pr.name] : sel.allowed.filter(n => n !== pr.name); refreshSel() }
    bx.appendChild(a)
  }
  const sz = d.size, s = sel.scale
  $('selInfo').textContent = `${sel.type} · pos ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)} m · rot ${Math.round(sel.group.rotation.y / DEG)}° · ` +
    `${(sz[0] * s).toFixed(2)}×${(sz[2] * s).toFixed(2)} m, ${(sz[1] * s).toFixed(2)} m tall · ${sel.pending ? "" : "on "}${onWhat(sel)}${d.snap ? ' · snap ' + d.snap + ' · ' + d.category : ''}`
}
$('paint').oninput = e => { wallMat.color.set(e.target.value); buildSurfaces() }

// ---------- surfaces UI ----------
let sfStep = 0.001
function layerOptions(cat) {
  const o = [['', '— none —']]
  for (const [k, L] of Object.entries(LAYERS)) if (L.categories.includes(cat)) o.push([k, L.name])
  for (const m of assetMetas()) if (m.category === cat || (m.category?.endsWith('-layer') && cat.endsWith('-layer'))) o.push(['asset:' + m.id, '⬆ ' + m.name + (m.category !== cat ? ` (${m.category})` : '')])
  return o
}
function surfaceUI() {
  const face = $('sfFace').value, box = $('sfLayers'); box.innerHTML = ''
  const isOv = WALL_FACES.includes(face), arr = face === 'walls' ? surfaces.walls : isOv ? surfaces.overrides[face] : surfaces[face]
  if (isOv && !arr) {
    const r = document.createElement('div'); r.className = 'row small'; r.textContent = `The ${face} wall uses the "all walls" layers. `
    const b = document.createElement('button'); b.textContent = 'Override this wall'; b.onclick = () => { surfaces.overrides[face] = structuredClone(surfaces.walls); applySurfaces() }
    r.appendChild(b); box.appendChild(r); return
  }
  const cat = catFor(face === 'walls' ? 'north' : face)
  arr.forEach((L, i) => {
    const r = document.createElement('div'); r.className = 'row'
    r.innerHTML = `<span>Layer ${i + 1}</span><select></select><button>−</button><input type="number" step="0.1" min="0" max="5" style="width:58px"><span class="small">cm</span><button>+</button><span class="small">tile×</span><input type="number" step="0.05" min="0.05" max="20" style="width:58px">`
    const [sl, minus, off, plus, uv] = [r.querySelector('select'), ...r.querySelectorAll('button, input')].filter((_, k, a) => true).slice(0, 5)
    sl.innerHTML = layerOptions(cat).map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); sl.value = L?.asset || ''
    if (L && ![...sl.options].some(o => o.value === L.asset)) { sl.add(new Option(L.asset + ' (sign in to load)', L.asset)); sl.value = L.asset }
    off.value = L ? +(L.offsetM * 100).toFixed(1) : 0; uv.value = L ? L.uvScale[0] : 1; for (const e of [minus, off, plus, uv]) e.disabled = !L
    const set = fn => { const l = arr[i]; if (l) { fn(l); applySurfaces(false) } }
    sl.onchange = () => { arr[i] = sl.value ? { ...(arr[i] || layer(sl.value)), asset: sl.value } : null; applySurfaces() }
    const bump = s => set(l => { l.offsetM = Math.max(0, Math.min(MAX_OFFSET, r3(l.offsetM + s))); off.value = +(l.offsetM * 100).toFixed(1) })
    minus.onclick = () => bump(-sfStep); plus.onclick = () => bump(sfStep)
    off.onchange = () => set(l => { l.offsetM = Math.max(0, Math.min(MAX_OFFSET, r3(+off.value / 100))); off.value = +(l.offsetM * 100).toFixed(1) })
    uv.onchange = () => set(l => { const v = Math.max(0.05, Math.min(20, +uv.value || 1)); l.uvScale = [v, v] })
    box.appendChild(r)
  })
  if (isOv) { const b = document.createElement('button'); b.textContent = `Clear ${face} override`; b.onclick = () => { delete surfaces.overrides[face]; applySurfaces() }; box.appendChild(b) }
  const info = document.createElement('div'); info.className = 'small'
  info.textContent = `Outermost surface depth (m): ` + Object.entries(outer).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(' · '); box.appendChild(info)
}
function applySurfaces(redraw = true) { buildSurfaces(); reflow(); if (redraw) surfaceUI(); else { const i = $('sfLayers').querySelector('.small:last-child'); if (i) i.textContent = `Outermost surface depth (m): ` + Object.entries(outer).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(' · ') } }
$('sfFace').onchange = surfaceUI
document.querySelectorAll('.sfstep').forEach(b => b.onclick = () => { sfStep = +b.dataset.s; document.querySelectorAll('.sfstep').forEach(o => o.classList.toggle('on', o === b)) })

// ---------- layout JSON v2 ----------
const LS = 'mysbase.room.v2', LS1 = 'mysbase.room.v1'
const v3 = v => v.toArray().map(n => +n.toFixed(3))
function serialize() {
  const real = items.filter(it => !it.pending)
  const base = it => ({ id: it.id, typeId: it.type, assetId: it.type.startsWith('asset:') ? it.type.slice(6) : null, name: def(it.type).name, category: def(it.type).category || 'prop',
    pos: v3(it.group.position), rotY: Math.round(it.group.rotation.y / DEG), scale: +it.scale.toFixed(4), preset: it.preset ?? null, parent: it.parent ?? null,
    wall: !!it.wall, face: it.face ?? null, mount: it.mount ?? (it.wall ? 'wall' : null), allowed: [...it.allowed],
    ...(it.unresolved && it.src ? { pos: it.src.pos, rotY: it.src.rotY, category: it.src.category, name: it.src.name } : {}) })
  return { version: 2, room: { ...ROOM, door: { ...DOOR }, units: 'm' }, ambience: { ...ambience }, surfaces: structuredClone(surfaces),
    wallPaint: '#' + wallMat.color.getHexString(), presets: structuredClone(presets),
    lights: real.filter(isLight).map(it => ({ ...base(it), kind: it.light.kind, color: it.light.color, intensity: it.light.intensity, distance: it.light.distance, angle: it.light.angle, penumbra: it.light.penumbra })),
    items: real.filter(it => !isLight(it)).map(base) }
}
function migrate(j) {
  if (j?.version === 2) return j
  const its = (j?.items || []).map(d => ({ ...d, typeId: String(d.typeId || d.type).includes(':') ? (d.typeId || d.type) : 'core:' + d.type, face: d.face ?? (d.wall ? guessFace(d.pos) : null) }))
  its.push({ id: 900, typeId: 'core:window', pos: [-W / 2 + 0.02, 1.0, -0.8], rotY: 90, wall: true, face: 'west' })
  return { version: 2, room: j?.room, surfaces: DEFAULT_SURFACES(), wallPaint: j?.wallPaint, presets: j?.presets, lights: [], items: its }
}
function guessFace(p) { if (!p) return 'north'; const [x, , z] = p, c = [[Math.abs(z + D / 2), 'north'], [Math.abs(z - D / 2), 'south'], [Math.abs(x + W / 2), 'west'], [Math.abs(x - W / 2), 'east']]; return c.sort((a, b) => a[0] - b[0])[0][1] }
function deserialize(raw) {
  const j = migrate(raw)
  if (sel) { sel.pending = false; } select(null); for (const it of items) scene.remove(it.group); items = []; nextId = 1
  presets = j.presets?.length ? j.presets : [{ name: 'Tabletop', ratio: 0.1 }]
  wallMat.color.set(j.wallPaint || '#d9cfc0'); $('paint').value = '#' + wallMat.color.getHexString()
  applyAmbience(j.ambience); surfaces = normSurfaces(j.surfaces); buildSurfaces()
  let skipped = 0
  const all = [...(j.items || []), ...(j.lights || []).map(l => ({ ...l, typeId: l.typeId || (l.kind === 'spot' ? 'core:light-spot' : 'core:light-point') }))]
  for (const d of all) {
    const t = d.typeId || d.type; if (!def(t)) continue
    const dd = def(t); if ((dd.light || dd.lights) && lightCount() + (dd.lights || 1) > MAX_LIGHTS) { skipped++; continue }
    const it = addItem(t, { id: d.id, allowed: d.allowed || [...(dd.presets || [])], light: dd.light ? { kind: d.kind || dd.light, color: d.color || '#ffe8c4', intensity: d.intensity ?? 3, distance: d.distance ?? 6, angle: d.angle ?? 45, penumbra: d.penumbra ?? 0.4 } : undefined })
    const pr = d.preset && presets.find(p => p.name === d.preset)
    setScale(it, pr ? pr.ratio : d.scale || 1); it.preset = pr ? d.preset : null
    it.group.position.fromArray(d.pos || [0, 0, 0]); it.group.rotation.y = (d.rotY || 0) * DEG; it.parent = d.parent ?? null; it.wall = !!d.wall; it.face = d.face || (d.wall ? guessFace(d.pos) : null)
    it.mount = ['wall', 'ceiling', 'free', 'object'].includes(d.mount) ? d.mount : it.wall ? 'wall' : null
    if (!d.mount && !it.wall) { const s = dd.unresolved ? snapOfMeta({ category: d.category }) : dd.snap // old layouts: infer from category / height
      if (s === 'top' || (dd.unresolved && /ceiling/.test(d.category || '') )) it.mount = 'ceiling'; else if (s === 'center') it.mount = 'free' }
    if (it.mount === 'wall') it.mount = null // wall pose is carried by wall/face
    it.src = { pos: [...(d.pos || [0, 0, 0])], rotY: d.rotY || 0, category: d.category, name: d.name, mount: it.mount }
    if (dd.unresolved && d.name) it.label = d.name
    if (it.light) applyLight(it)
  }
  reflow(); surfaceUI()
  if (skipped) toast(`Skipped ${skipped} light(s): max ${MAX_LIGHTS}`)
  return j
}
// an uploaded asset's metadata arrived: put the placeholder back at its imported pose, then seat it with the real model
function resolvePlaceholder(it) {
  if (!it.unresolved || def(it.type).unresolved) return
  it.unresolved = false
  const s = it.src; if (!s) return
  it.group.position.fromArray(s.pos); it.group.rotation.y = s.rotY * DEG
  if (!s.mount && !it.wall) { const sn = def(it.type).snap; it.mount = sn === 'top' ? 'ceiling' : sn === 'center' ? 'free' : null }
}
function registry() {
  const out = { version: 1, units: 'm', pivot: 'base centre (y=0 at bottom); front faces +z; wall-mounts hang with +z out of the wall', generatedAt: new Date().toISOString(), types: [], layers: [] }
  for (const [k, d] of Object.entries(CATALOG)) if (!k.startsWith('asset:')) out.types.push({ typeId: k, name: d.name, category: d.category, boundsM: d.size, holds: !!d.holds, wallOnly: !!d.wallOnly, source: 'builtin' })
  for (const [k, L] of Object.entries(LAYERS)) out.layers.push({ asset: k, name: L.name, categories: L.categories, tileM: L.tileM, source: 'builtin' })
  for (const m of assetMetas()) {
    const e = { typeId: 'asset:' + m.id, assetId: m.id, name: m.name, category: m.category || (m.wall ? 'wall-mount' : 'prop'), boundsM: m.sizeM || null, holds: !!m.holds, wallOnly: !!m.wall, kind: m.kind, needsConverter: !!m.needsConverter, source: 'upload' }
    e.snap = snapOfMeta(m)
    // tile footprint: floor/ceiling model tiles lie flat, so use X/Z (Y is thickness); wall tiles and images use W×H
    const flat = m.kind === 'model' && (e.category === 'floor-layer' || e.category === 'ceiling-layer')
    const tileM = m.sizeM ? (flat ? [m.sizeM[0], m.sizeM[2]] : m.sizeM.slice(0, 2)) : null
    if (e.category.endsWith('-layer')) out.layers.push({ asset: e.typeId, assetId: m.id, name: m.name, categories: [e.category], tileM, thicknessM: m.kind === 'model' && m.sizeM ? (flat ? m.sizeM[1] : m.sizeM[2]) : null, snap: e.snap, kind: m.kind, source: 'upload' }); else out.types.push(e)
  }
  return out
}
const pretty = o => JSON.stringify(o, null, 2)
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) }
async function copy(text, what) {
  $('ioText').value = text
  try { await navigator.clipboard.writeText(text); toast(`✅ ${what} copied to the clipboard`) } catch { $('ioText').select(); toast(`${what} is in the box below — select all and copy`) }
}
$('bSave').onclick = () => { localStorage.setItem(LS, JSON.stringify(serialize())); toast('✅ Room saved on this device') }
$('bLoad').onclick = () => { const s = localStorage.getItem(LS) || localStorage.getItem(LS1); if (!s) return toast('Nothing saved yet'); deserialize(JSON.parse(s)); toast('Room loaded') }
$('bExport').onclick = () => { const j = serialize(), t = pretty(j); download('mysbase-room.json', t); $('ioText').value = t; openSection('ioSec'); toast(`✅ Exported mysbase-room.json · v2 · ${j.items.length} items, ${j.lights.length} lights`, 3200) }
$('bCopy').onclick = () => copy(pretty(serialize()), 'Room JSON')
$('bPaste').onclick = () => {
  const t = $('ioText').value.trim(); if (!t) return toast('Paste a room JSON into the box first')
  let j; try { j = JSON.parse(t); if (!j || typeof j !== 'object' || (!j.items && !j.surfaces)) throw 0 } catch { return toast('❌ That text is not a room layout JSON') }
  importLayout(j, `(${j.version === 2 ? 'v2' : 'v1 → migrated to v2'})`)
}
$('bImport').onclick = () => $('file').click()
$('file').onchange = async e => { const f = e.target.files[0]; if (!f) return; e.target.value = ''; let j; try { j = JSON.parse(await f.text()) } catch { return toast('❌ That file is not a room layout') } importLayout(j, f.name) }
// fetch the wallet's My assets list first (like Load from server) so uploads resolve instead of becoming placeholders
async function importLayout(j, what) {
  const ok = await ensureAssets(j)
  try { const m = deserialize(j); const ph = items.filter(i => i.unresolved).length
    toast(`✅ Imported ${what} · ${m.items.length} items${ph ? ` · ${ph} placeholder(s) until you sign in` : ''}`, ok ? 2200 : 4000) } catch (e) { console.error(e); toast('❌ Could not import that layout') }
}
$('bReg').onclick = () => { const t = pretty(registry()); download('mysbase-registry.json', t); $('ioText').value = t; toast('✅ Exported mysbase-registry.json') }
$('bRegCopy').onclick = () => copy(pretty(registry()), 'Registry JSON')
$('bClear').onclick = () => { if (confirm('Reset to the starter room? (Saved copy is kept until you Save again)')) starter() }
function openSection(id) { $(id).open = true; setDevMin(false); if (!dev) toggleDev() }
function starter() {
  deserialize({ version: 2, wallPaint: '#d9cfc0', surfaces: DEFAULT_SURFACES(), items: [
    { id: 1, typeId: 'core:bed', pos: [-1.6, 0, -1.9], rotY: 0 },
    { id: 2, typeId: 'core:desk', pos: [1.75, 0, -2.6], rotY: 0 },
    { id: 3, typeId: 'core:bookshelf', pos: [2.3, 0, -0.6], rotY: -90 },
    { id: 4, typeId: 'core:ent', pos: [-2.2, 0, 1.4], rotY: 90 },
    { id: 5, typeId: 'core:tv', pos: [-2.2, 0.6, 1.4], rotY: 90, parent: 4 },
    { id: 6, typeId: 'core:painting', pos: [0, 1.15, -2.98], rotY: 0, wall: true, face: 'north' },
    { id: 7, typeId: 'core:rock', pos: [0.2, 0, -0.4], rotY: 160, allowed: ['Tabletop'] },
    { id: 8, typeId: 'core:figure', pos: [1.75, 0.75, -2.6], rotY: 20, preset: 'Tabletop', allowed: ['Tabletop'], parent: 2 },
    { id: 9, typeId: 'core:window', pos: [-2.48, 1.05, -0.8], rotY: 90, wall: true, face: 'west' },
  ] })
  $('roomSel').value = 'starter'
}
async function loadPreset(name) {
  if (name === 'starter') { starter(); history.replaceState(null, '', location.pathname); return }
  try { const r = await fetch(`/rooms/${encodeURIComponent(name)}.json`); if (!r.ok) throw 0; deserialize(await r.json()); $('roomSel').value = name
    const u = new URLSearchParams(location.search); u.set('room', name); history.replaceState(null, '', '?' + u); toast(`Room "${name}" loaded`) } catch { toast(`No built-in room "${name}"`) }
}
$('roomSel').onchange = e => loadPreset(e.target.value)

// ---------- boot ----------
new GLTFLoader().load('/assets/rock1-clay.glb', g => {
  const m = g.scene, b = new THREE.Box3().setFromObject(m), sz = b.getSize(V())
  m.scale.setScalar(2.08 / sz.y); const b2 = new THREE.Box3().setFromObject(m), c = b2.getCenter(V()), s2 = b2.getSize(V())
  m.position.set(-c.x, -b2.min.y, -c.z); CATALOG['core:rock'].size = [+s2.x.toFixed(3), 2.08, +s2.z.toFixed(3)]
  m.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false } })
  rockTemplate = new THREE.Group(); rockTemplate.add(m)
  for (const it of items) if (it.type === 'core:rock') { it.group.clear(); it.group.add(rockTemplate.clone(true)) }
  for (const it of items) resolve(it)
}, undefined, () => toast('Rock model failed to load'))
initCloud({
  toast, spawn, serialize, deserialize,
  registerType(t) { CATALOG[t] = assetType(t) },
  refreshType(t) {
    CATALOG[t] = assetType(t); let touched = false
    for (const it of items) if (it.type === t) { const gh = it.pending; it.group.clear(); CATALOG[t].build(it.group); it.group.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true }); if (gh) setGhost(it, true); resolvePlaceholder(it); touched = true }
    if (touched) reflow()
    if (sel) refreshSel()
  },
  rebuildAssets() { for (const t of new Set(items.map(i => i.type))) if (t.startsWith('asset:')) this.refreshType(t) },
  assetsChanged() { buildSurfaces(); reflow(); surfaceUI() },
})
applyAmbience()
const qs = new URLSearchParams(location.search)
if (qs.get('room')) { starter(); loadPreset(qs.get('room')) }
else { const saved = localStorage.getItem(LS) || localStorage.getItem(LS1); if (saved) { try { deserialize(JSON.parse(saved)) } catch { starter() } } else starter() }
if (qs.has('third')) toggleView()
if (qs.has('dev')) toggleDev()
if (qs.has('help')) toggleHelp(true)

function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix() }
function fitPanels() { const t = $('top').getBoundingClientRect().bottom + 6; $('dev').style.top = t + 'px'; $('help').style.top = t + 'px'; $('dev').style.maxHeight = `calc(100% - ${t}px - ${touch ? 170 : 16}px)`; $('help').style.maxHeight = `calc(100% - ${t}px - ${touch ? 170 : 16}px)` }
addEventListener('resize', () => { resize(); fitPanels() }); resize(); fitPanels()
const clock = new THREE.Clock()
const ghostRay = () => locked() || touch || !aim ? [innerWidth / 2, innerHeight / 2] : [aim.x, aim.y]
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05)
  let fx = moveIn.x, fz = -moveIn.y
  if (keys.KeyW || keys.ArrowUp) fz += 1; if (keys.KeyS || keys.ArrowDown) fz -= 1
  if (keys.KeyA || keys.ArrowLeft) fx -= 1; if (keys.KeyD || keys.ArrowRight) fx += 1
  const sp = (keys.ShiftLeft ? 3.2 : 1.6) * dt, sy = Math.sin(player.yaw), cy = Math.cos(player.yaw)
  player.pos.x += (sy * fz - cy * fx) * sp; player.pos.z += (cy * fz + sy * fx) * sp
  collideAvatar()
  look(lookIn.x * 900 * dt, lookIn.y * 600 * dt)
  updateCamera()
  if (sel?.pending) { const h = castFrom(...ghostRay(), walls)[0]; if (h) placeAt(sel, h, true) }
  if (helper) helper.update()
  renderer.render(scene, camera)
})
window.__mysbase = { findAsset, allAssets, outerNow: () => ({ ...outer }), importLayout, serialize, deserialize, registry, items: () => items, player, outer, spawn, select: id => select(items.find(i => i.id === id) || null), placeAt, pickAt, camera, loadPreset, setYaw: (y, p = 0) => { player.yaw = y; player.pitch = p } }
