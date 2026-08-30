import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { SettingsScreen } from './settings.screen';

const mockSetBaseCurrency = jest.fn();
const mockSaveToken = jest.fn();
const mockRunSync = jest.fn();
const mockRefreshRates = jest.fn();
const mockReadToken = jest.fn<Promise<string | undefined>, []>();
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
jest.mock('../../monobank/sync', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));
jest.mock('../../rates/rates-refresh', () => ({
  refreshRates: (...args: unknown[]) => mockRefreshRates(...args),
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
    mockLiveQueryData = [{ baseCurrency: 'UAH', lastSyncAt: null }];
    mockRunSync.mockResolvedValue({ importedTransactions: 0 });
    mockRefreshRates.mockResolvedValue(undefined);
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

  it('calls saveToken with the entered token when Save is pressed', async () => {
    const { getByPlaceholderText, getByText } = await render(<SettingsScreen />);
    await fireEvent.changeText(getByPlaceholderText('Monobank token'), 'new-token');
    await fireEvent.press(getByText('Save'));
    expect(mockSaveToken).toHaveBeenCalledWith('new-token');
  });

  it('calls runSync then refreshRates when Sync is pressed', async () => {
    const { getByText } = await render(<SettingsScreen />);
    await fireEvent.press(getByText('Sync'));
    await waitFor(() => expect(mockRefreshRates).toHaveBeenCalled());
    expect(mockRunSync).toHaveBeenCalled();
  });

  it('shows an error message when sync fails, without crashing', async () => {
    mockRunSync.mockRejectedValue(new Error('sync boom'));
    const { findByText, getByText } = await render(<SettingsScreen />);
    await fireEvent.press(getByText('Sync'));
    expect(await findByText(/sync boom/i)).toBeTruthy();
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
});
