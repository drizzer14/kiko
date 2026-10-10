import { act, fireEvent, render } from '@testing-library/react-native';
import { createRef, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { ConnectReminder } from '@kiko/design-system/connect-reminder';

import BinanceCredentialsField from '.';

const mockFetchAccount = jest.fn();
const mockSaveCredentials = jest.fn();
const mockOpenURL = jest.fn();
const mockGetString = jest.fn<Promise<string>, []>();

jest.mock('@kiko/crypto-sync/binance/binance.client', () => ({
  fetchAccount: (...args: unknown[]) => mockFetchAccount(...args),
}));
jest.mock('@kiko/crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
}));
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: { openURL: (...args: unknown[]) => mockOpenURL(...args) },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

// The Text primitive's tone -> color mapping lives in a react-native-unistyles
// variant that the project's Jest mock strips before a test can inspect it.
// Mock Text here — following the account-detail screen test precedent — so the
// resolved `tone` the link renders with is observable via a testID, while the
// label still renders as plain text so every getByText assertion is unaffected.
jest.mock('@kiko/design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone, children }: { tone?: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

type View = Awaited<ReturnType<typeof render>>;
type OnConnect = ComponentProps<typeof BinanceCredentialsField>['onConnect'];
type OnStoredWhileUnmounted = ComponentProps<
  typeof BinanceCredentialsField
>['onStoredWhileUnmounted'];

const fillBoth = async (getByPlaceholderText: View['getByPlaceholderText']): Promise<void> => {
  await fireEvent.changeText(getByPlaceholderText('Binance API key'), 'api-key-fixture');
  await fireEvent.changeText(getByPlaceholderText('Binance API secret'), 'secret-fixture');
};

const fieldElement = (
  onConnect: OnConnect,
  reminder?: ConnectReminder,
  onStoredWhileUnmounted?: OnStoredWhileUnmounted,
): ReactElement => (
  <BinanceCredentialsField
    accountId="acc-1"
    onConnect={onConnect}
    reminder={reminder}
    onStoredWhileUnmounted={onStoredWhileUnmounted}
  />
);

const renderField = (
  onConnect: OnConnect,
  reminder?: ConnectReminder,
  onStoredWhileUnmounted?: OnStoredWhileUnmounted,
): Promise<View> => render(fieldElement(onConnect, reminder, onStoredWhileUnmounted));

const pressConnect = async (view: View): Promise<void> => {
  await act(async () => {
    await fireEvent.press(view.getByText('Connect Binance'));
  });
};

const renderAndConnect = async (
  onConnect: OnConnect,
  onStoredWhileUnmounted?: OnStoredWhileUnmounted,
): Promise<View> => {
  const view = await renderField(onConnect, undefined, onStoredWhileUnmounted);

  await fillBoth(view.getByPlaceholderText);
  await pressConnect(view);

  return view;
};

describe('BinanceCredentialsField', () => {
  const onConnect = jest.fn<Promise<boolean>, []>();

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAccount.mockResolvedValue({ balances: [] });
    mockSaveCredentials.mockResolvedValue(undefined);
    onConnect.mockResolvedValue(true);
  });

  it('renders two secure inputs, a Binance link and a Connect Binance action', async () => {
    const { getByPlaceholderText, getByText } = await renderField(onConnect);

    expect(getByPlaceholderText('Binance API key').props.secureTextEntry).toBe(true);
    expect(getByPlaceholderText('Binance API secret').props.secureTextEntry).toBe(true);
    expect(getByText('Open Binance API management')).toBeTruthy();
    expect(getByText('Connect Binance')).toBeTruthy();
  });

  it('uses the lock glyph for Connect and the Kiko UI clipboard glyph for both Paste buttons', async () => {
    const { root } = await renderField(onConnect);

    // Connect carries the `lock` glyph; both paste buttons (key + secret) carry
    // the Kiko UI `document.on.clipboard` spelling (SFSymbolView forwards `name`).
    expect((root?.queryAll((node) => node.props.name === 'lock') ?? []).length).toBeGreaterThan(0);
    expect(
      (root?.queryAll((node) => node.props.name === 'document.on.clipboard') ?? []).length,
    ).toBe(2);
  });

  it('shows a required error per blank field and calls no network when Connect is pressed', async () => {
    const view = await renderField(onConnect);

    // Neither field entered.
    await pressConnect(view);
    expect(await view.findByText('Enter the API key.')).toBeTruthy();
    expect(await view.findByText('Enter the secret key.')).toBeTruthy();
    expect(mockFetchAccount).not.toHaveBeenCalled();

    // Only the API key entered — its own reason clears, the secret's stays.
    await fireEvent.changeText(view.getByPlaceholderText('Binance API key'), 'api-key-fixture');
    await pressConnect(view);
    expect(view.queryByText('Enter the API key.')).toBeNull();
    expect(await view.findByText('Enter the secret key.')).toBeTruthy();
    expect(mockFetchAccount).not.toHaveBeenCalled();
  });

  it('renders the Binance link through the shared Text primitive with the accent tone', async () => {
    const { getByText } = await renderField(onConnect);

    // The link reads as a tappable inline label via the shared `Text` tone
    // token, matching the pie legend's "Show all" toggle, rather than an
    // inline-styled raw RN `Text`.
    expect(getByText('Open Binance API management').props.testID).toBe('text-tone-accent');
  });

  it('opens the Binance API management page from the link', async () => {
    const { getByText } = await renderField(onConnect);

    await fireEvent.press(getByText('Open Binance API management'));

    expect(mockOpenURL).toHaveBeenCalledWith(
      'https://app.binance.com/en/my/settings/api-management',
    );
  });

  it('pastes into the key and the secret fields separately, trimmed', async () => {
    const { getByLabelText, getByPlaceholderText } = await renderField(onConnect);

    mockGetString.mockResolvedValue(' api-key-fixture ');
    await act(async () => {
      await fireEvent.press(getByLabelText('Paste API key from clipboard'));
    });
    mockGetString.mockResolvedValue('secret-fixture\n');
    await act(async () => {
      await fireEvent.press(getByLabelText('Paste API secret from clipboard'));
    });

    expect(getByPlaceholderText('Binance API key').props.value).toBe('api-key-fixture');
    expect(getByPlaceholderText('Binance API secret').props.value).toBe('secret-fixture');
  });

  it('verifies the pair with one fetchAccount call, saves it, connects, and shows success', async () => {
    const { findByText } = await renderAndConnect(onConnect);

    expect(mockFetchAccount).toHaveBeenCalledTimes(1);
    expect(mockFetchAccount).toHaveBeenCalledWith('api-key-fixture', 'secret-fixture');
    expect(mockSaveCredentials).toHaveBeenCalledWith('acc-1', {
      apiKey: 'api-key-fixture',
      secret: 'secret-fixture',
    });
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(await findByText('Binance connected')).toBeTruthy();
  });

  it('shows an invalid status and saves nothing when Binance rejects the pair', async () => {
    mockFetchAccount.mockRejectedValue(
      new Error('Binance request failed: 401: Invalid API-key, IP, or permissions for action.'),
    );
    const { findByText } = await renderAndConnect(onConnect);

    expect(await findByText('Invalid API key or secret')).toBeTruthy();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('shows a distinct save error and does not connect when the Keychain write fails', async () => {
    mockSaveCredentials.mockRejectedValue(new Error('Keychain write failed'));
    const { findByText, queryByText } = await renderAndConnect(onConnect);

    expect(await findByText('Could not save credentials')).toBeTruthy();
    expect(queryByText('Invalid API key or secret')).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('shows a connect error when the pair saved but the sync failed', async () => {
    onConnect.mockResolvedValue(false);
    const { findByText } = await renderAndConnect(onConnect);

    expect(await findByText('Could not connect Binance')).toBeTruthy();
  });

  describe('once unmounted', () => {
    const pendingFetch = (): { resolve: () => void } => {
      const pending = { resolve: () => {} };
      mockFetchAccount.mockImplementation(
        () =>
          new Promise((resolve) => {
            pending.resolve = () => resolve({ balances: [] });
          }),
      );

      return pending;
    };

    // A field a fold or a kind switch replaced must not store the pair its check verified, nor
    // run the screen's connect: that would insert the account row after the new form looked for it.
    const pendingSave = (): { resolve: () => void } => {
      const pending = { resolve: () => {} };
      mockSaveCredentials.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            pending.resolve = resolve;
          }),
      );

      return pending;
    };

    const onStoredWhileUnmounted = jest.fn<Promise<void>, []>();

    beforeEach(() => {
      onStoredWhileUnmounted.mockResolvedValue(undefined);
    });

    it('stores nothing and reports nothing when the check resolves after the field unmounted', async () => {
      const pending = pendingFetch();
      const view = await renderAndConnect(onConnect, onStoredWhileUnmounted);

      await view.unmount();
      await act(async () => {
        pending.resolve();
      });

      expect(mockSaveCredentials).not.toHaveBeenCalled();
      expect(onConnect).not.toHaveBeenCalled();
      expect(onStoredWhileUnmounted).not.toHaveBeenCalled();
    });

    // The pair is in the Keychain by then and the screen that owns the field decides what to do
    // with it; connecting would insert an account row after the form that replaced this one looked.
    it('reports the stored pair instead of connecting when the field unmounted during the write', async () => {
      const pending = pendingSave();
      const view = await renderAndConnect(onConnect, onStoredWhileUnmounted);

      await view.unmount();
      await act(async () => {
        pending.resolve();
      });

      expect(onStoredWhileUnmounted).toHaveBeenCalledTimes(1);
      expect(onConnect).not.toHaveBeenCalled();
    });

    it('does nothing more when the field unmounted during the write and no screen listens', async () => {
      const pending = pendingSave();
      const view = await renderAndConnect(onConnect);

      await view.unmount();
      await act(async () => {
        pending.resolve();
      });

      expect(mockSaveCredentials).toHaveBeenCalledTimes(1);
      expect(onConnect).not.toHaveBeenCalled();
    });

    it('still stores the pair and connects once, reporting nothing, when the field stays mounted', async () => {
      const pending = pendingFetch();

      await renderAndConnect(onConnect, onStoredWhileUnmounted);
      await act(async () => {
        pending.resolve();
      });

      expect(mockSaveCredentials).toHaveBeenCalledTimes(1);
      expect(onConnect).toHaveBeenCalledTimes(1);
      expect(onStoredWhileUnmounted).not.toHaveBeenCalled();
    });
  });

  it('shows the Keychain-only data-handling disclosure as a secondary caption', async () => {
    const { getByText } = await renderField(onConnect);

    const disclosure = getByText(
      "Your Binance API key is stored only in your device's Keychain, used only to fetch your own data directly from Binance, and is never sent to Kiko or any server.",
    );

    expect(disclosure).toBeTruthy();
    expect(disclosure.props.testID).toBe('text-tone-textSecondary');
  });

  it('clears a stale status when either field is edited afterward', async () => {
    mockFetchAccount.mockRejectedValue(new Error('Binance request failed: 401'));
    const { getByPlaceholderText, findByText, queryByText } = await renderAndConnect(onConnect);

    expect(await findByText('Invalid API key or secret')).toBeTruthy();

    await fireEvent.changeText(getByPlaceholderText('Binance API secret'), 'secret-fixture-2');
    expect(queryByText('Invalid API key or secret')).toBeNull();
  });
});

describe('BinanceCredentialsField — localization', () => {
  const onConnect = jest.fn<Promise<boolean>, []>();

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the link, field placeholders, and action from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByPlaceholderText, getByText, queryByText } = await renderField(onConnect);

    expect(getByPlaceholderText('API ключ Binance')).toBeTruthy();
    expect(getByPlaceholderText('API секрет Binance')).toBeTruthy();
    expect(getByText('Відкрити керування API Binance')).toBeTruthy();
    expect(getByText('Підключити Binance')).toBeTruthy();
    expect(queryByText('Connect Binance')).toBeNull();
  });
});

describe('BinanceCredentialsField — connect reminder', () => {
  const makeReminder = (message?: string): ConnectReminder => ({
    ref: createRef<FieldInstance>(),
    message,
    onDraftChange: jest.fn(),
    onConnectPress: jest.fn(),
  });

  // The reminder is the subject of every case here, so most cases render it with a bare connect.
  const renderWithReminder = (
    reminder: ConnectReminder,
    onConnect: OnConnect = jest.fn(),
  ): Promise<View> => renderField(onConnect, reminder);

  const apiKeyPlaceholder = 'Binance API key';
  const secretPlaceholder = 'Binance API secret';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the reminder message under the Connect button, and nothing without one', async () => {
    const reminder = makeReminder('Tap Connect first.');
    const view = await renderWithReminder(reminder);

    expect(view.getByText('Tap Connect first.')).toBeTruthy();
    expect(view.getByLabelText('Tap Connect first.')).toBeTruthy();
    expect(view.root?.queryAll((node) => node.props.name === 'info.circle').length).toBeGreaterThan(
      0,
    );

    await view.rerender(fieldElement(jest.fn(), { ...reminder, message: undefined }));

    expect(view.queryByText('Tap Connect first.')).toBeNull();
    expect(view.root?.queryAll((node) => node.props.name === 'info.circle')).toHaveLength(0);
  });

  it('attaches the reminder ref to the Connect row so a blocked Save can scroll to it', async () => {
    const reminder = makeReminder();
    await renderWithReminder(reminder);

    expect(reminder.ref.current).not.toBeNull();
  });

  it('reports a typed key or secret on every edit, until both are blank', async () => {
    const reminder = makeReminder();
    const view = await renderWithReminder(reminder);

    await fireEvent.changeText(view.getByPlaceholderText(apiKeyPlaceholder), 'key');
    expect(reminder.onDraftChange).toHaveBeenLastCalledWith(true);

    await fireEvent.changeText(view.getByPlaceholderText(apiKeyPlaceholder), 'key2');
    expect(reminder.onDraftChange).toHaveBeenCalledTimes(2);
    expect(reminder.onDraftChange).toHaveBeenLastCalledWith(true);

    await fireEvent.changeText(view.getByPlaceholderText(secretPlaceholder), 'secret');
    expect(reminder.onDraftChange).toHaveBeenLastCalledWith(true);

    // The secret alone still counts while the key is cleared.
    await fireEvent.changeText(view.getByPlaceholderText(apiKeyPlaceholder), '  ');
    expect(reminder.onDraftChange).toHaveBeenLastCalledWith(true);

    await fireEvent.changeText(view.getByPlaceholderText(secretPlaceholder), '');
    expect(reminder.onDraftChange).toHaveBeenLastCalledWith(false);
  });

  it('counts a typed secret with a blank key as a draft', async () => {
    const reminder = makeReminder();
    const view = await renderWithReminder(reminder);

    await fireEvent.changeText(view.getByPlaceholderText(secretPlaceholder), 'secret');

    expect(reminder.onDraftChange).toHaveBeenLastCalledWith(true);
  });

  it('reports no typed credential once it unmounts', async () => {
    const reminder = makeReminder();
    const view = await renderWithReminder(reminder);

    await view.unmount();

    expect(reminder.onDraftChange).toHaveBeenCalledWith(false);
  });

  it('does not report on a plain re-render', async () => {
    const reminder = makeReminder();
    const view = await renderWithReminder(reminder);

    await view.rerender(fieldElement(jest.fn(), reminder));

    expect(reminder.onDraftChange).not.toHaveBeenCalled();
  });

  it('reports no typed credential once a connect succeeds, and keeps it while one fails', async () => {
    mockFetchAccount.mockResolvedValue({ balances: [] });
    mockSaveCredentials.mockResolvedValue(undefined);
    const reminder = makeReminder();
    const onConnect = jest.fn<Promise<boolean>, []>().mockResolvedValueOnce(false);
    const view = await renderWithReminder(reminder, onConnect);
    await fillBoth(view.getByPlaceholderText);
    const callsBeforeConnect = (reminder.onDraftChange as jest.Mock).mock.calls.length;

    await pressConnect(view);

    expect(reminder.onDraftChange).toHaveBeenCalledTimes(callsBeforeConnect);

    onConnect.mockResolvedValueOnce(true);
    await pressConnect(view);

    expect(reminder.onDraftChange).toHaveBeenCalledTimes(callsBeforeConnect + 1);
    expect(reminder.onDraftChange).toHaveBeenLastCalledWith(false);
  });

  it('reports a Connect press, blank or not', async () => {
    const reminder = makeReminder();
    const view = await renderWithReminder(reminder);

    await pressConnect(view);

    expect(reminder.onConnectPress).toHaveBeenCalledTimes(1);
  });
});
