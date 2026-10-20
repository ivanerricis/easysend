import { useEffect, useRef, type ReactNode } from 'react';

interface StepHeadingProps {
  children: ReactNode;
  description?: ReactNode;
}

/** Heading of a wizard step: takes focus when the step appears, so screen readers announce it. */
export function StepHeading({ children, description }: StepHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="mb-5 space-y-2">
      <h2 ref={ref} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
        {children}
      </h2>
      {description ? (
        <div className="text-muted-foreground max-w-prose space-y-2 text-sm">{description}</div>
      ) : null}
    </div>
  );
}
