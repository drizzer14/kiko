import { renderHook } from '@testing-library/react-native';

const mockUseLiveQuery = jest.fn();
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/prices/price-points-repo', () => ({
  pricePointsRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    loanLedgerPaymentsQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

import { usePriceBook } from './use-price-book';

type LiveResult = { data: unknown[]; isLoading: boolean };

// Answers each of the hook's two reads by the first table it subscribes to.
const liveByTable = (results: { price_points?: LiveResult; transactions?: LiveResult }): void => {
  mockUseLiveQuery.mockImplementation(
    (_query: unknown, tables: string[]) =>
      results[tables[0] as 'price_points' | 'transactions'] ?? { data: [], isLoading: false },
  );
};

const paymentsCall = () =>
  mockUseLiveQuery.mock.calls.find((call) => call[1][0] === 'transactions');

describe('usePriceBook', () => {
  beforeEach(() => {
    mockUseLiveQuery.mockReset();
    liveByTable({});
  });

  it('subscribes to the price_points table', async () => {
    await renderHook(() => usePriceBook());

    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.anything(), ['price_points'], true, {});
  });

  // kiko-architecture: only a display screen reads the live-query cache, so
  // the opt-in is the caller's, forwarded as-is; a form passes nothing.
  it('forwards the cache opt-in straight through to useLiveQuery', async () => {
    await renderHook(() => usePriceBook(true, { cached: true }));

    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.anything(), ['price_points'], true, {
      cached: true,
    });
  });

  // kiko-architecture: a screen showing no priced holding type never needs
  // the price_points read — usePriceBook forwards its own `enabled` straight
  // through to useLiveQuery's `enabled` argument (never a conditional hook
  // call, which Rules of Hooks forbids).
  it('forwards enabled=false straight through to useLiveQuery', async () => {
    await renderHook(() => usePriceBook(false));

    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.anything(), ['price_points'], false, {});
  });

  it('builds a PriceBook from the live rows', async () => {
    liveByTable({
      price_points: {
        data: [
          { instrument: 'metal:silver', day: 1, price: '190.00', currency: 'USD', source: 'nbu' },
        ],
        isLoading: false,
      },
    });

    const { result } = await renderHook(() => usePriceBook());

    expect(result.current.book.points.get('metal:silver')?.[0].price).toBe('190.00');
  });

  it('returns an empty PriceBook before any row has loaded', async () => {
    liveByTable({ price_points: { data: [], isLoading: true } });

    const { result } = await renderHook(() => usePriceBook());

    expect(result.current.book.points.size).toBe(0);
    expect(result.current.book.loanPayments.size).toBe(0);
  });

  it('threads isLoading straight through from the underlying live query', async () => {
    liveByTable({ price_points: { data: [], isLoading: true } });

    const { result } = await renderHook(() => usePriceBook());

    expect(result.current.isLoading).toBe(true);
  });

  // One read for every loan's linked payments, never one per holding: the
  // join brings the payer holding's currency, so both tables fire it.
  it('reads every linked loan payment in one query, on the transactions and holdings tables', async () => {
    await renderHook(() => usePriceBook(true, { cached: true }));

    expect(mockUseLiveQuery).toHaveBeenCalledWith(
      expect.anything(),
      ['transactions', 'holdings'],
      true,
      { cached: true },
    );
  });

  it('reads the linked payments whenever the book is enabled, unless the caller narrows it', async () => {
    await renderHook(() => usePriceBook(true, {}, false));

    expect(paymentsCall()?.[2]).toBe(false);
    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.anything(), ['price_points'], true, {});
  });

  it('skips the linked-payments read while the book itself is disabled', async () => {
    await renderHook(() => usePriceBook(false));

    expect(paymentsCall()?.[2]).toBe(false);
  });

  it('groups the linked payment rows into the book by loan id', async () => {
    liveByTable({
      transactions: {
        data: [{ loanHoldingId: 'loan-1', time: 5, amountMinorUnits: -100, currency: 'UAH' }],
        isLoading: false,
      },
    });

    const { result } = await renderHook(() => usePriceBook());

    expect(result.current.book.loanPayments.get('loan-1')).toEqual([
      { loanHoldingId: 'loan-1', time: 5, amountMinorUnits: -100, currency: 'UAH' },
    ]);
  });

  // A loan's value reads its payments, so the book is not ready (and no
  // screen may show a schedule-only value) until that read has settled too.
  it('stays loading while the linked-payments read is still loading', async () => {
    liveByTable({ transactions: { data: [], isLoading: true } });

    const { result } = await renderHook(() => usePriceBook());

    expect(result.current.isLoading).toBe(true);
  });
});
