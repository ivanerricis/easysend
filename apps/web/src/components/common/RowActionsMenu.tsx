import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

let lastTrigger: HTMLElement | null = null;

/**
 * `onCloseAutoFocus` handler for the dialogs opened from a row menu: Radix would focus a dialog
 * trigger that does not exist, dropping the focus on <body>. It returns the focus to the menu
 * button of that row, or to the main region when the row is gone (e.g. it was deleted).
 */
export function restoreRowFocus(event: Event) {
  event.preventDefault();
  if (lastTrigger?.isConnected) lastTrigger.focus();
  else document.getElementById('main')?.focus();
}

export interface RowAction {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Runs after the menu has closed (so a dialog it opens receives the focus). */
  onSelect?: () => void;
  /** Renders a link instead of a button item. */
  to?: string;
  /** Destructive actions are listed last, after a separator. */
  destructive?: boolean;
  disabled?: boolean;
  /** Leaves the action out (it does not apply to this row). */
  hidden?: boolean;
}

interface RowActionsMenuProps {
  /** Accessible name of the trigger, e.g. "Actions for ada@example.com". */
  label: string;
  actions: readonly RowAction[];
}

/**
 * One icon button (44x44) that opens the actions of a table or list row. The chosen action runs
 * once the menu is closed: opening a dialog while Radix still restores the focus to the trigger
 * would leave the focus outside the dialog.
 */
export function RowActionsMenu({ label, actions: all }: RowActionsMenuProps) {
  const actions = all.filter((action) => !action.hidden);
  const pending = useRef<(() => void) | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const normal = actions.filter((action) => !action.destructive);
  const destructive = actions.filter((action) => action.destructive);

  const renderItem = (action: RowAction) => {
    const Icon = action.icon;
    const variant = action.destructive ? 'destructive' : 'default';
    if (action.to) {
      return (
        <DropdownMenuItem key={action.key} asChild variant={variant} disabled={action.disabled}>
          <Link to={action.to}>
            <Icon aria-hidden="true" />
            {action.label}
          </Link>
        </DropdownMenuItem>
      );
    }
    return (
      <DropdownMenuItem
        key={action.key}
        variant={variant}
        disabled={action.disabled}
        onSelect={() => {
          pending.current = action.onSelect ?? null;
        }}
      >
        <Icon aria-hidden="true" />
        {action.label}
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} type="button" variant="outline" size="icon" aria-label={label}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          const run = pending.current;
          pending.current = null;
          if (run) {
            // The dialog it opens gives the focus back with `restoreRowFocus`.
            event.preventDefault();
            lastTrigger = triggerRef.current;
            run();
          }
        }}
      >
        {normal.map(renderItem)}
        {normal.length > 0 && destructive.length > 0 ? <DropdownMenuSeparator /> : null}
        {destructive.map(renderItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
