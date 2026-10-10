import type { HoldingRow } from '@kiko/db';

import {
  createMovementLedger,
  type Movement,
  OVERLAP_GUARD_MS,
  twinsOf,
} from './binance.overlap-guard';

const MINUTE_MS = 60_000;
const TIME = Date.UTC(2026, 8, 1);
const SIZE = 100_000;

const capital = (id: string, minutes = 0, amountMinorUnits = SIZE): Movement => ({
  externalId: `acc:deposit:${id}`,
  amountMinorUnits,
  time: TIME + minutes * MINUTE_MS,
});

const pay = (id: string, minutes = 0, amountMinorUnits = SIZE): Movement => ({
  externalId: `acc:pay:C2C:${id}:2`,
  amountMinorUnits,
  time: TIME + minutes * MINUTE_MS,
});

const idsOf = (twins: Set<string>): string[] => [...twins].sort();

describe('twinsOf: the pairing test', () => {
  it('pairs a Pay candidate with a stored capital row of the same size inside the guard', () => {
    const twins = twinsOf({
      kind: 'pay',
      candidates: [pay('a', 9)],
      sameKind: [],
      otherKind: [capital('1')],
    });

    expect(idsOf(twins)).toEqual(['acc:pay:C2C:a:2']);
  });

  it('pairs on the guard edge and not one millisecond past it', () => {
    const onEdge = { ...pay('a'), time: TIME + OVERLAP_GUARD_MS };
    const pastEdge = { ...pay('b'), time: TIME + OVERLAP_GUARD_MS + 1 };

    const twins = twinsOf({
      kind: 'pay',
      candidates: [onEdge, pastEdge],
      sameKind: [],
      otherKind: [capital('1')],
    });

    expect(idsOf(twins)).toEqual(['acc:pay:C2C:a:2']);
  });

  it('does not pair rows of another size or another sign', () => {
    const twins = twinsOf({
      kind: 'pay',
      candidates: [pay('a', 0, SIZE + 1), pay('b', 0, -SIZE)],
      sameKind: [],
      otherKind: [capital('1')],
    });

    expect(twins.size).toBe(0);
  });

  it('is symmetric: a capital candidate pairs with a stored Pay row', () => {
    const twins = twinsOf({
      kind: 'capital',
      candidates: [capital('1', 3)],
      sameKind: [],
      otherKind: [pay('a')],
    });

    expect(idsOf(twins)).toEqual(['acc:deposit:1']);
  });
});

describe('twinsOf: one to one', () => {
  it('pairs the closest of two Pay candidates and keeps the other', () => {
    const near = pay('near', 1);
    const far = pay('far', 5);

    const twins = twinsOf({
      kind: 'pay',
      candidates: [far, near],
      sameKind: [],
      otherKind: [capital('1')],
    });

    expect(idsOf(twins)).toEqual([near.externalId]);
  });

  it('breaks a tie in time by external id, whatever the order of the candidates', () => {
    const before = pay('b', -3);
    const after = pay('a', 3);

    const forward = twinsOf({
      kind: 'pay',
      candidates: [before, after],
      sameKind: [],
      otherKind: [capital('1')],
    });
    const backward = twinsOf({
      kind: 'pay',
      candidates: [after, before],
      sameKind: [],
      otherKind: [capital('1')],
    });

    expect(idsOf(forward)).toEqual([after.externalId]);
    expect(idsOf(backward)).toEqual([after.externalId]);
  });

  it('gives the capital row to the closer of two Pay rows, one of them already stored', () => {
    const stored = pay('stored', 1);
    const candidate = pay('candidate', 4);

    const twins = twinsOf({
      kind: 'pay',
      candidates: [candidate],
      sameKind: [stored],
      otherKind: [capital('1')],
    });

    expect(twins.size).toBe(0);
  });

  it('skips a candidate that is closer to the capital row than a stored Pay row', () => {
    const stored = pay('stored', 4);
    const candidate = pay('candidate', 1);

    const twins = twinsOf({
      kind: 'pay',
      candidates: [candidate],
      sameKind: [stored],
      otherKind: [capital('1')],
    });

    expect(idsOf(twins)).toEqual([candidate.externalId]);
  });

  it('does not pair a stored row twice: a pair of stored rows leaves the next candidate alone', () => {
    const twins = twinsOf({
      kind: 'capital',
      candidates: [capital('2', 3)],
      sameKind: [capital('1')],
      otherKind: [pay('a', 1)],
    });

    expect(twins.size).toBe(0);
  });

  it('pairs each candidate with a different stored row', () => {
    const twins = twinsOf({
      kind: 'pay',
      candidates: [pay('a', 1), pay('b', 2)],
      sameKind: [],
      otherKind: [capital('1'), capital('2')],
    });

    expect(idsOf(twins)).toEqual(['acc:pay:C2C:a:2', 'acc:pay:C2C:b:2']);
  });

  it('pairs the same rows whichever walk asks', () => {
    const payRows = [pay('a', -3), pay('b', 3)];
    const capitalRows = [capital('1')];

    const fromPay = twinsOf({
      kind: 'pay',
      candidates: payRows,
      sameKind: [],
      otherKind: capitalRows,
    });
    const fromCapital = twinsOf({
      kind: 'capital',
      candidates: capitalRows,
      sameKind: [],
      otherKind: payRows,
    });

    expect(idsOf(fromPay)).toEqual([payRows[0].externalId]);
    expect(idsOf(fromCapital)).toEqual([capitalRows[0].externalId]);
  });

  it('treats a candidate that is already stored as the stored row, not as a new one', () => {
    const row = pay('a', 1);

    const twins = twinsOf({
      kind: 'pay',
      candidates: [row],
      sameKind: [row],
      otherKind: [capital('1')],
    });

    expect(twins.size).toBe(0);
  });
});

describe('createMovementLedger', () => {
  type StoredRow = { externalId: string | null; amountMinorUnits: number; time: number };

  const holdingOf = (id: string, metadata: Record<string, unknown> | null): HoldingRow =>
    ({ id, metadata }) as unknown as HoldingRow;

  const rowsByHolding: Record<string, StoredRow[]> = {
    spot: [
      { externalId: 'acc:deposit:1', amountMinorUnits: 5, time: 1 },
      { externalId: 'acc:pay:C2C:a:2', amountMinorUnits: 6, time: 2 },
      { externalId: 'acc:withdraw:2', amountMinorUnits: -7, time: 3 },
      { externalId: null, amountMinorUnits: 8, time: 4 },
      { externalId: 'acc:transfer:9', amountMinorUnits: 9, time: 5 },
      { externalId: 'other:deposit:1', amountMinorUnits: 10, time: 6 },
    ],
    funding: [{ externalId: 'acc:deposit:3', amountMinorUnits: 11, time: 7 }],
    earn: [{ externalId: 'acc:pay:C2C:b:5', amountMinorUnits: 12, time: 8 }],
    card: [{ externalId: 'acc:deposit:4', amountMinorUnits: 13, time: 9 }],
  };

  const ledgerWith = () => {
    const listHoldingTransactions = jest.fn(async (holdingId: string) => rowsByHolding[holdingId]);
    const ledger = createMovementLedger({
      accountId: 'acc',
      listHoldings: async () => [
        holdingOf('spot', { binanceAsset: 'BTC' }),
        holdingOf('funding', { binanceAsset: 'BTC:funding' }),
        holdingOf('earn', { binanceAsset: 'BTC:earn' }),
        holdingOf('card', null),
      ],
      listHoldingTransactions,
    });

    return { ledger, listHoldingTransactions };
  };

  it('reads the capital and Pay rows of every Binance BTC holding of the account', async () => {
    const { ledger } = ledgerWith();

    const { capital: capitalRows, pay: payRows } = await ledger.read();

    expect(capitalRows.map((row) => row.externalId)).toEqual([
      'acc:deposit:1',
      'acc:withdraw:2',
      'acc:deposit:3',
    ]);
    expect(payRows.map((row) => row.externalId)).toEqual(['acc:pay:C2C:a:2', 'acc:pay:C2C:b:5']);
  });

  it('reads each holding once, and never a holding that is not a Binance wallet', async () => {
    const { ledger, listHoldingTransactions } = ledgerWith();

    await ledger.read();
    await ledger.read();

    expect(listHoldingTransactions.mock.calls.map((call) => call[0]).sort()).toEqual([
      'earn',
      'funding',
      'spot',
    ]);
  });

  it('adds the rows a walk has just stored to what it reads next', async () => {
    const { ledger } = ledgerWith();
    await ledger.read();

    ledger.remember([
      { externalId: 'acc:pay:C2C:new:2', amountMinorUnits: 1, time: 1 },
      { externalId: 'acc:deposit:new', amountMinorUnits: 2, time: 2 },
    ]);

    const { capital: capitalRows, pay: payRows } = await ledger.read();
    expect(capitalRows.map((row) => row.externalId)).toContain('acc:deposit:new');
    expect(payRows.map((row) => row.externalId)).toContain('acc:pay:C2C:new:2');
  });
});
