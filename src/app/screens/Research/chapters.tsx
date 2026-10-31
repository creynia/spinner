// Chart slot per chapter. Wave-B implementers replace their own lines with real components (each
// in its own file) and touch nothing else here. Every component receives its chapter.
import type { ComponentType } from 'preact';
import type { Chapter } from './content';

export type ChapterChart = ComponentType<{ chapter: Chapter }>;

function Placeholder({ chapter }: { chapter: Chapter }) {
  return (
    <div class="chart-slot" aria-hidden="true">
      Chart: {chapter.id}
    </div>
  );
}

export const CHAPTER_CHARTS: Record<string, ChapterChart> = {
  start: Placeholder,
  edge: Placeholder,
  martingale: Placeholder,
  levels: Placeholder,
  placement: Placeholder,
  curve: Placeholder,
  shapes: Placeholder,
  cashout: Placeholder,
  limits: Placeholder,
  try: Placeholder,
};
