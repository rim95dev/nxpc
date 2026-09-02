/* ------------------------------------------------------------------ *
 * Every figure on the page that a live read can move, keyed by name.
 *
 * The server writes these into `data-live` attributes and the client rewrites
 * the same keys after a live read. One function produces both, so a number
 * cannot be formatted one way at build time and another way afterwards — which
 * is exactly the drift that makes a page look like it is lying about itself.
 *
 * A key that is not on the page is simply unused; a `data-live` with no key here
 * is left alone rather than blanked.
 * ------------------------------------------------------------------ */

import type { Fmt } from './format';
import type { SupplyModel } from './model';

export function liveText(m: SupplyModel, fmt: Fmt): Record<string, string> {
  const share = (v: number, of: number) => (of > 0 ? fmt.pct(v / of) : '—');
  const total = m.totalIssued;

  return {
    'circulating': fmt.full(m.circulating),
    'circulating.pct': share(m.circulating, total),
    'strictGlobal': fmt.full(m.strictGlobal),
    'strictGlobal.pct': share(m.strictGlobal, total),
    'nonCirculating': fmt.full(m.nonCirculating),
    'nonCirculating.pct': share(m.nonCirculating, total),
    'burned': fmt.full(m.burned),
    'burned.pct': share(m.burned, total),
    'totalIssued': fmt.full(total),
    'bridged': fmt.full(m.bridged),
    'bridged.pct': share(m.bridged, m.circulating),
    'onL1': fmt.full(m.onL1),
    'onL1.pct': share(m.onL1, m.circulating),
  };
}
