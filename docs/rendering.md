# Rendering notes

How the charts are drawn and why they are drawn that way. Constants in here were
arrived at by measurement, not taste — changing one usually means re-measuring.

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

**Addresses are one click from the number.** Every hover card lists the wallets
its segment adds up, each linking to that address on
[Snowtrace](https://68414.snowtrace.io). Snowtrace runs a per-chain instance for
Avalanche L1s and `68414` is Henesys — the bare `snowtrace.io` is C-Chain and does
not resolve these addresses. The card takes the pointer while open and closes on a
short delay, so the gap between segment and card can be crossed.

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
