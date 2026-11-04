import { FolderUp, UploadCloud } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { pickedFromInput, startCollectDrop } from '@/features/upload/folders';
import type { PickedFile } from '@/features/upload/types';
import { cn } from '@/lib/utils';

interface DropzoneProps {
  onFiles: (files: PickedFile[]) => void;
  disabled?: boolean;
  /** Id of the element describing the zone (limits, errors). */
  describedBy?: string | undefined;
  invalid?: boolean;
  /** Id of the "Choose files" button, so the page can focus it after a failed submit. */
  buttonId?: string;
}

/**
 * Drag & drop area (files and folders) plus real "Choose files" and "Choose folder" buttons
 * (the buttons are the keyboard and assistive-technology path; dropping is only a shortcut).
 */
export function Dropzone({ onFiles, disabled, describedBy, invalid, buttonId }: DropzoneProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
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
        // Entries are read before the first await: the browser clears the event data afterwards.
        void startCollectDrop(event.dataTransfer).then((files) => {
          if (files.length > 0) onFiles(files);
        });
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
          const files = pickedFromInput(event.target.files, false);
          event.target.value = ''; // the same file can be picked again after removing it
          if (files.length > 0) onFiles(files);
        }}
      />
      <input
        ref={folderRef}
        type="file"
        name="folder"
        multiple
        hidden
        data-testid="folder-input"
        tabIndex={-1}
        {...{ webkitdirectory: '' }}
        onChange={(event) => {
          const files = pickedFromInput(event.target.files, true);
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      <div className="flex flex-wrap justify-center gap-2">
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
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-describedby={describedBy}
          onClick={() => folderRef.current?.click()}
        >
          <FolderUp aria-hidden="true" />
          {t('transfers.new.chooseFolder')}
        </Button>
      </div>
    </div>
  );
}
