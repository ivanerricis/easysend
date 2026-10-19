import { describe, expect, it } from 'vitest';
import { contrastRatio, readableTextColor, relativeLuminance } from './color.js';
import { DEFAULT_APPEARANCE, appearanceSchema } from './schemas/settings.js';

describe('color', () => {
  it('computes the luminance of black and white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('computes the WCAG contrast ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5);
  });

  it('picks a readable text colour', () => {
    expect(readableTextColor('#ffffff')).toBe('#000000');
    expect(readableTextColor('#18181b')).toBe('#ffffff');
    expect(readableTextColor('#047857')).toBe('#ffffff');
    expect(readableTextColor('#34d399')).toBe('#000000');
  });

  it('rejects malformed colours', () => {
    expect(() => relativeLuminance('red')).toThrow();
  });

  it('keeps the default appearance valid', () => {
    expect(appearanceSchema.safeParse(DEFAULT_APPEARANCE).success).toBe(true);
  });
});
