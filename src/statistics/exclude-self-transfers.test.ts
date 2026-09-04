import { excludeSelfTransfers, SELF_TRANSFER_WINDOW_MS } from './exclude-self-transfers';

type Tx = { id: string; holdingId: string; amountMinorUnits: number; time: number };

const tx = (id: string, holdingId: string, amountMinorUnits: number, time: number): Tx => ({
  id,
  holdingId,
  amountMinorUnits,
  time,
});

const ids = (list: Tx[]): string[] => list.map((t) => t.id);

const T = 1_000_000_000_000;

describe('excludeSelfTransfers', () => {
  it('removes both legs of a matched self-transfer pair', () => {
    const list = [tx('a', 'h1', -100_00, T), tx('b', 'h2', 100_00, T + 1_000)];

    expect(excludeSelfTransfers(list)).toEqual([]);
  });

  it('keeps unrelated transactions that do not pair', () => {
    const list = [
      tx('a', 'h1', -100_00, T),
      tx('b', 'h2', 100_00, T + 1_000),
      tx('c', 'h1', -50_00, T + 2_000),
    ];

    expect(ids(excludeSelfTransfers(list))).toEqual(['c']);
  });

  it('never pairs two same-sign amounts', () => {
    const list = [tx('a', 'h1', 100_00, T), tx('b', 'h2', 100_00, T + 1_000)];

    expect(ids(excludeSelfTransfers(list))).toEqual(['a', 'b']);
  });

  it('never pairs two legs on the same holding', () => {
    const list = [tx('a', 'h1', -100_00, T), tx('b', 'h1', 100_00, T + 1_000)];

    expect(ids(excludeSelfTransfers(list))).toEqual(['a', 'b']);
  });

  it('never pairs legs whose times fall outside the window', () => {
    const list = [
      tx('a', 'h1', -100_00, T),
      tx('b', 'h2', 100_00, T + SELF_TRANSFER_WINDOW_MS + 1),
    ];

    expect(ids(excludeSelfTransfers(list))).toEqual(['a', 'b']);
  });

  it('pairs legs exactly on the window boundary', () => {
    const list = [tx('a', 'h1', -100_00, T), tx('b', 'h2', 100_00, T + SELF_TRANSFER_WINDOW_MS)];

    expect(excludeSelfTransfers(list)).toEqual([]);
  });

  it('matches each transaction at most once', () => {
    // Two candidate credits could each pair with the single debit; only the
    // first is consumed, the second stays.
    const list = [
      tx('debit', 'h1', -100_00, T),
      tx('credit-1', 'h2', 100_00, T + 1_000),
      tx('credit-2', 'h3', 100_00, T + 2_000),
    ];

    expect(ids(excludeSelfTransfers(list))).toEqual(['credit-2']);
  });

  it('keeps a lone unmatched leg', () => {
    const list = [tx('a', 'h1', -100_00, T)];

    expect(ids(excludeSelfTransfers(list))).toEqual(['a']);
  });

  it('never pairs two zero-amount transactions', () => {
    const list = [tx('a', 'h1', 0, T), tx('b', 'h2', 0, T + 1_000)];

    expect(ids(excludeSelfTransfers(list))).toEqual(['a', 'b']);
  });

  it('returns an empty list for empty input', () => {
    expect(excludeSelfTransfers([])).toEqual([]);
  });
});
