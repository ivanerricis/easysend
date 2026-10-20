import { ERROR_CODE_LIST } from '@easysend/shared';
import { describe, expect, it } from 'vitest';
import { NAMESPACES, resources } from '.';

type Tree = { [key: string]: string | Tree };

/** Dotted paths of every leaf, sorted. */
function leafPaths(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree)
    .flatMap(([key, value]) =>
      typeof value === 'string' ? [prefix + key] : leafPaths(value, `${prefix}${key}.`),
    )
    .sort();
}

const itTree = resources.it.translation as unknown as Record<string, Tree>;
const enTree = resources.en.translation as unknown as Record<string, Tree>;

describe('translations', () => {
  it.each([...NAMESPACES])('has the same keys in it and en for "%s"', (namespace) => {
    expect(itTree[namespace]).toBeDefined();
    expect(leafPaths(itTree[namespace] ?? {})).toEqual(leafPaths(enTree[namespace] ?? {}));
  });

  it.each(['it', 'en'] as const)('has no empty strings in %s', (lng) => {
    const all = lng === 'it' ? itTree : enTree;
    for (const namespace of NAMESPACES) {
      const tree = all[namespace] ?? {};
      const empty = leafPaths(tree).filter((path) => {
        let node: string | Tree | undefined = tree;
        for (const part of path.split('.'))
          node = typeof node === 'object' ? node[part] : undefined;
        return node === '';
      });
      expect(empty, `${lng}/${namespace}`).toEqual([]);
    }
  });

  it('translates every API error code in both languages', () => {
    for (const code of ERROR_CODE_LIST) {
      expect(typeof itTree['errors']?.[code], `it ${code}`).toBe('string');
      expect(typeof enTree['errors']?.[code], `en ${code}`).toBe('string');
    }
    expect(typeof itTree['errors']?.['generic']).toBe('string');
  });
});
