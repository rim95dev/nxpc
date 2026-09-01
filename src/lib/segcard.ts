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
}

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
  };
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface SegCardLabels {
  ofTotal: string;
  holder: string;
  status: string;
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

  const hide = () => {
    card.removeAttribute('data-open');
    active?.classList.remove('is-active');
    active?.removeAttribute('aria-describedby');
    active = null;
  };

  const show = (el: HTMLElement, clientX: number, clientY: number) => {
    const d = read(el);
    if (!d) return;

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
        (d.tag ? `<span class="tag tag-${d.tagKind === 'yes' ? 'yes' : d.tagKind === 'burn' ? 'burn' : 'no'}">${esc(d.tag)}</span>` : '');
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
    const b = el.getBoundingClientRect();
    show(el, b.left + b.width / 2, b.top);
  };
  const onTouch = (ev: Event) => {
    const el = ev.currentTarget as HTMLElement;
    const p = (ev as TouchEvent).touches[0];
    if (p) show(el, p.clientX, p.clientY);
  };

  for (const el of targets) {
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', hide);
    el.addEventListener('touchstart', onTouch, { passive: true });
  }
  host.addEventListener('mouseleave', hide);
  document.addEventListener('touchstart', (ev) => {
    if (!host.contains(ev.target as Node)) hide();
  }, { passive: true });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });

  return () => {
    for (const el of targets) {
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
