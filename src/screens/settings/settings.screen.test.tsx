import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { SettingsScreen } from './settings.screen';

const mockSetBaseCurrency = jest.fn();
const mockSaveToken = jest.fn();
const mockRunSync = jest.fn();
const mockRefreshRates = jest.fn();
let mockReadTokenResult: string | undefined;
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
  readToken: async () => mockReadTokenResult,
}));
jest.mock('../../monobank/sync', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));
jest.mock('../../rates/rates-refresh', () => ({
  refreshRates: (...args: unknown[]) => mockRefreshRates(...args),
}));

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadTokenResult = undefined;
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
    mockReadTokenResult = 'existing-token';
    const { findByDisplayValue } = await render(<SettingsScreen />);
    expect(await findByDisplayValue('existing-token')).toBeTruthy();
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
