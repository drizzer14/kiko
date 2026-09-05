import { internalTransferTxIds, TRANSFER_MATCH_WINDOW_MS } from './internal-transfers';

type Tx = {
  id: string;
  holdingId: string;
  time: number;
  amountMinorUnits: number;
  currency: 'BTC' | 'USD' | 'EUR' | 'UAH';
};

const tx = (
  id: string,
  holdingId: string,
  amountMinorUnits: number,
  time: number,
  currency: Tx['currency'] = 'UAH',
): Tx => ({ id, holdingId, time, amountMinorUnits, currency });

const T = 1_000_000_000_000;

describe('internalTransferTxIds', () => {
  it('matches a debit against an equal credit on another holding within the window (both ids returned)', () => {
    const ids = internalTransferTxIds([
      tx('debit', 'h1', -100_00, T),
      tx('credit', 'h2', 100_00, T + 1_000),
    ]);

    expect(ids).toEqual(new Set(['debit', 'credit']));
  });

  it('matches legs exactly on the window boundary', () => {
    const ids = internalTransferTxIds([
      tx('debit', 'h1', -100_00, T),
      tx('credit', 'h2', 100_00, T + TRANSFER_MATCH_WINDOW_MS),
    ]);

    expect(ids).toEqual(new Set(['debit', 'credit']));
  });

  it('does not match when the magnitudes differ', () => {
    const ids = internalTransferTxIds([
      tx('debit', 'h1', -100_00, T),
      tx('credit', 'h2', 90_00, T + 1_000),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('does not match two legs on the same holding', () => {
    const ids = internalTransferTxIds([
      tx('debit', 'h1', -100_00, T),
      tx('credit', 'h1', 100_00, T + 1_000),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('does not match legs whose times fall outside the window', () => {
    const ids = internalTransferTxIds([
      tx('debit', 'h1', -100_00, T),
      tx('credit', 'h2', 100_00, T + TRANSFER_MATCH_WINDOW_MS + 1),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('does not match two same-sign transactions', () => {
    const ids = internalTransferTxIds([tx('a', 'h1', 100_00, T), tx('b', 'h2', 100_00, T + 1_000)]);

    expect(ids).toEqual(new Set());
  });

  it('does not match a same-magnitude pair in different currencies', () => {
    const ids = internalTransferTxIds([
      tx('debit', 'h1', -100_00, T, 'USD'),
      tx('credit', 'h2', 100_00, T + 1_000, 'EUR'),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('pairs greedily: one credit cannot cancel two debits', () => {
    const ids = internalTransferTxIds([
      tx('debit-1', 'h1', -100_00, T),
      tx('debit-2', 'h3', -100_00, T + 500),
      tx('credit', 'h2', 100_00, T + 1_000),
    ]);

    // The credit is consumed by the first debit; the second debit is left counted.
    expect(ids).toEqual(new Set(['debit-1', 'credit']));
  });

  it('consumes each credit at most once when several could match one debit', () => {
    const ids = internalTransferTxIds([
      tx('debit', 'h1', -100_00, T),
      tx('credit-1', 'h2', 100_00, T + 1_000),
      tx('credit-2', 'h3', 100_00, T + 2_000),
    ]);

    // Only the first still-unmatched credit is claimed; the second stays counted.
    expect(ids).toEqual(new Set(['debit', 'credit-1']));
  });

  it('leaves an unmatched leftover debit counted', () => {
    const ids = internalTransferTxIds([tx('debit', 'h1', -100_00, T)]);

    expect(ids).toEqual(new Set());
  });

  it('returns an empty set for empty input', () => {
    expect(internalTransferTxIds([])).toEqual(new Set());
  });
});
