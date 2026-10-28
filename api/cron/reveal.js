// Backstop keeper: reveals every ready Genesis Key so nobody misses the 8191-block window
// (about 27 min after Base Denim). reveal/revealBatch are permissionless; the keeper only pays gas.
// OFF unless REVEALER_PRIVATE_KEY is set (Vercel env, Sensitive, a dedicated low-value hot wallet).
// Optional CRON_SECRET: callers must send "Authorization: Bearer <CRON_SECRET>" (Vercel Cron does this).
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { GENESIS_KEY, KEY_ABI, pendingIds, blockRate, ticketStatus } from '../../src/lib/genesisKey.js'

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' })
  const pk = process.env.REVEALER_PRIVATE_KEY
  if (!pk) return res.status(200).json({ disabled: true, note: 'Set REVEALER_PRIVATE_KEY to enable' })
  try {
    const address = process.env.GENESIS_KEY_ADDRESS || GENESIS_KEY
    const transport = http(process.env.BASE_RPC_URL || 'https://mainnet.base.org')
    const pc = createPublicClient({ chain: base, transport })
    const account = privateKeyToAccount(pk.startsWith('0x') ? pk : '0x' + pk)
    const wc = createWalletClient({ chain: base, transport, account })
    const ids = await pendingIds(pc, address)
    const { head, secPerBlock } = await blockRate(pc)
    const ready = [], waiting = [], expired = []
    for (const id of ids) {
      const [tb] = await pc.readContract({ address, abi: KEY_ABI, functionName: 'tickets', args: [id] })
      const s = ticketStatus(tb, head, secPerBlock)
      ;(s.state === 'ready' ? ready : s.state === 'waiting' ? waiting : expired).push(id)
    }
    const txs = []
    for (let i = 0; i < ready.length; i += 40) {
      const chunk = ready.slice(i, i + 40)
      const hash = await wc.writeContract({ address, abi: KEY_ABI, functionName: 'revealBatch', args: [chunk] })
      await pc.waitForTransactionReceipt({ hash }); txs.push(hash)
    }
    return res.status(200).json({ keeper: account.address, head: String(head), secPerBlock, revealed: ready.map(String), waiting: waiting.map(String), expiredNeedRetarget: expired.map(String), txs })
  } catch (e) {
    return res.status(500).json({ error: e.shortMessage || e.message })
  }
}
