import { AMOUNT_STOP_CODES, BinanceWalkStop } from '@kiko/crypto-sync/exchange/walk';

import type { BinanceConvertRecord } from './binance.history-client';
import { CONVERT_FORWARD_OWES, convertOutcomeOf } from './binance.convert-history';
import { CONVERT_CREATED_AT, convertRecordOf } from './binance.convert-test-fixtures';

const ACCOUNT = 'acc-1';
const PAIR = `${ACCOUNT}:convert:order-1`;
const UAH_OUT = -100_000;
const REFUSED = {
  kind: 'refused',
  entry: `convert-unrecognized:order-1:${CONVERT_CREATED_AT}`,
};

const outcomeOf = (over: Partial<BinanceConvertRecord> = {}) =>
  convertOutcomeOf({ accountId: ACCOUNT, record: convertRecordOf(over) });

const rowsOf = (over: Partial<BinanceConvertRecord> = {}) => {
  const outcome = outcomeOf(over);

  if (outcome.kind !== 'rows') {
    throw new Error(`expected rows, got ${outcome.kind}`);
  }

  return outcome;
};

const stopOf = (over: Partial<BinanceConvertRecord> = {}): BinanceWalkStop | undefined => {
  try {
    outcomeOf(over);
  } catch (error) {
    return error instanceof BinanceWalkStop ? error : undefined;
  }

  return undefined;
};

const codeOf = (over: Partial<BinanceConvertRecord> = {}): string | undefined => stopOf(over)?.code;

describe('convertOutcomeOf', () => {
  it('maps a settled Funding conversion into two legs on Funding, each naming the other holding', () => {
    expect(rowsOf()).toEqual({
      kind: 'rows',
      untracked: [],
      rows: [
        {
          wallet: 'UAH:funding',
          counterpartWallet: 'USDT:funding',
          amountMinorUnits: UAH_OUT,
          time: CONVERT_CREATED_AT,
          externalId: `${PAIR}:UAH:funding`,
          exchangePairId: PAIR,
          description: '',
          operation: 'convert',
        },
        {
          wallet: 'USDT:funding',
          counterpartWallet: 'UAH:funding',
          amountMinorUnits: 2_410_000_000,
          time: CONVERT_CREATED_AT,
          externalId: `${PAIR}:USDT:funding`,
          exchangePairId: PAIR,
          description: '',
          operation: 'convert',
        },
      ],
    });
  });

  it('maps a settled Spot conversion into two legs on Spot, keyed by the bare coin', () => {
    const { rows } = rowsOf({ walletType: 'SPOT' });

    expect(
      rows.map(({ wallet, counterpartWallet, externalId }) => [
        wallet,
        counterpartWallet,
        externalId,
      ]),
    ).toEqual([
      ['UAH', 'USDT', `${PAIR}:UAH`],
      ['USDT', 'UAH', `${PAIR}:USDT`],
    ]);
  });

  it('gives both legs the pair id of the account and the record id, and operation convert', () => {
    const { rows } = rowsOf({ recordId: 'q-77' });

    expect(rows.map(({ exchangePairId }) => exchangePairId)).toEqual([
      `${ACCOUNT}:convert:q-77`,
      `${ACCOUNT}:convert:q-77`,
    ]);
    expect(rows.map(({ operation }) => operation)).toEqual(['convert', 'convert']);
  });

  it('keys the legs of two accounts apart for one record', () => {
    const other = convertOutcomeOf({ accountId: 'acc-2', record: convertRecordOf() });

    expect(other).toMatchObject({
      rows: [{ externalId: 'acc-2:convert:order-1:UAH:funding' }, {}],
    });
  });

  it.each(['PROCESS', 'ACCEPT_SUCCESS'])(
    'owes the point of a %s conversion whatever its wallet, and reads nothing else',
    (orderStatus) => {
      expect(codeOf({ orderStatus })).toBe('convert-not-settled');
      expect(codeOf({ orderStatus, walletType: 'MAIN' })).toBe('convert-not-settled');
      expect(
        codeOf({
          orderStatus,
          walletType: undefined,
          fromAsset: undefined,
          toAsset: '',
          fromAmount: undefined,
        }),
      ).toBe('convert-not-settled');
    },
  );

  it.each([undefined, '', 'SPOT_FUNDING', 'MAIN', 'funding'])(
    'refuses a settled conversion whose wallet is %p into one entry, with no leg',
    (walletType) => {
      expect(outcomeOf({ walletType })).toEqual(REFUSED);
    },
  );

  it.each([['EXPIRED'], [''], [undefined], ['success']])(
    'refuses a conversion whose status is %p into one entry without reading its wallet or coins',
    (orderStatus) => {
      expect(
        outcomeOf({
          orderStatus,
          walletType: undefined,
          fromAsset: undefined,
          toAsset: undefined,
          fromAmount: undefined,
          toAmount: undefined,
        }),
      ).toEqual(REFUSED);
    },
  );

  it.each([['FUNDING'], ['MAIN'], [undefined], ['SPOT']])(
    'gives a FAIL conversion with wallet %p no row and no entry',
    (walletType) => {
      expect(outcomeOf({ orderStatus: 'FAIL', walletType, fromAsset: undefined })).toEqual({
        kind: 'none',
      });
    },
  );

  it('names the refused record by kind, record id and time', () => {
    expect(outcomeOf({ recordId: 'q-9', createTime: 1_234, orderStatus: 'EXPIRED' })).toEqual({
      kind: 'refused',
      entry: 'convert-unrecognized:q-9:1234',
    });
  });

  it('keeps the tracked leg alone when the other coin is not tracked, marking it with that coin', () => {
    expect(
      rowsOf({ fromAsset: 'USDT', fromAmount: '50', toAsset: 'PEPE', toAmount: 'oops' }),
    ).toEqual({
      kind: 'rows',
      untracked: ['PEPE'],
      rows: [
        {
          wallet: 'USDT:funding',
          amountMinorUnits: -5_000_000_000,
          time: CONVERT_CREATED_AT,
          externalId: `${PAIR}:USDT:funding`,
          untrackedCounterpart: 'asset:PEPE',
          description: '',
          operation: 'convert',
        },
      ],
    });
  });

  it('gives a lone received leg a positive amount and no pair id', () => {
    const { rows, untracked } = rowsOf({
      fromAsset: 'PEPE',
      fromAmount: 'oops',
      toAsset: 'USDT',
      toAmount: '1',
    });

    expect(untracked).toEqual(['PEPE']);
    expect(rows).toEqual([
      expect.objectContaining({
        wallet: 'USDT:funding',
        amountMinorUnits: 100_000_000,
        untrackedCounterpart: 'asset:PEPE',
        operation: 'convert',
      }),
    ]);
    expect(rows[0]).not.toHaveProperty('exchangePairId');
    expect(rows[0]).not.toHaveProperty('counterpartWallet');
  });

  it('puts a lone leg on the Spot holding for a Spot conversion', () => {
    expect(rowsOf({ walletType: 'SPOT', toAsset: 'PEPE', toAmount: '1' }).rows).toMatchObject([
      { wallet: 'UAH', externalId: `${PAIR}:UAH` },
    ]);
  });

  it('lists both coins and writes no row when neither side is tracked', () => {
    expect(rowsOf({ fromAsset: 'PEPE', toAsset: 'SHIB', fromAmount: 'x', toAmount: '-' })).toEqual({
      kind: 'rows',
      rows: [],
      untracked: ['PEPE', 'SHIB'],
    });
  });

  it.each([
    ['a tracked coin', 'USDT'],
    ['a coin that is not tracked', 'PEPE'],
  ])('refuses a settled conversion of %s into itself into one entry', (_name, asset) => {
    expect(outcomeOf({ fromAsset: asset, toAsset: asset })).toEqual(REFUSED);
  });

  it('does not refuse a conversion of a coin into itself that is not settled', () => {
    expect(codeOf({ orderStatus: 'PROCESS', fromAsset: 'USDT', toAsset: 'USDT' })).toBe(
      'convert-not-settled',
    );
    expect(outcomeOf({ orderStatus: 'FAIL', fromAsset: 'USDT', toAsset: 'USDT' })).toEqual({
      kind: 'none',
    });
  });

  it('refuses the unrecognized wallet before it looks at the coins', () => {
    expect(outcomeOf({ walletType: 'MAIN', fromAsset: undefined, toAsset: undefined })).toEqual(
      REFUSED,
    );
  });

  it.each([
    ['a missing from coin', { fromAsset: undefined }],
    ['a blank from coin', { fromAsset: '' }],
    ['a missing to coin', { toAsset: undefined }],
    ['a blank to coin', { toAsset: '' }],
    ['two blank coins', { fromAsset: '', toAsset: '' }],
  ])('owes the point of a settled conversion with %s: it is unreadable', (_name, over) => {
    expect(codeOf(over)).toBe('convert-row-unreadable');
  });

  it('owes the point of a lone leg whose other coin has no usable code', () => {
    expect(codeOf({ toAsset: 'A:B' })).toBe('convert-row-unreadable');
  });

  it('lists a coin with no usable code when neither side is tracked', () => {
    expect(rowsOf({ fromAsset: 'A:B', toAsset: 'PEPE' })).toEqual({
      kind: 'rows',
      rows: [],
      untracked: ['A:B', 'PEPE'],
    });
  });

  it.each([
    ['absent from amount', { fromAmount: undefined }, 'convert-row-unreadable'],
    ['absent to amount', { toAmount: undefined }, 'convert-row-unreadable'],
    ['zero', { fromAmount: '0' }, 'convert-amount-invalid'],
    ['zero with decimals', { toAmount: '0.00000000' }, 'convert-amount-invalid'],
    ['negative', { fromAmount: '-1' }, 'convert-amount-invalid'],
    ['in exponent form', { fromAmount: '1e-3' }, 'amount-malformed'],
    ['over-precise for UAH', { fromAmount: '1.005' }, 'amount-precision'],
    ['blank', { toAmount: '' }, 'amount-malformed'],
  ])(
    'owes the point of a settled conversion with a tracked side whose amount is %s',
    (_name, over, code) => {
      expect(codeOf(over)).toBe(code);
    },
  );

  it('names the coin of an amount past the safe integer, so the walk lists it as oversized', () => {
    expect(stopOf({ toAmount: '90071992.54740992' })).toMatchObject({
      code: 'amount-too-large',
      oversizedTicker: 'USDT',
    });
  });

  it('reads the amount of a tracked side only, so an untracked side may be unreadable', () => {
    expect(rowsOf({ toAsset: 'PEPE', toAmount: undefined }).rows).toHaveLength(1);
    expect(codeOf({ toAsset: 'PEPE', fromAmount: undefined })).toBe('convert-row-unreadable');
  });

  it('owes the point of every stop it throws and goes past it in the forward pass', () => {
    expect(CONVERT_FORWARD_OWES).toEqual([
      'convert-not-settled',
      'convert-row-unreadable',
      'convert-amount-invalid',
      ...AMOUNT_STOP_CODES,
    ]);
  });
});
