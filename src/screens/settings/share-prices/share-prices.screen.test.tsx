import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { EodhdAuthError, EodhdUnavailableError } from '@kiko/prices/eodhd';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

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
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('states that the user brings an own EODHD key and accepts its terms', async () => {
    const { findByText } = await renderScreen();

    expect(
      await findByText(
        'Kiko gets end-of-day share prices from EODHD with your own API key. You sign up with EODHD and accept its terms. The key stays on this iPhone.',
      ),
    ).toBeTruthy();
    expect(await findByText('Get a free key at https://eodhd.com/register.')).toBeTruthy();
  });

  it('shows the required error on a blank Save and never calls EODHD', async () => {
    const { getByTestId, findByText } = await renderScreen();

    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));

    expect(await findByText('Enter an API key.')).toBeTruthy();
    expect(mockFetchUserLimits).not.toHaveBeenCalled();
    expect(mockSaveEodhdKey).not.toHaveBeenCalled();
  });

  it('checks the key with EODHD, stores it, and shows the daily limit', async () => {
    const { getByTestId, getByPlaceholderText, findByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), `  ${KEY} `);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));

    expect(await findByText('Key saved')).toBeTruthy();
    expect(await findByText('Daily limit: 20')).toBeTruthy();
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
    });
  });

  it('keeps the key unsaved when the quota cannot be stored', async () => {
    mockUpdateQuoteQuota.mockRejectedValue(new Error('disk full'));
    const { getByTestId, getByPlaceholderText, queryByText } = await renderScreen();

    await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER), KEY);
    await fireEvent.press(getByTestId('settings-button-save-eodhd-key'));

    await waitFor(() => expect(mockUpdateQuoteQuota).toHaveBeenCalled());
    expect(mockSaveEodhdKey).not.toHaveBeenCalled();
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

  it('stores nothing when EODHD cannot be reached', async () => {
    mockFetchUserLimits.mockRejectedValue(new EodhdUnavailableError());
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
