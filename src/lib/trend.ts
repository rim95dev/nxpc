/* ------------------------------------------------------------------ *
 * Pure geometry for the trend chart.
 *
 * The server (build-time SVG) and the client (range-chip tween) call the
 * **same functions**. Computing the shape in two places makes the curve jump
 * the moment a transition ends — the same reason donut.ts exists.
 *
 * The x axis is a **time domain**, not a row index. That is what makes a range
 * change a zoom: narrowing [t0, t1] rescales the same curve instead of
 * replacing it with a differently sampled one. The full series is always drawn
 * and clipped to the plot rect, so points outside the window slide in and out
 * of view rather than appearing from nothing.
 *
 * No colour, no labels, no text here. charts.ts puts those on.
 * ------------------------------------------------------------------ */

import type { SeriesPoint } from './series';

export interface TrendBox {
  W: number;
  H: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  /** Top of the y scale. Fixed across ranges, so a range change never rescales y. */
  maxY: number;
}

/** Visible time window. */
export interface Domain {
  t0: number;
  t1: number;
}

export const boxOf = (narrow: boolean, maxY: number): TrendBox => ({
  W: narrow ? 460 : 1000,
  H: narrow ? 300 : 340,
  padL: 6,
  padR: narrow ? 52 : 72,
  padT: 18,
  padB: 44,
  maxY,
});

export const innerW = (b: TrendBox) => b.W - b.padL - b.padR;
export const innerH = (b: TrendBox) => b.H - b.padT - b.padB;

export const xOf = (b: TrendBox, d: Domain, t: number) =>
  d.t1 === d.t0 ? b.padL + innerW(b) : b.padL + ((t - d.t0) / (d.t1 - d.t0)) * innerW(b);

export const yOf = (b: TrendBox, v: number) => b.padT + innerH(b) - (v / b.maxY) * innerH(b);

/** The span a set of rows covers. A single row would give a zero-width domain, so it is widened. */
export function domainOf(rows: SeriesPoint[]): Domain {
  const t0 = rows[0]?.t ?? 0;
  const t1 = rows[rows.length - 1]?.t ?? t0;
  return t1 > t0 ? { t0, t1 } : { t0: t0 - 86_400_000, t1: t0 };
}

/**
 * The rows strictly inside the window.
 *
 * Strictly, because this drives the annotations. Padding it by a row on each side
 * — which the curve would not mind, since the curve is drawn from every row and
 * clipped — puts the first date tick at a negative x, outside the plot.
 */
export function visible(rows: SeriesPoint[], d: Domain): SeriesPoint[] {
  const inside = rows.filter((r) => r.t >= d.t0 && r.t <= d.t1);
  return inside.length ? inside : rows.slice(-1);
}

const n = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

export interface TrendGeom {
  /** Non-circulating band: between the issued cap and the circulating line. */
  band: string;
  /** Fill under the circulating line. */
  area: string;
  /** Circulating line over the hand-entered range. Empty when there is none. */
  dashed: string;
  /** Circulating line over the collected range. */
  solid: string;
  /** x of the boundary between the two ranges, or null when the series is single-source. */
  handoverX: number | null;
}

/**
 * Paths for the whole series at a given domain.
 *
 * Every path spans the entire series — clipping is left to the SVG. Trimming
 * to the window here would make the tween pop as rows entered and left it.
 */
export function geom(rows: SeriesPoint[], b: TrendBox, d: Domain): TrendGeom {
  const X = (t: number) => n(xOf(b, d, t));
  const Y = (v: number) => n(yOf(b, v));
  const last = rows.length - 1;

  let band = `M ${X(rows[0]!.t)} ${Y(rows[0]!.totalIssued)} L ${X(rows[last]!.t)} ${Y(rows[last]!.totalIssued)}`;
  for (let i = last; i >= 0; i--) band += ` L ${X(rows[i]!.t)} ${Y(rows[i]!.circulating)}`;
  band += ' Z';

  const seg = (from: number, to: number) =>
    rows
      .slice(from, to + 1)
      .map((r, k) => `${k ? 'L' : 'M'}${X(r.t)} ${Y(r.circulating)}`)
      .join(' ');

  const line = seg(0, last);
  const area = `${line} L ${X(rows[last]!.t)} ${Y(0)} L ${X(rows[0]!.t)} ${Y(0)} Z`;

  const firstMeasured = rows.findIndex((r) => r.source === 'snapshot');
  const split = firstMeasured > 0;

  return {
    band,
    area,
    dashed: split ? seg(0, firstMeasured) : firstMeasured === 0 ? '' : line,
    solid: split ? seg(firstMeasured, last) : firstMeasured === 0 ? line : '',
    handoverX: split ? xOf(b, d, rows[firstMeasured]!.t) : null,
  };
}
