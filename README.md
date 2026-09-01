# NXPC circulation

A static page that publishes NXPC circulating supply and bridged amounts. It is
built for GitHub Pages and has no backend.

> ## ⚠️ Preview build — the data is not real
>
> **This site is a work-in-progress preview. Every address and every figure it
> shows is placeholder data, not a real value.** Nothing here should be quoted,
> indexed, or relied on for any purpose — not for trading, accounting,
> reporting, or exchange listings.
>
> The chain id, block height and block timestamp are read from a live RPC, so
> they move. That does not make the supply figures real. The registries are
> still being filled in, and the numbers derived from them will change.
>
> The banner at the top of every page says the same thing. Both stay until the
> registries carry audited addresses and the disclaimer is removed on purpose.

## What it is for

1. A **canonical wallet registry** — which address is excluded from circulating
   supply, and on what grounds.
2. Letting anyone check `circulating = total issued − burned − non-circulating`
   directly on the page, without trusting a database.
3. (Later) a machine-readable circulating-supply endpoint for aggregators.

## Tabs

| Tab | Path | Contents |
|---|---|---|
| Supply | `/nxpc/` | Circulating supply, the equation, the trend, bridged amounts, the registry |
| Addresses | `/nxpc/addresses/` | Contracts and EOAs the team operates, with balances |

Both tabs share one shell — head, top bar, footer, theme toggle and the
freshness watcher all live in `src/layouts/Site.astro`.

### Managed address registry — `src/data/addresses.yaml`

This file has a different job from the supply registry (`wallets.yaml`). That
one is the record of **what gets subtracted from circulating supply**; this one
is the list of **what we hold**.

| Field | Required | Value |
|---|---|---|
| `id` | ✅ | Unique key |
| `type` | ✅ | `contract` \| `eoa` |
| `category` | ✅ | `bridge` \| `vault` \| `treasury` \| `ops` \| `token` \| `infra` |
| `chain` | ✅ | `henesys` \| `c-chain` |
| `label` / `owner` | ✅ | Noun phrase per locale, `{ en }` |
| `address` | ✅ | 20-byte hex |
| `standard` | — | `erc20` \| `erc721` — when present, name/symbol/totalSupply are read too |
| `balanceHint` | — | Stand-in balance, used only while the file is marked `# placeholder` |

Zod validates it at build time. Duplicate ids, duplicate addresses, malformed
addresses and a `standard` attached to an EOA all fail the build.

**Balances are read on Henesys only.** `c-chain` rows stay `not read` — reading
them needs a second RPC endpoint, and the rule for this page is one public
Henesys RPC. The structure is there for when that changes.

Native balances and ERC-20/721 metadata go out in a **single `aggregate3`**.
Mixed types are safe: `allowFailure` isolates each item.

**To switch to real data**: fill in the addresses and delete the `# placeholder`
line at the top of the file. `balanceHint` is then ignored and balances are read
on-chain.

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

## Charts and interaction

**3D donut — one ring, cut into slices.** Supply distribution draws the whole
issued amount as a single ring and cuts it into the tiers. The donut sits above
the legend so that switching views never moves the chart.

The geometry is built like this. A tilt of `ry = rx × 0.48` gives the
looking-down angle. Each slice draws its own **top face, outer wall, inner wall,
radial cut faces, bevel bands and seam** — all of it scoped to the slice rather
than the ring, so that a slice pulled out on hover takes its own edges with it.
Leaving the bevel on the ring left a white hoop floating in place when a slice
moved away.

Only the front of the outer wall is visible (`sin θ > 0`) and only the back of
the inner wall shows through the hole, so each is clipped to that range. Slices
are painted **back to front by their most forward point**, and the order is
recomputed every animation frame, because the order changes as the angles do.

`src/lib/donut.ts` holds the pure geometry and nothing else — no colour, no
shading, no labels. Both the server render and the client tween call it, because
computing the shape twice makes slices jump the moment a transition ends.

Two constants in there earn their keep:

- `EPS = 0.0022` — adjacent paths that meet exactly leave a white antialiasing
  hairline. Slices overlap by this much when drawn.
- `BEVEL = 0.024` — a radial-only band. Bevelling the radial edges too carved
  visible grooves at every slice boundary.

**Gaps are proportional, or there are no gaps.** Subtracting a fixed gap from
each arc inflates small slices and shrinks big ones. The span is reduced once
(`span = TAU − n·gap`) and every arc takes its share of what is left, so all
arcs scale by the same constant. The ring currently runs with no gap at all.

**View changes morph, they do not redraw.** Every view's SVG contains the union
of all slices, so a slice leaving a view shrinks to zero width instead of
vanishing between two renders. Departing slices are then marked `data-empty` and
made unfocusable, so a zero-width slice cannot be tabbed to or hovered.

**Labels only where they fit; the rest on hover.** Per-slice lead lines were
removed — they crowded the ring at small shares. A slice large enough carries
its share inline; everything else is a hover card.

Label colour and halo are **theme tokens**, not fixed values. The slices are
translucent, so the effective background differs per theme, and a fixed colour
fails contrast on one side. Measured: 13.96 and 4.63:1, both AA.

**The viewBox is derived from the outermost thing drawn**, not from the donut
radius. Sizing to the radius clipped the decorative ring and the backlight — 25px
were being cut off the left edge in practice.

**The legend is paired with the slices.** Matching by colour alone fails for
neighbouring hues. Hovering either side lights up the other and pushes the slice
out. Each row carries a share bar under the value, so the ordering is readable
without reading the numbers.

**Segment hover cards.** A colour with no label says nothing. The category bar,
the legend and the donut all use the same `data-*` contract (`data-label`,
`data-value`, `data-pct`, `data-sub`, `data-tag`), and one function in
`src/lib/segcard.ts` attaches to all three. The browser's native `title` tooltip
is not used: it is slow and cannot be styled. Segments are `<button>`s, so they
are reachable by keyboard.

**Range chips select by date, not by point count.** `slice(-30)` meant thirty
days while the series was daily; once the backfill filled it in weekly, the same
code returned thirty *weeks* and 90D, 1Y and All drew the same picture.
`src/lib/window.ts` cuts on timestamps instead, and it has no imports on purpose
— pulling in `series.ts` would drag zod, yaml and `history.csv` into the client
bundle.

**Theme transitions.** `data-theme-ready` is stamped after the first paint and
transitions start from there; enabling them earlier makes the initial render
animate in. The transition list is narrowed to `background-color`,
`background-image`, `border-color`, `color`, `fill`, `stroke` and `box-shadow`,
so layout is never animated. Everything is off under
`prefers-reduced-motion`.

### Findings from review that are worth keeping

- **ERC-20 `totalSupply` was being stored as a raw uint256.** `decimals()` was
  read and never applied, so real data would have been published 10^18 times too
  large. ERC-721 `totalSupply` is a count and stays as is.
- **Theme tokens declared in only one of the dark blocks.** The OS dark path was
  fine while the toggled dark path kept light shading. A token has to exist in
  every block that can be active.
- **Specificity of the transition blanket.** `[data-theme-ready] …` is an
  attribute selector, so it ties with a class (0,1,0), and being later it
  overrode component hover easing. Wrapping the whole selector in `:where()`
  drops it to 0,0,0.
- **`flex: 1` on the mobile tab bar.** `flex-basis: 0%` meant `width: 100%` did
  nothing and the tabs were clipped at 320px.
- **`tr[hidden]` did not hide anything.** `table.wallets tr { display: block }`
  in the mobile card layout beat the `hidden` attribute, so the wallet filter
  looked dead on phones.
- **A `1Y` chip rendered as pressed while the server drew the whole series.**
  The graph only changed once you clicked the chip that was already active.
- **Table summaries were empty without JS.** Both tables now render server-side.

## No prose on the page

The page has no explanatory paragraphs. It carries labels, units and table
headers. Where an explanation is needed it becomes **a table or a legend**, not
a sentence.

| Was a sentence | Became |
|---|---|
| "The solid line is circulating supply, the dashed line is the issued cap…" | A line-sample key under the chart (`.chart-key`) |
| "Excluding the amount held by NXPCRecycleVault…" | A definition list under the hero (`.hero-alt`) |
| "…is excluded from circulating supply but included in total issued…" | A 3×3 scope table (`table.mini`) |
| Past/present/future series explanation | A three-row source table |
| A `note` on every wallet | Deleted. The `holder` column carries it as a noun phrase |

The one exception is the lede under the page title, which introduces the token
itself, and the preview warning at the top of the page.

## Stack

**Astro 7 + TypeScript.** No framework runtime is shipped to the browser.

There is one reason for that choice. The current MSU Explorer is a Nuxt SPA:
`curl` returns 190KB that contains the word "circulating" **zero** times. Build
the disclosure page as an SPA and it reproduces the problem it set out to fix.
Astro bakes the numbers and the charts into the HTML at build time.

```
$ curl .../index.html | grep -oE '[0-9]{1,3}(,[0-9]{3}){2,}'
1,000,000,000
223,963,962
...
```

Most of those numbers live inside the chart SVG, which is why the charts are
server-rendered strings rather than a client-side drawing library.

About 23KB of JavaScript reaches the browser: the freshness watcher, the range
chips, the donut morph and the table filter.

## Running it

```bash
npm ci --ignore-scripts
npm run dev       # dev server
npm run build     # typecheck + static build → dist/
npm run preview   # serve the build
```

## Data

### RPC — public endpoint only

| Item | Value |
|---|---|
| Endpoint | `https://henesys-rpc.msu.io` |
| Chain id | `68414` (`0x10b3e`) |
| Multicall3 | `0x99423C88EB5723A590b4C644426069042f137B9e` (reads only) |

**Measured 2026-08-25** — these numbers are encoded in the code.

| Item | Measurement |
|---|---|
| Mean block time | 2.08s (~41,500 blocks/day) |
| JSON-RPC batch limit | **10**. From 11 the node returns HTTP 500 with a plaintext `too many requests` |
| Multicall3 `aggregate3` | 100 items 0.72s / 200 items 1.28s / 400 items 3.63s — each a **single** `eth_call` |

The number of wallets does not change the request count. The batch limit of 10
does not apply to a multicall.

The node also serves archive reads: `eth_getBalance` at historical blocks works
back to genesis. The backfill depends on that.

### Three layers

```
Build time (GitHub Actions)   ← the numbers of record
  one Multicall3 read of the current state → baked into the HTML,
  and written to src/data/snapshots/YYYY-MM-DD.json

Browser (~23KB)               ← freshness only
  one eth_blockNumber, compared against the baked block → FRESH / STALE
  It never overwrites a baked number. It does not call while the tab is hidden.

Git history                   ← the time-series database
  RPC cannot hand you the past. One commit is one data point.
```

## The supply series — three sources

| Range | Source | Written by |
|---|---|---|
| Past | `src/data/history.csv` | `scripts/backfill.mjs`, run by hand |
| Present | Weekly cron, Thursday 00:00 UTC | GitHub Actions |
| Future | `src/data/snapshots/*.json` | the same cron |

**Both sources store inputs and derive circulating supply.** Letting a file
state circulating supply directly allows it to disagree with the equation at the
top of the page, and then the graph lies. Past and present run through the same
`fold()`, which is what makes the line continuous.

When a date exists in both, the **snapshot wins** — a value read on-chain beats
one filled in by hand.

The chart draws the two ranges differently: uploaded range dashed, collected
range solid, a vertical dashed rule at the boundary. The key underneath gives the
day count of each range, and a gap between the two is reported as a warning.

### Backfill — `scripts/backfill.mjs`

Reconstructs history from the archive node.

- Date → block by binary search on block timestamps. The block interval is not
  constant: 2025-05-15 is block 69,737 and 2026-09-01 is block 19.4M, so
  interpolating from an average lands in the wrong week.
- `eth_getBalance` at that block for every registry address, batched at 10.
- A coverage guard (`--min-coverage`) refuses to write a row where the registry
  fails to account for enough of the supply.

Coverage before 2025-10-30 was 24.5% until seven historical wallets were added
to the registry — genesis holdings sat in contracts that were later migrated.
The changeover is at block 6,682,141 (2025-10-30 09:47 UTC), where coverage
jumps to 99.8%.

### Collector — `scripts/collect.mjs`

Writes one snapshot per run and refuses to write a bad one.

```bash
npm run collect -- --dry-run     # read and print, write nothing
npm run collect -- --audit       # check every stored snapshot against the registry
npm run collect -- --date=…      # write a specific date
npm run collect -- --force       # write despite a failed check
```

It is deliberately separate from the build. When the build wrote snapshots as a
side effect of rendering, a local `npm run build` would overwrite that day's
record, a partial read would still be stored, and a rendering error meant no data
at all. Collection now fails closed: if a check fails, **nothing is written**.

Checks: any failed read, any registry item without a value, the equation staying
inside its bounds, the sum of held balances not exceeding total issued, and a
day-over-day move within `--max-drift` (5% by default).

`--audit` exists because changing the registry silently invalidates older
snapshots: a key that no longer matches reads as zero, and that date alone spikes
on the graph. Four snapshots were deleted after exactly that happened.

### History file format — `src/data/history.csv`

```csv
date,total_issued,burned,non_circulating,bridged,block
2025-07-19,1000000000,3100000,810877030,21145798,2562000
```

| Column | Required | Description |
|---|---|---|
| `date` | ✅ | `YYYY-MM-DD`, ascending, no duplicates |
| `total_issued` | ✅ | Total issued at that point (NXPC) |
| `burned` | ✅ | Cumulative burned at that point |
| `non_circulating` | ✅ | Sum of registry wallet balances at that point |
| `bridged` | ✅ | Amount locked for the C-Chain bridge at that point |
| `block` | — | Block height. Leave empty if unknown |

There is **no circulating column**. It is derived as
`total_issued − burned − non_circulating`.

Lines starting with `#` are comments. A `# placeholder` line at the top marks the
file as stand-in data and puts a banner on the page — delete that line when the
data is real.

Validated at build time. All of the following fail the build:

| Mistake | Result |
|---|---|
| Malformed date | `history.csv row 402 failed validation: date — must be YYYY-MM-DD` |
| burned + non-circulating > total issued | `row — burned + non-circulating exceeds total issued` |
| bridged > circulating | `row — bridged exceeds circulating supply` |
| Negative value | `burned — …` |
| Column count mismatch | `row 402: column count differs from the header (5 ≠ 6)` |
| Duplicate date | `history.csv contains 2026-08-23 twice` |
| Missing required column | `header has no 'non_circulating' column` |

### The wallet registry is schema-checked

`src/data/wallets.yaml` is validated by Zod at build time. All of these fail the
build:

| Mistake | Result |
|---|---|
| 39-character address | `wallets.yaml[0.address] — not a valid 20-byte address` |
| `strictCirculating` missing | `wallets.yaml[0.strictCirculating] — expected boolean, received undefined` |
| Misspelled `tier` | `wallets.yaml[2.tier] — Invalid option: expected one of …` |
| Duplicate `id` | `wallets.yaml[] — duplicate id` |
| `share` without `shareSource` | `share needs a shareSource` |
| Shares of one address not summing to 1 | `shares of the same address must add up to 1` |

The point is to stop a wrong address reaching a disclosure page before it is
deployed.

Two fields decide how a wallet is counted, and they are not the same thing:

- `tier` decides the **policy** figure. Four tiers are subtracted —
  `burn`, `locked`, `team`, `fusion` — matching the published policy.
- `strictCirculating` decides the **stricter** figure, which additionally
  removes anything still under issuer control. It has no default, so every entry
  has to state it.

### Adding a read

One line in the `READS` array in `src/lib/reads.ts` produces both the multicall
calldata and the screen item.

```ts
{ key: 'mse-supply', kind: 'call', address: MSE, abi: ERC721_ABI, fn: 'totalSupply' }
```

Mixing ERC-20 and ERC-721 is safe — `allowFailure` in `aggregate3` isolates each
item. Asking an ERC-721 for `decimals()` fails that item only.

> **Trap**: `eth_call` against an address with no code does not revert. The EVM
> returns **success with empty returndata**. Decoding on the success flag alone
> turns a typo'd address into a silent "balance 0" on the page. viem treats empty
> data as a decode failure, so it lands in `failures` instead.

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
   in `src/layouts/Site.astro`, plus the warning at the top of this file.
7. Build. The placeholder banners disappear and the snapshot archive starts
   recording.

## Deployment

`.github/workflows/deploy.yml` — on push, on two crons, and on manual dispatch.

| Trigger | Effect |
|---|---|
| push to `main` | rebuild and deploy |
| `0 0 * * 4` (Thursday) | add a point to the series, then rebuild |
| `0 0 * * *` (daily) | rebuild only — keeps the current numbers from going STALE |
| manual dispatch | rebuild, with snapshot collection as an input |

Thursday is not arbitrary: the backfilled grid runs on Thursdays, so continuing
on the same weekday keeps the spacing even.

Set the repository's **Settings → Pages → Source to `GitHub Actions`** — not the
branch-based mode.

`base: '/nxpc'` in `astro.config.mjs` is the project-page path. Renaming the
repository means changing it too.

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

## Palette

The four MSU brand colours (the petals in `favicon.svg`) come from
`NEXPACE-Limited/msu-skills`, `web/app/globals.css`.

**Colour is reserved for what is moving.** Amounts that are merely held
(non-circulating) or gone (burned) are greys; the four brand colours stay on the
circulating side. One glance separates live supply from parked supply.

| State | Token | Light / Dark |
|---|---|---|
| Circulating · Henesys L1 | `--c-circ` (mint) | `#30efa6` / `#4bbc91` |
| Circulating · C-Chain bridge | `--c-bridge` (blue) | `#669dff` / `#698ecd` |
| Non-circulating | `--c-locked` (grey) | `#7c8683` / `#8b9591` |
| Burned | `--c-burn` (dark grey) | `#4d5654` / `#5f6a66` |

The non-circulating ramp (`--lock-1` … `--lock-5`) is a lightness ladder in one
hue: **hue names the state, tint names the item inside it.** Removing saturation
turns it grey and loses the brand feel, so only lightness moves.

The remaining two petals (pink, purple) are used for the token and infra
categories on the Addresses tab.

### Two layers: field and ink

The brand colours are **fields** — surfaces you put ink on. As text or a line on
white they only reach 1.50–3.62:1. msu-skills hits the same wall and keeps a
separate `--link` (`#166c4b`, mint darkened). The same split applies here.

| Layer | Used for | Light | Dark |
|---|---|---|---|
| `--c-*` | bar segments, area fills | brand colour | dark brand colour |
| `--c-*-ink` | lines, text, tags | darkened variant (≥4.5:1) | same as field (±1 step) |

### Theme

Two states: **light** and **dark**, defaulting to light. The site does not follow
the OS setting — light is the hard default, and there is no
`prefers-color-scheme` block.

`color-scheme` resolves to a concrete value, so the chosen setting and the
resolved mode are stamped separately: `data-theme-setting` and `data-color-mode`.
The localStorage key is `msu-theme`, shared with msu-skills.

The toggle script is inline in `<head>`. Running it later flashes the opposite
theme for one frame.

**Never declare a component colour inside a theme block only.** Without the
stamp it does not apply, and one theme's text ends up on the other theme's
background.

Both themes pass a full body-text contrast audit, alpha compositing included.

### Measured colour distances

Pairwise ΔE between the four brand colours is 23.7–118.0. The closest pair is
pink ↔ purple (23.7), and they are never adjacent in the category bar; the
closest actually-adjacent pair is `--lock-5` ↔ pink (ΔE 35.0). Steps inside the
ramp are about ΔE 10.

Changing a colour means re-measuring and updating this table.

## Mobile

| Breakpoint | Behaviour |
|---|---|
| ≤720px | Charts swap to the narrow SVG, wallet table becomes cards, KPI 2×2 |
| ≤620px | Two-row top bar, 40px touch targets |
| ≤400px | KPI and equation in one column |

**Two chart variants are rendered and CSS shows one.** Stretching one needs
`preserveAspectRatio="none"`, which stretches the x-axis alone and squashes the
text horizontally. The narrow variant has a viewBox width of 460, so the same
text is relatively larger. It works without JavaScript.

**Below 720px each wallet row becomes a card.** Horizontal scrolling means
nobody on a phone ever sees the right half of the table. Each `td` carries a
`data-label` that `::before` renders above the value.

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
