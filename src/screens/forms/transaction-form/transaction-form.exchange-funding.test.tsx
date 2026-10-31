import type { ComponentProps } from 'react';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import type { TransactionFormParams } from '@kiko/navigation/types';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import TransactionFormScreen from './transaction-form.screen';

// The caption under the category of a bank debit that paid for an exchange purchase, which the
// statistics screen leaves out of spending. The form reads the same ledger and runs the same
// matcher, so the caption shows exactly for the debits the screen leaves out.

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    getByIdQuery: (transactionId: string) => ({
      __kind: 'byId',
      transactionId,
      toSQL: () => ({ sql: '', params: [transactionId] }),
    }),
    listAllQuery: () => ({ __kind: 'ledger', toSQL: () => ({ sql: '', params: [] }) }),
    distinctDescriptionsQuery: () => ({
      __kind: 'distinctDescriptions',
      toSQL: () => ({ sql: '', params: [] }),
    }),
    latestManualHoldingQuery: () => ({
      __kind: 'latestManualHolding',
      toSQL: () => ({ sql: '', params: [] }),
    }),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

type TransactionFormProps = ComponentProps<typeof TransactionFormScreen>;
type Row = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  source: 'monobank';
  description: string;
  category: string;
  untrackedCounterpart: string | null;
  mcc: number | null;
  categorySetByHand: boolean;
};

const MINUTE = 60_000;
const PURCHASE_TIME = 1_700_000_000_000;
const CAPTION = 'Matched to P2P purchase.';

const ACCOUNTS = [
  { id: 'bank', name: 'Bank', kind: 'bank', archivedAt: null },
  { id: 'binance', name: 'Binance', kind: 'crypto', archivedAt: null },
];
const HOLDINGS = [
  { id: 'card', accountId: 'bank', currency: 'UAH', type: 'card', balanceMinorUnits: 0 },
  { id: 'usdt', accountId: 'binance', currency: 'USDT', type: 'crypto', balanceMinorUnits: 0 },
  { id: 'wallet', accountId: 'binance', currency: 'UAH', type: 'cash', balanceMinorUnits: 0 },
];
const CATEGORIES = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'transfers', title: 'Transfers', icon: 'arrow.left.arrow.right' },
];

const rowOf = (
  row: Pick<Row, 'id' | 'holdingId' | 'amountMinorUnits' | 'time'> & Partial<Row>,
): Row => ({
  source: 'monobank',
  description: '',
  category: 'transfers',
  untrackedCounterpart: null,
  mcc: null,
  categorySetByHand: false,
  ...row,
});

const P2P_PURCHASE = rowOf({
  id: 'buy',
  holdingId: 'usdt',
  amountMinorUnits: 9_990_000_000,
  time: PURCHASE_TIME,
  untrackedCounterpart: 'p2p:UAH:4150.00',
});
const fundingDebit = (id: string, minutesBefore: number, extra: Partial<Row> = {}): Row =>
  rowOf({
    id,
    holdingId: 'card',
    amountMinorUnits: -415_000,
    time: PURCHASE_TIME - minutesBefore * MINUTE,
    ...extra,
  });

type LedgerReads = { enabled: boolean | undefined }[];

const serveLedger = (rows: Row[]): LedgerReads => {
  const ledgerReads: LedgerReads = [];
  const dataByTable: Record<string, unknown[]> = {
    holdings: HOLDINGS,
    accounts: ACCOUNTS,
    categories: CATEGORIES,
  };

  mockUseLiveQuery.mockImplementation(
    (query: { __kind?: string; transactionId?: string }, tables: string[], enabled?: boolean) => {
      if (query?.__kind === 'ledger') {
        ledgerReads.push({ enabled });

        return { data: enabled === false ? [] : rows, isLoading: false };
      }

      if (query?.__kind === 'byId') {
        return { data: rows.filter(({ id }) => id === query.transactionId) };
      }

      if (query?.__kind === 'distinctDescriptions') {
        return { data: [] };
      }

      if (query?.__kind === 'latestManualHolding') {
        return { data: [], isLoading: false };
      }

      return { data: dataByTable[tables[0]] ?? [] };
    },
  );

  return ledgerReads;
};

const navigation = navigationSpy();

const renderForm = (params: TransactionFormParams): ReturnType<typeof render> =>
  render(
    <TransactionFormScreen
      route={asRouteProp<TransactionFormProps['route']>('TransactionForm', params)}
      navigation={asNavigationProp<TransactionFormProps['navigation']>(navigation)}
    />,
  );

describe('TransactionFormScreen — matched exchange funding caption', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows Matched to P2P purchase under the category of a matched bank debit', async () => {
    serveLedger([P2P_PURCHASE, fundingDebit('debit', 20)]);

    const utils = await renderForm({ transactionId: 'debit' });

    expect(utils.getByText(CAPTION)).toBeTruthy();
  });

  it('shows no caption on a matched debit the user categorized by hand', async () => {
    serveLedger([P2P_PURCHASE, fundingDebit('debit', 20, { categorySetByHand: true })]);

    const utils = await renderForm({ transactionId: 'debit' });

    expect(utils.getByText('Transfers')).toBeTruthy();
    expect(utils.queryByText(CAPTION)).toBeNull();
  });

  it('shows the caption on a matched debit another rule already excludes', async () => {
    serveLedger([
      P2P_PURCHASE,
      fundingDebit('cash-out', 30, { mcc: 6012 }),
      fundingDebit('grocery', 5, { mcc: 5411, category: 'groceries' }),
    ]);

    const utils = await renderForm({ transactionId: 'cash-out' });

    expect(utils.getByText(CAPTION)).toBeTruthy();
  });

  it('shows no caption on a hand-categorized debit that took the match', async () => {
    serveLedger([
      P2P_PURCHASE,
      fundingDebit('hand', 30, { mcc: 4829, categorySetByHand: true }),
      fundingDebit('grocery', 5, { mcc: 5411, category: 'groceries' }),
    ]);

    const hand = await renderForm({ transactionId: 'hand' });

    expect(hand.getByText('Transfers')).toBeTruthy();
    expect(hand.queryByText(CAPTION)).toBeNull();
  });

  it('shows no caption on an unmatched debit', async () => {
    serveLedger([P2P_PURCHASE, fundingDebit('debit', 180)]);

    const utils = await renderForm({ transactionId: 'debit' });

    expect(utils.getByText('Transfers')).toBeTruthy();
    expect(utils.queryByText(CAPTION)).toBeNull();
  });

  it('reads no ledger for a row on a crypto holding', async () => {
    const ledgerReads = serveLedger([
      P2P_PURCHASE,
      rowOf({
        id: 'crypto-debit',
        holdingId: 'wallet',
        amountMinorUnits: -415_000,
        time: PURCHASE_TIME - 20 * MINUTE,
      }),
    ]);

    const utils = await renderForm({ transactionId: 'crypto-debit' });

    expect(ledgerReads.length).toBeGreaterThan(0);
    expect(ledgerReads.filter(({ enabled }) => enabled !== false)).toEqual([]);
    expect(utils.queryByText(CAPTION)).toBeNull();
  });
});
