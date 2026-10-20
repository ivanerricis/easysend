import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { notifyError, notifySuccess } from '@/lib/toast';

/** Copies `text` with the Clipboard API; falls back to a hidden textarea + `execCommand`. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (insecure context, permissions): try the legacy path.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.setProperty('position', 'fixed');
  area.style.setProperty('opacity', '0');
  document.body.appendChild(area);
  area.select();
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

interface CopyButtonProps extends Omit<ComponentProps<typeof Button>, 'onClick' | 'children'> {
  /** Text put on the clipboard. */
  value: string;
  /** Visible label; defaults to "Copy". Icon-only buttons should pass `aria-label`. */
  children?: ReactNode;
  /** Toast on success (default true). */
  toast?: boolean;
  onCopied?: () => void;
}

/** Copy-to-clipboard button: shows a check for 2 s and a toast; an error toast if it fails. */
export function CopyButton({
  value,
  children,
  toast = true,
  onCopied,
  variant = 'outline',
  ...props
}: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async () => {
    if (await copyText(value)) {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
      if (toast) notifySuccess(t('common.actions.copied'));
      onCopied?.();
    } else {
      notifyError(t('common.actions.copyFailed'));
    }
  };

  const Icon = copied ? Check : Copy;
  return (
    <Button type="button" variant={variant} onClick={() => void onClick()} {...props}>
      <Icon aria-hidden="true" />
      {children === undefined
        ? copied
          ? t('common.actions.copied')
          : t('common.actions.copy')
        : children}
    </Button>
  );
}
