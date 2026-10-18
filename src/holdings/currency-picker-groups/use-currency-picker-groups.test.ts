import { renderHook } from '@testing-library/react-native';
import '@kiko/i18n/init';
import { holdCurrencies } from '@kiko/test-support/held-currencies';

import type { CurrencyPickerContext } from './currency-picker-groups';
import { useCurrencyPickerGroups } from './use-currency-picker-groups';

jest.mock(
  '@kiko/holdings/use-held-currencies',
  () => jest.requireActual('@kiko/test-support/held-currencies').heldCurrenciesModule,
);

beforeEach(() => {
  holdCurrencies([]);
});

describe('useCurrencyPickerGroups', () => {
  it('lists the user’s currencies first for the any context', async () => {
    holdCurrencies(['USD']);

    const { result } = await renderHook(() => useCurrencyPickerGroups({ kind: 'any' }));

    expect(result.current.map(({ kind }) => kind)).toEqual(['held', 'fiat', 'crypto']);
  });

  it.each<[string, CurrencyPickerContext]>([
    ['a holding', { kind: 'holding', type: 'bond' }],
    ['a statement target', { kind: 'statement', target: { currency: 'USD', type: 'cash' } }],
    ['no statement target', { kind: 'statement', target: undefined }],
    ['any', { kind: 'any' }],
  ])(
    'keeps the same groups across a re-render with an equal %s context',
    async (_label, fields) => {
      const { result, rerender } = await renderHook(
        (context: CurrencyPickerContext) => useCurrencyPickerGroups(context),
        { initialProps: { ...fields } },
      );
      const first = result.current;

      await rerender({ ...fields });

      expect(result.current).toBe(first);
    },
  );

  it('builds new groups when the context changes', async () => {
    const { result, rerender } = await renderHook(
      (context: CurrencyPickerContext) => useCurrencyPickerGroups(context),
      { initialProps: { kind: 'holding', type: 'bond' } as CurrencyPickerContext },
    );
    const first = result.current;

    await rerender({ kind: 'holding', type: 'crypto_asset' });

    expect(result.current).not.toBe(first);
  });
});
