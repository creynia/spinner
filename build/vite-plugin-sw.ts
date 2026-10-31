import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';
import { isStaticSiteFile } from './static-pages.ts';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * Emits `sw.js` (from src/pwa/sw.ts) with a precache list of every built file, and
 * injects the manifest + apple-touch-icon links.
 */
export function swPlugin(): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  let command: 'build' | 'serve' = 'build';
  return {
    name: 'spinner-sw',
    configResolved(config) {
      command = config.command;
      outDir = resolve(config.root, config.build.outDir);
      root = config.root;
    },
    transformIndexHtml() {
      if (command === 'serve') return [];
      return [
        {
          tag: 'link',
          attrs: { rel: 'manifest', href: './manifest.webmanifest' },
          injectTo: 'head',
        },
        {
          tag: 'link',
          attrs: { rel: 'apple-touch-icon', href: './icons/apple-touch-icon.png' },
          injectTo: 'head',
        },
      ];
    },
    // closeBundle runs after Vite has written bundle files and copied public/.
    closeBundle: {
      order: 'post',
      handler() {
        if (this.environment && this.environment.config.build.ssr) return;
        const files = walk(outDir)
          .map((f) => relative(outDir, f).split('\\').join('/'))
          .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
          // gallery bundles are cached on open, not precached (the index is precached)
          .filter((f) => !f.startsWith('gallery/') || f === 'gallery/index.json')
          // static crawler pages, sitemap and llms files are always fetched from the network
          .filter((f) => !isStaticSiteFile(f))
          .sort();
        const precache = ['./', ...files.map((f) => './' + f)];
        const src = readFileSync(resolve(root, 'src/pwa/sw.ts'), 'utf8');
        const hash = createHash('sha256').update(src);
        for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
        const version = hash.digest('hex').slice(0, 12);

        const js = ts.transpileModule(src, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText;
        const out = js
          .replace(/__PRECACHE__/g, JSON.stringify(precache))
          .replace(/__VERSION__/g, JSON.stringify(version));
        writeFileSync(join(outDir, 'sw.js'), out);
      },
    },
  };
}
