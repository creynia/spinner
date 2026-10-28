// `npm run gallery:check` (architecture.md §9): fails if any bundle in gallery/ is over 2 MB or the
// folder is over 20 MB (decisions #8). Exits 0 on an empty gallery. Prints a size table.
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_BUNDLE = 2 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const dir = fileURLToPath(new URL('../gallery/', import.meta.url));

const files = readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isFile() && /\.spinner\.json(\.gz)?$/.test(e.name))
  .map((e) => ({ name: e.name, bytes: statSync(dir + e.name).size }));
const total = files.reduce((sum, f) => sum + f.bytes, 0);

let failed = false;
for (const f of files) {
  const bad = f.bytes > MAX_BUNDLE;
  failed ||= bad;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${String(f.bytes).padStart(9)}  ${f.name}`);
}
console.log(`${files.length} bundle(s), ${total} bytes (limit ${MAX_TOTAL})`);
if (total > MAX_TOTAL) failed = true;
if (failed) {
  console.error('gallery: a bundle is over 2 MB or the folder is over 20 MB');
  process.exit(1);
}
