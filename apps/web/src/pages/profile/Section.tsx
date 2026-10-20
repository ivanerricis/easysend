import { useId, type ReactNode } from 'react';

/** Card-like profile section with an h2 and an optional description. */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="bg-card text-card-foreground border p-5 sm:p-6">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {description ? (
        <p className="text-muted-foreground mt-1 max-w-prose text-sm">{description}</p>
      ) : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}
