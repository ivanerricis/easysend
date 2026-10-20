import { describe, expect, it } from 'vitest';
import { maskLogUrl } from '../src/http/log-url.js';

describe('maskLogUrl', () => {
  it('masks download tokens and keeps the rest of the path', () => {
    expect(maskLogUrl('/api/downloads/abc_DEF-123')).toBe('/api/downloads/[token]');
    expect(maskLogUrl('/api/downloads/abc_DEF-123/files/f1')).toBe(
      '/api/downloads/[token]/files/f1',
    );
    expect(maskLogUrl('/API/Downloads/abc/zip')).toBe('/API/Downloads/[token]/zip');
  });

  it('masks the token of the public download page', () => {
    expect(maskLogUrl('/d/abc_DEF-123')).toBe('/d/[token]');
    expect(maskLogUrl('/d/abc_DEF-123/')).toBe('/d/[token]/');
  });

  it('drops query strings and fragments', () => {
    expect(maskLogUrl('/api/health?x=secret')).toBe('/api/health');
    expect(maskLogUrl('/api/downloads/tok?download=1#frag')).toBe('/api/downloads/[token]');
  });

  it('leaves other paths alone', () => {
    expect(maskLogUrl('/api/transfers/abc')).toBe('/api/transfers/abc');
    expect(maskLogUrl('/')).toBe('/');
    expect(maskLogUrl('')).toBe('');
  });
});
