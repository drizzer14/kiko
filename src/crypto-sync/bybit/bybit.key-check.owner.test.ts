import { i18n } from '@kiko/i18n/init';
import { signQuery } from '@kiko/crypto-sync/exchange/signing';

import { bybitKeyRefusalOf } from './bybit.key-check';
import { okAnswer } from './bybit.provider-test-fixtures';
import { API_KEY, NOW, SECRET } from './bybit.client-test-fixtures';
import { KEY_CHECK_PATHS, KEY_INFO_RESULT, keyCheckFetch } from './bybit.key-check-test-fixtures';

const mockGetQuery = jest.fn();

jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: { getQuery: (...args: unknown[]) => mockGetQuery(...args) },
}));

const ACCOUNT_ID = 'account-1';
const OLD_USER_ID = '424242424242';
const NEW_USER_ID = '737373737373';

const storedFor = (accountId: string, userId: string): void => {
  mockGetQuery.mockResolvedValue([
    {
      exchangeState: JSON.stringify({
        version: 1,
        walks: {},
        keyOwner: signQuery(accountId, userId),
      }),
    },
  ]);
};

// The check of an account that keeps its Bybit holdings, with the key of `userID` in the answer.
const refusalOfUser = (userID: unknown, info: Record<string, unknown> = {}) => {
  const { fetchImpl, asked } = keyCheckFetch({
    '/v5/user/query-api': okAnswer({ ...KEY_INFO_RESULT, ...info, userID }),
  });

  return {
    asked,
    refusal: bybitKeyRefusalOf(API_KEY, SECRET, {
      fetchImpl,
      now: () => NOW,
      ownerCheck: { accountId: ACCOUNT_ID },
    }),
  };
};

describe('the refusal of a key of another account, O93', () => {
  beforeEach(() => {
    mockGetQuery.mockReset();
  });

  it('refuses a key of another owner after one call, with the text of that refusal', async () => {
    storedFor(ACCOUNT_ID, OLD_USER_ID);

    const { asked, refusal } = refusalOfUser(Number(NEW_USER_ID));

    await expect(refusal).resolves.toBe(i18n.t('accountDetail.bybitKeyOtherAccount'));
    expect(asked).toHaveLength(1);
  });

  it('passes a key of the same owner, and the connect makes 10 calls', async () => {
    storedFor(ACCOUNT_ID, OLD_USER_ID);

    const { asked, refusal } = refusalOfUser(Number(OLD_USER_ID));

    await expect(refusal).resolves.toBeUndefined();
    expect(asked.map((url) => url.pathname)).toEqual([...KEY_CHECK_PATHS]);
  });

  it('reads a user id sent as a digit string as the same owner', async () => {
    storedFor(ACCOUNT_ID, OLD_USER_ID);

    await expect(refusalOfUser(OLD_USER_ID).refusal).resolves.toBeUndefined();
  });

  it.each([
    ['no state row', []],
    ['a column nothing wrote', [{ exchangeState: null }]],
    ['a state with no value', [{ exchangeState: JSON.stringify({ version: 1, walks: {} }) }]],
    [
      'a state whose top level is malformed',
      [{ exchangeState: '{"version":2,"walks":{},"keyOwner":"stored-value"}' }],
    ],
  ])('passes any key when the account has %s', async (_title, rows) => {
    mockGetQuery.mockResolvedValue(rows);

    const { asked, refusal } = refusalOfUser(Number(NEW_USER_ID));

    await expect(refusal).resolves.toBeUndefined();
    expect(asked).toHaveLength(10);
  });

  it('with no Bybit holding left, any key passes, and the stored value is not read', async () => {
    storedFor(ACCOUNT_ID, OLD_USER_ID);
    const { fetchImpl, asked } = keyCheckFetch({
      '/v5/user/query-api': okAnswer({ ...KEY_INFO_RESULT, userID: Number(NEW_USER_ID) }),
    });

    await expect(
      bybitKeyRefusalOf(API_KEY, SECRET, { fetchImpl, now: () => NOW }),
    ).resolves.toBeUndefined();
    expect(asked).toHaveLength(10);
    expect(mockGetQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['no user id', undefined],
    ['a user id that is text', 'SENTINEL-PERSONAL-FIELD'],
    ['a fraction', 1.5],
  ])(
    'refuses with the failed-request text, after one call, for a stored value and %s',
    async (_title, userID) => {
      storedFor(ACCOUNT_ID, OLD_USER_ID);

      const { asked, refusal } = refusalOfUser(userID);

      await expect(refusal).resolves.toBe(i18n.t('accountDetail.bybitRequestFailedNoCode'));
      expect(asked).toHaveLength(1);
    },
  );

  it('passes a key with no user id when the account stores no value', async () => {
    mockGetQuery.mockResolvedValue([]);

    await expect(refusalOfUser(undefined).refusal).resolves.toBeUndefined();
  });

  it('keeps the value to the account: a value stored for another account refuses the same user', async () => {
    storedFor('another-account', OLD_USER_ID);

    await expect(refusalOfUser(Number(OLD_USER_ID)).refusal).resolves.toBe(
      i18n.t('accountDetail.bybitKeyOtherAccount'),
    );
  });

  it('gives a key that is not a main key its own text first, and reads no state', async () => {
    storedFor(ACCOUNT_ID, OLD_USER_ID);

    const { asked, refusal } = refusalOfUser(Number(NEW_USER_ID), { isMaster: false });

    await expect(refusal).resolves.toBe(i18n.t('accountDetail.bybitKeyNotMain'));
    expect(asked).toHaveLength(1);
    expect(mockGetQuery).not.toHaveBeenCalled();
  });

  it('gives a read-write key its own text first, and reads no state', async () => {
    storedFor(ACCOUNT_ID, OLD_USER_ID);

    const { refusal } = refusalOfUser(Number(NEW_USER_ID), { readOnly: 0 });

    await expect(refusal).resolves.toBe(i18n.t('accountDetail.bybitKeyNotReadOnly'));
    expect(mockGetQuery).not.toHaveBeenCalled();
  });

  it('refuses with the failed-request text, after one call, when the state cannot be read', async () => {
    mockGetQuery.mockRejectedValue(new Error('database is locked'));

    const { asked, refusal } = refusalOfUser(Number(OLD_USER_ID));

    await expect(refusal).resolves.toBe(i18n.t('accountDetail.bybitRequestFailedNoCode'));
    expect(asked).toHaveLength(1);
  });
});
