/**
 * Builds SVG markup as a string.
 *
 * Why it returns a string: the same function has to be usable at build time
 * (static render) and on the client (redrawing when the period changes).
 * That way the default view ships the graph inside the curl response, without JS.
 *
 * Every chart uses preserveAspectRatio="xMidYMid meet" + height:auto.
 * "none" would scale x and y independently, so on a narrow screen the x axis is
 * compressed on its own and the glyphs come out squashed.
 * Instead we build two sets with different viewBox widths (wide / narrow) and
 * swap between them with CSS.
 *
 * Every string and number format is injected — there is no locale in this file.
 */
import type { Fmt } from './format';
import { boxOf, domainOf, geom, innerH, innerW, visible, xOf, yOf, type Domain } from './trend';
import type { Dict } from '../i18n';
import type { SeriesPoint } from './series';
import * as D from './donut';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** For attribute values. The quote matters here — a label carrying one would end the attribute. */
const escA = (s: string) => esc(s).replace(/"/g, '&quot;');

/**
 * Wallets behind a segment, packed into one attribute.
 * Kept as JSON so the reader does not have to guess at a separator: labels are
 * free text and any delimiter picked here would eventually appear inside one.
 */
const packWallets = (ws: SegWallet[] | undefined) =>
  ws && ws.length ? ` data-wallets="${escA(JSON.stringify(ws))}"` : '';

export interface ChartCtx {
  fmt: Fmt;
  t: Dict['chart'];
}

/** Narrow-screen variant. Shrinking the viewBox width makes the same text relatively larger. */
export interface ChartOpts extends ChartCtx {
  narrow?: boolean;
  /** Prefix that keeps defs ids from colliding when the same chart is drawn twice in one document. */
  uid?: string;
  /** Visible time window for the trend chart. Defaults to the full extent of the rows. */
  domain?: Domain;
}

const open = (w: number, h: number, cls: string, label: string, data = '') =>
  `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img"` +
  ` aria-label="${esc(label)}" class="${cls}"${data}` +
  ` style="width:100%;height:auto">`;

export interface PieSlice {
  id: string;
  label: string;
  value: number;
  color: string;
  sub?: string;
  subLabel?: string;
  tag?: string;
  tagKind?: 'yes' | 'no' | 'burn';
  wallets?: SegWallet[];
}

/** Below this share the text does not fit inside the slice. Those slices are read only through the hover card. */
const LABEL_ABOVE = 0.08;

export function pie3d(slices: PieSlice[], o: ChartOpts): string {
  const { fmt, narrow = false } = o;

  const rxOut = narrow ? 146 : 206;
  const ryOut = rxOut * 0.48;
  const HOLE = 0.52;                       // inner hole ratio
  const rxIn = rxOut * HOLE;
  const ryIn = ryOut * HOLE;
  const depth = narrow ? 26 : 33;          // slice thickness
  const bevel = narrow ? 4 : 5;           // bevel band width on the top face rim (px)
  const uid = (o.uid ?? '') + (narrow ? 'n' : 'w');

  const total = slices.reduce((n, s) => n + s.value, 0) || 1;
  const TAU = Math.PI * 2;
  const START = -Math.PI / 2;

  /* The slices are butted together into a single ring instead of being separated.
     With a gap, the space next to a thin slice (0.63% = 2.3°) grows as wide as the slice
     itself and the ring looks broken.
     The boundaries are drawn only as a thin seam, and the sense of thickness is carried
     by the bevel that runs around the whole ring. */
  const gap = 0;
  const span = TAU;
  /* When two adjacent paths meet exactly, antialiasing leaves a white hairline.
     Only for drawing, both ends are overlapped by this much (0.13°). Labels and seams use
     the exact angles. */
  const EPS = 0.0022;

  let acc = START + gap / 2;
  const angles = slices.map((sl, i) => {
    const share = sl.value / total;
    const a0 = acc;
    const a1 = acc + span * share;
    acc = a1 + gap;
    return { sl, i, a0, a1, mid: (a0 + a1) / 2, share };
  });

  /* The padding is worked backwards from "the outermost thing we draw". On hover a slice
     pops out 12px along its bisector, so that much is always kept free. Thin slices are
     explained by the hover card rather than pulled out with leader lines, so the left and
     right padding are the same no matter what the view is. */
  const OUT = 1 + 12 / rxOut;
  const padL = Math.round(rxOut * (OUT - 1) + 16);
  const padR = padL;
  const padTop = Math.round(ryOut * (OUT - 1) + 16);
  const cx = padL + rxOut;
  const cy = padTop + ryOut;
  const W = Math.round(padL + rxOut * 2 + padR);
  const H = Math.round(cy + ryOut * OUT + depth + 18);

  const P = (a: number, k: number) =>
    [cx + rxOut * k * Math.cos(a), cy + ryOut * k * Math.sin(a)] as const;
  const n2 = (v: number) => v.toFixed(1);

  /* donut.ts owns the geometry — the server and the client (the view-switch animation)
     must use the same function, or the slices jump the moment the transition ends. */
  const box: D.Box = { cx, cy, rxOut, ryOut, hole: HOLE, depth };
  const arcs = angles.map((a) => ({ a0: a.a0, a1: a.a1, mid: a.mid, share: a.share }));
  const ordered = D.paintOrder(arcs).map((i) => angles[i]!);


  const defs =
    `<defs>` +
    /* Confines the inner wall so it does not leak outside the hole. */
    `<clipPath id="dHoleC-${uid}" clipPathUnits="userSpaceOnUse">` +
      `<ellipse cx="${n2(cx)}" cy="${n2(cy)}" rx="${n2(rxIn)}" ry="${n2(ryIn + depth)}"/>` +
      `</clipPath>` +
    // outer wall — a vertical face, so the shading runs horizontally, and being glass both ends are bright (Fresnel)
    `<linearGradient id="dWall-${uid}" gradientUnits="userSpaceOnUse" x1="${n2(cx - rxOut)}" y1="0" x2="${n2(cx + rxOut)}" y2="0">` +
      `<stop offset="0" stop-color="#fff" stop-opacity=".34"/>` +
      `<stop offset=".12" stop-color="#000" stop-opacity=".14"/>` +
      `<stop offset=".38" stop-color="#fff" stop-opacity=".12"/>` +
      `<stop offset=".68" stop-color="#000" stop-opacity=".20"/>` +
      `<stop offset=".90" stop-color="#fff" stop-opacity=".10"/>` +
      `<stop offset="1" stop-color="#fff" stop-opacity=".36"/>` +
      `</linearGradient>` +
    // inner wall — it lies beyond the hole, so it is always in shadow
    `<linearGradient id="dHole-${uid}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#000" stop-opacity=".34"/>` +
      `<stop offset=".7" stop-color="#000" stop-opacity=".16"/>` +
      `<stop offset="1" stop-color="#fff" stop-opacity=".18"/>` +
      `</linearGradient>` +
    /* The layer that turns the top face into a cushion. Every slice has to share one
       light source (upper left) for the six slices to read as a single body. */
    `<radialGradient id="dTop-${uid}" gradientUnits="userSpaceOnUse"` +
      ` cx="${n2(cx - rxOut * 0.34)}" cy="${n2(cy - ryOut * 0.72)}" r="${n2(rxOut * 1.45)}">` +
      `<stop offset="0" stop-color="#fff" stop-opacity=".30"/>` +
      `<stop offset=".34" stop-color="#fff" stop-opacity=".09"/>` +
      `<stop offset=".64" stop-color="#000" stop-opacity=".06"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity=".26"/>` +
      `</radialGradient>` +
    // cut cross-section — it takes the light head on, so it is bright at the top and darkens downward
    `<linearGradient id="dCap-${uid}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#fff" stop-opacity=".26"/>` +
      `<stop offset=".5" stop-color="#000" stop-opacity=".14"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity=".34"/>` +
      `</linearGradient>` +
    /* Socket — the «hollow it left behind», revealed when a slice pops out on hover.
       Darker at the top and fading downward, so it reads as sinking inward. */
    `<linearGradient id="dSocket-${uid}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#000" stop-opacity=".42"/>` +
      `<stop offset=".55" stop-color="#000" stop-opacity=".26"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity=".14"/>` +
      `</linearGradient>` +
    `<radialGradient id="dCast-${uid}">` +
      `<stop offset="0" stop-color="#000" stop-opacity=".26"/>` +
      `<stop offset=".6" stop-color="#000" stop-opacity=".08"/>` +
      `<stop offset="1" stop-color="#000" stop-opacity="0"/>` +
      `</radialGradient>` +
    /* Bevel highlight — only the side that takes the upper-left light head on is lit.
       The darkening side is left out. Shading the band differently from the face makes the
       band brighter than the face in light mode and darker in dark mode, so it reads as a
       different object in each theme. */
    `<linearGradient id="dBevel-${uid}" gradientUnits="userSpaceOnUse"` +
      ` x1="${n2(cx - rxOut)}" y1="${n2(cy - ryOut)}" x2="${n2(cx + rxOut)}" y2="${n2(cy + ryOut)}">` +
      `<stop offset="0" stop-color="#fff" stop-opacity=".44"/>` +
      `<stop offset=".34" stop-color="#fff" stop-opacity=".20"/>` +
      `<stop offset=".70" stop-color="#fff" stop-opacity=".05"/>` +
      `<stop offset="1" stop-color="#fff" stop-opacity="0"/>` +
      `</linearGradient>` +
    `<filter id="dGlow-${uid}" x="-40%" y="-70%" width="180%" height="240%">` +
      `<feDropShadow dx="0" dy="1" stdDeviation="1.7" class="pie-halo"/>` +
      `</filter>` +
    `</defs>`;

  const labelLayer: string[] = [];
  const sockets: string[] = [];
  const parts: string[] = [];

  /* 1) Ground shadow — laid under the ring so it does not look like it is floating. */
  parts.push(
    `<ellipse cx="${n2(cx)}" cy="${n2(cy + depth + ryOut * 0.26)}" rx="${n2(rxOut * 1.0)}"` +
      ` ry="${n2(ryOut * 0.34)}" fill="url(#dCast-${uid})"/>`,
  );

  /* 2) The slices. Back to front: inner wall → outer wall → cut faces → top face. */
  for (const { sl, i, a0, a1, mid, share } of ordered) {
    const meta =
      ` data-seg="${esc(sl.id)}" data-label="${esc(sl.label)}" data-value="${esc(fmt.full(sl.value))}"` +
      ` data-pct="${esc(fmt.pct(share))}" data-color="${esc(sl.color)}"` +
      (sl.sub ? ` data-sub="${esc(sl.sub)}"` : '') +
      (sl.subLabel ? ` data-sublabel="${esc(sl.subLabel)}"` : '') +
      (sl.tag ? ` data-tag="${esc(sl.tag)}" data-tagkind="${esc(sl.tagKind ?? 'no')}"` : '') +
      packWallets(sl.wallets);

    const bits: string[] = [];
    const labelBits: string[] = [];
    /* A stroke in the same color with round joins is laid on top to round the corners. It
       only swells a few px in the radial direction and the angles stay the same, so the
       shares are untouched.
       The shading layers need the same stroke — covering only the fill leaves round/2 px of
       the swollen rim bare, and the bevel breaks there. */
    /* Three layers (base color → tone wash → shading) are stacked on the same path.
       data-p is the handle the client uses to find this face and swap its d when the view
       changes. */
    const skin = (d: string, grad: string, part: string) => {
      const tag = ` data-p="${part}"`;
      return [
        `<path d="${d}"${tag} fill="${sl.color}"/>`,
        `<path d="${d}"${tag} class="donut-wash"/>`,
        `<path d="${d}"${tag} fill="url(#${grad}-${uid})"/>`,
      ];
    };

    const pt = D.partsOf(box, { a0, a1, mid, share });
    /* The hollow — the «place it used to sit», revealed when a slice pops out on hover.
       It has to be the same color laid down darker to read as the groove that slice came
       out of. Left a neutral gray, the color breaks and it looks like a hole. It must not
       move with the slice, so it goes in a separate layer. */
    /* When a slice pops out, a cut face is revealed on the ring side too. It must not move
       with the slice, so it goes in a separate layer and is visible only while that slice
       is active. */
    sockets.push(
      `<g class="pie-socket" data-seg="${esc(sl.id)}" pointer-events="none">` +
        `<path d="${pt.cap}" data-p="cap" fill="${sl.color}"/>` +
        `<path d="${pt.cap}" data-p="cap" class="donut-wash"/>` +
        `<path d="${pt.cap}" data-p="cap" fill="url(#dSocket-${uid})"/>` +
        `</g>`,
    );
    bits.push(
      `<g clip-path="url(#dHoleC-${uid})">${skin(pt.iw, 'dHole', 'iw').join('')}</g>`,
      ...skin(pt.ow, 'dWall', 'ow'),
      /* The cut cross-section. While the ring is closed it has to hide between its
         neighbors, so it is kept hidden and revealed only when hover pops the slice out —
         that is what shows the thickness. */
      `<g class="pie-cap">${skin(pt.cap, 'dCap', 'cap').join('')}</g>`,
      ...skin(pt.top, 'dTop', 'top'),
      /* The bevel, the seam and the rim highlight go inside the slice as well. Drawn once
         for the whole ring, the white rim is left sitting in place on its own when a slice
         pops out on hover. The band overlaps only in the radial direction, so no joint
         appears against the neighbors. */
      `<path d="${pt.bevO}" data-p="bevO" fill="url(#dBevel-${uid})"/>`,
      `<path d="${pt.bevI}" data-p="bevI" fill="url(#dBevel-${uid})"/>`,
      `<path d="${pt.seam}" data-p="seam" fill="none" class="donut-seam"/>`,
    );

    const band = (1 + HOLE) / 2;
    if (share >= LABEL_ABOVE) {
      const [lx, ly] = P(mid, band);
      labelBits.push(
        `<g filter="url(#dGlow-${uid})">` +
          `<text x="${n2(lx)}" y="${n2(ly - 3)}" text-anchor="middle" class="pie-pct">${esc(fmt.pct(share))}</text>` +
          `<text x="${n2(lx)}" y="${n2(ly + 12)}" text-anchor="middle" class="pie-amt">${esc(fmt.compact(sl.value))}</text>` +
          `</g>`,
      );
    }

    // On hover it pops out slightly along the bisector. The entrance animation uses the same axis.
    const exX = (Math.cos(mid) * 10).toFixed(2);
    const exY = (Math.sin(mid) * 10 * 0.48).toFixed(2);
    const ex = ` style="--ex-x:${exX}px;--ex-y:${exY}px;--i:${i}"`;
    /* A slice with value 0 keeps its <g> too — when the view changes it has to grow out of
       it. But something invisible must not take tab focus or raise a hover card, so it is
       pulled out of the accessibility tree and out of pointer events. The client turns it
       back on at the end of the transition. */
    const empty = share <= 0;
    parts.push(
      `<g class="pie-slice" role="img"${empty ? ' data-empty="1" aria-hidden="true"' : ' tabindex="0"'}${ex}${meta}` +
        ` aria-label="${esc(sl.label)} ${esc(fmt.full(sl.value))} ${esc(fmt.pct(share))}">` +
        bits.join('') +
        `</g>`,
    );
    /* The labels are laid on their own layer above the slices. Kept inside a slice, another
       slice drawn in front covers the text and the contrast collapses (measured 2.4:1). Only
       data-seg is attached so the label moves with the slice, while the hover card stays
       bound to the slice alone. */
    if (labelBits.length) {
      labelLayer.push(
        `<g class="pie-slice pie-label-g" data-seg="${esc(sl.id)}"${ex} aria-hidden="true">` +
          labelBits.join('') +
          `</g>`,
      );
    }
  }

  /* The socket layer has to sit behind the slices — while a slice is in place it is completely hidden. */
  parts.splice(1, 0, `<g class="pie-socket-layer">${sockets.join('')}</g>`);

  /* Marks where the slice layer ends. When the client rebuilds the paint order it needs a
     reference point to insert «before this». */
  parts.push(`<g class="pie-order-mark"/>`);

  const geomAttr = ` data-geom="${cx},${cy},${rxOut},${ryOut},${HOLE},${depth}"`;

  return (
    open(W, H, `pie donut ${narrow ? 'is-narrow' : 'is-wide'}`,
      slices.map((x) => x.label).join(' / '), geomAttr) +
    defs +
    `<g style="--cx:${cx}px;--cy:${cy}px">` +
    parts.join('') +
    labelLayer.join('') +
    `</g></svg>`
  );
}

/* ------------------------------------------------------------------ *
 * Category bar — full width = total issued
 * ------------------------------------------------------------------ */
/** One wallet row inside a hover card. `href` points at the explorer for the chain it lives on. */
export interface SegWallet {
  label: string;
  address: string;
  href: string;
}

export interface Segment {
  id: string;
  label: string;
  value: number;
  color: string;
  /** Supporting information shown alongside in the hover card (a noun phrase). */
  sub?: string;
  /** Row name for sub. Falls back to the caller's default — this stops "holder" from being attached to a value that is not a holder. */
  subLabel?: string;
  /** Hover card badge — a state such as included / excluded / burned. */
  tag?: string;
  tagKind?: 'yes' | 'no' | 'burn';
  /** The wallets this segment adds up, each linked to the block explorer. */
  wallets?: SegWallet[];
}

export function categoryBar(segments: Segment[], total: number, o: { fmt: Fmt; legend?: boolean }): string {
  const { fmt } = o;
  const bar = segments
    .map(
      (s) =>
        `<button type="button" class="catbar-seg" style="flex-grow:${s.value};--seg-color:${s.color}"` +
        ` data-seg="${esc(s.id)}" data-label="${esc(s.label)}" data-value="${esc(fmt.full(s.value))}"` +
        ` data-pct="${esc(fmt.pct(s.value / total))}" data-color="${esc(s.color)}"` +
        (s.sub ? ` data-sub="${esc(s.sub)}"` : '') +
        (s.subLabel ? ` data-sublabel="${esc(s.subLabel)}"` : '') +
        (s.tag ? ` data-tag="${esc(s.tag)}" data-tagkind="${esc(s.tagKind ?? 'no')}"` : '') +
        packWallets(s.wallets) +
        ` aria-label="${esc(s.label)} ${esc(fmt.full(s.value))} ${esc(fmt.pct(s.value / total))}"></button>`,
    )
    .join('');

  if (o.legend === false) return `<div class="catbar is-cylinder">${bar}</div>`;

  const legend = segments
    .map(
      (s) =>
        `<li class="lg-item" data-seg="${esc(s.id)}" data-label="${esc(s.label)}" data-value="${esc(fmt.full(s.value))}" data-pct="${esc(fmt.pct(s.value / total))}" data-color="${esc(s.color)}"` +
        (s.sub ? ` data-sub="${esc(s.sub)}"` : '') +
        (s.subLabel ? ` data-sublabel="${esc(s.subLabel)}"` : '') +
        (s.tag ? ` data-tag="${esc(s.tag)}" data-tagkind="${esc(s.tagKind ?? 'no')}"` : '') +
        packWallets(s.wallets) +
        `><span class="sw" style="background:${s.color}"></span><span class="lg-label">${esc(s.label)}</span><span class="lg-val mono">${esc(fmt.compact(s.value))}</span><span class="lg-pct mono">${esc(fmt.pct(s.value / total))}</span></li>`,
    )
    .join('');

  return `<div class="catbar is-cylinder">${bar}</div><ul class="catlegend">${legend}</ul>`;
}

/* ------------------------------------------------------------------ *
 * Trend — the circulating area plus the total issued ceiling line.
 * The area between the two lines is the non-circulating amount.
 * ------------------------------------------------------------------ */
export function areaChart(rows: SeriesPoint[], o: ChartOpts): string {
  const { fmt, t, narrow = false } = o;
  const b = boxOf(narrow, rows[0]!.totalIssued * 1.02);
  /* The domain is the window; the rows are the whole series. A range chip moves
     the domain, so switching ranges is a zoom rather than a different chart. */
  const d = o.domain ?? domainOf(rows);
  const iW = innerW(b), iH = innerH(b);
  const X = (tv: number) => xOf(b, d, tv);
  const y = (v: number) => yOf(b, v);
  const g = geom(rows, b, d);
  /* Annotations read the visible rows — the gap bracket and the date ticks
     describe what is on screen, not what is clipped away. */
  const vis = visible(rows, d);

  /* The layout and the window are passed through as data so the hover script and
     the range tween can recompute coordinates without re-parsing the SVG. */
  const meta =
    ` data-w="${b.W}" data-h="${b.H}" data-padl="${b.padL}" data-padr="${b.padR}"` +
    ` data-padt="${b.padT}" data-padb="${b.padB}" data-maxy="${b.maxY}"` +
    ` data-t0="${d.t0}" data-t1="${d.t1}"`;

  const gradId = narrow ? 'areaGradN' : 'areaGradW';
  const clipId = narrow ? 'areaClipN' : 'areaClipW';
  const parts: string[] = [
    `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="var(--c-circ)" stop-opacity="0.40"/>` +
      `<stop offset="100%" stop-color="var(--c-circ)" stop-opacity="0.03"/>` +
      `</linearGradient>` +
      /* Everything that moves with the domain is clipped to the plot rect, so a
         zoom pushes the curve past the edge instead of over the axis labels. */
      `<clipPath id="${clipId}">` +
      `<rect x="${b.padL}" y="${b.padT - 2}" width="${iW}" height="${iH + 2}"/>` +
      `</clipPath></defs>`,
  ];

  const ticks = narrow ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  for (const f of ticks) {
    const v = b.maxY * f;
    parts.push(
      `<line x1="${b.padL}" y1="${y(v)}" x2="${b.padL + iW}" y2="${y(v)}" stroke="var(--rule)" stroke-width="1" opacity="${f === 0 ? 0.9 : 0.5}"/>`,
      `<text x="${b.padL + iW + 8}" y="${y(v) + 4}" class="ax-label">${esc(fmt.compact(v))}</text>`,
    );
  }

  /* The plot layer. The tween rewrites the `d` of these five and nothing else. */
  const plot: string[] = [
    `<path class="gap-band" d="${g.band}" fill="var(--c-locked)" opacity="0.12"/>`,
    `<path class="area-fill" d="${g.area}" fill="url(#${gradId})"/>`,
  ];

  // The line is split by source — the hand-entered history and the on-chain measurements have to be told apart by eye.
  plot.push(
    `<path class="line-dash" d="${g.dashed}" fill="none" stroke="var(--c-circ-ink)" stroke-width="2" stroke-linejoin="round" stroke-dasharray="6 3" opacity="${g.dashed ? 0.75 : 0}"/>`,
    `<path class="line-solid" d="${g.solid}" fill="none" stroke="var(--c-circ-ink)" stroke-width="2.5" stroke-linejoin="round" opacity="${g.solid ? 1 : 0}"/>`,
  );

  // handover point — daily aggregation piles up from here on
  const hx = g.handoverX;
  if (hx !== null) {
    const right = hx > b.padL + iW * 0.66;
    plot.push(
      `<line class="handover-line" x1="${hx}" y1="${b.padT}" x2="${hx}" y2="${b.padT + iH}" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="3 3" opacity="0.85"/>`,
      // The very top collides with the total issued dashed line and the y-axis ticks. It is placed inside the non-circulating band (empty space).
      `<text class="ax-note handover handover-text" x="${right ? hx - 7 : hx + 7}" y="${b.padT + iH * 0.3}" text-anchor="${right ? 'end' : 'start'}">${esc(right ? t.handoverRight : t.handoverLeft)}</text>`,
    );
  }

  parts.push(`<g class="plot" clip-path="url(#${clipId})">${plot.join('')}</g>`);

  parts.push(
    `<line x1="${b.padL}" y1="${y(rows[0]!.totalIssued)}" x2="${b.padL + iW}" y2="${y(rows[0]!.totalIssued)}" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="5 4"/>`,
    `<text x="${b.padL + 8}" y="${y(rows[0]!.totalIssued) - 7}" class="ax-note">${esc(t.totalIssuedLine)} ${esc(fmt.compact(rows[0]!.totalIssued))}</text>`,
  );

  const mid = vis[Math.floor(vis.length * 0.42)]!;
  const mx = X(mid.t);
  const gapTop = y(mid.totalIssued);
  const gapBot = y(mid.circulating);
  parts.push(
    `<g class="gap-mark">` +
      `<line x1="${mx}" y1="${gapTop + 4}" x2="${mx}" y2="${gapBot - 4}" stroke="var(--c-locked-ink)" stroke-width="1.5" opacity="0.95"/>` +
      `<line x1="${mx - 4}" y1="${gapTop + 4}" x2="${mx + 4}" y2="${gapTop + 4}" stroke="var(--c-locked-ink)" stroke-width="1.5"/>` +
      `<line x1="${mx - 4}" y1="${gapBot - 4}" x2="${mx + 4}" y2="${gapBot - 4}" stroke="var(--c-locked-ink)" stroke-width="1.5"/>` +
      `<text x="${mx + 8}" y="${(gapTop + gapBot) / 2 - 4}" class="ax-note gap">${esc(t.gapLabel)}</text>` +
      `<text x="${mx + 8}" y="${(gapTop + gapBot) / 2 + 12}" class="ax-note gap gap-v">${esc(fmt.compact(mid.totalIssued - mid.burned - mid.circulating))}</text>` +
      `</g>`,
  );

  const dateIdx = narrow
    ? [0, vis.length - 1]
    : [0, Math.floor(vis.length / 3), Math.floor((vis.length * 2) / 3), vis.length - 1];
  const dates = dateIdx
    .map((i, k) => {
      const anchor = k === 0 ? 'start' : k === dateIdx.length - 1 ? 'end' : 'middle';
      return `<text x="${X(vis[i]!.t)}" y="${b.H - b.padB + 22}" text-anchor="${anchor}" class="ax-label">${esc(fmt.date(vis[i]!.t))}</text>`;
    })
    .join('');
  parts.push(`<g class="ax-dates">${dates}</g>`);

  parts.push(
    `<g class="hover" opacity="0">` +
      `<line class="hover-line" y1="${b.padT}" y2="${b.padT + iH}" stroke="var(--ink-3)" stroke-width="1"/>` +
      `<circle class="hover-dot" r="3.5" fill="var(--c-circ-ink)" stroke="var(--canvas)" stroke-width="2"/>` +
      `</g>`,
  );

  return open(b.W, b.H, `area ${narrow ? 'is-narrow' : 'is-wide'}`, t.legendCirculating, meta) +
    parts.join('') + '</svg>';
}

/* ------------------------------------------------------------------ *
 * Sparkline
 * ------------------------------------------------------------------ */
/** One point of a sparkline: when it was measured, and what was measured. */
export interface SparkPoint {
  t: number;
  v: number;
}

/**
 * The x axis is time, not the row index — the same rule the trend chart follows.
 *
 * Spacing a series evenly by index only tells the truth while the points are evenly
 * spaced in time, and a series that mixes cadences (a backfilled grid, a cron that
 * misses a run, a snapshot taken by hand) is not. Drawn by index, a two-day step
 * takes the same width as a week and the recent end of the graph silently stretches.
 */
export function sparkline(points: SparkPoint[], color: string, label = 'sparkline'): string {
  const W = 320, H = 56;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const t0 = points[0]?.t ?? 0;
  const dt = (points[points.length - 1]?.t ?? t0) - t0 || 1;
  const x = (t: number) => ((t - t0) / dt) * W;
  const y = (v: number) => H - 6 - ((v - min) / span) * (H - 14);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)} ${y(p.v)}`).join(' ');
  const last = points[points.length - 1]!;
  return (
    open(W, H, 'spark', label) +
    `<path d="${d} L ${W} ${H} L 0 ${H} Z" fill="${color}" opacity="0.15"/>` +
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.75"/>` +
    `<circle cx="${x(last.t)}" cy="${y(last.v)}" r="3" fill="${color}" stroke="var(--canvas)" stroke-width="2"/>` +
    `</svg>`
  );
}
