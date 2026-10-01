import { renderHook } from '@testing-library/react-native';

const mockUseLiveQuery = jest.fn();
jest.mock('@kiko/db/use-live-query', () => ({
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
// own icon/color) so `defaultHoldingColor`/`defaultHoldingSymbol`
// have something to key off — `card` resolves to `'creditcard'` /
// `entityColorsDark.white` (`entity-symbols.ts`/`entity-colors.ts`), asserted
// below rather than restated as a magic literal.
const CARD_ICON = 'creditcard';
const CARD_COLOR = '#FFFFFF';

// Serves `holdings` from the account-scoped holdings query and `accounts`
// from the accounts query, both already loaded.
const serveRows = (holdings: readonly object[], accounts: readonly object[]): void => {
  mockUseLiveQuery.mockImplementation((query: { __kind?: string }) => ({
    data: query.__kind === 'holdings-by-account' ? holdings : accounts,
    isLoading: false,
  }));
};

const blackCard = { id: 'h1', name: 'Black card', accountId: 'a', type: 'card' };

const optionsFor = async () => {
  const { result } = await renderHook(() => useTargetHoldingOptions('a'));

  return result.current;
};

describe('useTargetHoldingOptions', () => {
  it('scopes to one account and joins in that account’s own name', async () => {
    serveRows([blackCard], [{ id: 'a', name: 'Monobank' }]);

    const { isLoading, options } = await optionsFor();

    expect(isLoading).toBe(false);
    expect(options).toEqual([
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
    serveRows([blackCard], []);

    const { options } = await optionsFor();

    expect(options[0]?.accountName).toBe('');
  });

  it('prefers a stored custom icon/color over the type default', async () => {
    serveRows([{ ...blackCard, icon: 'star', color: '#ABCDEF' }], [{ id: 'a', name: 'Monobank' }]);

    const { options } = await optionsFor();

    expect(options[0]).toMatchObject({ icon: 'star', color: '#ABCDEF' });
  });

  // Imported rows land in the ledger, but these holdings take their value
  // from somewhere else, so the rows would change nothing they show.
  it('offers only an open holding that keeps a ledger and no sync owns', async () => {
    serveRows(
      [
        blackCard,
        { ...blackCard, id: 'deposit', type: 'term_deposit' },
        { ...blackCard, id: 'bond', type: 'bond' },
        { ...blackCard, id: 'metal', type: 'metal' },
        { ...blackCard, id: 'property', type: 'property_item' },
        { ...blackCard, id: 'closed', closedAt: 1_700_000_000_000 },
        { ...blackCard, id: 'jar', type: 'jar' },
      ],
      [{ id: 'a', name: 'Bank', institution: null }],
    );

    const { options } = await optionsFor();

    expect(options.map(({ id }) => id)).toEqual(['h1', 'jar']);
  });

  it('offers no holding on an account a bank sync owns, a hand-added one included', async () => {
    serveRows(
      [
        { ...blackCard, metadata: { monobankId: 'mono-1' } },
        { ...blackCard, id: 'hand-added' },
      ],
      [{ id: 'a', name: 'Monobank', institution: 'monobank' }],
    );

    const { options } = await optionsFor();

    expect(options).toEqual([]);
  });

  it('offers a holding a disconnected bank sync left behind', async () => {
    serveRows(
      [{ ...blackCard, metadata: { monobankId: 'mono-1' } }],
      [{ id: 'a', name: 'Monobank', institution: null }],
    );

    const { options } = await optionsFor();

    expect(options.map(({ id }) => id)).toEqual(['h1']);
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
