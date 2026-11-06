import { transactionsByHolding } from '.';

describe('transactionsByHolding', () => {
  it('groups the rows under their holding, each as a time and a signed amount', () => {
    // A ledger row carries more than the three fields the series reads.
    const rows = [
      { holdingId: 'card', time: 10, amountMinorUnits: -500, description: 'left out' },
      { holdingId: 'cash', time: 20, amountMinorUnits: 700, description: 'left out' },
      { holdingId: 'card', time: 30, amountMinorUnits: 200, description: 'left out' },
    ];
    const grouped = transactionsByHolding(rows);

    expect([...grouped.keys()]).toEqual(['card', 'cash']);
    expect(grouped.get('card')).toEqual([
      { time: 10, amountMinorUnits: -500 },
      { time: 30, amountMinorUnits: 200 },
    ]);
    expect(grouped.get('cash')).toEqual([{ time: 20, amountMinorUnits: 700 }]);
  });

  it('keeps the order the rows came in', () => {
    const grouped = transactionsByHolding([
      { holdingId: 'card', time: 30, amountMinorUnits: 1 },
      { holdingId: 'card', time: 10, amountMinorUnits: 2 },
    ]);

    expect(grouped.get('card')?.map((row) => row.time)).toEqual([30, 10]);
  });

  it('is empty with no rows', () => {
    expect(transactionsByHolding([]).size).toBe(0);
  });
});
