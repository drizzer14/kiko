import type { ComponentProps } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { clearLiveQueryCache } from '@kiko/db';
import { holdingsRepo } from '@kiko/holdings/repo';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import HoldingFormScreen from './holding-form.screen';

// kiko-architecture: the live-query cache is for display screens only. This
// suite runs the REAL `useLiveQuery` (only the native reactive trigger and the
// repos are doubled), so a reopened edit form goes through the same cache the
// app uses: its one-shot seed must come from a fresh read, never from the rows
// the previous (cancelled) visit left in the cache.

type HoldingFormProps = ComponentProps<typeof HoldingFormScreen>;
type Row = { id: string };

// The in-memory tables the query doubles read AT AWAIT TIME, like a real
// query — so a write made while the form is unmounted is visible to the next
// read, but never pushed to a cache entry nobody is subscribed to.
const mockTables: { holdings: Row[]; accounts: Row[] } = { holdings: [], accounts: [] };

const mockQuery = (sql: string, params: unknown[], read: () => unknown[]) => ({
  toSQL: () => ({ sql, params }),
  // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) a Drizzle query builder is itself awaitable — the hook awaits `query` for its rows, so this double must expose `then`.
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve().then(read).then(onfulfilled, onrejected);
  },
});

// The native trigger only: no reactive fire ever arrives, which is exactly the
// unmounted-form case (a write with no subscriber for the form's key).
jest.mock('@kiko/db/client', () => ({
  rawDatabase: { reactiveExecute: () => () => undefined },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    updateWithBalanceDelta: jest.fn(),
    balanceOf: (row: { currency: string; balanceMinorUnits: number }) => ({
      currency: row.currency,
      minorUnits: row.balanceMinorUnits,
    }),
    byIdQuery: (holdingId: string) =>
      mockQuery('holding by id', [holdingId], () =>
        mockTables.holdings.filter((row) => row.id === holdingId),
      ),
    allQuery: () => mockQuery('all holdings', [], () => mockTables.holdings),
  },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: (accountId: string) =>
      mockQuery('account by id', [accountId], () =>
        mockTables.accounts.filter((row) => row.id === accountId),
      ),
    listQuery: () => mockQuery('all accounts', [], () => mockTables.accounts),
  },
}));
jest.mock('@kiko/prices/price-points-repo', () => ({
  pricePointsRepo: {
    currentQuery: (today: number) => mockQuery('current price points', [today], () => []),
  },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    loanLedgerPaymentsQuery: () => mockQuery('loan ledger payments', [], () => []),
  },
}));
jest.mock('@kiko/bonds/bond-register-repo', () => ({
  bondRegisterRepo: {
    findByIsinQuery: (isin: string) => mockQuery('bond by isin', [isin], () => []),
    fetchedAtQuery: () => mockQuery('bond register fetched at', [], () => [{ value: 1 }]),
  },
  refreshBondRegisterIfStale: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

const updateDeltaMock = holdingsRepo.updateWithBalanceDelta as jest.Mock;

const lotOne = { day: 1000, quantityDelta: '1', costMinorUnits: 8_000_000 };
const lotTwo = { day: 2000, quantityDelta: '2', costMinorUnits: 16_000_000 };

const goldBar = (lots: (typeof lotOne)[]) => ({
  id: 'h1',
  accountId: 'acc-1',
  name: 'Gold bar',
  type: 'metal',
  currency: 'UAH',
  balanceMinorUnits: 0,
  icon: null,
  color: null,
  metadata: { metal: 'XAU', form: 'bar', unit: 'oz', purity: '0.9999', lots },
});

const renderEdit = () =>
  render(
    <HoldingFormScreen
      navigation={asNavigationProp<HoldingFormProps['navigation']>(navigationSpy())}
      route={asRouteProp<HoldingFormProps['route']>('HoldingForm', {
        accountId: 'acc-1',
        holdingId: 'h1',
      })}
    />,
  );

beforeEach(() => {
  clearLiveQueryCache();
  updateDeltaMock.mockClear();
  mockTables.accounts = [{ id: 'acc-1', kind: 'metals', institution: null, bankId: null } as Row];
});

it('seeds a reopened edit form from a fresh read, so a lot added while it was closed is saved back', async () => {
  mockTables.holdings = [goldBar([lotOne])];
  const firstVisit = await renderEdit();
  await waitFor(() => expect(firstVisit.getByLabelText('Name').props.value).toBe('Gold bar'));
  // Cancel: the form unmounts, leaving its rows in the live-query cache.
  await firstVisit.unmount();

  // The lot form's own Save while the edit form is closed.
  mockTables.holdings = [goldBar([lotOne, lotTwo])];

  const secondVisit = await renderEdit();
  await waitFor(() => expect(secondVisit.getByLabelText('Name').props.value).toBe('Gold bar'));
  await fireEvent.press(secondVisit.getByText('Save'));

  expect(updateDeltaMock).toHaveBeenCalledWith(
    'h1',
    expect.objectContaining({
      metadata: expect.objectContaining({ lots: [lotOne, lotTwo] }),
    }),
    expect.any(Number),
  );
});
