// Mysbase cloud: wallet sign-in (CAPs Mind key holders / admins), private asset uploads, server-saved rooms.
// API + private Vercel Blob live on My Wally (junk-handle). Connecting is read-only; you sign one free message per 4 h.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { uploadPresigned } from '@vercel/blob/client'
import { getAddress } from 'viem'
import { unzipSync } from 'fflate'

export const API = (import.meta.env.VITE_MYSBASE_API || 'https://mywally.gearup.wtf').replace(/\/$/, '')
const MAX = 100 * 1024 * 1024
const $ = id => document.getElementById(id)
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
const sha256 = async buf => hex(await crypto.subtle.digest('SHA-256', buf))
const short = a => a.slice(0, 6) + '…' + a.slice(-4)
const UNITS = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 }
const MODEL_EXT = ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'usdz'], IMG_EXT = ['png', 'jpg', 'jpeg', 'webp']

let app // hooks from main.js
// Placement categories (items) + surface-layer categories. Snap side = which side of the asset locks flush to the target.
export const CATS = ['prop', 'table-top', 'wall-mount', 'ceiling-mount', 'free', 'wall-layer', 'floor-layer', 'ceiling-layer', 'light']
export const CAT_LABEL = { prop: 'prop (floor)', 'table-top': 'table-top', 'wall-mount': 'wall-mount', 'ceiling-mount': 'ceiling-mount', free: 'free (stays where put)', 'wall-layer': 'wall layer (tiles)', 'floor-layer': 'floor layer (tiles)', 'ceiling-layer': 'ceiling layer (tiles)', light: 'light' }
export const SNAPS = ['auto', 'bottom', 'back', 'top', 'front', 'left', 'right', 'center']
/** Default snap side for a category ('ceiling-layer' placed as an item hangs from the ceiling). */
export const defaultSnap = c => c === 'wall-mount' || c === 'wall-layer' ? 'back' : c === 'ceiling-mount' || c === 'ceiling-layer' ? 'top' : c === 'free' || c === 'light' ? 'center' : 'bottom'
export const snapOfMeta = m => (m?.snap && m.snap !== 'auto' ? m.snap : defaultSnap(m?.category || (m?.wall ? 'wall-mount' : 'prop')))
const opts = (list, cur, lab = {}) => list.map(c => `<option value="${c}" ${c === cur ? 'selected' : ''}>${lab[c] || c}</option>`).join('')
const catSel = def => `<div class="row"><span>Category</span><select id="afCat">${opts(CATS, def, CAT_LABEL)}</select><span class="small">Snap side</span><select id="afSnap">${opts(SNAPS, 'auto')}</select></div>`
// ---------- wallet ----------
const found = new Map()
addEventListener('eip6963:announceProvider', e => found.set(e.detail.info.uuid, e.detail))
dispatchEvent(new Event('eip6963:requestProvider'))
let provider = null, account = null, cbSdk = null
async function coinbase() {
  if (!cbSdk) { const { createCoinbaseWalletSDK } = await import('@coinbase/wallet-sdk'); cbSdk = createCoinbaseWalletSDK({ appName: 'Mysbase', appChainIds: [8453] }) }
  return cbSdk.getProvider()
}
function chooser() {
  const list = [...found.values()].map(d => ({ name: d.info.name, p: d.provider }))
  if (!list.length && window.ethereum) list.push({ name: 'Browser wallet', p: window.ethereum })
  list.push({ name: 'Coinbase / smart wallet', p: null })
  if (list.length === 1) return Promise.resolve(list[0])
  return new Promise(res => {
    const box = document.createElement('div'); box.id = 'wpick'
    box.innerHTML = '<b>Pick a wallet</b>'
    for (const o of list) { const b = document.createElement('button'); b.textContent = o.name; b.onclick = () => { box.remove(); res(o) }; box.appendChild(b) }
    const x = document.createElement('button'); x.textContent = 'Cancel'; x.onclick = () => { box.remove(); res(null) }; box.appendChild(x)
    document.body.appendChild(box)
  })
}
function paintWallet() {
  const b = $('bWallet'); b.textContent = account ? short(account) : 'Connect wallet'
  b.classList.toggle('on', !!account); b.title = account ? 'Connected (read-only). Tap to disconnect.' : 'Connect any wallet. Read-only; you only sign for uploads and saves.'
  $('cloud').classList.toggle('hidden', !account)
}
async function connect() {
  if (account) { account = null; provider = null; sessionStorage.removeItem('mysbase.session'); paintWallet(); return }
  const o = await chooser(); if (!o) return
  provider = o.p || await coinbase()
  const accs = await provider.request({ method: 'eth_requestAccounts' })
  account = accs?.[0] ? getAddress(accs[0]) : null
  provider.on?.('accountsChanged', a => { account = a?.[0] ? getAddress(a[0]) : null; sessionStorage.removeItem('mysbase.session'); paintWallet() })
  paintWallet()
  // a wallet that already has a valid session (this tab) loads its asset list right away so placeholders resolve
  const c = JSON.parse(sessionStorage.getItem('mysbase.session') || 'null')
  if (account && c && c.a === account.toLowerCase() && c.exp > Date.now() / 1000 + 60) refreshAssets()
}

// ---------- session (same signed-message gate as /backup, action "mysbase") ----------
function message({ domain, address, nonce, expires }) {
  return ['CAPs Mind backup', 'Sign in to Mysbase to upload private assets and save rooms. Free, no gas, no transaction.',
    'Action: mysbase', `Domain: ${domain}`, `Address: ${address}`, `Nonce: ${nonce}`, `Expires: ${new Date(expires * 1000).toISOString()}`].join('\n')
}
async function session() {
  if (!account) throw new Error('Connect a wallet first')
  const c = JSON.parse(sessionStorage.getItem('mysbase.session') || 'null')
  if (c && c.a === account.toLowerCase() && c.exp > Date.now() / 1000 + 60) return c.token
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)).buffer), expires = Math.floor(Date.now() / 1000) + 240
  const domain = location.host, msg = message({ domain, address: account, nonce, expires })
  app.toast('Sign the free Mysbase message in your wallet…')
  const signature = await provider.request({ method: 'personal_sign', params: [utf8hex(msg), account] })
  const r = await fetch(API + '/api/rocks/backup-auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: account, action: 'mysbase', nonce, expires, signature, domain }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Sign-in failed')
  sessionStorage.setItem('mysbase.session', JSON.stringify({ a: account.toLowerCase(), exp: j.expiresAt, token: j.token }))
  return j.token
}
const utf8hex = s => '0x' + hex(new TextEncoder().encode(s).buffer)
async function call(route, body = {}) {
  const t = await session()
  const r = await fetch(`${API}/api/rocks/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mysbase-session': t }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (r.status === 401) sessionStorage.removeItem('mysbase.session')
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}
const err = e => app.toast('❌ ' + (e?.shortMessage || e?.message || e))

// ---------- asset types in the room catalog ----------
const metas = new Map(), templates = new Map(), loading = new Map(), templAnims = new Map()
const hasSkin = o => { let k = false; o.traverse(x => { if (x.isSkinnedMesh) k = true }); return k }
/** Plain clone(true) shares/detaches bones on skinned meshes; SkeletonUtils.clone rebinds them. Static assets keep clone(true). */
export const cloneObj = o => { if (!hasSkin(o)) return o.clone(true); const c = SkeletonUtils.clone(o); c.traverse(x => { if (x.isSkinnedMesh) x.frustumCulled = false }); return c }
/** Rig stats for meta.rig: unique skeletons, joints, skinned meshes, clips (with root-motion guess on the hips track). */
export function rigInfo(obj, animations = [], scale = 1, heightM = 1) {
  const sk = new Set(), joints = new Set(); let meshes = 0
  obj.traverse(o => { if (o.isMesh) meshes++; if (o.isSkinnedMesh) { sk.add(o.skeleton); for (const b of o.skeleton.bones) joints.add(b) } }) // meshes: all meshes on the rig (panda_alien: skinned panda + bone-parented alien)
  if (!sk.size) return null
  obj.updateMatrixWorld(true)
  const clips = animations.map(c => {
    const t = c.tracks.find(t => /hips\.position$/i.test(t.name)); let d = 0
    if (t && t.values.length >= 6) {
      const node = obj.getObjectByName(t.name.replace(/\.position$/, '')), ps = node?.parent ? node.parent.getWorldScale(new THREE.Vector3()).x : scale
      const v = t.values, n = v.length - 3; d = Math.hypot(v[n] - v[0], v[n + 2] - v[2]) * ps
    }
    return { name: c.name, duration: +c.duration.toFixed(3), rootMotion: d > 0.25 * heightM }
  })
  return { skins: sk.size, joints: joints.size, meshes, clips }
}
export const isRigged = m => !!m?.rig && m.rig.skins > 0 && m.rig.clips?.length > 0
export function assetType(type) {
  const id = type.slice(6), m = metas.get(id)
  const size = m?.sizeM || [0.5, 0.5, 0.5]
  const category = m?.category || (m?.wall ? 'wall-mount' : 'prop'), snap = m ? snapOfMeta(m) : null
  return {
    name: m ? m.name : 'Private asset (connect + sign in)', size, allowedPresets: m?.allowedPresets || [], top: size[1], holds: !!m?.holds, asset: id, category, unresolved: !m,
    snap, wallOnly: ['back', 'front', 'left', 'right'].includes(snap), ceilOnly: snap === 'top', free: snap === 'center',
    build(g) {
      const t = templates.get(id)
      if (t) { g.add(cloneObj(t)); return }
      const ph = new THREE.Mesh(new THREE.BoxGeometry(size[0] || 0.5, size[1] || 0.5, size[2] || 0.5), new THREE.MeshStandardMaterial({ color: '#9db4e8', wireframe: true }))
      ph.position.y = (size[1] || 0.5) / 2; g.add(ph)
      if (m) loadTemplate(m).catch(() => {})
    },
  }
}
async function signedUrl(id, file) {
  const m = metas.get(id)
  if (m?.local) { const u = m.urls[file]; if (!u) throw new Error('missing ' + file); return { url: u, proxy: u } }
  if (m?.public && !hasSession()) return pub('mysbase-public-url', { id, file }) // starter-room visitors: public assets only
  return call('mysbase-asset-url', { id, file })
}
const hasSession = () => { const c = JSON.parse(sessionStorage.getItem('mysbase.session') || 'null'); return !!(account && c && c.a === account.toLowerCase() && c.exp > Date.now() / 1000 + 60) }
/** Public (no-session) API call: shared rooms, starter list, public asset URLs. */
async function pub(route, body = {}) {
  const r = await fetch(`${API}/api/rocks/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}
const mine = new Set() // ids listed by My assets (public metas from other rooms are not shown there)
const localMetas = new Map() // Room Kit previews: not uploaded yet, served from blob: URLs
const pubMetas = new Map() // public assets that arrived with a shared room (kept across My assets refreshes)
function addPublicMetas(list) {
  let n = 0
  for (const a of list || []) { pubMetas.set(a.id, a); if (!metas.has(a.id)) { metas.set(a.id, a); app.registerType('asset:' + a.id); n++ } }
  if (n) { app.rebuildAssets(); app.assetsChanged?.() }
}
async function loadTemplate(m) {
  if (templates.has(m.id)) return templates.get(m.id)
  if (loading.has(m.id)) return loading.get(m.id)
  const p = (async () => {
    let obj
    const try2 = async fn => { const u = await signedUrl(m.id, m.kind === 'image' ? m.original.file : 'model.glb'); try { return await fn(u.url) } catch { return fn(u.proxy) } }
    if (m.kind === 'image') {
      const tex = await try2(u => new THREE.TextureLoader().setCrossOrigin('anonymous').loadAsync(u)); tex.colorSpace = THREE.SRGBColorSpace
      const [w, h] = m.sizeM
      obj = new THREE.Group()
      const pl = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), [0, 0, 0, 0, 1, 0].map(f => f ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }) : new THREE.MeshStandardMaterial({ color: '#222' })))
      pl.position.set(0, h / 2, 0.01); obj.add(pl)
    } else {
      if (!m.model) throw new Error('needs converter')
      const gl = await try2(u => new GLTFLoader().setCrossOrigin('anonymous').loadAsync(u))
      obj = gl.scene; templAnims.set(m.id, gl.animations || [])
      if (m.offset) { // rig fast path: model.glb is the untouched original, scale/offset live in meta
        const g = new THREE.Group(); obj.scale.multiplyScalar(m.scale || 1); obj.position.fromArray(m.offset); g.add(obj); obj = g
      }
      obj.traverse(o => { if (o.isSkinnedMesh) o.frustumCulled = false })
    }
    obj.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true } })
    templates.set(m.id, obj)
    app.refreshType('asset:' + m.id)
    return obj
  })()
  loading.set(m.id, p); p.catch(() => loading.delete(m.id))
  return p
}

// ---------- My assets panel ----------
let assetsP = null
/** Fetch the wallet's My assets list once before importing a layout that references uploads. Never throws. */
export async function ensureAssets(layout) {
  const t = JSON.stringify(layout || {})
  if (!(t.includes('asset:') || t.includes('"slots"') || t.includes('slot:')) || [...metas.values()].some(m => !pubMetas.has(m.id))) return true
  if (!account) { app.toast('Layout uses uploaded assets: connect + sign in to load them (placeholders keep their spots)', 4000); return false }
  if (!hasSession()) return false // don't pop a signature just for loading; Sign in fills the placeholders
  return refreshAssets()
}
function refreshAssets() { return assetsP || (assetsP = refreshAssets0().finally(() => { assetsP = null })) }
let folders = [], view = localStorage.getItem('mysbase.assetView') || 'grid'
const filt = { q: '', cat: '', folder: '*' }
async function refreshAssets0() {
  const box = $('assetList'); if (!metas.size) box.textContent = 'Loading…'
  try {
    const r = await call('mysbase-assets'), assets = r.assets || []
    folders = r.folders || [...new Set(assets.map(a => a.folder).filter(Boolean))].sort()
    metas.clear(); for (const a of pubMetas.values()) metas.set(a.id, a); for (const a of localMetas.values()) metas.set(a.id, a); for (const a of assets) metas.set(a.id, a)
    mine.clear(); for (const a of assets) mine.add(a.id)
    for (const a of assets) if (a.kind !== 'archive') app.registerType('asset:' + a.id)
    renderAssets()
    app.rebuildAssets(); app.assetsChanged?.()
    return true
  } catch (e) { box.textContent = ''; err(e); return false }
}
/** Round-3 lookup: an asset by name (case/extension-insensitive), preferring the given folder. */
export function findAsset(name, folder) {
  const k = s => String(s || '').toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '').trim()
  const all = [...metas.values()].filter(m => m.kind !== 'archive' && k(m.name) === k(name)).sort((a, b) => !!a.local - !!b.local) // uploaded beats a local preview
  return (folder != null && all.find(m => (m.folder || '') === folder)) || all[0] || null
}
export const allAssets = () => [...metas.values()]
// ---------- asset manager (folders, grid/list, rename, category/snap, move, search) ----------
function mgrBar() {
  const m = $('assetMgr'); m.classList.remove('hidden')
  m.innerHTML = `<div class="row"><input type="search" id="amQ" placeholder="Search name…"><select id="amCat" title="Filter by category"></select></div>
    <div class="row"><select id="amFolder" title="Folder"></select><button id="amNew" title="New folder">+ Folder</button><button id="amRen">Rename folder</button><button id="amDel">Delete folder</button>
    <button id="amView" title="Grid / list">${view === 'grid' ? '☰ List' : '▦ Grid'}</button></div>`
  const q = $('amQ'); q.value = filt.q; q.oninput = () => { filt.q = q.value; renderAssets(false) }
  $('amCat').innerHTML = `<option value="">All categories</option>${opts(CATS, filt.cat, CAT_LABEL)}`; $('amCat').onchange = e => { filt.cat = e.target.value; renderAssets(false) }
  $('amFolder').innerHTML = `<option value="*">All folders</option><option value="">Unfiled</option>` + folders.map(f => `<option>${esc(f)}</option>`).join('')
  $('amFolder').value = filt.folder; $('amFolder').onchange = e => { filt.folder = e.target.value; renderAssets() }
  const realF = filt.folder !== '*' && filt.folder !== ''
  $('amRen').disabled = $('amDel').disabled = !realF
  $('amView').onclick = () => { view = view === 'grid' ? 'list' : 'grid'; localStorage.setItem('mysbase.assetView', view); renderAssets() }
  $('amNew').onclick = () => folderAct('create')
  $('amRen').onclick = () => folderAct('rename'); $('amDel').onclick = () => folderAct('delete')
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const okFolder = f => /^[\w .()&+,'-]{1,60}$/.test(f)
async function folderAct(op) {
  try {
    if (op === 'create') {
      const n = (prompt('New folder name') || '').trim(); if (!n) return
      if (!okFolder(n)) return app.toast('Folder: letters, digits, spaces, - _ . ( ) & + , only')
      await call('mysbase-folder', { op, name: n }); filt.folder = n
    } else if (op === 'rename') {
      const to = (prompt(`Rename folder "${filt.folder}" to`, filt.folder) || '').trim(); if (!to || to === filt.folder) return
      if (!okFolder(to)) return app.toast('Folder: letters, digits, spaces, - _ . ( ) & + , only')
      await call('mysbase-folder', { op, name: filt.folder, to }); filt.folder = to
    } else {
      if (!confirm(`Delete folder "${filt.folder}"? Its assets are kept and become Unfiled.`)) return
      await call('mysbase-folder', { op, name: filt.folder }); filt.folder = '*'
    }
    app.toast('✅ Folders updated'); await refreshAssets()
  } catch (e) { err(e) }
}
const thumbs = new Map() // id -> url (signed or data:)
function shown() {
  const q = filt.q.toLowerCase()
  return [...metas.values()].filter(a => mine.has(a.id) && (filt.folder === '*' || (a.folder || '') === filt.folder) && (!filt.cat || (a.category || (a.wall ? 'wall-mount' : 'prop')) === filt.cat) && (!q || a.name.toLowerCase().includes(q) || (a.folder || '').toLowerCase().includes(q)))
}
function renderAssets(bar = true) {
  if (bar || !$('amQ')) mgrBar()
  const box = $('assetList'); box.className = view; box.innerHTML = ''
  const list = shown()
  if (!list.length) { box.innerHTML = `<span class="small">${metas.size ? 'Nothing matches.' : 'No assets yet. Upload a file or a zip.'}</span>`; return }
  const groups = new Map(); for (const a of list) { const f = a.folder || ''; if (!groups.has(f)) groups.set(f, []); groups.get(f).push(a) }
  for (const f of [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b))) {
    if (filt.folder === '*') { const h = document.createElement('div'); h.className = 'fhead'; h.textContent = '📁 ' + (f || 'Unfiled') + ` (${groups.get(f).length})`; box.appendChild(h) }
    for (const a of groups.get(f).sort((x, y) => (x.kind === 'archive') - (y.kind === 'archive') || x.name.localeCompare(y.name))) box.appendChild(card(a))
  }
}
function card(a) {
  const c = document.createElement('div'); c.className = 'card'; c.dataset.id = a.id
  const im = document.createElement(a.kind === 'archive' ? 'div' : 'img'); im.className = a.kind === 'archive' ? 'noimg' : ''
  if (a.kind === 'archive') im.textContent = '🗜 original zip'; else { im.alt = a.name; im.loading = 'lazy'; thumbFor(a).then(u => { if (u) im.src = u; else { const d = document.createElement('div'); d.className = 'noimg'; d.textContent = a.needsConverter ? 'needs converter' : 'no preview'; im.replaceWith(d) } }) }
  const nm = document.createElement('b'); nm.textContent = a.name
  const mb = (((a.model?.bytes || a.original?.bytes) || 0) / 1048576).toFixed(1)
  const info = document.createElement('span'); info.className = 'small'
  info.textContent = `${a.kind} · ${a.sourceFormat} · ${mb} MB${a.sizeM ? ' · ' + a.sizeM.map(v => v.toFixed(2)).join('×') + ' m' : ''}${a.needsConverter ? ' · needs converter' : ''}`
  c.append(im, nm, info)
  const acts = document.createElement('div'); acts.className = 'acts'
  const btn = (t, f, tip) => { const b = document.createElement('button'); b.textContent = t; b.title = tip || t; b.onclick = f; acts.appendChild(b); return b }
  if (a.kind !== 'archive') { const pl = btn('Place', () => { app.spawn('asset:' + a.id); loadTemplate(a).catch(err) }); pl.disabled = !!a.needsConverter && a.kind !== 'image' }
  btn('Rename', async () => { const n = (prompt('Asset name', a.name) || '').trim(); if (!n || n === a.name) return; await saveMeta(a, { name: n }) })
  btn('Delete', async () => { if (!confirm(`Delete "${a.name}" from the server? Rooms using it will show a placeholder.`)) return; try { await call('mysbase-asset-delete', { id: a.id }); app.toast('Deleted'); refreshAssets() } catch (e) { err(e) } })
  c.appendChild(acts)
  if (a.kind !== 'archive') {
    const cat = document.createElement('select'); cat.innerHTML = opts(CATS, a.category || (a.wall ? 'wall-mount' : 'prop'), CAT_LABEL); cat.title = 'Category'; cat.className = 'amCat'
    const sn = document.createElement('select'); sn.innerHTML = opts(SNAPS, a.snap || 'auto', { auto: `snap: auto (${defaultSnap(a.category || 'prop')})` }); sn.title = 'Snap side (which side locks flush to the wall / table / ceiling)'; sn.className = 'amSnap'
    cat.onchange = () => saveMeta(a, { category: cat.value, snap: sn.value }, () => { cat.value = a.category || 'prop' })
    sn.onchange = () => saveMeta(a, { category: cat.value, snap: sn.value }, () => { sn.value = a.snap || 'auto' })
    c.append(cat, sn)
  }
  const fo = document.createElement('select'); fo.title = 'Move to folder'; fo.className = 'amMove'
  fo.innerHTML = `<option value="">📁 Unfiled</option>` + folders.map(f => `<option ${f === a.folder ? 'selected' : ''}>${esc(f)}</option>`).join('')
  fo.onchange = () => saveMeta(a, { folder: fo.value }, () => { fo.value = a.folder || '' })
  c.appendChild(fo)
  return c
}
async function saveMeta(a, patch, revert) {
  try {
    const r = await call('mysbase-asset-meta', { id: a.id, ...patch })
    Object.assign(a, r.asset || patch); if (patch.folder === '') delete a.folder; metas.set(a.id, a)
    if (a.kind !== 'archive') { app.refreshType('asset:' + a.id); app.assetsChanged?.() }
    app.toast(`✅ ${a.name}${patch.category ? `: ${a.category} · snap ${snapOfMeta(a)}` : patch.folder !== undefined ? ` → ${a.folder || 'Unfiled'}` : ' renamed'}`)
    renderAssets()
  } catch (e) { err(e); revert?.() }
}
// thumbnails: stored thumb.png, the image itself, or rendered once from the GLB and saved back (best effort)
let thumbQ = Promise.resolve()
export function thumbFor(a) {
  if (thumbs.has(a.id)) return Promise.resolve(thumbs.get(a.id))
  const p = (async () => {
    if (a.thumb) return (await signedUrl(a.id, a.thumb.file)).url
    if (a.kind === 'image') return (await signedUrl(a.id, a.original.file)).url
    if (!a.model) return null
    return (thumbQ = thumbQ.catch(() => {}).then(async () => {
      const obj = await loadTemplate(a), blob = await snapshot(obj)
      const url = URL.createObjectURL(blob)
      saveThumb(a, blob).catch(e => console.warn('thumb save', e))
      return url
    }))
  })().catch(e => { console.warn('thumb', e); return null })
  p.then(u => thumbs.set(a.id, u)); return p
}
async function saveThumb(a, blob) {
  const buf = await blob.arrayBuffer()
  await put(a.id, 'thumb.png', new Blob([buf], { type: 'image/png' }), 'Thumb', () => {})
  const r = await call('mysbase-asset-meta', { id: a.id, thumb: { file: 'thumb.png', sha256: await sha256(buf) } }); Object.assign(a, r.asset || {})
}
let snapR = null
async function snapshot(obj, px = 256) {
  if (!snapR) { snapR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); snapR.setSize(px, px, false); snapR.outputColorSpace = THREE.SRGBColorSpace }
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight('#ffffff', '#8a8a99', 2.2)); const dl = new THREE.DirectionalLight('#fff', 2); dl.position.set(2, 4, 3); sc.add(dl)
  const o = cloneObj(obj); sc.add(o)
  const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3()), r = Math.max(b.getSize(new THREE.Vector3()).length() / 2, 0.01)
  const cam = new THREE.PerspectiveCamera(35, 1, r / 100, r * 100), d = r / Math.sin(17.5 * Math.PI / 180)
  cam.position.copy(c).add(new THREE.Vector3(0.55, 0.45, 1).normalize().multiplyScalar(d)); cam.lookAt(c)
  snapR.setClearColor('#eef0f4', 1); snapR.render(sc, cam)
  return new Promise((res, rej) => snapR.domElement.toBlob(b => b ? res(b) : rej(new Error('snapshot failed')), 'image/png'))
}
// ---------- zip upload: own folder, each file through the convert/upload pipeline ----------
const guessCat = (name, kind) => { const n = name.toLowerCase()
  if (/(^|[_ -])(wall)([_ -]|$)/.test(n) && /pad|tile|panel|layer|paper/.test(n)) return 'wall-layer'
  if (/floor/.test(n) && /pad|tile|plank|layer|slab/.test(n)) return 'floor-layer'
  if (/ceiling/.test(n) && /pad|tile|layer/.test(n)) return 'ceiling-layer'
  if (/ceiling|cage_?light|lamp|chandelier|pendant/.test(n)) return 'ceiling-mount'
  if (kind === 'image' || /door|window|poster|decal|painting|frame|sign|shelf_wall/.test(n)) return 'wall-mount'
  return 'prop' }
async function pickZip(f) {
  if (f.size > MAX) return app.toast('Max 100 MB per zip')
  const buf = new Uint8Array(await f.arrayBuffer())
  let files
  try { files = unzipSync(buf) } catch (e) { return app.toast('❌ Not a readable zip: ' + (e?.message || e)) }
  let folder = f.name.replace(/\.zip$/i, '').replace(/[^\w .()&+,'-]/g, '_').slice(0, 54) || 'zip'
  if (folders.includes(folder)) { let i = 2; while (folders.includes(`${folder} (${i})`)) i++; folder = `${folder} (${i})` }
  const entries = Object.entries(files).filter(([p, d]) => !p.endsWith('/') && !/(^|\/)(__MACOSX|\.)/.test(p) && d.length)
  const log = $('zipLog'); log.classList.remove('hidden'); log.innerHTML = `<b>${esc(f.name)} → 📁 ${esc(folder)}</b> · ${entries.length} files`
  const rows = entries.map(([p]) => { const r = document.createElement('div'); r.className = 'zr'; r.innerHTML = `<span></span><progress max="100" value="0"></progress><span class="small">waiting</span>`; r.firstChild.textContent = p; log.appendChild(r); return r })
  const st = (r, t, cls = '') => { const s = r.lastChild; s.textContent = t; s.className = 'small ' + cls }
  try {
    await call('mysbase-folder', { op: 'create', name: folder }); if (!folders.includes(folder)) folders.push(folder)
    const zid = crypto.randomUUID(); await put(zid, 'original.zip', new Blob([buf], { type: 'application/zip' }), 'Zip', pc => { log.firstChild.title = pc + '%' })
    await call('mysbase-asset-save', { id: zid, name: f.name, kind: 'archive', sourceFormat: 'zip', folder, original: { file: 'original.zip', sha256: await sha256(buf.buffer) } })
  } catch (e) { err(e); log.insertAdjacentHTML('beforeend', `<div class="zr"><span class="err">❌ ${esc(e?.message || e)}</span></div>`); return }
  let ok = 0; const errs = []
  for (let i = 0; i < entries.length; i++) {
    const [path, data] = entries[i], r = rows[i], base = path.split('/').pop(), ext = (base.split('.').pop() || '').toLowerCase()
    if (![...MODEL_EXT, ...IMG_EXT].includes(ext)) { st(r, 'skipped (not a model/image)', 'err'); errs.push(`${path}: skipped`); continue }
    try {
      st(r, 'converting…')
      const meta = await ingest(base, ext, data.slice().buffer, folder, pc => { r.children[1].value = pc; st(r, `uploading ${Math.round(pc)}%`) })
      await call('mysbase-asset-save', meta); r.children[1].value = 100
      st(r, meta.needsConverter ? '⚠ stored original (needs converter)' : `✅ ${meta.category}`, meta.needsConverter ? 'err' : 'ok'); if (meta.needsConverter) errs.push(`${path}: ${meta.note}`); else ok++
    } catch (e) { st(r, '❌ ' + (e?.message || e), 'err'); errs.push(`${path}: ${e?.message || e}`) }
  }
  log.insertAdjacentHTML('beforeend', `<div class="zr"><b>${ok}/${entries.length} uploaded${errs.length ? ` · ${errs.length} problem(s) listed above` : ''}</b><button id="zipX">Close</button></div>`)
  $('zipX').onclick = () => log.classList.add('hidden')
  app.toast(`✅ ${f.name}: ${ok} assets in 📁 ${folder}`)
  filt.folder = folder; await refreshAssets()
}
/** Non-interactive version of the single-file pipeline (sane defaults: unit guess, category from name, auto snap). */
async function ingest(fileName, ext, buf, folder, prog, over = {}) {
  const p = await prepare(fileName, ext, buf, folder, over)
  return uploadPrepared(p, prog)
}
/** CPU half of ingest (no network): parse, normalise to metres, GLB + thumbnail. Returns { meta, blobs: {file: Blob} }. Room Kit previews these before upload. */
export async function prepare(fileName, ext, buf, folder, over = {}) {
  ext = String(ext).toLowerCase()
  const sc = over.category || app.slotCat?.(fileName) // a matching template slot (or Room Kit tag) decides the category
  const id = crypto.randomUUID(), name = (over.name || fileName.replace(/\.[^.]+$/, '')).slice(0, 80), origFile = 'original.' + (ext === 'jpeg' ? 'jpg' : ext)
  if (buf.byteLength > MAX) throw new Error('over 100 MB')
  const original = { file: origFile, sha256: await sha256(buf) }
  const ob = new Blob([buf], { type: IMG_EXT.includes(ext) ? 'image/' + (ext === 'jpg' ? 'jpeg' : ext) : 'application/octet-stream' })
  if (IMG_EXT.includes(ext)) {
    const img = await createImageBitmap(ob), w = over.sizeM?.[0] || 0.8
    const category = (sc || guessCat(name, 'image'))
    return { meta: { id, name, folder, kind: 'image', sourceFormat: ext, original, sizeM: over.sizeM ? [...over.sizeM.slice(0, 2), 0.02] : [w, +(w * img.height / img.width).toFixed(3), 0.02], wall: category === 'wall-mount', category, snap: 'auto', px: [img.width, img.height] }, blobs: { [origFile]: ob }, image: img }
  }
  let obj = null, why = '', animations = []
  try { ({ scene: obj, animations } = await parse(ext, buf.slice(0))) } catch (e) { why = e?.message || 'could not read' }
  if (obj && measure(obj).lengthSq() === 0) { obj = null; why = 'empty model' }
  if (!obj) return { meta: { id, name, folder, kind: 'model', sourceFormat: ext, original, needsConverter: true, note: (ext === 'gltf' ? 'GLTF with external files: zip a .glb instead. ' : '') + why.slice(0, 180) }, blobs: { [origFile]: ob } }
  const raw = measure(obj), unit = raw.y > 50 ? (raw.y > 500 ? 'mm' : 'cm') : 'm', s = UNITS[unit]
  const root = new THREE.Group(); root.add(obj); obj.scale.multiplyScalar(s); obj.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3())
  obj.position.set(obj.position.x - c.x, obj.position.y - b.min.y, obj.position.z - c.z); root.updateMatrixWorld(true)
  const sz = measure(root), category = (sc || guessCat(name, 'model'))
  const meta = { id, name, folder, kind: 'model', sourceFormat: ext, original, sizeM: [sz.x, sz.y, sz.z].map(v => +v.toFixed(4)), unit, scale: s,
    holds: false, wall: category === 'wall-mount', allowedPresets: ['Tabletop'], category, snap: 'auto' }
  const blobs = { [origFile]: ob }
  const rig = rigInfo(obj, animations, s, sz.y); if (rig) meta.rig = rig
  let glb = null
  if (rig && ext === 'glb' && animations.length) { glb = buf; meta.offset = obj.position.toArray().map(v => +v.toFixed(6)) } // rig fast path: keep original bytes
  else try { glb = await new GLTFExporter().parseAsync(root, { binary: true, animations }) } catch (e) { console.warn(e) }
  if (glb && glb.byteLength <= MAX) {
    blobs['model.glb'] = new Blob([glb], { type: 'model/gltf-binary' }); meta.model = { file: 'model.glb', sha256: await sha256(glb) }
    try { const t = await snapshot(root), tb = await t.arrayBuffer(); blobs['thumb.png'] = new Blob([tb], { type: 'image/png' }); meta.thumb = { file: 'thumb.png', sha256: await sha256(tb) } } catch (e) { console.warn('thumb', e) }
  } else { meta.needsConverter = true; meta.note = glb ? 'GLB over 100 MB' : 'GLB export failed' }
  return { meta, blobs }
}
/** Network half: upload every prepared blob, return the meta (caller saves it with mysbase-asset-save). */
async function uploadPrepared({ meta, blobs }, prog = () => {}) {
  const files = Object.keys(blobs), n = files.length
  for (let i = 0; i < n; i++) await put(meta.id, files[i], blobs[files[i]], files[i], p => prog((i * 100 + p) / n))
  const m = { ...meta }; delete m.px; return m
}
function measure(obj) { const b = new THREE.Box3().setFromObject(obj); return b.getSize(new THREE.Vector3()) }
async function parse(ext, buf) {
  const w = obj => ({ scene: obj, animations: obj.animations || [] })
  if (ext === 'glb' || ext === 'gltf') { const g = await new GLTFLoader().parseAsync(ext === 'gltf' ? new TextDecoder().decode(buf) : buf, ''); return { scene: g.scene, animations: g.animations || [] } }
  if (ext === 'obj') return w(new OBJLoader().parse(new TextDecoder().decode(buf)))
  if (ext === 'fbx') return w(new FBXLoader().parse(buf, ''))
  if (ext === 'usdz') return w(new USDZLoader().parse(buf))
  const geo = ext === 'stl' ? new STLLoader().parse(buf) : new PLYLoader().parse(buf)
  geo.computeVertexNormals()
  return { scene: new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: geo.hasAttribute('color') ? '#fff' : '#b8b0a4', vertexColors: geo.hasAttribute('color'), roughness: 0.8 })), animations: [] }
}
export { parse as parseModel }
function form(html) { const f = $('assetForm'); f.innerHTML = html; f.classList.remove('hidden'); return f }
function closeForm() { const f = $('assetForm'); f.innerHTML = ''; f.classList.add('hidden') }
async function put(id, file, blob, label, onProg) {
  if (window.__mysbaseTestPut) return window.__mysbaseTestPut(id, file, blob, onProg) // Playwright hook (no real Blob in tests)
  const t = await session()
  await uploadPresigned(`mysbase/assets/${id}/${file}`, blob, {
    access: 'private', handleUploadUrl: API + '/api/rocks/mysbase-upload', headers: { 'x-mysbase-session': t },
    multipart: blob.size > 8 * 1024 * 1024, contentType: blob.type || 'application/octet-stream',
    onUploadProgress: p => { if (onProg) return onProg(p.percentage); $('assetProg').value = p.percentage; $('assetProgT').textContent = `${label} ${Math.round(p.percentage)}%` },
  })
}
async function pick(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase()
  if (![...MODEL_EXT, ...IMG_EXT].includes(ext)) return app.toast('Use GLB, GLTF, OBJ, STL, PLY, FBX, USDZ, PNG, JPG or WEBP')
  if (f.size > MAX) return app.toast('Max 100 MB per file')
  const buf = await f.arrayBuffer(), id = crypto.randomUUID(), name = f.name.replace(/\.[^.]+$/, '').slice(0, 80)
  const origFile = 'original.' + (ext === 'jpeg' ? 'jpg' : ext)
  if (IMG_EXT.includes(ext)) {
    const img = await createImageBitmap(f), aspect = img.height / img.width
    const fm = form(`<b>Image: ${f.size > 1e6 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.round(f.size / 1024) + ' KB'}, ${img.width}×${img.height}px</b>
      <div class="row"><span>Name</span><input id="afName"></div>
      <div class="row"><span>Width</span><input id="afW" type="number" step="0.01" min="0.05" value="0.8"> m (hangs on walls; for layers = one tile's width)</div>${catSel('wall-mount')}
      <div class="row"><button id="afGo">Upload</button><button id="afX">Cancel</button></div>`)
    fm.querySelector('#afName').value = name; fm.querySelector('#afX').onclick = closeForm
    fm.querySelector('#afGo').onclick = () => run(async () => {
      const w = +fm.querySelector('#afW').value || 0.8
      await put(id, origFile, new Blob([buf], { type: f.type || 'image/' + ext }), 'Image')
      return { id, name: fm.querySelector('#afName').value || name, kind: 'image', sourceFormat: ext, original: { file: origFile, sha256: await sha256(buf) }, sizeM: [w, +(w * aspect).toFixed(3), 0.02], wall: true, category: fm.querySelector('#afCat').value, snap: fm.querySelector('#afSnap').value }
    })
    return
  }
  let obj = null, why = '', animations = []
  try { ({ scene: obj, animations } = await parse(ext, buf.slice(0))) } catch (e) { why = e?.message || 'could not read' }
  if (obj && measure(obj).lengthSq() === 0) { obj = null; why = 'empty model' }
  if (!obj) {
    const fm = form(`<b>${ext.toUpperCase()} can't be converted in the browser (${why}).</b><div class="small">It can be stored as the original only, marked "needs converter" (not placeable yet).</div>
      <div class="row"><button id="afGo">Store original</button><button id="afX">Cancel</button></div>`)
    fm.querySelector('#afX').onclick = closeForm
    fm.querySelector('#afGo').onclick = () => run(async () => {
      await put(id, origFile, new Blob([buf], { type: 'application/octet-stream' }), 'Original')
      return { id, name, kind: 'model', sourceFormat: ext, original: { file: origFile, sha256: await sha256(buf) }, needsConverter: true, note: why.slice(0, 200) }
    })
    return
  }
  const raw = measure(obj)
  const guess = raw.y > 50 ? (raw.y > 500 ? 'mm' : 'cm') : 'm'
  const fm = form(`<b>${ext.toUpperCase()} · file units: ${raw.x.toFixed(3)} × ${raw.y.toFixed(3)} × ${raw.z.toFixed(3)} (W×H×D)</b>
    <div class="row"><span>Name</span><input id="afName"></div>
    <div class="row"><span>Units</span><select id="afU">${Object.keys(UNITS).map(u => `<option ${u === guess ? 'selected' : ''}>${u}</option>`).join('')}</select>
      <span class="small">or set the real height:</span><input id="afH" type="number" step="0.001" min="0.001"> m</div>
    <div class="row small" id="afSize"></div>
    <div class="row"><label class="small"><input type="checkbox" id="afHolds"> things can stand on it</label><label class="small"><input type="checkbox" id="afWall"> wall-mounted</label><label class="small"><input type="checkbox" id="afTab" checked> allow Tabletop preset</label></div>${catSel('prop')}
    <div class="row"><button id="afGo">Convert to GLB &amp; upload</button><button id="afX">Cancel</button></div>`)
  const q = s => fm.querySelector(s)
  q('#afName').value = name; q('#afX').onclick = closeForm
  const scale = () => { const h = +q('#afH').value; return h > 0 ? h / raw.y : UNITS[q('#afU').value] }
  const show = () => { const s = scale(); q('#afSize').textContent = `Real size: ${(raw.x * s).toFixed(3)} × ${(raw.y * s).toFixed(3)} × ${(raw.z * s).toFixed(3)} m` }
  q('#afU').onchange = () => { q('#afH').value = ''; show() }; q('#afH').oninput = show; show()
  q('#afGo').onclick = () => run(async () => {
    const s = scale()
    // real size + floor-align: base at y=0, centered on x/z
    const root = new THREE.Group(); root.add(obj); obj.scale.multiplyScalar(s); obj.updateMatrixWorld(true)
    const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3())
    obj.position.set(obj.position.x - c.x, obj.position.y - b.min.y, obj.position.z - c.z)
    root.updateMatrixWorld(true)
    const sz = measure(root)
    $('assetProgT').textContent = 'Converting…'
    let glb = null
    const rig = rigInfo(obj, animations, s, sz.y)
    if (rig && ext === 'glb' && animations.length) glb = buf // rig fast path (scale/offset in meta)
    else try { glb = await new GLTFExporter().parseAsync(root, { binary: true, animations }) } catch (e) { console.warn(e) }
    const originalSha = await sha256(buf)
    await put(id, origFile, new Blob([buf], { type: 'application/octet-stream' }), 'Original')
    const meta = { id, name: q('#afName').value || name, kind: 'model', sourceFormat: ext, original: { file: origFile, sha256: originalSha },
      sizeM: [sz.x, sz.y, sz.z].map(v => +v.toFixed(4)), unit: q('#afH').value ? 'custom' : q('#afU').value, scale: s,
      holds: q('#afHolds').checked, wall: q('#afWall').checked, allowedPresets: q('#afTab').checked ? ['Tabletop'] : [], category: q('#afCat').value, snap: q('#afSnap').value }
    if (rig) { meta.rig = rig; if (glb === buf) meta.offset = obj.position.toArray().map(v => +v.toFixed(6)) }
    if (glb && glb.byteLength <= MAX) {
      await put(id, 'model.glb', new Blob([glb], { type: 'model/gltf-binary' }), 'GLB')
      meta.model = { file: 'model.glb', sha256: await sha256(glb) }
    } else { meta.needsConverter = true; meta.note = glb ? 'GLB over 100 MB' : 'GLB export failed' }
    return meta
  })
}
async function run(fn) {
  $('assetProg').classList.remove('hidden'); $('assetProg').value = 0
  try {
    const meta = await fn()
    $('assetProgT').textContent = 'Saving…'
    if (filt.folder !== '*' && filt.folder) meta.folder = filt.folder
    await call('mysbase-asset-save', meta)
    closeForm(); $('assetProgT').textContent = '✅ Uploaded'; app.toast('Uploaded to your private storage')
    refreshAssets()
  } catch (e) { $('assetProgT').textContent = '❌ ' + (e?.message || e); err(e) } finally { $('assetProg').classList.add('hidden') }
}

// ---------- rooms ----------
const roomId = () => { const v = $('roomId').value.trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(v)) throw new Error('Room id: lowercase letters, digits, dashes'); localStorage.setItem('mysbase.roomId', v); return v }
async function saveServer() {
  try { const r = await call('mysbase-room-save', { roomId: roomId(), layout: app.serialize() }); app.toast(`Saved "${r.roomId}" to server (${r.versions} versions kept)`); listRooms() } catch (e) { err(e) }
}
async function loadServer(version = 0) {
  try {
    const r = await call('mysbase-room', { roomId: roomId(), version })
    await ensureAssets(r.layout)
    app.deserialize(r.layout)
    const h = $('roomVer'); h.innerHTML = r.versions.map(v => `<option value="${v.version}">${v.version ? 'v-' + v.version : 'latest'} · ${new Date(v.savedAt).toLocaleString()}</option>`).join(''); h.value = String(version); h.classList.remove('hidden')
    app.toast(`Loaded "${r.roomId}" from server`)
  } catch (e) { err(e) }
}
async function listRooms() {
  try { const { rooms } = await call('mysbase-rooms'); $('roomIds').innerHTML = rooms.map(r => `<option value="${r.roomId}">`).join('') } catch { /* optional */ }
}

export function initCloud(hooks) {
  app = hooks
  $('roomId').value = localStorage.getItem('mysbase.roomId') || 'my-room'
  $('bWallet').onclick = () => connect().catch(err)
  $('bSignIn').onclick = async () => { try { await session(); app.toast('Signed in'); refreshAssets(); listRooms() } catch (e) { err(e) } }
  $('bAssets').onclick = refreshAssets
  $('bUpload').onclick = () => $('assetFile').click()
  $('bZip').onclick = () => $('zipFile').click()
  $('zipFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) pickZip(f).catch(err) }
  $('assetFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) pick(f).catch(err) }
  $('bSaveSrv').onclick = saveServer
  $('bLoadSrv').onclick = () => loadServer(0)
  $('roomVer').onchange = e => loadServer(+e.target.value)
  paintWallet()
}

// ---------- for main.js: registry + surface layers ----------
export const assetMetas = () => [...metas.values()]
export const metasList = () => [...metas.values()].filter(m => m.kind !== 'archive')
/** Rigged asset for the Avatars viewer: a fresh SkeletonUtils clone of the cached template + its clips. */
export async function loadRig(m) { const t = await loadTemplate(m); return { scene: cloneObj(t), animations: templAnims.get(m.id) || [] } }
/** Backfill for rigged GLBs saved before rig meta existed (their model.glb has 0 clips): re-read original.glb, store it as model.glb + rig meta. */
export async function fixRig(m) {
  const u = await signedUrl(m.id, m.original.file); let r; try { r = await fetch(u.url) } catch { r = null }
  if (!r?.ok) r = await fetch(u.proxy); if (!r.ok) throw new Error('HTTP ' + r.status)
  const buf = await r.arrayBuffer(), { scene, animations } = await parse('glb', buf.slice(0))
  const s = m.scale || 1, root = new THREE.Group(); root.add(scene); scene.scale.multiplyScalar(s); scene.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(scene), c = b.getCenter(new THREE.Vector3())
  scene.position.set(scene.position.x - c.x, scene.position.y - b.min.y, scene.position.z - c.z); root.updateMatrixWorld(true)
  const rig = rigInfo(scene, animations, s, measure(root).y)
  if (!rig || !rig.clips.length) throw new Error('No skin + clips in the original')
  if (m.local) throw new Error('Upload it first')
  await put(m.id, 'model.glb', new Blob([buf], { type: 'model/gltf-binary' }), 'GLB', () => {})
  const patch = { ...m, rig, offset: scene.position.toArray().map(v => +v.toFixed(6)), model: { file: 'model.glb', sha256: await sha256(buf) } }
  await call('mysbase-asset-save', patch); Object.assign(m, patch); metas.set(m.id, m); templates.delete(m.id); loading.delete(m.id)
  return m
}
/** Older rigged uploads have no rig meta; probe their original.glb (only the JSON chunk) for skins + animations. */
export async function probeOriginal(m) {
  if (m.sourceFormat !== 'glb' || m.rig || !m.original) return false
  const u = await signedUrl(m.id, m.original.file); let r; try { r = await fetch(u.url) } catch { r = null }
  if (!r?.ok) r = await fetch(u.proxy); if (!r.ok) return false
  const v = new DataView(await r.arrayBuffer()); if (v.getUint32(0, true) !== 0x46546C67) return false
  const len = v.getUint32(12, true), j = JSON.parse(new TextDecoder().decode(new Uint8Array(v.buffer, 20, len)))
  return !!(j.skins?.length && j.animations?.length)
}
const layerSrc = new Map()
/** Load an uploaded asset as a surface layer: {kind:'image', tex, sizeM} or {kind:'model', obj}. Needs sign-in. */
export function layerSource(id) {
  if (layerSrc.has(id)) return layerSrc.get(id)
  const m = metas.get(id); if (!m) return Promise.reject(new Error('asset not loaded (sign in)'))
  const p = (async () => {
    if (m.kind === 'image') {
      const u = await signedUrl(m.id, m.original.file)
      let tex; try { tex = await new THREE.TextureLoader().setCrossOrigin('anonymous').loadAsync(u.url) } catch { tex = await new THREE.TextureLoader().loadAsync(u.proxy) }
      tex.colorSpace = THREE.SRGBColorSpace; return { kind: 'image', tex, sizeM: m.sizeM || [1, 1, 0] }
    }
    return { kind: 'model', obj: await loadTemplate(m) }
  })()
  layerSrc.set(id, p); p.catch(() => layerSrc.delete(id)); return p
}

// ---------- round 3: shared rooms (short codes), starter rooms, public assets ----------
// Plain async functions (no DOM) so other tools (e.g. a future Room Kit) can call them directly.
let me = null // {address, admin}
export async function whoAmI() { if (!me || me.address.toLowerCase() !== account?.toLowerCase()) me = await call('mysbase-me'); return me }
/** Save a layout under a new 6-char code anyone with the app can load (?room=<code>). */
export async function shareLayout(layout, { name, kind, assetIds } = {}) {
  return call('mysbase-share', { layout, name, kind: kind || (layout?.slots ? 'template' : 'room'), assetIds: assetIds || [] })
}
/** Admin only: publish as a starter room at ?room=<slug>. */
export async function saveStarterRoom(slug, layout, { name, assetIds } = {}) {
  return call('mysbase-starter-save', { slug, name, layout, kind: layout?.slots ? 'template' : 'room', assetIds: assetIds || [] })
}
export async function setAssetsPublic(ids, on = true) { const r = await call('mysbase-public', { ids, public: on }); for (const id of ids) { const m = metas.get(id); if (m) m.public = on }; return r }
/** No session needed: a shared room or starter by code/slug (+ its public asset metas, merged so they load). */
export async function loadShared(id) { const r = await pub('mysbase-shared', { id }); addPublicMetas(r.assets); return r }
export async function starterList() { try { return (await pub('mysbase-starters')).starters || [] } catch { return [] } }
export async function sharedList() { return hasSession() ? call('mysbase-shared-list') : { shared: [] } }
export async function serverRoomList() { return hasSession() ? (await call('mysbase-rooms')).rooms || [] : [] }
export async function serverRoom(roomId) { const r = await call('mysbase-room', { roomId }); await ensureAssets(r.layout); return r }
export const signedIn = hasSession
export { refreshAssets }

// ---------- Room Kit building blocks (DOM-free) ----------
/** Show prepared (not yet uploaded) assets in the room via blob: URLs. Replaces any previous preview set. */
export function setLocalAssets(list) {
  for (const m of localMetas.values()) { metas.delete(m.id); templates.delete(m.id); loading.delete(m.id); for (const u of Object.values(m.urls)) URL.revokeObjectURL(u) }
  localMetas.clear()
  for (const p of list || []) { if (p.meta.needsConverter) continue; const m = { ...p.meta, local: true, urls: Object.fromEntries(Object.entries(p.blobs).map(([f, b]) => [f, URL.createObjectURL(b)])) }; localMetas.set(m.id, m); metas.set(m.id, m); app.registerType('asset:' + m.id) }
  app.rebuildAssets(); app.assetsChanged?.()
}
export const localAssets = () => [...localMetas.values()]
export const listFolders = () => [...folders]
/** Upload prepared assets into a folder; an asset with the same name + same file hash already in that folder is reused (not uploaded again). */
export async function uploadKit(list, folder, onRow = () => {}) {
  await refreshAssets()
  await call('mysbase-folder', { op: 'create', name: folder }); if (!folders.includes(folder)) folders.push(folder)
  const out = []
  for (let i = 0; i < list.length; i++) {
    const p = list[i], ex = [...metas.values()].find(m => !m.local && m.folder === folder && m.name.toLowerCase() === p.meta.name.toLowerCase())
    if (ex && ex.original?.sha256 === p.meta.original.sha256) { if (ex.category !== p.meta.category) { await call('mysbase-asset-save', { ...ex, category: p.meta.category, wall: p.meta.category === 'wall-mount' }) } onRow(i, 'already uploaded', 100); out.push(ex.id); continue }
    const meta = { ...p.meta, folder }
    if (ex) { meta.id = ex.id; if (ex.public) meta.public = true } // same name, new file: replace in place so rooms by name keep working
    const m = await uploadPrepared({ meta, blobs: p.blobs }, pc => onRow(i, `uploading ${Math.round(pc)}%`, pc))
    await call('mysbase-asset-save', m); onRow(i, '✅ uploaded', 100); out.push(m.id)
  }
  setLocalAssets([]); await refreshAssets()
  return out
}
/** Save a layout as a server room (versioned). */
export async function saveRoomAs(roomId, layout) { return call('mysbase-room-save', { roomId, layout }) }
/** Bytes of an asset for a kit export: local preview blob, else the uploaded GLB (models) or original (images). */
export async function assetBytes(m) {
  const file = m.kind === 'image' ? m.original.file : m.model ? 'model.glb' : m.original.file
  const u = await signedUrl(m.id, file)
  let r; try { r = await fetch(u.url) } catch { r = null }
  if (!r?.ok) r = await fetch(u.proxy)
  if (!r.ok) throw new Error(`${m.name}: HTTP ${r.status}`)
  return { bytes: new Uint8Array(await r.arrayBuffer()), ext: file === 'model.glb' ? 'glb' : (m.sourceFormat || file.split('.').pop()) }
}
export { MODEL_EXT, IMG_EXT }
/** Connect a wallet if none is connected yet (Room Kit Save). */
export async function ensureWallet() { if (!account) await connect(); if (!account) throw new Error('Connect a wallet first') }
