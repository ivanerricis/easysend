import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import i18n from './i18n';
import { ThemeProvider } from './theme/ThemeProvider';

const health = { status: 'ok', version: '0.0.0', mode: 'local', db: 'ok' };

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  await act(() => i18n.changeLanguage('en'));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the heading and landmarks', async () => {
    mockFetch(() => Promise.resolve(Response.json(health)));
    renderApp();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Transfer large files');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(await screen.findByText('Operational')).toBeInTheDocument();
  });

  it('shows the health details when the API responds', async () => {
    mockFetch(() => Promise.resolve(Response.json(health)));
    renderApp();
    expect(screen.getByText('Checking…')).toBeInTheDocument();
    expect(await screen.findByText('Operational')).toBeInTheDocument();
    expect(screen.getByText('0.0.0')).toBeInTheDocument();
    expect(screen.getByText('local')).toBeInTheDocument();
  });

  it('shows an error when the request fails', async () => {
    mockFetch(() => Promise.reject(new TypeError('network')));
    renderApp();
    expect(await screen.findByText('Unable to reach the API.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows an error when the response does not match the schema', async () => {
    mockFetch(() => Promise.resolve(Response.json({ status: 'nope' })));
    renderApp();
    expect(await screen.findByText('Unable to reach the API.')).toBeInTheDocument();
  });

  it('switches language and updates <html lang>', async () => {
    mockFetch(() => Promise.resolve(Response.json(health)));
    renderApp();
    await screen.findByText('Operational');
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'it' } });
    expect(await screen.findByText('Trasferisci file di grandi dimensioni')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('it');
    expect(window.localStorage.getItem('easysend-locale')).toBe('it');
  });

  it('switches to the dark theme', async () => {
    mockFetch(() => Promise.resolve(Response.json(health)));
    renderApp();
    await screen.findByText('Operational');
    const dark = screen.getByRole('button', { name: 'Dark' });
    expect(dark).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(dark);
    expect(document.documentElement).toHaveClass('dark');
    expect(dark).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');
  });
});
