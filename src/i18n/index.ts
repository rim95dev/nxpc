import { en, type Dict } from './en';

/**
 * Locale registry. **This is the only switch.**
 *
 * The site ships English only for now. To add a locale: write the dictionary
 * (typed as `Dict`, so a missing key fails the build), add it to `DICTS`, and
 * list it in `LANGS`. Routes, the language switcher and the hreflang links all
 * read from these two — nothing else needs touching.
 */
const DICTS = { en } satisfies Record<string, Dict>;

export type Lang = keyof typeof DICTS;
export const DEFAULT_LANG: Lang = 'en';
export const LANGS: Lang[] = ['en'];

export const dict = (lang: Lang): Dict => DICTS[lang];

export type Page = 'supply' | 'addresses';

const SEGMENT: Record<Page, string> = { supply: '', addresses: 'addresses/' };

/** The default locale sits at the root; every other locale gets a path prefix. */
export const pathFor = (lang: Lang, base: string, page: Page = 'supply'): string => {
  const root = base.replace(/\/$/, '');
  const locale = lang === DEFAULT_LANG ? '' : `${lang}/`;
  return `${root}/${locale}${SEGMENT[page]}`;
};

export type { Dict };
