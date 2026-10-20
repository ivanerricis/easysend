import type { AppMode } from '@easysend/shared';

/** Facts collected while the wizard runs, shown in the final summary. */
export interface SetupSummary {
  adminEmail?: string;
  smtpHost?: string;
  smtpFrom?: string;
  publicUrl?: string;
  instanceName?: string;
}

export interface StepProps {
  appMode: AppMode;
  /**
   * Handles errors that end the step for every endpoint (setup already completed, setup cookie
   * expired). Returns true when it handled the error and the step should stop.
   */
  onFatal: (error: unknown) => boolean;
  /** The step is finished: move on, optionally recording summary facts. */
  onDone: (summary?: SetupSummary) => void;
}

export const stepActionsClass = 'flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end';
