import type { ComponentProps } from 'react';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import HoldingDetailScreen from './holding-detail.screen';

type HoldingDetailProps = ComponentProps<typeof HoldingDetailScreen>;

type QueryResult = { data: unknown[]; isLoading: boolean; isFresh?: boolean };

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/navigation/pane-stack', () => ({
  useClosePaneRoute: () => jest.fn(),
  useOpenInPane: () => jest.fn(),
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
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    listByHoldingQuery: (holdingId: string) => ({
      toSQL: () => ({ sql: 'holding-transactions', params: [holdingId] }),
    }),
    listLinkedToLoanQuery: () => ({ toSQL: () => ({ sql: 'linked-loan-payments', params: [] }) }),
    loanLedgerPaymentsQuery: () => ({ toSQL: () => ({ sql: 'loan-ledger-payments', params: [] }) }),
  },
}));
jest.mock('@kiko/bonds/bond-register-repo', () => ({
  bondRegisterRepo: { findByIsinQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: (accountId: string) => ({ toSQL: () => ({ sql: '', params: [accountId] }) }),
    listQuery: () => ({ toSQL: () => ({ sql: 'accounts-list', params: [] }) }),
  },
}));
jest.mock('@kiko/rates/repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

const navigation = navigationSpy();
const route = asRouteProp<HoldingDetailProps['route']>('HoldingDetail', {
  holdingId: 'h-1',
  name: 'Binance Spot · BTC',
});

const EARLIER_HISTORY = /^Earlier history:/;
const NOT_LISTED = /^Not listed:/;

const bitcoinHolding = (metadata: Record<string, unknown>) => ({
  id: 'h-1',
  accountId: 'acc-1',
  name: 'Binance Spot · BTC',
  type: 'crypto_asset',
  currency: 'BTC',
  balanceMinorUnits: 100_000_000,
  metadata,
});

const BINANCE_HOLDING = bitcoinHolding({ binanceAsset: 'BTC' });

const ledgerRow = (id: string, amountMinorUnits: number, time: number) => ({
  id,
  holdingId: 'h-1',
  amountMinorUnits,
  time,
  description: id,
  source: 'binance',
  exchangeCounterpartHoldingId: null,
});

const ROWS = [ledgerRow('Bought', 30_000_000, Date.UTC(2026, 0, 5, 12))];

const seed = (
  holding: unknown,
  account: unknown,
  rows: unknown[] = ROWS,
  isLoading: Partial<Record<string, boolean>> = {},
): void => {
  const resultByTable: Record<string, QueryResult> = {
    holdings: {
      data: [holding],
      isLoading: isLoading.holdings ?? false,
      isFresh: !(isLoading.holdings ?? false),
    },
    accounts: { data: [account], isLoading: isLoading.accounts ?? false },
    settings: { data: [{ baseCurrency: 'UAH' }], isLoading: false },
    transactions: { data: rows, isLoading: isLoading.transactions ?? false },
  };

  mockUseLiveQuery.mockImplementation((query: unknown, keys: string[], enabled = true) => {
    if (!enabled) {
      return { data: [], isLoading: false };
    }

    const sql = (query as { toSQL: () => { sql: string } }).toSQL().sql;

    return sql === 'accounts-list' || sql.endsWith('payments')
      ? { data: [], isLoading: false }
      : (resultByTable[keys[0]] ?? { data: [], isLoading: false });
  });
};

const renderScreen = () =>
  render(
    <HoldingDetailScreen
      navigation={asNavigationProp<HoldingDetailProps['navigation']>(navigation)}
      route={route}
    />,
    { wrapper: GestureRootWrapper },
  );

const connectedBinance = { id: 'acc-1', institution: 'binance' };

describe('HoldingDetailScreen exchange history lines', () => {
  it('shows Earlier history with the balance less the rows on a connected Binance holding', async () => {
    seed(BINANCE_HOLDING, connectedBinance);

    const { getByText } = await renderScreen();

    expect(getByText(EARLIER_HISTORY)).toHaveTextContent('Earlier history: ₿0.70');
  });

  it('shows the not-listed note under each Binance holding', async () => {
    seed(BINANCE_HOLDING, connectedBinance);

    const { getByText } = await renderScreen();

    expect(getByText(NOT_LISTED)).toHaveTextContent(/^Not listed: futures, margin/);
  });

  it('puts the lines after the last ledger row, the history line first', async () => {
    seed(BINANCE_HOLDING, connectedBinance);

    const { getAllByText } = await renderScreen();
    const rendered = getAllByText(/^(Bought|Earlier history|Not listed)/).map(
      (node) => String(node.props.children).split(':')[0],
    );

    expect(rendered).toEqual(['Bought', 'Earlier history', 'Not listed']);
  });

  it('shows no Earlier history when the rows sum to the balance, and still the note', async () => {
    seed(BINANCE_HOLDING, connectedBinance, [
      ledgerRow('Bought', 100_000_000, Date.UTC(2026, 0, 5)),
    ]);

    const { getByText, queryByText } = await renderScreen();

    expect(queryByText(EARLIER_HISTORY)).toBeNull();
    expect(getByText(NOT_LISTED)).toBeTruthy();
  });

  it.each([
    ['manual', bitcoinHolding({}), { id: 'acc-1', institution: null }],
    ['disconnected Binance', BINANCE_HOLDING, { id: 'acc-1', institution: null }],
    [
      'Bitcoin wallet',
      bitcoinHolding({ walletAddress: 'bc1qexample' }),
      { id: 'acc-1', institution: 'btc_wallet' },
    ],
  ])('shows neither line on a %s holding', async (_kind, holding, account) => {
    seed(holding, account);

    const { getByText, queryByText } = await renderScreen();

    expect(getByText('Bought')).toBeTruthy();
    expect(queryByText(EARLIER_HISTORY)).toBeNull();
    expect(queryByText(NOT_LISTED)).toBeNull();
  });

  it("renders nothing while the screen's queries load", async () => {
    seed(BINANCE_HOLDING, connectedBinance, ROWS, { transactions: true });

    const { getByTestId, queryByText } = await renderScreen();

    expect(getByTestId('holding-detail-loading')).toBeTruthy();
    expect(queryByText(EARLIER_HISTORY)).toBeNull();
    expect(queryByText(NOT_LISTED)).toBeNull();
  });
});
