import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormErrorSummary } from './FormErrorSummary';

const error = { password: { type: 'too_small', message: 'Too short' } };

function Field() {
  return <input aria-label="Password" />;
}

describe('FormErrorSummary', () => {
  it('takes the focus after a failed submit', () => {
    render(
      <>
        <Field />
        <FormErrorSummary errors={error} submitCount={1} />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveFocus();
  });

  it('does not steal the focus when errors come back while typing', () => {
    const { rerender } = render(
      <>
        <Field />
        <FormErrorSummary errors={error} submitCount={1} />
      </>,
    );
    // The user goes back to the field and fixes it: the error disappears...
    const field = screen.getByLabelText('Password');
    field.focus();
    rerender(
      <>
        <Field />
        <FormErrorSummary errors={{}} submitCount={1} />
      </>,
    );
    // ...then comes back while typing, without a new submit.
    rerender(
      <>
        <Field />
        <FormErrorSummary errors={error} submitCount={1} />
      </>,
    );
    expect(field).toHaveFocus();

    // A new failed submit moves the focus to the summary again.
    rerender(
      <>
        <Field />
        <FormErrorSummary errors={error} submitCount={2} />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveFocus();
  });
});
