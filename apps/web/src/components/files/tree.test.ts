import { describe, expect, it } from 'vitest';
import { buildFileTree, type FolderNode, type TreeFile } from './tree';

const file = (
  id: string,
  path: string,
  name: string,
  sizeBytes: number,
): TreeFile & { id: string } => ({
  id,
  path,
  name,
  sizeBytes,
});

describe('buildFileTree', () => {
  it('returns loose files as they are', () => {
    const tree = buildFileTree([file('1', '', 'b.txt', 2), file('2', '', 'a.txt', 1)]);
    expect(tree.map((n) => (n.type === 'file' ? n.file.name : n.name))).toEqual(['a.txt', 'b.txt']);
  });

  it('nests folders, sorts folders first and sums count and size up to the ancestors', () => {
    const tree = buildFileTree([
      file('1', '', 'readme.txt', 10),
      file('2', 'photos/2030', 'b.jpg', 100),
      file('3', 'photos', 'a.jpg', 50),
      file('4', 'photos/2030', 'c.jpg', 25),
      file('5', 'docs', 'd.pdf', 5),
    ]);
    expect(tree.map((n) => (n.type === 'file' ? n.file.name : n.name))).toEqual([
      'docs',
      'photos',
      'readme.txt',
    ]);
    const photos = tree[1] as FolderNode<TreeFile>;
    expect(photos).toMatchObject({ path: 'photos', fileCount: 3, totalBytes: 175 });
    const inner = photos.children[0] as FolderNode<TreeFile>;
    expect(inner).toMatchObject({
      type: 'folder',
      name: '2030',
      path: 'photos/2030',
      fileCount: 2,
    });
    expect(photos.children[1]).toMatchObject({ type: 'file' });
  });

  it('sorts numerically and tolerates stray slashes', () => {
    const tree = buildFileTree([file('1', '/a//b/', 'x10.txt', 1), file('2', 'a/b', 'x2.txt', 1)]);
    const a = tree[0] as FolderNode<ReturnType<typeof file>>;
    const b = a.children[0] as FolderNode<ReturnType<typeof file>>;
    expect(b.path).toBe('a/b');
    expect(b.children.map((n) => (n.type === 'file' ? n.file.name : ''))).toEqual([
      'x2.txt',
      'x10.txt',
    ]);
  });
});
