import type { TFunction } from 'i18next';

import { fieldErrorMessage } from './field-error-message';

describe('fieldErrorMessage', () => {
  it('renders nothing before a save attempt, even for a real reason key', () => {
    const t = jest.fn((key: string) => key) as unknown as TFunction;

    expect(fieldErrorMessage(t, false, 'forms.holding.quantityError')).toBeUndefined();
  });

  it('renders nothing for a null reason key, even after a save attempt', () => {
    const t = jest.fn((key: string) => key) as unknown as TFunction;

    expect(fieldErrorMessage(t, true, null)).toBeUndefined();
  });

  it('translates the reason key once a save attempt has been made', () => {
    const t = jest.fn((key: string) => `translated:${key}`) as unknown as TFunction;

    expect(fieldErrorMessage(t, true, 'forms.holding.quantityError')).toBe(
      'translated:forms.holding.quantityError',
    );
  });
});
