import { zodResolver } from '@hookform/resolvers/zod';
import {
  useForm,
  type Control,
  type FieldValues,
  type Resolver,
  type UseFormProps,
} from 'react-hook-form';
import type { z } from 'zod';
import i18n from '@/i18n';

/**
 * Translated messages for Zod's built-in issues, so forms built on the shared schemas show
 * natural text in the active language. Messages set on a schema (i18n keys) win over this map.
 */
export function zodIssueMessage(issue: z.core.$ZodRawIssue): string | undefined {
  const t = i18n.t.bind(i18n);
  switch (issue.code) {
    case 'invalid_type':
      return issue.expected === 'number' && issue.input !== undefined
        ? t('auth.errors.numberInvalid')
        : t('auth.errors.required');
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.origin === 'string') {
        return min <= 1 ? t('auth.errors.required') : t('auth.errors.tooShort', { count: min });
      }
      return t('auth.errors.numberMin', { min });
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      return issue.origin === 'string'
        ? t('auth.errors.tooLong', { count: max })
        : t('auth.errors.numberMax', { max });
    }
    case 'invalid_format': {
      if (issue.format === 'email') return t('auth.errors.emailInvalid');
      const field = issue.path?.[0];
      if (field === 'domain') return t('auth.errors.domainInvalid');
      if (field === 'subdomain') return t('auth.errors.subdomainInvalid');
      return t('auth.errors.invalidFormat');
    }
    default:
      return undefined;
  }
}

/**
 * `zodResolver` with the localized issue messages above. Typed on the schema's input (what the
 * form holds) and output (what the submit handler receives).
 */
export function formResolver<TInput extends FieldValues, TOutput>(
  schema: z.ZodType<TOutput, TInput>,
): Resolver<TInput, unknown, TOutput> {
  return zodResolver(schema as unknown as z.ZodType<TOutput, FieldValues>, {
    error: zodIssueMessage,
  }) as unknown as Resolver<TInput, unknown, TOutput>;
}

/**
 * `useForm` driven by a Zod schema: the form holds the schema's input, the submit handler gets
 * its output. `control` is typed on the input so it fits `FormField` / `TextField`.
 */
export function useZodForm<TInput extends FieldValues, TOutput>(
  schema: z.ZodType<TOutput, TInput>,
  options: Omit<UseFormProps<TInput, unknown, TOutput>, 'resolver'>,
) {
  const form = useForm<TInput, unknown, TOutput>({ ...options, resolver: formResolver(schema) });
  return { ...form, control: form.control as unknown as Control<TInput> };
}
