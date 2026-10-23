// Built-in procedural textures (surface layers) and built-in decor (vault door, tally marks, window).
import * as THREE from 'three'

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function cv(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')] }
const tex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t }
function noise(x, R, n, w, h, a, col) { for (let i = 0; i < n; i++) { x.fillStyle = `rgba(${col},${R() * a})`; x.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 3) } }

function plaster() { const [c, x] = cv(256), R = rng(1); x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 256); noise(x, R, 4000, 256, 256, 0.06, '0,0,0'); return { map: tex(c) } }
function woodFloor() {
  const [c, x] = cv(512), R = rng(2), pw = 512 / 5
  for (let i = 0; i < 5; i++) {
    const l = 120 + R() * 30; x.fillStyle = `hsl(28,38%,${30 + R() * 8}%)`; x.fillRect(i * pw, 0, pw, 512)
    for (let k = 0; k < 40; k++) { x.strokeStyle = `rgba(40,25,10,${0.08 + R() * 0.12})`; x.beginPath(); const xx = i * pw + R() * pw; x.moveTo(xx, 0); x.bezierCurveTo(xx + R() * 6 - 3, 170, xx + R() * 6 - 3, 340, xx, 512); x.stroke() }
    x.fillStyle = '#3b2a1c'; x.fillRect(i * pw, 0, 2, 512); const j = (i * 211) % 512; x.fillRect(i * pw, j, pw, 2); void l
  }
  return { map: tex(c) }
}
// blocks: tile = 1.2 m wide x 1.2 m tall, rows of 0.3 m, blocks 0.6 m staggered
function blocks(x, R, S, base, light) {
  const rh = S / 4, bw = S / 2
  for (let r = 0; r < 4; r++) for (let b = -1; b < 3; b++) {
    const ox = (r % 2) * bw / 2 + b * bw, l = light + (R() - 0.5) * 8
    x.fillStyle = `hsl(${base},12%,${l}%)`; x.fillRect(ox + 3, r * rh + 3, bw - 6, rh - 6)
  }
}
function stoneBlue() {
  const S = 512, [c, x] = cv(S), [e, ex] = cv(S), R = rng(42)
  x.fillStyle = '#0e1116'; x.fillRect(0, 0, S, S); blocks(x, R, S, 215, 19); noise(x, R, 9000, S, S, 0.12, '0,0,0'); noise(x, R, 3000, S, S, 0.06, '200,220,255')
  ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S)
  for (const g of [x, ex]) { g.lineCap = 'round' }
  const R2 = rng(7)
  for (let v = 0; v < 14; v++) {
    let px = R2() * S, py = R2() * S; const pts = [[px, py]]
    for (let k = 0; k < 6; k++) { px += (R2() - 0.5) * 120; py += (R2() - 0.3) * 80; pts.push([px, py]) }
    const w = 0.6 + R2() * 1.6
    for (const [g, col, lw] of [[x, 'rgba(90,150,255,.55)', w], [ex, 'rgba(70,140,255,1)', w + 0.5]]) {
      g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke()
    }
  }
  return { map: tex(c), emissiveMap: tex(e), emissive: '#4d8cff', emissiveIntensity: 0.6, roughness: 0.85 }
}
function stoneScratched() {
  const S = 512, [c, x] = cv(S), R = rng(9)
  x.fillStyle = '#23272d'; x.fillRect(0, 0, S, S); noise(x, R, 12000, S, S, 0.15, '0,0,0'); noise(x, R, 4000, S, S, 0.07, '220,230,255')
  for (let i = 0; i < 160; i++) {
    const sx = R() * S, sy = R() * S, a = R() * Math.PI, l = 10 + R() * 70
    x.strokeStyle = `rgba(200,210,225,${0.15 + R() * 0.35})`; x.lineWidth = 0.6 + R() * 1.2
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); x.stroke()
  }
  return { map: tex(c), roughness: 0.95 }
}
function stoneFloor() {
  const S = 512, [c, x] = cv(S), R = rng(5)
  x.fillStyle = '#0c0e12'; x.fillRect(0, 0, S, S)
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { x.fillStyle = `hsl(215,8%,${15 + R() * 5}%)`; x.fillRect(i * 256 + 3, j * 256 + 3, 250, 250) }
  noise(x, R, 12000, S, S, 0.15, '0,0,0'); return { map: tex(c), roughness: 0.9 }
}
function grime() {
  const S = 512, [c, x] = cv(S), R = rng(11)
  for (let i = 0; i < 40; i++) { const g = x.createRadialGradient(0, 0, 0, 0, 0, 30 + R() * 90); g.addColorStop(0, `rgba(10,12,16,${0.15 + R() * 0.3})`); g.addColorStop(1, 'rgba(10,12,16,0)')
    x.save(); x.translate(R() * S, R() * S); x.scale(1, 1 + R() * 2); x.fillStyle = g; x.fillRect(-150, -150, 300, 300); x.restore() }
  return { map: tex(c), transparent: true, depthWrite: false }
}
/** Built-in surface layers. tileM = real size of one texture tile (m). */
export const LAYERS = {
  'core-layer:plaster': { name: 'Plaster (paintable)', categories: ['wall-layer', 'ceiling-layer'], tileM: [1, 1], make: plaster, paintable: true },
  'core-layer:wood-floor': { name: 'Wood planks', categories: ['floor-layer'], tileM: [1, 1], make: woodFloor },
  'core-layer:stone-blue': { name: 'Blue-veined stone blocks', categories: ['wall-layer', 'floor-layer', 'ceiling-layer'], tileM: [1.2, 1.2], make: stoneBlue },
  'core-layer:stone-scratched': { name: 'Scratched stone', categories: ['ceiling-layer', 'wall-layer'], tileM: [1.5, 1.5], make: stoneScratched },
  'core-layer:stone-floor': { name: 'Stone floor slabs', categories: ['floor-layer'], tileM: [1.2, 1.2], make: stoneFloor },
  'core-layer:grime': { name: 'Grime overlay (transparent)', categories: ['wall-layer', 'floor-layer', 'ceiling-layer'], tileM: [2, 2], make: grime },
}
const made = new Map()
export function layerParts(id) { if (!made.has(id)) made.set(id, LAYERS[id].make()); return made.get(id) }

// ---------- built-in decor ----------
const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o })
export function buildVaultDoor(g) {
  // round bronze door, 1.8 m diameter, front faces +z, pivot at bottom centre; light leaks from the seam
  const R = 0.9, d = 0.22, bronze = std('#8c6a3c', { metalness: 0.85, roughness: 0.38 })
  const leak = new THREE.Mesh(new THREE.TorusGeometry(R + 0.015, 0.025, 8, 64), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
  leak.position.set(0, R, 0.0); g.add(leak)
  const glow = new THREE.Mesh(new THREE.RingGeometry(R, R + 0.18, 64), new THREE.MeshBasicMaterial({ color: '#dfe9ff', transparent: true, opacity: 0.22, depthWrite: false }))
  glow.position.set(0, R, -d / 2 + 0.01); g.add(glow)
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.02, R - 0.02, d, 64), bronze); disk.rotation.x = Math.PI / 2; disk.position.y = R; g.add(disk)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.08, 0.04, 10, 64), bronze); rim.position.set(0, R, d / 2); g.add(rim)
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), bronze); b.position.set(Math.cos(a) * (R - 0.08), R + Math.sin(a) * (R - 0.08), d / 2 + 0.03); g.add(b) }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 32), bronze); hub.rotation.x = Math.PI / 2; hub.position.set(0, R, d / 2 + 0.04); g.add(hub)
  for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.05), bronze); s.rotation.z = i * Math.PI / 3; s.position.set(0, R, d / 2 + 0.09); g.add(s) }
  const l = new THREE.PointLight('#e8f0ff', 3, 4.5, 1.5); l.position.set(0, R, d / 2 + 0.35); l.userData.builtinLight = true; g.add(l)
}
export function buildTally(g) {
  const [c, x] = cv(256, 128), R = rng(3)
  x.clearRect(0, 0, 256, 128); x.lineCap = 'round'
  const mark = (x1, y1, x2, y2) => { for (let k = 0; k < 3; k++) { x.strokeStyle = `rgba(225,232,245,${0.5 + R() * 0.3})`; x.lineWidth = 2 + R() * 2; x.beginPath(); x.moveTo(x1 + R() * 3, y1 + R() * 3); x.lineTo(x2 + R() * 3, y2 + R() * 3); x.stroke() } }
  for (let i = 0; i < 4; i++) mark(30 + i * 22, 22, 26 + i * 22 + R() * 6, 106)
  mark(18, 90, 112, 36)
  for (let i = 0; i < 2; i++) mark(160 + i * 22, 24, 156 + i * 22 + R() * 6, 104)
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), new THREE.MeshStandardMaterial({ map: tex(c), transparent: true, depthWrite: false, roughness: 1, emissive: '#6f7d95', emissiveIntensity: 0.15, emissiveMap: tex(c) }))
  m.position.set(0, 0.125, 0.002); m.castShadow = false; g.add(m)
}
export function buildWindow(g) {
  const w = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 0.02), new THREE.MeshBasicMaterial({ color: '#fff4dd' })); w.position.y = 0.6; g.add(w)
  const f = std('#efe6d6'); for (const [ww, hh, x, y] of [[1.5, 0.05, 0, 0], [1.5, 0.05, 0, 1.2], [0.05, 1.25, -0.725, 0.6], [0.05, 1.25, 0.725, 0.6], [0.04, 1.2, 0, 0.6]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, 0.04), f); b.position.set(x, y, 0.01); g.add(b) }
}
