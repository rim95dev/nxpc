# NXPC circulation

A page that publishes how much NXPC is in circulation, and which addresses the
rest of it sits in.

**→ [rim95dev.github.io/nxpc](https://rim95dev.github.io/nxpc/)**

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

## Why it exists

Circulating supply is a single number that everyone quotes and almost nobody can
check. Explorers publish a figure without showing the arithmetic, so anyone
trying to reason about NXPC — how much is really liquid, what is parked where —
has to take it on faith.

This page is the arithmetic, in public:

1. **A wallet registry.** Which address is excluded from circulating supply, and
   on what grounds. One file, versioned, with the reasoning written down.
2. **A number you can re-derive.** `circulating = max supply − burned −
   non-circulating`, with every term on screen and every address one click from
   a block explorer.
3. **A history.** A point a day going back to launch, so the figure can be read
   as a trend rather than a snapshot.

## What it shows

| Figure | Meaning |
|---|---|
| **Max supply** | The 1,000,000,000 cap. Fixed. |
| **Burned** | Sent to the burn address. Unrecoverable. |
| **Non-circulating** | The undistributed reward pool, and team and advisor vesting. |
| **Circulating supply** | What is left. This is the headline figure, and it follows the published token circulating supply policy. |
| **Free float** | A stricter reading: circulating supply minus everything still under issuer control — treasury, the bridge lock, the Fusion reserve, ecosystem and operational wallets. Always well below the headline. |

Both are shown, deliberately. The headline figure is what a listing or a policy
document means by "circulating supply". The free float is what is actually loose
in the market. They are far apart, and that gap is worth seeing.

The **Fusion reserve** (NXPCRecycleVault) counts as circulating: NXPC enters it
when an item is minted through Fission and leaves again through Fusion, and
nothing holds it there. It is drawn as its own slice so its size stays visible
inside the total.

### Two tabs

| Tab | Contents |
|---|---|
| **Supply** | The figure, the arithmetic behind it, the composition, and the trend since launch |
| **Addresses** | The contracts and wallets the team operates, with their balances |

## Where the numbers come from

Every figure is read from a **public RPC** — twice, on purpose.

It is read at build time and written into the HTML, so the numbers are in the
page itself: `curl` returns them, and so does a reader with JavaScript turned
off. Then, on load, the page reads the same balances again live and replaces
them. The pill in the header says **live** once that has happened. If the read
fails for any reason, the built-in figures stay exactly as they were rather than
being replaced by blanks or zeros.

That live read is a single request. Every wallet balance and the chain head are
packed into one `aggregate3` call, so adding wallets to the registry changes the
size of the request, never the number of them.

Supply figures come from Henesys (`henesys-rpc.msu.io`) and nowhere else. The
address tab additionally reads Avalanche C-Chain through Ava Labs' public node,
because NXPC exists there as an ERC-20 and those balances are worth showing; that
endpoint has no bearing on any supply figure.

Every wallet in a hover card links to that address on
[Snowtrace](https://68414.snowtrace.io), where the same balance can be read
independently.

| What | When |
|---|---|
| The headline figures and the composition | Live, on every visit |
| The built-in figures behind them | Rebuilt daily |
| A new point on the trend | Added daily |
| Everything before that | Reconstructed from archive reads, daily from 2025-05-15 |

The trend chart stays as built — it is a daily series, and a live point on the
end would only make the last segment twitch. The page also compares the block it
was built at against the chain head and marks itself **STALE** when it has fallen
behind, so a stopped job shows up on the page instead of quietly serving old
numbers.

## Learn more

- [Tokenomics · NXPC](https://docs.nexpace.io/tokenomics/nxpc/)
- [Allocation](https://docs.nexpace.io/tokenomics/nxpc/allocation/)
- [Unlocked supply schedule](https://docs.nexpace.io/tokenomics/nxpc/unlocked-supply-schedule/)

## Running it

```bash
npm ci --ignore-scripts
npm run dev       # dev server
npm run build     # typecheck + static build → dist/
```

Astro and TypeScript, no backend, deployed to GitHub Pages.

## Documentation

| Document | Contents |
|---|---|
| [docs/data.md](docs/data.md) | Where each figure comes from, the registry schemas, the backfill and collector scripts, the history file format |
| [docs/rendering.md](docs/rendering.md) | How the charts are drawn, the palette, contrast measurements, mobile behaviour |
| [docs/development.md](docs/development.md) | Stack, repository layout, i18n, deployment, and the steps to replace the placeholder data |
