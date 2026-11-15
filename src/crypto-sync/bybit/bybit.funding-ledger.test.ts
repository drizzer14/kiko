import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { silencedWarnings } from './bybit.log-test-fixtures';
import { NEVER_READ, withoutField } from './bybit.history-test-fixtures';
import { ACCOUNT_ID, CURSOR_PREFIX, served } from './bybit.capital-test-fixtures';
import { fundingLedgerWalkOf, ledgerAt, ledgerKeyOf } from './bybit.funding-ledger-test-fixtures';

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;
const SECOND_MS = 1_000;

const newWalk = (
  options: Partial<Parameters<typeof fundingLedgerWalkOf>[0]> = {},
  marks: Record<string, unknown> = { cursor: CURSOR },
) =>
  fundingLedgerWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { fundingLedger: marks } }),
    ...options,
  });

type Walk = ReturnType<typeof newWalk>;

const storedState = async (walk: Walk) =>
  JSON.parse((await walk.readState()) ?? '{}') as Record<string, unknown>;

const patchesOf = (walk: Walk, kind: string): unknown[] =>
  (walk.deps.patchExchangeState as jest.Mock).mock.calls
    .flatMap(([, patches]) => patches as { kind: string }[])
    .filter((patch) => patch.kind === kind);

const RANGE = { start: CURSOR, end: NOW, series: 'fundingLedger' };

// Every row of this suite is built on the field words of the page's one sample: no page with a
// real row was read live.
describe('the Funding ledger walk: what each row is', () => {
  const warned = silencedWarnings();

  describe('a good row', () => {
    it('writes one ledger record of the named fields, in the whole second of its time', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [
        ledgerAt(AT, { currcCursor: 'row-1', txnAmt: '100.50', ioDirection: 'O' }),
      ];

      const result = await walk.run();

      expect(walk.ledgerRecords()).toEqual([
        {
          accountId: ACCOUNT_ID,
          side: 'ledger',
          recordKey: ledgerKeyOf('row-1'),
          series: null,
          coin: 'USDT',
          direction: 'O',
          amount: '100.50',
          fee: null,
          tax: null,
          timeStart: AT,
          timeEnd: AT + SECOND_MS - 1,
          earnPrincipal: false,
        },
      ]);
      expect(result.imported).toBe(1);
    });

    it('reads the named fields of the page row, and a sentinel reaches no record, mark or log', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [ledgerAt(AT)];

      await walk.run();

      const written = JSON.stringify([
        walk.ledgerRecords(),
        (walk.deps.patchExchangeState as jest.Mock).mock.calls,
        await walk.readState(),
        warned.spy().mock.calls,
      ]);

      expect(walk.ledgerRecords()).toHaveLength(1);
      expect(written).not.toContain(NEVER_READ);
      expect(written).not.toContain('fundingAccountRecord');
    });

    it('keeps an amount as decimal text: no float reaches it', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [ledgerAt(AT, { txnAmt: '0.1234567890123456789' })];

      await walk.run();

      expect(walk.ledgerRecords()[0].amount).toBe('0.1234567890123456789');
    });

    // No page with a real Out row was read: a sign on the amount may or may not be sent, and the
    // direction is ioDirection's either way, so a minus sign must never flip it or drop the row.
    it.each([
      ['I', '12.5'],
      ['I', '-12.5'],
      ['I', '+12.5'],
      ['O', '12.5'],
      ['O', '-12.5'],
      ['O', '+12.5'],
    ])(
      'an ioDirection %s with a txnAmt of %s writes the unsigned magnitude and that direction',
      async (ioDirection, txnAmt) => {
        const walk = newWalk();
        walk.world.fundingLedger = [ledgerAt(AT, { currcCursor: 'signed', ioDirection, txnAmt })];

        const result = await walk.run();

        expect(walk.ledgerRecords().map(({ direction, amount }) => [direction, amount])).toEqual([
          [ioDirection, '12.5'],
        ]);
        expect(walk.marks().pending).toEqual([]);
        expect(result.complete).toBe(true);
      },
    );

    it('keeps a signed amount as decimal text too: no float reaches it', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [
        ledgerAt(AT, { ioDirection: 'O', txnAmt: '-0.1234567890123456789' }),
      ];

      await walk.run();

      expect(walk.ledgerRecords()[0].amount).toBe('0.1234567890123456789');
    });

    it('is no conflict when two rows of one key hold one amount, one of them signed', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [
        ledgerAt(AT, { currcCursor: 'dup', ioDirection: 'O', txnAmt: '5' }),
        ledgerAt(AT, { currcCursor: 'dup', ioDirection: 'O', txnAmt: '-5' }),
      ];

      await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('dup')]);
      expect(walk.marks().pending).toEqual([]);
    });

    it('stores an Earn row with its boolean and no word, and an interest row without it', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [
        ledgerAt(AT, { currcCursor: 'stake', description: 'fundingAccountRecordOther' }),
        ledgerAt(AT + SECOND_MS, { currcCursor: 'interest' }),
      ];

      await walk.run();

      expect(
        walk.ledgerRecords().map(({ recordKey, earnPrincipal }) => [recordKey, earnPrincipal]),
      ).toEqual([
        [ledgerKeyOf('stake'), true],
        [ledgerKeyOf('interest'), false],
      ]);
      expect(JSON.stringify(walk.ledgerRecords())).not.toContain('fundingAccountRecord');
    });

    it('writes no transaction row and creates no holding', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [ledgerAt(AT)];

      await walk.run();

      expect(walk.rows()).toEqual([]);
      expect(walk.holdings).toEqual([]);
      expect(walk.ensureHoldings).not.toHaveBeenCalled();
    });

    it('keeps one record per key whatever the number of runs that read it', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [ledgerAt(AT, { currcCursor: 'once' })];

      await walk.run();
      walk.clock.now += DAY_MS;
      await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('once')]);
    });

    it('keeps rows of one key and two coins apart, and a row read twice in one span once', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [
        ledgerAt(AT, { currcCursor: 'same', currency: 'USDT' }),
        ledgerAt(AT, { currcCursor: 'same', currency: 'BTC' }),
        ledgerAt(AT + SECOND_MS, { currcCursor: 'twice' }),
        ledgerAt(AT + SECOND_MS, { currcCursor: 'twice' }),
      ];

      await walk.run();

      expect(walk.ledgerKeys().sort()).toEqual(
        [ledgerKeyOf('same', 'BTC'), ledgerKeyOf('same'), ledgerKeyOf('twice')].sort(),
      );
      expect(walk.marks().pending).toEqual([]);
    });

    it('writes the records of a span before the marks move', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [ledgerAt(AT)];

      await walk.run();

      expect(walk.sequence.indexOf('add')).toBeGreaterThanOrEqual(0);
      expect(walk.sequence.indexOf('add')).toBeLessThan(walk.sequence.indexOf('mark'));
    });
  });

  describe('a row with no currcCursor', () => {
    const keyless = (time: number) => served(time, withoutField(ledgerAt(time).row, 'currcCursor'));

    it('makes no record and owes nothing, marks the line once, and its neighbour imports', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [
        keyless(AT),
        keyless(AT + SECOND_MS),
        ledgerAt(AT + 2 * SECOND_MS, { currcCursor: 'next' }),
      ];

      await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('next')]);
      expect(walk.marks().pending).toEqual([]);
      expect(patchesOf(walk, 'fundingLeftOut')).toHaveLength(1);
      expect((await storedState(walk)).fundingLeftOut).toBe(true);
    });

    it('marks the line before the cursor moves', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [keyless(AT)];

      await walk.run();

      const calls = (walk.deps.patchExchangeState as jest.Mock).mock.calls.flatMap(
        ([, patches]) => patches as { kind: string; field?: string }[],
      );
      const marked = calls.findIndex(({ kind }) => kind === 'fundingLeftOut');
      const moved = calls.findIndex(({ kind, field }) => kind === 'walk' && field === 'cursor');

      expect(marked).toBeGreaterThanOrEqual(0);
      expect(marked).toBeLessThan(moved);
    });

    it('writes no mark for a span with a key on every row', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [ledgerAt(AT)];

      await walk.run();

      expect(patchesOf(walk, 'fundingLeftOut')).toEqual([]);
      expect((await storedState(walk)).fundingLeftOut).toBeUndefined();
    });
  });

  describe('a row the walk cannot trust owes its span as one range, never a point', () => {
    it.each([
      ['an ioDirection outside I and O', { ioDirection: 'X' }],
      ['a signed zero txnAmt', { txnAmt: '-0' }],
      ['a signed zero txnAmt with a fraction', { txnAmt: '-0.00' }],
      ['a txnAmt of a sign alone', { txnAmt: '-' }],
      ['a txnAmt with two signs', { txnAmt: '--5' }],
      ['a txnAmt with a sign after its digits', { txnAmt: '5-' }],
      ['a signed txnAmt in exponent form', { txnAmt: '-1e5' }],
      ['a signed txnAmt with a comma', { txnAmt: '-1,000' }],
      ['a zero txnAmt', { txnAmt: '0' }],
      ['a zero txnAmt with a fraction', { txnAmt: '0.000' }],
      ['a txnAmt that is no number', { txnAmt: 'abc' }],
      ['a txnAmt with a comma', { txnAmt: '1,000' }],
      ['a txnAmt in exponent form', { txnAmt: '1e5' }],
      ['an empty txnAmt', { txnAmt: '' }],
      ['a txnAmt that is no text', { txnAmt: 100 }],
      ['a createTime of another digit count', { createTime: '17427281' }],
      ['an empty createTime', { createTime: '' }],
      ['a createTime of zero', { createTime: '0' }],
      ['an empty currency', { currency: '' }],
    ])(
      '%s writes no record for it and owes the span once, and its neighbour imports',
      async (_title, overrides) => {
        const walk = newWalk();
        walk.world.fundingLedger = [
          ledgerAt(AT, { currcCursor: 'bad', ...overrides }),
          ledgerAt(AT + SECOND_MS, { currcCursor: 'good' }),
        ];

        const result = await walk.run();

        expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('good')]);
        expect(walk.marks().pending).toEqual([RANGE]);
        expect(result.complete).toBe(false);
      },
    );

    it('fifty bad rows leave one range and no point', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = Array.from({ length: 50 }, (_unused, index) =>
        ledgerAt(AT + index * SECOND_MS, { currcCursor: `bad-${index}`, txnAmt: 'abc' }),
      );

      await walk.run();

      expect(walk.marks().pending).toEqual([RANGE]);
    });

    it('an item that is no row owes its span, and the neighbour imports', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [
        served(AT, 5 as unknown as Record<string, unknown>),
        ledgerAt(AT + SECOND_MS, { currcCursor: 'good' }),
      ];

      await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('good')]);
      expect(walk.marks().pending).toEqual([RANGE]);
    });

    it('a range owed is read again by a later run, and clears once the row reads well', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [ledgerAt(AT, { currcCursor: 'fixed', txnAmt: 'abc' })];

      await walk.run();

      expect(walk.marks().pending).toHaveLength(1);

      walk.world.fundingLedger = [ledgerAt(AT, { currcCursor: 'fixed', txnAmt: '5' })];
      walk.clock.now += DAY_MS;
      await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('fixed')]);
      expect(walk.marks().pending).toEqual([]);
    });

    it('goes past the range in the forward pass, so the cursor moves on', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [ledgerAt(AT, { txnAmt: '0' })];

      await walk.run();

      expect(walk.marks().cursor).toBe(NOW);
    });
  });

  describe('one key with two values', () => {
    it('owes both of their point, and its neighbour imports', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [
        ledgerAt(AT, { currcCursor: 'clash', txnAmt: '1' }),
        ledgerAt(AT, { currcCursor: 'clash', txnAmt: '2' }),
        ledgerAt(AT + SECOND_MS, { currcCursor: 'next' }),
      ];

      await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('next')]);
      expect(walk.marks().pending).toEqual([
        {
          start: AT - 1,
          end: AT + SECOND_MS,
          kind: 'point',
          series: 'fundingLedger',
          since: NOW,
        },
      ]);
    });

    it('is no conflict when two rows of one key hold the same amount in another spelling', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [
        ledgerAt(AT, { currcCursor: 'dup', txnAmt: '1.0' }),
        ledgerAt(AT, { currcCursor: 'dup', txnAmt: '1.00' }),
      ];

      await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('dup')]);
      expect(walk.marks().pending).toEqual([]);
    });
  });

  describe('a coin the app does not track', () => {
    it('counts the coin in the untracked list and writes no record, whatever the rest of the row', async () => {
      const walk = newWalk();
      walk.world.fundingLedger = [
        ledgerAt(AT, { currcCursor: 'odd', currency: 'PEPEXYZ', txnAmt: '-1' }),
        ledgerAt(AT + SECOND_MS, { currcCursor: 'tracked' }),
      ];

      await walk.run();

      expect(walk.ledgerKeys()).toEqual([ledgerKeyOf('tracked')]);
      expect(walk.marks().pending).toEqual([]);
      expect((await storedState(walk)).untrackedCoins).toEqual({ history: ['PEPEXYZ'] });
    });
  });

  it('does not store a page cursor anywhere', async () => {
    const walk = newWalk({ fake: { pageSize: 1 } });
    walk.world.fundingLedger = [0, 1, 2].map((index) =>
      ledgerAt(AT + index * SECOND_MS, { currcCursor: `row-${index}` }),
    );

    await walk.run();

    expect(walk.ledgerKeys()).toHaveLength(3);
    expect(JSON.stringify((walk.deps.patchExchangeState as jest.Mock).mock.calls)).not.toContain(
      CURSOR_PREFIX,
    );
  });
});
