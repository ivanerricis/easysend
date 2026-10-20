import { DEFAULT_APPEARANCE } from '@easysend/shared';
import { describe, expect, it } from 'vitest';
import { appearanceCssVars, applyCssVars, contrastWarnings } from './appearance';

const base = DEFAULT_APPEARANCE;

describe('appearanceCssVars', () => {
  it('returns nothing for the default appearance', () => {
    expect(appearanceCssVars(base, 'light')).toEqual({});
    expect(appearanceCssVars(base, 'dark')).toEqual({});
  });

  it('overrides only the colours that differ', () => {
    const vars = appearanceCssVars({ ...base, primaryColor: '#1d4ed8' }, 'light');
    expect(vars['--primary']).toBe('#1d4ed8');
    expect(vars['--primary-foreground']).toBe('#ffffff');
    expect(vars['--sidebar-primary']).toBe('#1d4ed8');
    expect(vars['--accent']).toBeUndefined();
  });

  it('maps the accent to every accent token', () => {
    const vars = appearanceCssVars({ ...base, accentColor: '#b91c1c' }, 'light');
    for (const key of ['--accent', '--ring', '--sidebar-accent', '--sidebar-ring', '--chart-1']) {
      expect(vars[key]).toBe('#b91c1c');
    }
    expect(vars['--accent-foreground']).toBe('#ffffff');
  });

  it('keeps the default dark token when a custom colour is too dark', () => {
    const darkBlue = { ...base, primaryColor: '#1e1b4b', accentColor: '#fbbf24' };
    expect(appearanceCssVars(darkBlue, 'light')['--primary']).toBe('#1e1b4b');
    const dark = appearanceCssVars(darkBlue, 'dark');
    expect(dark['--primary']).toBeUndefined();
    expect(dark['--accent']).toBe('#fbbf24');
    expect(dark['--accent-foreground']).toBe('#000000');
  });

  it('sets radius and the system font', () => {
    const vars = appearanceCssVars({ ...base, radius: 0.5, font: 'system' }, 'light');
    expect(vars['--radius']).toBe('0.5rem');
    expect(vars['--app-font-sans']).toContain('system-ui');
  });
});

describe('contrastWarnings', () => {
  it('has no accessibility failure for the defaults', () => {
    expect(contrastWarnings(base).map((w) => w.id)).toEqual([]);
  });

  it('flags a light accent and the dark fallback', () => {
    const ids = contrastWarnings({ ...base, accentColor: '#fde047' }).map((w) => w.id);
    expect(ids).toContain('accentOnLight');
    expect(ids).toContain('accentAsText');
    expect(ids).not.toContain('darkAccentFallback');
    const dark = contrastWarnings({ ...base, primaryColor: '#111111' }).map((w) => w.id);
    expect(dark).toContain('darkPrimaryFallback');
  });
});

describe('applyCssVars', () => {
  it('sets variables and removes stale ones', () => {
    const el = document.createElement('div');
    const keys = applyCssVars(el, { '--primary': '#111111', '--radius': '1rem' });
    expect(el.style.getPropertyValue('--primary')).toBe('#111111');
    applyCssVars(el, { '--radius': '2rem' }, keys);
    expect(el.style.getPropertyValue('--primary')).toBe('');
    expect(el.style.getPropertyValue('--radius')).toBe('2rem');
  });
});
