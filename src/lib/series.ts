import { z } from 'zod';
import { fold, TOTAL_ISSUED, type SupplyModel } from './model';
import type { Snapshot } from './reads';
import rawHistory from '../data/history.csv?raw';

/**
 * The circulating supply time series comes from three sources.
 *
 *   past      src/data/history.csv         — pulled and committed by hand (fixed format)
 *   present   GitHub Actions daily cron    — reads on-chain at build time and leaves a snapshot
 *   future    src/data/snapshots/*.json    — those snapshots piling up
 *
 * Both of them **store only the inputs and derive the circulating supply.** Letting the
 * past file write the circulating supply directly would let that value drift from the
 * page's formula, and then the chart lies.
 */

/* ------------------------------------------------------------------ *
 * Past file — src/data/history.csv
 * ------------------------------------------------------------------ */

const num = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replaceAll(',', '').trim()) : v),
  z.number().nonnegative().refine(Number.isFinite, 'must be a finite number'),
);

const HistoryRow = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    total_issued: num,
    burned: num,
    non_circulating: num,
    bridged: num,
    block: z.preprocess(
      (v) => (v === '' || v === undefined ? undefined : Number(v)),
      z.number().int().nonnegative().optional(),
    ),
  })
  .refine((r) => r.burned + r.non_circulating <= r.total_issued, {
    message: 'burned + non-circulating exceeds total issued',
  })
  .refine((r) => r.bridged <= r.total_issued - r.burned - r.non_circulating, {
    message: 'bridged exceeds circulating supply',
  });

export type HistoryRow = z.infer<typeof HistoryRow>;

const REQUIRED = ['date', 'total_issued', 'burned', 'non_circulating', 'bridged'] as const;

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return [];

  const header = lines[0]!.split(',').map((h) => h.trim());
  for (const col of REQUIRED) {
    if (!header.includes(col)) {
      throw new Error(`history.csv header has no '${col}' column. Required: ${REQUIRED.join(', ')}`);
    }
  }

  return lines.slice(1).map((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length !== header.length) {
      throw new Error(`history.csv row ${i + 2}: column count differs from the header (${cells.length} ≠ ${header.length})`);
    }
    return Object.fromEntries(header.map((h, j) => [h, cells[j] ?? '']));
  });
}

function loadHistory(): HistoryRow[] {
  const rows = parseCsv(rawHistory).map((raw, i) => {
    const r = HistoryRow.safeParse(raw);
    if (!r.success) {
      const detail = r.error.issues.map((x) => `${x.path.join('.') || 'row'} — ${x.message}`).join('; ');
      throw new Error(`history.csv row ${i + 2} failed validation: ${detail}`);
    }
    return r.data;
  });

  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.date)) throw new Error(`history.csv contains ${r.date} twice`);
    seen.add(r.date);
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ *
 * Snapshot archive — piled up by the daily cron
 * ------------------------------------------------------------------ */

const SNAPSHOTS = import.meta.glob<Snapshot & { placeholder?: boolean }>(
  '../data/snapshots/*.json',
  { eager: true, import: 'default' },
);

/* ------------------------------------------------------------------ *
 * Merge
 * ------------------------------------------------------------------ */

export type PointSource = 'history' | 'snapshot';

export interface SeriesPoint {
  t: number;
  date: string;
  circulating: number;
  bridged: number;
  burned: number;
  nonCirculating: number;
  totalIssued: number;
  source: PointSource;
  block?: number;
  placeholder?: boolean;
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

function fromHistory(r: HistoryRow): SeriesPoint {
  // Circulating supply is derived, not stored — the same formula as at the top of the page.
  const circulating = r.total_issued - r.burned - r.non_circulating;
  return {
    t: dayMs(r.date),
    date: r.date,
    circulating,
    bridged: r.bridged,
    burned: r.burned,
    nonCirculating: r.non_circulating,
    totalIssued: r.total_issued,
    source: 'history',
    ...(r.block === undefined ? {} : { block: r.block }),
  };
}

function fromSnapshot(s: Snapshot & { placeholder?: boolean }): SeriesPoint {
  const m: SupplyModel = fold(s.balances);
  const date = new Date(s.takenAt).toISOString().slice(0, 10);
  return {
    t: s.takenAt,
    date,
    circulating: m.circulating,
    bridged: m.bridged,
    burned: m.burned,
    nonCirculating: m.nonCirculating,
    totalIssued: m.totalIssued,
    source: 'snapshot',
    block: s.head?.blockNumber,
    ...(s.placeholder ? { placeholder: true } : {}),
  };
}

export interface SeriesResult {
  points: SeriesPoint[];
  historyCount: number;
  snapshotCount: number;
  /** The point where the past file ends and the daily aggregation begins. null if there is none. */
  handoverDate: string | null;
  /** If there are empty days between the last history day and the first snapshot, the number of them. */
  gapDays: number;
  hasPlaceholder: boolean;
}

/**
 * Merges the past file and the snapshots into one time series.
 * When the same date exists on both sides, **the measured value (snapshot) wins** —
 * a value read from on-chain takes precedence over one filled in by hand.
 */
export function buildSeries(): SeriesResult {
  const history = loadHistory().map(fromHistory);
  const snapshots = Object.keys(SNAPSHOTS)
    .sort()
    .map((k) => fromSnapshot(SNAPSHOTS[k]!));

  const byDate = new Map<string, SeriesPoint>();
  for (const p of history) byDate.set(p.date, p);
  for (const p of snapshots) byDate.set(p.date, p); // the measured value overwrites

  const points = [...byDate.values()].sort((a, b) => a.t - b.t);

  const firstSnapshot = points.find((p) => p.source === 'snapshot');
  const lastHistory = [...points].reverse().find((p) => p.source === 'history');

  let gapDays = 0;
  if (firstSnapshot && lastHistory && lastHistory.t < firstSnapshot.t) {
    gapDays = Math.max(0, Math.round((firstSnapshot.t - lastHistory.t) / 86_400_000) - 1);
  }

  return {
    points,
    historyCount: history.length,
    snapshotCount: snapshots.length,
    handoverDate: firstSnapshot?.date ?? null,
    gapDays,
    hasPlaceholder: points.some((p) => p.placeholder) || history.some(() => HISTORY_IS_PLACEHOLDER),
  };
}

/**
 * Whether the past file is still placeholder data. If the first-line comment of
 * history.csv has `# placeholder`, it counts as temporary — when you swap in the real
 * data, just delete that line.
 */
export const HISTORY_IS_PLACEHOLDER = /^#\s*placeholder\b/m.test(rawHistory);

export { TOTAL_ISSUED };
