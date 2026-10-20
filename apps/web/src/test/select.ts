import { expect } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

/** The Radix Select trigger (role `combobox`) with the given accessible name. */
export function getSelect(name: string | RegExp, scope: Pick<typeof screen, 'getByRole'> = screen) {
  return scope.getByRole('combobox', { name });
}

/**
 * Opens a Radix Select by its accessible name and picks an option (rendered in a portal, so it is
 * always searched on `screen`). jsdom has no pointer capture, hence keyboard to open, click to pick.
 */
export async function chooseOption(
  name: string | RegExp,
  option: string | RegExp,
  scope: Pick<typeof screen, 'getByRole'> = screen,
): Promise<void> {
  const trigger = getSelect(name, scope);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: option }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}
