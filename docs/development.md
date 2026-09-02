# Development

Working on the site: the stack, the layout of the tree, i18n, and the steps to
take it off placeholder data.

## Stack

**Astro 7 + TypeScript.** No framework runtime is shipped to the browser.

There is one reason for that choice. A supply figure that only exists after
JavaScript has run is not really published: `curl` returns markup with none of
the numbers in it, and neither does anything else that reads pages without
executing them. Astro bakes the figures and the charts into the HTML at build
time, and the live read layers on top of that rather than replacing it.

```
$ curl .../index.html | grep -oE '[0-9]{1,3}(,[0-9]{3}){2,}'
1,000,000,000
302,273,321
...
```

Most of those numbers live inside the chart SVG, which is why the charts are
server-rendered strings rather than a client-side drawing library.

About 31KB of JavaScript reaches the browser: the live read, the freshness
watcher, the range chips, the donut morph and the table filter.

## Running it

```bash
npm ci --ignore-scripts
npm run dev       # dev server
npm run build     # typecheck + static build → dist/
npm run preview   # serve the build
```

## Layout

```
src/
  data/wallets.yaml     supply registry (Zod-checked)
  data/addresses.yaml   managed address registry (Zod-checked)
  data/chains.yaml      NXPC outside Henesys, sourced from a document
  data/history.csv      backfilled history (Zod-checked)
  data/snapshots/       one file per collection = the time-series database
  lib/chain.ts          chain definition, RPC limits
  lib/wallets.ts        YAML load + schema gate
  lib/reads.ts          READS spec + Multicall3 read
  lib/model.ts          fold() — balances into equation terms (past and present)
  lib/series.ts         history.csv + snapshots merged, with provenance
  lib/window.ts         date-based windowing for the range chips
  lib/supply.ts         page data assembly
  lib/donut.ts          3D donut geometry (server and client)
  lib/charts.ts         SVG strings (server and client)
  lib/segcard.ts        hover cards for coloured segments
  lib/format.ts         number and time formatting
  components/           the two views
  layouts/Site.astro    shell, theme boot, freshness watcher
  styles/theme.css      MSU theme
scripts/
  backfill.mjs          historical reconstruction from the archive node
  collect.mjs           snapshot collection with validation gates
  scan-balances.mjs     ad-hoc balance scan
```

`charts.ts` returns strings so that the same function serves the build-time
render and the client-side range switch.

## i18n

The site ships **English only** right now. The machinery is still in place, and
one array turns a locale back on.

```ts
// src/i18n/index.ts
export const LANGS: Lang[] = ['en'];   // add a locale here and it builds
```

- `src/i18n/en.ts` is the reference. A new dictionary is typed as `Dict`, so a
  missing key fails the build rather than falling back silently.
- Locale routes are generated from `LANGS`. The default locale sits at the root;
  every other one is emitted under `src/pages/[lang]/`, which produces nothing
  while `LANGS` has a single entry.
- The language switcher and the `hreflang` links appear only when there is more
  than one locale.
- Number grouping comes from the dictionary (`numberLocale`, `compactScale`), so
  a locale that groups by ten-thousands rather than K/M/B declares that itself.
  No formatting code branches on the locale.
- `label` / `holder` in the registries are locale maps (`{ en: … }`). Zod fails
  the build if one is empty.
- Charts take strings and a number formatter as arguments — `src/lib/charts.ts`
  has no locale in it.
- The theme setting survives a locale switch (same localStorage key).

## Deployment

`.github/workflows/deploy.yml` — on push, on two crons, and on manual dispatch.

| Trigger | Effect |
|---|---|
| push to `main` | rebuild and deploy |
| `0 0 * * 4` (Thursday) | add a point to the series, then rebuild |
| `20 3 * * *` (daily) | rebuild only — refreshes the fallback the live read sits on |
| manual dispatch | rebuild, with snapshot collection as an input |

**The rebuild is not what keeps the figures current** — the browser reads
balances live on load. It refreshes the built-in fallback that `curl` and a
JavaScript-less reader get, which daily covers. Every extra run is also another
Pages deployment, and those accumulate; the deploy job prunes all but the newest
five.

The freshness badge follows the same logic. Once a live read lands it reads
**LIVE**, with the age of the build alongside it; STALE is reserved for a build
older than 26 hours with no live read to stand in front of it. A threshold
shorter than the cron would mark the page stale for most of every cycle and mean
nothing.

The cron runs at minute 20: schedules on the hour queue behind everyone
else's, and 00:00 already belongs to the weekly snapshot run.

Thursday is not arbitrary: the backfilled grid runs on Thursdays, so continuing
on the same weekday keeps the spacing even.

Set the repository's **Settings → Pages → Source to `GitHub Actions`** — not the
branch-based mode.

`base: '/nxpc'` in `astro.config.mjs` is the project-page path. Renaming the
repository means changing it too.

## Switching to real data

1. Fill real addresses into `src/data/wallets.yaml`. `tier` decides the policy
   figure, `strictCirculating` the stricter one.
2. Fill real addresses into `src/data/addresses.yaml` and delete its
   `# placeholder` line.
3. Set `TOTAL_ISSUED` in `src/lib/model.ts` to the confirmed issued amount.
   NXPC on Henesys is a native gas token with no contract, so there is no
   `totalSupply()` to read. It is the one figure on this page that cannot be
   verified on-chain, and the page says so.
4. Replace `src/data/history.csv` and delete its `# placeholder` line if present.
5. Delete any snapshot in `src/data/snapshots/` carrying `"placeholder": true`.
6. Remove the preview banner: `preview` in `src/i18n/en.ts` and `.preview-bar`
   in `src/layouts/Site.astro`, plus the warning block at the top of the README.
7. Build. The placeholder banners disappear and the snapshot archive starts
   recording.

## Design notes

- **It is a subtraction, not a composition.** Circulating supply is reached by
  subtracting from total issued, and the page is built to show that arithmetic.
- **The gap is the non-circulating amount.** The trend chart fills the area
  between the circulating line and the issued cap so that the area *is* the
  quantity.
- **Bars under 1%.** Small items are drawn at a minimum height, and the page
  states that they are drawn larger than their true share. Slice geometry is
  never distorted for the same purpose.
- **Absolute value and percentage, always together.**
- **It does not go stale quietly.** A failed RPC does not block deployment, but
  the reason is shown on the page; if the cron dies, the page reports STALE.
