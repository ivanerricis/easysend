import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthResponse } from '@easysend/shared';
import { Button } from '@/components/ui/button';
import { fetchHealth } from '@/lib/api';

type State = { kind: 'loading' } | { kind: 'ok'; health: HealthResponse } | { kind: 'error' };

export function ApiStatusCard() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal).then(
      (health) => {
        if (!controller.signal.aborted) setState({ kind: 'ok', health });
      },
      () => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const retry = () => {
    setState({ kind: 'loading' });
    setAttempt((value) => value + 1);
  };

  return (
    <section
      aria-labelledby="api-status-title"
      className="bg-card text-card-foreground border p-4 sm:p-6"
    >
      <h2 id="api-status-title" className="text-lg font-semibold">
        {t('status.title')}
      </h2>
      <div aria-live="polite" className="mt-3 text-sm">
        {state.kind === 'loading' && <p>{t('status.loading')}</p>}
        {state.kind === 'ok' && (
          <div>
            <p className="font-medium text-accent">{t('status.ok')}</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">{t('status.version')}</dt>
              <dd className="font-mono">{state.health.version}</dd>
              <dt className="text-muted-foreground">{t('status.mode')}</dt>
              <dd className="font-mono">
                {state.health.mode === 'local' ? t('status.modeLocal') : t('status.modeProduction')}
              </dd>
              <dt className="text-muted-foreground">{t('status.database')}</dt>
              <dd className="font-mono">
                {state.health.db === 'ok' ? t('status.dbOk') : t('status.dbError')}
              </dd>
            </dl>
          </div>
        )}
        {state.kind === 'error' && (
          <p className="text-destructive font-medium">{t('status.error')}</p>
        )}
      </div>
      {state.kind === 'error' && (
        <Button type="button" variant="outline" className="mt-4 h-11 px-4 text-sm" onClick={retry}>
          {t('status.retry')}
        </Button>
      )}
    </section>
  );
}
