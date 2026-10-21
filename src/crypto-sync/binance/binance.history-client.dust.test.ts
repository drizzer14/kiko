import {
  DUST_OPERATED_AT,
  dustEntryOf,
  dustRecordOf,
  wireDustEntryOf,
  wireDustRecordOf,
} from './binance.dust-test-fixtures';
import {
  BinanceHistoryParseError,
  type DustHistoryPage,
  fetchDustHistory,
} from './binance.history-client';

const NOW = 1_704_326_400_000;

const textFetch = (text: string, headers: Headers = new Headers()) =>
  (async () => ({
    ok: true,
    status: 200,
    headers,
    json: async () => JSON.parse(text),
  })) as unknown as typeof fetch;

const bodyFetch = (body: unknown, headers: Headers = new Headers()) =>
  textFetch(JSON.stringify(body), headers);

const readPage = (body: unknown, headers?: Headers): Promise<DustHistoryPage> =>
  fetchDustHistory('api-key-fixture', 'secret-fixture', {
    fetchImpl: bodyFetch(body, headers),
    now: () => NOW,
  });

const readRecords = (...records: unknown[]): Promise<DustHistoryPage> =>
  readPage({ total: records.length, userAssetDribblets: records });

// Raw body text, because `JSON.stringify` cannot write an integer past 2^53 as Binance does.
const readBodyText = (text: string): Promise<DustHistoryPage> =>
  fetchDustHistory('api-key-fixture', 'secret-fixture', {
    fetchImpl: textFetch(text),
    now: () => NOW,
  });

const recordBodyTextOf = (transIdField: string): string =>
  `{"userAssetDribblets":[{${transIdField},"operateTime":${DUST_OPERATED_AT},` +
  '"userAssetDribbletDetails":[]}]}';

describe('fetchDustHistory', () => {
  it.each([
    ['a safe integer', 45_178_372_831, '45178372831'],
    ['a text', 'record-7', 'record-7'],
  ])('reads a record with two entries, its transId %s', async (_name, transId, expected) => {
    const page = await readRecords(
      wireDustRecordOf({
        transId,
        userAssetDribbletDetails: [
          wireDustEntryOf(),
          wireDustEntryOf({ fromAsset: ' doge ', amount: '12', transferedAmount: '0.0021' }),
        ],
      }),
    );

    expect(page.unreadable).toEqual([]);
    expect(page.rows).toEqual([
      {
        transId: expected,
        operateTime: DUST_OPERATED_AT,
        entries: [
          dustEntryOf(),
          dustEntryOf({ fromAsset: 'DOGE', amount: '12', transferedAmount: '0.0021' }),
        ],
      },
    ]);
  });

  it('reads the transId and the operateTime of the record, not of its entries', async () => {
    const page = await readRecords(
      wireDustRecordOf({
        transId: 'record-9',
        operateTime: DUST_OPERATED_AT + 1,
        userAssetDribbletDetails: [
          wireDustEntryOf({ transId: 'entry-1', operateTime: DUST_OPERATED_AT + 2 }),
        ],
      }),
    );

    expect(page.rows).toEqual([
      dustRecordOf({ transId: 'record-9', operateTime: DUST_OPERATED_AT + 1 }),
    ]);
  });

  it('never reads a service charge, a total or an entry transId', async () => {
    const page = await readRecords(wireDustRecordOf({ email: 'someone@example.com' }));

    expect(Object.keys(page.rows[0] ?? {}).sort()).toEqual(['entries', 'operateTime', 'transId']);
    expect(Object.keys(page.rows[0]?.entries[0] ?? {}).sort()).toEqual([
      'amount',
      'fromAsset',
      'transferedAmount',
    ]);
    expect(JSON.stringify(page.rows)).not.toContain('0.00000984');
    expect(JSON.stringify(page.rows)).not.toContain('0.00132256');
  });

  it('reads an entry asset upper-cased and trimmed, and a blank one as blank', async () => {
    const page = await readRecords(
      wireDustRecordOf({
        userAssetDribbletDetails: [
          wireDustEntryOf({ fromAsset: ' trx ' }),
          wireDustEntryOf({ fromAsset: '  ' }),
        ],
      }),
    );

    expect(page.rows[0]?.entries.map((entry) => entry.fromAsset)).toEqual(['TRX', '']);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['of another JSON type', 7],
  ])('reads an entry whose asset and amounts are %s as undefined', async (_name, value) => {
    const page = await readRecords(
      wireDustRecordOf({
        userAssetDribbletDetails: [
          wireDustEntryOf({ fromAsset: value, amount: value, transferedAmount: value }),
        ],
      }),
    );

    expect(page.unreadable).toEqual([]);
    expect(page.rows[0]?.entries).toEqual([
      { fromAsset: undefined, amount: undefined, transferedAmount: undefined },
    ]);
  });

  it('reads a record with an empty entry list', async () => {
    const page = await readRecords(wireDustRecordOf({ userAssetDribbletDetails: [] }));

    expect(page.unreadable).toEqual([]);
    expect(page.rows).toEqual([dustRecordOf({ entries: [] })]);
  });

  it.each([
    ['no transId', { transId: undefined }],
    ['a null transId', { transId: null }],
    ['an empty transId', { transId: '' }],
    ['a transId of another JSON type', { transId: true }],
    ['a fractional transId', { transId: 1.5 }],
  ])('reads a record with %s as unreadable, keeping its time', async (_name, overrides) => {
    const page = await readRecords(wireDustRecordOf(overrides));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: DUST_OPERATED_AT }]);
  });

  it('reads a record with a transId past 2^53 in the body text as unreadable, keeping its time', async () => {
    const page = await readBodyText(recordBodyTextOf('"transId":1940000000000000001'));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: DUST_OPERATED_AT }]);
  });

  it('reads a record with a safe-integer transId in the body text as its digits', async () => {
    const page = await readBodyText(recordBodyTextOf('"transId":940708407462087'));

    expect(page.rows).toEqual([
      { transId: '940708407462087', operateTime: DUST_OPERATED_AT, entries: [] },
    ]);
  });

  it.each([
    ['no operateTime', { operateTime: undefined }],
    ['a null operateTime', { operateTime: null }],
    ['a text operateTime', { operateTime: '1615985535000' }],
  ])('reads a record with %s as unreadable with no time', async (_name, overrides) => {
    const page = await readRecords(wireDustRecordOf(overrides));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: undefined }]);
  });

  it.each([
    ['no entry list', { userAssetDribbletDetails: undefined }],
    ['a null entry list', { userAssetDribbletDetails: null }],
    ['an entry list that is no array', { userAssetDribbletDetails: {} }],
    ['an entry that is no object', { userAssetDribbletDetails: ['not an entry'] }],
  ])('reads a record with %s as unreadable, keeping its time', async (_name, overrides) => {
    const page = await readRecords(wireDustRecordOf(overrides));

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([{ time: DUST_OPERATED_AT }]);
  });

  it('reads a record that is no object as unreadable with no time', async () => {
    const page = await readRecords('not a record', wireDustRecordOf());

    expect(page.rows).toHaveLength(1);
    expect(page.unreadable).toEqual([{ time: undefined }]);
  });

  it('keeps the readable records of a page beside an unreadable one', async () => {
    const page = await readRecords(
      wireDustRecordOf({ transId: 'a' }),
      wireDustRecordOf({ transId: '', operateTime: DUST_OPERATED_AT - 1 }),
      wireDustRecordOf({ transId: 'c' }),
    );

    expect(page.rows.map((row) => row.transId)).toEqual(['a', 'c']);
    expect(page.unreadable).toEqual([{ time: DUST_OPERATED_AT - 1 }]);
  });

  it('reads the empty answer Binance sends: a list of none and no total', async () => {
    const page = await readBodyText('{"userAssetDribblets":[]}');

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([]);
  });

  it.each([[0], ['0'], [null], ['junk']])(
    'reads an empty list whatever its total, %p',
    async (total) => {
      const page = await readPage({ total, userAssetDribblets: [] });

      expect(page.rows).toEqual([]);
      expect(page.unreadable).toEqual([]);
    },
  );

  it('reads the records of a list whatever its total', async () => {
    const page = await readPage({ total: 'junk', userAssetDribblets: [wireDustRecordOf()] });

    expect(page.rows).toHaveLength(1);
  });

  it.each([
    ['no list', {}],
    ['a total and no list', { total: 0 }],
    ['a list that is no array', { userAssetDribblets: {} }],
    ['a list of text', { userAssetDribblets: 'none' }],
    ['a null list', { userAssetDribblets: null }],
    ['a body that is no object', 'oops'],
    ['a null body', null],
    ['an array body', []],
  ])('fails the read for a body with %s', async (_name, body) => {
    await expect(readPage(body)).rejects.toBeInstanceOf(BinanceHistoryParseError);
  });

  it('sends no query parameter but the timestamp, the receive window and the signature', async () => {
    const fetchImpl = jest.fn(bodyFetch({ userAssetDribblets: [] }));

    await fetchDustHistory('api-key-fixture', 'secret-fixture', { fetchImpl, now: () => NOW });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);

    expect(parsed.pathname).toBe('/sapi/v1/asset/dribblet');
    expect(init.method).toBe('GET');
    expect([...parsed.searchParams.keys()].sort()).toEqual([
      'recvWindow',
      'signature',
      'timestamp',
    ]);
    expect(parsed.searchParams.get('timestamp')).toBe(String(NOW));
    expect(parsed.searchParams.get('signature')).toEqual(expect.any(String));
  });

  it('carries the weights Binance reports in the headers', async () => {
    const page = await readPage(
      { userAssetDribblets: [] },
      new Headers({
        'X-SAPI-USED-UID-WEIGHT-1M': '3000',
        'X-SAPI-USED-IP-WEIGHT-1M': '12',
      }),
    );

    expect(page).toMatchObject({ usedUidWeight1m: 3000, usedIpWeight1m: 12 });
  });

  it('leaves the weights undefined without the headers', async () => {
    const page = await readPage({ userAssetDribblets: [] });

    expect(page).toMatchObject({ usedUidWeight1m: undefined, usedIpWeight1m: undefined });
  });
});
