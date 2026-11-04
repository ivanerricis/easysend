import {
  S3_ACCESS_KEY_ID_MAX_LENGTH,
  S3_ENDPOINT_MAX_LENGTH,
  S3_PREFIX_MAX_LENGTH,
  S3_REGION_MAX_LENGTH,
  S3_SECRET_ACCESS_KEY_MAX_LENGTH,
  type StorageSettingsResponse,
} from '@easysend/shared';
import { ChevronRight } from 'lucide-react';
import type { Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ChoiceField } from '@/components/common/ChoiceField';
import { FormField, SwitchField, TextField } from '@/components/common/FormField';
import { PasswordInput } from '@/components/common/PasswordInput';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Notice } from '../auth/Notice';
import type { StorageFormValues } from './storage';

interface StorageFieldsProps {
  control: Control<StorageFormValues>;
  idPrefix?: string;
  /** Current form driver. */
  driver: StorageFormValues['driver'];
  /** A secret key is already saved: leaving the field empty keeps it. */
  hasSecret: boolean;
  locked: StorageSettingsResponse['locked'];
}

/** Labels of the fields, for `FormErrorSummary`. */
export function storageFieldLabels(t: (key: string) => string) {
  return {
    endpoint: t('setup.storage.fields.endpoint'),
    region: t('setup.storage.fields.region'),
    bucket: t('setup.storage.fields.bucket'),
    prefix: t('setup.storage.fields.prefix'),
    accessKeyId: t('setup.storage.fields.accessKeyId'),
    secretAccessKey: t('setup.storage.fields.secretAccessKey'),
  };
}

const PROVIDERS = ['r2', 'minio', 'aws', 'b2', 'wasabi'] as const;

/** Driver choice and the S3 fields, identical in the setup wizard and in the admin settings. */
export function StorageFields({
  control,
  idPrefix,
  driver,
  hasSecret,
  locked,
}: StorageFieldsProps) {
  const { t } = useTranslation();
  const isLocked = (field: 'endpoint' | 'bucket' | 'prefix') => locked.fields.includes(field);
  const lockedHint = t('setup.storage.lockedField');

  return (
    <>
      <ChoiceField
        control={control}
        name="driver"
        legend={t('setup.storage.driver')}
        options={[
          {
            value: 'local',
            label: t('setup.storage.driverLocal'),
            description: t('setup.storage.driverLocalHint'),
          },
          {
            value: 's3',
            label: t('setup.storage.driverS3'),
            description: t('setup.storage.driverS3Hint'),
          },
        ]}
      />
      {driver === 's3' ? (
        <div className="space-y-5">
          {locked.reason === 's3_has_files' ? (
            <Notice tone="info" title={t('setup.storage.lockedTitle')}>
              <p>{t('setup.storage.lockedBody')}</p>
            </Notice>
          ) : null}
          <TextField
            control={control}
            name="endpoint"
            idPrefix={idPrefix}
            label={t('setup.storage.fields.endpoint')}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://s3.example.com"
            maxLength={S3_ENDPOINT_MAX_LENGTH}
            disabled={isLocked('endpoint')}
            description={isLocked('endpoint') ? lockedHint : t('setup.storage.endpointHelp')}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              control={control}
              name="region"
              idPrefix={idPrefix}
              label={t('setup.storage.fields.region')}
              autoComplete="off"
              maxLength={S3_REGION_MAX_LENGTH}
              description={t('setup.storage.regionHelp')}
            />
            <TextField
              control={control}
              name="bucket"
              idPrefix={idPrefix}
              label={t('setup.storage.fields.bucket')}
              autoComplete="off"
              disabled={isLocked('bucket')}
              description={isLocked('bucket') ? lockedHint : undefined}
            />
          </div>
          <TextField
            control={control}
            name="prefix"
            idPrefix={idPrefix}
            label={t('setup.storage.fields.prefix')}
            optional
            autoComplete="off"
            placeholder="easysend"
            maxLength={S3_PREFIX_MAX_LENGTH}
            disabled={isLocked('prefix')}
            description={isLocked('prefix') ? lockedHint : t('setup.storage.prefixHelp')}
          />
          <SwitchField
            control={control}
            name="forcePathStyle"
            idPrefix={idPrefix}
            label={t('setup.storage.fields.forcePathStyle')}
            description={t('setup.storage.pathStyleHelp')}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              control={control}
              name="accessKeyId"
              idPrefix={idPrefix}
              label={t('setup.storage.fields.accessKeyId')}
              autoComplete="off"
              maxLength={S3_ACCESS_KEY_ID_MAX_LENGTH}
            />
            <FormField
              control={control}
              name="secretAccessKey"
              idPrefix={idPrefix}
              label={t('setup.storage.fields.secretAccessKey')}
              optional={hasSecret}
              description={hasSecret ? t('setup.storage.secretKept') : undefined}
            >
              {({ field, controlProps }) => (
                <PasswordInput
                  autoComplete="new-password"
                  maxLength={S3_SECRET_ACCESS_KEY_MAX_LENGTH}
                  placeholder={hasSecret ? '••••••••' : undefined}
                  {...field}
                  {...controlProps}
                />
              )}
            </FormField>
          </div>
          <Collapsible className="text-sm">
            <CollapsibleTrigger className="group flex min-h-11 items-center gap-2 font-medium">
              <ChevronRight
                aria-hidden="true"
                className="size-4 transition-transform group-data-[state=open]:rotate-90"
              />
              {t('setup.storage.providersTitle')}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="text-muted-foreground list-disc space-y-1 pb-2 pl-9">
                {PROVIDERS.map((provider) => (
                  <li key={provider} className="break-words">
                    {t(`setup.storage.providers.${provider}`)}
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}
    </>
  );
}
