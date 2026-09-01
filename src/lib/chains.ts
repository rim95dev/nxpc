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
  note: string;
}

export const localizeChains = (lang: Lang): LocalizedChain[] =>
  CHAINS.chains.map((c) => ({
    id: c.id,
    label: c.label[lang],
    issued: c.issued,
    circulating: c.circulating,
    note: c.note[lang],
  }));

/** Sum of the effective circulating supply outside Henesys. These are document-basis figures, not live on-chain values. */
export const OFF_HENESYS_CIRCULATING = CHAINS.chains.reduce(
  (n, c) => n + c.circulating,
  0,
);
