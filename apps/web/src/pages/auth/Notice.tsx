import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const TONES = {
  error: { icon: AlertCircle, className: 'border-destructive text-destructive', role: 'alert' },
  warning: { icon: AlertTriangle, className: 'border-foreground bg-muted', role: 'status' },
  info: { icon: Info, className: 'border-border bg-muted', role: 'status' },
  success: { icon: CheckCircle2, className: 'border-primary bg-muted', role: 'status' },
} as const;

interface NoticeProps {
  tone: keyof typeof TONES;
  /** Short bold lead-in; the tone is also conveyed by the icon, never by colour alone. */
  title?: string;
  /** Overrides the default role (`alert` for errors, `status` otherwise). */
  role?: 'alert' | 'status' | 'none';
  className?: string;
  children?: ReactNode;
}

/** Inline message block (error, warning, info, success) used by the setup and login flows. */
export function Notice({ tone, title, role, className, children }: NoticeProps) {
  const { icon: Icon, className: toneClass, role: defaultRole } = TONES[tone];
  const resolvedRole = role ?? defaultRole;
  return (
    <div
      role={resolvedRole === 'none' ? undefined : resolvedRole}
      className={cn('flex gap-3 border p-3 text-sm', toneClass, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="space-y-2 break-words">{children}</div> : null}
      </div>
    </div>
  );
}
