// Shared by the site and the reveal cron. Mysbase Genesis Key (MagazineKey) on Base.
// Reveal uses blockhash(targetBlock); EIP-2935 keeps it for 8191 blocks. That is a BLOCK count, so the
// time left is measured from real block timestamps (about 4.5 h at 2 s blocks, about 27 min at 0.2 s after Denim).
import { parseAbi } from 'viem'
export const GENESIS_KEY = '0x5b7efe6793d67e4dafe4c014f4efedf74726e964'
export const HISTORY_WINDOW = 8191n
export const KEY_ABI = parseAbi([
  'function paused() view returns (bool)', 'function poolLocked() view returns (bool)', 'function mintPrice() view returns (uint256)',
  'function usdc() view returns (address)', 'function remaining() view returns (uint256)', 'function sealedCount() view returns (uint256)',
  'function pendingReveals(uint256 offset, uint256 limit) view returns (uint256[])', 'function revealReady(uint256) view returns (bool)',
  'function tickets(uint256) view returns (uint64 targetBlock, bool revealed, bytes32 seed)', 'function ownerOf(uint256) view returns (address)',
  'function mint() returns (uint256)', 'function reveal(uint256)', 'function revealBatch(uint256[])',
  'event Sealed(uint256 indexed tokenId, address indexed minter, uint256 targetBlock)',
  'event Revealed(uint256 indexed tokenId, uint256 entryIndex, uint8 rarity, uint8 trait)',
])
export const ERC20_ABI = parseAbi(['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'])

/** Seconds per block from the last `span` blocks' real timestamps (never assumes 2 s). */
export async function blockRate(client, span = 300n) {
  const head = await client.getBlock()
  const from = head.number > span ? head.number - span : 0n
  const old = await client.getBlock({ blockNumber: from })
  const n = Number(head.number - old.number)
  return { head: head.number, secPerBlock: n > 0 && head.timestamp > old.timestamp ? Number(head.timestamp - old.timestamp) / n : 0.2 } // 0.2 s = conservative (post-Denim)
}

/** All sealed ids via the contract's own pendingReveals pager (no getLogs needed). */
export async function pendingIds(client, address = GENESIS_KEY, page = 200n) {
  const n = await client.readContract({ address, abi: KEY_ABI, functionName: 'sealedCount' })
  const ids = []
  for (let o = 0n; o < n; o += page) ids.push(...await client.readContract({ address, abi: KEY_ABI, functionName: 'pendingReveals', args: [o, page] }))
  return ids
}

/** Status of a sealed ticket: waiting (target not mined yet), ready (reveal now), expired (needs operator retarget). */
export function ticketStatus(targetBlock, head, secPerBlock) {
  const t = BigInt(targetBlock), last = t + HISTORY_WINDOW
  if (head <= t) return { state: 'waiting', blocks: Number(t - head + 1n), secs: Number(t - head + 1n) * secPerBlock }
  if (head < last) return { state: 'ready', blocks: Number(last - head), secs: Number(last - head) * secPerBlock }
  return { state: 'expired', blocks: 0, secs: 0 }
}
export const fmtSecs = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${String(x).padStart(2, '0')}s` : `${x}s` }
