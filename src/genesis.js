// Genesis Key panel: mint (USDC) -> "Reveal your key" step with a live window countdown.
// Connecting stays read-only; the wallet only signs for approve / mint / reveal.
import { createPublicClient, createWalletClient, custom, http, parseEventLogs, formatUnits } from 'viem'
import { base } from 'viem/chains'
import * as cloud from './cloud.js'
import { GENESIS_KEY, KEY_ABI, ERC20_ABI, blockRate, pendingIds, ticketStatus, fmtSecs } from './lib/genesisKey.js'

const $ = id => document.getElementById(id)
const KEY = (import.meta.env.VITE_GENESIS_KEY || GENESIS_KEY)
const RPC = import.meta.env.VITE_BASE_RPC || 'https://mainnet.base.org'
const pc = createPublicClient({ chain: base, transport: http(RPC) })
let app, rate = { head: 0n, secPerBlock: 2 }, mine = [], info = null, busy = '', timer = null, lastMsg = ''

async function walletClient() {
  await cloud.ensureWallet(); const { provider, account } = cloud.wallet()
  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }) } catch {}
  return { wc: createWalletClient({ chain: base, transport: custom(provider), account }), account }
}

async function refresh() {
  const { account } = cloud.wallet()
  const [paused, locked, price, left, usdc] = await Promise.all(['paused', 'poolLocked', 'mintPrice', 'remaining', 'usdc'].map(f => pc.readContract({ address: KEY, abi: KEY_ABI, functionName: f })))
  info = { paused, locked, price, left, usdc }
  rate = { ...await blockRate(pc), at: Date.now() }
  mine = []
  if (account) {
    for (const id of await pendingIds(pc, KEY)) {
      const owner = await pc.readContract({ address: KEY, abi: KEY_ABI, functionName: 'ownerOf', args: [id] })
      if (owner.toLowerCase() !== account.toLowerCase()) continue
      const [targetBlock] = await pc.readContract({ address: KEY, abi: KEY_ABI, functionName: 'tickets', args: [id] })
      mine.push({ id, targetBlock: BigInt(targetBlock) })
    }
  }
  paint(); badge()
}

function badge() { const b = $('bKey'); if (b) { b.textContent = mine.length ? `🔑 Reveal your key (${mine.length})` : '🔑 Genesis Key'; b.classList.toggle('on', !!mine.length) } }

function status(k) {
  const head = rate.head + BigInt(Math.floor((Date.now() - rate.at) / 1000 / rate.secPerBlock))
  const s = ticketStatus(k.targetBlock, head, rate.secPerBlock)
  const msg = s.state === 'waiting' ? `Sealed. Ready to reveal in about ${fmtSecs(s.secs)}…`
    : s.state === 'ready' ? `<b>Reveal window: ${fmtSecs(s.secs)} left</b> (${s.blocks.toLocaleString()} blocks)`
      : 'The reveal window passed. Nothing is lost: Cap can give it a new reveal block, then you can reveal.'
  return { s, msg }
}
function row(k) {
  const { s, msg } = status(k)
  const btn = `<button class="kReveal" data-id="${k.id}" ${s.state !== 'ready' || busy ? 'disabled' : ''} ${s.state === 'expired' ? 'hidden' : ''}>${busy === String(k.id) ? 'Confirm in wallet…' : 'Reveal now'}</button>`
  return `<div class="kCard ${s.state}" data-id="${k.id}"><div><b>Key #${k.id}</b></div><div class="small kMsg">${msg}</div>${btn}</div>`
}
/** 1 s tick: update countdown text in place (no re-render, so taps never miss). */
function tick() {
  for (const k of mine) {
    const card = document.querySelector(`.kCard[data-id="${k.id}"]`); if (!card) continue
    const { s, msg } = status(k), b = card.querySelector('.kReveal')
    card.className = 'kCard ' + s.state; card.querySelector('.kMsg').innerHTML = msg
    b.disabled = s.state !== 'ready' || !!busy; b.hidden = s.state === 'expired'
  }
}

function paint() {
  const el = $('keyBody'); if (!el || !info) return
  const { account } = cloud.wallet()
  const price = formatUnits(info.price, 6)
  const canMint = !info.paused && info.locked && info.left > 0n
  el.innerHTML = `
    ${mine.length ? `<h3>Reveal your key</h3><p class="small">Revealing picks your key's rarity and room. It's one small transaction. Reveal before the timer runs out.</p>${mine.map(row).join('')}` : ''}
    <h3>Mint a Genesis Key</h3>
    <p class="small">${price} USDC. Your key arrives sealed and is ready to reveal a few seconds later. Block speed now: ${rate.secPerBlock.toFixed(2)} s per block.</p>
    <button id="kMint" ${!canMint || busy ? 'disabled' : ''}>${busy === 'mint' ? 'Confirm in wallet…' : info.paused ? 'Mint opens soon (paused)' : !info.locked ? 'Mint opens soon' : info.left === 0n ? 'Sold out' : account ? `Mint for ${price} USDC` : `Mint for ${price} USDC`}</button>
    ${lastMsg ? `<p class="small">${lastMsg}</p>` : ''}
    ${account ? '' : '<p><button id="kConnect">Connect wallet (read-only)</button></p><p class="small">Connecting is read-only. Sealed keys you own show up here.</p>'}`
  $('kMint').onclick = () => mint().catch(fail)
  if ($('kConnect')) $('kConnect').onclick = () => cloud.ensureWallet().catch(fail)
  el.querySelectorAll('.kReveal').forEach(b => b.onclick = () => reveal(BigInt(b.dataset.id)).catch(fail))
}
const fail = e => { busy = ''; lastMsg = '⚠️ ' + (e.shortMessage || e.message || e); paint() }

async function mint() {
  const { wc, account } = await walletClient()
  busy = 'mint'; lastMsg = ''; paint()
  const allow = await pc.readContract({ address: info.usdc, abi: ERC20_ABI, functionName: 'allowance', args: [account, KEY] })
  if (allow < info.price) {
    lastMsg = 'Step 1 of 2: approve USDC'; paint()
    const h = await wc.writeContract({ address: info.usdc, abi: ERC20_ABI, functionName: 'approve', args: [KEY, info.price] })
    await pc.waitForTransactionReceipt({ hash: h })
  }
  lastMsg = 'Mint: confirm in wallet'; paint()
  const h = await wc.writeContract({ address: KEY, abi: KEY_ABI, functionName: 'mint' })
  const rc = await pc.waitForTransactionReceipt({ hash: h })
  const ev = parseEventLogs({ abi: KEY_ABI, logs: rc.logs, eventName: 'Sealed' })[0]
  busy = ''; lastMsg = ev ? `✅ Minted key #${ev.args.tokenId}. Next step: reveal it above.` : '✅ Minted.'
  await refresh()
}

async function reveal(id) {
  const { wc } = await walletClient()
  busy = String(id); paint()
  const h = await wc.writeContract({ address: KEY, abi: KEY_ABI, functionName: 'reveal', args: [id] })
  const rc = await pc.waitForTransactionReceipt({ hash: h })
  const ev = parseEventLogs({ abi: KEY_ABI, logs: rc.logs, eventName: 'Revealed' })[0]
  const R = ['Common', 'Uncommon', 'Rare', 'Mythic']
  busy = ''; lastMsg = ev ? `🎉 Key #${id} revealed: ${R[ev.args.rarity] || 'rarity ' + ev.args.rarity}, trait ${ev.args.trait}.` : `✅ Key #${id} revealed.`
  await refresh()
}

async function open() { $('keyPanel').classList.remove('hidden'); $('keyBody').innerHTML = '<p class="small">Loading…</p>'; await load() }
async function load() { try { await refresh() } catch (e) { fail(e) } paint() }

export function initGenesis(a) {
  app = a; rate.at = Date.now()
  $('bKey').onclick = () => open()
  $('keyClose').onclick = () => $('keyPanel').classList.add('hidden')
  // a wallet with sealed keys gets the Reveal step on every visit
  addEventListener('mysbase:wallet', async e => { if (!e.detail) { mine = []; badge(); return } await load(); if (mine.length) $('keyPanel').classList.remove('hidden') })
  timer = setInterval(() => { if (!$('keyPanel').classList.contains('hidden') && mine.length) tick() }, 1000)
  setInterval(() => { if (mine.length && !busy) load() }, 30000)
}
