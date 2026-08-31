import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../design-system/unistyles';
import AccountDetailScreen from './account-detail.screen';

const mockUseLiveQuery = jest.fn();
const mockSync = jest.fn();
const mockUseSync = jest.fn();
const mockReadToken = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../use-sync', () => ({
  useSync: () => mockUseSync(),
}));
jest.mock('../../monobank/token', () => ({
  readToken: () => mockReadToken(),
}));
jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: (accountId: string) => ({
      __kind: 'byId',
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    connectedQuery: () => ({
      __kind: 'connected',
      toSQL: () => ({ sql: '', params: ['monobank'] }),
    }),
  },
}));
jest.mock('../../repositories/holdings.repo', () => ({
  holdingsRepo: {
    listByAccountQuery: (accountId: string) => ({
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
  },
}));

type Account = {
  id: string;
  name: string;
  kind: string;
  institution?: string | null;
};
type Holding = {
  id: string;
  name: string;
  currency: string;
  balanceMinorUnits: number;
  closedAt?: number | null;
};

/**
 * Drive the three `useLiveQuery` calls, keying on the query's `__kind` (the
 * account-by-id and connected queries both subscribe to `['accounts']`, so the
 * table name alone can't tell them apart). `connected` defaults to the accounts
 * currently marked `institution: 'monobank'`.
 */
const setLiveData = (data: {
  accounts?: Account[];
  holdings?: Holding[];
  connected?: Account[];
}): void => {
  const accounts = data.accounts ?? [];
  const connected = data.connected ?? accounts.filter(a => a.institution === 'monobank');
  mockUseLiveQuery.mockImplementation((query: { __kind?: string }, tables: string[]) => {
    if (query.__kind === 'connected') {
      return { data: connected };
    }
    if (tables[0] === 'holdings') {
      return { data: data.holdings ?? [] };
    }
    return { data: accounts };
  });
};

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'a',
  name: 'Monobank',
  kind: 'bank',
  institution: null,
  ...overrides,
});

const route = { params: { accountId: 'a' } } as never;

/**
 * Render the screen with a fresh spy navigation, returned alongside the RNTL
 * queries so a test can assert on `navigation.navigate` without re-wiring the
 * boilerplate. Live data is seeded per-test (or by `beforeEach`) before this.
 */
const renderScreen = async () => {
  const navigation = { navigate: jest.fn() } as never;
  const view = await render(<AccountDetailScreen route={route} navigation={navigation} />);
  return { ...view, navigation };
};

describe('AccountDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue(undefined);
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    mockReadToken.mockResolvedValue('token-abc');
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
  });

  it('lists holdings for the account', async () => {
    const { getByText } = await renderScreen();
    expect(getByText('Black card')).toBeTruthy();
  });

  it('shows the holding balance as money', async () => {
    const { getByText } = await renderScreen();
    expect(getByText(/1,000\.00 ₴/)).toBeTruthy();
  });

  it('navigates to HoldingDetail when a holding row is pressed', async () => {
    const { getByText, navigation } = await renderScreen();
    await fireEvent.press(getByText('Black card'));
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingDetail', { holdingId: 'h1' });
  });

  it('excludes closed holdings from the list', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        {
          id: 'h1',
          name: 'Black card',
          currency: 'UAH',
          balanceMinorUnits: 100000,
          closedAt: null,
        },
        {
          id: 'h2',
          name: 'Closed jar',
          currency: 'UAH',
          balanceMinorUnits: 5000,
          closedAt: 1_700_000_000_000,
        },
      ],
    });
    const { getByText, queryByText } = await renderScreen();
    expect(getByText('Black card')).toBeTruthy();
    expect(queryByText('Closed jar')).toBeNull();
  });

  it('navigates to HoldingForm when Add holding is pressed', async () => {
    const { getByText, navigation } = await renderScreen();
    await fireEvent.press(getByText('Add holding'));
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', { accountId: 'a' });
  });

  it("renders the account's real name as the screen identity", async () => {
    setLiveData({
      accounts: [account({ name: 'Ukrsibbank Card' })],
      holdings: [],
    });
    const { getByText, queryByText } = await renderScreen();
    expect(getByText('Ukrsibbank Card')).toBeTruthy();
    expect(queryByText('Account')).toBeNull();
  });

  type MonobankGateCase = {
    description: string;
    account: Account | undefined;
    visible: string[];
    hidden: string[];
  };

  const monobankGateCases: MonobankGateCase[] = [
    {
      description: 'the account has not loaded yet',
      account: undefined,
      visible: [],
      hidden: ['Connect Monobank', 'Sync now'],
    },
    {
      description: 'a bank account not yet connected to Monobank',
      account: account({ kind: 'bank', institution: null }),
      visible: ['Connect Monobank'],
      hidden: ['Sync now'],
    },
    {
      description: 'a bank account connected to Monobank',
      account: account({ kind: 'bank', institution: 'monobank' }),
      visible: ['Sync now'],
      hidden: ['Connect Monobank'],
    },
    {
      description: 'a cash account',
      account: account({ kind: 'cash', institution: null }),
      visible: [],
      hidden: ['Connect Monobank', 'Sync now'],
    },
  ];

  it.each(monobankGateCases)(
    'gates the Monobank controls when $description',
    async ({ account: testAccount, visible, hidden }) => {
      setLiveData({ accounts: testAccount ? [testAccount] : [], holdings: [] });
      const { getByText, queryByText } = await renderScreen();
      for (const text of visible) {
        expect(getByText(text)).toBeTruthy();
      }
      for (const text of hidden) {
        expect(queryByText(text)).toBeNull();
      }
    },
  );

  it('hides Connect and shows a hint when another account is already connected', async () => {
    setLiveData({
      accounts: [account({ id: 'a', kind: 'bank', institution: null })],
      holdings: [],
      connected: [account({ id: 'other', kind: 'bank', institution: 'monobank' })],
    });
    const { getByText, queryByText } = await renderScreen();
    expect(queryByText('Connect Monobank')).toBeNull();
    expect(queryByText('Sync now')).toBeNull();
    expect(getByText('Monobank is connected to another account')).toBeTruthy();
  });

  it('syncs the account when a Monobank token exists (Connect action)', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Connect Monobank'));
    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('a'));
  });

  it('re-syncs a connected account when Sync now is pressed', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', institution: 'monobank' })], holdings: [] });
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Sync now'));
    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('a'));
  });

  it('directs the user to Settings and does not sync when no token is stored', async () => {
    mockReadToken.mockResolvedValue(undefined);
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
    const { getByText, findByText, navigation } = await renderScreen();
    await fireEvent.press(getByText('Connect Monobank'));
    expect(await findByText(/Settings/)).toBeTruthy();
    expect(mockSync).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('surfaces the sync error from useSync', async () => {
    mockUseSync.mockReturnValue({ isSyncing: false, error: 'sync boom', sync: mockSync });
    setLiveData({ accounts: [account({ kind: 'bank', institution: 'monobank' })], holdings: [] });
    const { getByText } = await renderScreen();
    expect(getByText('sync boom')).toBeTruthy();
  });

  it('shows a syncing label while a connected account is syncing', async () => {
    mockUseSync.mockReturnValue({ isSyncing: true, error: undefined, sync: mockSync });
    setLiveData({ accounts: [account({ kind: 'bank', institution: 'monobank' })], holdings: [] });
    const { getByText } = await renderScreen();
    expect(getByText('Syncing…')).toBeTruthy();
  });
});
