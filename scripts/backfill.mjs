#!/usr/bin/env node
/**
 * Backfill of historical circulating supply.
 *
 * The Henesys public RPC is an archive node, so balances at past blocks can be
 * read as they were. For each date we find the block at that moment, query the
 * balances of the registry wallets, and fill src/data/history.csv.
 *
 *   npm run backfill -- [options]
 *
 *   --from=2025-05-15   start date (default 2025-05-15)
 *   --to=YYYY-MM-DD     end date (default: yesterday UTC)
 *   --every=7           interval in days. Default 7
 *   --out=path          default src/data/history.csv
 *   --dry-run           print the table only, write no file
 *   --limit=N           only the first N (for trial runs)
 *   --min-coverage=98   what % of total issued the registry must explain to record a row
 *
 * ── How we read ────────────────────────────────────────────────────
 * Multicall3 is not deployed at early block heights (no code there through 2025-09) and
 * block intervals are not uniform either. So
 *   · date→block is found by binary search over timestamps
 *   · balances are fetched with batched eth_getBalance instead of Multicall3.
 * The public RPC refuses batches from 11 entries up, so we cut them into 10.
 *
 * ── What we keep ──────────────────────────────────────────────────
 * history.csv does not store circulating supply. It keeps only total issued ·
 * burned · non-circulating · bridged, and the page derives circulating supply
 * from the formula. A stored value can drift from the formula at the top of the
 * screen, and then the graph lies.
 *
 * ── Coverage guard ────────────────────────────────────────────────
 * Wallet classification is **today's registry**. If a wallet was non-circulating
 * back then but is missing from the list now, circulating supply is inflated by
 * that much — and silently.
 *
 * So at each point in time we also measure «what % of total issued does the
 * registry explain» and drop the row if it falls short of the threshold. As
 * measured on chain:
 *   · before block 6,682,141 (2025-10-30 09:47 UTC)  coverage 24.5%
 *   · after that                                     coverage 99.8%
 * The genesis supply moved to today's contracts on that day. Those 24.5% were
 * measured before the wallets that held it were in the registry; the «Legacy
 * wallets» section of wallets.yaml adds them, and the early range now reads at
 * 99.7% or better. Removing those entries takes the early rows back to 24.5%.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { WALLETS, POLICY_TIERS } = await vite.ssrLoadModule('/src/lib/wallets.ts');
const { TOTAL_ISSUED } = await vite.ssrLoadModule('/src/lib/model.ts');
const { RPC_URL, MAX_RPC_BATCH } = await vite.ssrLoadModule('/src/lib/chain.ts');

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

const FROM = arg('from', '2025-05-15');
const TO = arg('to', new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
const EVERY = Number(arg('every', '7'));
const OUT = join(process.cwd(), arg('out', 'src/data/history.csv'));
const DRY = flag('dry-run');
const LIMIT = Number(arg('limit', '0'));
const MIN_COV = Number(arg('min-coverage', '98'));

const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** JSON-RPC batch. The public RPC spits a plain-text 500 from 11 entries up, so we cut into 10. */
let calls = 0;
async function rpc(batch) {
  const out = [];
  for (let i = 0; i < batch.length; i += MAX_RPC_BATCH) {
    const part = batch.slice(i, i + MAX_RPC_BATCH).map((b, k) => ({ jsonrpc: '2.0', id: i + k, ...b }));
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(part),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      throw new Error(`RPC response is not JSON (${res.status}): ${text.slice(0, 120)}`);
    }
    if (!Array.isArray(json)) throw new Error(`Batch response is not an array: ${JSON.stringify(json).slice(0, 120)}`);
    out.push(...json.sort((a, b) => a.id - b.id));
    calls += part.length;
  }
  return out;
}

const hex = (n) => `0x${n.toString(16)}`;

async function blockTs(n) {
  const [r] = await rpc([{ method: 'eth_getBlockByNumber', params: [hex(n), false] }]);
  return r.result ? Number(r.result.timestamp) : null;
}

/**
 * The last block before 00:00 UTC on that date.
 * Block intervals are not uniform (the early range is far slower), so an arithmetic estimate misses badly.
 */
async function blockAt(dateStr, lo, hi) {
  const target = Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 1000);
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const ts = await blockTs(mid);
    if (ts === null) { hi = mid - 1; continue; }
    if (ts <= target) { best = { n: mid, ts }; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** Balances of the registry wallets at that block (NXPC). */
async function balancesAt(block) {
  const readable = WALLETS.filter((w) => w.address);
  const res = await rpc(
    readable.map((w) => ({ method: 'eth_getBalance', params: [w.address, hex(block)] })),
  );
  const out = {};
  res.forEach((r, i) => {
    if (r.error) throw new Error(`${readable[i].id} lookup failed: ${r.error.message}`);
    out[readable[i].id] = Number(BigInt(r.result)) / 1e18;
  });
  // Aggregate entries that do not publish an address get no history column, so they are skipped
  return out;
}

/** The three values history.csv holds + coverage. Circulating supply is not stored. */
function rowOf(bal) {
  const sum = (tiers) =>
    WALLETS.filter((w) => tiers.includes(w.tier))
      .reduce((n, w) => n + (bal[w.id] ?? 0) * (w.share ?? 1), 0);
  /* Entries split by share must be multiplied in, or the same address gets counted twice. */
  const held = WALLETS.reduce((n, w) => n + (bal[w.id] ?? 0) * (w.share ?? 1), 0);
  return {
    burned: sum(['burn']),
    // What the policy subtracts, minus burn — locked + vesting + Fusion reserve
    non_circulating: sum(POLICY_TIERS.filter((t) => t !== 'burn')),
    bridged: sum(['bridge']),
    coverage: held / TOTAL_ISSUED,
  };
}

function* dates(from, to, step) {
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += step * 86_400_000) {
    yield new Date(t).toISOString().slice(0, 10);
  }
}

const HEADER = `# NXPC historical circulating supply — scripts/backfill.mjs pulled this from on-chain.
#
# This file is validated at build time. A wrong format fails the build.
# There is no circulating supply column — it is derived as total issued − burned − non-circulating.
# Using a stored value can drift from the formula at the top of the page, and then the graph lies.
#
#   date             YYYY-MM-DD (the block just before 00:00 UTC on that day)
#   total_issued     total issued (constant, 1 billion)
#   burned           cumulative burned
#   non_circulating  reward pool + cliff-locked allocations (IP MG, team, advisors)
#   bridged          amount deposited in the C-Chain bridge
#   block            block height at that point
#
# The classification applies today's registry (src/data/wallets.yaml) to past state.
# If a snapshot has the same date, the measured value (the snapshot) wins.
date,total_issued,burned,non_circulating,bridged,block
`;

async function main() {
  const head = Number((await rpc([{ method: 'eth_blockNumber', params: [] }]))[0].result);
  const list = [...dates(FROM, TO, EVERY)];
  const todo = LIMIT ? list.slice(0, LIMIT) : list;
  console.log(`${FROM} → ${TO} · every ${EVERY} days · ${todo.length} points`);
  console.log(`current block #${fmt(head)} · ${WALLETS.filter((w) => w.address).length} wallets\n`);

  const rows = [];
  const skipped = [];
  let lo = 1;                       // dates ascend, so the search lower bound carries over
  for (const [i, date] of todo.entries()) {
    const b = await blockAt(date, lo, head);
    if (!b) { console.log(`  ${date}  before the chain started — skipped`); continue; }
    lo = b.n;
    const bal = await balancesAt(b.n);
    const r = rowOf(bal);
    const circ = TOTAL_ISSUED - r.burned - r.non_circulating;
    const thin = r.coverage * 100 < MIN_COV;
    if (!thin) rows.push({ date, block: b.n, ...r, circ });
    else skipped.push({ date, coverage: r.coverage });
    console.log(
      `  ${date}  #${String(fmt(b.n)).padStart(12)}  ` +
      `burned ${fmt(r.burned).padStart(11)}  non-circ ${fmt(r.non_circulating).padStart(13)}  ` +
      `bridged ${fmt(r.bridged).padStart(12)}  → circulating ${fmt(circ).padStart(13)}  ` +
      `coverage ${(r.coverage * 100).toFixed(1).padStart(5)}%${thin ? '  ← dropped' : ''}`,
    );
    if ((i + 1) % 10 === 0) console.log(`     … ${i + 1}/${todo.length} · ${calls} RPC calls`);
  }

  if (skipped.length) {
    console.log(
      `\n${skipped.length} points dropped for coverage under ${MIN_COV}%` +
      ` (${skipped[0].date} ~ ${skipped.at(-1).date}).` +
      `\nThat range is not explained by today's wallet list — filling it needs the list as it was then.`,
    );
  }
  if (!rows.length) {
    console.error('\nNo rows to record.');
    process.exitCode = 1;
    return;
  }

  // Validation — catch rows the schema would reject up front
  const bad = rows.filter(
    (r) => r.burned + r.non_circulating > TOTAL_ISSUED || r.bridged > r.circ,
  );
  if (bad.length) {
    console.error(`\nValidation failed on ${bad.length} rows:`);
    for (const r of bad.slice(0, 5)) console.error(`  · ${r.date}`);
    process.exitCode = 1;
    return;
  }

  const csv = HEADER + rows
    .map((r) => `${r.date},${TOTAL_ISSUED},${Math.round(r.burned)},${Math.round(r.non_circulating)},${Math.round(r.bridged)},${r.block}`)
    .join('\n') + '\n';

  console.log(`\n${rows.length} rows · ${calls} RPC calls`);
  if (DRY) { console.log('--dry-run — no file was written.'); return; }
  if (existsSync(OUT)) writeFileSync(`${OUT}.bak`, readFileSync(OUT));
  writeFileSync(OUT, csv, 'utf8');
  console.log(`wrote: ${OUT}${existsSync(`${OUT}.bak`) ? ` (previous file at ${OUT}.bak)` : ''}`);
}

await main();
await vite.close();
