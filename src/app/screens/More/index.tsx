// More (architecture.md §6.2): links to the screens that are not in the tab bar.
import { Card } from '@core/ui';
import { href } from '../../router';

const LINKS = [
  { path: '/gallery', label: 'Gallery', hint: 'Curated results to explore read-only' },
  { path: '/import', label: 'Import', hint: 'A results file, a strategy file or a shared link' },
  { path: '/settings', label: 'Settings', hint: 'Theme, money framing, storage, updates' },
  { path: '/settings?section=about', label: 'About', hint: 'Version, license and the risk notice' },
] as const;

export function More() {
  return (
    <>
      <h1>More</h1>
      <Card>
        <ul class="rows" aria-label="More destinations">
          {LINKS.map((l) => (
            <li>
              <a class="row-link" href={href(l.path)}>
                <span class="row-title">{l.label}</span>
                <span class="row-sub">{l.hint}</span>
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
