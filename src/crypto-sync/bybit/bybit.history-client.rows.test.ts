import { DAY_MS } from '@kiko/dates';
import type { WalkWindow } from '@kiko/crypto-sync/exchange/walk';

import {
  SPAN,
  depositRow,
  optionsOf,
  pageAnswer,
  transferRow,
  withdrawalRow,
} from './bybit.history-test-fixtures';
import { readCursorSpan } from './bybit.cursor-span';
import { API_KEY, SECRET } from './bybit.client-test-fixtures';
import { createBybitHistoryRun } from './bybit.history-budget';
import { fetchDepositPage, fetchTransferPage, fetchWithdrawalPage } from './bybit.history-client';

const MS = 1_742_728_163_000;
const SECOND = 1_742_728_163;
const FIRST_PAGE = { span: SPAN, cursor: undefined };

const depositsOf = async (...rows: unknown[]) => {
  const { fetchImpl } = pageAnswer('rows', rows);

  return (await fetchDepositPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl))).rows;
};

const withdrawalsOf = async (...rows: unknown[]) => {
  const { fetchImpl } = pageAnswer('rows', rows);

  return (await fetchWithdrawalPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl))).rows;
};

describe('the tracked coin rule', () => {
  it('parses a row of a tracked coin and counts a row of an untracked coin without parsing it', async () => {
    const [tracked, untracked] = await depositsOf(
      depositRow(),
      depositRow({ coin: 'PEPE', status: 4, id: 7, amount: 5 }),
    );

    expect(tracked).toMatchObject({ kind: 'row', row: { coin: 'USDT' } });
    expect(untracked).toStrictEqual({
      kind: 'untracked',
      times: [MS],
      ticker: 'PEPE',
      status: 4,
      time: { start: MS, end: MS },
    });
  });

  it.each([
    ['a lower-case code of a tracked coin', 'usdt'],
    ['a Simple Earn receipt token', 'LDBTC'],
  ])('counts %s as an untracked coin', async (_title, coin) => {
    const [item] = await depositsOf(depositRow({ coin }));

    expect(item).toMatchObject({ kind: 'untracked', ticker: coin });
  });

  it('keeps the status of an untracked row as text, and drops a status of no known shape', async () => {
    const items = await withdrawalsOf(
      withdrawalRow({ coin: 'PEPE', status: 'Pending' }),
      withdrawalRow({ coin: 'PEPE', status: { word: 'x' } }),
    );

    expect(items).toMatchObject([{ status: 'Pending' }, { status: undefined }]);
  });

  it('counts an untracked row whose time cannot be read, with no time, and never as unreadable', async () => {
    const [item] = await depositsOf(depositRow({ coin: 'PEPE', successAt: '123' }));

    expect(item).toStrictEqual({
      kind: 'untracked',
      times: [],
      ticker: 'PEPE',
      status: 3,
      time: undefined,
    });
  });

  it.each([
    ['an empty coin', ''],
    ['an absent coin', undefined],
    ['a coin that is no text', 5],
  ])(
    'makes a row with %s unreadable, because it cannot be told from a tracked coin',
    async (_title, coin) => {
      const [item] = await depositsOf(depositRow({ coin }));

      expect(item).toStrictEqual({
        kind: 'unreadable',
        times: [MS],
        time: { start: MS, end: MS },
      });
    },
  );
});

describe('an unreadable row', () => {
  it.each([
    ['null', null],
    ['a number', 5],
    ['a list', []],
  ])('is an item that is %s, which holds no time', async (_title, item) => {
    const items = await depositsOf(item, depositRow());

    expect(items[0]).toStrictEqual({ kind: 'unreadable', times: [], time: undefined });
    expect(items[1]).toMatchObject({ kind: 'row' });
  });

  it('does not fail the page, and the rows around it still parse', async () => {
    const items = await depositsOf(
      depositRow({ id: '1' }),
      depositRow({ amount: 1 }),
      depositRow({ id: '3' }),
    );

    expect(items.map((item) => item.kind)).toStrictEqual(['row', 'unreadable', 'row']);
  });
});

describe('the time of a row', () => {
  it('reads 13 digits as milliseconds', async () => {
    const [item] = await depositsOf(depositRow({ successAt: '1742728163123' }));

    expect(item).toMatchObject({
      times: [1_742_728_163_123],
      row: { time: { start: 1_742_728_163_123, end: 1_742_728_163_123 } },
    });
  });

  it('reads 10 digits as the whole second, from its first millisecond to its last', async () => {
    const [item] = await depositsOf(depositRow({ successAt: String(SECOND) }));

    expect(item).toMatchObject({
      times: [MS, MS + 999],
      row: { time: { start: MS, end: MS + 999 } },
    });
  });

  it('reads a time that is a JSON integer like the same digits as text', async () => {
    const items = await depositsOf(
      depositRow({ successAt: MS }),
      depositRow({ successAt: SECOND }),
    );

    expect(items).toMatchObject([
      { row: { time: { start: MS, end: MS } } },
      { row: { time: { start: MS, end: MS + 999 } } },
    ]);
  });

  it.each([
    ['9 digits', '174272816'],
    ['11 digits', '17427281631'],
    ['12 digits', '174272816312'],
    ['14 digits', '17427281631234'],
    ['digits with a leading zero', '0001705393280'],
    ['a sign', '-1742728163000'],
    ['a decimal', '1742728163.5'],
    ['an exponent', '1.742728163e12'],
    ['a word', 'yesterday'],
    ['a fraction', 1_742_728_163.5],
    ['a negative number', -MS],
    ['a list', [MS]],
    ['an object', { start: MS }],
    ['true', true],
  ])('makes a row whose time is %s unreadable, with no time', async (_title, successAt) => {
    const [item] = await depositsOf(depositRow({ successAt }));

    expect(item).toStrictEqual({ kind: 'unreadable', times: [], time: undefined });
  });

  it.each([
    ['empty', ''],
    ['0', '0'],
    ['the number 0', 0],
    ['null', null],
    ['absent', undefined],
  ])('reads a time that is %s as no time, and the row stays a row', async (_title, successAt) => {
    const [item] = await depositsOf(depositRow({ successAt }));

    expect(item).toStrictEqual({
      kind: 'row',
      times: [],
      row: {
        id: '1234',
        coin: 'USDT',
        amount: '999.0496',
        status: 3,
        depositType: '0',
        depositFee: undefined,
        time: undefined,
      },
    });
  });

  it('reads the window field of a series and no other time field', async () => {
    const { fetchImpl } = pageAnswer('list', [transferRow({ createTime: '1', successAt: '1' })]);
    const page = await fetchTransferPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl));

    expect(page.rows[0]).toMatchObject({ kind: 'row', times: [MS], row: { time: { start: MS } } });
  });
});

describe('the time of a withdrawal', () => {
  it('is createTime, before and after the row settles', async () => {
    const items = await withdrawalsOf(
      withdrawalRow({ status: 'Pending', updateTime: '1742728163500' }),
      withdrawalRow({ status: 'success', updateTime: '1742999999000' }),
    );

    expect(items).toMatchObject([
      { row: { status: 'Pending', time: { start: MS, end: MS } } },
      { row: { status: 'success', time: { start: MS, end: MS } } },
    ]);
  });

  it('keeps every reading of both times for the drift test, and updateTime in no row', async () => {
    const [item] = await withdrawalsOf(withdrawalRow({ updateTime: '1742999999' }));

    expect(item).toMatchObject({ times: [MS, 1_742_999_999_000, 1_742_999_999_999] });
    expect(item).not.toHaveProperty('row.updateTime');
  });

  it.each([
    ['empty', ''],
    ['0', '0'],
    ['absent', undefined],
  ])('reads an updateTime that is %s as no reading', async (_title, updateTime) => {
    const [item] = await withdrawalsOf(withdrawalRow({ updateTime }));

    expect(item).toMatchObject({ kind: 'row', times: [MS] });
  });

  it('reads a createTime that is absent as no time, and keeps the reading of updateTime', async () => {
    const [item] = await withdrawalsOf(withdrawalRow({ createTime: undefined }));

    expect(item).toMatchObject({
      kind: 'row',
      times: [1_742_728_999_000],
      row: { time: undefined },
    });
  });

  it('makes the whole row unreadable when createTime is unreadable', async () => {
    const [item] = await withdrawalsOf(withdrawalRow({ createTime: '174272816' }));

    expect(item).toMatchObject({ kind: 'unreadable' });
  });

  it('reads the row when updateTime is unreadable, and gives the drift test no reading of it', async () => {
    const [item] = await withdrawalsOf(withdrawalRow({ updateTime: '174272899912' }));

    expect(item).toMatchObject({ kind: 'row', times: [MS], row: { time: { start: MS } } });
  });

  it('gives an unreadable row no time of its own when createTime is the unreadable field', async () => {
    const [item] = await withdrawalsOf(withdrawalRow({ createTime: '12' }));

    expect(item).toStrictEqual({ kind: 'unreadable', times: [1_742_728_999_000], time: undefined });
  });
});

describe('what the reader of a span takes from a page', () => {
  const REACH: WalkWindow = { start: MS - DAY_MS, end: MS + DAY_MS };

  const depositReader = (...rows: unknown[]) => {
    const { fetchImpl } = pageAnswer('rows', rows);

    return (cursor: string | undefined) =>
      fetchDepositPage(API_KEY, SECRET, { span: SPAN, cursor }, optionsOf(fetchImpl));
  };

  const withdrawalReader = (...rows: unknown[]) => {
    const { fetchImpl } = pageAnswer('rows', rows);

    return (cursor: string | undefined) =>
      fetchWithdrawalPage(API_KEY, SECRET, { span: SPAN, cursor }, optionsOf(fetchImpl));
  };

  const spanRead = <Item extends { times: readonly number[] }>(
    readPage: (
      cursor: string | undefined,
    ) => Promise<{ rows: Item[]; nextPageCursor: string | undefined }>,
    reach: WalkWindow = REACH,
  ) =>
    readCursorSpan({
      run: createBybitHistoryRun({ now: () => 1_000, sleep: async () => undefined }),
      lane: 'capital',
      span: SPAN,
      keep: 0,
      minSplitMs: DAY_MS,
      readPage,
      timesOf: (item) => item.times,
      reachOf: () => reach,
    });

  it('finds a drift in a row outside the reach by its only reading', async () => {
    const row = depositRow({ successAt: String(MS + 2 * DAY_MS) });

    await expect(spanRead(depositReader(row))).resolves.toStrictEqual({
      kind: 'page',
      page: { kind: 'drift' },
    });
  });

  it('finds no drift when one reading of a withdrawal is in the reach', async () => {
    const row = withdrawalRow({ createTime: String(MS - 5 * DAY_MS), updateTime: String(MS) });

    await expect(spanRead(withdrawalReader(row))).resolves.toMatchObject({
      page: { kind: 'rows' },
    });
  });

  it('finds a drift when both readings of a withdrawal are outside the reach', async () => {
    const row = withdrawalRow({
      createTime: String(MS - 5 * DAY_MS),
      updateTime: String(MS + 5 * DAY_MS),
    });

    await expect(spanRead(withdrawalReader(row))).resolves.toStrictEqual({
      kind: 'page',
      page: { kind: 'drift' },
    });
  });

  it('finds no drift in a whole second that holds the start of the reach', async () => {
    const reach = { start: MS + 500, end: MS + 5_000 };

    await expect(
      spanRead(depositReader(depositRow({ successAt: String(SECOND) })), reach),
    ).resolves.toMatchObject({ page: { kind: 'rows' } });
  });

  it('finds no drift in a row with no time, an unreadable row or an untracked coin with no time', async () => {
    const read = await spanRead(
      depositReader(
        depositRow({ successAt: '' }),
        depositRow({ successAt: '123' }),
        depositRow({ coin: 'PEPE', successAt: undefined }),
      ),
    );

    expect(read).toMatchObject({ kind: 'page', page: { kind: 'rows' } });
    expect(
      read?.kind === 'page' && read.page.kind === 'rows' && read.page.rows.map((item) => item.kind),
    ).toStrictEqual(['row', 'unreadable', 'untracked']);
  });

  it('finds a drift in an untracked row outside the reach', async () => {
    const row = depositRow({ coin: 'PEPE', successAt: String(MS + 9 * DAY_MS) });

    await expect(spanRead(depositReader(row))).resolves.toStrictEqual({
      kind: 'page',
      page: { kind: 'drift' },
    });
  });
});
