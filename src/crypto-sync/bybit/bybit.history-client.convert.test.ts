import {
  NEVER_READ,
  CONVERT_PAGE_SAMPLE,
  convertRow,
  optionsOf,
  pageAnswer,
  withoutField,
} from './bybit.history-test-fixtures';
import { BybitHistoryParseError, fetchConvertPage } from './bybit.history-client';
import { API_KEY, SECRET, answerWith, envelopeOf } from './bybit.client-test-fixtures';

const MS = 1_719_974_243_256;

const convertItemsOf = async (...rows: unknown[]) => {
  const { fetchImpl } = pageAnswer('list', rows);

  return (await fetchConvertPage(API_KEY, SECRET, { index: 1 }, optionsOf(fetchImpl))).rows;
};

describe('the convert request', () => {
  it('asks the convert route with GET, the index and a page of 100, and no wallet type and no time', async () => {
    const { fetchImpl, sent } = pageAnswer('list', []);

    await fetchConvertPage(API_KEY, SECRET, { index: 3 }, optionsOf(fetchImpl));

    const url = new URL(sent[0].url);

    expect(url.pathname).toBe('/v5/asset/exchange/query-convert-history');
    expect(sent[0].init.method).toBe('GET');
    expect(url.searchParams.get('index')).toBe('3');
    expect(url.searchParams.get('limit')).toBe('100');
    expect([...url.searchParams.keys()].sort()).toEqual(['index', 'limit']);
  });
});

describe('the envelope of a convert page', () => {
  it.each([
    ['a result with no list', {}],
    ['a result that holds only a rows list', { rows: [] }],
    ['a result that is no object', 'text'],
    ['a result that is null', null],
    ['a list that is no list', { list: 'text' }],
    ['a list that is an object', { list: {} }],
  ])('fails on %s', async (_title, result) => {
    const { fetchImpl } = answerWith({ body: envelopeOf(0, result) });

    await expect(
      fetchConvertPage(API_KEY, SECRET, { index: 1 }, optionsOf(fetchImpl)),
    ).rejects.toBeInstanceOf(BybitHistoryParseError);
  });

  it('gives an empty page as no row', async () => {
    expect(await convertItemsOf()).toEqual([]);
  });
});

describe('a convert row', () => {
  it('reads the two sample rows of the page, with the fields of the convert table and no other', async () => {
    const items = await convertItemsOf(...CONVERT_PAGE_SAMPLE);

    expect(items).toStrictEqual([
      {
        kind: 'row',
        row: {
          accountType: 'eb_convert_funding',
          exchangeTransactionId: '10100108106409343501030232064',
          fromCoin: 'ETH',
          toCoin: 'BTC',
          fromAmount: '0.1',
          toAmount: '0.00534882723991',
          exchangeStatus: 'success',
          time: { start: 1_720_071_899_995, end: 1_720_071_899_995 },
        },
      },
      {
        kind: 'row',
        row: {
          accountType: 'eb_convert_uta',
          exchangeTransactionId: '23070eb_convert_uta408933875189391360',
          fromCoin: 'BTC',
          toCoin: 'ETH',
          fromAmount: '0.1',
          toAmount: '1.773938248611074',
          exchangeStatus: 'success',
          time: { start: MS, end: MS },
        },
      },
    ]);
  });

  it('gives a parsed object with no value of userId, extInfo, convertRate or a coin type', async () => {
    const [item] = await convertItemsOf(convertRow());

    expect(JSON.stringify(item)).not.toContain(NEVER_READ);
    expect(JSON.stringify(item)).not.toContain('XXXXX');
    expect(Object.keys(item.kind === 'row' ? item.row : {}).sort()).toEqual([
      'accountType',
      'exchangeStatus',
      'exchangeTransactionId',
      'fromAmount',
      'fromCoin',
      'time',
      'toAmount',
      'toCoin',
    ]);
  });

  it('keeps a wallet word and a status word the page does not list, as the text it came as', async () => {
    const [item] = await convertItemsOf(
      convertRow({ accountType: 'funding_new', exchangeStatus: 'refunded' }),
    );

    expect(item).toMatchObject({
      row: { accountType: 'funding_new', exchangeStatus: 'refunded' },
    });
  });

  it('reads an id that is a whole number as the text of its digits', async () => {
    const [item] = await convertItemsOf(convertRow({ exchangeTxId: 2_307_040_893 }));

    expect(item).toMatchObject({ row: { exchangeTransactionId: '2307040893' } });
  });

  it.each([
    ['an absent id', withoutField(convertRow(), 'exchangeTxId')],
    ['an empty id', convertRow({ exchangeTxId: '' })],
    ['an absent wallet word', withoutField(convertRow(), 'accountType')],
    ['a wallet word that is no text', convertRow({ accountType: 4 })],
    ['an absent from coin', withoutField(convertRow(), 'fromCoin')],
    ['an empty from coin', convertRow({ fromCoin: '' })],
    ['an absent to coin', withoutField(convertRow(), 'toCoin')],
    ['an empty to coin', convertRow({ toCoin: '' })],
    ['an amount that is no text', convertRow({ fromAmount: 0.1 })],
    ['an absent to amount', withoutField(convertRow(), 'toAmount')],
    ['an absent status', withoutField(convertRow(), 'exchangeStatus')],
    ['a status that is no text', convertRow({ exchangeStatus: 1 })],
  ])('is unreadable, with its time, and no error, with %s', async (_title, row) => {
    const items = await convertItemsOf(convertRow(), row, convertRow());

    expect(items.map((item) => item.kind)).toEqual(['row', 'unreadable', 'row']);
    expect(items[1]).toStrictEqual({ kind: 'unreadable', time: { start: MS, end: MS } });
  });

  it.each([
    ['null', null],
    ['a number', 5],
    ['a list', []],
  ])('reads an item that is %s as unreadable, with no time', async (_title, item) => {
    const [read, next] = await convertItemsOf(item, convertRow());

    expect(read).toStrictEqual({ kind: 'unreadable', time: undefined });
    expect(next).toMatchObject({ kind: 'row' });
  });

  it('reads 13 digits of createdAt as milliseconds and 10 as the whole second', async () => {
    const [milliseconds, seconds] = await convertItemsOf(
      convertRow({ createdAt: '1719974243256' }),
      convertRow({ createdAt: '1719974243' }),
    );

    expect(milliseconds).toMatchObject({ row: { time: { start: MS, end: MS } } });
    expect(seconds).toMatchObject({
      row: { time: { start: 1_719_974_243_000, end: 1_719_974_243_999 } },
    });
  });

  it.each([
    ['an empty text', convertRow({ createdAt: '' })],
    ['zero', convertRow({ createdAt: '0' })],
    ['a time of another digit count', convertRow({ createdAt: '171997424' })],
    ['a time that is no number', convertRow({ createdAt: 'yesterday' })],
    ['an absent time', withoutField(convertRow(), 'createdAt')],
  ])('reads a row with %s as a row with no time, never as unreadable', async (_title, row) => {
    const [item] = await convertItemsOf(row);

    expect(item).toMatchObject({ kind: 'row', row: { time: undefined } });
  });
});
