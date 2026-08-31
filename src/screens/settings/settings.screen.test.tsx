import { act, fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import SettingsScreen from './settings.screen';

const mockSetBaseCurrency = jest.fn();
const mockSaveToken = jest.fn();
const mockReadToken = jest.fn<Promise<string | undefined>, []>();
const mockFetchClientInfo = jest.fn();
const mockOpenURL = jest.fn();
const mockGetString = jest.fn<Promise<string>, []>();
let mockLiveQueryData: Array<{ baseCurrency: string; lastSyncAt: number | null }> = [
  { baseCurrency: 'UAH', lastSyncAt: null },
];

jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setBaseCurrency: (...args: unknown[]) => mockSetBaseCurrency(...args),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockLiveQueryData }),
}));
jest.mock('../../monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
  readToken: () => mockReadToken(),
}));
jest.mock('../../monobank/monobank.client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: { openURL: (...args: unknown[]) => mockOpenURL(...args) },
}));
jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: () => mockGetString(),
}));

/** Resolves and rejects deferred outside the executor, for controlling async timing in tests. */
const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadToken.mockResolvedValue(undefined);
    mockSaveToken.mockResolvedValue(undefined);
    mockLiveQueryData = [{ baseCurrency: 'UAH', lastSyncAt: null }];
  });

  it('does not render an in-screen "Settings" title (the native header provides it)', async () => {
    const { queryByText } = await render(<SettingsScreen />);
    expect(queryByText('Settings')).toBeNull();
  });

  it('shows the current base currency', async () => {
    const { getByText } = await render(<SettingsScreen />);
    expect(getByText(/UAH/)).toBeTruthy();
  });

  it('calls setBaseCurrency when a currency option is pressed', async () => {
    const { getByText } = await render(<SettingsScreen />);
    await fireEvent.press(getByText('USD'));
    expect(mockSetBaseCurrency).toHaveBeenCalledWith('USD');
  });

  it('prefills the token input from readToken', async () => {
    mockReadToken.mockResolvedValue('existing-token');
    const { findByDisplayValue } = await render(<SettingsScreen />);
    expect(await findByDisplayValue('existing-token')).toBeTruthy();
  });

  it('does not overwrite the token the user is typing once readToken resolves late', async () => {
    const pending = deferred<string | undefined>();
    mockReadToken.mockReturnValue(pending.promise);
    const { getByPlaceholderText, findByDisplayValue } = await render(<SettingsScreen />);

    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'user-typed');

    // Resolve readToken() and let its effect callback run to completion (and
    // any resulting setState flush) before asserting on the rendered value.
    await act(async () => {
      pending.resolve('existing-token');
      await pending.promise;
    });

    expect(await findByDisplayValue('user-typed')).toBeTruthy();
  });

  it('opens api.monobank.ua when "Open api.monobank.ua" is pressed', async () => {
    const { getByText } = await render(<SettingsScreen />);
    await fireEvent.press(getByText('Open api.monobank.ua'));
    expect(mockOpenURL).toHaveBeenCalledWith('https://api.monobank.ua/');
  });

  it('fills the token field from the clipboard when "Paste from clipboard" is pressed', async () => {
    mockGetString.mockResolvedValue('clipboard-token');
    const { getByText, findByDisplayValue } = await render(<SettingsScreen />);
    await act(async () => {
      await fireEvent.press(getByText('Paste from clipboard'));
    });
    expect(await findByDisplayValue('clipboard-token')).toBeTruthy();
  });

  it('validates the token and calls saveToken when fetchClientInfo accepts it', async () => {
    mockFetchClientInfo.mockResolvedValue({ name: 'Jane Doe' });
    const { getByPlaceholderText, getByText, findByText } = await render(<SettingsScreen />);
    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'new-token');
    await act(async () => {
      await fireEvent.press(getByText('Save'));
    });
    expect(mockFetchClientInfo).toHaveBeenCalledWith('new-token');
    expect(mockSaveToken).toHaveBeenCalledWith('new-token');
    expect(await findByText(/Connected as Jane Doe/)).toBeTruthy();
  });

  it('does not call saveToken and shows an error when fetchClientInfo rejects the token', async () => {
    mockFetchClientInfo.mockRejectedValue(new Error('Monobank request failed: 401'));
    const { getByPlaceholderText, getByText, findByText } = await render(<SettingsScreen />);
    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'bad-token');
    await act(async () => {
      await fireEvent.press(getByText('Save'));
    });
    expect(mockFetchClientInfo).toHaveBeenCalledWith('bad-token');
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(await findByText('Invalid token')).toBeTruthy();
  });

  it('shows a distinct save-error (not "Invalid token") when fetchClientInfo accepts the token but saveToken rejects', async () => {
    mockFetchClientInfo.mockResolvedValue({ name: 'Jane Doe' });
    mockSaveToken.mockRejectedValue(new Error('Keychain write failed'));
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <SettingsScreen />,
    );
    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'valid-token');
    await act(async () => {
      await fireEvent.press(getByText('Save'));
    });
    expect(mockFetchClientInfo).toHaveBeenCalledWith('valid-token');
    expect(mockSaveToken).toHaveBeenCalledWith('valid-token');
    expect(await findByText('Could not save token')).toBeTruthy();
    expect(queryByText('Invalid token')).toBeNull();
    expect(queryByText(/Connected as/)).toBeNull();
  });

  it('clears a stale save-result status line when the token text is edited afterward', async () => {
    mockFetchClientInfo.mockResolvedValue({ name: 'Jane Doe' });
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <SettingsScreen />,
    );
    const input = getByPlaceholderText('Monobank token');
    await fireEvent.changeText(input, 'valid-token');
    await act(async () => {
      await fireEvent.press(getByText('Save'));
    });
    expect(await findByText(/Connected as Jane Doe/)).toBeTruthy();

    await fireEvent.changeText(input, 'valid-token-2');
    expect(queryByText(/Connected as Jane Doe/)).toBeNull();
  });

  it('shows the last sync time from the live settings row', async () => {
    mockLiveQueryData = [{ baseCurrency: 'UAH', lastSyncAt: 1700000000000 }];
    const { getByText, queryByText } = await render(<SettingsScreen />);
    expect(queryByText(/Never/i)).toBeNull();
    expect(getByText(new RegExp(new Date(1700000000000).toLocaleString()))).toBeTruthy();
  });

  it('shows "Never" when there is no last sync time', async () => {
    const { getByText } = await render(<SettingsScreen />);
    expect(getByText(/Never/i)).toBeTruthy();
  });

  it('does not render a Sync button (sync is per-account now)', async () => {
    const { queryByText } = await render(<SettingsScreen />);
    expect(queryByText('Sync')).toBeNull();
  });
});
