import '@kiko/design-system/unistyles';
import { localDaysFrom } from '@kiko/test-support/local-days-from';
import { act, fireEvent, render } from '@testing-library/react-native';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';

import StatisticsScreen from './statistics.screen';

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    balanceOf: (row: { currency: string; balanceMinorUnits: number }) => ({
      currency: row.currency,
      minorUnits: row.balanceMinorUnits,
    }),
  },
}));
jest.mock('@kiko/rates/repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    listAllQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    loanLedgerPaymentsQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/rates/history-backfill', () => ({
  ...jest.requireActual('@kiko/rates/history-backfill'),
  runBackfill: () => new Promise<never>(() => {}),
}));
jest.mock('@kiko/navigation/pane-stack', () => ({ useIsScreenVisible: () => true }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => false,
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('@kiko/navigation/use-scroll-to-top-on-tab-press', () => ({
  useScrollToTopOnTabPress: jest.fn(),
}));

const MINUTE = 60_000;
const now = Date.now();
const PURCHASE_TIME = localDaysFrom(now, -2);

const BANK = { id: 'bank', name: 'Bank', kind: 'bank', color: null, archivedAt: null };
const BINANCE = { id: 'binance', name: 'Binance', kind: 'crypto', color: null, archivedAt: null };

const CARD = {
  id: 'card',
  accountId: 'bank',
  currency: 'UAH',
  type: 'card',
  balanceMinorUnits: 0,
  metadata: null,
  closedAt: null,
};
const USDT = {
  id: 'usdt',
  accountId: 'binance',
  currency: 'USDT',
  type: 'crypto',
  balanceMinorUnits: 9_990_000_000,
  metadata: null,
  closedAt: null,
};

const CATEGORIES = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transfers', title: 'Transfers', icon: 'arrow.left.arrow.right' },
];

const BASE_ROW = {
  exchangePairId: null,
  exchangeCounterpartHoldingId: null,
  loanHoldingId: null,
  mcc: null,
  counterIban: null,
  description: '',
  categorySetByHand: false,
};

const P2P_PURCHASE = {
  ...BASE_ROW,
  id: 'buy',
  holdingId: 'usdt',
  time: PURCHASE_TIME,
  amountMinorUnits: 9_990_000_000,
  category: null,
  untrackedCounterpart: 'p2p:UAH:4150.00',
};
const GROCERIES = {
  ...BASE_ROW,
  id: 'groceries',
  holdingId: 'card',
  time: localDaysFrom(now, -3),
  amountMinorUnits: -100_00,
  category: 'groceries',
  untrackedCounterpart: null,
};
const debitOf = (amountMinorUnits: number) => ({
  ...BASE_ROW,
  id: 'debit',
  holdingId: 'card',
  time: PURCHASE_TIME - 20 * MINUTE,
  amountMinorUnits,
  category: 'transfers',
  untrackedCounterpart: null,
});

const seedLedger = (debit: ReturnType<typeof debitOf>): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: [BANK, BINANCE],
    holdings: [CARD, USDT],
    currency_rates: [{ base: 'USDT', quote: 'UAH', rate: '40' }],
    settings: [{ baseCurrency: 'UAH' }],
    transactions: [P2P_PURCHASE, GROCERIES, debit],
    currency_rate_history: [],
    categories: CATEGORIES,
    price_points: [],
  };

  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
    isLoading: false,
    isFresh: true,
  }));
};

const renderScreen = (): ReturnType<typeof render> =>
  render(<StatisticsScreen />, { wrapper: GestureRootWrapper });

const ACCOUNT_FILTER = 'statistics-account-filter';

describe('StatisticsScreen with an exchange purchase a bank debit funded', () => {
  it('leaves a matched funding debit out of the spending pie', async () => {
    seedLedger(debitOf(-415_000));

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(queryByTestId('category-pie-arc-transfers')).toBeNull();
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
  });

  it('leaves the funding debit out of spending while the account filter hides the crypto account', async () => {
    seedLedger(debitOf(-415_000));

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('pie-chart-arc-binance')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(getByTestId(ACCOUNT_FILTER));
    });
    await act(async () => {
      await fireEvent.press(getByTestId(`${ACCOUNT_FILTER}-option-bank`));
    });
    await act(async () => {
      await fireEvent.press(getByTestId(`${ACCOUNT_FILTER}-backdrop`));
    });

    expect(queryByTestId('pie-chart-arc-binance')).toBeNull();
    expect(queryByTestId('category-pie-arc-transfers')).toBeNull();
    expect(getByTestId('category-pie-arc-groceries')).toBeTruthy();
  });

  it('keeps a matched debit out of the category trend too', async () => {
    seedLedger(debitOf(-415_000));

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(queryByTestId('category-trend-line-line-transfers')).toBeNull();
    expect(getByTestId('category-trend-line-line-groceries')).toBeTruthy();
  });

  it('still counts a debit the matcher leaves unmatched', async () => {
    seedLedger(debitOf(-415_001));

    const { getByTestId } = await renderScreen();

    expect(getByTestId('category-pie-arc-transfers')).toBeTruthy();
    expect(getByTestId('category-trend-line-line-transfers')).toBeTruthy();
  });
});
