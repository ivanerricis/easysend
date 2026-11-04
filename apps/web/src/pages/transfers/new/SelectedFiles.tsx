import { ChevronRight, Folder, X } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { topFolder } from '@/features/upload/folders';
import type { PickedFile } from '@/features/upload/types';
import { formatBytes } from '@/lib/format';

interface SelectedFilesProps {
  files: PickedFile[];
  /** Removes the file at this index of `files`. */
  onRemove: (index: number) => void;
  /** Removes every file of a top-level folder. */
  onRemoveFolder: (folder: string) => void;
  disabled?: boolean;
}

interface FolderGroup {
  name: string;
  items: { picked: PickedFile; index: number }[];
  bytes: number;
}

/** Splits the selection into top-level folders (first appearance order) and loose files. */
export function groupSelection(files: PickedFile[]): {
  folders: FolderGroup[];
  loose: { picked: PickedFile; index: number }[];
} {
  const folders = new Map<string, FolderGroup>();
  const loose: { picked: PickedFile; index: number }[] = [];
  files.forEach((picked, index) => {
    const name = topFolder(picked.path);
    if (name === '') {
      loose.push({ picked, index });
      return;
    }
    const group = folders.get(name) ?? { name, items: [], bytes: 0 };
    group.items.push({ picked, index });
    group.bytes += picked.file.size;
    folders.set(name, group);
  });
  return { folders: [...folders.values()], loose };
}

/**
 * Files chosen for the transfer, grouped by top-level folder (collapsed by default), with size
 * and remove buttons for each file and each folder (scrolls inside the panel).
 */
export function SelectedFiles({ files, onRemove, onRemoveFolder, disabled }: SelectedFilesProps) {
  const { t, i18n } = useTranslation();
  const { folders, loose } = useMemo(() => groupSelection(files), [files]);
  if (files.length === 0) return null;

  const fileRow = (picked: PickedFile, index: number, label: string) => (
    <li
      key={`${index}-${picked.path}-${picked.file.name}-${picked.file.size}`}
      className="flex items-center gap-2 pl-3"
    >
      <span className="min-w-0 flex-1 py-2 text-sm [overflow-wrap:anywhere]">{label}</span>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {formatBytes(picked.file.size, i18n.language)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        aria-label={t('transfers.new.removeFile', { name: picked.file.name })}
        onClick={() => onRemove(index)}
      >
        <X aria-hidden="true" />
      </Button>
    </li>
  );

  return (
    <ul
      className="divide-border border-border max-h-[max(10rem,calc(100dvh-36rem))] divide-y overflow-y-auto border"
      aria-label={t('transfers.new.selectedFiles')}
    >
      {folders.map((folder) => (
        <li key={folder.name}>
          <Collapsible className="group/folder">
            <div className="flex items-center gap-2">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left outline-none focus-visible:ring-3"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 transition-transform group-data-[state=open]/folder:rotate-90 motion-reduce:transition-none"
                  />
                  <Folder aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" title={folder.name}>
                    {folder.name}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {t('common.units.files', { count: folder.items.length })} ·{' '}
                    {formatBytes(folder.bytes, i18n.language)}
                  </span>
                </button>
              </CollapsibleTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label={t('transfers.new.removeFolder', { name: folder.name })}
                onClick={() => onRemoveFolder(folder.name)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <CollapsibleContent>
              <ul className="divide-border border-border ml-5 divide-y border-t border-l">
                {folder.items.map(({ picked, index }) =>
                  fileRow(
                    picked,
                    index,
                    picked.path.length > folder.name.length
                      ? `${picked.path.slice(folder.name.length + 1)}/${picked.file.name}`
                      : picked.file.name,
                  ),
                )}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </li>
      ))}
      {loose.map(({ picked, index }) => fileRow(picked, index, picked.file.name))}
    </ul>
  );
}
