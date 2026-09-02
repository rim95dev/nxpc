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
  /** Present when the value is a document figure rather than an on-chain read. */
  fromDoc?: boolean;
}

export interface FoldConfig {
  wallets: WalletMeta[];
  tiers: Tier[];
  policyTiers: Tier[];
  totalIssued: number;
  offHenesys: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

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
