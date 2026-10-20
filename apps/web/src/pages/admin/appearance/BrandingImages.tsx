import {
  ALLOWED_IMAGE_TYPES,
  BRANDING_ASSET_KINDS,
  BRANDING_MAX_BYTES,
  type BrandingAssetKind,
} from '@easysend/shared';
import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { assetUrl, deleteBrandingAsset, uploadBrandingAsset } from '@/lib/api/settings';
import { errorMessage } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { notifyError, notifySuccess } from '@/lib/toast';

const ACCEPT = ALLOWED_IMAGE_TYPES.join(',');

function isAllowedType(type: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

/** Upload / remove the four branding images; the change is applied right away. */
export function BrandingImages() {
  const { t, i18n } = useTranslation();
  return (
    <section aria-labelledby="appearance-images" className="space-y-4">
      <div className="space-y-1">
        <h2 id="appearance-images" className="text-lg font-semibold">
          {t('admin.appearance.images.title')}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">
          {t('admin.appearance.images.description', {
            size: formatBytes(BRANDING_MAX_BYTES, i18n.language),
          })}
        </p>
      </div>
      <ul className="divide-border border-border divide-y border">
        {BRANDING_ASSET_KINDS.map((kind) => (
          <ImageRow key={kind} kind={kind} />
        ))}
      </ul>
    </section>
  );
}

function ImageRow({ kind }: { kind: BrandingAssetKind }) {
  const { t, i18n } = useTranslation();
  const { assets, refresh } = useAppearance();
  const info = assets[kind];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inputId = `branding-${kind}`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const label = t(`admin.appearance.images.kinds.${kind}`);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    if (!isAllowedType(file.type)) {
      setError(t('admin.appearance.images.errors.type'));
      input.value = '';
      return;
    }
    if (file.size > BRANDING_MAX_BYTES) {
      setError(
        t('admin.appearance.images.errors.size', {
          max: formatBytes(BRANDING_MAX_BYTES, i18n.language),
        }),
      );
      input.value = '';
      return;
    }
    setBusy(true);
    try {
      await uploadBrandingAsset(kind, file);
      await refresh();
      notifySuccess(t('admin.appearance.images.uploadedToast', { name: label }));
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
      input.value = '';
    }
  };

  const remove = async () => {
    try {
      await deleteBrandingAsset(kind);
      await refresh();
      setError(null);
      notifySuccess(t('admin.appearance.images.removedToast', { name: label }));
    } catch (e) {
      notifyError(errorMessage(t, e));
      throw e;
    }
  };

  return (
    <li className="grid gap-3 p-4 sm:grid-cols-[8rem_1fr]" data-testid={`image-${kind}`}>
      <div className="bg-muted border-border flex h-20 items-center justify-center border p-2 sm:h-24">
        {info ? (
          <img
            src={assetUrl(kind, info.updatedAt)}
            alt={t('admin.appearance.images.currentAlt', { name: label })}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-muted-foreground text-center text-xs">
            {t('admin.appearance.images.default')}
          </span>
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <Label htmlFor={inputId} className="text-sm font-medium">
          {label}
        </Label>
        <p id={helpId} className="text-muted-foreground text-sm">
          {t(`admin.appearance.images.help.${kind}`)}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id={inputId}
            type="file"
            accept={ACCEPT}
            disabled={busy}
            aria-describedby={error ? `${helpId} ${errorId}` : helpId}
            aria-invalid={error ? true : undefined}
            className="max-w-xs"
            onChange={(event) => void onFile(event)}
          />
          {info ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              aria-label={t('admin.appearance.images.removeLabel', { name: label })}
              onClick={() => setConfirmRemove(true)}
            >
              {t('common.actions.remove')}
            </Button>
          ) : null}
        </div>
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {busy ? t('admin.appearance.images.uploading') : ''}
        </p>
        {error ? (
          <p id={errorId} role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('admin.appearance.images.removeTitle', { name: label })}
        description={t('admin.appearance.images.removeDescription')}
        confirmLabel={t('common.actions.remove')}
        destructive
        onConfirm={remove}
      />
    </li>
  );
}
