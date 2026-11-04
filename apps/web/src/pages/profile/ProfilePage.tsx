import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/common/PageHeader';
import { QuotaMeter } from '@/components/common/QuotaMeter';
import { useMe } from '@/hooks/use-me';
import { AccountSection } from './AccountSection';
import { PasswordSection } from './PasswordSection';
import { PreferencesSection } from './PreferencesSection';
import { Section } from './Section';
import { TwoFactorSection } from './TwoFactorSection';

export default function ProfilePage() {
  const { t } = useTranslation();
  const me = useMe();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title={t('profile.title')} description={t('profile.description')} />
      <div className="space-y-6">
        <AccountSection />
        <PreferencesSection />
        {me.data ? (
          <Section title={t('profile.storage.title')}>
            <QuotaMeter usedBytes={me.data.usedBytes} quotaBytes={me.data.quotaBytes} />
            {me.data.quotaBytes === null ? (
              <p className="text-muted-foreground text-sm">{t('profile.storage.unlimited')}</p>
            ) : null}
          </Section>
        ) : null}
        <PasswordSection />
        <TwoFactorSection />
      </div>
    </div>
  );
}
