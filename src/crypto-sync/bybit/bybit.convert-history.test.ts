import { DAY_MS } from '@kiko/dates';
import { coinListPatchesOf, walkStateFake } from '@kiko/test-support/walk-marks';

import { NOW } from './bybit.client-test-fixtures';
import { ACCOUNT_ID } from './bybit.capital-test-fixtures';
import { silencedWarnings } from './bybit.log-test-fixtures';
import { convertWalkOf } from './bybit.convert-test-fixtures';
import { convertAt, convertWithoutId, NEVER_READ } from './bybit.history-test-fixtures';

const AT = NOW - 2 * DAY_MS;
const FLOOR = NOW - 729 * DAY_MS;
const SECOND_MS = 1_000;
const BOUGHT_ETH = 177_393_825;
const SOLD_BTC = -10_000_000;

const newWalk = (options: Partial<Parameters<typeof convertWalkOf>[0]> = {}) => {
  const state = walkStateFake({ accountId: ACCOUNT_ID, marks: { convert: {} } });

  return { ...convertWalkOf({ state, ...options }), notImported: state.notImported };
};

const walkOver = async (rows: Record<string, unknown>[]) => {
  const walk = newWalk();
  walk.serve([rows]);

  await walk.run();

  return walk;
};

const pairOf = (time: number, transactionId = `convert-${time}`) =>
  `acc-1:convert:${transactionId}:BTC:ETH`;

const pointAt = (time: number) => ({
  start: time - 1,
  end: time + 1,
  kind: 'point',
  series: 'convert',
  since: NOW,
});

describe('the convert walk: what each row is', () => {
  const warned = silencedWarnings();

  describe('a settled convert', () => {
    it('a convert writes two legs under one pair that names both coins, on the wallet of its word', async () => {
      const walk = await walkOver([convertAt(AT)]);

      expect(walk.rows()).toEqual([
        {
          externalId: `${pairOf(AT)}:BTC:unified`,
          holdingId: 'holding-BTC:unified',
          amountMinorUnits: SOLD_BTC,
          time: AT,
          source: 'bybit',
          description: '',
          operation: 'convert',
          exchangePairId: pairOf(AT),
          exchangeCounterpartHoldingId: 'holding-ETH:unified',
        },
        {
          externalId: `${pairOf(AT)}:ETH:unified`,
          holdingId: 'holding-ETH:unified',
          amountMinorUnits: BOUGHT_ETH,
          time: AT,
          source: 'bybit',
          description: '',
          operation: 'convert',
          exchangePairId: pairOf(AT),
          exchangeCounterpartHoldingId: 'holding-BTC:unified',
        },
      ]);
    });

    it.each([
      ['eb_convert_uta', 'unified'],
      ['eb_convert_funding', 'fund'],
      ['funding', 'fund'],
      ['funding_fiat', 'fund'],
      ['funding_fbtc_convert', 'fund'],
      ['funding_block_trade', 'fund'],
    ])('puts both legs of the wallet word %s on the %s wallet', async (word, wallet) => {
      const walk = await walkOver([convertAt(AT, { accountType: word })]);

      expect(walk.rows().map((row) => row.holdingId)).toEqual([
        `holding-BTC:${wallet}`,
        `holding-ETH:${wallet}`,
      ]);
      expect(walk.rows().map((row) => row.exchangeCounterpartHoldingId)).toEqual([
        `holding-ETH:${wallet}`,
        `holding-BTC:${wallet}`,
      ]);
    });

    it("the page's 15-decimal amount rounds and imports", async () => {
      const walk = await walkOver([convertAt(AT, { toAmount: '1.773938248611074' })]);

      expect(walk.rows().map((row) => row.amountMinorUnits)).toEqual([SOLD_BTC, BOUGHT_ETH]);
      expect(walk.marks().pending).toEqual([]);
    });

    it('a time of ten digits is the start of its whole second', async () => {
      const walk = await walkOver([convertAt(AT, { createdAt: String(AT / SECOND_MS) })]);

      expect(walk.rows().map((row) => row.time)).toEqual([AT, AT]);
    });

    it('creates the holdings of both coins at zero on the wallet', async () => {
      const walk = await walkOver([convertAt(AT)]);

      expect(walk.deps.ensureHoldings).toHaveBeenCalledWith([
        expect.objectContaining({ metadataKey: 'BTC:unified', balanceMinorUnits: 0 }),
        expect.objectContaining({ metadataKey: 'ETH:unified', balanceMinorUnits: 0 }),
      ]);
    });

    it('imports the same convert once when a run reads it twice', async () => {
      const walk = newWalk();
      walk.serve([[convertAt(AT)]]);

      await walk.run();
      await walk.run();

      expect(walk.rows()).toHaveLength(2);
    });
  });

  describe('the status', () => {
    it('imports success, ignores failure, and owes init, processing and any other word', async () => {
      const walk = await walkOver([
        convertAt(AT, { exchangeStatus: 'success' }),
        convertAt(AT + SECOND_MS, { exchangeStatus: 'failure' }),
        convertAt(AT + 2 * SECOND_MS, { exchangeStatus: 'init' }),
        convertAt(AT + 3 * SECOND_MS, { exchangeStatus: 'processing' }),
        convertAt(AT + 4 * SECOND_MS, { exchangeStatus: 'a-word-no-page-names' }),
      ]);

      expect(walk.keys()).toEqual([`${pairOf(AT)}:BTC:unified`, `${pairOf(AT)}:ETH:unified`]);
      expect(walk.marks().pending).toEqual([
        pointAt(AT + 2 * SECOND_MS),
        pointAt(AT + 3 * SECOND_MS),
        pointAt(AT + 4 * SECOND_MS),
      ]);
      expect(walk.notImported()).toEqual([]);
      expect(warned.codes()).toContain('convert-not-settled');
    });

    it('owes the whole readable ground, as one range tagged convert, for a waiting row with no time', async () => {
      const walk = await walkOver([convertAt(AT, { exchangeStatus: 'init', createdAt: '' })]);

      expect(walk.marks().pending).toEqual([{ start: FLOOR, end: NOW, series: 'convert' }]);
      expect(walk.notImported()).toEqual([]);
    });

    it('reads a failure with no time as nothing at all', async () => {
      const walk = await walkOver([convertAt(AT, { exchangeStatus: 'failure', createdAt: '' })]);

      expect(walk.rows()).toEqual([]);
      expect(walk.marks().pending).toEqual([]);
      expect(walk.notImported()).toEqual([]);
    });
  });

  describe('a convert the rules refuse for good', () => {
    it.each([
      ['a wallet word the page does not name', { accountType: 'eb_convert_other' }],
      ['the same coin on both sides', { toCoin: 'BTC' }],
      ['a time that cannot be read', { createdAt: 'not-a-time' }],
      ['an empty time', { createdAt: '' }],
    ])('refuses %s into the list of what is not imported, and owes nothing', async (_, fields) => {
      const walk = await walkOver([convertAt(AT, fields, 'refused')]);
      const time = 'createdAt' in fields ? 0 : AT;

      expect(walk.rows()).toEqual([]);
      expect(walk.notImported()).toEqual([`convert-unrecognized:refused:${time}`]);
      expect(walk.marks().pending).toEqual([]);
    });
  });

  describe('a coin the app does not track', () => {
    it('writes the tracked leg alone, marked with the other coin, and names that coin', async () => {
      const walk = await walkOver([convertAt(AT, { toCoin: 'XYZ', toAmount: 'not read' })]);

      expect(walk.rows()).toEqual([
        {
          externalId: `acc-1:convert:convert-${AT}:BTC:XYZ:BTC:unified`,
          holdingId: 'holding-BTC:unified',
          amountMinorUnits: SOLD_BTC,
          time: AT,
          source: 'bybit',
          description: '',
          operation: 'convert',
          untrackedCounterpart: 'asset:XYZ',
        },
      ]);
      expect(coinListPatchesOf(walk.deps)).toEqual([
        { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['XYZ'] },
      ]);
    });

    it('writes no row for a convert of two such coins, and names both', async () => {
      const walk = await walkOver([convertAt(AT, { fromCoin: 'ABC', toCoin: 'XYZ' })]);

      expect(walk.rows()).toEqual([]);
      expect(coinListPatchesOf(walk.deps)[0]).toMatchObject({ tickers: ['ABC', 'XYZ'] });
    });

    it('owes the point of a convert whose other coin names no asset code', async () => {
      const walk = await walkOver([convertAt(AT, { toCoin: 'X:Y' })]);

      expect(walk.rows()).toEqual([]);
      expect(walk.marks().pending).toEqual([pointAt(AT)]);
      expect(warned.codes()).toEqual(['convert-row-unreadable']);
    });
  });

  describe('an amount', () => {
    it('a convert leg that rounds to zero writes neither leg', async () => {
      const walk = await walkOver([convertAt(AT, { fromAmount: '0.000000001' })]);

      expect(walk.rows()).toEqual([]);
      expect(walk.marks().pending).toEqual([]);
    });

    it.each([
      ['zero', '0', 'convert-amount-invalid'],
      ['negative', '-0.5', 'convert-amount-invalid'],
      ['empty', '', 'amount-malformed'],
      ['in an exponent form', '1e-3', 'amount-malformed'],
    ])('owes the point of a convert whose amount is %s', async (_, amount, code) => {
      const walk = await walkOver([convertAt(AT, { fromAmount: amount })]);

      expect(walk.rows()).toEqual([]);
      expect(walk.marks().pending).toEqual([pointAt(AT)]);
      expect(warned.codes()).toEqual([code]);
    });

    it('names a coin whose amount is past the safe integer, and owes the point', async () => {
      const walk = await walkOver([convertAt(AT, { fromAmount: '99999999999' })]);
      const patches = (walk.deps.patchExchangeState as jest.Mock).mock.calls.flatMap(
        ([, written]) => written as { kind: string; coins?: string; tickers?: string[] }[],
      );

      expect(walk.rows()).toEqual([]);
      expect(patches).toContainEqual(
        expect.objectContaining({ coins: 'oversizedCoins', tickers: ['BTC'] }),
      );
      expect(walk.marks().pending).toEqual([pointAt(AT)]);
    });
  });

  describe('the floor', () => {
    it('a convert older than the floor makes no row, no point and no entry', async () => {
      const walk = await walkOver([
        convertAt(FLOOR - 1, {}, 'old'),
        convertAt(FLOOR - 1, { exchangeStatus: 'init' }, 'old-waiting'),
        convertAt(FLOOR - 1, { accountType: 'unknown' }, 'old-refused'),
      ]);

      expect(walk.rows()).toEqual([]);
      expect(walk.marks().pending).toEqual([]);
      expect(walk.notImported()).toEqual([]);
    });

    it('a convert exactly on the floor imports', async () => {
      const walk = await walkOver([convertAt(FLOOR)]);

      expect(walk.rows().map((row) => row.time)).toEqual([FLOOR, FLOOR]);
    });
  });

  describe('a row the client could not read', () => {
    it('owes its own point when its time can be read', async () => {
      const walk = await walkOver([convertWithoutId(AT)]);

      expect(walk.rows()).toEqual([]);
      expect(walk.marks().pending).toEqual([pointAt(AT)]);
      expect(warned.codes()).toEqual(['convert-row-unreadable']);
    });

    it('owes the whole readable ground as one range when it has no time', async () => {
      const walk = await walkOver([{ ...convertWithoutId(AT), createdAt: 'x' }]);

      expect(walk.marks().pending).toEqual([{ start: FLOOR, end: NOW, series: 'convert' }]);
    });

    it('owes the ground of an item that is no row, and still imports the rows beside it', async () => {
      const walk = await walkOver([
        convertAt(AT),
        'not a row' as unknown as Record<string, unknown>,
      ]);

      expect(walk.rows()).toHaveLength(2);
      expect(walk.marks().pending).toEqual([{ start: FLOOR, end: NOW, series: 'convert' }]);
    });
  });

  describe('a stop that is no one convert', () => {
    it('owes the readable ground as one range when the holdings cannot be placed, and goes on', async () => {
      const walk = newWalk({ overrides: { ensureHoldings: async () => undefined } });
      walk.serve([[convertAt(AT)]]);

      const result = await walk.run();

      expect(walk.rows()).toEqual([]);
      expect(walk.marks().pending).toEqual([{ start: FLOOR, end: NOW, series: 'convert' }]);
      expect(result.complete).toBe(true);
      expect(warned.codes()).toContain('convert-holding-missing');
    });
  });

  describe('what a read keeps out', () => {
    it('a sentinel field reaches no row, mark or log', async () => {
      const walk = newWalk();
      walk.serve([[convertAt(AT), convertAt(AT + SECOND_MS, { exchangeStatus: 'init' })]]);

      await walk.run();

      expect(JSON.stringify(walk.rows())).not.toContain(NEVER_READ);
      expect(JSON.stringify((walk.deps.patchExchangeState as jest.Mock).mock.calls)).not.toContain(
        NEVER_READ,
      );
      expect(await walk.readState()).not.toContain(NEVER_READ);
      expect(JSON.stringify(warned.spy().mock.calls)).not.toContain(NEVER_READ);
    });

    it('reads nothing of a convert row that no part of the walk names', async () => {
      const walk = await walkOver([convertAt(AT)]);

      expect(JSON.stringify(walk.rows())).not.toContain('XXXXX');
      expect(await walk.readState()).not.toContain('broker-id');
    });
  });

  describe('the order of writes', () => {
    it('writes the rows of a page before the marks that move past it', async () => {
      const walk = await walkOver([convertAt(AT)]);

      expect(walk.calls[0]).toBe('add');
      expect(walk.calls.slice(1).every((call) => call === 'mark')).toBe(true);
    });
  });
});
