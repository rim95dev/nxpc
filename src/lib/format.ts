import { dict, type Lang } from '../i18n';

/**
 * Number and time formatting. Locales group digits differently, so the ladder
 * and the Intl tag both come from the dictionary rather than from a branch here.
 * Axis ticks and bar labels use `compact`.
 */
export interface Fmt {
  /** 1,234,567,890 — wherever an exact value is needed, such as tables and tooltips */
  full(v: number): string;
  /** 1.23B — axis ticks and bar labels */
  compact(v: number): string;
  pct(f: number): string;
  date(ms: number): string;
  datetime(ms: number): string;
  addr(a: string): string;
}

const pad = (n: number) => String(n).padStart(2, '0');
/**
 * Strips only the trailing zeros of the fractional part. Making the dot optional,
 * as in `/\.?0+$/`, also eats an integer's trailing zeros and turns 300 into 3
 * (it actually broke that way).
 */
const trim = (n: number) =>
  n
    .toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');

export function createFmt(lang: Lang): Fmt {
  const t = dict(lang);
  const nf0 = new Intl.NumberFormat(t.numberLocale, { maximumFractionDigits: 0 });

  /* The ladder comes from the dictionary, so a new locale only has to declare
     its own grouping — no branch here has to learn about it. */
  const compact = (v: number) => {
    const a = Math.abs(v);
    const step = t.compactScale.find((s) => a >= s.at);
    return step ? `${trim(v / step.at)}${step.suffix}` : nf0.format(Math.round(v));
  };

  const date = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  return {
    full: (v) => nf0.format(Math.round(v)),
    compact,
    pct: (f) => {
      if (!Number.isFinite(f)) return '—';
      const p = f * 100;
      return `${p >= 10 ? p.toFixed(1) : p.toFixed(2)}%`;
    },
    date,
    datetime: (ms) => {
      const d = new Date(ms);
      return `${date(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    },
    addr: (a) => (!a || a.length < 12 ? a || '—' : `${a.slice(0, 6)}…${a.slice(-4)}`),
  };
}
