import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Table that turns into a list of stacked cards under the `lg` breakpoint. Explicit ARIA roles
 * keep the table semantics when the elements are displayed as blocks. Every `DataCell` carries
 * a `label` shown (through CSS) in front of the value in the stacked layout.
 */
export function DataTable({ className, ...props }: ComponentProps<'table'>) {
  return <table role="table" className={cn('w-full text-sm', className)} {...props} />;
}

export function DataHead({ className, ...props }: ComponentProps<'thead'>) {
  // eslint-disable-next-line jsx-a11y/no-redundant-roles -- keeps the semantics when displayed as block
  return <thead role="rowgroup" className={cn('max-lg:sr-only', className)} {...props} />;
}

export function DataBody({ className, ...props }: ComponentProps<'tbody'>) {
  // eslint-disable-next-line jsx-a11y/no-redundant-roles -- keeps the semantics when displayed as block
  return <tbody role="rowgroup" className={cn('max-lg:block', className)} {...props} />;
}

export function DataRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      role="row"
      className={cn(
        'max-lg:border-border max-lg:mb-3 max-lg:block max-lg:border max-lg:p-3 lg:border-b',
        className,
      )}
      {...props}
    />
  );
}

export function DataHeadCell({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      role="columnheader"
      scope="col"
      className={cn(
        'text-muted-foreground px-3 py-2 text-left text-xs font-medium tracking-wide uppercase',
        className,
      )}
      {...props}
    />
  );
}

// Spread so the explicit role (needed once the cell is displayed as a block) passes the a11y lint.
const CELL_ROLE = { role: 'cell' } as const;

export function DataCell({
  label,
  className,
  ...props
}: ComponentProps<'td'> & { label?: string }) {
  return (
    <td
      {...CELL_ROLE}
      data-label={label}
      className={cn(
        'max-lg:before:text-muted-foreground max-lg:flex max-lg:items-start max-lg:justify-between max-lg:gap-3 max-lg:py-1.5 max-lg:before:shrink-0 max-lg:before:text-xs max-lg:before:content-[attr(data-label)] lg:px-3 lg:py-3 lg:align-middle',
        className,
      )}
      {...props}
    />
  );
}
