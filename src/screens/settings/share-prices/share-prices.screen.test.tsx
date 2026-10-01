import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import {
  EodhdAuthError,
  EodhdQuotaError,
  EodhdServerError,
  EodhdRateLimitError,
  EodhdUnavailableError,
} from '@kiko/prices/eodhd';
import { i18n } from '@kiko/i18n/init';
import type { QuoteQuota } from '@kiko/prices/quote-quota';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

const mockOpenURL = jest.fn();
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: { openURL: (...args: unknown[]) => mockOpenURL(...args) },
}));

let mockQuotaRows: { quoteQuota: QuoteQuota | null }[] = [];
let mockQuotaLoading = false;
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockQuotaRows, isLoading: mockQuotaLoading }),
}));

const mockFetchUserLimits = jest.fn();
jest.mock('@kiko/prices/eodhd/eodhd.client', () => ({
  ...jest.requireActual('@kiko/prices/eodhd/eodhd.client'),
  fetchUserLimits: (...args: unknown[]) => mockFetchUserLimits(...args),
}));

const mockSaveEodhdKey = jest.fn();
const mockHasEodhdKey = jest.fn();
const mockClearEodhdKey = jest.fn();
const mockReadEodhdKey = jest.fn();
jest.mock('@kiko/prices/eodhd-key/eodhd-key', () => ({
  saveEodhdKey: (...args: unknown[]) => mockSaveEodhdKey(...args),
  hasEodhdKey: () => mockHasEodhdKey(),
  clearEodhdKey: () => mockClearEodhdKey(),
  readEodhdKey: () => mockReadEodhdKey(),
}));

const mockUpdateQuoteQuota = jest.fn();
const mockConfirmDailyLimit = jest.fn();
const mockRecheckRejectedKey = jest.fn();
jest.mock('@kiko/prices/daily-limit/daily-limit', () => ({
  ...jest.requireActual('@kiko/prices/daily-limit/daily-limit'),
  confirmDailyLimit: () => mockConfirmDailyLimit(),
  recheckRejectedKey: () => mockRecheckRejectedKey(),
}));

jest.mock('@kiko/settings', () => {
  const actual = jest.requireActual('@kiko/settings');

  return {
    ...actual,
    settingsRepo: {
      ...actual.settingsRepo,
      updateQuoteQuota: (...args: unknown[]) => mockUpdateQuoteQuota(...args),
    },
  };
});

jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: jest.fn().mockResolvedValue(''),
}));

import SharePricesScreen from './share-prices.screen';

const KEY = 'fake-eodhd-key-0000';
const PLACEHOLDER = 'Paste your EODHD key';
const DAY_MS = 24 * 60 * 60 * 1000;
const TODAY = Date.UTC(2026, 9, 1);
const NOW = TODAY + 9 * 60 * 60 * 1000;
// Midnight GMT is 03:00 in Kyiv (summer time), the zone Jest runs in.
const USED_UP = 'Today’s EODHD requests are used up. Prices update again after 03:00.';
const KEY_REJECTED =
  'EODHD no longer accepts the saved key, so share prices are not updating. Save a new key, or check this one again.';

const storeQuota = (overrides: Partial<QuoteQuota> = {}): void => {
  mockQuotaRows = [
    { quoteQuota: { day: TODAY, calls: 3, dailyLimit: 20, symbols: [], ...overrides } },
  ];
};

const renderScreen = () =>
  render(
    <SharePricesScreen
      navigation={asNavigationProp(navigationSpy())}
      route={asRouteProp('SharePrices')}
    />,
  );

describe('SharePricesScreen', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    mockFetchUserLimits
      .mockReset()
      .mockResolvedValue({ dailyLimit: 20, requestsToday: 3, requestsDay: Date.UTC(2026, 8, 30) });
    mockSaveEodhdKey.mockReset().mockResolvedValue(undefined);
    mockHasEodhdKey.mockReset().mockResolvedValue(false);
    mockClearEodhdKey.mockReset().mockResolvedValue(undefined);
    mockReadEodhdKey.mockReset();
    mockUpdateQuoteQuota.mockReset().mockResolvedValue(undefined);
    mockConfirmDailyLimit.mockReset().mockResolvedValue(undefined);
    mockRecheckRejectedKey.mockReset().mockResolvedValue({ isAccepted: true });
    mockOpenURL.mockReset();
    mockQuotaRows = [];
    mockQuotaLoading = false;
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('states that the user brings an own EODHD key, what goes to EODHD, and its terms', async () => {
    const { findByText } = await renderScreen();

    expect(
      await findByText(
        'Kiko gets end-of-day share prices from EODHD with your own API key. To do this, Kiko sends EODHD your share tickers, the date range of the prices it needs (from your first purchase on), and your searches, but never how many shares you hold or what they cost. You sign up with EODHD and accept its terms. The key is saved only on this iPhone and in exports that include keys.',
      ),
    ).toBeTruthy();
  });

  it('opens the free EODHD sign-up page from a link', async () => {
    const { findByRole } = await renderScreen();

    const link = await findByRole('link', {
      name: 'Get a free key at https://eodhd.com/register.',
    });
    await fireEvent.press(link);

    expect(mockOpenURL).toHaveBeenCalledWith('https://eodhd.com/register');
  });

  describe('requests today', () => {
    it("shows the stored day's requests against the daily limit once a key is saved", async () => {
      mockHasEodhdKey.mockResolvedValue(true);
      storeQuota({ calls: 3 });
      const { findByText } = await renderScreen();

      expect(await findByText('Requests today: 3 / 20')).toBeTruthy();
    });

    it('counts none used on a quota stored on an earlier UTC day', async () => {
      mockHasEodhdKey.mockResolvedValue(true);
      storeQuota({ day: TODAY - DAY_MS, calls: 20 });
      const { findByText } = await renderScreen();

      expect(await findByText('Requests today: 0 / 20')).toBeTruthy();
    });

    it('counts none used and the free limit with no stored quota', async () => {
      mockHasEodhdKey.mockResolvedValue(true);
      const { findByText } = await renderScreen();

      expect(await findByText('Requests today: 0 / 20')).toBeTruthy();
    });

    it('never counts past the daily limit', async () => {
      mockHasEodhdKey.mockResolvedValue(true);
      storeQuota({ calls: 25 });
      const { findByText } = await renderScreen();

      expect(await findByText('Requests today: 20 / 20')).toBeTruthy();
    });

    it('formats the counts for the active language', async () => {
      mockHasEodhdKey.mockResolvedValue(true);
      storeQuota({ calls: 1500, dailyLimit: 100_000 });
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
      const { findByText } = await renderScreen();

      expect(
        await findByText(
          `Запити сьогодні: ${(1500).toLocaleString('uk-UA')} / ${(100_000).toLocaleString('uk-UA')}`,
        ),
      ).toBeTruthy();
    });

    it('shows nothing without a saved key', async () => {
      storeQuota({ calls: 20 });
      const { queryByText } = await renderScreen();

      await waitFor(() => expect(mockHasEodhdKey).toHaveBeenCalled());

      expect(queryByText(/Requests today/)).toBeNull();
      expect(queryByText(USED_UP)).toBeNull();
    });

    it('shows nothing while the stored quota is still loading', async () => {
      mockHasEodhdKey.mockResolvedValue(true);
      mockQuotaLoading = true;
      const { findByText, queryByText } = await renderScreen();

      await findByText('Key saved');

      expect(queryByText(/Requests today/)).toBeNull();
    });
  });

  describe('used-up banner', () => {
    it("shows on a day the key's requests are used up, with the reset in the device's time", async () => {
      mockHasEodhdKey.mockResolvedValue(true);
      storeQuota({ calls: 20 });
      const { findByText } = await renderScreen();

      expect(await findByText(USED_UP)).toBeTruthy();
    });

    it('names the reset time in Ukrainian too', async () => {
      mockHasEodhdKey.mockResolvedValue(true);
      storeQuota({ calls: 20 });
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
      const { findByText } = await renderScreen();

      expect(
        await findByText('Сьогоднішні запити EODHD вичерпано. Ціни знову оновляться після 03:00.'),
      ).toBeTruthy();
    });

    it.each([
      ['requests are left today', { calls: 19 }],
      ['the used-up day is over', { day: TODAY - DAY_MS, calls: 20 }],
    ])('stays hidden while %s', async (_case, quota) => {
      mockHasEodhdKey.mockResolvedValue(true);
      storeQuota(quota);
      const { findByText, queryByText } = await renderScreen();

      await findByText(/Requests today/);

      expect(queryByText(USED_UP)).toBeNull();
    });
  });

  describe('rejected-key banner', () => {
    it('shows while EODHD rejects the saved key', async () => {
      mockHasEodhdKey.mockResolvedValue(true);
      storeQuota({ isKeyRejected: true });
      const { findByTestId, findByText } = await renderScreen();

      expect(await findByTestId('share-prices-key-rejected-banner')).toBeTruthy();
      expect(await findByText(KEY_REJECTED)).toBeTruthy();
    });

    it('stays hidden while EODHD accepts the key', async () => {
      mockHasEodhdKey.mockResolvedValue(true);
      storeQuota();
      const { findByText, queryByText } = await renderScreen();

      await findByText(/Requests today/);

      expect(queryByText(KEY_REJECTED)).toBeNull();
    });

    it('stays hidden without a saved key', async () => {
      storeQuota({ isKeyRejected: true });
      const { queryByText } = await renderScreen();

      await waitFor(() => expect(mockHasEodhdKey).toHaveBeenCalled());

      expect(queryByText(KEY_REJECTED)).toBeNull();
    });

    it('checks the key again on Check again', async () => {
      mockHasEodhdKey.mockResolvedValue(true);
      storeQuota({ isKeyRejected: true });
      const { findByText } = await renderScreen();

      await fireEvent.press(await findByText('Check again'));

      await waitFor(() => expect(mockRecheckRejectedKey).toHaveBeenCalledTimes(1));
    });

    it.each([
      ['still rejects it', new EodhdAuthError(), 'EODHD did not accept this key.'],
      ['cannot be reached', new EodhdServerError(), 'Could not reach EODHD. Try again.'],
    ])('says so when EODHD %s', async (_case, error, message) => {
      mockHasEodhdKey.mockResolvedValue(true);
      mockRecheckRejectedKey.mockResolvedValue({ isAccepted: false, error });
      storeQuota({ isKeyRejected: true });
      const { findByText } = await renderScreen();

      await fireEvent.press(await findByText('Check again'));

      expect(await findByText(message)).toBeTruthy();
    });
  });

  it('shows the required error on a blank Save and never calls EODHD', async () => {
    const { getByTestId, findByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));

    expect(await findByText('Enter an API key.')).toBeTruthy();
    expect(mockFetchUserLimits).not.toHaveBeenCalled();
    expect(mockSaveEodhdKey).not.toHaveBeenCalled();
  });

  it('checks the key with EODHD and stores it, with no daily limit caption', async () => {
    const { getByTestId, getByPlaceholderText, findByText, queryByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), `  ${KEY} `);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));

    expect(await findByText('Key saved')).toBeTruthy();
    expect(queryByText(/Daily limit/)).toBeNull();
    expect(mockFetchUserLimits).toHaveBeenCalledWith(KEY);
    expect(mockSaveEodhdKey).toHaveBeenCalledWith(KEY);
    expect(getByPlaceholderText(PLACEHOLDER).props.value).toBe('');
  });

  it("stores the key's own daily limit and EODHD's count for its day", async () => {
    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), KEY);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));
    await findByText('Key saved');

    const [[build]] = mockUpdateQuoteQuota.mock.calls as [[(stored: null) => unknown]];
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 30, 12));

    expect(build(null)).toEqual({
      day: Date.UTC(2026, 8, 30),
      calls: 3,
      dailyLimit: 20,
      symbols: [],
      keyGeneration: 1,
    });
  });

  it('starts the day over for a key EODHD reports no request today for', async () => {
    const previousKey: QuoteQuota = {
      day: TODAY,
      calls: 20,
      dailyLimit: 20,
      symbols: ['AAPL.US'],
      isKeyRejected: true,
      keyGeneration: 4,
    };
    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), KEY);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));
    await findByText('Key saved');

    const [[build]] = mockUpdateQuoteQuota.mock.calls as [[(stored: QuoteQuota) => unknown]];

    expect(build(previousKey)).toEqual({
      day: TODAY,
      calls: 0,
      dailyLimit: 20,
      symbols: [],
      keyGeneration: 5,
    });
  });

  it('stores the key before its quota, so a refresh never pairs the old key with it', async () => {
    const order: string[] = [];
    mockSaveEodhdKey.mockImplementation(async () => order.push('key'));
    mockUpdateQuoteQuota.mockImplementation(async () => order.push('quota'));
    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), KEY);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));
    await findByText('Key saved');

    expect(order).toEqual(['key', 'quota']);
  });

  it('checks a daily limit EODHD has not confirmed once, on open', async () => {
    await renderScreen();

    await waitFor(() => expect(mockConfirmDailyLimit).toHaveBeenCalledTimes(1));
  });

  it('stores a key EODHD answered with its daily limit, and marks the day used up', async () => {
    mockFetchUserLimits.mockRejectedValue(new EodhdQuotaError());
    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), KEY);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));

    expect(await findByText('Key saved')).toBeTruthy();
    expect(mockSaveEodhdKey).toHaveBeenCalledWith(KEY);

    const [[build]] = mockUpdateQuoteQuota.mock.calls as [[(stored: null) => unknown]];

    expect(build(null)).toEqual({
      day: TODAY,
      calls: 20,
      dailyLimit: 20,
      symbols: [],
      isLimitUnconfirmed: true,
      keyGeneration: 1,
    });
  });

  it('stores a key EODHD answered with its per-minute limit, its limit left unconfirmed and its day started over', async () => {
    mockFetchUserLimits.mockRejectedValue(new EodhdRateLimitError());
    const stored: QuoteQuota = { day: TODAY, calls: 4, dailyLimit: 100, symbols: ['AAPL.US'] };
    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), KEY);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));

    expect(await findByText('Key saved')).toBeTruthy();
    expect(mockSaveEodhdKey).toHaveBeenCalledWith(KEY);

    const [[build]] = mockUpdateQuoteQuota.mock.calls as [[(stored: QuoteQuota) => unknown]];

    expect(build(stored)).toEqual({
      ...stored,
      calls: 0,
      symbols: [],
      isLimitUnconfirmed: true,
      keyGeneration: 1,
    });
  });

  it('removes the new key again when its quota cannot be stored', async () => {
    mockUpdateQuoteQuota.mockRejectedValue(new Error('disk full'));
    const { getByTestId, getByPlaceholderText, queryByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), KEY);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));

    await waitFor(() => expect(mockClearEodhdKey).toHaveBeenCalledTimes(1));
    expect(queryByText('Key saved')).toBeNull();
  });

  it('stores nothing when EODHD rejects the key', async () => {
    mockFetchUserLimits.mockRejectedValue(new EodhdAuthError());
    const { getByTestId, getByPlaceholderText, findByText, queryByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), KEY);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));

    expect(await findByText('EODHD did not accept this key.')).toBeTruthy();
    expect(mockSaveEodhdKey).not.toHaveBeenCalled();
    expect(queryByText('Key saved')).toBeNull();
  });

  it.each([
    ['answers with nothing usable', new EodhdUnavailableError()],
    ['fails on its side', new EodhdServerError()],
  ])('stores nothing when EODHD %s', async (_case, error) => {
    mockFetchUserLimits.mockRejectedValue(error);
    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), KEY);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));

    expect(await findByText('Could not reach EODHD. Try again.')).toBeTruthy();
    expect(mockSaveEodhdKey).not.toHaveBeenCalled();
  });

  it('keeps Save pressable but disabled while the key is being checked', async () => {
    mockFetchUserLimits.mockReturnValue(new Promise(() => undefined));
    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), KEY);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));

    expect(await findByText('Checking…')).toBeTruthy();
    expect(getByTestId('settings-button-save-eodhd-key').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('shows a saved key only as a saved state, never reading or pre-filling it', async () => {
    mockHasEodhdKey.mockResolvedValue(true);
    const { getByPlaceholderText, findByText } = await renderScreen();

    expect(await findByText('Key saved')).toBeTruthy();
    expect(getByPlaceholderText(PLACEHOLDER).props.value).toBe('');
    expect(mockReadEodhdKey).not.toHaveBeenCalled();
  });

  it('removes the saved key after the user confirms', async () => {
    mockHasEodhdKey.mockResolvedValue(true);
    const { findByTestId, getByTestId, findByText, queryByText } = await renderScreen();

    await fireEvent.press(await findByTestId('settings-button-remove-eodhd-key'));

    expect(await findByText('Remove Key?')).toBeTruthy();
    expect(await findByText('Shares priced by EODHD keep their last price.')).toBeTruthy();

    await fireEvent.press(getByTestId('settings-confirm-remove-eodhd-key'));

    await waitFor(() => expect(mockClearEodhdKey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(queryByText('Key saved')).toBeNull());
  });

  it('keeps the key when the user cancels the remove confirm', async () => {
    mockHasEodhdKey.mockResolvedValue(true);
    const { findByTestId, getByText, findByText } = await renderScreen();

    await fireEvent.press(await findByTestId('settings-button-remove-eodhd-key'));
    await fireEvent.press(getByText('Cancel'));

    expect(mockClearEodhdKey).not.toHaveBeenCalled();
    expect(await findByText('Key saved')).toBeTruthy();
  });
});
