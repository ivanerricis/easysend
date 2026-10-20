import type { ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * shadcn tooltip for supplementary text (full value, absolute date...). `children` must be a single
 * focusable element (a button, or a span / code with `tabIndex={0}`) so keyboard users get it too.
 * Never the only place for essential information.
 */
export function HintTooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-sm break-all">{content}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Inline text with a tooltip. The wrapper is focusable (`tabIndex={0}`) on purpose: it is the only
 * way for keyboard users to reach the supplementary text, which is never essential information.
 */
export function HintText({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <HintTooltip content={content}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- tooltip trigger */}
      <span tabIndex={0} className="focus-visible:ring-ring/50 outline-none focus-visible:ring-1">
        {children}
      </span>
    </HintTooltip>
  );
}
