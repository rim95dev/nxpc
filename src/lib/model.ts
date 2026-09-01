import { WALLETS, POLICY_TIERS, TIERS, type Tier } from './wallets';
import { OFF_HENESYS_CIRCULATING } from './chains';

/**
 * Total issued supply. NXPC on Henesys is a native gas token with no contract,
 * so there is no totalSupply() call — this is the only item on this page that
 * cannot be verified on-chain, so we keep it as a constant and say so on screen.
 */
export const TOTAL_ISSUED = 1_000_000_000;

export interface TierItem {
  id: string;
  value: number;
  /** For an entry split by share, that ratio. Shown on screen as the basis. */
  share?: number;
  /** true if the value comes from document aggregation instead of on-chain. */
  fromDoc: boolean;
}

export interface TierRoll {
  tier: Tier;
  value: number;
  items: TierItem[];
}

export interface SupplyModel {
  totalIssued: number;
  /** Aggregate per deduction step. Follows the TIERS order. */
  rolls: TierRoll[];
  /**
   * Circulating supply on the policy basis: total issued minus the four tiers
   * POLICY_TIERS names — burn, locked, team, fusion. Those are the deductions
   * the Confluence «Token circulating supply policy» defines (contribution
   * reward balance and vesting both land in locked/team; fusion is Valhalla).
   * This is the disclosed figure, so the headline uses it.
   */
  circulating: number;
  /** Henesys effective circulating supply, with issuer-controlled amounts subtracted as well. */
  strictHenesys: number;
  /** The global value: the above plus the effective circulating supply on other chains. */
  strictGlobal: number;
  /** Total outside Henesys (per the documents). */
  offHenesys: number;
  /** The portion inside the effective circulating supply whose origin is identified (wrapper collateral and the like). */
  attributed: TierItem[];
  /* ── Summary values used by the time series and the charts ── */
  /** The policy deduction entries grouped by step. The donut draws this. */
  buckets: { id: Tier; value: number }[];
  /** The part of the policy-basis circulating supply that stays on Henesys (what is left after the bridge lock). */
  onL1: number;
  burned: number;
  /** The policy deductions minus burn (locked + vesting + Fusion funds). */
  nonCirculating: number;
  bridged: number;
  balances: Record<string, number>;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Folds the balance map down the deduction ladder.
 *
 * The point is to run the historical files and the snapshot through the same function —
 * if the two paths compute circulating supply by different formulas, the chart does not line up.
 */
export function fold(balances: Record<string, number>): SupplyModel {
  const byTier = new Map<Tier, TierItem[]>();
  for (const t of TIERS) byTier.set(t, []);

  for (const w of WALLETS) {
    const item: TierItem = {
      id: w.id,
      value: balances[w.id] ?? 0,
      ...(w.share !== undefined ? { share: w.share } : {}),
      fromDoc: w.static !== undefined,
    };
    byTier.get(w.tier)!.push(item);
  }

  const rolls: TierRoll[] = TIERS.map((tier) => {
    const items = byTier.get(tier)!;
    return { tier, value: sum(items.map((i) => i.value)), items };
  });
  const valueOf = (tier: Tier) => rolls.find((r) => r.tier === tier)!.value;

  /* Policy basis — subtract only the four items the Confluence formula subtracts. */
  const circulating = TOTAL_ISSUED - sum(POLICY_TIERS.map(valueOf));

  /* Stricter basis — subtract every entry whose strictCirculating is false.
     Entries with strictCirculating: true (the wrapper user portion and the like)
     stay in: they are already on the circulating side, and the flag only records
     that their origin is identified. */
  const excluded = WALLETS.filter((w) => !w.strictCirculating).map((w) => balances[w.id] ?? 0);
  const strictHenesys = TOTAL_ISSUED - sum(excluded);

  return {
    totalIssued: TOTAL_ISSUED,
    rolls,
    circulating,
    strictHenesys,
    strictGlobal: strictHenesys + OFF_HENESYS_CIRCULATING,
    offHenesys: OFF_HENESYS_CIRCULATING,
    attributed: WALLETS.filter((w) => w.strictCirculating).map((w) => ({
      id: w.id,
      value: balances[w.id] ?? 0,
      ...(w.share !== undefined ? { share: w.share } : {}),
      fromDoc: w.static !== undefined,
    })),
    buckets: (['locked', 'team', 'fusion'] as Tier[])
      .map((t) => ({ id: t, value: valueOf(t) }))
      .filter((b) => b.value > 0),
    onL1: circulating - valueOf('bridge'),
    burned: valueOf('burn'),
    nonCirculating: TOTAL_ISSUED - circulating - valueOf('burn'),
    bridged: valueOf('bridge'),
    balances,
  };
}
