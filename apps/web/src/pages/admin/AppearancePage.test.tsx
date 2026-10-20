import { DEFAULT_APPEARANCE } from '@easysend/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, makeAdmin, renderWithProviders } from '@/test/render';
import AppearancePage from './AppearancePage';

const NO_ASSETS = { logoLight: null, logoDark: null, favicon: null, background: null };

function renderPage(routes: Record<string, unknown> = {}) {
  return renderWithProviders(<AppearancePage />, {
    session: makeAdmin(),
    route: '/admin/appearance',
    routes,
  });
}

async function colorInput(label: string) {
  return await screen.findByLabelText(label);
}

describe('AppearancePage', () => {
  it('updates both previews live when a colour changes', async () => {
    renderPage();
    const primary = await colorInput('Primary colour');
    const light = screen.getByTestId('preview-light');
    const dark = screen.getByTestId('preview-dark');
    expect(dark).toHaveClass('dark');
    expect(light).not.toHaveClass('dark');

    fireEvent.change(primary, { target: { value: '#ff0000' } });
    await waitFor(() => expect(light.style.getPropertyValue('--primary')).toBe('#ff0000'));
    // The dark preview only takes colours that stand out from the dark surface.
    expect(dark.style.getPropertyValue('--primary')).toBe('#ff0000');

    fireEvent.change(primary, { target: { value: '#101010' } });
    await waitFor(() => expect(light.style.getPropertyValue('--primary')).toBe('#101010'));
    expect(dark.style.getPropertyValue('--primary')).toBe('');
  });

  it('syncs the colour picker with the hex input and shows the footer in the preview', async () => {
    renderPage();
    const accent = await colorInput('Accent colour');
    const picker = screen.getByLabelText('Pick: Accent colour');
    fireEvent.change(picker, { target: { value: '#123456' } });
    await waitFor(() => expect(accent).toHaveValue('#123456'));

    fireEvent.change(screen.getByLabelText(/Footer text/), { target: { value: 'My company' } });
    await waitFor(() =>
      expect(within(screen.getByTestId('preview-light')).getByText('My company')).toBeVisible(),
    );
  });

  it('flags a low-contrast colour as failing, with ratio and requirement as text', async () => {
    renderPage();
    const accent = await colorInput('Accent colour');
    expect(screen.getByTestId('contrast-accentAsText')).toHaveAttribute('data-result', 'pass');

    fireEvent.change(accent, { target: { value: '#ffff99' } });
    await waitFor(() =>
      expect(screen.getByTestId('contrast-accentAsText')).toHaveAttribute('data-result', 'fail'),
    );
    const row = screen.getByTestId('contrast-accentAsText');
    expect(within(row).getByText('Fail')).toBeInTheDocument();
    expect(row).toHaveTextContent(/\d\.\d{2}:1/);
    expect(row).toHaveTextContent('required 4.5:1');
    expect(screen.getByText(/contrast check.* not pass/)).toBeInTheDocument();
  });

  it('rejects an invalid colour inline and does not call the API', async () => {
    const { api } = renderPage({
      'PUT /api/admin/settings/appearance': { appearance: DEFAULT_APPEARANCE, assets: NO_ASSETS },
    });
    const accent = await colorInput('Accent colour');
    fireEvent.change(accent, { target: { value: '#12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(accent).toHaveAttribute('aria-invalid', 'true'));
    expect(api.callsTo('PUT /api/admin/settings/appearance')).toHaveLength(0);
  });

  it('saves the appearance and refreshes the public settings', async () => {
    const saved = { ...DEFAULT_APPEARANCE, instanceName: 'Acme Send', primaryColor: '#0a3d62' };
    const { api } = renderPage({
      'PUT /api/admin/settings/appearance': { appearance: saved, assets: NO_ASSETS },
    });
    const name = await screen.findByLabelText(/Instance name/);
    fireEvent.change(name, { target: { value: 'Acme Send' } });
    fireEvent.change(await colorInput('Primary colour'), { target: { value: '#0a3d62' } });
    const before = api.callsTo('GET /api/public/settings').length;
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.callsTo('PUT /api/admin/settings/appearance')).toHaveLength(1));
    expect(api.callsTo('PUT /api/admin/settings/appearance')[0]?.body).toMatchObject({
      instanceName: 'Acme Send',
      primaryColor: '#0a3d62',
    });
    await waitFor(() =>
      expect(api.callsTo('GET /api/public/settings').length).toBeGreaterThan(before),
    );
  });

  it('restores the defaults after confirmation', async () => {
    const { api } = renderPage({
      'POST /api/admin/settings/appearance/reset': {
        appearance: DEFAULT_APPEARANCE,
        assets: NO_ASSETS,
      },
    });
    await screen.findByLabelText(/Instance name/);
    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.callsTo('POST /api/admin/settings/appearance/reset')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore defaults' }));
    await waitFor(() =>
      expect(api.callsTo('POST /api/admin/settings/appearance/reset')).toHaveLength(1),
    );
  });

  it('rejects an unsupported file type or an oversized file before uploading', async () => {
    const { api } = renderPage();
    const input = await screen.findByLabelText('Logo (light theme)');
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');

    fireEvent.change(input, {
      target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] },
    });
    expect(await screen.findByText(/Unsupported format/)).toBeInTheDocument();

    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText(/The file is too large/)).toBeInTheDocument();
    expect(api.callsTo('POST /api/admin/settings/appearance/assets/logoLight')).toHaveLength(0);
  });

  it('uploads the raw file with its Content-Type and shows API errors', async () => {
    let fail = false;
    const { api } = renderPage({
      'POST /api/admin/settings/appearance/assets/logoLight': () =>
        fail ? apiError(422, 'INVALID_IMAGE') : { kind: 'logoLight', updatedAt: 1_700_000_001 },
    });
    const input = await screen.findByLabelText('Logo (light theme)');
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(api.callsTo('POST /api/admin/settings/appearance/assets/logoLight')).toHaveLength(1),
    );
    const call = api.callsTo('POST /api/admin/settings/appearance/assets/logoLight')[0]!;
    expect(call.headers['Content-Type']).toBe('image/png');
    expect(call.body).toBe(file);

    fail = true;
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/Invalid image/)).toBeInTheDocument();
  });

  it('removes an image after confirmation', async () => {
    const { api } = renderWithProviders(<AppearancePage />, {
      session: makeAdmin(),
      route: '/admin/appearance',
      publicSettings: { assets: { ...NO_ASSETS, favicon: { updatedAt: 1_700_000_000 } } },
      routes: {
        'DELETE /api/admin/settings/appearance/assets/favicon': { status: 204 },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove: Favicon' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(api.callsTo('DELETE /api/admin/settings/appearance/assets/favicon')).toHaveLength(1),
    );
  });
});
