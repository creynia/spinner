// The e2e and perf CI jobs run in the official Playwright image (.github/workflows/ci.yml). Its tag
// must match @playwright/test, or the browsers the tests expect are not the ones in the image.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

describe('CI Playwright image', () => {
  it('uses the same version as @playwright/test', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    const version = pkg.devDependencies['@playwright/test'];
    const tags = [
      ...read('.github/workflows/ci.yml').matchAll(/mcr\.microsoft\.com\/playwright:v([\w.-]+)/g),
    ].map((m) => m[1]!.replace(/-\w+$/, ''));
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag).toBe(version);
  });
});
