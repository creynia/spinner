// Pings IndexNow (https://www.indexnow.org/) with every URL in dist/sitemap.xml after a deploy
// (docs/seo.md). Dependency-free; run by .github/workflows/pages.yml with continue-on-error, so a
// failure here never fails a deploy. Usage: node scripts/indexnow.mjs [path/to/sitemap.xml]
import { readFileSync } from 'node:fs';

const KEY = 'a02c23620b24433ba3470d53547479ec';
const HOST = 'creynia.com';
const file = process.argv[2] ?? 'dist/sitemap.xml';

const urlList = [...readFileSync(file, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (urlList.length === 0) {
  console.error(`indexnow: no <loc> in ${file}`);
  process.exit(1);
}
const body = {
  host: HOST,
  key: KEY,
  keyLocation: `https://${HOST}/${KEY}.txt`,
  urlList,
};
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});
console.log(`indexnow: ${urlList.length} URL(s), HTTP ${res.status}`);
// 200 OK and 202 Accepted are both success.
if (res.status !== 200 && res.status !== 202) process.exit(1);
