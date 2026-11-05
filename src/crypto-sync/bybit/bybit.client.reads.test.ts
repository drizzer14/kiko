import {
  BybitRefusalError,
  fetchFundBalance,
  fetchKeyInfo,
  fetchUnifiedBalance,
} from './bybit.client';
import { API_KEY, NOW, SECRET, answerWith, envelopeOf } from './bybit.client-test-fixtures';

// Each personal or secret field of the key info answer holds a value that must reach nothing.
const KEY_INFO_BODY = {
  id: 'SENTINEL-KEY-ID',
  note: 'SENTINEL-NOTE',
  apiKey: 'SENTINEL-API-KEY',
  readOnly: 1,
  secret: '',
  permissions: { Wallet: ['AccountTransfer'], Earn: ['Earn'], Spot: ['SENTINEL-PERMISSION'] },
  ips: ['SENTINEL-IP'],
  type: 1,
  deadlineDay: 30,
  expiredAt: '2099-01-02T03:04:05Z',
  createdAt: '2090-01-02T03:04:05Z',
  unified: 1,
  uta: 1,
  userID: 987654321,
  inviterID: 123456789,
  vipLevel: 'SENTINEL-VIP',
  mktMakerLevel: 'SENTINEL-MAKER',
  affiliateID: 55,
  rsaPublicKey: '',
  isMaster: true,
  parentUid: 'SENTINEL-PARENT',
  kycLevel: 'SENTINEL-KYC',
  kycRegion: 'SENTINEL-REGION',
  isFixApi: false,
};

const keyInfoFrom = (result: unknown) => {
  const { fetchImpl, sent } = answerWith({ body: envelopeOf(0, result) });

  return { sent, info: fetchKeyInfo(API_KEY, SECRET, { fetchImpl, now: () => NOW }) };
};

describe('fetchKeyInfo', () => {
  it('reads the key of the account from the bare query-api path', async () => {
    const { sent, info } = keyInfoFrom(KEY_INFO_BODY);

    await info;

    expect(sent[0].url).toBe('https://api.bybit.com/v5/user/query-api');
  });

  it('returns the expiry date, the days left, and the two facts the connect needs', async () => {
    await expect(keyInfoFrom(KEY_INFO_BODY).info).resolves.toStrictEqual({
      expiredAtMs: Date.UTC(2099, 0, 2, 3, 4, 5),
      deadlineDay: 30,
      readOnly: 1,
      isMaster: true,
    });
  });

  it('parses no personal field and not the permissions', async () => {
    const info = await keyInfoFrom(KEY_INFO_BODY).info;

    expect(JSON.stringify(info)).not.toMatch(/SENTINEL|987654321|123456789/);
    expect(Object.keys(info).sort()).toEqual([
      'deadlineDay',
      'expiredAtMs',
      'isMaster',
      'readOnly',
    ]);
  });

  it('reads a read-write key as it is, so the connect can refuse it', async () => {
    await expect(keyInfoFrom({ ...KEY_INFO_BODY, readOnly: 0 }).info).resolves.toMatchObject({
      readOnly: 0,
    });
  });

  it('reads a key of a sub-account as it is, so the connect can refuse it', async () => {
    await expect(keyInfoFrom({ ...KEY_INFO_BODY, isMaster: false }).info).resolves.toMatchObject({
      isMaster: false,
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ['expiredAtMs', { expiredAt: undefined }],
    ['expiredAtMs', { expiredAt: '' }],
    ['expiredAtMs', { expiredAt: 'tomorrow' }],
    ['expiredAtMs', { expiredAt: 20990102 }],
    ['expiredAtMs', { expiredAt: '2099-01-02 03:04:05' }],
    ['expiredAtMs', { expiredAt: '1970-01-01T00:00:00Z' }],
    ['expiredAtMs', { expiredAt: '1969-12-31T23:59:59Z' }],
    ['deadlineDay', { deadlineDay: undefined }],
    ['deadlineDay', { deadlineDay: '30' }],
    ['deadlineDay', { deadlineDay: Number.NaN }],
    ['readOnly', { readOnly: undefined }],
    ['readOnly', { readOnly: '1' }],
    ['readOnly', { readOnly: true }],
    ['isMaster', { isMaster: undefined }],
    ['isMaster', { isMaster: 'true' }],
    ['isMaster', { isMaster: 1 }],
  ])('reads %s of the wrong shape as absent: %j', async (field, patch) => {
    const info = await keyInfoFrom({ ...KEY_INFO_BODY, ...patch }).info;

    expect(info[field as keyof typeof info]).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ['no result', undefined],
    ['a result that is not an object', 'text'],
    ['a list', []],
  ])('refuses %s as a malformed body', async (_title, result) => {
    const failure = await keyInfoFrom(result).info.catch((error) => error);

    expect(failure).toBeInstanceOf(BybitRefusalError);
    expect(failure).toMatchObject({ refusal: 'malformed' });
  });

  it('lets a refusal through as the class of its code', async () => {
    const { fetchImpl } = answerWith({ body: envelopeOf(10005) });

    await expect(fetchKeyInfo(API_KEY, SECRET, { fetchImpl })).rejects.toMatchObject({
      refusal: 'permission',
    });
  });
});

// Coin rows carry the shape of the wallet-balance page; the values are made up.
const UNIFIED_BODY = {
  list: [
    {
      accountType: 'UNIFIED',
      totalEquity: 'SENTINEL-EQUITY',
      accountIMRate: 'SENTINEL-RATE',
      coin: [
        {
          coin: 'AAA',
          walletBalance: '1.5',
          spotBorrow: '0',
          borrowAmount: '0',
          equity: 'SENTINEL-EQUITY',
          usdValue: 'SENTINEL-USD',
          locked: 'SENTINEL-LOCKED',
          unrealisedPnl: 'SENTINEL-PNL',
        },
        { coin: 'BBB', walletBalance: '20', spotBorrow: '3', borrowAmount: '0' },
      ],
    },
  ],
};

const unifiedFrom = (result: unknown) => {
  const { fetchImpl, sent } = answerWith({ body: envelopeOf(0, result) });

  return {
    sent,
    coins: fetchUnifiedBalance(API_KEY, SECRET, { fetchImpl, now: () => NOW }),
  };
};

describe('fetchUnifiedBalance', () => {
  it('reads the UNIFIED account of the wallet-balance path', async () => {
    const { sent, coins } = unifiedFrom(UNIFIED_BODY);

    await coins;

    expect(sent[0].url).toBe('https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED');
  });

  it('returns the coin, its wallet balance and its two borrow fields, and nothing else', async () => {
    await expect(unifiedFrom(UNIFIED_BODY).coins).resolves.toStrictEqual([
      { coin: 'AAA', walletBalance: '1.5', spotBorrow: '0', borrowAmount: '0' },
      { coin: 'BBB', walletBalance: '20', spotBorrow: '3', borrowAmount: '0' },
    ]);
  });

  it('parses no value of the account and no price', async () => {
    const coins = await unifiedFrom(UNIFIED_BODY).coins;

    expect(JSON.stringify(coins)).not.toContain('SENTINEL');
  });

  it('passes a number through for the provider to read, as it does for a string', async () => {
    const coins = await unifiedFrom({ list: [{ coin: [{ coin: 'AAA', walletBalance: 1.5 }] }] })
      .coins;

    expect(coins).toStrictEqual([
      { coin: 'AAA', walletBalance: 1.5, spotBorrow: undefined, borrowAmount: undefined },
    ]);
  });

  it('joins the coins of every entry of the list', async () => {
    const coins = await unifiedFrom({
      list: [{ coin: [{ coin: 'AAA', walletBalance: '1' }] }, { coin: [{ coin: 'BBB' }] }],
    }).coins;

    expect(coins.map((row) => row.coin)).toEqual(['AAA', 'BBB']);
  });

  it('reads an account with no coin as an empty list', async () => {
    await expect(unifiedFrom({ list: [{ coin: [] }] }).coins).resolves.toEqual([]);
    await expect(unifiedFrom({ list: [] }).coins).resolves.toEqual([]);
  });

  it.each<[string, unknown]>([
    ['a row that is not an object', 'text'],
    ['a null row', null],
    ['a row with no coin', { walletBalance: '1' }],
    ['a row whose coin is empty text', { coin: '' }],
    ['a row whose coin is not text', { coin: 5 }],
    ['a row whose coin is null', { coin: null }],
  ])('refuses %s as a malformed body, so the last balance stays', async (_title, row) => {
    const failure = await unifiedFrom({ list: [{ coin: [{ coin: 'AAA' }, row] }] }).coins.catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(BybitRefusalError);
    expect(failure).toMatchObject({ refusal: 'malformed' });
  });

  it.each<[string, unknown]>([
    ['no result', undefined],
    ['a result with no list', {}],
    ['a list that is not an array', { list: {} }],
    ['an entry that is not an object', { list: ['text'] }],
    ['an entry with no coin array', { list: [{}] }],
    ['an entry whose coin is not an array', { list: [{ coin: {} }] }],
  ])('refuses %s as a malformed body, never as an account of no coins', async (_title, result) => {
    const failure = await unifiedFrom(result).coins.catch((error) => error);

    expect(failure).toBeInstanceOf(BybitRefusalError);
    expect(failure).toMatchObject({ refusal: 'malformed' });
  });

  it('lets a refusal through as the class of its code', async () => {
    const { fetchImpl } = answerWith({ body: envelopeOf(10028) });

    await expect(fetchUnifiedBalance(API_KEY, SECRET, { fetchImpl })).rejects.toMatchObject({
      refusal: 'notUnified',
    });
  });
});

const FUND_BODY = {
  accountType: 'FUND',
  memberId: 'SENTINEL-MEMBER',
  balance: [
    {
      coin: 'AAA',
      transferBalance: 'SENTINEL-TRANSFER',
      walletBalance: '7.25',
      bonus: 'SENTINEL-BONUS',
    },
    { coin: 'BBB', walletBalance: '0' },
  ],
};

const fundFrom = (result: unknown) => {
  const { fetchImpl, sent } = answerWith({ body: envelopeOf(0, result) });

  return { sent, coins: fetchFundBalance(API_KEY, SECRET, { fetchImpl, now: () => NOW }) };
};

describe('fetchFundBalance', () => {
  it('reads the FUND account with no coin filter and no bonus parameter', async () => {
    const { sent, coins } = fundFrom(FUND_BODY);

    await coins;

    expect(sent[0].url).toBe(
      'https://api.bybit.com/v5/asset/transfer/query-account-coins-balance?accountType=FUND',
    );
  });

  it('returns the coin and its wallet balance, and nothing else', async () => {
    await expect(fundFrom(FUND_BODY).coins).resolves.toStrictEqual([
      { coin: 'AAA', walletBalance: '7.25' },
      { coin: 'BBB', walletBalance: '0' },
    ]);
  });

  it('parses no member id and no transfer balance', async () => {
    const coins = await fundFrom(FUND_BODY).coins;

    expect(JSON.stringify(coins)).not.toContain('SENTINEL');
  });

  it('reads an empty balance list as no coin', async () => {
    await expect(fundFrom({ balance: [] }).coins).resolves.toEqual([]);
  });

  it.each<[string, unknown]>([
    ['a row that is not an object', 'text'],
    ['a null row', null],
    ['a row with no coin', { walletBalance: '1' }],
    ['a row whose coin is empty text', { coin: '' }],
    ['a row whose coin is not text', { coin: 5 }],
    ['a row whose coin is null', { coin: null }],
  ])('refuses %s as a malformed body, so the last balance stays', async (_title, row) => {
    const failure = await fundFrom({ balance: [{ coin: 'AAA' }, row] }).coins.catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(BybitRefusalError);
    expect(failure).toMatchObject({ refusal: 'malformed' });
  });

  it.each<[string, unknown]>([
    ['no result', undefined],
    ['a result with no balance', {}],
    ['a balance that is not an array', { balance: {} }],
    ['the UNIFIED list instead', { list: [] }],
  ])('refuses %s as a malformed body', async (_title, result) => {
    const failure = await fundFrom(result).coins.catch((error) => error);

    expect(failure).toBeInstanceOf(BybitRefusalError);
    expect(failure).toMatchObject({ refusal: 'malformed' });
  });

  it('lets a refusal through as the class of its code', async () => {
    const { fetchImpl } = answerWith({ body: envelopeOf(10005) });

    await expect(fetchFundBalance(API_KEY, SECRET, { fetchImpl })).rejects.toMatchObject({
      refusal: 'permission',
    });
  });
});
