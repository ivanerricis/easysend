import { useTranslation } from 'react-i18next';
import { ApiStatusCard } from '@/components/ApiStatusCard';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

export default function App() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-3"
      >
        {t('app.skipToContent')}
      </a>
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <p className="font-mono text-lg font-semibold">{t('app.name')}</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12"
      >
        <h1 className="text-2xl font-semibold sm:text-3xl">{t('home.title')}</h1>
        <p className="text-muted-foreground mt-3 max-w-prose">{t('home.description')}</p>
        <div className="mt-8 max-w-xl">
          <ApiStatusCard />
        </div>
      </main>
      <footer className="border-t">
        <p className="text-muted-foreground mx-auto w-full max-w-5xl px-4 py-4 text-sm sm:px-6">
          {t('footer.text')}
        </p>
      </footer>
    </div>
  );
}
