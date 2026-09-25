import { renderHook } from '@testing-library/react-native';

const mockUseLiveQuery = jest.fn();
jest.mock('../../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    listByAccountQuery: (accountId: string) => ({
      __kind: 'holdings-by-account',
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    allQuery: () => ({ __kind: 'holdings-all', toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

import { useTargetHoldingOptions } from './use-target-holding-options';

// Every mock holding row carries a `type` (the picker resolves each row's
// own icon/color) so `defaultHoldingColor`/`holdingTypeSymbol`
// have something to key off — `card` resolves to `'creditcard'` /
// `entityColorsDark.white` (`entity-symbols.ts`/`entity-colors.ts`), asserted
// below rather than restated as a magic literal.
const CARD_ICON = 'creditcard';
const CARD_COLOR = '#FFFFFF';

describe('useTargetHoldingOptions', () => {
  it('scopes to one account and joins in that account’s own name', async () => {
    mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => {
      if (query.__kind === 'holdings-by-account') {
        return { data: [{ id: 'h1', name: 'Black card', accountId: 'a', type: 'card' }] };
      }

      return { data: [{ id: 'a', name: 'Monobank' }] };
    });

    const { result } = await renderHook(() => useTargetHoldingOptions('a'));

    expect(result.current).toEqual([
      {
        id: 'h1',
        name: 'Black card',
        accountId: 'a',
        accountName: 'Monobank',
        icon: CARD_ICON,
        color: CARD_COLOR,
      },
    ]);
  });

  it('lists every holding, across accounts, when accountId is undefined', async () => {
    mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => {
      if (query.__kind === 'holdings-all') {
        return {
          data: [
            { id: 'h1', name: 'Black card', accountId: 'a', type: 'card' },
            { id: 'h2', name: 'Cold storage', accountId: 'b', type: 'card' },
          ],
        };
      }

      return {
        data: [
          { id: 'a', name: 'Monobank' },
          { id: 'b', name: 'Ledger' },
        ],
      };
    });

    const { result } = await renderHook(() => useTargetHoldingOptions(undefined));

    expect(result.current).toEqual([
      {
        id: 'h1',
        name: 'Black card',
        accountId: 'a',
        accountName: 'Monobank',
        icon: CARD_ICON,
        color: CARD_COLOR,
      },
      {
        id: 'h2',
        name: 'Cold storage',
        accountId: 'b',
        accountName: 'Ledger',
        icon: CARD_ICON,
        color: CARD_COLOR,
      },
    ]);
  });

  it('falls back to an empty account name when the joining account row has not loaded yet', async () => {
    mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => {
      if (query.__kind === 'holdings-by-account') {
        return { data: [{ id: 'h1', name: 'Black card', accountId: 'a', type: 'card' }] };
      }

      return { data: [] };
    });

    const { result } = await renderHook(() => useTargetHoldingOptions('a'));

    expect(result.current).toEqual([
      {
        id: 'h1',
        name: 'Black card',
        accountId: 'a',
        accountName: '',
        icon: CARD_ICON,
        color: CARD_COLOR,
      },
    ]);
  });

  it('prefers a stored custom icon/color over the type default', async () => {
    mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => {
      if (query.__kind === 'holdings-by-account') {
        return {
          data: [
            {
              id: 'h1',
              name: 'Black card',
              accountId: 'a',
              type: 'card',
              icon: 'star',
              color: '#ABCDEF',
            },
          ],
        };
      }

      return { data: [{ id: 'a', name: 'Monobank' }] };
    });

    const { result } = await renderHook(() => useTargetHoldingOptions('a'));

    expect(result.current).toEqual([
      {
        id: 'h1',
        name: 'Black card',
        accountId: 'a',
        accountName: 'Monobank',
        icon: 'star',
        color: '#ABCDEF',
      },
    ]);
  });
});
