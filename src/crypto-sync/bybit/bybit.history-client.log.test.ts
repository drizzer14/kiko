import {
  NEVER_READ,
  SPAN,
  LOG_PAGE_SAMPLE,
  SPOT_TRADE_ID,
  optionsOf,
  pageAnswer,
  spotLogRow,
  withoutField,
} from './bybit.history-test-fixtures';
import { BybitHistoryParseError, fetchLogPage } from './bybit.history-client';
import { API_KEY, SECRET, answerWith, envelopeOf } from './bybit.client-test-fixtures';

const MS = 1_672_121_182_224;
const FIRST_PAGE = { span: SPAN, cursor: undefined };

const logItemsOf = async (...rows: unknown[]) => {
  const { fetchImpl } = pageAnswer('list', rows);

  return (await fetchLogPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl))).rows;
};

describe('the log request', () => {
  it('asks the log route with GET, the Unified account, the span and a page of 50, and no category, no type and no currency', async () => {
    const { fetchImpl, sent } = pageAnswer('list', []);

    await fetchLogPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl));

    const url = new URL(sent[0].url);

    expect(url.pathname).toBe('/v5/account/transaction-log');
    expect(sent[0].init.method).toBe('GET');
    expect(url.searchParams.get('accountType')).toBe('UNIFIED');
    expect(url.searchParams.get('startTime')).toBe(String(SPAN.start));
    expect(url.searchParams.get('endTime')).toBe(String(SPAN.end));
    expect(url.searchParams.get('limit')).toBe('50');
    expect([...url.searchParams.keys()].sort()).toEqual([
      'accountType',
      'endTime',
      'limit',
      'startTime',
    ]);
  });

  it('sends the cursor it is given', async () => {
    const { fetchImpl, sent } = pageAnswer('list', []);

    await fetchLogPage(API_KEY, SECRET, { span: SPAN, cursor: 'page-two' }, optionsOf(fetchImpl));

    expect(new URL(sent[0].url).searchParams.get('cursor')).toBe('page-two');
  });
});

describe('the envelope of a log page', () => {
  it.each([
    ['a result with no list', {}],
    ['a result that holds only a rows list', { rows: [] }],
    ['a result that is no object', 'text'],
    ['a result that is null', null],
    ['a list that is no list', { list: 'text' }],
    ['a list that is an object', { list: {} }],
    ['a cursor that is no text', { list: [], nextPageCursor: 12 }],
  ])('fails on %s', async (_title, result) => {
    const { fetchImpl } = answerWith({ body: envelopeOf(0, result) });

    await expect(
      fetchLogPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl)),
    ).rejects.toBeInstanceOf(BybitHistoryParseError);
  });

  it('gives the cursor of the page as it came, and the end for an empty or an absent one', async () => {
    const cursors = await Promise.all(
      [
        { list: [], nextPageCursor: '21963%3A1%2C14954%3A1' },
        { list: [], nextPageCursor: '' },
        { list: [] },
      ].map(async (result) => {
        const { fetchImpl } = answerWith({ body: envelopeOf(0, result) });

        return (await fetchLogPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl)))
          .nextPageCursor;
      }),
    );

    expect(cursors).toEqual(['21963%3A1%2C14954%3A1', '', undefined]);
  });
});

describe('the sample rows of the log page', () => {
  it('reads a SETTLEMENT and two linear TRADE rows as derivatives, with their time and no field', async () => {
    const items = await logItemsOf(...LOG_PAGE_SAMPLE);

    expect(items).toStrictEqual([
      {
        kind: 'row',
        times: [1_672_128_000_000],
        row: { logKind: 'derivatives', time: { start: 1_672_128_000_000, end: 1_672_128_000_000 } },
      },
      { kind: 'row', times: [MS], row: { logKind: 'derivatives', time: { start: MS, end: MS } } },
      { kind: 'row', times: [MS], row: { logKind: 'derivatives', time: { start: MS, end: MS } } },
    ]);
  });
});

describe('a spot TRADE row', () => {
  it('reads the fields of the log table and no other', async () => {
    const [item] = await logItemsOf(spotLogRow());

    expect(item).toStrictEqual({
      kind: 'row',
      times: [MS],
      row: {
        logKind: 'spotTrade',
        id: '592324_XRPUSDT_161440249321',
        symbol: 'BTCUSDT',
        currency: 'BTC',
        qty: '0.003',
        fee: '0.000003',
        change: '0.002997',
        orderId: '592b7e41-78fd-42e2-9aa3-91e1835ef3e1',
        hasTradeId: true,
        time: { start: MS, end: MS },
      },
    });
  });

  it('gives a parsed object with no value of userId, orderLinkId, extInfo or tradeId', async () => {
    const [item] = await logItemsOf(spotLogRow({ side: NEVER_READ, cashFlow: NEVER_READ }));
    const text = JSON.stringify(item);

    expect(text).not.toContain(NEVER_READ);
    expect(text).not.toContain(SPOT_TRADE_ID);
    expect(Object.keys(item.kind === 'row' ? item.row : {}).sort()).toEqual([
      'change',
      'currency',
      'fee',
      'hasTradeId',
      'id',
      'logKind',
      'orderId',
      'qty',
      'symbol',
      'time',
    ]);
  });

  it.each([
    ['a text', SPOT_TRADE_ID, true],
    ['a whole number', 5_184_079, true],
    ['an empty text', '', false],
    ['null', null, false],
    ['a value of no known shape', { id: 1 }, false],
  ])('keeps of a tradeId that is %s only whether it names one', async (_title, tradeId, has) => {
    const [item] = await logItemsOf(spotLogRow({ tradeId }));

    expect(item).toMatchObject({ row: { hasTradeId: has } });
  });

  it('keeps no tradeId of a row that has none', async () => {
    const [item] = await logItemsOf(withoutField(spotLogRow(), 'tradeId'));

    expect(item).toMatchObject({ kind: 'row', row: { hasTradeId: false } });
  });

  it('reads an empty fee as the empty text the page sends, for the walk to count as zero', async () => {
    const [item] = await logItemsOf(spotLogRow({ fee: '' }));

    expect(item).toMatchObject({ row: { fee: '' } });
  });

  it.each([
    ['an absent id', withoutField(spotLogRow(), 'id')],
    ['an empty id', spotLogRow({ id: '' })],
    ['an absent symbol', withoutField(spotLogRow(), 'symbol')],
    ['an empty symbol', spotLogRow({ symbol: '' })],
    ['an absent currency', withoutField(spotLogRow(), 'currency')],
    ['an empty currency', spotLogRow({ currency: '' })],
    ['a qty that is no text', spotLogRow({ qty: 0.003 })],
    ['an absent qty', withoutField(spotLogRow(), 'qty')],
    ['an absent fee', withoutField(spotLogRow(), 'fee')],
    ['a fee that is no text', spotLogRow({ fee: 0 })],
    ['a change that is no text', spotLogRow({ change: 0.002997 })],
    ['an absent change', withoutField(spotLogRow(), 'change')],
    ['an absent orderId', withoutField(spotLogRow(), 'orderId')],
    ['an empty orderId', spotLogRow({ orderId: '' })],
  ])('is unreadable, with its time, and no error, with %s', async (_title, row) => {
    const items = await logItemsOf(spotLogRow({ id: 'before' }), row, spotLogRow({ id: 'after' }));

    expect(items.map((item) => item.kind)).toEqual(['row', 'unreadable', 'row']);
    expect(items[1]).toStrictEqual({
      kind: 'unreadable',
      times: [MS],
      time: { start: MS, end: MS },
    });
  });

  it.each([
    ['null', null],
    ['a number', 5],
    ['a list', []],
  ])('reads an item that is %s as unreadable, with no time', async (_title, item) => {
    const [read, next] = await logItemsOf(item, spotLogRow());

    expect(read).toStrictEqual({ kind: 'unreadable', times: [], time: undefined });
    expect(next).toMatchObject({ kind: 'row' });
  });

  it('reads 13 digits of transactionTime as milliseconds and 10 as the whole second', async () => {
    const [milliseconds, seconds] = await logItemsOf(
      spotLogRow({ transactionTime: '1672121182224' }),
      spotLogRow({ transactionTime: '1672121182' }),
    );

    expect(milliseconds).toMatchObject({
      times: [1_672_121_182_224],
      row: { time: { start: 1_672_121_182_224, end: 1_672_121_182_224 } },
    });
    expect(seconds).toMatchObject({
      times: [1_672_121_182_000, 1_672_121_182_999],
      row: { time: { start: 1_672_121_182_000, end: 1_672_121_182_999 } },
    });
  });

  it.each([
    ['an empty text', ''],
    ['zero', '0'],
  ])('reads a transactionTime that is %s as a row with no time yet', async (_title, time) => {
    const [item] = await logItemsOf(spotLogRow({ transactionTime: time }));

    expect(item).toMatchObject({ kind: 'row', times: [], row: { time: undefined } });
  });

  it('makes a row whose transactionTime has another digit count unreadable, with no time', async () => {
    const [item] = await logItemsOf(spotLogRow({ transactionTime: '167212118' }));

    expect(item).toStrictEqual({ kind: 'unreadable', times: [], time: undefined });
  });
});

describe('an untracked coin of a spot trade', () => {
  it('counts a spot trade of an untracked currency without parsing it', async () => {
    const [item] = await logItemsOf(spotLogRow({ currency: 'PEPE', symbol: 'PEPEUSDT', qty: 5 }));

    expect(item).toStrictEqual({
      kind: 'untracked',
      times: [MS],
      ticker: 'PEPE',
      status: undefined,
      time: { start: MS, end: MS },
    });
  });

  it('reads a row of a tracked currency whose other coin is untracked as a spot trade', async () => {
    const [item] = await logItemsOf(spotLogRow({ symbol: 'BTCPEPE' }));

    expect(item).toMatchObject({ kind: 'row', row: { logKind: 'spotTrade', symbol: 'BTCPEPE' } });
  });

  it('never counts the currency of an entry that is no spot trade', async () => {
    const [item] = await logItemsOf({ ...LOG_PAGE_SAMPLE[0], currency: 'PEPE' });

    expect(item).toMatchObject({ kind: 'row', row: { logKind: 'derivatives' } });
  });
});

describe('an entry that is no spot trade', () => {
  it.each([
    ['SETTLEMENT', 'linear', 'derivatives'],
    ['TRADE', 'option', 'derivatives'],
    ['TRANSFER_IN', undefined, 'coveredElsewhere'],
    ['CURRENCY_BUY', 'spot', 'convertEntries'],
    ['INTEREST', undefined, 'interestAndLoans'],
    ['AIRDROP', undefined, 'bonuses'],
    ['FLEXIBLE_STAKING_SUBSCRIPTION', undefined, 'earn'],
    ['STOCK_TRADE_BUY', 'spot', 'stocks'],
    ['CUSTODY_LOCK', undefined, 'custody'],
    ['A_WORD_OF_TOMORROW', 'spot', 'other'],
    ['TRADE', undefined, 'other'],
  ])(
    'reads %s with the category %s as the kind %s and its time, and no field',
    async (type, category, logKind) => {
      const [item] = await logItemsOf({
        type,
        category,
        currency: 'USDT',
        change: NEVER_READ,
        qty: 5,
        transactionTime: String(MS),
      });

      expect(item).toStrictEqual({
        kind: 'row',
        times: [MS],
        row: { logKind, time: { start: MS, end: MS } },
      });
    },
  );

  it('reads an entry with no type as the kind other, and never as unreadable', async () => {
    const [item] = await logItemsOf({ transactionTime: String(MS) });

    expect(item).toMatchObject({ kind: 'row', row: { logKind: 'other' } });
  });

  it('reads an entry whose time cannot be read, with no time, because it is never imported', async () => {
    const [item] = await logItemsOf({ ...LOG_PAGE_SAMPLE[0], transactionTime: '123' });

    expect(item).toStrictEqual({
      kind: 'row',
      times: [],
      row: { logKind: 'derivatives', time: undefined },
    });
  });
});
