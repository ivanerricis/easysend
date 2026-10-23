import { Download } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { CopyButton } from './CopyButton';

interface RecoveryCodesProps {
  codes: readonly string[];
  /** Whether the user ticked "I have saved them". Keep it in the parent to gate the next step. */
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
}

/**
 * Recovery codes shown once: mono grid, copy all, download as .txt and a required confirmation
 * checkbox. The parent should keep its "continue" button disabled until `confirmed` is true.
 */
export function RecoveryCodes({ codes, confirmed, onConfirmedChange }: RecoveryCodesProps) {
  const { t } = useTranslation();
  const checkboxId = useId();
  const text = codes.join('\n');

  const download = () => {
    const body = `${t('common.recoveryCodes.fileHeader')}\n\n${text}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = t('common.recoveryCodes.fileName');
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-4" aria-labelledby={`${checkboxId}-title`}>
      <h2 id={`${checkboxId}-title`} className="text-lg font-semibold">
        {t('common.recoveryCodes.title')}
      </h2>
      <p className="text-muted-foreground text-sm">{t('common.recoveryCodes.description')}</p>
      <ul className="bg-muted grid grid-cols-1 gap-x-6 gap-y-2 p-4 font-mono text-base min-[400px]:grid-cols-2">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={text}>{t('common.recoveryCodes.copyAll')}</CopyButton>
        <Button type="button" variant="outline" onClick={download}>
          <Download aria-hidden="true" />
          {t('common.recoveryCodes.download')}
        </Button>
      </div>
      <div className="flex min-h-11 items-start gap-3">
        <Checkbox
          id={checkboxId}
          name="recovery-codes-saved"
          className="mt-3"
          checked={confirmed}
          onCheckedChange={(checked) => onConfirmedChange(checked === true)}
        />
        <Label htmlFor={checkboxId} className="min-h-11 flex-1 py-3 leading-snug">
          {t('common.recoveryCodes.confirm')}
        </Label>
      </div>
    </section>
  );
}
