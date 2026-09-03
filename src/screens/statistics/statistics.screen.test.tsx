// The rate-history repo opens the op-sqlite connection at module load (it is
// imported for real so `rateTableAt`, which `buildNetWorthSeries` calls, stays
// the real implementation). Stub the native module so it loads without a
// database, mirroring the net-worth-series builder test.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

// The backfill orchestration reaches the network. Keep the pure helpers
// (`missingDays`, `deriveLastBackfilledDay`) real, but stub `runBackfill` with a
// never-resolving promise so the screen's mount effect leaves the line in its
// `loading` state without hitting NBU/CoinGecko.
const mockRunBackfill = jest.fn(() => new Promise<never>(() => {}));

jest.mock('../../rates/history-backfill', () => {
  const actual = jest.requireActual('../../rates/history-backfill');

  return { ...actual, runBackfill: (...args: unknown[]) => mockRunBackfill(...args) };
});

import { act, fireEvent, render } from '@testing-library/react-native';
import { toUtcMidnight } from '../../rates/history-entry';
import '../../design-system/unistyles';
import StatisticsScreen from './statistics.screen';

const mockUseLiveQuery = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: { listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../../repositories/rates.repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('../../repositories/transactions.repo', () => ({
  transactionsRepo: { listAllQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

type Account = {
  id: string;
  name: string;
  kind?: 'bank' | 'cash' | 'crypto';
  color?: string | null;
  archivedAt?: number | null;
};
type Holding = {
  id: string;
  accountId: string;
  currency: string;
  type: string;
  balanceMinorUnits: number;
  metadata?: unknown;
  closedAt?: number | null;
};
type Rate = { base: string; quote: string; rate: string };
type Settings = { baseCurrency: string };
type Transaction = { id: string; holdingId: string; time: number; amountMinorUnits: number };
type HistoryRow = { base: string; quote: string; day: number; rate: string; source?: string };
type LiveData = {
  accounts?: Account[];
  holdings?: Holding[];
  rates?: Rate[];
  settings?: Settings[];
  transactions?: Transaction[];
  history?: HistoryRow[];
};

// Feed each `useLiveQuery` call by the first table name it watches — the screen's
// six queries key off distinct tables.
const setLiveData = (data: LiveData): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
    currency_rates: data.rates ?? [],
    settings: data.settings ?? [{ baseCurrency: 'UAH' }],
    transactions: data.transactions ?? [],
    currency_rate_history: data.history ?? [],
  };
  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
  }));
};

const DAY = 86_400_000;
const now = Date.now();

const CASH: Account = { id: 'a', name: 'Cash', kind: 'cash', color: null };
const BANK: Account = { id: 'b', name: 'Bank', kind: 'bank', color: null };

const UAH_HOLDING: Holding = {
  id: 'h1',
  accountId: 'a',
  currency: 'UAH',
  type: 'cash',
  balanceMinorUnits: 100_000,
  metadata: null,
  closedAt: null,
};
const USD_HOLDING: Holding = {
  id: 'h2',
  accountId: 'b',
  currency: 'USD',
  type: 'card',
  balanceMinorUnits: 5_000,
  metadata: null,
  closedAt: null,
};

// USD converts to the UAH base so the Bank account (a `card`) contributes to the
// pie and its own by-type bar.
const USD_UAH_RATE: Rate = { base: 'USD', quote: 'UAH', rate: '40' };

const TRANSACTIONS: Transaction[] = [
  { id: 't1', holdingId: 'h1', time: now - 3 * DAY, amountMinorUnits: 50_000 },
  { id: 't2', holdingId: 'h1', time: now - DAY, amountMinorUnits: 50_000 },
  { id: 't3', holdingId: 'h2', time: now - 3 * DAY, amountMinorUnits: 5_000 },
];

// A historical USD->UAH row dated before the transaction span, so `rateTableAt`
// carries it forward to every bucket and the net-worth line has points to draw.
const HISTORY: HistoryRow[] = [
  { base: 'USD', quote: 'UAH', day: toUtcMidnight(now) - 5 * DAY, rate: '40', source: 'nbu' },
];

const seedFull = (): void =>
  setLiveData({
    accounts: [CASH, BANK],
    holdings: [UAH_HOLDING, USD_HOLDING],
    rates: [USD_UAH_RATE],
    transactions: TRANSACTIONS,
    history: HISTORY,
  });

const renderScreen = (): ReturnType<typeof render> => render(<StatisticsScreen />);

// Open one filter menu, tap an option row, then dismiss via the backdrop.
const pressFilter = async (
  getByTestId: (id: string) => Parameters<typeof fireEvent.press>[0],
  menuTestID: string,
  value: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.press(getByTestId(menuTestID));
  });
  await act(async () => {
    fireEvent.press(getByTestId(`${menuTestID}-option-${value}`));
  });
  await act(async () => {
    fireEvent.press(getByTestId(`${menuTestID}-backdrop`));
  });
};

const ACCOUNT_FILTER = 'statistics-account-filter';

describe('StatisticsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedFull();
  });

  it('renders the three blocks in order: by-type bar, net-worth line, account pie', async () => {
    const { getByTestId } = await renderScreen();

    const order = getByTestId('statistics-blocks')
      .children.map((child) => (typeof child === 'string' ? undefined : child.props.testID))
      .filter((id): id is string => typeof id === 'string' && id.startsWith('statistics-block-'));

    expect(order).toEqual([
      'statistics-block-bar',
      'statistics-block-line',
      'statistics-block-pie',
    ]);
  });

  it('renders a by-type bar, the net-worth polyline, and a pie arc per account', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('bar-chart-bar-cash')).toBeTruthy();
    expect(getByTestId('bar-chart-bar-card')).toBeTruthy();
    expect(getByTestId('net-worth-line-polyline')).toBeTruthy();
    expect(getByTestId('pie-chart-arc-a')).toBeTruthy();
    expect(getByTestId('pie-chart-arc-b')).toBeTruthy();
  });

  it('shows the net-worth line loading state while history is empty and the backfill runs', async () => {
    setLiveData({
      accounts: [CASH, BANK],
      holdings: [UAH_HOLDING, USD_HOLDING],
      rates: [USD_UAH_RATE],
      transactions: TRANSACTIONS,
      history: [],
    });

    const { getByTestId, queryByTestId } = await renderScreen();

    expect(mockRunBackfill).toHaveBeenCalled();
    expect(getByTestId('net-worth-line-loading')).toBeTruthy();
    expect(queryByTestId('net-worth-line-polyline')).toBeNull();
  });

  it('drops the deselected account from both the bar and the pie when the filter narrows', async () => {
    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('bar-chart-bar-card')).toBeTruthy();
    expect(getByTestId('pie-chart-arc-b')).toBeTruthy();

    await pressFilter(getByTestId, ACCOUNT_FILTER, 'Cash');

    expect(getByTestId('bar-chart-bar-cash')).toBeTruthy();
    expect(queryByTestId('bar-chart-bar-card')).toBeNull();
    expect(getByTestId('pie-chart-arc-a')).toBeTruthy();
    expect(queryByTestId('pie-chart-arc-b')).toBeNull();
  });

  it('renders all three empty charts without crashing when there is no data', async () => {
    setLiveData({});

    const { getByTestId } = await renderScreen();

    expect(getByTestId('bar-chart-empty')).toBeTruthy();
    expect(getByTestId('net-worth-line-empty')).toBeTruthy();
    expect(getByTestId('pie-chart-empty')).toBeTruthy();
  });

  it('does not run the backfill when there are no transactions to bound the span', async () => {
    setLiveData({});

    await renderScreen();

    expect(mockRunBackfill).not.toHaveBeenCalled();
  });
});
