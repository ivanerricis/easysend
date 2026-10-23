import { UploadCloud } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DropzoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Id of the element describing the zone (limits, errors). */
  describedBy?: string | undefined;
  invalid?: boolean;
  /** Id of the "Choose files" button, so the page can focus it after a failed submit. */
  buttonId?: string;
}

/** Files of a drop, skipping folders (the browser reports them as files of size 0 or 4096). */
function droppedFiles(event: DragEvent): File[] {
  const items = Array.from(event.dataTransfer.items ?? []);
  const withEntries = items.filter((item) => item.kind === 'file');
  if (withEntries.length > 0 && typeof withEntries[0]?.webkitGetAsEntry === 'function') {
    return withEntries
      .filter((item) => !item.webkitGetAsEntry()?.isDirectory)
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
  }
  return Array.from(event.dataTransfer.files);
}

/**
 * Drag & drop area plus a real "Choose files" button (the button is the keyboard and
 * assistive-technology path; dropping is only a shortcut).
 */
export function Dropzone({ onFiles, disabled, describedBy, invalid, buttonId }: DropzoneProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

  return (
    <div
      onDragEnter={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (disabled) return;
        const files = droppedFiles(event);
        if (files.length > 0) onFiles(files);
      }}
      className={cn(
        'flex flex-col items-center gap-3 border-2 border-dashed px-4 py-8 text-center transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-input',
        invalid && !dragging && 'border-destructive',
      )}
    >
      <UploadCloud aria-hidden="true" className="text-muted-foreground size-8" />
      <p className="text-sm font-medium">
        {dragging ? t('transfers.new.dropActive') : t('transfers.new.dropHint')}
      </p>
      <input
        ref={inputRef}
        type="file"
        name="files"
        multiple
        hidden
        data-testid="file-input"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = ''; // the same file can be picked again after removing it
          if (files.length > 0) onFiles(files);
        }}
      />
      <Button
        id={buttonId}
        type="button"
        variant="outline"
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={() => inputRef.current?.click()}
      >
        {t('transfers.new.chooseFiles')}
      </Button>
    </div>
  );
}
