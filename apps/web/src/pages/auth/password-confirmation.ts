import type { z } from 'zod';

/**
 * Adds the "the two passwords match" rule to a form schema that has a `confirmPassword` field.
 * `passwordKey` names the field holding the new password (`newPassword`, `password`...). The
 * error is attached to `confirmPassword` with one shared translated message.
 */
export function withPasswordConfirmation<TShape extends z.ZodRawShape>(
  schema: z.ZodObject<TShape>,
  passwordKey: keyof TShape & string,
) {
  return schema.refine(
    (values) =>
      (values as Record<string, unknown>)[passwordKey] ===
      (values as Record<string, unknown>)['confirmPassword'],
    { path: ['confirmPassword'], message: 'auth.errors.passwordMismatch' },
  );
}
