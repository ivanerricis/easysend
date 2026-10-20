import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';

interface SelectedFilesProps {
  files: File[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}

/** Files chosen for the transfer with size and a remove button (scrolls inside the panel). */
export function SelectedFiles({ files, onRemove, disabled }: SelectedFilesProps) {
  const { t, i18n } = useTranslation();
  if (files.length === 0) return null;
  return (
    <ul
      className="divide-border border-border max-h-[max(10rem,calc(100dvh-36rem))] divide-y overflow-y-auto border"
      aria-label={t('transfers.new.selectedFiles')}
    >
      {files.map((file, index) => (
        <li key={`${index}-${file.name}-${file.size}`} className="flex items-center gap-2 pl-3">
          <span className="min-w-0 flex-1 py-2 text-sm [overflow-wrap:anywhere]">{file.name}</span>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {formatBytes(file.size, i18n.language)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={t('transfers.new.removeFile', { name: file.name })}
            onClick={() => onRemove(index)}
          >
            <X aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
