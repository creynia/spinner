// Button: a real <button> or, with `href`, a link styled the same. Min 44 px tap target (kit.css).
import type { ComponentChildren } from 'preact';

export interface ButtonProps {
  children?: ComponentChildren;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  href?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: (e: MouseEvent) => void;
  'aria-label'?: string;
  class?: string;
  id?: string;
}

export function Button({
  children,
  variant = 'secondary',
  href,
  class: cls,
  ...rest
}: ButtonProps) {
  const className = `btn btn-${variant}${cls ? ` ${cls}` : ''}`;
  if (href !== undefined && !rest.disabled) {
    return (
      <a class={className} href={href} id={rest.id} aria-label={rest['aria-label']}>
        {children}
      </a>
    );
  }
  return (
    <button
      class={className}
      type={rest.type ?? 'button'}
      id={rest.id}
      disabled={rest.disabled}
      onClick={rest.onClick}
      aria-label={rest['aria-label']}
    >
      {children}
    </button>
  );
}
