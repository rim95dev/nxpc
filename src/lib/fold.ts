/* ------------------------------------------------------------------ *
 * The fold, with no registry behind it.
 *
 * model.ts reaches for wallets.yaml and chains.yaml, which means zod and a YAML
 * parser. That is fine at build time and ruinous in the browser — importing it
 * for the live update pulled the bundle from 25 KB to 207 KB. So the arithmetic
 * lives here, taking its configuration as plain data, and the server ships that
 * configuration alongside the page.
 * ------------------------------------------------------------------ */

import type { Tier } from './wallets';
import type { SupplyModel, TierItem, TierRoll } from './model';

/** The registry, reduced to what the fold actually reads. */
export interface WalletMeta {
  id: string;
  tier: Tier;
  strictCirculating: boolean;
  share?: number;
  /** A document aggregate rather than an address, so no read returns it. */
  static?: number;
  /** Present when the value is a document figure rather than an on-chain read. */
  fromDoc?: boolean;
}

export interface FoldConfig {
  wallets: WalletMeta[];
  tiers: Tier[];
  policyTiers: Tier[];
  totalIssued: number;
  offHenesys: number;
  /** The document-carried part, for the client to add its live Avalanche figure to. */
  surveyedOffHenesys?: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Turns a raw per-id read into the values the fold expects.
 *
 * Two entries can share one address, split by `share` — the NextMeso collateral is
 * partly the company's and partly the users'. A read keyed by id hands both entries
 * the whole address balance, so without this the company half is counted at full
 * size and free float comes out several million too low. Entries with no address at
 * all take their document figure.
 *
 * The build path already does this in reads.ts spread(), against the same registry;
 * the live path needs it too, and only the registry metadata to do it.
 */
export function spreadLive(cfg: FoldConfig, raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of cfg.wallets) {
    out[w.id] = w.static !== undefined ? w.static : (raw[w.id] ?? 0) * (w.share ?? 1);
  }
  return out;
}

/**
 * Folds the balance map down the deduction ladder.
 *
 * The point is to run the historical files, the snapshots and a live read through
 * the same function — if any of those paths computed circulating supply by its own
 * formula, the chart would not line up with the headline.
 */
export function foldWith(cfg: FoldConfig, balances: Record<string, number>): SupplyModel {
  const { wallets, tiers, policyTiers, totalIssued, offHenesys } = cfg;
  const byTier = new Map<Tier, TierItem[]>();
  for (const t of tiers) byTier.set(t, []);

  const itemOf = (w: WalletMeta): TierItem => ({
    id: w.id,
    value: balances[w.id] ?? 0,
    ...(w.share !== undefined ? { share: w.share } : {}),
    fromDoc: w.fromDoc === true,
  });

  for (const w of wallets) byTier.get(w.tier)!.push(itemOf(w));

  const rolls: TierRoll[] = tiers.map((tier) => {
    const items = byTier.get(tier)!;
    return { tier, value: sum(items.map((i) => i.value)), items };
  });
  const valueOf = (tier: Tier) => rolls.find((r) => r.tier === tier)!.value;

  /* Policy basis — subtract only the items the circulating supply policy subtracts. */
  const circulating = totalIssued - sum(policyTiers.map(valueOf));

  /* Stricter basis — subtract every entry whose strictCirculating is false.
     Entries with strictCirculating: true (the wrapper user portion and the like)
     stay in: they are already on the circulating side, and the flag only records
     that their origin is identified. */
  const strictHenesys =
    totalIssued - sum(wallets.filter((w) => !w.strictCirculating).map((w) => balances[w.id] ?? 0));

  return {
    totalIssued,
    rolls,
    circulating,
    strictHenesys,
    strictGlobal: strictHenesys + offHenesys,
    offHenesys,
    attributed: wallets.filter((w) => w.strictCirculating).map(itemOf),
    /* Derived from policyTiers rather than listed by hand — a tier that stops being
       a deduction has to leave this breakdown at the same time, or the non-circulating
       split adds up to more than the non-circulating total. */
    buckets: policyTiers
      .filter((t) => t !== 'burn')
      .map((t) => ({ id: t, value: valueOf(t) }))
      .filter((b) => b.value > 0),
    onL1: circulating - valueOf('bridge'),
    burned: valueOf('burn'),
    nonCirculating: totalIssued - circulating - valueOf('burn'),
    bridged: valueOf('bridge'),
    balances,
  };
}

/**
 * Avalanche's share of free float, from a C-Chain read.
 *
 *   circulating = totalSupply − CCIP pool − the addresses we operate there
 *
 * The pool backs the wrapped NXPC on BNB and Monad, which report that supply
 * themselves, so leaving it in counts it twice. Our own balances come out for the
 * same reason they do on Henesys: this figure feeds free float, which is what is
 * *not* under issuer control.
 *
 * `surveyed` is the chains still carried from the document. It arrives as a number
 * rather than being read from chains.yaml here — that file brings a YAML parser and
 * a schema with it, and this module has to stay light enough for the browser.
 */
export function offHenesysFrom(balances: Record<string, number>, surveyed: number) {
  const total = balances.totalSupply ?? 0;
  const pool = balances.pool ?? 0;
  const ours = Object.entries(balances)
    .filter(([k]) => k !== 'totalSupply' && k !== 'pool')
    .reduce((n, [, v]) => n + v, 0);
  const avalanche = Math.max(0, total - pool - ours);
  return {
    offHenesys: avalanche + surveyed,
    chains: { avalanche: { issued: total, circulating: avalanche } },
  };
}
