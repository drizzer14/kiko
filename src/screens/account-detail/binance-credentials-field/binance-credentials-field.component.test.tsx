import { act, fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';
import BinanceCredentialsField from '../binance-credentials-field';

const mockFetchAccount = jest.fn();
const mockSaveCredentials = jest.fn();
const mockOpenURL = jest.fn();
const mockGetString = jest.fn<Promise<string>, []>();

jest.mock('../../../crypto-sync/binance/binance.client', () => ({
  fetchAccount: (...args: unknown[]) => mockFetchAccount(...args),
}));
jest.mock('../../../crypto-sync/binance/binance.credentials', () => ({
  saveCredentials: (...args: unknown[]) => mockSaveCredentials(...args),
}));
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: { openURL: (...args: unknown[]) => mockOpenURL(...args) },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

const fillBoth = async (
  getByPlaceholderText: Awaited<ReturnType<typeof render>>['getByPlaceholderText'],
): Promise<void> => {
  await fireEvent.changeText(getByPlaceholderText('Binance API key'), 'api-key-fixture');
  await fireEvent.changeText(getByPlaceholderText('Binance API secret'), 'secret-fixture');
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
    const { getByPlaceholderText, getByText } = await render(
      <BinanceCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );

    expect(getByPlaceholderText('Binance API key').props.secureTextEntry).toBe(true);
    expect(getByPlaceholderText('Binance API secret').props.secureTextEntry).toBe(true);
    expect(getByText('Open Binance API Management')).toBeTruthy();
    expect(getByText('Connect Binance')).toBeTruthy();
  });

  it('disables Connect until both the API key and secret are entered', async () => {
    const { getByPlaceholderText, getByRole } = await render(
      <BinanceCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );
    const connect = (): ReturnType<typeof getByRole> =>
      getByRole('button', { name: 'Connect Binance' });

    // Neither field entered.
    expect(connect()).toBeDisabled();

    // Only the API key entered.
    await fireEvent.changeText(getByPlaceholderText('Binance API key'), 'api-key-fixture');
    expect(connect()).toBeDisabled();

    // Both fields entered enables the action.
    await fireEvent.changeText(getByPlaceholderText('Binance API secret'), 'secret-fixture');
    expect(connect()).not.toBeDisabled();
  });

  it('opens the Binance API management page from the link', async () => {
    const { getByText } = await render(
      <BinanceCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );

    await fireEvent.press(getByText('Open Binance API Management'));

    expect(mockOpenURL).toHaveBeenCalledWith(
      'https://app.binance.com/en/my/settings/api-management',
    );
  });

  it('pastes into the key and the secret fields separately, trimmed', async () => {
    const { getByLabelText, getByPlaceholderText } = await render(
      <BinanceCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );

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
    const { getByPlaceholderText, getByText, findByText } = await render(
      <BinanceCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );

    await fillBoth(getByPlaceholderText);
    await act(async () => {
      await fireEvent.press(getByText('Connect Binance'));
    });

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
    const { getByPlaceholderText, getByText, findByText } = await render(
      <BinanceCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );

    await fillBoth(getByPlaceholderText);
    await act(async () => {
      await fireEvent.press(getByText('Connect Binance'));
    });

    expect(await findByText('Invalid API key or secret')).toBeTruthy();
    expect(mockSaveCredentials).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('shows a distinct save error and does not connect when the Keychain write fails', async () => {
    mockSaveCredentials.mockRejectedValue(new Error('Keychain write failed'));
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <BinanceCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );

    await fillBoth(getByPlaceholderText);
    await act(async () => {
      await fireEvent.press(getByText('Connect Binance'));
    });

    expect(await findByText('Could not save credentials')).toBeTruthy();
    expect(queryByText('Invalid API key or secret')).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('shows a connect error when the pair saved but the sync failed', async () => {
    onConnect.mockResolvedValue(false);
    const { getByPlaceholderText, getByText, findByText } = await render(
      <BinanceCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );

    await fillBoth(getByPlaceholderText);
    await act(async () => {
      await fireEvent.press(getByText('Connect Binance'));
    });

    expect(await findByText('Could not connect Binance')).toBeTruthy();
  });

  it('clears a stale status when either field is edited afterward', async () => {
    mockFetchAccount.mockRejectedValue(new Error('Binance request failed: 401'));
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <BinanceCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );

    await fillBoth(getByPlaceholderText);
    await act(async () => {
      await fireEvent.press(getByText('Connect Binance'));
    });
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

    const { getByPlaceholderText, getByText, queryByText } = await render(
      <BinanceCredentialsField accountId="acc-1" onConnect={onConnect} />,
    );

    expect(getByPlaceholderText('API ключ Binance')).toBeTruthy();
    expect(getByPlaceholderText('API секрет Binance')).toBeTruthy();
    expect(getByText('Відкрити керування API Binance')).toBeTruthy();
    expect(getByText('Підключити Binance')).toBeTruthy();
    expect(queryByText('Connect Binance')).toBeNull();
  });
});
