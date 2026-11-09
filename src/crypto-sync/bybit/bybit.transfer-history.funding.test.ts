import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { ACCOUNT_ID } from './bybit.capital-test-fixtures';
import { transferAt, transferWalkOf } from './bybit.transfer-test-fixtures';

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;

const newWalk = () =>
  transferWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { transfer: { cursor: CURSOR } } }),
  });

const FUND_LEG_KEY = 'acc-1:xfer:transfer-1:BTC:BTC:fund';

// A transfer is a source of the Funding ledger on the wallet it names as Funding, and only there.
describe('the transfer walk: the record each transfer writes to the Funding ledger', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('a transfer from Unified to Funding writes one In record, under the key of its Funding leg', async () => {
    const walk = newWalk();
    walk.world.transfer = [
      transferAt(AT, { fromAccountType: 'UNIFIED', toAccountType: 'FUND', amount: '2' }),
    ];

    await walk.run();

    expect(walk.rows()).toHaveLength(2);
    expect(walk.fundingSources()).toEqual([
      {
        accountId: ACCOUNT_ID,
        side: 'source',
        recordKey: FUND_LEG_KEY,
        series: 'transfer',
        coin: 'BTC',
        direction: 'I',
        amount: '2',
        fee: null,
        tax: null,
        timeStart: AT,
        timeEnd: AT,
        earnPrincipal: false,
      },
    ]);
  });

  it('a transfer from Funding to Unified writes one Out record, under the key of its Funding leg', async () => {
    const walk = newWalk();
    walk.world.transfer = [transferAt(AT, { amount: '0.50000000' })];

    await walk.run();

    expect(walk.fundingSources()).toMatchObject([
      { recordKey: FUND_LEG_KEY, series: 'transfer', direction: 'O', amount: '0.50000000' },
    ]);
  });

  it('writes the record of the Funding leg and none for the Unified leg', async () => {
    const walk = newWalk();
    walk.world.transfer = [transferAt(AT)];

    await walk.run();

    expect(walk.fundingSources().map(({ recordKey }) => recordKey)).not.toContain(
      'acc-1:xfer:transfer-1:BTC:BTC:unified',
    );
  });

  it.each([
    ['Unified to Unified', 'UNIFIED', 'UNIFIED'],
    ['Funding to Funding', 'FUND', 'FUND'],
  ])(
    'writes no record for a transfer from %s, which moves no money Kiko keeps',
    async (_title, from, to) => {
      const walk = newWalk();
      walk.world.transfer = [transferAt(AT, { fromAccountType: from, toAccountType: to })];

      await walk.run();

      expect(walk.rows()).toEqual([]);
      expect(walk.fundingSources()).toEqual([]);
      expect(walk.deps.writeFundingSources).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a wallet word the walk does not know', { fromAccountType: 'SPOT', toAccountType: 'FUND' }],
    ['a failed transfer', { status: 'FAILED' }],
    ['a transfer of zero', { amount: '0' }],
    ['a transfer that is not settled yet', { status: 'PENDING' }],
    ['a coin the app does not track', { coin: 'PEPE' }],
  ])('writes no record for %s', async (_title, overrides) => {
    const walk = newWalk();
    walk.world.transfer = [transferAt(AT, overrides)];

    await walk.run();

    expect(walk.fundingSources()).toEqual([]);
    expect(walk.deps.writeFundingSources).not.toHaveBeenCalled();
  });

  it('writes the record before the legs, and the legs before the marks move', async () => {
    const walk = newWalk();
    walk.world.transfer = [transferAt(AT)];

    await walk.run();

    expect(walk.sequence.slice(0, 2)).toEqual(['source-add', 'add']);
    expect(walk.sequence.slice(2).every((call) => call === 'mark')).toBe(true);
  });

  it('writes no second record when a later run reads the same transfer again', async () => {
    const walk = newWalk();
    walk.world.transfer = [transferAt(AT)];

    await walk.run();
    await walk.run();

    expect(walk.fundingSources()).toHaveLength(1);
  });
});
