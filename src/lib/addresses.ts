import { parse } from 'yaml';
import { z } from 'zod';
import raw from '../data/addresses.yaml?raw';
import type { Lang } from '../i18n';
import { WALLETS, isPolicyDeduction } from './wallets';

/**
 * Managed address registry — the contracts / EOAs the team operates.
 *
 * Its purpose differs from the supply registry (wallets.yaml).
 * That one is the source of truth for "what gets deducted from circulating";
 * this one is the list of "what we hold".
 * An address may appear in both, and it shows up in each table in its own role.
 */

const L10n = z.object({ en: z.string().min(1) });

const EntrySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['contract', 'eoa']),
  category: z.enum(['bridge', 'vault', 'treasury', 'ops', 'token', 'infra']),
  chain: z.enum(['henesys', 'c-chain']),
  label: L10n,
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'not a valid 20-byte address'),
  standard: z.enum(['erc20', 'erc721']).optional(),
  /** For an executor wallet, the contracts it is authorised to call. */
  executes: z.array(z.string().min(1)).nonempty().optional(),
  /** A temporary balance used only while the placeholder marker is present. Ignored with real data. */
  balanceHint: z.number().nonnegative().optional(),
});

const RegistrySchema = z
  .array(EntrySchema)
  .min(1)
  .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, {
    message: 'duplicate id',
  })
  /* Per chain, not globally. The deployer is shared across chains, so a C-Chain
     contract legitimately sits at the same address as an unrelated Henesys one. */
  .refine(
    (rows) =>
      new Set(rows.map((r) => `${r.chain}:${r.address.toLowerCase()}`)).size === rows.length,
    { message: 'the same address is listed twice on one chain' },
  )
  .refine((rows) => rows.every((r) => r.type === 'contract' || !r.standard), {
    message: 'standard may only be attached to contracts',
  })
  .refine((rows) => rows.every((r) => r.type === 'eoa' || !r.executes), {
    message: 'executes belongs to a wallet, not a contract',
  });

export type AddressEntry = z.infer<typeof EntrySchema>;

/** If the leading `# placeholder` line is present, the data is treated as temporary. */
export const ADDRESSES_ARE_PLACEHOLDER = /^#\s*placeholder\b/m.test(raw);

function load(): AddressEntry[] {
  const parsed = parse(raw);
  const result = RegistrySchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  addresses.yaml[${i.path.join('.')}] — ${i.message}`)
      .join('\n');
    throw new Error(`managed address registry validation failed:\n${detail}`);
  }
  return result.data;
}

export const ADDRESSES: AddressEntry[] = load();

/**
 * Addresses the circulating supply policy deducts, taken from the supply registry.
 *
 * Duplicated here the two would drift: wallets.yaml decides what is non-circulating
 * and this tab only asks.
 *
 * The join has to include the chain. The supply registry is Henesys-only, and the
 * deployer is shared across chains — C-Chain Treasury sits at the same address as
 * TeamVestingWallet and is an unrelated contract. Matching on the address alone
 * marked it non-circulating.
 */
const DEDUCTED = new Set(
  WALLETS.filter((w) => isPolicyDeduction(w.tier) && w.address)
    .map((w) => w.address!.toLowerCase()),
);

export const isNonCirculating = (address: string, chain: AddressEntry['chain']) =>
  chain === 'henesys' && DEDUCTED.has(address.toLowerCase());

/**
 * The Henesys bridge lock, again from the supply registry.
 *
 * It is left out of «total held» because it would be counted twice. The lock is the
 * collateral for the NXPC that exists on C-Chain, and this tab lists the C-Chain
 * balances too — the same tokens seen from both ends. Adding the lock to the total
 * puts the address tab above circulating supply, which cannot be right.
 *
 * The row still shows the balance. It is a real amount at a real address; it just is
 * not an amount held on top of what the other rows already account for.
 */
const BRIDGE_LOCK = new Set(
  WALLETS.filter((w) => w.tier === 'bridge' && w.address).map((w) => w.address!.toLowerCase()),
);

export const isBridgeLock = (address: string, chain: AddressEntry['chain']) =>
  chain === 'henesys' && BRIDGE_LOCK.has(address.toLowerCase());

export interface TokenInfo {
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: number;
}

export interface LocalizedAddress {
  id: string;
  type: AddressEntry['type'];
  category: AddressEntry['category'];
  chain: AddressEntry['chain'];
  standard?: AddressEntry['standard'];
  label: string;
  address: string;
  executes?: string[];
  /** True when the circulating supply policy deducts this address. */
  nonCirculating: boolean;
  /** True when the balance is already represented elsewhere and must not be added to the total. */
  bridgeLock: boolean;
  /** null means it was not read — this must be distinguished from 0. */
  balance: number | null;
  token?: TokenInfo;
}

export function localizeAddresses(
  lang: Lang,
  balances: Record<string, number | null>,
  tokens: Record<string, TokenInfo>,
): LocalizedAddress[] {
  return ADDRESSES.map((a) => ({
    id: a.id,
    type: a.type,
    category: a.category,
    chain: a.chain,
    ...(a.standard ? { standard: a.standard } : {}),
    ...(a.executes ? { executes: [...a.executes] } : {}),
    nonCirculating: isNonCirculating(a.address, a.chain),
    bridgeLock: isBridgeLock(a.address, a.chain),
    label: a.label[lang],
    address: a.address,
    balance: balances[a.id] ?? null,
    ...(tokens[a.id] ? { token: tokens[a.id] } : {}),
  }));
}
