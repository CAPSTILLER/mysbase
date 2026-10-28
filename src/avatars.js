// Mysbase Avatars: list rigged uploads, full-screen viewer with emote chips (one AnimationMixer per avatar root).
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as cloud from './cloud.js'

const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
let app = null

/** "mixamo.com|Fall1" -> "Fall", "Flirty_Strut_inplace" -> "Flirty Strut", "climbing_up_wall" -> "Climbing Up Wall". */
export function prettyClip(name) {
  let s = String(name || '').replace(/^.*\|/, '').replace(/_?in_?place$/i, '').replace(/_/g, ' ').replace(/\d+$/, '').trim()
  return s.split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ') || String(name)
}
const hipsTrack = (clip, hipsName) => clip.tracks.find(t => hipsName ? t.name === hipsName + '.position' : /hips\.position$/i.test(t.name))
/** XZ travel of the hips track (in world metres when worldScale is given). */
export function rootMotionInfo(clip, hipsName, worldScale = 1, heightM = 1.8) {
  const t = hipsTrack(clip, hipsName); if (!t || t.values.length < 6) return { distance: 0, rootMotion: false }
  const v = t.values, n = v.length - 3, d = Math.hypot(v[n] - v[0], v[n + 2] - v[2]) * worldScale
  return { distance: d, rootMotion: d > 0.25 * heightM }
}
/** Copy of the clip with hips XZ pinned to frame 0 (Y kept for crouches and falls). */
function inPlace(clip, hipsName) {
  const c = clip.clone(), t = hipsTrack(c, hipsName); if (!t) return c
  const v = t.values, x0 = v[0], z0 = v[2]; for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0 }
  c.name = clip.name; return c
}

export class AvatarPlayer {
  constructor(root, animations) {
    this.root = root; this.clips = animations; this.mixer = new THREE.AnimationMixer(root)
    this.cur = null; this.speed = 1; this.paused = false; this.travel = false; this.cache = new Map()
    let hips = null; root.traverse(o => { if (!hips && o.isBone && /hips$/i.test(o.name)) hips = o }); this.hips = hips
    this.idle = (animations.find(a => /^walking$/i.test(prettyClip(a.name))) || animations[0])?.name
    this.mixer.addEventListener('finished', e => { if (e.action === this.cur && e.action.loop === THREE.LoopOnce) this.play(this.idle) })
  }
  clip(name) {
    const src = this.clips.find(c => c.name === name); if (!src || this.travel) return src
    if (!this.cache.has(name)) this.cache.set(name, inPlace(src, this.hips?.name)); return this.cache.get(name)
  }
  play(name, { loop = true, fade = 0.3 } = {}) {
    const clip = this.clip(name); if (!clip) return
    const a = this.mixer.clipAction(clip); a.reset(); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; a.enabled = true
    a.setEffectiveTimeScale(1).setEffectiveWeight(1)
    if (this.cur && this.cur !== a) { a.play(); this.cur.crossFadeTo(a, fade, false) } else a.play()
    this.cur = a; this.name = name
  }
  setTravel(on) { if (on === this.travel) return; this.travel = on; const n = this.name, t = this.cur?.time || 0; this.mixer.stopAllAction(); this.cur = null; this.play(n, { fade: 0 }); if (this.cur) this.cur.time = t }
  setSpeed(x) { this.speed = x; if (!this.paused) this.mixer.timeScale = x }
  pause(on) { this.paused = on; this.mixer.timeScale = on ? 0 : this.speed }
  seek(t) { if (!this.cur) return; this.cur.time = Math.max(0, Math.min(t, this.cur.getClip().duration)); this.mixer.update(0) }
  update(dt) { this.mixer.update(dt) }
  dispose() {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root)
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose()
      for (const m of [].concat(o.material || [])) { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose() }
    })
  }
}

export const listAvatars = () => cloud.metasList().filter(cloud.isRigged)

// ---------- list panel ----------
function renderList() {
  const box = $('avList'), all = listAvatars(); box.innerHTML = ''
  if (!all.length) box.innerHTML = '<div class="avEmpty">Upload a rigged .glb (or a zip of them) in My assets.</div>'
  const groups = new Map(); for (const m of all) { const f = m.folder || 'Unfiled'; if (!groups.has(f)) groups.set(f, []); groups.get(f).push(m) }
  for (const [f, list] of groups) {
    const h = document.createElement('div'); h.className = 'avFolder'; h.textContent = '📁 ' + f; box.appendChild(h)
    const g = document.createElement('div'); g.className = 'avGrid'; box.appendChild(g)
    for (const m of list) {
      const c = document.createElement('button'); c.className = 'avCard'; c.dataset.id = m.id
      c.innerHTML = `<div class="avThumb"></div><b>${esc(m.name)}</b><span>${m.rig.clips.length} emotes${m.rig.meshes > 1 ? ` · <i class="avBadge">${m.rig.meshes} meshes</i>` : ''}${m.local ? ' · preview' : ''}</span>`
      cloud.thumbFor(m).then(u => { if (u) c.querySelector('.avThumb').style.backgroundImage = `url("${u}")` }).catch(() => {})
      c.onclick = () => openViewer(m); g.appendChild(c)
    }
  }
  // older rigged uploads (before rig meta): check on demand, then offer the fix
  const old = cloud.metasList().filter(m => !m.local && !m.rig && m.sourceFormat === 'glb' && m.original && m.kind === 'model')
  if (old.length) {
    const d = document.createElement('details'); d.className = 'avOld'; d.innerHTML = `<summary>Older GLB uploads (${old.length}): check for animations</summary>`
    for (const m of old) {
      const r = document.createElement('div'); r.className = 'row'; r.innerHTML = `<span>${esc(m.name)}</span>`
      const b = document.createElement('button'); b.textContent = 'Check'; r.appendChild(b); d.appendChild(r)
      b.onclick = async () => {
        b.disabled = true; b.textContent = 'Checking…'
        try {
          if (!(await cloud.probeOriginal(m))) { b.textContent = 'No animations'; return }
          b.disabled = false; b.textContent = 'Fix animations'
          b.onclick = async () => { b.disabled = true; b.textContent = 'Fixing…'; try { await cloud.fixRig(m); app.toast(`✅ ${m.name}: ${m.rig.clips.length} emotes`); renderList() } catch (e) { b.textContent = '❌ ' + (e?.message || e) } }
        } catch (e) { b.textContent = '❌ ' + (e?.message || e) }
      }
    }
    box.appendChild(d)
  }
}
const autoTried = new Set()
/** One-time, saved repair of older rigged GLB uploads (no rig meta yet). Once saved, they load as avatars everywhere. */
async function autoFix() {
  const old = cloud.metasList().filter(m => !m.local && !m.rig && m.sourceFormat === 'glb' && m.original && m.kind === 'model' && !autoTried.has(m.id))
  let n = 0
  for (const m of old) {
    autoTried.add(m.id)
    try { if (await cloud.probeOriginal(m)) { await cloud.fixRig(m); n++; renderList() } } catch (e) { console.warn('avatar auto-fix', m.name, e) }
  }
  if (n) app.toast(`✅ Saved animations for ${n} older avatar${n > 1 ? 's' : ''}`)
}
async function openPanel() {
  $('avatarsPanel').classList.remove('hidden'); renderList()
  if (cloud.signedIn()) { await cloud.refreshAssets(); renderList(); await autoFix() }
  else if (!listAvatars().length) $('avList').insertAdjacentHTML('beforeend', '<div class="avEmpty small">Sign in (My assets) to see your uploads.</div>')
}

// ---------- viewer stage ----------
let V = null // { renderer, scene, cam, controls, player, raf, ... }
export async function openViewer(meta) {
  closeViewer()
  const st = $('avatarStage'); st.classList.remove('hidden'); $('avTitle').textContent = meta.name
  $('avInfo').textContent = `${meta.rig.skins} skin${meta.rig.skins > 1 ? 's' : ''} · ${meta.rig.joints} joints · ${meta.rig.meshes} mesh${meta.rig.meshes > 1 ? 'es' : ''} · ${meta.rig.clips.length} emotes`
  $('avChips').innerHTML = ''; $('avLoad').classList.remove('hidden'); $('avLoad').textContent = 'Loading…'
  const dpr = Math.min(devicePixelRatio || 1, 2)
  const renderer = new THREE.WebGLRenderer({ antialias: dpr < 2, preserveDrawingBuffer: true })
  renderer.setPixelRatio(dpr); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  $('avCanvasWrap').appendChild(renderer.domElement)
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#dfe3ea')
  scene.add(new THREE.HemisphereLight('#ffffff', '#8a8f9c', 2.0))
  const dl = new THREE.DirectionalLight('#ffffff', 2.2); dl.position.set(2.5, 5, 3); dl.castShadow = true; dl.shadow.mapSize.set(1024, 1024)
  Object.assign(dl.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.1, far: 20 }); scene.add(dl)
  const ground = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), new THREE.MeshStandardMaterial({ color: '#c9ced8', roughness: 1 }))
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground)
  const cam = new THREE.PerspectiveCamera(40, 1, 0.05, 100)
  const controls = new OrbitControls(cam, renderer.domElement); controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 1.2
  renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false }, { passive: true })
  V = { renderer, scene, cam, controls, dl, meta, clock: new THREE.Clock(), raf: 0 }
  const resize = () => { if (!V) return; const w = st.clientWidth, h = $('avCanvasWrap').clientHeight; renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; cam.aspect = w / Math.max(h, 1); cam.updateProjectionMatrix() }
  V.resize = resize; V.ro = new ResizeObserver(resize); V.ro.observe($('avCanvasWrap')); resize()
  loop()
  let rig
  try { rig = await cloud.loadRig(meta) } catch (e) { $('avLoad').textContent = '❌ ' + (e?.message || e); return }
  if (V?.meta !== meta) return
  const root = rig.scene; root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } if (o.isSkinnedMesh) o.frustumCulled = false })
  scene.add(root)
  const player = new AvatarPlayer(root, rig.animations); V.player = player; V.root = root
  player.play(player.idle, { fade: 0 }); player.update(0); root.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(root, true), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3())
  V.h = size.y; V.target = new THREE.Vector3(c.x, b.min.y + size.y * 0.55, c.z)
  controls.target.copy(V.target); const d = Math.max(size.y, size.x) * 2.1
  cam.position.set(c.x + d * 0.35, b.min.y + size.y * 0.75, c.z + d); controls.update()
  $('avLoad').classList.add('hidden')
  const chips = $('avChips')
  for (const cl of rig.animations) {
    const ch = document.createElement('button'); ch.className = 'avChip'; ch.textContent = prettyClip(cl.name); ch.title = cl.name; ch.dataset.clip = cl.name
    if (cl.name === player.idle) ch.classList.add('on')
    let t = 0, long = false
    ch.onpointerdown = () => { long = false; t = setTimeout(() => { long = true; pick(cl.name, false) }, 500) }
    ch.onpointerup = ch.onpointerleave = () => clearTimeout(t)
    ch.oncontextmenu = e => e.preventDefault()
    ch.onclick = () => { if (!long) pick(cl.name, true) }
    chips.appendChild(ch)
  }
  syncControls()
}
function pick(name, loop) {
  const p = V?.player; if (!p) return
  if (p.paused) setPause(false)
  p.play(name, { loop }); for (const c of $('avChips').children) c.classList.toggle('on', c.dataset.clip === name)
  if (!loop) app?.toast?.(`${prettyClip(name)} · once`, 1200)
}
function setPause(on) { V.player.pause(on); $('avPause').textContent = on ? '▶' : '⏸'; $('avScrubRow').classList.toggle('hidden', !on); if (on) { const a = V.player.cur; $('avScrub').max = a ? a.getClip().duration : 1; $('avScrub').value = a ? a.time : 0 } }
function syncControls() { $('avSpeed').value = 1; $('avSpeedT').textContent = '1×'; $('avPause').textContent = '⏸'; $('avScrubRow').classList.add('hidden'); $('avTravel').checked = false }
function loop() {
  if (!V) return
  V.raf = requestAnimationFrame(loop)
  const dt = Math.min(V.clock.getDelta(), 0.1)
  if (document.hidden) return
  if (V.player) {
    V.player.update(dt)
    if (V.player.travel && V.player.hips) { const hp = V.player.hips.getWorldPosition(new THREE.Vector3()); V.controls.target.x += (hp.x - V.controls.target.x) * 0.1; V.controls.target.z += (hp.z - V.controls.target.z) * 0.1 }
    else if (V.target) { V.controls.target.x += (V.target.x - V.controls.target.x) * 0.1; V.controls.target.z += (V.target.z - V.controls.target.z) * 0.1 }
  }
  V.controls.update(); V.renderer.render(V.scene, V.cam)
}
export function closeViewer() {
  if (!V) return
  cancelAnimationFrame(V.raf); V.ro.disconnect(); V.controls.dispose(); V.player?.dispose()
  V.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()) })
  V.renderer.dispose(); V.renderer.forceContextLoss?.(); V.renderer.domElement.remove(); V = null
  $('avatarStage').classList.add('hidden')
}

export function initAvatars(hooks) {
  app = hooks
  for (const id of ['bAvatars', 'bAvatars2']) { const b = $(id); if (b) b.onclick = openPanel }
  $('avClose').onclick = () => $('avatarsPanel').classList.add('hidden')
  $('avBack').onclick = closeViewer
  $('avSpeed').oninput = e => { const x = +e.target.value; $('avSpeedT').textContent = x.toFixed(1).replace(/\.0$/, '') + '×'; V?.player?.setSpeed(x) }
  $('avPause').onclick = () => V?.player && setPause(!V.player.paused)
  $('avScrub').oninput = e => V?.player?.seek(+e.target.value)
  $('avTravel').onchange = e => V?.player?.setTravel(e.target.checked)
  $('avSnap').onclick = () => { if (!V) return; V.renderer.render(V.scene, V.cam); V.renderer.domElement.toBlob(b => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${(V.meta.name || 'avatar').replace(/[^\w-]+/g, '_')}_${V.player?.name || ''}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) }, 'image/png') }
  document.addEventListener('visibilitychange', () => { if (V && !document.hidden) V.clock.getDelta() })
  window.__mysbaseAvatars = { openPanel, openViewer, closeViewer, get V() { return V } } // Playwright hook
}
