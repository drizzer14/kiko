import { transactionsByHolding } from '.';

describe('transactionsByHolding', () => {
  it('groups the rows under their holding, each as an id, a time, a signed amount and a source', () => {
    // A ledger row carries more than the four fields the series reads.
    const rows = [
      {
        id: 'a',
        holdingId: 'card',
        time: 10,
        amountMinorUnits: -500,
        source: 'manual' as const,
        description: 'left out',
      },
      {
        id: 'b',
        holdingId: 'cash',
        time: 20,
        amountMinorUnits: 700,
        source: 'bybit' as const,
        description: 'left out',
      },
      {
        id: 'c',
        holdingId: 'card',
        time: 30,
        amountMinorUnits: 200,
        source: 'bybit' as const,
        description: 'left out',
      },
    ];
    const grouped = transactionsByHolding(rows);

    expect([...grouped.keys()]).toEqual(['card', 'cash']);
    expect(grouped.get('card')).toEqual([
      { id: 'a', time: 10, amountMinorUnits: -500, source: 'manual' },
      { id: 'c', time: 30, amountMinorUnits: 200, source: 'bybit' },
    ]);
    expect(grouped.get('cash')).toEqual([
      { id: 'b', time: 20, amountMinorUnits: 700, source: 'bybit' },
    ]);
  });

  it('keeps the order the rows came in', () => {
    const grouped = transactionsByHolding([
      { id: 'a', holdingId: 'card', time: 30, amountMinorUnits: 1, source: 'manual' },
      { id: 'b', holdingId: 'card', time: 10, amountMinorUnits: 2, source: 'manual' },
    ]);

    expect(grouped.get('card')?.map((row) => row.time)).toEqual([30, 10]);
  });

  it('is empty with no rows', () => {
    expect(transactionsByHolding([]).size).toBe(0);
  });
});
