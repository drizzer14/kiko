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

describe('useTargetHoldingOptions', () => {
  it('scopes to one account and joins in that account’s own name', async () => {
    mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => {
      if (query.__kind === 'holdings-by-account') {
        return { data: [{ id: 'h1', name: 'Black card', accountId: 'a' }] };
      }

      return { data: [{ id: 'a', name: 'Monobank' }] };
    });

    const { result } = await renderHook(() => useTargetHoldingOptions('a'));

    expect(result.current).toEqual([
      { id: 'h1', name: 'Black card', accountId: 'a', accountName: 'Monobank' },
    ]);
  });

  it('lists every holding, across accounts, when accountId is undefined', async () => {
    mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => {
      if (query.__kind === 'holdings-all') {
        return {
          data: [
            { id: 'h1', name: 'Black card', accountId: 'a' },
            { id: 'h2', name: 'Cold storage', accountId: 'b' },
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
      { id: 'h1', name: 'Black card', accountId: 'a', accountName: 'Monobank' },
      { id: 'h2', name: 'Cold storage', accountId: 'b', accountName: 'Ledger' },
    ]);
  });

  it('falls back to an empty account name when the joining account row has not loaded yet', async () => {
    mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => {
      if (query.__kind === 'holdings-by-account') {
        return { data: [{ id: 'h1', name: 'Black card', accountId: 'a' }] };
      }

      return { data: [] };
    });

    const { result } = await renderHook(() => useTargetHoldingOptions('a'));

    expect(result.current).toEqual([
      { id: 'h1', name: 'Black card', accountId: 'a', accountName: '' },
    ]);
  });
});
