import type { SetupStatusResponse } from '@easysend/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { useAppearance } from '@/app/providers/AppearanceProvider';
import { queryKeys } from '@/app/query';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { PublicCard } from '@/components/layout/PublicLayout';
import { getSetupStatus } from '@/lib/api/setup';
import { hasErrorCode } from '@/lib/errors';
import { notifySuccess } from '@/lib/toast';
import { Notice } from '../auth/Notice';
import { AdminStep } from './AdminStep';
import { CloudflareStep } from './CloudflareStep';
import { CodeStep } from './CodeStep';
import { CompleteStep } from './CompleteStep';
import { GeneralStep } from './GeneralStep';
import { SmtpStep } from './SmtpStep';
import { SETUP_STEPS, Stepper, type SetupStepId } from './Stepper';
import type { SetupSummary } from './types';

/** First step that is not done yet (the wizard resumes there). */
function resumeStep(status: SetupStatusResponse): SetupStepId {
  if (!status.codeVerified) return 'code';
  if (!status.steps.admin) return 'admin';
  if (!status.steps.smtp) return 'smtp';
  if (!status.steps.cloudflare) return 'cloudflare';
  if (!status.steps.general) return 'general';
  return 'complete';
}

function nextStep(step: SetupStepId): SetupStepId {
  return SETUP_STEPS[Math.min(SETUP_STEPS.indexOf(step) + 1, SETUP_STEPS.length - 1)] ?? 'complete';
}

/** First-run wizard: setup code, administrator, email, Cloudflare, general settings, summary. */
export default function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refresh: refreshAppearance } = useAppearance();
  const status = useQuery({
    queryKey: queryKeys.setup.status,
    queryFn: getSetupStatus,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const [current, setCurrent] = useState<SetupStepId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<SetupSummary>({});

  const goTo = useCallback((step: SetupStepId, message: string | null = null) => {
    setNotice(message);
    setCurrent(step);
  }, []);

  /** Errors that end any step: setup already completed, or the setup cookie expired. */
  const onFatal = useCallback(
    (error: unknown): boolean => {
      if (hasErrorCode(error, 'SETUP_ALREADY_COMPLETED')) {
        void (async () => {
          await refreshAppearance().catch(() => undefined);
          void navigate('/login', { replace: true });
        })();
        return true;
      }
      if (hasErrorCode(error, 'UNAUTHENTICATED')) {
        goTo('code', t('setup.sessionExpired'));
        return true;
      }
      return false;
    },
    [goTo, navigate, refreshAppearance, t],
  );

  if (status.isPending) {
    return (
      <PublicCard width="wide">
        <PageHeader title={t('setup.title')} />
        <LoadingState label={t('common.states.loading')} />
      </PublicCard>
    );
  }
  if (status.isError) {
    return (
      <PublicCard width="wide">
        <PageHeader title={t('setup.title')} />
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      </PublicCard>
    );
  }
  const data = status.data;
  if (data.setupCompleted) return <Navigate to="/login" replace />;

  const step = current ?? resumeStep(data);
  const advance = (summaryPatch?: SetupSummary) => {
    if (summaryPatch) setSummary((previous) => ({ ...previous, ...summaryPatch }));
    goTo(nextStep(step));
  };
  const common = { appMode: data.appMode, onFatal, onDone: advance };

  const complete = async () => {
    await refreshAppearance().catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    await queryClient.invalidateQueries({ queryKey: queryKeys.publicSettings });
    notifySuccess(t('setup.completeToast'));
    void navigate('/', { replace: true });
  };

  return (
    <PublicCard width="wide">
      <PageHeader title={t('setup.title')} description={t('setup.subtitle')} />
      <Stepper current={step} cloudflareSkipped={data.appMode === 'local'} />
      {notice && step !== 'code' ? (
        <Notice tone="warning" className="mb-5">
          {notice}
        </Notice>
      ) : null}
      {step === 'code' ? <CodeStep key="code" {...common} notice={notice} /> : null}
      {step === 'admin' ? <AdminStep key="admin" {...common} /> : null}
      {step === 'smtp' ? <SmtpStep key="smtp" {...common} /> : null}
      {step === 'cloudflare' ? <CloudflareStep key="cloudflare" {...common} /> : null}
      {step === 'general' ? <GeneralStep key="general" {...common} /> : null}
      {step === 'complete' ? (
        <CompleteStep
          key="complete"
          appMode={data.appMode}
          onFatal={onFatal}
          summary={summary}
          onCompleted={() => void complete()}
          onMissing={(missing) => {
            const first = missing[0] ?? 'admin';
            goTo(
              first,
              t('setup.missing', {
                steps: missing.map((id) => t(`setup.stepper.${id}`)).join(', '),
              }),
            );
          }}
        />
      ) : null}
    </PublicCard>
  );
}
