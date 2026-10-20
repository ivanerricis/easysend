import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for irreversible actions (delete, revoke). */
  destructive?: boolean;
  /**
   * Runs on confirm. The dialog shows a pending state, closes when it resolves and stays open
   * when it throws (report the error yourself, e.g. with `notifyError`).
   */
  onConfirm: () => unknown;
}

/** Confirmation dialog (AlertDialog) with an async confirm action. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);

  const handleConfirm = async (event: React.MouseEvent) => {
    event.preventDefault(); // keep the dialog open until the action settles
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The caller reports the failure; the dialog stays open so the user can retry.
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {cancelLabel ?? t('common.confirmDialog.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            aria-busy={pending}
            onClick={(event) => void handleConfirm(event)}
          >
            {pending
              ? t('common.actions.working')
              : (confirmLabel ?? t('common.confirmDialog.confirm'))}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
