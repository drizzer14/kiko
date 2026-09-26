import { renderHook } from '@testing-library/react-native';

const mockUseLiveQuery = jest.fn();
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    listByAccountQuery: (accountId: string) => ({
      __kind: 'holdings-by-account',
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
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
        return {
          data: [{ id: 'h1', name: 'Black card', accountId: 'a', type: 'card' }],
          isLoading: false,
        };
      }

      return { data: [{ id: 'a', name: 'Monobank' }], isLoading: false };
    });

    const { result } = await renderHook(() => useTargetHoldingOptions('a'));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.options).toEqual([
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

  it('falls back to an empty account name when the joining account row has not loaded yet', async () => {
    mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => {
      if (query.__kind === 'holdings-by-account') {
        return {
          data: [{ id: 'h1', name: 'Black card', accountId: 'a', type: 'card' }],
          isLoading: false,
        };
      }

      return { data: [], isLoading: false };
    });

    const { result } = await renderHook(() => useTargetHoldingOptions('a'));

    expect(result.current.options).toEqual([
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
          isLoading: false,
        };
      }

      return { data: [{ id: 'a', name: 'Monobank' }], isLoading: false };
    });

    const { result } = await renderHook(() => useTargetHoldingOptions('a'));

    expect(result.current.options).toEqual([
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

  it('reports isLoading while either its holdings or its accounts query is still on its first load', async () => {
    mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => {
      if (query.__kind === 'holdings-by-account') {
        return { data: [], isLoading: true };
      }

      return { data: [], isLoading: false };
    });

    const { result } = await renderHook(() => useTargetHoldingOptions('a'));

    expect(result.current.isLoading).toBe(true);
    // Empty must never be handed to the picker as "no holdings" while a
    // query is still on its first load — the caller reads `isLoading`
    // instead of trusting an empty `options` array.
    expect(result.current.options).toEqual([]);
  });
});
