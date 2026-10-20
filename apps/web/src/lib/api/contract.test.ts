import { endpoints } from '@easysend/shared/contract';
import { describe, expect, it } from 'vitest';
import { USED_ENDPOINTS as admin } from './admin';
import { USED_ENDPOINTS as auth } from './auth';
import { USED_ENDPOINTS as downloads } from './downloads';
import { USED_ENDPOINTS as me } from './me';
import { USED_ENDPOINTS as publicApi } from './public';
import { USED_ENDPOINTS as settings } from './settings';
import { USED_ENDPOINTS as setup } from './setup';
import { USED_ENDPOINTS as transfers } from './transfers';

const used = new Set<string>([
  ...admin,
  ...auth,
  ...downloads,
  ...me,
  ...publicApi,
  ...settings,
  ...setup,
  ...transfers,
]);

describe('API modules vs shared contract', () => {
  it('only wrap endpoints that exist in the registry', () => {
    const known = new Set(endpoints.map((endpoint) => endpoint.id));
    for (const id of used) expect(known.has(id), id).toBe(true);
  });

  it('cover every JSON / empty endpoint of the registry', () => {
    const expected = endpoints
      .filter((endpoint) => endpoint.response.kind === 'json' || endpoint.response.kind === 'empty')
      .map((endpoint) => endpoint.id);
    const missing = expected.filter((id) => !used.has(id));
    expect(missing).toEqual([]);
  });

  it('do not wrap binary, stream or tus endpoints', () => {
    for (const endpoint of endpoints) {
      if (['binary', 'stream', 'tus'].includes(endpoint.response.kind)) {
        expect(used.has(endpoint.id), endpoint.id).toBe(false);
      }
    }
  });
});
