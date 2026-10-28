// Card: a titled section. `as` picks the heading level (the screen owns the one h1).
import type { ComponentChildren } from 'preact';
import { useId } from './Field';

export interface CardProps {
  title?: string;
  /** Heading level of the title; default 2. */
  level?: 2 | 3;
  actions?: ComponentChildren;
  children?: ComponentChildren;
  class?: string;
}

export function Card({ title, level = 2, actions, children, class: cls }: CardProps) {
  const uid = useId('card');
  const id = title ? uid : undefined;
  const Heading = `h${level}` as 'h2' | 'h3';
  return (
    <section class={`card${cls ? ` ${cls}` : ''}`} aria-labelledby={id}>
      {title ? (
        <div class="card-head">
          <Heading id={id}>{title}</Heading>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
