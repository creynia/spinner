// Research (docs/research/app-plan.md): the story of the loop's findings, one card per chapter,
// each with a chart slot, takeaways and a collapsible "The math". Chapter prose lives in
// ./content, the chart per chapter in ./chapters.
import { useEffect } from 'preact/hooks';
import { href } from '../../router';
import type { ScreenProps } from '../types';
import { CHAPTER_CHARTS } from './chapters';
import { CHAPTERS, type Chapter } from './content';
import './research.css';

const chapterHref = (id: string): string => href(`/research?chapter=${id}`);

/** The chapter list twice: chips under the h1 on phones, a sticky column from 768px (CSS picks). */
function ChapterNav({ variant }: { variant: 'chips' | 'column' }) {
  return (
    <nav
      class={`research-nav research-nav-${variant}`}
      aria-label={variant === 'chips' ? 'Chapters' : 'Chapter list'}
    >
      <ol>
        {CHAPTERS.map((c) => (
          <li>
            <a class={variant === 'chips' ? 'chip' : 'research-nav-link'} href={chapterHref(c.id)}>
              {c.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ChapterCard({ chapter }: { chapter: Chapter }) {
  const Chart = CHAPTER_CHARTS[chapter.id];
  const headingId = `chapter-${chapter.id}-h`;
  return (
    <section class="card research-chapter" id={`chapter-${chapter.id}`} aria-labelledby={headingId}>
      <h2 id={headingId}>{chapter.title}</h2>
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
            <p>{p}</p>
          ))}
          {chapter.math.formulas.map((f) => (
            <code class="formula">{f}</code>
          ))}
        </div>
      </details>
    </section>
  );
}

export function Research({ query }: ScreenProps) {
  const target = query.get('chapter');
  useEffect(() => {
    if (!target) return;
    document.getElementById(`chapter-${target}`)?.scrollIntoView?.();
  }, [target]);

  return (
    <>
      <h1>Research</h1>
      <p class="lead research-intro">
        What the simulations found about betting progressions: what they can do for a typical
        session, what they cannot do for the average, and how to try the ideas yourself.
      </p>
      <ChapterNav variant="chips" />
      <div class="research-layout">
        <ChapterNav variant="column" />
        <div class="research-chapters">
          {CHAPTERS.map((c) => (
            <ChapterCard chapter={c} />
          ))}
        </div>
      </div>
    </>
  );
}
