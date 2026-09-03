/**
 * The «last N days» window over a time series.
 *
 * Do not cut by point count. `slice(-30)` is 30 days only while the series holds
 * exactly one point per day; the moment the spacing changes — a collection run made
 * by hand, a cron that never fired, a range filled in at a different interval — the
 * same code cuts a different amount of time and says nothing about it. That is how
 * 90 days, 1 year and all-time once ended up drawing the same picture.
 *
 * The server (first render) and the client (chip switching) must use the same
 * function, or the graph jumps to a different range the moment a chip is pressed.
 * That is why this sits in its own file with no dependencies — pulling series.ts
 * into the client drags zod, yaml and history.csv along into the bundle.
 */

/** The minimum shape a point needs for the window to be cut. */
export interface Dated {
  t: number;
}

const DAY = 86_400_000;

/**
 * From the last point back `days` days. A `days` of 0 means everything.
 *
 * The reference is the «last point», not «now». That keeps the window from coming
 * up empty when collection runs a day behind.
 *
 * Where the spacing is sparse, one remaining point draws no line, so at least two points are kept.
 */
export function lastDays<T extends Dated>(points: T[], days: number): T[] {
  if (days <= 0 || points.length <= 2) return points;
  const end = points[points.length - 1]!.t;
  const cut = end - days * DAY;
  const win = points.filter((p) => p.t >= cut);
  return win.length >= 2 ? win : points.slice(-2);
}
