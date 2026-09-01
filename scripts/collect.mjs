#!/usr/bin/env node
/**
 * Circulating supply snapshot collector.
 *
 * Writes one point per day to src/data/snapshots/YYYY-MM-DD.json. Those files are
 * the circulating supply time series, and the commit history is its DB.
 *
 * There is a reason this is kept out of the page build. The build used to write the
 * snapshot in the middle of rendering, and then
 *   · just running `npm run build` locally overwrote that day's record,
 *   · a partly failed read was recorded as-is and the supply quietly jumped,
 *   · and a broken render meant no data got collected either.
 * Collection runs on its own, and when it fails it writes **nothing**.
 *
 *   npm run collect -- [options]
 *
 *   --dry-run    print the result without writing a file
 *   --force      overwrite even on verification failure or an existing file
 *   --date=…     set the date to record explicitly (default: today, UTC)
 *   --max-drift= allowed supply change vs. the previous snapshot, in %. Default 5
 *   --audit      only check that every accumulated snapshot matches the current registry
 *
 * Exit codes: 0 recorded/skipped · 1 verification failed · 2 read failed
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

/* Goes through Vite's SSR loader so this runs the **same modules** as the page.
   src/lib uses `?raw` imports and extensionless paths, so plain Node cannot read it,
   and reimplementing it here would split the numbers on screen from the numbers recorded. */
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
const { readAll } = await vite.ssrLoadModule('/src/lib/reads.ts');
const { fold, TOTAL_ISSUED } = await vite.ssrLoadModule('/src/lib/model.ts');
const { WALLETS } = await vite.ssrLoadModule('/src/lib/wallets.ts');

const DIR = join(process.cwd(), 'src/data/snapshots');

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

const DRY = flag('dry-run');
const FORCE = flag('force');
const MAX_DRIFT = Number(arg('max-drift', '5'));

const fmt = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (n) => `${(n * 100).toFixed(2)}%`;

/** The previous snapshot. Compared against today's to catch abnormal changes. */
function previous(today) {
  if (!existsSync(DIR)) return null;
  const days = readdirSync(DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .filter((d) => d < today)
    .sort();
  const last = days.at(-1);
  if (!last) return null;
  return { date: last, snap: JSON.parse(readFileSync(join(DIR, `${last}.json`), 'utf8')) };
}

/**
 * Decides whether this snapshot is safe to record.
 * Quietly piling up wrong numbers is the worst failure mode, so when in doubt we do not write.
 */
function verify(snap, prev) {
  const problems = [];
  const m = fold(snap.balances);

  // 1) Even one failed read makes that wallet's balance count as 0, which inflates the circulating supply
  if (snap.failures.length) {
    problems.push(`${snap.failures.length} read(s) failed: ${snap.failures.join(', ')}`);
  }

  // 2) Every entry in the registry must have a value
  const missing = WALLETS.filter((w) => snap.balances[w.id] === undefined).map((w) => w.id);
  if (missing.length) problems.push(`registry entries with no value: ${missing.join(', ')}`);

  // 3) Whether the numbers are in the range where the formula holds
  if (!(m.circulating > 0 && m.circulating <= TOTAL_ISSUED)) {
    problems.push(`circulating supply out of range: ${fmt(m.circulating)}`);
  }
  if (m.strictHenesys < 0) {
    problems.push(`strict circulating supply is negative: ${fmt(m.strictHenesys)}`);
  }
  const held = Object.values(snap.balances).reduce((a, b) => a + b, 0);
  if (held > TOTAL_ISSUED) {
    problems.push(`registry balances add up to more than total issued: ${fmt(held)}`);
  }

  // 4) Whether it jumped overnight. It may be a real transfer, so --force can push it through.
  if (prev) {
    const before = fold(prev.snap.balances).circulating;
    const drift = Math.abs(m.circulating - before) / before;
    if (drift * 100 > MAX_DRIFT) {
      problems.push(
        `circulating supply moved ${pct(drift)} since ${prev.date} — limit is ${MAX_DRIFT}%`,
      );
    }
  }

  return { problems, model: m };
}

/**
 * Archive check. When the registry changes the keys of old snapshots no longer match, and then
 * the missing entries count as 0, so the supply jumps on those dates alone — a fake peak in the chart.
 */
function audit() {
  const ids = new Set(WALLETS.map((w) => w.id));
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  let bad = 0;
  for (const f of files) {
    const snap = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    const keys = Object.keys(snap.balances ?? {});
    const unknown = keys.filter((k) => !ids.has(k));
    const missing = [...ids].filter((k) => !keys.includes(k));
    const ok = !unknown.length && !missing.length && !snap.placeholder;
    if (!ok) bad++;
    const m = fold(snap.balances ?? {});
    console.log(
      `  ${f.slice(0, 10)}  entries ${String(keys.length).padStart(2)}` +
      `  unknown keys ${String(unknown.length).padStart(2)}  missing ${String(missing.length).padStart(2)}` +
      `  circulating ${fmt(m.circulating).padStart(13)}${ok ? '' : '   <- unusable'}`,
    );
  }
  console.log(`\n${bad} of ${files.length} snapshots do not match the current registry.`);
  if (bad) console.log('Delete those files, or re-collect them with --force.');
  return bad;
}

async function main() {
  if (flag('audit')) { process.exitCode = audit() ? 1 : 0; return; }
  const today = arg('date', new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    console.error(`malformed date: ${today}`);
    process.exit(1);
  }
  const out = join(DIR, `${today}.json`);

  if (existsSync(out) && !FORCE && !DRY) {
    console.log(`a snapshot for ${today} already exists. Pass --force to overwrite`);
    process.exit(0);
  }

  let snap;
  try {
    snap = await readAll();
  } catch (err) {
    console.error(`on-chain read failed: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }

  const prev = previous(today);
  const { problems, model } = verify(snap, prev);

  console.log(`date            ${today}`);
  console.log(`block           #${fmt(snap.head.blockNumber)}`);
  console.log(`reads           ${Object.keys(snap.balances).length} entries · ${snap.failures.length} failed`);
  console.log('');
  console.log(`total issued    ${fmt(model.totalIssued).padStart(15)}`);
  console.log(`burned          ${fmt(model.burned).padStart(15)}`);
  console.log(`non-circulating ${fmt(model.nonCirculating).padStart(15)}`);
  console.log(`circulating     ${fmt(model.circulating).padStart(15)}   ${pct(model.circulating / model.totalIssued)}`);
  console.log(`strict · L1     ${fmt(model.strictHenesys).padStart(15)}`);
  console.log(`strict · global ${fmt(model.strictGlobal).padStart(15)}   ${pct(model.strictGlobal / model.totalIssued)}`);
  if (prev) {
    const before = fold(prev.snap.balances).circulating;
    const d = model.circulating - before;
    console.log(`change          ${(d >= 0 ? '+' : '') + fmt(d)}  (${prev.date})`);
  }

  if (problems.length) {
    console.error('\nvalidation failed:');
    for (const p of problems) console.error(`  · ${p}`);
    if (!FORCE) {
      console.error('\nNothing was written. Pass --force to write anyway.');
      process.exit(1);
    }
    console.error('\n--force given: writing regardless.');
  }

  if (DRY) {
    console.log('\n--dry-run — no file written.');
    return;
  }

  mkdirSync(DIR, { recursive: true });
  writeFileSync(out, `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
  console.log(`\nwrote: ${out}`);
}

await main();
await vite.close();
