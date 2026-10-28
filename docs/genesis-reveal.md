# Genesis Key reveal (keeps every key inside the 8,191-block window)

- Site: 🔑 Genesis Key panel. After mint it shows **Reveal your key** with a live countdown. Time left is measured from real Base block timestamps, never an assumed 2 s. Any sealed key the connected wallet owns shows a **Reveal now** button on every visit. The wallet only signs for approve / mint / reveal.
- Window: the reveal needs blockhash(mint block + 2), kept 8,191 blocks (about 4.5 h at 2 s blocks, about 27 min after Base Denim's 200 ms blocks). After that only the operator (owner Ledger or CAPs Mind key holder) can `retarget`.
- Backstop: `api/cron/reveal.js` calls the permissionless `revealBatch` for every ready key (finds them with the contract's `pendingReveals` view, no log scanning). OFF unless env is set:
  - `REVEALER_PRIVATE_KEY` (Sensitive): a NEW, dedicated hot wallet holding only a little Base ETH for gas. Never the Ledger, never Bankr.
  - `CRON_SECRET` (Sensitive, recommended): random string; Vercel Cron sends it automatically.
  - optional `BASE_RPC_URL` (Sensitive if it holds an API key).
- Schedule: vercel.json runs it daily (the Hobby limit). That is NOT enough for a 27 min window. Use Vercel Pro and change the schedule to `*/5 * * * *`, or point a free pinger (e.g. cron-job.org) at `https://mysbase.gearup.wtf/api/cron/reveal` every 5 min with header `Authorization: Bearer <CRON_SECRET>`.
- The response lists `expiredNeedRetarget`: those need an operator `retarget([ids])`, then the next run reveals them.
