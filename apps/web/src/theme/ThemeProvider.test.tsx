import { DEFAULT_APPEARANCE } from '@easysend/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeUser, renderWithProviders } from '@/test/render';
import { useTheme } from './theme-context';

function Probe() {
  const { theme, source, setTheme } = useTheme();
  return (
    <div>
      <p data-testid="state">{`${theme}:${source}`}</p>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme(null)}>default</button>
    </div>
  );
}

const darkInstance = { appearance: { ...DEFAULT_APPEARANCE, defaultTheme: 'dark' as const } };

describe('ThemeProvider', () => {
  it('falls back to the instance default and caches it for theme-init.js', async () => {
    renderWithProviders(<Probe />, { publicSettings: darkInstance });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('dark:instance'));
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('easysend-theme-default')).toBe('dark');
  });

  it('prefers the stored choice over the instance default', async () => {
    window.localStorage.setItem('easysend-theme', 'light');
    renderWithProviders(<Probe />, { publicSettings: darkInstance });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('light:local'));
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('prefers the user preference and saves changes to the profile', async () => {
    const { api } = renderWithProviders(<Probe />, {
      publicSettings: darkInstance,
      session: makeUser({ themePreference: 'system' }),
      routes: {
        'PATCH /api/me': {
          user: makeUser({ themePreference: 'light' }),
          usedBytes: 0,
          quotaBytes: null,
        },
      },
    });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('system:user'));
    fireEvent.click(screen.getByRole('button', { name: 'light' }));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('light:user'));
    expect(api.callsTo('PATCH /api/me')[0]?.body).toEqual({ themePreference: 'light' });
  });
});
