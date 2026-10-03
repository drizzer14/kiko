import { renderHook } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { accountKindSymbol } from '@kiko/holdings/entity-symbols';

import { accountKinds, useAccountKindLabels } from './use-account-kind-labels';

describe('accountKinds', () => {
  it('lists every account kind the glyph map covers, in its order', () => {
    expect(accountKinds).toEqual(Object.keys(accountKindSymbol));
  });
});

describe('useAccountKindLabels', () => {
  it('names every kind in the active language', async () => {
    const { result } = await renderHook(() => useAccountKindLabels());

    expect(result.current.labels).toEqual({
      bank: 'Bank',
      cash: 'Cash',
      crypto: 'Crypto',
      property: 'Property',
      metals: 'Precious metals',
      debt: 'Debt',
      broker: 'Broker',
    });
  });

  it('gives every kind a one-line subtitle', async () => {
    const { result } = await renderHook(() => useAccountKindLabels());

    expect(Object.keys(result.current.subtitles)).toEqual(accountKinds);
    expect(result.current.subtitles.debt).toBe('A loan or debt you owe.');
  });
});
