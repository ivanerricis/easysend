import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { usePageTitle } from '@/hooks/use-page-title';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  /** Page title: rendered as the single `h1` and used for `document.title`. */
  title: string;
  description?: ReactNode;
  /** Buttons shown next to the title (wrap on narrow screens). */
  actions?: ReactNode;
  /**
   * Move focus to the `h1` when the page appears (route announcer for screen readers). Skipped
   * when something is already focused, e.g. an `autoFocus` field.
   */
  focusOnMount?: boolean;
  className?: string;
}

/** Page heading: one `h1` per page, title for the tab, focus management on navigation. */
export function PageHeader({
  title,
  description,
  actions,
  focusOnMount = true,
  className,
}: PageHeaderProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  usePageTitle(title);

  useEffect(() => {
    if (!focusOnMount) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;
    ref.current?.focus({ preventScroll: true });
  }, [focusOnMount, location.key]);

  return (
    <div
      className={cn('mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}
    >
      <div className="min-w-0 flex-1">
        <h1 ref={ref} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground mt-2 max-w-prose text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
