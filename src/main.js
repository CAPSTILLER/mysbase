import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { initCloud, assetType } from './cloud.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// ---------- SIZE KEY (1 unit = 1 m) ----------
const ROOM = { w: 5, d: 6, h: 3, wallT: 0.12 }
const DOOR = { w: 0.9, h: 2.1, x: 1.2 } // in the south wall (z = +d/2)
const AVATAR = { h: 1.8, r: 0.25, eye: 1.65 }
const SNAP_POS = 0.01, SNAP_ROT = 1
const $ = id => document.getElementById(id)
const snap = v => Math.round(v / SNAP_POS) * SNAP_POS
const DEG = Math.PI / 180

// ---------- renderer / scene ----------
const canvas = $('c')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
const scene = new THREE.Scene()
scene.background = new THREE.Color('#2a2622')
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.35
const camera = new THREE.PerspectiveCamera(70, 1, 0.03, 60)

// soft "baked" look: warm sky/cool ground hemi + one big soft window key + ceiling fill
scene.add(new THREE.HemisphereLight('#fff1dc', '#5a4f45', 0.9))
const key = new THREE.DirectionalLight('#ffe2b8', 1.6)
key.position.set(-6, 5, -2); key.castShadow = true
key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6; key.shadow.bias = -0.0005
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 })
scene.add(key)
const fill = new THREE.PointLight('#ffd9a8', 6, 8, 1.6); fill.position.set(0.5, 2.7, 0.5); scene.add(fill)

// ---------- room ----------
const pickables = [] // meshes the pointer can hit
const wallMat = new THREE.MeshStandardMaterial({ color: '#d9cfc0', roughness: 0.95 })
const floorMat = new THREE.MeshStandardMaterial({ color: '#8a6a4c', roughness: 0.8 })
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), floorMat)
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.userData.kind = 'floor'
scene.add(floor); pickables.push(floor)
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), new THREE.MeshStandardMaterial({ color: '#efe8dc', roughness: 1 }))
ceil.rotation.x = Math.PI / 2; ceil.position.y = ROOM.h; scene.add(ceil)
// floor planks hint
for (let x = -ROOM.w / 2 + 0.2; x < ROOM.w / 2; x += 0.2) {
  const l = new THREE.Mesh(new THREE.PlaneGeometry(0.004, ROOM.d), new THREE.MeshBasicMaterial({ color: '#6e533b' }))
  l.rotation.x = -Math.PI / 2; l.position.set(x, 0.001, 0); scene.add(l)
}
const walls = []
function wallBox(w, h, d, x, y, z, normal) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat)
  m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = true
  m.userData.kind = 'wall'; m.userData.normal = normal
  scene.add(m); pickables.push(m); walls.push(m)
}
const { w: W, d: D, h: H, wallT: T } = ROOM
wallBox(W + 2 * T, H, T, 0, H / 2, -D / 2 - T / 2, new THREE.Vector3(0, 0, 1)) // north
wallBox(T, H, D, -W / 2 - T / 2, H / 2, 0, new THREE.Vector3(1, 0, 0))   // west
wallBox(T, H, D, W / 2 + T / 2, H / 2, 0, new THREE.Vector3(-1, 0, 0))   // east
// south wall with doorway
{ const n = new THREE.Vector3(0, 0, -1), z = D / 2 + T / 2, L = -W / 2 - T, R = W / 2 + T
  const dl = DOOR.x - DOOR.w / 2, dr = DOOR.x + DOOR.w / 2
  wallBox(dl - L, H, T, (L + dl) / 2, H / 2, z, n)
  wallBox(R - dr, H, T, (dr + R) / 2, H / 2, z, n)
  wallBox(DOOR.w, H - DOOR.h, T, DOOR.x, DOOR.h + (H - DOOR.h) / 2, z, n)
  const frame = new THREE.MeshStandardMaterial({ color: '#5b4330' })
  for (const [w, h, x, y] of [[0.05, DOOR.h, dl, DOOR.h / 2], [0.05, DOOR.h, dr, DOOR.h / 2], [DOOR.w + 0.1, 0.05, DOOR.x, DOOR.h]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, T + 0.04), frame); f.position.set(x, y, z); scene.add(f)
  }
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.w, DOOR.h), new THREE.MeshBasicMaterial({ color: '#1b1814' }))
  outside.position.set(DOOR.x, DOOR.h / 2, z + T / 2 + 0.01); outside.rotation.y = Math.PI; scene.add(outside)
}
// glowing window on west wall (light source for the mockup look)
{ const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), new THREE.MeshBasicMaterial({ color: '#fff4dd' }))
  win.position.set(-W / 2 + 0.005, 1.65, -0.8); win.rotation.y = Math.PI / 2; scene.add(win) }
// baseboard
for (const wm of walls) if (wm.position.y === H / 2) {
  const n = wm.userData.normal, b = new THREE.Mesh(new THREE.BoxGeometry(
    n.x ? 0.02 : wm.geometry.parameters.width, 0.08, n.z ? 0.02 : wm.geometry.parameters.depth),
    new THREE.MeshStandardMaterial({ color: '#efe6d6' }))
  b.position.set(wm.position.x + n.x * (T / 2 + 0.01), 0.04, wm.position.z + n.z * (T / 2 + 0.01)); scene.add(b)
}

// ---------- asset catalog (real sizes) ----------
const std = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })
function box(g, w, h, d, x, y, z, c) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(c))
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m
}
let rockTemplate = null
const CATALOG = {
  bed: { name: 'Bed', size: [1.5, 0.95, 2.0], top: 0.55, holds: true, build(g) {
    box(g, 1.5, 0.35, 2.0, 0, 0.175, 0, '#6b4a33'); box(g, 1.44, 0.2, 1.9, 0, 0.45, 0.03, '#e9e4da')
    box(g, 1.5, 0.95, 0.06, 0, 0.475, -0.97, '#5b3d29'); box(g, 0.55, 0.1, 0.35, -0.38, 0.6, -0.72, '#fff'); box(g, 0.55, 0.1, 0.35, 0.38, 0.6, -0.72, '#fff')
    box(g, 1.46, 0.04, 1.1, 0, 0.57, 0.42, '#3b5f8a') } },
  desk: { name: 'Desk', size: [1.4, 0.75, 0.7], top: 0.75, holds: true, build(g) {
    box(g, 1.4, 0.04, 0.7, 0, 0.73, 0, '#9a7350')
    for (const [x, z] of [[-0.66, -0.31], [0.66, -0.31], [-0.66, 0.31], [0.66, 0.31]]) box(g, 0.05, 0.71, 0.05, x, 0.355, z, '#3a2c22') } },
  bookshelf: { name: 'Bookshelf', size: [0.9, 2.0, 0.35], top: 2.0, holds: true, build(g) {
    box(g, 0.9, 2.0, 0.03, 0, 1.0, -0.16, '#6b4a33'); box(g, 0.03, 2.0, 0.35, -0.435, 1, 0, '#6b4a33'); box(g, 0.03, 2.0, 0.35, 0.435, 1, 0, '#6b4a33')
    const cols = ['#8a3b2e', '#2f5d7c', '#c9a227', '#4f7a4a', '#7a4f8a']
    for (let i = 0; i < 5; i++) { const y = 0.015 + i * 0.4; box(g, 0.84, 0.03, 0.33, 0, y, 0, '#7b583d')
      if (i < 4) for (let b = 0; b < 9; b++) box(g, 0.07, 0.22 + (b % 3) * 0.04, 0.24, -0.36 + b * 0.085, y + 0.14 + (b % 3) * 0.02, 0.02, cols[(b + i) % 5]) }
    box(g, 0.84, 0.03, 0.35, 0, 1.985, 0, '#6b4a33') } },
  ent: { name: 'Entertainment center', size: [1.8, 0.6, 0.5], top: 0.6, holds: true, build(g) {
    box(g, 1.8, 0.6, 0.5, 0, 0.3, 0, '#3d3029'); box(g, 0.56, 0.4, 0.01, -0.58, 0.3, 0.251, '#54443a'); box(g, 0.56, 0.4, 0.01, 0.58, 0.3, 0.251, '#54443a') } },
  tv: { name: 'TV 55"', size: [1.23, 0.75, 0.2], top: 0.75, holds: false, build(g) {
    box(g, 1.23, 0.71, 0.04, 0, 0.42, 0, '#111'); box(g, 0.3, 0.05, 0.2, 0, 0.025, 0, '#222') } },
  painting: { name: 'Painting', size: [0.8, 0.6, 0.04], top: 0.6, holds: false, wallOnly: true, build(g) {
    box(g, 0.8, 0.6, 0.04, 0, 0.3, 0, '#2b2219'); const c = box(g, 0.72, 0.52, 0.01, 0, 0.3, 0.021, '#c96f3b')
    c.material = new THREE.MeshStandardMaterial({ map: paintingTex(), roughness: 0.9 }) } },
  figure: { name: 'Avatar figure 1.8 m', size: [0.5, 1.8, 0.3], top: 1.8, holds: false, build(g) { g.add(makeAvatarMesh('#9fb7d9')) } },
  rock: { name: 'Rock #1', size: [0, 2.08, 0], top: 2.08, holds: false, build(g) {
    if (rockTemplate) g.add(rockTemplate.clone(true)); else box(g, 0.6, 2.08, 0.4, 0, 1.04, 0, '#aaa') } },
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
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.1), std('#1f2a44'))
  visor.position.set(0, AVATAR.eye, 0.2); g.add(visor) // faces +z
  return g
}

// ---------- items ----------
let items = [] // {id,type,group,preset,scale,parent,wall,allowed:[]}
let presets = [{ name: 'Tabletop', ratio: 0.1 }]
let nextId = 1
function topOf(it) { return it.group.position.y + CATALOG[it.type].top * it.scale }
function addItem(type, opts = {}) {
  const def = CATALOG[type], g = new THREE.Group(); def.build(g)
  g.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true } })
  const it = { id: opts.id ?? nextId++, type, group: g, preset: null, scale: 1, parent: null, wall: false,
    allowed: opts.allowed ?? (type === 'figure' || type === 'rock' ? ['Tabletop'] : def.asset ? [...(def.allowedPresets || [])] : []) }
  nextId = Math.max(nextId, it.id + 1)
  g.userData.item = it; scene.add(g); items.push(it)
  return it
}
function setScale(it, s) { it.scale = s; it.group.scale.setScalar(s) }
function footprintHas(it, x, z) {
  const b = new THREE.Box3().setFromObject(it.group); return x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z
}
function descendants(it) { const out = []; for (const o of items) if (o.parent === it.id) out.push(o, ...descendants(o)); return out }
// drop to first surface below current bottom
function drop(it) {
  if (it.wall) return
  const bottom = it.group.position.y, p = it.group.position, ex = new Set([it, ...descendants(it)])
  let best = 0, parent = null
  for (const o of items) {
    if (ex.has(o) || !CATALOG[o.type].holds) continue
    const t = topOf(o)
    if (t <= bottom + 0.05 && t > best && footprintHas(o, p.x, p.z)) { best = t; parent = o.id }
  }
  moveTo(it, p.x, best, p.z); it.parent = parent
}
function clampRoom(x, z, it) {
  const b = new THREE.Box3().setFromObject(it.group), hx = (b.max.x - b.min.x) / 2, hz = (b.max.z - b.min.z) / 2
  return [Math.min(W / 2 - hx, Math.max(-W / 2 + hx, x)), Math.min(D / 2 - hz, Math.max(-D / 2 + hz, z))]
}
function moveTo(it, x, y, z) {
  const p = it.group.position, dx = snap(x) - p.x, dy = snap(y) - p.y, dz = snap(z) - p.z
  for (const o of [it, ...descendants(it)]) o.group.position.set(snap(o.group.position.x + dx), snap(o.group.position.y + dy), snap(o.group.position.z + dz))
}
function rotate(it, deg) {
  const r = Math.round((it.group.rotation.y / DEG + deg) / SNAP_ROT) * SNAP_ROT
  const c = it.group.position, dr = r * DEG - it.group.rotation.y
  for (const o of descendants(it)) { // orbit children with parent
    const v = o.group.position.clone().sub(c).applyAxisAngle(new THREE.Vector3(0, 1, 0), dr)
    o.group.position.set(snap(c.x + v.x), o.group.position.y, snap(c.z + v.z)); o.group.rotation.y += dr
  }
  it.group.rotation.y = r * DEG
}

// place selected item at a picked hit
function placeAt(it, hit) {
  const kind = hit.object.userData.kind, def = CATALOG[it.type]
  if (kind === 'wall') {
    const n = hit.object.userData.normal, dep = (def.size[2] || 0.3) * it.scale / 2
    it.group.rotation.y = Math.atan2(n.x, n.z)
    for (const o of descendants(it)) o.parent = null
    it.wall = def.wallOnly; it.parent = null
    const y = def.wallOnly ? hit.point.y - def.size[1] * it.scale / 2 : 0
    let x = hit.point.x + n.x * dep, z = hit.point.z + n.z * dep
    it.group.position.y = y; [x, z] = clampRoom(x, z, it); if (n.x) x = hit.point.x + n.x * (dep + 0.001); if (n.z) z = hit.point.z + n.z * (dep + 0.001)
    moveTo(it, x, Math.max(0, Math.min(H - def.size[1] * it.scale, y)), z)
    return true
  }
  if (def.wallOnly) { toast('Paintings go on walls — tap a wall'); return false }
  let y = 0, parent = null
  if (kind === 'item') {
    const o = hit.object.userData.itemRef
    if (o === it || descendants(it).includes(o)) return false
    if (!CATALOG[o.type].holds || hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y < 0.7) { toast(`${CATALOG[o.type].name} can't hold things there`); return false }
    y = topOf(o); parent = o.id
  }
  it.wall = false; it.group.position.y = y
  const [x, z] = clampRoom(hit.point.x, hit.point.z, it)
  moveTo(it, x, y, z); it.group.position.y = y; it.parent = parent
  if (parent == null) drop(it)
  return true
}

// ---------- avatar / camera ----------
const player = { pos: new THREE.Vector3(0, 0, 2.2), yaw: Math.PI, pitch: -0.1, third: false }
const avatar = makeAvatarMesh('#2563eb'); scene.add(avatar)
function updateCamera() {
  avatar.position.copy(player.pos); avatar.rotation.y = player.yaw; avatar.visible = player.third
  const dir = new THREE.Vector3(Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), Math.cos(player.yaw) * Math.cos(player.pitch))
  const eye = player.pos.clone().setY(AVATAR.eye)
  if (!player.third) { camera.position.copy(eye); camera.lookAt(eye.clone().add(dir)) }
  else {
    const back = eye.clone().addScaledVector(dir, -2.6).add(new THREE.Vector3(0, 0.5, 0))
    back.x = Math.max(-W / 2 + 0.1, Math.min(W / 2 - 0.1, back.x)); back.z = Math.max(-D / 2 + 0.1, Math.min(D / 2 - 0.1, back.z)); back.y = Math.min(H - 0.1, back.y)
    camera.position.copy(back); camera.lookAt(eye.clone().addScaledVector(dir, 1))
  }
}

// ---------- input ----------
const keys = {}, moveIn = { x: 0, y: 0 }, lookIn = { x: 0, y: 0 }
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return
  keys[e.code] = true
  if (e.code === 'KeyV') toggleView(); if (e.code === 'KeyB') toggleDev()
  if (sel && (e.code === 'Delete' || e.code === 'Backspace')) delSel()
  if (sel && e.code === 'BracketLeft') { rotate(sel, e.shiftKey ? -15 : -1); refreshSel() }
  if (sel && e.code === 'BracketRight') { rotate(sel, e.shiftKey ? 15 : 1); refreshSel() }
})
addEventListener('keyup', e => keys[e.code] = false)
const locked = () => document.pointerLockElement === canvas
let down = null, rdrag = false
canvas.addEventListener('contextmenu', e => e.preventDefault())
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, type: e.pointerType }; rdrag = e.button === 2 })
addEventListener('pointermove', e => {
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
// thumbsticks
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch')
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
function pickAt(cx, cy) {
  ray.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, -cy / innerHeight * 2 + 1), camera)
  const targets = [...pickables]
  for (const it of items) it.group.traverse(o => { if (o.isMesh) { o.userData.kind = 'item'; o.userData.itemRef = it; targets.push(o) } })
  const hits = ray.intersectObjects(targets, false).filter(h => !(placing && sel && h.object.userData.itemRef && (h.object.userData.itemRef === sel)))
  const hit = hits[0]; if (!hit) return
  if (placing && sel) { if (placeAt(sel, hit)) { placing = false; refreshSel(); toast('Placed') } return }
  if (hit.object.userData.kind === 'item') select(hit.object.userData.itemRef); else select(null)
}
function select(it) {
  sel = it; placing = false
  if (helper) { scene.remove(helper); helper = null }
  if (it) { helper = new THREE.BoxHelper(it.group, '#2563eb'); scene.add(helper) }
  refreshSel()
}
function delSel() {
  if (!sel) return; const it = sel
  for (const o of items) if (o.parent === it.id) o.parent = null
  scene.remove(it.group); items = items.filter(o => o !== it); select(null)
  for (const o of items) drop(o)
}

// ---------- UI ----------
let dev = false
function toggleView() { player.third = !player.third; $('bView').textContent = player.third ? '1st person' : '3rd person' }
function toggleDev() { dev = !dev; $('bDev').textContent = 'Dev mode: ' + (dev ? 'on' : 'off'); $('bDev').classList.toggle('on', dev); $('dev').classList.toggle('hidden', !dev); if (!dev) select(null) }
$('bView').onclick = toggleView; $('bDev').onclick = toggleDev; $('bHelp').onclick = () => $('help').classList.toggle('hidden')
let tt; function toast(t) { const m = $('msg'); m.textContent = t; m.style.opacity = 1; clearTimeout(tt); tt = setTimeout(() => m.style.opacity = 0, 1800) }
function spawn(k) {
  const d = CATALOG[k], it = addItem(k), f = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw))
  const [x, z] = clampRoom(player.pos.x + f.x * 1.5, player.pos.z + f.z * 1.5, it)
  it.group.rotation.y = Math.round((player.yaw + Math.PI) / DEG) * DEG
  moveTo(it, x, d.wallOnly ? 1.15 : 0, z); if (d.wallOnly) it.wall = true
  select(it); placing = true; toast(d.wallOnly ? 'Tap a wall to hang it' : 'Tap a spot to place it')
}
for (const [k, d] of Object.entries(CATALOG)) {
  const b = document.createElement('button'); b.textContent = '+ ' + d.name
  b.onclick = () => spawn(k)
  $('palette').appendChild(b)
}
let step = 0.01
document.querySelectorAll('.step').forEach(b => b.onclick = () => { step = +b.dataset.s; document.querySelectorAll('.step').forEach(o => o.classList.toggle('on', o === b)) })
document.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
  if (!sel) return; const p = sel.group.position, n = b.dataset.n, s = n[1] === '+' ? step : -step
  let x = p.x, y = p.y, z = p.z; if (n[0] === 'x') x += s; if (n[0] === 'z') z += s; if (n[0] === 'y') y = Math.max(0, Math.min(H - 0.1, y + s))
  if (!sel.wall) { [x, z] = clampRoom(x, z, sel); moveTo(sel, x, y, z); sel.group.position.y = Math.max(sel.group.position.y, 0); const t = sel.group.position.y; sel.group.position.y = t + 5; drop(sel) }
  else moveTo(sel, x, y, z)
  refreshSel()
})
document.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { if (sel) { rotate(sel, +b.dataset.r); refreshSel() } })
$('bMove').onclick = () => { if (sel) { placing = !placing; refreshSel(); if (placing) toast('Tap a floor, a surface or a wall') } }
$('bDel').onclick = delSel; $('bDesel').onclick = () => select(null)
function applyScale(it, s, presetName) {
  const base = it.group.position.y; setScale(it, s); it.preset = presetName
  for (const o of descendants(it)) { o.parent = null; o.group.position.y += 5; drop(o) }
  it.group.position.y = base; refreshSel()
}
$('scale').oninput = e => { if (sel) applyScale(sel, +e.target.value, null) }
$('bPreset').onclick = () => {
  if (!sel || sel.scale === 1) return toast('Move the Scale slider first')
  const name = prompt(`Name this size preset (1:${Math.round(1 / sel.scale)})`, 'Tabletop'); if (!name) return
  const ratio = sel.scale, ex = presets.find(p => p.name === name); if (ex) ex.ratio = ratio; else presets.push({ name, ratio })
  if (!sel.allowed.includes(name)) sel.allowed.push(name); sel.preset = name; refreshSel(); toast(`Preset "${name}" saved`)
}
function refreshSel() {
  $('sel').classList.toggle('hidden', !sel); if (!sel) return
  if (helper) helper.update()
  const def = CATALOG[sel.type], p = sel.group.position
  $('selName').textContent = def.name + ' #' + sel.id; $('bMove').classList.toggle('on', placing)
  document.querySelectorAll('.wallonly').forEach(b => b.style.display = sel.wall ? '' : 'none')
  $('scale').value = sel.scale; $('scaleVal').textContent = sel.scale === 1 ? '1:1' : '1:' + (1 / sel.scale).toFixed(1).replace(/\.0$/, '')
  const box = $('presets'); box.innerHTML = ''
  const real = document.createElement('button'); real.textContent = 'Real size'; real.classList.toggle('on', !sel.preset && sel.scale === 1)
  real.onclick = () => applyScale(sel, 1, null); box.appendChild(real)
  for (const pr of presets) {
    const ok = sel.allowed.includes(pr.name), b = document.createElement('button')
    b.textContent = `${pr.name} 1:${+(1 / pr.ratio).toFixed(1)}`; b.classList.toggle('on', sel.preset === pr.name); b.disabled = !ok
    b.onclick = () => applyScale(sel, pr.ratio, pr.name); box.appendChild(b)
    const a = document.createElement('label'); a.className = 'small'
    a.innerHTML = `<input type="checkbox" ${ok ? 'checked' : ''}> allow`
    a.firstChild.onchange = e => { sel.allowed = e.target.checked ? [...sel.allowed, pr.name] : sel.allowed.filter(n => n !== pr.name); refreshSel() }
    box.appendChild(a)
  }
  const sz = def.size, s = sel.scale
  $('selInfo').textContent = `pos ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)} m · rot ${Math.round(sel.group.rotation.y / DEG)}° · ` +
    (sz[0] ? `${(sz[0] * s).toFixed(2)}×${(sz[2] * s).toFixed(2)} m, ${(sz[1] * s).toFixed(2)} m tall` : `${(sz[1] * s).toFixed(2)} m tall`) +
    ` · on ${sel.wall ? 'wall' : sel.parent ? CATALOG[items.find(o => o.id === sel.parent)?.type]?.name ?? 'floor' : 'floor'}`
}
$('paint').oninput = e => wallMat.color.set(e.target.value)

// ---------- save / load ----------
const LS = 'mysbase.room.v1'
function serialize() {
  return { version: 1, room: { ...ROOM, door: DOOR }, wallPaint: '#' + wallMat.color.getHexString(), presets,
    items: items.map(it => ({ id: it.id, type: it.type, pos: it.group.position.toArray().map(v => +v.toFixed(2)),
      rotY: Math.round(it.group.rotation.y / DEG), preset: it.preset, scale: +it.scale.toFixed(4), parent: it.parent, wall: it.wall, allowed: it.allowed })) }
}
function deserialize(j) {
  select(null); for (const it of items) scene.remove(it.group); items = []; nextId = 1
  presets = j.presets?.length ? j.presets : presets
  wallMat.color.set(j.wallPaint || '#d9cfc0'); $('paint').value = '#' + wallMat.color.getHexString()
  for (const d of j.items || []) {
    if (!CATALOG[d.type] && String(d.type).startsWith('asset:')) CATALOG[d.type] = assetType(d.type)
    if (!CATALOG[d.type]) continue
    const it = addItem(d.type, { id: d.id, allowed: d.allowed || [] })
    const pr = d.preset && presets.find(p => p.name === d.preset)
    setScale(it, pr ? pr.ratio : d.scale || 1); it.preset = pr ? d.preset : null
    it.group.position.fromArray(d.pos); it.group.rotation.y = (d.rotY || 0) * DEG; it.parent = d.parent ?? null; it.wall = !!d.wall
  }
}
$('bSave').onclick = () => { localStorage.setItem(LS, JSON.stringify(serialize())); toast('Room saved on this device') }
$('bLoad').onclick = () => { const s = localStorage.getItem(LS); if (!s) return toast('Nothing saved yet'); deserialize(JSON.parse(s)); toast('Room loaded') }
$('bExport').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' })); a.download = 'mysbase-room.json'; a.click() }
$('bImport').onclick = () => $('file').click()
$('file').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { deserialize(JSON.parse(await f.text())); toast('Room imported') } catch { toast('That file is not a room layout') } e.target.value = '' }
$('bClear').onclick = () => { if (confirm('Reset to the starter room? (Saved copy is kept until you Save again)')) starter() }
function starter() {
  deserialize({ wallPaint: '#d9cfc0', items: [
    { id: 1, type: 'bed', pos: [-1.6, 0, -1.9], rotY: 0 },
    { id: 2, type: 'desk', pos: [1.75, 0, -2.6], rotY: 0 },
    { id: 3, type: 'bookshelf', pos: [2.3, 0, -0.6], rotY: -90 },
    { id: 4, type: 'ent', pos: [-2.2, 0, 1.4], rotY: 90 },
    { id: 5, type: 'tv', pos: [-2.2, 0.6, 1.4], rotY: 90, parent: 4 },
    { id: 6, type: 'painting', pos: [0, 1.15, -2.98], rotY: 0, wall: true },
    { id: 7, type: 'rock', pos: [0.2, 0, -0.4], rotY: 160, allowed: ['Tabletop'] },
    { id: 8, type: 'figure', pos: [1.75, 0.75, -2.6], rotY: 20, preset: 'Tabletop', allowed: ['Tabletop'], parent: 2 },
  ] })
}

// ---------- boot ----------
new GLTFLoader().load('/assets/rock1-clay.glb', g => {
  const m = g.scene, b = new THREE.Box3().setFromObject(m), sz = b.getSize(new THREE.Vector3())
  m.scale.setScalar(2.08 / sz.y); const b2 = new THREE.Box3().setFromObject(m), c = b2.getCenter(new THREE.Vector3())
  m.position.set(-c.x, -b2.min.y, -c.z)
  m.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false } })
  rockTemplate = new THREE.Group(); rockTemplate.add(m)
  for (const it of items) if (it.type === 'rock') { it.group.clear(); it.group.add(rockTemplate.clone(true)) }
}, undefined, () => toast('Rock model failed to load'))
initCloud({
  toast, spawn, serialize, deserialize,
  registerType(t) { CATALOG[t] = assetType(t) },
  refreshType(t) {
    CATALOG[t] = assetType(t)
    for (const it of items) if (it.type === t) { it.group.clear(); CATALOG[t].build(it.group); it.group.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true }) }
    if (sel) refreshSel()
  },
  rebuildAssets() { for (const t of new Set(items.map(i => i.type))) if (t.startsWith('asset:')) this.refreshType(t) },
})
const saved = localStorage.getItem(LS)
if (saved) { try { deserialize(JSON.parse(saved)) } catch { starter() } } else starter()
if (new URLSearchParams(location.search).has('third')) toggleView()
if (new URLSearchParams(location.search).has('dev')) toggleDev()

function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix() }
function fitPanels() { const t = $('top').getBoundingClientRect().bottom + 6 + 'px'; $('dev').style.top = t; $('help').style.top = t; $('dev').style.maxHeight = `calc(100% - ${t} - 180px)` }
addEventListener('resize', () => { resize(); fitPanels() }); resize(); fitPanels()
const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05)
  let fx = moveIn.x, fz = -moveIn.y
  if (keys.KeyW || keys.ArrowUp) fz += 1; if (keys.KeyS || keys.ArrowDown) fz -= 1
  if (keys.KeyA || keys.ArrowLeft) fx -= 1; if (keys.KeyD || keys.ArrowRight) fx += 1
  const sp = (keys.ShiftLeft ? 3.2 : 1.6) * dt, sy = Math.sin(player.yaw), cy = Math.cos(player.yaw)
  player.pos.x += (sy * fz - cy * fx) * sp; player.pos.z += (cy * fz + sy * fx) * sp
  player.pos.x = Math.max(-W / 2 + AVATAR.r, Math.min(W / 2 - AVATAR.r, player.pos.x))
  player.pos.z = Math.max(-D / 2 + AVATAR.r, Math.min(D / 2 - AVATAR.r, player.pos.z))
  look(lookIn.x * 900 * dt, lookIn.y * 600 * dt)
  if (helper) helper.update()
  updateCamera(); renderer.render(scene, camera)
})
window.__mysbase = { serialize, items: () => items }
