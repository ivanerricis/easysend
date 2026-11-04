/** What the tree needs from a file of a transfer, a download page or a submission. */
export interface TreeFile {
  /** Folder inside the transfer ("" for the root), segments joined by "/". */
  path: string;
  name: string;
  sizeBytes: number;
}

export interface FileNode<T extends TreeFile> {
  type: 'file';
  file: T;
}

export interface FolderNode<T extends TreeFile> {
  type: 'folder';
  name: string;
  /** Full path of the folder from the root. */
  path: string;
  children: TreeNode<T>[];
  /** Files in this folder and all its sub-folders. */
  fileCount: number;
  totalBytes: number;
}

export type TreeNode<T extends TreeFile> = FileNode<T> | FolderNode<T>;

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Groups a flat file list by folder path: folders first, then files, each sorted by name. */
export function buildFileTree<T extends TreeFile>(files: readonly T[]): TreeNode<T>[] {
  const root: FolderNode<T> = {
    type: 'folder',
    name: '',
    path: '',
    children: [],
    fileCount: 0,
    totalBytes: 0,
  };
  const folders = new Map<string, FolderNode<T>>([['', root]]);

  const folderAt = (path: string): FolderNode<T> => {
    const existing = folders.get(path);
    if (existing) return existing;
    const segments = path.split('/');
    const name = segments[segments.length - 1] ?? '';
    const parent = folderAt(segments.slice(0, -1).join('/'));
    const created: FolderNode<T> = {
      type: 'folder',
      name,
      path,
      children: [],
      fileCount: 0,
      totalBytes: 0,
    };
    parent.children.push(created);
    folders.set(path, created);
    return created;
  };

  for (const file of files) {
    const path = file.path
      .split('/')
      .filter((segment) => segment !== '')
      .join('/');
    const folder = folderAt(path);
    folder.children.push({ type: 'file', file });
    // Counts go to the folder and every ancestor.
    let current: string | null = path;
    for (;;) {
      const node: FolderNode<T> = folderAt(current);
      node.fileCount += 1;
      node.totalBytes += file.sizeBytes;
      if (current === '') break;
      const cut: number = current.lastIndexOf('/');
      current = cut === -1 ? '' : current.slice(0, cut);
    }
  }

  const sort = (node: FolderNode<T>) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      if (a.type === 'folder' && b.type === 'folder') return compare(a.name, b.name);
      if (a.type === 'file' && b.type === 'file') return compare(a.file.name, b.file.name);
      return 0;
    });
    for (const child of node.children) if (child.type === 'folder') sort(child);
  };
  sort(root);
  return root.children;
}

/** Folders are expanded by default only when the transfer is small. */
export const TREE_EXPAND_LIMIT = 50;
