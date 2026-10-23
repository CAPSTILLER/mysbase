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
import { uploadPresigned } from '@vercel/blob/client'
import { getAddress } from 'viem'

export const API = (import.meta.env.VITE_MYSBASE_API || 'https://mywally.gearup.wtf').replace(/\/$/, '')
const MAX = 100 * 1024 * 1024
const $ = id => document.getElementById(id)
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
const sha256 = async buf => hex(await crypto.subtle.digest('SHA-256', buf))
const short = a => a.slice(0, 6) + '…' + a.slice(-4)
const UNITS = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 }
const MODEL_EXT = ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'usdz'], IMG_EXT = ['png', 'jpg', 'jpeg', 'webp']

let app // hooks from main.js
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
const metas = new Map(), templates = new Map(), loading = new Map()
export function assetType(type) {
  const id = type.slice(6), m = metas.get(id)
  const size = m?.sizeM || [0.5, 0.5, 0.5]
  return {
    name: m ? m.name : 'Private asset (connect + sign in)', size, allowedPresets: m?.allowedPresets || [], top: size[1], holds: !!m?.holds, wallOnly: !!m?.wall, asset: id,
    build(g) {
      const t = templates.get(id)
      if (t) { g.add(t.clone(true)); return }
      const ph = new THREE.Mesh(new THREE.BoxGeometry(size[0] || 0.5, size[1] || 0.5, size[2] || 0.5), new THREE.MeshStandardMaterial({ color: '#9db4e8', wireframe: true }))
      ph.position.y = (size[1] || 0.5) / 2; g.add(ph)
      if (m) loadTemplate(m).catch(() => {})
    },
  }
}
async function signedUrl(id, file) { return call('mysbase-asset-url', { id, file }) }
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
      obj = (await try2(u => new GLTFLoader().setCrossOrigin('anonymous').loadAsync(u))).scene
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
async function refreshAssets() {
  const box = $('assetList'); box.textContent = 'Loading…'
  try {
    const { assets } = await call('mysbase-assets')
    metas.clear(); for (const a of assets) metas.set(a.id, a)
    for (const a of assets) app.registerType('asset:' + a.id)
    box.innerHTML = assets.length ? '' : '<span class="small">No assets yet.</span>'
    for (const a of assets) {
      const row = document.createElement('div'); row.className = 'row'
      const mb = ((a.model?.bytes || a.original.bytes) / 1048576).toFixed(1)
      const sz = a.sizeM ? a.sizeM.map(v => v.toFixed(2)).join('×') + ' m' : ''
      row.innerHTML = `<b></b><span class="small">${a.kind} · ${a.sourceFormat} · ${mb} MB · ${sz}${a.needsConverter ? ' · needs converter' : ''}</span>`
      row.firstChild.textContent = a.name
      const place = document.createElement('button'); place.textContent = 'Place'; place.disabled = !!a.needsConverter && a.kind !== 'image'
      place.onclick = () => { app.spawn('asset:' + a.id); loadTemplate(a).catch(err) }
      const del = document.createElement('button'); del.textContent = 'Delete'
      del.onclick = async () => { if (!confirm(`Delete "${a.name}" from the server? Rooms using it will show a placeholder.`)) return; try { await call('mysbase-asset-delete', { id: a.id }); app.toast('Deleted'); refreshAssets() } catch (e) { err(e) } }
      row.append(place, del); box.appendChild(row)
    }
    app.rebuildAssets()
  } catch (e) { box.textContent = ''; err(e) }
}
function measure(obj) { const b = new THREE.Box3().setFromObject(obj); return b.getSize(new THREE.Vector3()) }
async function parse(ext, buf) {
  if (ext === 'glb' || ext === 'gltf') return (await new GLTFLoader().parseAsync(ext === 'gltf' ? new TextDecoder().decode(buf) : buf, '')).scene
  if (ext === 'obj') return new OBJLoader().parse(new TextDecoder().decode(buf))
  if (ext === 'fbx') return new FBXLoader().parse(buf, '')
  if (ext === 'usdz') return new USDZLoader().parse(buf)
  const geo = ext === 'stl' ? new STLLoader().parse(buf) : new PLYLoader().parse(buf)
  geo.computeVertexNormals()
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: geo.hasAttribute('color') ? '#fff' : '#b8b0a4', vertexColors: geo.hasAttribute('color'), roughness: 0.8 }))
}
function form(html) { const f = $('assetForm'); f.innerHTML = html; f.classList.remove('hidden'); return f }
function closeForm() { const f = $('assetForm'); f.innerHTML = ''; f.classList.add('hidden') }
async function put(id, file, blob, label) {
  const t = await session()
  await uploadPresigned(`mysbase/assets/${id}/${file}`, blob, {
    access: 'private', handleUploadUrl: API + '/api/rocks/mysbase-upload', headers: { 'x-mysbase-session': t },
    multipart: blob.size > 8 * 1024 * 1024, contentType: blob.type || 'application/octet-stream',
    onUploadProgress: p => { $('assetProg').value = p.percentage; $('assetProgT').textContent = `${label} ${Math.round(p.percentage)}%` },
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
      <div class="row"><span>Width</span><input id="afW" type="number" step="0.01" min="0.05" value="0.8"> m (hangs on walls)</div>
      <div class="row"><button id="afGo">Upload</button><button id="afX">Cancel</button></div>`)
    fm.querySelector('#afName').value = name; fm.querySelector('#afX').onclick = closeForm
    fm.querySelector('#afGo').onclick = () => run(async () => {
      const w = +fm.querySelector('#afW').value || 0.8
      await put(id, origFile, new Blob([buf], { type: f.type || 'image/' + ext }), 'Image')
      return { id, name: fm.querySelector('#afName').value || name, kind: 'image', sourceFormat: ext, original: { file: origFile, sha256: await sha256(buf) }, sizeM: [w, +(w * aspect).toFixed(3), 0.02], wall: true }
    })
    return
  }
  let obj = null, why = ''
  try { obj = await parse(ext, buf.slice(0)) } catch (e) { why = e?.message || 'could not read' }
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
    <div class="row"><label class="small"><input type="checkbox" id="afHolds"> things can stand on it</label><label class="small"><input type="checkbox" id="afWall"> wall-mounted</label><label class="small"><input type="checkbox" id="afTab" checked> allow Tabletop preset</label></div>
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
    try { glb = await new GLTFExporter().parseAsync(root, { binary: true }) } catch (e) { console.warn(e) }
    const originalSha = await sha256(buf)
    await put(id, origFile, new Blob([buf], { type: 'application/octet-stream' }), 'Original')
    const meta = { id, name: q('#afName').value || name, kind: 'model', sourceFormat: ext, original: { file: origFile, sha256: originalSha },
      sizeM: [sz.x, sz.y, sz.z].map(v => +v.toFixed(4)), unit: q('#afH').value ? 'custom' : q('#afU').value, scale: s,
      holds: q('#afHolds').checked, wall: q('#afWall').checked, allowedPresets: q('#afTab').checked ? ['Tabletop'] : [] }
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
    if (r.layout.items?.some(i => String(i.type).startsWith('asset:')) && !metas.size) await refreshAssets()
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
  $('assetFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) pick(f).catch(err) }
  $('bSaveSrv').onclick = saveServer
  $('bLoadSrv').onclick = () => loadServer(0)
  $('roomVer').onchange = e => loadServer(+e.target.value)
  paintWallet()
}
