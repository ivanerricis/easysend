import { ChevronRight, Folder } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TREE_EXPAND_LIMIT, buildFileTree, type TreeFile, type TreeNode } from './tree';

interface FileTreeProps<T extends TreeFile & { id: string }> {
  files: readonly T[];
  /** Content of the row of one file (name, size, actions); the tree wraps it in a list item. */
  renderFile: (file: T) => ReactNode;
  /** Class names of a file row. */
  fileRowClassName?: string;
  /** Expand every folder at first (default: only when there are at most 50 files). */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Files grouped by folder path in collapsible folders. Folder rows show the number of files and
 * their total size; file rows come from `renderFile` so each page keeps its own actions.
 */
export function FileTree<T extends TreeFile & { id: string }>({
  files,
  renderFile,
  fileRowClassName,
  defaultOpen,
  className,
}: FileTreeProps<T>) {
  const { t, i18n } = useTranslation();
  const tree = useMemo(() => buildFileTree(files), [files]);
  const open = defaultOpen ?? files.length <= TREE_EXPAND_LIMIT;

  const renderNodes = (nodes: TreeNode<T>[], nested: boolean): ReactNode => (
    <ul
      className={cn(
        'divide-border divide-y',
        nested ? 'border-border ml-2 border-t border-l sm:ml-4' : 'border-border border',
        className && !nested ? className : '',
      )}
    >
      {nodes.map((node) =>
        node.type === 'file' ? (
          <li key={node.file.id} className={fileRowClassName}>
            {renderFile(node.file)}
          </li>
        ) : (
          <li key={`folder:${node.path}`}>
            <Collapsible defaultOpen={open} className="group/folder">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  data-testid="folder-row"
                  className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left outline-none focus-visible:ring-3"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 transition-transform group-data-[state=open]/folder:rotate-90 motion-reduce:transition-none"
                  />
                  <Folder aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
                    {node.name}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {t('common.units.files', { count: node.fileCount })} ·{' '}
                    {formatBytes(node.totalBytes, i18n.language)}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>{renderNodes(node.children, true)}</CollapsibleContent>
            </Collapsible>
          </li>
        ),
      )}
    </ul>
  );

  return renderNodes(tree, false);
}
