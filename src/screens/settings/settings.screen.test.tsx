import { fireEvent, render, within } from '@testing-library/react-native';
import '../../design-system/unistyles';
import SettingsScreen from './settings.screen';

const mockSetBaseCurrency = jest.fn();
let mockLiveQueryData: Array<{ baseCurrency: string }> = [{ baseCurrency: 'UAH' }];

jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setBaseCurrency: (...args: unknown[]) => mockSetBaseCurrency(...args),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockLiveQueryData }),
}));

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveQueryData = [{ baseCurrency: 'UAH' }];
  });

  it('does not render an in-screen "Settings" title (the native header provides it)', async () => {
    const { queryByText } = await render(<SettingsScreen />);
    expect(queryByText('Settings')).toBeNull();
  });

  it('shows the current base currency', async () => {
    const { getByText } = await render(<SettingsScreen />);
    expect(getByText(/UAH/)).toBeTruthy();
  });

  it('renders the base-currency entry as a single full-width settings row, not a bare boxed card', async () => {
    const { getByTestId } = await render(<SettingsScreen />);
    expect(getByTestId('settings-row-base-currency')).toBeTruthy();
  });

  it('renders each setting in its own separate card, not one shared grouped card', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByTestId } = await render(<SettingsScreen navigation={navigation} />);

    const currencyCard = getByTestId('settings-card-base-currency');
    const categoriesCard = getByTestId('settings-card-categories');

    // Two distinct GlassSurface cards, one per setting.
    expect(currencyCard).toBeTruthy();
    expect(categoriesCard).toBeTruthy();
    expect(currencyCard).not.toBe(categoriesCard);

    // The base-currency row lives only inside its own card...
    expect(within(currencyCard).getByTestId('settings-row-base-currency')).toBeTruthy();
    expect(within(currencyCard).queryByTestId('settings-row-categories')).toBeNull();

    // ...and the Categories row lives only inside its own card.
    expect(within(categoriesCard).getByTestId('settings-row-categories')).toBeTruthy();
    expect(within(categoriesCard).queryByTestId('settings-row-base-currency')).toBeNull();
  });

  it('renders each currency option as its own independently pressable control within the row (no shared multi-action box)', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getAllByRole } = await render(<SettingsScreen navigation={navigation} />);
    // BTC, USD, EUR, UAH — four separate currency pressables, not one combined
    // control — plus the navigating Categories row's own pressable (5 total).
    expect(getAllByRole('button')).toHaveLength(5);
  });

  it('navigates to the Categories sub-screen when the Categories row is pressed', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByTestId } = await render(<SettingsScreen navigation={navigation} />);

    await fireEvent.press(getByTestId('settings-row-categories'));

    expect(navigation.navigate).toHaveBeenCalledWith('Categories');
  });

  it('calls setBaseCurrency when a currency option is pressed', async () => {
    const { getByText } = await render(<SettingsScreen />);
    await fireEvent.press(getByText('USD'));
    expect(mockSetBaseCurrency).toHaveBeenCalledWith('USD');
  });

  it('no longer renders the Monobank token input (it lives on the bank account now)', async () => {
    const { queryByPlaceholderText, queryByText } = await render(<SettingsScreen />);
    expect(queryByPlaceholderText('Monobank token')).toBeNull();
    expect(queryByText('Save')).toBeNull();
    expect(queryByText('Paste from clipboard')).toBeNull();
    expect(queryByText('Open api.monobank.ua')).toBeNull();
  });

  it('no longer renders the sync-status card (it lives on the bank account now)', async () => {
    const { queryByText } = await render(<SettingsScreen />);
    expect(queryByText(/Last sync/i)).toBeNull();
    expect(queryByText(/Sync status/i)).toBeNull();
  });

  it('does not render a Sync button (sync is per-account now)', async () => {
    const { queryByText } = await render(<SettingsScreen />);
    expect(queryByText('Sync')).toBeNull();
  });
});
