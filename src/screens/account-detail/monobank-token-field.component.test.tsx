import { act, fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import MonobankTokenField from './monobank-token-field.component';

const mockSaveToken = jest.fn();
const mockReadToken = jest.fn<Promise<string | undefined>, []>();
const mockFetchClientInfo = jest.fn();
const mockOpenURL = jest.fn();
const mockGetString = jest.fn<Promise<string>, []>();

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

describe('MonobankTokenField', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadToken.mockResolvedValue(undefined);
    mockSaveToken.mockResolvedValue(undefined);
  });

  it('prefills the token input from readToken', async () => {
    mockReadToken.mockResolvedValue('existing-token');
    const { findByDisplayValue } = await render(<MonobankTokenField />);
    expect(await findByDisplayValue('existing-token')).toBeTruthy();
  });

  it('does not overwrite the token the user is typing once readToken resolves late', async () => {
    const pending = deferred<string | undefined>();
    mockReadToken.mockReturnValue(pending.promise);
    const { getByPlaceholderText, findByDisplayValue } = await render(<MonobankTokenField />);

    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'user-typed');

    await act(async () => {
      pending.resolve('existing-token');
      await pending.promise;
    });

    expect(await findByDisplayValue('user-typed')).toBeTruthy();
  });

  it('renders the section heading as "Synchronization"', async () => {
    const { getByText } = await render(<MonobankTokenField />);
    expect(getByText('Synchronization')).toBeTruthy();
  });

  it('opens api.monobank.ua when the "Open api.monobank.ua" link is pressed', async () => {
    const { getByText } = await render(<MonobankTokenField />);
    await fireEvent.press(getByText('Open api.monobank.ua'));
    expect(mockOpenURL).toHaveBeenCalledWith('https://api.monobank.ua/');
  });

  it('fills the token field from the clipboard when the paste icon button is pressed', async () => {
    mockGetString.mockResolvedValue('clipboard-token');
    const { getByLabelText, findByDisplayValue } = await render(<MonobankTokenField />);
    await act(async () => {
      await fireEvent.press(getByLabelText('Paste from clipboard'));
    });
    expect(await findByDisplayValue('clipboard-token')).toBeTruthy();
  });

  it('trims surrounding whitespace from a pasted clipboard value', async () => {
    mockGetString.mockResolvedValue('  clipboard-token\n');
    const { getByLabelText, getByPlaceholderText, findByDisplayValue } = await render(
      <MonobankTokenField />,
    );
    await act(async () => {
      await fireEvent.press(getByLabelText('Paste from clipboard'));
    });
    expect(await findByDisplayValue('clipboard-token')).toBeTruthy();
    // Testing Library's display-value matcher normalizes whitespace, so assert
    // the raw prop value directly — this is what catches a missing `.trim()`.
    expect(getByPlaceholderText('Monobank token').props.value).toBe('clipboard-token');
  });

  it('validates the token and calls saveToken when fetchClientInfo accepts it', async () => {
    mockFetchClientInfo.mockResolvedValue({ name: 'Jane Doe' });
    const { getByPlaceholderText, getByText, findByText } = await render(<MonobankTokenField />);
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
    const { getByPlaceholderText, getByText, findByText } = await render(<MonobankTokenField />);
    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'bad-token');
    await act(async () => {
      await fireEvent.press(getByText('Save'));
    });
    expect(mockFetchClientInfo).toHaveBeenCalledWith('bad-token');
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(await findByText('Invalid token')).toBeTruthy();
  });

  it('shows a distinct save-error (not "Invalid token") when saveToken rejects a valid token', async () => {
    mockFetchClientInfo.mockResolvedValue({ name: 'Jane Doe' });
    mockSaveToken.mockRejectedValue(new Error('Keychain write failed'));
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <MonobankTokenField />,
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

  it('shows a "Checking…" line while token validation is in flight', async () => {
    const pending = deferred<{ name: string }>();
    mockFetchClientInfo.mockReturnValue(pending.promise);
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <MonobankTokenField />,
    );
    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'in-flight-token');
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });

    expect(await findByText(/Checking/)).toBeTruthy();

    await act(async () => {
      pending.resolve({ name: 'Jane Doe' });
      await pending.promise;
    });

    expect(queryByText(/Checking/)).toBeNull();
  });

  it('clears a stale save-result status line when the token text is edited afterward', async () => {
    mockFetchClientInfo.mockResolvedValue({ name: 'Jane Doe' });
    const { getByPlaceholderText, getByText, findByText, queryByText } = await render(
      <MonobankTokenField />,
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
});
