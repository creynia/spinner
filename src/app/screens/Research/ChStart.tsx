// Chapter chart: Start. Placeholder from WP I1b; the chapter's implementer replaces this file's
// contents only (same export name and props), see docs/design/research.md section 9.
import type { Chapter } from './content';

export function ChStart({ chapter }: { chapter: Chapter }) {
  return (
    <div class="chart-slot" aria-hidden="true">
      Chart: {chapter.id}
    </div>
  );
}
