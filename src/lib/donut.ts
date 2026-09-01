/* ------------------------------------------------------------------ *
 * Pure geometry of the 3D donut.
 *
 * The server (build-time SVG) and the client (view-transition animation) use
 * the **same functions**. Compute it separately in the two places and the
 * slices jump slightly the moment the transition ends.
 *
 * No color, shading or labels here. charts.ts lays those on top.
 * ------------------------------------------------------------------ */

export const TAU = Math.PI * 2;
export const START = -Math.PI / 2;

/** If two adjacent paths meet exactly, antialiasing leaves a white hairline. They overlap only when drawing. */
export const EPS = 0.0022;

export interface Box {
  cx: number;
  cy: number;
  rxOut: number;
  ryOut: number;
  /** Inner hole ratio (0~1). */
  hole: number;
  depth: number;
}

export interface Arc {
  a0: number;
  a1: number;
  mid: number;
  share: number;
}

const n2 = (v: number) => v.toFixed(1);

/** Spreads an array of values into arcs clockwise from 12 o'clock. If the sum is 0, all of them have zero width. */
export function arcsOf(values: number[]): Arc[] {
  const total = values.reduce((a, b) => a + b, 0);
  let acc = START;
  return values.map((v) => {
    const share = total > 0 ? v / total : 0;
    const a0 = acc;
    const a1 = acc + TAU * share;
    acc = a1;
    return { a0, a1, mid: (a0 + a1) / 2, share };
  });
}

export const pointAt = (b: Box, a: number, k: number) =>
  [b.cx + b.rxOut * k * Math.cos(a), b.cy + b.ryOut * k * Math.sin(a)] as const;

/** Where the text sits inside a slice — the middle of the ring band. */
export const labelAt = (b: Box, mid: number) => pointAt(b, mid, (1 + b.hole) / 2);

/* Cuts an arc into the front/back of the screen. The outer wall is visible only
   at the front (sin>0); the inner wall only at the back (sin<0), seen through
   the hole. */
const clamp = (a0: number, a1: number, lo: number, hi: number) => {
  const s0 = Math.max(a0, lo);
  const s1 = Math.min(a1, hi);
  return s1 > s0 ? ([s0, s1] as const) : null;
};
const outerOf = (a0: number, a1: number) => clamp(a0, a1, 0, Math.PI);
const innerOf = (a0: number, a1: number) =>
  [clamp(a0, a1, START, 0), clamp(a0, a1, Math.PI, START + TAU)].filter(
    Boolean,
  ) as (readonly [number, number])[];

const moveTo = (b: Box, a: number, k: number, dy = 0) => {
  const [x, y] = pointAt(b, a, k);
  return `M ${n2(x)} ${n2(y + dy)}`;
};
const arcTo = (b: Box, a: number, k: number, sweep: 0 | 1, dy = 0) => {
  const [x, y] = pointAt(b, a, k);
  return ` A ${n2(b.rxOut * k)} ${n2(b.ryOut * k)} 0 0 ${sweep} ${n2(x)} ${n2(y + dy)}`;
};

/** The wall drawn down along an arc. k=1 is the outer one, k=hole the inner one. */
const wall = (b: Box, s0: number, s1: number, k: number) =>
  moveTo(b, s0, k) +
  arcTo(b, s1, k, 1) +
  ` L ${n2(pointAt(b, s1, k)[0])} ${n2(pointAt(b, s1, k)[1] + b.depth)}` +
  arcTo(b, s0, k, 0, b.depth) +
  ' Z';

/** Top face of a ring slice — follows the outer arc and comes back along the inner arc. */
const topFace = (b: Box, a0: number, a1: number) => {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [ox1, oy1] = pointAt(b, a1, 1);
  const [ix1, iy1] = pointAt(b, a1, b.hole);
  const [ix0, iy0] = pointAt(b, a0, b.hole);
  return (
    moveTo(b, a0, 1) +
    ` A ${n2(b.rxOut)} ${n2(b.ryOut)} 0 ${large} 1 ${n2(ox1)} ${n2(oy1)}` +
    ` L ${n2(ix1)} ${n2(iy1)}` +
    ` A ${n2(b.rxOut * b.hole)} ${n2(b.ryOut * b.hole)} 0 ${large} 0 ${n2(ix0)} ${n2(iy0)}` +
    ` Z`
  );
};

export interface Parts {
  /** Top face */
  top: string;
  /** Outer wall (front half) */
  ow: string;
  /** Inner wall (through the hole). The back part can split in two, so the subpaths are concatenated. */
  iw: string;
  /**
   * The cut cross-section — the two faces exposed when a slice is pulled out radially.
   * While the ring is closed they hide between neighboring slices and need not be
   * drawn, but once a slice pops out on hover, without these faces the thickness
   * looks like it disappeared.
   */
  cap: string;
  /** Outer edge bevel band — it overlaps only radially, so there is no seam with the neighbors. */
  bevO: string;
  /** Inner edge bevel band. */
  bevI: string;
  /** Seam line where this slice starts (radial line on the top face + vertical line on the visible wall). */
  seam: string;
}

/** One radially cut face — a quad from the inner edge to the outer edge, dropped by the depth. */
const capFace = (b: Box, a: number) => {
  const [ox, oy] = pointAt(b, a, 1);
  const [ix, iy] = pointAt(b, a, b.hole);
  return (
    `M ${n2(ix)} ${n2(iy)} L ${n2(ox)} ${n2(oy)}` +
    ` L ${n2(ox)} ${n2(oy + b.depth)} L ${n2(ix)} ${n2(iy + b.depth)} Z`
  );
};

/** Ring sector between two radii — used for the bevel bands. */
const band = (b: Box, a0: number, a1: number, kO: number, kI: number) => {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [ox1, oy1] = pointAt(b, a1, kO);
  const [ix1, iy1] = pointAt(b, a1, kI);
  const [ix0, iy0] = pointAt(b, a0, kI);
  return (
    moveTo(b, a0, kO) +
    ` A ${n2(b.rxOut * kO)} ${n2(b.ryOut * kO)} 0 ${large} 1 ${n2(ox1)} ${n2(oy1)}` +
    ` L ${n2(ix1)} ${n2(iy1)}` +
    ` A ${n2(b.rxOut * kI)} ${n2(b.ryOut * kI)} 0 ${large} 0 ${n2(ix0)} ${n2(iy0)} Z`
  );
};

/** Bevel band width. Keep it as a ratio of the radius so it looks the same on narrow screens. */
const BEVEL = 0.024;

/** The faces one slice draws. If its width is 0, all of them are empty strings. */
export function partsOf(b: Box, a: Arc): Parts {
  if (a.share <= 0) return { top: '', ow: '', iw: '', cap: '', bevO: '', bevI: '', seam: '' };
  const a0 = a.a0 - EPS;
  const a1 = a.a1 + EPS;
  const o = outerOf(a0, a1);
  return {
    top: topFace(b, a0, a1),
    ow: o ? wall(b, o[0], o[1], 1) : '',
    iw: innerOf(a0, a1)
      .map(([s0, s1]) => wall(b, s0, s1, b.hole))
      .join(''),
    cap: capFace(b, a.a0) + capFace(b, a.a1),
    /* The bevel and the seam belong to the slice, not to the ring. Drawing them
       once for the whole ring leaves a white outline sitting in place while the
       slice it belongs to pops out on hover. */
    bevO: band(b, a0, a1, 1, 1 - BEVEL),
    bevI: band(b, a0, a1, b.hole + BEVEL, b.hole),
    seam: seamAt(b, a.a0),
  };
}

/** Seam line where a slice starts. Grays of similar color only come apart if this line is there. */
function seamAt(b: Box, a: number): string {
  const [ix, iy] = pointAt(b, a, b.hole);
  const [ox, oy] = pointAt(b, a, 1);
  return (
    `M ${n2(ix)} ${n2(iy)} L ${n2(ox)} ${n2(oy)}` +
    (Math.sin(a) > 0
      ? `M ${n2(ox)} ${n2(oy)} L ${n2(ox)} ${n2(oy + b.depth)}`
      : `M ${n2(ix)} ${n2(iy)} L ${n2(ix)} ${n2(iy + b.depth)}`)
  );
}

/**
 * Overlap order. Draws from the slice whose frontmost point (max sin) is furthest back.
 * The order changes when the angles change, so it has to be recomputed every frame
 * during animation too.
 */
export function paintOrder(arcs: Arc[]): number[] {
  const front = (a: Arc) => {
    if (a.share <= 0) return -Infinity;
    let m = -Infinity;
    for (let k = 0; k <= 16; k++) m = Math.max(m, Math.sin(a.a0 + ((a.a1 - a.a0) * k) / 16));
    return m;
  };
  return arcs
    .map((a, i) => ({ i, f: front(a) }))
    .sort((x, y) => x.f - y.f)
    .map((x) => x.i);
}
