import { act, fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';

import MonobankTokenField from './monobank-token-field.component';

const mockSaveToken = jest.fn();
const mockHasToken = jest.fn<Promise<boolean>, []>();
const mockFetchClientInfo = jest.fn();
const mockOpenURL = jest.fn();
const mockGetString = jest.fn<Promise<string>, []>();

jest.mock('../../../monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
  hasToken: () => mockHasToken(),
}));
jest.mock('../../../monobank/monobank.client', () => ({
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
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

/**
 * Renders the field the way every test here does; `isConnected` is the only
 * variable. Returns the full RNTL query object so each test destructures only
 * the queries it needs.
 */
const renderField = (isConnected = false) => {
  return render(<MonobankTokenField isConnected={isConnected} />);
};

describe('MonobankTokenField', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasToken.mockResolvedValue(false);
    mockSaveToken.mockResolvedValue(undefined);
  });

  it('disables Save until a token is entered', async () => {
    const { getByPlaceholderText, getByRole } = await renderField();
    const save = (): ReturnType<typeof getByRole> => getByRole('button', { name: 'Save' });

    // A blank token field cannot be saved.
    expect(save()).toBeDisabled();

    // A non-empty token enables Save (validity is checked on press).
    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'a-real-token');
    expect(save()).not.toBeDisabled();
  });

  it('never prefills the input from the Keychain', async () => {
    mockHasToken.mockResolvedValue(true);
    const { getByPlaceholderText } = await renderField();

    expect(getByPlaceholderText('Monobank token').props.value).toBe('');
  });

  it('shows a "token saved" indicator when a token is already stored', async () => {
    mockHasToken.mockResolvedValue(true);
    const { findByText } = await renderField();

    expect(await findByText('Token saved')).toBeTruthy();
  });

  it('does not touch the Keychain at all when the account is connected', async () => {
    await renderField(true);

    expect(mockHasToken).not.toHaveBeenCalled();
  });

  it('clears the entered token from state after a successful save', async () => {
    mockFetchClientInfo.mockResolvedValue({ name: 'Test User' });
    const { getByPlaceholderText, getByText, findByText } = await renderField();

    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'a-real-token');
    await fireEvent.press(getByText('Save'));

    expect(await findByText('Connected as Test User')).toBeTruthy();
    expect(getByPlaceholderText('Monobank token').props.value).toBe('');
  });

  it('renders the section heading as "Synchronization"', async () => {
    const { getByText } = await renderField();
    expect(getByText('Synchronization')).toBeTruthy();
  });

  it('opens api.monobank.ua when the "Open api.monobank.ua" link is pressed', async () => {
    const { getByText } = await renderField();
    await fireEvent.press(getByText('Open api.monobank.ua'));
    expect(mockOpenURL).toHaveBeenCalledWith('https://api.monobank.ua/');
  });

  it('fills the token field from the clipboard when the paste icon button is pressed', async () => {
    mockGetString.mockResolvedValue('clipboard-token');
    const { getByLabelText, findByDisplayValue } = await renderField();
    await act(async () => {
      await fireEvent.press(getByLabelText('Paste from clipboard'));
    });
    expect(await findByDisplayValue('clipboard-token')).toBeTruthy();
  });

  it('trims surrounding whitespace from a pasted clipboard value', async () => {
    mockGetString.mockResolvedValue('  clipboard-token\n');
    const { getByLabelText, getByPlaceholderText, findByDisplayValue } = await renderField();
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
    const { getByPlaceholderText, getByText, findByText } = await renderField();
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
    const { getByPlaceholderText, getByText, findByText } = await renderField();
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
    const { getByPlaceholderText, getByText, findByText, queryByText } = await renderField();
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
    const { getByPlaceholderText, getByText, findByText, queryByText } = await renderField();
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
    const { getByPlaceholderText, getByText, findByText, queryByText } = await renderField();
    const input = getByPlaceholderText('Monobank token');
    await fireEvent.changeText(input, 'valid-token');
    await act(async () => {
      await fireEvent.press(getByText('Save'));
    });
    expect(await findByText(/Connected as Jane Doe/)).toBeTruthy();

    await fireEvent.changeText(input, 'valid-token-2');
    expect(queryByText(/Connected as Jane Doe/)).toBeNull();
  });

  it('renders the token input, link, and Save button while not connected', async () => {
    const { getByPlaceholderText, getByText } = await renderField();

    expect(getByPlaceholderText('Monobank token')).toBeTruthy();
    expect(getByText('Open api.monobank.ua')).toBeTruthy();
    expect(getByText('Save')).toBeTruthy();
  });

  it('hides the token input, link, and Save button once connected', async () => {
    const { queryByPlaceholderText, queryByText } = await renderField(true);

    expect(queryByPlaceholderText('Monobank token')).toBeNull();
    expect(queryByText('Open api.monobank.ua')).toBeNull();
    expect(queryByText('Save')).toBeNull();
  });

  it('still shows the "Synchronization" heading once connected', async () => {
    const { getByText } = await renderField(true);

    expect(getByText('Synchronization')).toBeTruthy();
  });
});

describe('MonobankTokenField — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasToken.mockResolvedValue(false);
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the heading, link, placeholder, and Save action from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const { getByPlaceholderText, getByText, queryByText } = await renderField();

    expect(getByText('Синхронізація')).toBeTruthy();
    expect(getByText('Відкрити api.monobank.ua')).toBeTruthy();
    expect(getByPlaceholderText('Токен Monobank')).toBeTruthy();
    expect(getByText('Зберегти')).toBeTruthy();
    expect(queryByText('Save')).toBeNull();
  });
});
