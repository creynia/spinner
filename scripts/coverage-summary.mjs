// Prints the vitest v8 coverage totals as a Markdown table (CI writes it to the job summary).
// Usage: node scripts/coverage-summary.mjs coverage/coverage-summary.json
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'coverage/coverage-summary.json';
const total = JSON.parse(readFileSync(file, 'utf8')).total;
const keys = ['statements', 'branches', 'functions', 'lines'];
const cell = (k) => `${total[k].pct.toFixed(2)}% (${total[k].covered}/${total[k].total})`;
console.log('### Unit test coverage\n');
console.log(`| ${keys.map((k) => k[0].toUpperCase() + k.slice(1)).join(' | ')} |`);
console.log(`|${keys.map(() => '---').join('|')}|`);
console.log(`| ${keys.map(cell).join(' | ')} |`);
