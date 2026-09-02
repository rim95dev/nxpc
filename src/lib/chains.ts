import { parse } from 'yaml';
import raw from '../data/chains.yaml?raw';
import { z } from 'zod';
import type { Lang } from '../i18n';

const L10n = z.object({ en: z.string().min(1) });

const Schema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: L10n,
  chains: z
    .array(
      z.object({
        id: z.string().min(1),
        label: L10n,
        issued: z.number().nonnegative(),
        circulating: z.number().nonnegative(),
        /** Read from that chain at run time; the figures here are the fallback. */
        live: z.boolean().optional(),
        note: L10n,
      }),
    )
    .min(1)
    .refine((rows) => rows.every((r) => r.circulating <= r.issued), {
      message: 'circulating supply is greater than issued supply',
    }),
});

function load() {
  const result = Schema.safeParse(parse(raw));
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  chains.yaml[${i.path.join('.')}] — ${i.message}`)
      .join('\n');
    throw new Error(`chain data validation failed:\n${detail}`);
  }
  return result.data;
}

export const CHAINS = load();

export interface LocalizedChain {
  id: string;
  label: string;
  issued: number;
  circulating: number;
  /** True when these came from the chain just now rather than the document. */
  live: boolean;
  note: string;
}

export const localizeChains = (lang: Lang, live?: Record<string, { issued: number; circulating: number }>): LocalizedChain[] =>
  CHAINS.chains.map((c) => ({
    id: c.id,
    label: c.label[lang],
    issued: live?.[c.id]?.issued ?? c.issued,
    circulating: live?.[c.id]?.circulating ?? c.circulating,
    live: c.live === true && live?.[c.id] !== undefined,
    note: c.note[lang],
  }));

/**
 * The CCIP token pool on C-Chain. It holds the collateral for the wrapped NXPC on
 * BNB and Monad, so its balance is not circulating on Avalanche — those chains
 * report that supply themselves and counting the pool as well would double it.
 * Identified from the token's holder list: its balance matches the surveyed figure
 * to the cent (13,730,643.34).
 */
export const AVAX_CCIP_POOL = '0x0D9A14a6eD561770295BcCCF1995ae5B026a65d6' as const;

/** The chains still carried from the document, summed. The live path adds Avalanche to this. */
export const SURVEYED_OFF_HENESYS = CHAINS.chains
  .filter((c) => !c.live)
  .reduce((n, c) => n + c.circulating, 0);

/** The chains this page reads for itself, rather than carrying a surveyed figure. */
export const LIVE_CHAINS = CHAINS.chains.filter((c) => c.live).map((c) => c.id);

/**
 * Fallback sum of the circulating supply outside Henesys.
 *
 * Used when the live read is unavailable. Avalanche is read at run time — see
 * offHenesysCirculating() in reads.ts — so in normal operation only BNB and Monad
 * come from the document.
 */
export const OFF_HENESYS_CIRCULATING = CHAINS.chains.reduce(
  (n, c) => n + c.circulating,
  0,
);
