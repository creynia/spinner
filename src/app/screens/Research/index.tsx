// Research (docs/research/app-plan.md): the story of the loop's findings, one card per chapter,
// each with a chart slot, takeaways and a collapsible "The math". Chapter prose lives in
// ./content, the chart per chapter in ./chapters. Chapter links rewrite the hash in place
// (history.replaceState, like the Analyze tabs): the hash router would otherwise remount the screen.
import { useEffect, useState } from 'preact/hooks';
import { href } from '../../router';
import type { ScreenProps } from '../types';
import { CHAPTER_CHARTS } from './chapters';
import { CHAPTERS, type Chapter } from './content';
import { MathText, jumpTo } from './kit';
import './research.css';

const chapterHref = (id: string): string => href(`/research?chapter=${id}`);

/** Plain left click on a chapter link: update the URL in place, scroll and move focus. */
function onJump(e: MouseEvent, id: string, onDone?: () => void): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  e.preventDefault();
  try {
    history.replaceState(null, '', id === 'top' ? href('/research') : chapterHref(id));
  } catch {
    // the URL stays as it was; the scroll still works
  }
  jumpTo(id, { focus: true });
  onDone?.();
}

/** The chapter list twice: chips under the h1 on phones, a sticky column from 768px (CSS picks). */
function ChapterNav({
  variant,
  current,
  onCurrent,
}: {
  variant: 'chips' | 'column';
  current: string | null;
  onCurrent: (id: string) => void;
}) {
  return (
    <nav
      class={`research-nav research-nav-${variant}`}
      aria-label={variant === 'chips' ? 'Chapters' : 'Chapter list'}
    >
      <ol>
        {CHAPTERS.map((c, i) => (
          <li>
            <a
              class={variant === 'chips' ? 'chip' : 'research-nav-link'}
              href={chapterHref(c.id)}
              aria-current={current === c.id ? 'location' : undefined}
              aria-label={variant === 'chips' ? `Chapter ${i}: ${c.title}` : undefined}
              onClick={(e) => onJump(e, c.id, () => onCurrent(c.id))}
            >
              {c.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ChapterCard({ chapter, index }: { chapter: Chapter; index: number }) {
  const Chart = CHAPTER_CHARTS[chapter.id];
  const headingId = `chapter-${chapter.id}-h`;
  const next = CHAPTERS[index + 1];
  return (
    <section class="card research-chapter" id={`chapter-${chapter.id}`} aria-labelledby={headingId}>
      <p class="research-eyebrow">Chapter {index}</p>
      <h2 id={headingId} tabIndex={-1}>
        {chapter.title}
      </h2>
      <p class="lead">{chapter.lead}</p>
      {chapter.body.map((p) => (
        <p>{p}</p>
      ))}
      {Chart ? <Chart chapter={chapter} /> : null}
      <ul class="takeaways">
        {chapter.takeaways.map((t) => (
          <li>{t}</li>
        ))}
      </ul>
      <details class="math">
        <summary>The math</summary>
        <div class="math-body">
          {chapter.math.text.map((p) => (
            <p>
              <MathText text={p} />
            </p>
          ))}
          {chapter.math.formulas.map((f) => (
            <code class="formula">
              <MathText text={f} />
            </code>
          ))}
        </div>
      </details>
      {next ? (
        <a
          class="link-tap research-next"
          href={chapterHref(next.id)}
          onClick={(e) => onJump(e, next.id)}
        >
          Next: {next.title}
        </a>
      ) : (
        <a
          class="link-tap research-next"
          href={href('/research')}
          onClick={(e) => onJump(e, 'top')}
        >
          Back to the top
        </a>
      )}
    </section>
  );
}

/** Id of the topmost chapter in the upper part of the viewport, kept up to date while scrolling. */
function useCurrentChapter(): [string | null, (id: string) => void] {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.id.replace(/^chapter-/, '');
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const top = CHAPTERS.find((c) => visible.has(c.id));
        if (top) setCurrent(top.id);
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    for (const c of CHAPTERS) {
      const el = document.getElementById(`chapter-${c.id}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return [current, setCurrent];
}

export function Research({ query }: ScreenProps) {
  const target = query.get('chapter');
  const [current, setCurrent] = useCurrentChapter();
  // A deep link scrolls once the cards have laid out; it never moves focus.
  useEffect(() => {
    if (!target || !CHAPTERS.some((c) => c.id === target)) return undefined;
    const raf = requestAnimationFrame(() => {
      document.getElementById(`chapter-${target}`)?.scrollIntoView?.({
        block: 'start',
        behavior: 'auto',
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return (
    <>
      <h1 id="research-top" tabIndex={-1}>
        Research
      </h1>
      <p class="lead research-intro">
        What the simulations found about betting progressions: what they can do for a typical
        session, what they cannot do for the average, and how to try the ideas yourself.
      </p>
      <ChapterNav variant="chips" current={current} onCurrent={setCurrent} />
      <div class="research-layout">
        <ChapterNav variant="column" current={current} onCurrent={setCurrent} />
        <div class="research-chapters">
          {CHAPTERS.map((c, i) => (
            <ChapterCard chapter={c} index={i} />
          ))}
        </div>
      </div>
    </>
  );
}
