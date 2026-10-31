import { renderHook } from '@testing-library/react-native';

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: { listAllQuery: () => ({ __table: 'transactions' }) },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { allQuery: () => ({ __table: 'holdings' }) },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { listQuery: () => ({ __table: 'accounts' }) },
}));

import type { TransactionRow } from '@kiko/db';

import { useExchangeFundingCaption } from './use-exchange-funding-caption';

type LedgerRow = Pick<
  TransactionRow,
  | 'id'
  | 'holdingId'
  | 'amountMinorUnits'
  | 'time'
  | 'untrackedCounterpart'
  | 'mcc'
  | 'description'
  | 'categorySetByHand'
>;

const T = 1_700_000_000_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const ACCOUNTS = [
  { id: 'bank', kind: 'bank' },
  { id: 'binance', kind: 'crypto' },
];
const HOLDINGS = [
  { id: 'card', accountId: 'bank', currency: 'UAH' },
  { id: 'card-eur', accountId: 'bank', currency: 'EUR' },
  { id: 'usdt', accountId: 'binance', currency: 'USDT' },
  { id: 'wallet', accountId: 'binance', currency: 'UAH' },
];

const ledgerRow = (row: Partial<LedgerRow> & Pick<LedgerRow, 'id' | 'holdingId'>): LedgerRow => ({
  amountMinorUnits: -415_000,
  time: T,
  untrackedCounterpart: null,
  mcc: null,
  description: '',
  categorySetByHand: false,
  ...row,
});

const purchase = (code: string): LedgerRow =>
  ledgerRow({
    id: 'buy',
    holdingId: 'usdt',
    amountMinorUnits: 9_990_000_000,
    untrackedCounterpart: code,
  });

type Read = { table: string; enabled: boolean | undefined };

const isEnabledRead =
  (table: string) =>
  (read: Read): boolean =>
    read.table === table && read.enabled === true;

// Serves each table's rows only to an enabled read, as the real hook does, and records every read.
const serve = (ledger: LedgerRow[]): Read[] => {
  const reads: Read[] = [];
  const dataByTable: Record<string, unknown[]> = {
    transactions: ledger,
    holdings: HOLDINGS,
    accounts: ACCOUNTS,
  };

  mockUseLiveQuery.mockImplementation(
    (query: { __table: string }, _tables: string[], enabled?: boolean) => {
      reads.push({ table: query.__table, enabled });

      return { data: enabled === false ? [] : dataByTable[query.__table], isLoading: false };
    },
  );

  return reads;
};

const captionOf = async (row: LedgerRow | undefined): Promise<string | undefined> => {
  const { result } = await renderHook(() => useExchangeFundingCaption(row));

  return result.current;
};

describe('useExchangeFundingCaption', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockReset();
  });

  it.each([
    {
      kind: 'p2p',
      code: 'p2p:UAH:4150.00',
      debit: ledgerRow({ id: 'debit', holdingId: 'card', time: T - 20 * MINUTE }),
      key: 'transactions.matchedP2pPurchase',
    },
    {
      kind: 'card',
      code: 'card:UAH:4150.00',
      debit: ledgerRow({ id: 'debit', holdingId: 'card', time: T + 2 * DAY }),
      key: 'transactions.matchedCardPurchase',
    },
    {
      kind: 'bank',
      code: 'bank:EUR:4150.00',
      debit: ledgerRow({ id: 'debit', holdingId: 'card-eur', time: T - 3 * DAY }),
      key: 'transactions.matchedExchangeDeposit',
    },
  ])(
    'returns the $kind caption key for a debit the matcher paired',
    async ({ code, debit, key }) => {
      serve([purchase(code), debit]);

      expect(await captionOf(debit)).toBe(key);
    },
  );

  it('returns no key for a debit no purchase funded', async () => {
    const debit = ledgerRow({ id: 'debit', holdingId: 'card', time: T - 3 * DAY });

    serve([purchase('p2p:UAH:4150.00'), debit]);

    expect(await captionOf(debit)).toBeUndefined();
  });

  it('returns no key for a matched debit the user categorized by hand', async () => {
    const debit = ledgerRow({
      id: 'debit',
      holdingId: 'card',
      time: T - 20 * MINUTE,
      categorySetByHand: true,
    });

    serve([purchase('p2p:UAH:4150.00'), debit]);

    expect(await captionOf(debit)).toBeUndefined();
  });

  it('reads the ledger for a debit on a holding of a bank account', async () => {
    const debit = ledgerRow({ id: 'debit', holdingId: 'card', time: T - 20 * MINUTE });
    const reads = serve([purchase('p2p:UAH:4150.00'), debit]);

    await captionOf(debit);

    expect(reads.filter(isEnabledRead('transactions'))).not.toHaveLength(0);
  });

  it('reads no ledger for a row on a holding of a crypto account', async () => {
    const debit = ledgerRow({ id: 'debit', holdingId: 'wallet', time: T - 20 * MINUTE });
    const reads = serve([purchase('p2p:UAH:4150.00'), debit]);

    const key = await captionOf(debit);

    expect(reads.filter(({ table }) => table === 'transactions')).not.toHaveLength(0);
    expect(reads.filter(isEnabledRead('transactions'))).toEqual([]);
    expect(key).toBeUndefined();
  });

  it('reads nothing for a credit', async () => {
    const credit = ledgerRow({ id: 'credit', holdingId: 'card', amountMinorUnits: 415_000 });
    const reads = serve([credit]);

    const key = await captionOf(credit);

    expect(reads.filter(({ enabled }) => enabled)).toEqual([]);
    expect(key).toBeUndefined();
  });

  it('reads nothing without a row', async () => {
    const reads = serve([]);

    const key = await captionOf(undefined);

    expect(reads.filter(({ enabled }) => enabled)).toEqual([]);
    expect(key).toBeUndefined();
  });

  it('reads no ledger while the holdings and accounts are still loading', async () => {
    const debit = ledgerRow({ id: 'debit', holdingId: 'wallet', time: T - 20 * MINUTE });
    const reads: Read[] = [];

    mockUseLiveQuery.mockImplementation(
      (query: { __table: string }, _tables: string[], enabled?: boolean) => {
        reads.push({ table: query.__table, enabled });

        return { data: [], isLoading: query.__table !== 'transactions' };
      },
    );

    await captionOf(debit);

    expect(reads.filter(isEnabledRead('transactions'))).toEqual([]);
  });
});
