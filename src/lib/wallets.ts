import { parse } from 'yaml';
// Importing with ?raw inlines the contents into the bundle, so it works regardless of where the output lands.
// (node:fs + a relative path breaks once it is bundled into dist/.prerender)
import rawRegistry from '../data/wallets.yaml?raw';
import { z } from 'zod';
import type { Lang } from '../i18n';

/**
 * Wallet registry schema.
 *
 * A failure here stops the build — the point is to block a wrong address from
 * reaching the disclosure page before it ships.
 */
/** Per-locale strings: one key per locale in LANGS. A missing or empty one fails the build. */
const L10n = z.object({ en: z.string().min(1) });

/**
 * Deduction stages. The first four are the official deduction items from
 * Confluence «Token circulating supply policy»; the following five are deducted
 * one step further under the «issuer control» basis.
 * This order is exactly the ladder order on screen.
 */
export const TIERS = [
  'burn', 'locked', 'team', 'fusion',
  'bridge', 'treasury', 'wrapper', 'ecosystem', 'ops',
  'circulating',
] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Items deducted down to the policy-basis circulating supply — the Confluence
 * formula stops here.
 *
 * The Fusion reserve (NXPCRecycleVault) is **not** here. NXPC sitting in the vault
 * is circulating: it went in through Fission and comes back out through Fusion,
 * and nothing stops it. Deducting it would put this page ~90M below the figure
 * MSU Explorer publishes, which is the number people compare against.
 * The stricter figure still removes it — see strictCirculating on those entries.
 */
export const POLICY_TIERS: Tier[] = ['burn', 'locked', 'team'];

const WalletSchema = z
  .object({
    id: z.string().min(1),
    label: L10n,
    tier: z.enum(TIERS),
    holder: L10n,
    address: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, 'not a valid 20-byte address')
      .optional(),
    /** Used when one address is split into shares (wrapper collateral). Defaults to 1. */
    share: z.number().gt(0).lte(1).optional(),
    shareSource: L10n.optional(),
    /** An aggregate entry whose address is not disclosed. Not read on-chain. */
    static: z.number().nonnegative().optional(),
    staticSource: L10n.optional(),
    /**
     * Whether it counts as circulating on the «issuer control basis». No default value.
     * The «policy basis» is decided by tier, not by this value (see POLICY_TIERS).
     */
    strictCirculating: z.boolean(),
  })
  .refine((w) => (w.address === undefined) !== (w.static === undefined), {
    message: 'exactly one of address or static must be present',
  })
  .refine((w) => w.static === undefined || w.staticSource !== undefined, {
    message: 'a static value requires staticSource (its source)',
  })
  .refine((w) => w.share === undefined || w.shareSource !== undefined, {
    message: 'a share requires shareSource (its rationale)',
  });

const RegistrySchema = z
  .array(WalletSchema)
  .min(1)
  .refine(
    (rows) => new Set(rows.map((r) => r.id)).size === rows.length,
    { message: 'duplicate id' },
  )
  .refine(
    (rows) => rows.some((r) => r.id === 'burn'),
    { message: 'the burn entry is required (it is what gets deducted from total issued)' },
  )
  .refine(
    (rows) => {
      // When one address is split across several entries, the shares must sum to 1
      const byAddr = new Map<string, number>();
      for (const r of rows) {
        if (!r.address) continue;
        byAddr.set(r.address, (byAddr.get(r.address) ?? 0) + (r.share ?? 1));
      }
      return [...byAddr.values()].every((sum) => Math.abs(sum - 1) < 1e-9);
    },
    { message: 'the share values of the entries splitting one address do not sum to 1' },
  );

export type Wallet = z.infer<typeof WalletSchema>;

function load(): Wallet[] {
  const raw = parse(rawRegistry);
  const result = RegistrySchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  wallets.yaml[${i.path.join('.')}] — ${i.message}`)
      .join('\n');
    throw new Error(`wallet registry validation failed:\n${detail}`);
  }
  return result.data;
}

export const WALLETS: Wallet[] = load();

/* The zero address is a real burn address, not a placeholder. Only the burn-zero
   entry listed in the registry is exempt; any other 0x00…00 is treated as not yet replaced. */
export const isPlaceholder = (w: Pick<Wallet, 'id' | 'address'>) =>
  w.id !== 'burn-zero' && !!w.address && /^0x0{40}$/i.test(w.address);

export const PLACEHOLDER_COUNT = WALLETS.filter(isPlaceholder).length;

/** Only the entries read on-chain. static aggregate entries are excluded. */
export const READABLE = WALLETS.filter(
  (w): w is Wallet & { address: string } => w.address !== undefined,
);

export interface LocalizedWallet {
  id: string;
  tier: Tier;
  label: string;
  holder: string;
  address?: string;
  share?: number;
  source?: string;
  /** Whether it circulates under Confluence «Token circulating supply policy». tier decides it. */
  inPolicy: boolean;
  /** Whether it circulates on the conservative basis that also weighs issuer control. */
  inStrict: boolean;
}

/** Is this a stage the policy deducts? treasury and ecosystem are not here, so under the policy they circulate. */
export const isPolicyDeduction = (tier: Tier) => POLICY_TIERS.includes(tier);

export const localizeWallets = (lang: Lang): LocalizedWallet[] =>
  WALLETS.map((w) => ({
    id: w.id,
    tier: w.tier,
    label: w.label[lang],
    holder: w.holder[lang],
    address: w.address,
    share: w.share,
    source: (w.staticSource ?? w.shareSource)?.[lang],
    inPolicy: !isPolicyDeduction(w.tier),
    inStrict: w.strictCirculating,
  }));
