import type { ComponentChildren } from 'preact';

export interface EmptyStateProps {
  title: string;
  children?: ComponentChildren;
  action?: ComponentChildren;
}

/** An empty list: one sentence on what goes here, and what to do next. */
export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div class="empty" data-empty>
      <p class="empty-title">{title}</p>
      {children ? <p class="muted">{children}</p> : null}
      {action}
    </div>
  );
}
