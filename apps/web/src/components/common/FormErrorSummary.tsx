import { useEffect, useRef } from 'react';
import type { FieldErrors, FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { fieldId } from './FormField';

interface SummaryItem {
  name: string;
  message: string;
}

function collect(errors: unknown, path: string[] = []): SummaryItem[] {
  if (typeof errors !== 'object' || errors === null) return [];
  const node = errors as { message?: unknown; type?: unknown } & Record<string, unknown>;
  if (typeof node.message === 'string' && typeof node.type === 'string') {
    return [{ name: path.join('.'), message: node.message }];
  }
  return Object.entries(node)
    .filter(([key]) => key !== 'ref')
    .flatMap(([key, value]) => collect(value, [...path, key]));
}

interface FormErrorSummaryProps<TValues extends FieldValues> {
  errors: FieldErrors<TValues>;
  /** `formState.submitCount`: each failed submit moves focus to the summary. */
  submitCount: number;
  /** Optional readable names per field (`{ email: 'Email' }`), shown before the message. */
  labels?: Partial<Record<string, string>>;
  idPrefix?: string;
}

/**
 * Accessibility approach for form validation (used by every form): errors are shown inline next
 * to each field AND, after a failed submit, listed here; the summary takes focus so screen
 * reader users hear the list, and each entry is a link that focuses its field. Render it at the
 * top of the form with `formState.errors` and `formState.submitCount`.
 */
export function FormErrorSummary<TValues extends FieldValues>({
  errors,
  submitCount,
  labels,
  idPrefix,
}: FormErrorSummaryProps<TValues>) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const focusedSubmit = useRef(0);
  const items = collect(errors);
  const hasErrors = items.length > 0;

  // Focus moves here once per failed submit. Errors that disappear and come back while the user
  // types (re-validation on change) must not steal the focus from the field being edited.
  useEffect(() => {
    if (submitCount > focusedSubmit.current && hasErrors) {
      focusedSubmit.current = submitCount;
      ref.current?.focus();
    }
  }, [submitCount, hasErrors]);

  if (!hasErrors) return null;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="border-destructive text-destructive border p-4 text-sm outline-none focus-visible:outline-2"
    >
      <p className="font-medium">{t('common.form.errorSummaryTitle')}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {items.map((item) => {
          const id = fieldId(item.name, idPrefix);
          const message = t(item.message, { defaultValue: item.message });
          const label = labels?.[item.name];
          return (
            <li key={item.name}>
              <a
                href={`#${id}`}
                className="underline underline-offset-4"
                onClick={(event) => {
                  const target = document.getElementById(id);
                  if (!target) return;
                  event.preventDefault();
                  target.focus();
                }}
              >
                {label ? `${label}: ${message}` : message}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
