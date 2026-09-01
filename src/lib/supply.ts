import { WALLETS, isPlaceholder } from './wallets';
import { readAll, type Snapshot } from './reads';
import { fold, TOTAL_ISSUED, type SupplyModel } from './model';
import { buildSeries, HISTORY_IS_PLACEHOLDER, type SeriesResult } from './series';

export { fold, TOTAL_ISSUED };
export type { SupplyModel, TierRoll, TierItem } from './model';
export type { SeriesPoint } from './series';

/** ⚠️ Fallback balances, used only while placeholder addresses remain in the registry. */
const PLACEHOLDER_BALANCES: Record<string, number> = {
  'contribution-reward-distributor': 669_000_000,
  'cold-recycle-vault': 83_000_000,
  'l1-bridge-lock': 127_000_000,
  burn: 11_000_000,
};

export interface PageData {
  supply: SupplyModel;
  series: SeriesResult;
  snapshot: Snapshot;
  /** Whether the balances are placeholders. Becomes false once real addresses replace them. */
  balancesArePlaceholder: boolean;
  historyIsPlaceholder: boolean;
  rpcError: string | null;
}

/**
 * Builds all the data the page uses at build time.
 *
 * An RPC failure does not block the deploy — the reason is shown on screen instead.
 * Silently showing stale numbers is the worst failure mode.
 */
export async function buildPageData(): Promise<PageData> {
  let snapshot: Snapshot;
  let rpcError: string | null = null;

  try {
    snapshot = await readAll();
  } catch (err) {
    rpcError = err instanceof Error ? err.message : String(err);
    snapshot = {
      takenAt: Date.now(),
      head: { chainId: 68414, blockNumber: 0, timestamp: 0 },
      balances: {},
      failures: Object.keys(PLACEHOLDER_BALANCES),
      fromChain: false,
    };
  }

  // The verdict is based on the 'address' in the registry, not on the 'value' read back.
  // The zero address holds a real balance too, so judging by value means we read a
  // placeholder address and mistake it for real data (this actually produced a
  // circulating supply of 999,999,963).
  const balancesArePlaceholder = WALLETS.some(isPlaceholder);
  const balances = balancesArePlaceholder ? PLACEHOLDER_BALANCES : snapshot.balances;

  /* Snapshots are not recorded here — scripts/collect.mjs owns that.
     Writing during render means even a local build overwrites that day's record,
     and a partially failed read still goes straight into the archive. */

  return {
    supply: fold(balances),
    series: buildSeries(),
    snapshot,
    balancesArePlaceholder,
    historyIsPlaceholder: HISTORY_IS_PLACEHOLDER,
    rpcError,
  };
}
