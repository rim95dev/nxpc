# Data pipeline

Where every number on the page comes from, what validates it, and what happens
when a read fails.

## RPC — public endpoints only

Two, and they do different jobs. **Every supply figure comes from Henesys alone.**
The Avalanche endpoint exists for the address tab, so a C-Chain row can show a
balance instead of a dash; if it is unreachable, those cells stay empty and
nothing else on the site changes.

| | Henesys | Avalanche C-Chain |
|---|---|---|
| Endpoint | `https://henesys-rpc.msu.io` | `https://api.avax.network/ext/bc/C/rpc` |
| Chain id | `68414` (`0x10b3e`) | `43114` |
| Multicall3 | `0x99423C88EB5723A590b4C644426069042f137B9e` | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Used for | supply figures, Henesys balances | C-Chain balances on the address tab |
| Batch limit | 10 | 40 (documented) |

`api.avax.network` is Ava Labs' own public API node. Checked 2026-09-02: it runs
avalanchego v1.14.2, carries Multicall3 at the canonical address, and its CORS
preflight reflects the caller's origin, so the browser can read it directly.
Neither batch limit is ever reached — a multicall is one `eth_call`.

**Measured 2026-08-25** — these numbers are encoded in the code.

| Item | Measurement |
|---|---|
| Mean block time | 2.08s (~41,500 blocks/day) |
| JSON-RPC batch limit | **10**. From 11 the node returns HTTP 500 with a plaintext `too many requests` |
| Multicall3 `aggregate3` | 100 items 0.72s / 200 items 1.28s / 400 items 3.63s — each a **single** `eth_call` |

The number of wallets does not change the request count. The batch limit of 10
does not apply to a multicall.

The node also serves archive reads: `eth_getBalance` at historical blocks works
back to genesis. The backfill depends on that.

## Three layers

```
Build time (GitHub Actions)   ← what the page says without JavaScript
  one Multicall3 read of the current state → baked into the HTML,
  and written to src/data/snapshots/YYYY-MM-DD.json

Browser (~31KB)               ← what the page says once JavaScript runs
  Supply tab:  one aggregate3 on Henesys — every balance plus
               getBlockNumber and getCurrentBlockTimestamp. Folded through
               the same fold() and written over the baked figures.
  Address tab: the same, plus a second aggregate3 on C-Chain for the
               NXPC balances there. The two are independent.
  Any failure leaves the baked figures untouched.
  Then a bare eth_blockNumber every 30s for the freshness pill.
  Nothing is read while the tab is hidden.

Git history                   ← the time-series database
  RPC cannot hand you the past. One commit is one data point.
```

### The live read

`src/lib/live.ts` and `liveSpec()` in `src/lib/reads.ts`.

The calldata is identical for every visitor, so it is encoded once at build time
and shipped as a string; the client posts it and decodes the response by hand.
Decoding `(bool, bytes)[]` is about forty lines of offset walking, which is worth
it — pulling viem in for one fixed-shape response took the client bundle from
25 KB to 207 KB.

`fold()` had the same problem: it imports the registry, which means zod and a
YAML parser. The arithmetic now lives in `src/lib/fold.ts` and takes its
configuration as plain data, which the server ships next to the page. Both the
build and the browser call the same `foldWith()`, so a live figure cannot be
derived by a different formula than a baked one.

**It fails closed.** A transport error, an RPC error, a short response or a
single failed entry all abort the update. A partial read is the dangerous case:
a missing balance reads as zero and *inflates* circulating supply, which looks
plausible and is wrong.

Measured 2026-09-02: 30 wallets, 7 KB of calldata, 9.5 KB back, 215 ms median.
Because everything rides in one `aggregate3`, the registry can grow without the
request count moving.

Native balances go through Multicall3's own `getEthBalance` — NXPC has no
contract, so the call targets Multicall3 and reads `addr.balance` from EVM state.
Verified against `eth_getBalance` at a pinned block: identical.

## The supply series — three sources

| Range | Source | Written by |
|---|---|---|
| Past | `src/data/history.csv` | `scripts/backfill.mjs`, run by hand |
| Present | Weekly cron, Thursday 00:00 UTC | GitHub Actions |
| Future | `src/data/snapshots/*.json` | the same cron |

Only the weekly run adds a point. The three-hourly run rebuilds the page and
stores nothing — collecting eight points a day would bury the trend in noise
without telling anyone anything the weekly grid does not.

**Both sources store inputs and derive circulating supply.** Letting a file
state circulating supply directly allows it to disagree with the equation at the
top of the page, and then the graph lies. Past and present run through the same
`fold()`, which is what makes the line continuous.

When a date exists in both, the **snapshot wins** — a value read on-chain beats
one filled in by hand.

The chart draws the two ranges differently: uploaded range dashed, collected
range solid, a vertical dashed rule at the boundary. The key underneath gives the
day count of each range, and a gap between the two is reported as a warning.

### Backfill — `scripts/backfill.mjs`

Reconstructs history from the archive node.

- Date → block by binary search on block timestamps. The block interval is not
  constant: 2025-05-15 is block 69,737 and 2026-09-01 is block 19.4M, so
  interpolating from an average lands in the wrong week.
- `eth_getBalance` at that block for every registry address, batched at 10.
- A coverage guard (`--min-coverage`) refuses to write a row where the registry
  fails to account for enough of the supply.

Coverage before 2025-10-30 was 24.5% until seven historical wallets were added
to the registry — genesis holdings sat in contracts that were later migrated.
The changeover is at block 6,682,141 (2025-10-30 09:47 UTC), where coverage
jumps to 99.8%.

### Collector — `scripts/collect.mjs`

Writes one snapshot per run and refuses to write a bad one.

```bash
npm run collect -- --dry-run     # read and print, write nothing
npm run collect -- --audit       # check every stored snapshot against the registry
npm run collect -- --date=…      # write a specific date
npm run collect -- --force       # write despite a failed check
```

It is deliberately separate from the build. When the build wrote snapshots as a
side effect of rendering, a local `npm run build` would overwrite that day's
record, a partial read would still be stored, and a rendering error meant no data
at all. Collection now fails closed: if a check fails, **nothing is written**.

Checks: any failed read, any registry item without a value, the equation staying
inside its bounds, the sum of held balances not exceeding total issued, and a
day-over-day move within `--max-drift` (5% by default).

`--audit` exists because changing the registry silently invalidates older
snapshots: a key that no longer matches reads as zero, and that date alone spikes
on the graph. Four snapshots were deleted after exactly that happened.

### History file format — `src/data/history.csv`

```csv
date,total_issued,burned,non_circulating,bridged,block
2025-07-19,1000000000,3100000,810877030,21145798,2562000
```

| Column | Required | Description |
|---|---|---|
| `date` | ✅ | `YYYY-MM-DD`, ascending, no duplicates |
| `total_issued` | ✅ | Total issued at that point (NXPC) |
| `burned` | ✅ | Cumulative burned at that point |
| `non_circulating` | ✅ | Sum of registry wallet balances at that point |
| `bridged` | ✅ | Amount locked for the C-Chain bridge at that point |
| `block` | — | Block height. Leave empty if unknown |

There is **no circulating column**. It is derived as
`total_issued − burned − non_circulating`.

Lines starting with `#` are comments. A `# placeholder` line at the top marks the
file as stand-in data and puts a banner on the page — delete that line when the
data is real.

Validated at build time. All of the following fail the build:

| Mistake | Result |
|---|---|
| Malformed date | `history.csv row 402 failed validation: date — must be YYYY-MM-DD` |
| burned + non-circulating > total issued | `row — burned + non-circulating exceeds total issued` |
| bridged > circulating | `row — bridged exceeds circulating supply` |
| Negative value | `burned — …` |
| Column count mismatch | `row 402: column count differs from the header (5 ≠ 6)` |
| Duplicate date | `history.csv contains 2026-08-23 twice` |
| Missing required column | `header has no 'non_circulating' column` |

### The wallet registry is schema-checked

`src/data/wallets.yaml` is validated by Zod at build time. All of these fail the
build:

| Mistake | Result |
|---|---|
| 39-character address | `wallets.yaml[0.address] — not a valid 20-byte address` |
| `strictCirculating` missing | `wallets.yaml[0.strictCirculating] — expected boolean, received undefined` |
| Misspelled `tier` | `wallets.yaml[2.tier] — Invalid option: expected one of …` |
| Duplicate `id` | `wallets.yaml[] — duplicate id` |
| `share` without `shareSource` | `share needs a shareSource` |
| Shares of one address not summing to 1 | `shares of the same address must add up to 1` |

The point is to stop a wrong address reaching a disclosure page before it is
deployed.

Two fields decide how a wallet is counted, and they are not the same thing:

- `tier` decides the **policy** figure. Three tiers are subtracted —
  `burn`, `locked`, `vesting`: burn, the undistributed reward pool, and the
  allocations still behind a cliff (IP MG, team, advisors). That is the set the
  published circulating supply figure is built on, so this page reports the same
  number rather than a private variant of it. The Fusion reserve
  (NXPCRecycleVault) is **not** deducted: NXPC enters it through Fission and
  leaves through Fusion, and nothing holds it there.

  Burned is the `0x…dEaD` balance alone. The 6 NXPC at `0x000…0` is not an
  official burn address and counts as circulating.
- `strictCirculating` decides the **stricter** figure, which additionally
  removes anything still under issuer control. It has no default, so every entry
  has to state it.

### Adding a read

One line in the `READS` array in `src/lib/reads.ts` produces both the multicall
calldata and the screen item.

```ts
{ key: 'mse-supply', kind: 'call', address: MSE, abi: ERC721_ABI, fn: 'totalSupply' }
```

Mixing ERC-20 and ERC-721 is safe — `allowFailure` in `aggregate3` isolates each
item. Asking an ERC-721 for `decimals()` fails that item only.

> **Trap**: `eth_call` against an address with no code does not revert. The EVM
> returns **success with empty returndata**. Decoding on the success flag alone
> turns a typo'd address into a silent "balance 0" on the page. viem treats empty
> data as a decode failure, so it lands in `failures` instead.

### Managed address registry — `src/data/addresses.yaml`

This file has a different job from the supply registry (`wallets.yaml`). That
one is the record of **what gets subtracted from circulating supply**; this one
is the list of **what we hold**.

| Field | Required | Value |
|---|---|---|
| `id` | ✅ | Unique key |
| `type` | ✅ | `contract` \| `eoa` |
| `category` | ✅ | `bridge` \| `vault` \| `treasury` \| `ops` \| `token` \| `infra` |
| `chain` | ✅ | `henesys` \| `c-chain` |
| `label` / `owner` | ✅ | Noun phrase per locale, `{ en }` |
| `address` | ✅ | 20-byte hex |
| `standard` | — | `erc20` \| `erc721` — when present, name/symbol/totalSupply are read too |
| `balanceHint` | — | Stand-in balance, used only while the file is marked `# placeholder` |

Zod validates it at build time. Duplicate ids, duplicate addresses, malformed
addresses and a `standard` attached to an EOA all fail the build.

**A balance means a different call on each chain.** On Henesys, NXPC is the native
gas token, so it is `getEthBalance`. On C-Chain it is an ERC-20, so it is
`balanceOf` on `0x5E0E…fb59` — reading the account balance there would put AVAX in
a column headed NXPC.

Each chain is one `aggregate3`, and the two are fired independently: one endpoint
being unreachable costs that chain's balances and nothing else. Native balances and
ERC-20/721 metadata ride in the same call, and `allowFailure` isolates each item, so
a contract that does not answer `totalSupply` only loses that one field.

**To switch to real data**: fill in the addresses and delete the `# placeholder`
line at the top of the file. `balanceHint` is then ignored and balances are read
on-chain.
