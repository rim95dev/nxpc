import { parse } from 'yaml';
import { z } from 'zod';
import raw from '../data/addresses.yaml?raw';
import type { Lang } from '../i18n';

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
  owner: L10n,
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'not a valid 20-byte address'),
  standard: z.enum(['erc20', 'erc721']).optional(),
  /** A temporary balance used only while the placeholder marker is present. Ignored with real data. */
  balanceHint: z.number().nonnegative().optional(),
});

const RegistrySchema = z
  .array(EntrySchema)
  .min(1)
  .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, {
    message: 'duplicate id',
  })
  .refine(
    (rows) =>
      new Set(rows.map((r) => r.address.toLowerCase())).size === rows.length,
    { message: 'duplicate address' },
  )
  .refine((rows) => rows.every((r) => r.type === 'contract' || !r.standard), {
    message: 'standard may only be attached to contracts',
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
  owner: string;
  address: string;
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
    label: a.label[lang],
    owner: a.owner[lang],
    address: a.address,
    balance: balances[a.id] ?? null,
    ...(tokens[a.id] ? { token: tokens[a.id] } : {}),
  }));
}
