import {
  NEVER_READ,
  fundingLedgerRow,
  optionsOf,
  pageAnswer,
  withoutField,
} from './bybit.history-test-fixtures';
import { API_KEY, SECRET, answerWith, envelopeOf } from './bybit.client-test-fixtures';
import { BybitHistoryParseError, fetchFundingLedgerPage } from './bybit.history-client';

// 2025-03-23T11:09:23Z in seconds, the second of the fixture row.
const SECOND = 1_742_728_163;
const ROW_TIME = { start: SECOND * 1_000, end: SECOND * 1_000 + 999 };
const SPAN = { start: 1_741_000_000_500, end: 1_741_000_002_001 };
const FIRST_PAGE = { span: SPAN, cursor: undefined };

const itemsOf = async (...rows: unknown[]) => {
  const { fetchImpl } = pageAnswer('list', rows);

  return (await fetchFundingLedgerPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl))).rows;
};

describe('the Funding ledger request', () => {
  it('asks the route with GET, a span rounded out to whole seconds and a page of 100, and no other parameter', async () => {
    const { fetchImpl, sent } = pageAnswer('list', []);

    await fetchFundingLedgerPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl));

    const url = new URL(sent[0].url);

    expect(url.pathname).toBe('/v5/asset/fundinghistory');
    expect(sent[0].init.method).toBe('GET');
    expect(url.searchParams.get('createTimeFrom')).toBe('1741000000');
    expect(url.searchParams.get('createTimeTo')).toBe('1741000003');
    expect(url.searchParams.get('limit')).toBe('100');
    expect([...url.searchParams.keys()].sort()).toEqual([
      'createTimeFrom',
      'createTimeTo',
      'limit',
    ]);
  });

  it('sends a span that is whole seconds as it is, and the cursor it is given', async () => {
    const { fetchImpl, sent } = pageAnswer('list', []);

    await fetchFundingLedgerPage(
      API_KEY,
      SECRET,
      { span: { start: 1_741_000_000_000, end: 1_741_000_004_000 }, cursor: 'page-two' },
      optionsOf(fetchImpl),
    );

    const url = new URL(sent[0].url);

    expect(url.searchParams.get('createTimeFrom')).toBe('1741000000');
    expect(url.searchParams.get('createTimeTo')).toBe('1741000004');
    expect(url.searchParams.get('cursor')).toBe('page-two');
  });
});

describe('the envelope of a Funding ledger page', () => {
  it.each([
    ['a result with no list', {}],
    ['a result that holds only a rows list', { rows: [] }],
    ['a result that is no object', 'text'],
    ['a list that is no list', { list: 'text' }],
    ['a cursor that is no text', { list: [], nextPageCursor: 12 }],
  ])('fails on %s', async (_title, result) => {
    const { fetchImpl } = answerWith({ body: envelopeOf(0, result) });

    await expect(
      fetchFundingLedgerPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl)),
    ).rejects.toBeInstanceOf(BybitHistoryParseError);
  });

  it('gives the cursor as it came, and the end for an empty or an absent one', async () => {
    const cursors = await Promise.all(
      [{ list: [], nextPageCursor: 'abc%3A1' }, { list: [], nextPageCursor: '' }, { list: [] }].map(
        async (result) => {
          const { fetchImpl } = answerWith({ body: envelopeOf(0, result) });

          return (await fetchFundingLedgerPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl)))
            .nextPageCursor;
        },
      ),
    );

    expect(cursors).toEqual(['abc%3A1', '', undefined]);
  });
});

describe('a Funding ledger row', () => {
  it('reads the named fields of the page sample, with its time as the whole second', async () => {
    const [item] = await itemsOf(fundingLedgerRow());

    expect(item).toStrictEqual({
      kind: 'row',
      times: [ROW_TIME.start, ROW_TIME.end],
      row: {
        currcCursor: 'ledger-1',
        currency: 'USDT',
        direction: 'I',
        amount: '100',
        earnPrincipal: false,
        time: ROW_TIME,
      },
    });
  });

  it('gives no value of memberId, afterAmt, descriptionEn or showBusiTypeEn, and no word', async () => {
    const [item] = await itemsOf(fundingLedgerRow());
    const text = JSON.stringify(item);

    expect(text).not.toContain(NEVER_READ);
    expect(text).not.toContain('fundingAccountRecord');
    expect(Object.keys(item.kind === 'row' ? item.row : {}).sort()).toEqual([
      'amount',
      'currcCursor',
      'currency',
      'direction',
      'earnPrincipal',
      'time',
    ]);
  });

  it.each([
    ['the Earn word with a description that is no interest', 'fundingAccountRecordEarn', 'x', true],
    [
      'the Earn word with the interest description',
      'fundingAccountRecordEarn',
      'fundingAccountRecordFlexSavingInterestDistribution',
      false,
    ],
    ['a word the list does not hold', 'fundingAccountRecordOther', 'x', false],
  ])('sets earnPrincipal from %s', async (_title, showBusiType, description, expected) => {
    const [item] = await itemsOf(fundingLedgerRow({ showBusiType, description }));

    expect(item).toMatchObject({ row: { earnPrincipal: expected } });
  });

  it.each([
    ['an absent word', withoutField(fundingLedgerRow(), 'showBusiType')],
    ['a word that is no text', fundingLedgerRow({ showBusiType: 5 })],
  ])('reads %s as no Earn principal, and stays readable', async (_title, row) => {
    const [item] = await itemsOf(row);

    expect(item).toMatchObject({ kind: 'row', row: { earnPrincipal: false } });
  });

  it.each([
    ['a text', 'ledger-1', 'ledger-1'],
    ['a whole number', 4_021, '4021'],
    ['an empty text', '', undefined],
    ['null', null, undefined],
    ['a number past the safe integers', 1e30, undefined],
  ])('reads a currcCursor that is %s as the key %s', async (_title, currcCursor, expected) => {
    const [item] = await itemsOf(fundingLedgerRow({ currcCursor }));

    expect(item).toMatchObject({ kind: 'row', row: { currcCursor: expected } });
  });

  it('reads a row with no currcCursor field as a row with no key', async () => {
    const [item] = await itemsOf(withoutField(fundingLedgerRow(), 'currcCursor'));

    expect(item).toMatchObject({ kind: 'row', row: { currcCursor: undefined } });
  });

  it.each([
    ['I', 'I'],
    ['O', 'O'],
  ])('reads ioDirection %s as that direction', async (ioDirection, direction) => {
    const [item] = await itemsOf(fundingLedgerRow({ ioDirection }));

    expect(item).toMatchObject({ row: { direction } });
  });

  it.each([
    ['an ioDirection outside I and O', fundingLedgerRow({ ioDirection: 'X' })],
    ['a lower case ioDirection', fundingLedgerRow({ ioDirection: 'i' })],
    ['an absent ioDirection', withoutField(fundingLedgerRow(), 'ioDirection')],
    ['an absent currency', withoutField(fundingLedgerRow(), 'currency')],
    ['an empty currency', fundingLedgerRow({ currency: '' })],
    ['a txnAmt that is no text', fundingLedgerRow({ txnAmt: 100 })],
    ['an absent txnAmt', withoutField(fundingLedgerRow(), 'txnAmt')],
  ])('is unreadable, with its time, and no error, with %s', async (_title, row) => {
    const items = await itemsOf(
      fundingLedgerRow({ currcCursor: 'before' }),
      row,
      fundingLedgerRow({ currcCursor: 'after' }),
    );

    expect(items.map((item) => item.kind)).toEqual(['row', 'unreadable', 'row']);
    expect(items[1]).toStrictEqual({
      kind: 'unreadable',
      times: [ROW_TIME.start, ROW_TIME.end],
      time: ROW_TIME,
    });
  });

  it('keeps the text of a txnAmt as it came, for the walk to judge: a signed or zero amount is a row here', async () => {
    const items = await itemsOf(
      fundingLedgerRow({ txnAmt: '-100' }),
      fundingLedgerRow({ txnAmt: '0' }),
      fundingLedgerRow({ txnAmt: 'abc' }),
    );

    expect(items.map((item) => (item.kind === 'row' ? item.row.amount : item.kind))).toEqual([
      '-100',
      '0',
      'abc',
    ]);
  });

  it('reads 10 digits of createTime as the whole second and 13 as milliseconds', async () => {
    const [seconds, milliseconds] = await itemsOf(
      fundingLedgerRow({ createTime: '1742728163' }),
      fundingLedgerRow({ createTime: '1742728163456' }),
    );

    expect(seconds).toMatchObject({ row: { time: ROW_TIME } });
    expect(milliseconds).toMatchObject({
      times: [1_742_728_163_456],
      row: { time: { start: 1_742_728_163_456, end: 1_742_728_163_456 } },
    });
  });

  it.each([
    ['an empty text', ''],
    ['zero', '0'],
  ])('reads a createTime that is %s as a row with no time', async (_title, createTime) => {
    const [item] = await itemsOf(fundingLedgerRow({ createTime }));

    expect(item).toMatchObject({ kind: 'row', times: [], row: { time: undefined } });
  });

  it('makes a row whose createTime has another digit count unreadable, with no time', async () => {
    const [item] = await itemsOf(fundingLedgerRow({ createTime: '17427281' }));

    expect(item).toStrictEqual({ kind: 'unreadable', times: [], time: undefined });
  });

  it('counts a coin the app does not track and reads nothing else of it', async () => {
    const [item] = await itemsOf(fundingLedgerRow({ currency: 'PEPEXYZ', txnAmt: 'abc' }));

    expect(item).toStrictEqual({
      kind: 'untracked',
      times: [ROW_TIME.start, ROW_TIME.end],
      ticker: 'PEPEXYZ',
      status: undefined,
      time: ROW_TIME,
    });
  });

  it.each([
    ['null', null],
    ['a number', 5],
    ['a list', []],
  ])('reads an item that is %s as unreadable, with no time', async (_title, item) => {
    const [read, next] = await itemsOf(item, fundingLedgerRow());

    expect(read).toStrictEqual({ kind: 'unreadable', times: [], time: undefined });
    expect(next).toMatchObject({ kind: 'row' });
  });
});
