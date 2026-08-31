import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import AccountDetailScreen from './account-detail.screen';

const mockUseLiveQuery = jest.fn();

jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('../../repositories/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: (accountId: string) => ({
      toSQL: () => ({ sql: '', params: [accountId] }),
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
 * Drive the two `useLiveQuery` calls by the table they subscribe to, so the
 * mock survives re-renders (mirrors the pattern in home.screen.test.tsx).
 */
const setLiveData = (data: { accounts?: Account[]; holdings?: Holding[] }): void => {
  const byTable: Record<string, unknown[]> = {
    accounts: data.accounts ?? [],
    holdings: data.holdings ?? [],
  };
  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
  }));
};

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'a',
  name: 'Monobank',
  kind: 'bank',
  institution: null,
  ...overrides,
});

const route = { params: { accountId: 'a' } } as never;

describe('AccountDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
  });

  it('lists holdings for the account', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByText } = await render(
      <AccountDetailScreen route={route} navigation={navigation} />,
    );
    expect(getByText('Black card')).toBeTruthy();
  });

  it('shows the holding balance as money', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByText } = await render(
      <AccountDetailScreen route={route} navigation={navigation} />,
    );
    expect(getByText(/1,000\.00 ₴/)).toBeTruthy();
  });

  it('navigates to HoldingDetail when a holding row is pressed', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByText } = await render(
      <AccountDetailScreen route={route} navigation={navigation} />,
    );
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
    const navigation = { navigate: jest.fn() } as never;
    const { getByText, queryByText } = await render(
      <AccountDetailScreen route={route} navigation={navigation} />,
    );
    expect(getByText('Black card')).toBeTruthy();
    expect(queryByText('Closed jar')).toBeNull();
  });

  it('navigates to HoldingForm when Add holding is pressed', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getByText } = await render(
      <AccountDetailScreen route={route} navigation={navigation} />,
    );
    await fireEvent.press(getByText('Add holding'));
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', { accountId: 'a' });
  });

  it("renders the account's real name as the screen identity", async () => {
    setLiveData({
      accounts: [account({ name: 'Ukrsibbank Card' })],
      holdings: [],
    });
    const navigation = { navigate: jest.fn() } as never;
    const { getByText, queryByText } = await render(
      <AccountDetailScreen route={route} navigation={navigation} />,
    );
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
      const navigation = { navigate: jest.fn() } as never;
      const { getByText, queryByText } = await render(
        <AccountDetailScreen route={route} navigation={navigation} />,
      );
      for (const text of visible) {
        expect(getByText(text)).toBeTruthy();
      }
      for (const text of hidden) {
        expect(queryByText(text)).toBeNull();
      }
    },
  );
});
