import { DAY_MS } from '@kiko/dates';
import { walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { convertAt } from './bybit.history-test-fixtures';
import { ACCOUNT_ID } from './bybit.capital-test-fixtures';
import { silencedWarnings } from './bybit.log-test-fixtures';
import { convertWalkOf } from './bybit.convert-test-fixtures';

const AT = NOW - 2 * DAY_MS;

const walkOver = async (rows: Record<string, unknown>[]) => {
  const walk = convertWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { convert: {} } }),
  });
  walk.serve([rows]);

  await walk.run();

  return walk;
};

const PAIR = `acc-1:convert:convert-${AT}:BTC:ETH`;

const FUND_WORDS = [
  'eb_convert_funding',
  'funding',
  'funding_fiat',
  'funding_fbtc_convert',
  'funding_block_trade',
];

// A convert is a source of the Funding ledger on its FUND words: Out for its from coin, In for its
// to coin.
describe('the convert walk: the records each convert writes to the Funding ledger', () => {
  silencedWarnings();

  it('a convert on Funding writes an Out record for its from coin and an In record for its to coin', async () => {
    const walk = await walkOver([convertAt(AT, { accountType: 'eb_convert_funding' })]);

    expect(walk.fundingSources()).toEqual([
      {
        accountId: ACCOUNT_ID,
        side: 'source',
        recordKey: `${PAIR}:BTC:fund`,
        series: 'convert',
        coin: 'BTC',
        direction: 'O',
        amount: '0.1',
        fee: null,
        tax: null,
        timeStart: AT,
        timeEnd: AT,
        earnPrincipal: false,
      },
      {
        accountId: ACCOUNT_ID,
        side: 'source',
        recordKey: `${PAIR}:ETH:fund`,
        series: 'convert',
        coin: 'ETH',
        direction: 'I',
        amount: '1.773938248611074',
        fee: null,
        tax: null,
        timeStart: AT,
        timeEnd: AT,
        earnPrincipal: false,
      },
    ]);
  });

  it.each(FUND_WORDS)('writes both records for the wallet word %s', async (word) => {
    const walk = await walkOver([convertAt(AT, { accountType: word })]);

    expect(walk.fundingSources().map(({ recordKey }) => recordKey)).toEqual([
      `${PAIR}:BTC:fund`,
      `${PAIR}:ETH:fund`,
    ]);
  });

  it('writes no record for a convert on the Unified wallet, though it writes its two rows', async () => {
    const walk = await walkOver([convertAt(AT, { accountType: 'eb_convert_uta' })]);

    expect(walk.rows()).toHaveLength(2);
    expect(walk.fundingSources()).toEqual([]);
    expect(walk.deps.writeFundingSources).not.toHaveBeenCalled();
  });

  it.each([
    ['a wallet word the walk does not know', { accountType: 'spot' }],
    ['a convert that failed', { accountType: 'funding', exchangeStatus: 'failure' }],
    ['a convert that is not settled yet', { accountType: 'funding', exchangeStatus: 'processing' }],
    ['a convert of one coin to itself', { accountType: 'funding', toCoin: 'BTC' }],
    [
      'a convert with a leg that rounds to nothing',
      { accountType: 'funding', toAmount: '0.000000000000000000001' },
    ],
  ])('writes no record for %s', async (_title, overrides) => {
    const walk = await walkOver([convertAt(AT, overrides)]);

    expect(walk.fundingSources()).toEqual([]);
    expect(walk.deps.writeFundingSources).not.toHaveBeenCalled();
  });

  it('writes the record of the tracked leg alone when the other coin is not tracked', async () => {
    const walk = await walkOver([
      convertAt(AT, { accountType: 'funding', toCoin: 'XYZ', toAmount: 'not read' }),
    ]);

    expect(walk.fundingSources()).toMatchObject([
      { recordKey: `acc-1:convert:convert-${AT}:BTC:XYZ:BTC:fund`, coin: 'BTC', direction: 'O' },
    ]);
  });

  it('writes the records before the rows, and the rows before the marks move', async () => {
    const walk = await walkOver([convertAt(AT, { accountType: 'funding' })]);

    expect(walk.sequence.slice(0, 2)).toEqual(['source-add', 'add']);
    expect(walk.sequence.slice(2).every((call) => call === 'mark')).toBe(true);
  });

  it('writes one batch of records for a page, and none for a Unified convert in it', async () => {
    const walk = await walkOver([
      convertAt(AT, { accountType: 'funding' }, 'first'),
      convertAt(AT + 1_000, { accountType: 'funding' }, 'second'),
      convertAt(AT + 2_000, { accountType: 'eb_convert_uta' }, 'unified'),
    ]);

    expect(walk.deps.writeFundingSources).toHaveBeenCalledTimes(1);
    expect(walk.fundingSources()).toHaveLength(4);
  });
});
