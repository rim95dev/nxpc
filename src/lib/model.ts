import { WALLETS, POLICY_TIERS, TIERS, type Tier } from './wallets';
import { OFF_HENESYS_CIRCULATING, SURVEYED_OFF_HENESYS } from './chains';
import { foldWith, type FoldConfig } from './fold';
export { foldWith };

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
   * Circulating supply on the policy basis: total issued minus the tiers
   * POLICY_TIERS names — burn, locked, vesting — which is the set the published
   * circulating supply figure is built on. See the note on POLICY_TIERS.
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
  /** The policy deductions minus burn (the reward pool and the cliff-locked allocations). */
  nonCirculating: number;
  bridged: number;
  balances: Record<string, number>;
}

/** The registry as the fold needs it. Shipped to the client so a live read folds identically. */
export const FOLD_CONFIG: FoldConfig = {
  wallets: WALLETS.map((w) => ({
    id: w.id,
    tier: w.tier,
    strictCirculating: w.strictCirculating,
    ...(w.share !== undefined ? { share: w.share } : {}),
    ...(w.static !== undefined ? { fromDoc: true, static: w.static } : {}),
  })),
  tiers: [...TIERS],
  policyTiers: POLICY_TIERS,
  totalIssued: TOTAL_ISSUED,
  offHenesys: OFF_HENESYS_CIRCULATING,
  surveyedOffHenesys: SURVEYED_OFF_HENESYS,
};

/** Build-time fold, against the real registry. */
export const fold = (balances: Record<string, number>): SupplyModel =>
  foldWith(FOLD_CONFIG, balances);
