import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { ACCOUNT_ID, capitalWalkOf, served } from './bybit.capital-test-fixtures';
import { depositRow, internalDepositRow, withdrawalRow } from './bybit.history-test-fixtures';

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;
const SECOND_MS = 1_000;

const newWalk = () =>
  capitalWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { capital: { cursor: CURSOR } } }),
  });

const depositAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(time, depositRow({ successAt: String(time), coin: 'BTC', amount: '0.5', ...overrides }));

const internalAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(
    time,
    internalDepositRow({
      createdTime: String(time / SECOND_MS),
      coin: 'BTC',
      amount: '0.25',
      ...overrides,
    }),
  );

const withdrawalAt = (time: number, overrides: Record<string, unknown> = {}) =>
  served(
    time,
    withdrawalRow({
      createTime: String(time),
      updateTime: String(time + SECOND_MS),
      coin: 'BTC',
      amount: '0.125',
      ...overrides,
    }),
  );

// The stored set of the Funding ledger holds one record per source row, under the key of the row.
describe('the capital walk: the record each row writes to the Funding ledger', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('a deposit writes an In record at its success time, with its fee and no tax', async () => {
    const walk = newWalk();
    walk.world.deposit = [depositAt(AT, { depositFee: '0.001' })];

    await walk.run();

    expect(walk.fundingSources()).toEqual([
      {
        accountId: ACCOUNT_ID,
        side: 'source',
        recordKey: 'acc-1:deposit:1234:BTC',
        series: 'deposit',
        coin: 'BTC',
        direction: 'I',
        amount: '0.5',
        fee: '0.001',
        tax: null,
        timeStart: AT,
        timeEnd: AT,
        earnPrincipal: false,
      },
    ]);
  });

  it('an internal deposit writes an In record that spans its whole second, with no fee', async () => {
    const walk = newWalk();
    walk.world.internal = [internalAt(AT)];

    await walk.run();

    expect(walk.fundingSources()).toEqual([
      {
        accountId: ACCOUNT_ID,
        side: 'source',
        recordKey: 'acc-1:internal:5678:BTC',
        series: 'internal',
        coin: 'BTC',
        direction: 'I',
        amount: '0.25',
        fee: null,
        tax: null,
        timeStart: AT,
        timeEnd: AT + SECOND_MS - 1,
        earnPrincipal: false,
      },
    ]);
  });

  it('a withdrawal writes an Out record from its createTime to its updateTime, with fee and tax', async () => {
    const walk = newWalk();
    walk.world.withdraw = [withdrawalAt(AT, { withdrawFee: '0.0005', tax: '0.01' })];

    await walk.run();

    expect(walk.fundingSources()).toEqual([
      {
        accountId: ACCOUNT_ID,
        side: 'source',
        recordKey: 'acc-1:withdraw:9012:BTC',
        series: 'withdraw',
        coin: 'BTC',
        direction: 'O',
        amount: '0.125',
        fee: '0.0005',
        tax: '0.01',
        timeStart: AT,
        timeEnd: AT + SECOND_MS,
        earnPrincipal: false,
      },
    ]);
  });

  it('keeps an amount, a fee and a tax as the decimal text the page sent', async () => {
    const walk = newWalk();
    walk.world.withdraw = [
      withdrawalAt(AT, { amount: '0.12500000', withdrawFee: '0.00000001', tax: '0' }),
    ];

    await walk.run();

    expect(walk.fundingSources()).toMatchObject([
      { amount: '0.12500000', fee: '0.00000001', tax: '0' },
    ]);
  });

  it('writes no fee or tax for an empty or unreadable one, and still writes the record', async () => {
    const walk = newWalk();
    walk.world.deposit = [depositAt(AT, { depositFee: '' })];
    walk.world.withdraw = [withdrawalAt(AT, { withdrawFee: 'five', tax: undefined })];

    await walk.run();

    expect(walk.fundingSources()).toMatchObject([
      { series: 'deposit', fee: null, tax: null },
      { series: 'withdraw', fee: null, tax: null },
    ]);
  });

  it('writes the record before its row, and the row before the marks move', async () => {
    const walk = newWalk();
    walk.world.deposit = [depositAt(AT)];

    await walk.run();

    expect(walk.sequence.slice(0, 2)).toEqual(['source-add', 'add']);
    expect(walk.sequence.slice(2).every((call) => call === 'mark')).toBe(true);
  });

  it('writes one batch of records for a span that holds rows of every series', async () => {
    const walk = newWalk();
    walk.world.deposit = [depositAt(AT)];
    walk.world.internal = [internalAt(AT + SECOND_MS)];
    walk.world.withdraw = [withdrawalAt(AT + 2 * SECOND_MS)];

    await walk.run();

    expect(walk.deps.writeFundingSources).toHaveBeenCalledTimes(1);
    expect(walk.fundingSources().map(({ series }) => series)).toEqual([
      'deposit',
      'internal',
      'withdraw',
    ]);
  });

  it('writes the same record again on a second run over the same rows, and no second record', async () => {
    const walk = newWalk();
    walk.world.deposit = [depositAt(AT)];

    await walk.run();
    await walk.run();

    expect(walk.fundingSources()).toHaveLength(1);
  });

  it.each([
    ['a failed deposit', depositAt(AT, { status: 4 })],
    ['a deposit that is not credited', depositAt(AT, { status: 3, depositType: '50' })],
    ['a deposit of zero', depositAt(AT, { amount: '0' })],
    ['a deposit of a coin the app does not track', depositAt(AT, { coin: 'PEPE' })],
  ])('writes no record for %s', async (_title, row) => {
    const walk = newWalk();
    walk.world.deposit = [row];

    await walk.run();

    expect(walk.fundingSources()).toEqual([]);
    expect(walk.deps.writeFundingSources).not.toHaveBeenCalled();
  });

  it('writes no record for a withdrawal that was cancelled or is of zero', async () => {
    const walk = newWalk();
    walk.world.withdraw = [
      withdrawalAt(AT, { withdrawId: 'cancelled', status: 'CancelByUser' }),
      withdrawalAt(AT + SECOND_MS, { withdrawId: 'zero', amount: '0.00000000' }),
    ];

    await walk.run();

    expect(walk.fundingSources()).toEqual([]);
    expect(walk.deps.writeFundingSources).not.toHaveBeenCalled();
  });

  it('writes no record for an internal deposit that failed', async () => {
    const walk = newWalk();
    walk.world.internal = [internalAt(AT, { status: 3 })];

    await walk.run();

    expect(walk.fundingSources()).toEqual([]);
    expect(walk.deps.writeFundingSources).not.toHaveBeenCalled();
  });

  it('writes no record for a row it owes, and the neighbours of that row still write theirs', async () => {
    const walk = newWalk();
    walk.world.deposit = [
      depositAt(AT, { id: 'owed', amount: '0.123456789' }),
      depositAt(AT + SECOND_MS, { id: 'good' }),
    ];

    await walk.run();

    expect(walk.fundingSources().map(({ recordKey }) => recordKey)).toEqual([
      'acc-1:deposit:good:BTC',
    ]);
  });

  it('a rolled back deposit takes its record away with its row, the row first', async () => {
    const walk = newWalk();
    walk.world.deposit = [depositAt(AT, { id: 'gone' }), depositAt(AT + SECOND_MS, { id: 'kept' })];
    await walk.run();
    walk.sequence.length = 0;

    walk.world.deposit = [
      depositAt(AT, { id: 'gone', status: 70011 }),
      depositAt(AT + SECOND_MS, { id: 'kept' }),
    ];
    await walk.run();

    expect(walk.fundingSources().map(({ recordKey }) => recordKey)).toEqual([
      'acc-1:deposit:kept:BTC',
    ]);
    expect(walk.deps.removeFundingSources).toHaveBeenLastCalledWith(ACCOUNT_ID, [
      'acc-1:deposit:gone:BTC',
    ]);
    expect(walk.sequence.slice(0, 4)).toEqual(['source-add', 'add', 'remove', 'source-remove']);
  });

  it('takes away no record when no deposit was rolled back', async () => {
    const walk = newWalk();
    walk.world.deposit = [depositAt(AT)];

    await walk.run();

    expect(walk.deps.removeFundingSources).not.toHaveBeenCalled();
  });
});
