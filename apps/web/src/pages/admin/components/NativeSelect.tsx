import { forwardRef, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Native `<select>` styled like the other controls (44px tall). Used for filters and short
 * lists: it is fully keyboard and screen reader accessible and works well on mobile.
 */
export const NativeSelect = forwardRef<HTMLSelectElement, ComponentProps<'select'>>(
  function NativeSelect({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        data-slot="native-select"
        className={cn(
          'border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive h-11 w-full min-w-0 rounded-none border px-3 text-base outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          className,
        )}
        {...props}
      />
    );
  },
);
