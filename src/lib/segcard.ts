/**
 * Hover card for color segments.
 *
 * A block of color on its own tells you nothing. On mouse-over it shows the name,
 * amount, share and status.
 * The target can be any element that carries `data-label` —
 * cylinder bar segments, legend entries and waterfall bars all use the same contract.
 *
 * On touch, a tap opens it and a tap outside closes it.
 */

interface Wallet {
  label: string;
  address: string;
  href: string;
}

interface Detail {
  label: string;
  value: string;
  pct: string;
  color: string;
  sub?: string;
  subLabel?: string;
  tag?: string;
  tagKind?: string;
  minus?: boolean;
  wallets?: Wallet[];
}

/** Rows written by the server. A malformed attribute drops the list rather than the card. */
const parseWallets = (raw: string | undefined): Wallet[] => {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((w) => w && w.address && w.href) : [];
  } catch {
    return [];
  }
};

const short = (a: string) => (a.length < 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`);

const read = (el: HTMLElement | SVGElement): Detail | null => {
  const d = (el as HTMLElement).dataset;
  if (!d.label || !d.value) return null;
  return {
    label: d.label,
    value: d.value,
    pct: d.pct ?? '',
    color: d.color ?? 'var(--ink-3)',
    ...(d.sub ? { sub: d.sub } : {}),
    ...(d.sublabel ? { subLabel: d.sublabel } : {}),
    ...(d.tag ? { tag: d.tag, tagKind: d.tagkind ?? 'no' } : {}),
    ...(d.minus ? { minus: true } : {}),
    wallets: parseWallets(d.wallets),
  };
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface SegCardLabels {
  ofTotal: string;
  holder: string;
  status: string;
  /** Heading above the address list. */
  addresses: string;
}

/**
 * Attaches the hover card to the `[data-label]` elements inside host.
 * The card is appended to host, so host must be position:relative — set here.
 */
export function attachSegCard(host: HTMLElement, labels: SegCardLabels): () => void {
  const targets = Array.from(
    host.querySelectorAll<HTMLElement>('[data-label][data-value]'),
  );
  if (!targets.length) return () => {};

  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const card = document.createElement('div');
  card.className = 'seg-card';
  card.setAttribute('role', 'tooltip');
  card.id = `seg-card-${Math.random().toString(36).slice(2, 8)}`;
  host.appendChild(card);

  let active: HTMLElement | null = null;
  /* Closing is deferred a moment so the card does not blink on the way between two
     segments. */
  let closing = 0;
  /* A click pins the card open, and only then does it take the pointer.
     Two problems, one answer. Unpinned, the card sits under the cursor and would
     swallow the very click meant for the segment beneath it — the click that pins it.
     And a card that closes on mouseleave cannot have its links reached at all: it is
     placed relative to the segment, so a reader has no way to know which way to
     travel. While it is a tooltip it stays inert (pointer-events, see theme.css); a
     click turns it into something you can use. */
  let pinned = false;

  const hideNow = () => {
    pinned = false;
    card.removeAttribute('data-pinned');
    card.removeAttribute('data-open');
    active?.classList.remove('is-active');
    active?.removeAttribute('aria-describedby');
    active = null;
  };
  const hide = () => {
    if (pinned) return;
    clearTimeout(closing);
    closing = window.setTimeout(hideNow, 160);
  };
  const keep = () => clearTimeout(closing);
  card.addEventListener('mouseenter', keep);
  card.addEventListener('mouseleave', hide);

  const show = (el: HTMLElement, clientX: number, clientY: number) => {
    // While pinned the card belongs to one segment; passing over others must not move it.
    if (pinned && el !== active) return;
    const d = read(el);
    if (!d) return;
    clearTimeout(closing);
    if (pinned) return; // keep it exactly where the click left it

    if (active !== el) {
      active?.classList.remove('is-active');
      active?.removeAttribute('aria-describedby');
      el.classList.add('is-active');
      el.setAttribute('aria-describedby', card.id);
      active = el;
      card.innerHTML =
        `<div class="seg-card-head"><span class="sw" style="background:${esc(d.color)}"></span>${esc(d.label)}</div>` +
        `<div class="seg-card-val">${d.minus ? '−' : ''}${esc(d.value)}</div>` +
        (d.pct ? `<div class="seg-card-row"><span>${esc(labels.ofTotal)}</span><b>${esc(d.pct)}</b></div>` : '') +
        (d.sub ? `<div class="seg-card-row"><span>${esc(d.subLabel ?? labels.holder)}</span><b>${esc(d.sub)}</b></div>` : '') +
        (d.tag ? `<span class="tag tag-${d.tagKind === 'yes' ? 'yes' : d.tagKind === 'burn' ? 'burn' : 'no'}">${esc(d.tag)}</span>` : '') +
        /* The addresses are the point of the page — a reader who does not trust the
           number should be one click from the explorer that produced it. */
        (d.wallets && d.wallets.length
          ? `<div class="seg-card-addrs"><div class="seg-card-addrs-h">${esc(labels.addresses)}</div>` +
            d.wallets
              .map(
                (w) =>
                  `<a class="seg-addr" href="${esc(w.href)}" target="_blank" rel="noopener noreferrer">` +
                  `<span class="seg-addr-name">${esc(w.label)}</span>` +
                  `<span class="seg-addr-hex mono">${esc(short(w.address))}</span></a>`,
              )
              .join('') +
            `</div>`
          : '');
    }

    card.setAttribute('data-open', '');

    // Move to host-relative coordinates. Clamp it so it is not cut off at the right edge.
    const hostBox = host.getBoundingClientRect();
    const w = card.offsetWidth || 200;
    const h = card.offsetHeight || 90;
    const x = Math.min(Math.max(clientX - hostBox.left - w / 2, 4), Math.max(4, hostBox.width - w - 4));
    // Float it above the target, but flip below if it would pass the top of host.
    const above = clientY - hostBox.top - h - 14;
    card.style.left = `${x}px`;
    card.style.top = `${above < 0 ? clientY - hostBox.top + 18 : above}px`;
  };

  const onEnter = (ev: Event) => {
    const el = ev.currentTarget as HTMLElement;
    const m = ev as MouseEvent;
    show(el, m.clientX || el.getBoundingClientRect().left, m.clientY || el.getBoundingClientRect().top);
  };
  const onMove = (ev: Event) => {
    const el = ev.currentTarget as HTMLElement;
    const m = ev as MouseEvent;
    show(el, m.clientX, m.clientY);
  };
  const onFocus = (ev: Event) => {
    const el = ev.currentTarget as HTMLElement;
    /* Clicking focuses the segment the pointer is already on. Re-placing the card from
       the segment's bounding box would jerk it away from the cursor — a wedge's box is
       far wider than the wedge. An open card for this same target keeps its place, so a
       click just pins it where it already is, which is what makes the address links
       reachable. Keyboard focus arrives with no card open and does use the box. */
    if (active === el && card.hasAttribute('data-open')) {
      clearTimeout(closing);
      return;
    }
    const b = el.getBoundingClientRect();
    show(el, b.left + b.width / 2, b.top);
  };
  const onTouch = (ev: Event) => {
    const el = ev.currentTarget as HTMLElement;
    const p = (ev as TouchEvent).touches[0];
    if (p) show(el, p.clientX, p.clientY);
  };

  const onClick = (ev: Event) => {
    const el = ev.currentTarget as HTMLElement;
    if (pinned && el === active) { hideNow(); return; }
    pinned = false;
    const m = ev as MouseEvent;
    show(el, m.clientX || el.getBoundingClientRect().left, m.clientY || el.getBoundingClientRect().top);
    pinned = true;
    card.setAttribute('data-pinned', '');
    clearTimeout(closing);
  };

  for (const el of targets) {
    el.addEventListener('click', onClick);
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', hide);
    el.addEventListener('touchstart', onTouch, { passive: true });
  }
  host.addEventListener('mouseleave', hide);
  /* Anywhere outside the card and its segments dismisses a pinned card — the one
     gesture a reader will already try. A click inside is left alone so the links work. */
  document.addEventListener('click', (ev) => {
    if (!pinned) return;
    const t = ev.target as Node;
    if (card.contains(t) || targets.some((el) => el.contains(t))) return;
    hideNow();
  });
  document.addEventListener('touchstart', (ev) => {
    if (!host.contains(ev.target as Node)) hide();
  }, { passive: true });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hideNow(); });

  return () => {
    for (const el of targets) {
      el.removeEventListener('click', onClick);
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', hide);
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', hide);
      el.removeEventListener('touchstart', onTouch);
    }
    card.remove();
  };
}
