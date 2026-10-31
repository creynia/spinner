import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { aliases } from './build/aliases.ts';
import { swPlugin } from './build/vite-plugin-sw.ts';
import { galleryPlugin } from './build/vite-plugin-gallery.ts';
import { cspPlugin } from './build/vite-plugin-csp.ts';
import { staticPagesPlugin } from './build/static-pages.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  // Relative base: dist works at https://creynia.com/spinner/, under any fork's path, and in
  // `vite preview --base /spinner/`. Hash routing means the document is always <base>index.html.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)),
  },
  resolve: { alias: aliases },
  worker: { format: 'es' },
  plugins: [preact(), galleryPlugin(), staticPagesPlugin(), swPlugin(), cspPlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    // Two HTML entries: the app and the OAuth redirect return page (sync.md §5.4). The CSP plugin
    // covers both.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'oauth-return': fileURLToPath(new URL('./oauth-return.html', import.meta.url)),
      },
    },
  },
  preview: { port: Number(process.env.PORT ?? 4173), strictPort: true },
});
