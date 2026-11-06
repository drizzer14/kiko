import {
  BybitHistoryParseError,
  fetchDepositPage,
  fetchInternalDepositPage,
  fetchTransferPage,
  fetchWithdrawalPage,
} from './bybit.history-client';
import {
  NEVER_READ,
  SPAN,
  depositRow,
  internalDepositRow,
  optionsOf,
  pageAnswer,
  transferRow,
  withdrawalRow,
} from './bybit.history-test-fixtures';
import { BybitRefusalError } from './bybit.client';
import { API_KEY, SECRET, answerWith, envelopeOf } from './bybit.client-test-fixtures';

const MS = 1_742_728_163_000;
const FIRST_PAGE = { span: SPAN, cursor: undefined };

const depositsOf = (fetchImpl: typeof fetch, cursor?: string) =>
  fetchDepositPage(API_KEY, SECRET, { span: SPAN, cursor }, optionsOf(fetchImpl));

describe('the history requests', () => {
  it.each([
    ['deposit', fetchDepositPage, '/v5/asset/deposit/query-record', 'rows'],
    [
      'internal deposit',
      fetchInternalDepositPage,
      '/v5/asset/deposit/query-internal-record',
      'rows',
    ],
    ['withdrawal', fetchWithdrawalPage, '/v5/asset/withdraw/query-record', 'rows'],
    ['transfer', fetchTransferPage, '/v5/asset/transfer/query-inter-transfer-list', 'list'],
  ] as const)(
    '%s asks its path with GET, the span, a page of 50 and no cursor',
    async (_title, read, path, field) => {
      const { fetchImpl, sent } = pageAnswer(field, []);

      await read(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl));

      const url = new URL(sent[0].url);

      expect(url.pathname).toBe(path);
      expect(sent[0].init.method).toBe('GET');
      expect(url.searchParams.get('startTime')).toBe(String(SPAN.start));
      expect(url.searchParams.get('endTime')).toBe(String(SPAN.end));
      expect(url.searchParams.get('limit')).toBe('50');
      expect(url.searchParams.has('cursor')).toBe(false);
    },
  );

  it('sends the cursor it is given', async () => {
    const { fetchImpl, sent } = pageAnswer('rows', []);

    await depositsOf(fetchImpl, 'page-two');

    expect(new URL(sent[0].url).searchParams.get('cursor')).toBe('page-two');
  });

  it('asks the withdrawal route for both kinds of withdrawal, and no other route', async () => {
    const withdrawals = pageAnswer('rows', []);

    await fetchWithdrawalPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(withdrawals.fetchImpl));

    expect(new URL(withdrawals.sent[0].url).searchParams.get('withdrawType')).toBe('2');

    for (const [read, field] of [
      [fetchDepositPage, 'rows'],
      [fetchInternalDepositPage, 'rows'],
      [fetchTransferPage, 'list'],
    ] as const) {
      const { fetchImpl, sent } = pageAnswer(field, []);

      await read(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl));

      expect(new URL(sent[0].url).searchParams.has('withdrawType')).toBe(false);
    }
  });

  it('lets a refusal of the route through as the client gives it', async () => {
    const { fetchImpl } = answerWith({ body: envelopeOf(10005) });

    await expect(depositsOf(fetchImpl)).rejects.toBeInstanceOf(BybitRefusalError);
  });
});

describe('the envelope of a history page', () => {
  it.each([
    ['deposit', fetchDepositPage, 'list'],
    ['internal deposit', fetchInternalDepositPage, 'list'],
    ['withdrawal', fetchWithdrawalPage, 'list'],
    ['transfer', fetchTransferPage, 'rows'],
  ] as const)('%s fails on an answer that holds only a %s list', async (_title, read, field) => {
    const { fetchImpl } = pageAnswer(field, []);

    await expect(read(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl))).rejects.toBeInstanceOf(
      BybitHistoryParseError,
    );
  });

  it.each([
    ['a result that is no object', 'text'],
    ['a result that is null', null],
    ['a list that is no list', { rows: 'text' }],
    ['a list that is an object', { rows: {} }],
    ['a cursor that is no text', { rows: [], nextPageCursor: 12 }],
  ])('fails on %s', async (_title, result) => {
    const { fetchImpl } = answerWith({ body: envelopeOf(0, result) });

    await expect(depositsOf(fetchImpl)).rejects.toBeInstanceOf(BybitHistoryParseError);
  });

  it('carries a fixed message and a name, so a log line names the class and nothing else', async () => {
    const { fetchImpl } = pageAnswer('rows', 'not a list');
    const failure = await depositsOf(fetchImpl).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BybitHistoryParseError);
    expect(failure).toMatchObject({
      name: 'BybitHistoryParseError',
      message: 'Bybit history response malformed',
    });
  });

  it.each([
    ['text', { nextPageCursor: 'next-page' }, 'next-page'],
    ['absent', {}, undefined],
    ['null', { nextPageCursor: null }, undefined],
    ['empty, which the reader of a span takes as the end', { nextPageCursor: '' }, ''],
  ])('reads a cursor that is %s', async (_title, fields, expected) => {
    const { fetchImpl } = answerWith({ body: envelopeOf(0, { rows: [], ...fields }) });

    await expect(depositsOf(fetchImpl)).resolves.toStrictEqual({
      rows: [],
      nextPageCursor: expected,
    });
  });

  it('reads a page with no row as a page with no row', async () => {
    const { fetchImpl } = pageAnswer('rows', []);

    await expect(depositsOf(fetchImpl)).resolves.toStrictEqual({ rows: [], nextPageCursor: '' });
  });
});

describe('the named fields of each series', () => {
  it('reads a deposit by id, coin, amount, status, depositType and successAt', async () => {
    const { fetchImpl } = pageAnswer('rows', [depositRow()]);

    await expect(depositsOf(fetchImpl)).resolves.toStrictEqual({
      rows: [
        {
          kind: 'row',
          times: [MS],
          row: {
            id: '1234',
            coin: 'USDT',
            amount: '999.0496',
            status: 3,
            depositType: '0',
            time: { start: MS, end: MS },
          },
        },
      ],
      nextPageCursor: '',
    });
  });

  it('reads an internal deposit by id, coin, amount, status and createdTime, in the whole second', async () => {
    const { fetchImpl } = pageAnswer('rows', [internalDepositRow()]);
    const page = await fetchInternalDepositPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl));

    expect(page.rows).toStrictEqual([
      {
        kind: 'row',
        times: [1_705_393_280_000, 1_705_393_280_999],
        row: {
          id: '5678',
          coin: 'USDT',
          amount: '12.5',
          status: 2,
          time: { start: 1_705_393_280_000, end: 1_705_393_280_999 },
        },
      },
    ]);
  });

  it('reads a withdrawal by withdrawId, coin, amount, status, createTime and updateTime', async () => {
    const { fetchImpl } = pageAnswer('rows', [withdrawalRow()]);
    const page = await fetchWithdrawalPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl));

    expect(page.rows).toStrictEqual([
      {
        kind: 'row',
        times: [MS, 1_742_728_999_000],
        row: {
          withdrawId: '9012',
          coin: 'USDT',
          amount: '41.43008',
          status: 'success',
          time: { start: MS, end: MS },
          updateTime: { start: 1_742_728_999_000, end: 1_742_728_999_000 },
        },
      },
    ]);
  });

  it('reads a transfer by transferId, coin, amount, both account types, status and timestamp', async () => {
    const { fetchImpl } = pageAnswer('list', [transferRow()]);
    const page = await fetchTransferPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(fetchImpl));

    expect(page.rows).toStrictEqual([
      {
        kind: 'row',
        times: [MS],
        row: {
          transferId: 'f4a5e7b8-0000-4000-8000-000000000001',
          coin: 'USDT',
          amount: '5000',
          fromAccountType: 'SPOT',
          toAccountType: 'UNIFIED',
          status: 'SUCCESS',
          time: { start: MS, end: MS },
        },
      },
    ]);
  });

  it('reads an id that is a JSON integer as its digits', async () => {
    const { fetchImpl } = pageAnswer('rows', [depositRow({ id: 1234 })]);
    const page = await depositsOf(fetchImpl);

    expect(page.rows[0]).toMatchObject({ kind: 'row', row: { id: '1234' } });
  });

  it('lets no field outside the named ones reach what a page gives back', async () => {
    const deposits = pageAnswer('rows', [depositRow({ memo: NEVER_READ })]);
    const transfers = pageAnswer('list', [transferRow({ memo: NEVER_READ })]);
    const withdrawals = pageAnswer('rows', [withdrawalRow({ memo: NEVER_READ })]);
    const internals = pageAnswer('rows', [internalDepositRow({ memo: NEVER_READ })]);

    const pages = [
      await depositsOf(deposits.fetchImpl),
      await fetchTransferPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(transfers.fetchImpl)),
      await fetchWithdrawalPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(withdrawals.fetchImpl)),
      await fetchInternalDepositPage(API_KEY, SECRET, FIRST_PAGE, optionsOf(internals.fetchImpl)),
    ];

    expect(JSON.stringify(pages)).not.toContain(NEVER_READ);
  });

  it.each([
    ['text 10', '10', '10'],
    ['a number 20', 20, '20'],
    ['absent', undefined, undefined],
    ['null', null, undefined],
    ['a list', ['0'], undefined],
  ])(
    'reads depositType %s as %s, and the row stays a row',
    async (_title, depositType, expected) => {
      const { fetchImpl } = pageAnswer('rows', [depositRow({ depositType })]);
      const page = await depositsOf(fetchImpl);

      expect(page.rows[0]).toMatchObject({ kind: 'row', row: { depositType: expected } });
    },
  );

  it.each([
    ['a status that is text', { status: '3' }],
    ['a status that is a fraction', { status: 3.5 }],
    ['an absent amount', { amount: undefined }],
    ['an amount that is a number', { amount: 999.0496 }],
    ['an absent id', { id: undefined }],
    ['an id that is empty', { id: '' }],
  ])(
    'makes a tracked deposit with %s unreadable, with its time kept',
    async (_title, overrides) => {
      const { fetchImpl } = pageAnswer('rows', [depositRow(overrides)]);
      const page = await depositsOf(fetchImpl);

      expect(page.rows).toStrictEqual([
        { kind: 'unreadable', times: [MS], time: { start: MS, end: MS } },
      ]);
    },
  );
});
