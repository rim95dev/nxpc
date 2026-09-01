// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages project page: https://rim95dev.github.io/nxpc
// Changing base drags every internal link and asset path along with it.
export default defineConfig({
  site: 'https://rim95dev.github.io',
  base: '/nxpc',
  // The default locale sits at the root with no prefix; the rest go under /ko/.
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ko'],
    routing: { prefixDefaultLocale: false },
  },
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
