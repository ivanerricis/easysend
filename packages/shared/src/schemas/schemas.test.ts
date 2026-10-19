import { describe, expect, it } from 'vitest';
import { loginRequestSchema, loginResponseSchema } from './auth.js';
import { downloadInfoResponseSchema } from './downloads.js';
import { appearanceSchema } from './settings.js';
import { createTransferRequestSchema, updateTransferRequestSchema } from './transfers.js';
import { tusUploadMetadataSchema } from './uploads.js';
import { deleteUserQuerySchema } from './users.js';

describe('createTransferRequestSchema', () => {
  it('accepts a link transfer', () => {
    const res = createTransferRequestSchema.safeParse({ mode: 'link', expiresIn: '1w' });
    expect(res.success).toBe(true);
  });

  it('accepts an email transfer with recipients, password and limit', () => {
    const res = createTransferRequestSchema.safeParse({
      mode: 'email',
      expiresIn: '3d',
      recipients: ['a@example.com', 'b@example.com'],
      password: 'longenough',
      maxDownloads: 5,
      title: 'Contracts',
    });
    expect(res.success).toBe(true);
  });

  it('rejects an unknown expiry and an email transfer without recipients', () => {
    expect(createTransferRequestSchema.safeParse({ mode: 'link', expiresIn: '2d' }).success).toBe(
      false,
    );
    expect(createTransferRequestSchema.safeParse({ mode: 'email', expiresIn: '1m' }).success).toBe(
      false,
    );
  });

  it('rejects recipients in link mode, duplicates and a short password', () => {
    const base = { expiresIn: '1m' };
    expect(
      createTransferRequestSchema.safeParse({ ...base, mode: 'link', recipients: ['a@b.it'] })
        .success,
    ).toBe(false);
    expect(
      createTransferRequestSchema.safeParse({
        ...base,
        mode: 'email',
        recipients: ['a@b.it', 'A@B.it'],
      }).success,
    ).toBe(false);
    expect(
      createTransferRequestSchema.safeParse({ ...base, mode: 'link', password: 'short' }).success,
    ).toBe(false);
  });
});

describe('updateTransferRequestSchema', () => {
  it('requires a field and rejects password with removePassword', () => {
    expect(updateTransferRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateTransferRequestSchema.safeParse({ password: 'longenough', removePassword: true })
        .success,
    ).toBe(false);
    expect(updateTransferRequestSchema.safeParse({ maxDownloads: null }).success).toBe(true);
  });
});

describe('login schemas', () => {
  it('accepts a valid login and rejects a bad email', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(
      true,
    );
    expect(loginRequestSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });

  it('parses the mfa_required login response', () => {
    expect(loginResponseSchema.safeParse({ status: 'mfa_required' }).success).toBe(true);
    expect(loginResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});

describe('appearanceSchema', () => {
  const valid = {
    instanceName: 'easysend',
    footer: '',
    primaryColor: '#18181b',
    accentColor: '#047857',
    radius: 0,
    font: 'ibm-plex-sans',
    defaultTheme: 'system',
  };

  it('accepts hex colours and a known font', () => {
    expect(appearanceSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects non-hex colours, unknown fonts and out-of-range radius', () => {
    expect(appearanceSchema.safeParse({ ...valid, primaryColor: 'red' }).success).toBe(false);
    expect(appearanceSchema.safeParse({ ...valid, accentColor: '#fff' }).success).toBe(false);
    expect(appearanceSchema.safeParse({ ...valid, font: 'comic-sans' }).success).toBe(false);
    expect(appearanceSchema.safeParse({ ...valid, radius: 5 }).success).toBe(false);
  });
});

describe('deleteUserQuerySchema', () => {
  it('requires reassignTo when reassigning', () => {
    expect(deleteUserQuerySchema.safeParse({ transfers: 'delete' }).success).toBe(true);
    expect(deleteUserQuerySchema.safeParse({ transfers: 'reassign' }).success).toBe(false);
    expect(
      deleteUserQuerySchema.safeParse({ transfers: 'reassign', reassignTo: 'abc' }).success,
    ).toBe(true);
  });
});

describe('download and tus schemas', () => {
  it('keeps locked links minimal', () => {
    expect(downloadInfoResponseSchema.safeParse({ locked: true, expiresAt: 1 }).success).toBe(true);
    expect(downloadInfoResponseSchema.safeParse({ locked: false, expiresAt: 1 }).success).toBe(
      false,
    );
  });

  it('validates tus metadata', () => {
    expect(tusUploadMetadataSchema.safeParse({ transferId: 't1', filename: 'a.zip' }).success).toBe(
      true,
    );
    expect(tusUploadMetadataSchema.safeParse({ filename: 'a.zip' }).success).toBe(false);
  });
});
