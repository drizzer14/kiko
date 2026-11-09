import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { exchangeProviderRegistry } from '@kiko/crypto-sync/exchange/registry';
import { type ExchangeCatalogId, exchangeCatalog } from '@kiko/crypto-sync/exchange-catalog';

import CryptoSyncSection from './crypto-sync-section.component';

const mockSync = jest.fn();
const mockDisconnect = jest.fn();
const mockAccountsRepoCall = jest.fn();

// Every repo method reports its name, so a write the pick makes fails the test whichever method it
// reaches for.
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: new Proxy(
    {},
    {
      get:
        (_target, method) =>
        (...args: unknown[]) =>
          mockAccountsRepoCall(method, ...args),
    },
  ),
}));
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: [], isLoading: false }),
}));
jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: async () => undefined,
  drainReminderResponses: async () => [],
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/sync/use-crypto-sync', () => ({
  useCryptoSync: () => ({ isSyncing: false, error: undefined, sync: mockSync }),
}));
jest.mock('@kiko/crypto-sync/disconnect', () => ({
  disconnectCryptoAccount: (...args: unknown[]) => mockDisconnect(...args),
}));
// The section reads the tracked-coin rule through the Binance barrel, which loads the credentials
// module and its react-native-keychain binding, absent under Jest.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));
// Each field collapses to a marker: the section's choice of field is what is under test.
jest.mock('@kiko/design-system/components/wallet-address-field', () => {
  const { Text } = require('react-native');

  return { __esModule: true, default: () => <Text accessibilityLabel="wallet-field">wallet</Text> };
});
jest.mock('@kiko/design-system/components/binance-credentials-field', () => {
  const { Text } = require('react-native');

  return {
    __esModule: true,
    default: () => <Text accessibilityLabel="binance-field">binance</Text>,
  };
});

// The marker also reports whether the section told the field that the account keeps Bybit holdings.
jest.mock('@kiko/design-system/components/bybit-credentials-field', () => {
  const { Text } = require('react-native');

  return {
    __esModule: true,
    default: ({ keepsBybitHoldings }: { keepsBybitHoldings?: boolean }) => (
      <Text accessibilityLabel="bybit-field">{`bybit ${String(keepsBybitHoldings)}`}</Text>
    ),
  };
});

const fieldLabelById: Record<ExchangeCatalogId, string | null> = {
  binance: 'binance-field',
  bybit: 'bybit-field',
  btc_wallet: 'wallet-field',
  other: null,
};

const cryptoAccount = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  id: 'a',
  name: 'Exchange',
  kind: 'crypto',
  institution: null,
  bankId: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  currency: 'UAH',
  createdAt: 0,
  ...overrides,
});

const renderSection = (overrides: Partial<AccountRow> = {}, holdings: HoldingRow[] = []) =>
  render(<CryptoSyncSection account={cryptoAccount(overrides)} holdings={holdings} />);

const holdingKeyedBy = (field: string): HoldingRow =>
  ({ id: `held-${field}`, metadata: { [field]: 'KEY', syncedAt: 1 } }) as HoldingRow;

const CONNECT = 'Connect an exchange or wallet';
const REFUSED_TAIL =
  'cannot connect here because this account still has holdings from another exchange or wallet. Add a new crypto account, or delete those holdings first.';

describe('CryptoSyncSection — connecting a crypto account', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockResolvedValue(true);
    mockDisconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the Binance key field directly when the bank id names Binance', async () => {
    const { getByLabelText, queryByLabelText, queryByText } = await renderSection({
      bankId: 'binance',
    });

    expect(getByLabelText('binance-field')).toBeTruthy();
    expect(queryByLabelText('wallet-field')).toBeNull();
    expect(queryByText(CONNECT)).toBeNull();
  });

  it('shows the wallet address field directly when the bank id names the Bitcoin wallet', async () => {
    const { getByLabelText, queryByLabelText, queryByText } = await renderSection({
      bankId: 'btc_wallet',
    });

    expect(getByLabelText('wallet-field')).toBeTruthy();
    expect(queryByLabelText('binance-field')).toBeNull();
    expect(queryByText(CONNECT)).toBeNull();
  });

  it.each(exchangeCatalog.filter((entry) => entry.connectable))(
    'shows the connect field directly on an unconnected account of each connectable exchange catalog entry ($id)',
    async (entry) => {
      const { getByLabelText } = await renderSection({ bankId: entry.id, institution: null });

      expect(getByLabelText(fieldLabelById[entry.id] ?? '')).toBeTruthy();
    },
  );

  it.each([null, 'other', 'monobank'])(
    'shows Connect an exchange or wallet when the bank id names no wired provider (%s)',
    async (bankId) => {
      const { getByText, queryByLabelText } = await renderSection({ bankId });

      expect(getByText(CONNECT)).toBeTruthy();
      expect(queryByLabelText('wallet-field')).toBeNull();
      expect(queryByLabelText('binance-field')).toBeNull();
    },
  );

  it('lists every wired exchange and wallet in the connect sheet', async () => {
    const { getByText, getAllByText, getByTestId, queryByTestId } = await renderSection();

    await fireEvent.press(getByText(CONNECT));

    expect(getByTestId('connect-exchange-option-binance')).toBeTruthy();
    expect(getByTestId('connect-exchange-option-bybit')).toBeTruthy();
    expect(getByTestId('connect-exchange-option-btc_wallet')).toBeTruthy();
    expect(queryByTestId('connect-exchange-option-other')).toBeNull();
    expect(getByText('Binance')).toBeTruthy();
    expect(getByText('Bybit')).toBeTruthy();
    expect(getByText('Bitcoin wallet')).toBeTruthy();
    expect(getAllByText('Connect with a read-only API key.')).toHaveLength(2);
    expect(getByText('Connect with a public address.')).toBeTruthy();
  });

  it('shows the Bybit key field and Change exchange or wallet after a sheet pick of Bybit', async () => {
    const { getByText, getByTestId, getByLabelText, queryByLabelText } = await renderSection();

    await fireEvent.press(getByText(CONNECT));
    await fireEvent.press(getByTestId('connect-exchange-option-bybit'));

    expect(getByLabelText('bybit-field')).toBeTruthy();
    expect(queryByLabelText('binance-field')).toBeNull();
    expect(getByText('Change exchange or wallet')).toBeTruthy();
  });

  it("shows the picked provider's field and Change exchange or wallet after a sheet pick", async () => {
    const { getByText, getByTestId, getByLabelText, queryByLabelText } = await renderSection();

    await fireEvent.press(getByText(CONNECT));
    await fireEvent.press(getByTestId('connect-exchange-option-binance'));

    expect(getByLabelText('binance-field')).toBeTruthy();
    expect(queryByLabelText('wallet-field')).toBeNull();
    expect(getByText('Change exchange or wallet')).toBeTruthy();
  });

  it('returns to Connect an exchange or wallet on Change exchange or wallet', async () => {
    const { getByText, getByTestId, queryByLabelText } = await renderSection();

    await fireEvent.press(getByText(CONNECT));
    await fireEvent.press(getByTestId('connect-exchange-option-btc_wallet'));
    await fireEvent.press(getByText('Change exchange or wallet'));

    expect(getByText(CONNECT)).toBeTruthy();
    expect(queryByLabelText('wallet-field')).toBeNull();
  });

  it('shows no Change exchange or wallet when the bank id names the provider', async () => {
    const { queryByText } = await renderSection({ bankId: 'binance' });

    expect(queryByText('Change exchange or wallet')).toBeNull();
  });

  it('saves nothing to the account when a provider is picked in the sheet', async () => {
    const { getByText, getByTestId } = await renderSection();

    await fireEvent.press(getByText(CONNECT));
    await fireEvent.press(getByTestId('connect-exchange-option-binance'));

    expect(mockAccountsRepoCall).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  // An account that still holds another exchange's holdings (kept after a disconnect) must not
  // connect a provider whose sync would leave them reading as synced.
  describe('an account that holds a Bybit holding', () => {
    const bybitHoldings = [holdingKeyedBy('bybitAsset')];

    it.each([
      ['binance', 'binance-field', 'Binance'],
      ['btc_wallet', 'wallet-field', 'Bitcoin wallet'],
    ])(
      'shows the refusal in place of the %s field when the bank id names it',
      async (bankId, fieldLabel, name) => {
        const { getByText, queryByLabelText, queryByText } = await renderSection(
          { bankId },
          bybitHoldings,
        );

        expect(getByText(`${name} ${REFUSED_TAIL}`)).toBeTruthy();
        expect(queryByLabelText(fieldLabel)).toBeNull();
        expect(queryByText('Change exchange or wallet')).toBeNull();
      },
    );

    it.each([
      ['binance', 'Binance'],
      ['btc_wallet', 'Bitcoin wallet'],
    ])('refuses a sheet pick of %s, keeps Change and writes nothing', async (id, name) => {
      const { getByText, getByTestId, queryByLabelText } = await renderSection({}, bybitHoldings);

      await fireEvent.press(getByText(CONNECT));
      await fireEvent.press(getByTestId(`connect-exchange-option-${id}`));

      expect(getByText(`${name} ${REFUSED_TAIL}`)).toBeTruthy();
      expect(queryByLabelText('binance-field')).toBeNull();
      expect(queryByLabelText('wallet-field')).toBeNull();
      expect(getByText('Change exchange or wallet')).toBeTruthy();
      expect(mockAccountsRepoCall).not.toHaveBeenCalled();
      expect(mockSync).not.toHaveBeenCalled();
    });

    it('lets the user leave the refusal through Change exchange or wallet', async () => {
      const { getByText, getByTestId, queryByText } = await renderSection({}, bybitHoldings);

      await fireEvent.press(getByText(CONNECT));
      await fireEvent.press(getByTestId('connect-exchange-option-binance'));
      await fireEvent.press(getByText('Change exchange or wallet'));

      expect(getByText(CONNECT)).toBeTruthy();
      expect(queryByText(`Binance ${REFUSED_TAIL}`)).toBeNull();
    });

    it('refuses nothing on the Connect button alone, before any pick', async () => {
      const { getByText, queryByText } = await renderSection({}, bybitHoldings);

      expect(getByText(CONNECT)).toBeTruthy();
      expect(queryByText(/cannot connect here/)).toBeNull();
    });
  });

  // A Bybit pick goes through the same gate: the holdings of Binance or a wallet would read as
  // synced with no Bybit sync behind them.
  describe('a Bybit pick on an account that holds the holdings of another exchange or wallet', () => {
    it.each([
      ['Binance', holdingKeyedBy('binanceAsset')],
      ['a Bitcoin wallet', holdingKeyedBy('walletAddress')],
    ])('shows the refusal in place of the Bybit field over %s holdings', async (_name, holding) => {
      const { getByText, queryByLabelText } = await renderSection({ bankId: 'bybit' }, [holding]);

      expect(getByText(`Bybit ${REFUSED_TAIL}`)).toBeTruthy();
      expect(queryByLabelText('bybit-field')).toBeNull();
      expect(queryByLabelText('binance-field')).toBeNull();
    });

    it.each([
      ['Binance', holdingKeyedBy('binanceAsset')],
      ['a Bitcoin wallet', holdingKeyedBy('walletAddress')],
    ])(
      'refuses a sheet pick of Bybit over %s holdings, keeps Change and writes nothing',
      async (_name, holding) => {
        const { getByText, getByTestId, queryByLabelText } = await renderSection({}, [holding]);

        await fireEvent.press(getByText(CONNECT));
        await fireEvent.press(getByTestId('connect-exchange-option-bybit'));

        expect(getByText(`Bybit ${REFUSED_TAIL}`)).toBeTruthy();
        expect(queryByLabelText('bybit-field')).toBeNull();
        expect(getByText('Change exchange or wallet')).toBeTruthy();
        expect(mockAccountsRepoCall).not.toHaveBeenCalled();
        expect(mockSync).not.toHaveBeenCalled();
      },
    );

    it('lets the user leave the Bybit refusal through Change exchange or wallet', async () => {
      const { getByText, getByTestId, queryByText } = await renderSection({}, [
        holdingKeyedBy('binanceAsset'),
      ]);

      await fireEvent.press(getByText(CONNECT));
      await fireEvent.press(getByTestId('connect-exchange-option-bybit'));
      await fireEvent.press(getByText('Change exchange or wallet'));

      expect(getByText(CONNECT)).toBeTruthy();
      expect(queryByText(`Bybit ${REFUSED_TAIL}`)).toBeNull();
    });

    it('connects a sheet pick of Bybit over manual holdings and no holdings', async () => {
      for (const holdings of [[{ id: 'manual', metadata: null } as HoldingRow], []]) {
        const { getByText, getByTestId, getByLabelText, queryByText } = await renderSection(
          {},
          holdings,
        );

        await fireEvent.press(getByText(CONNECT));
        await fireEvent.press(getByTestId('connect-exchange-option-bybit'));

        expect(getByLabelText('bybit-field')).toBeTruthy();
        expect(queryByText(/cannot connect here/)).toBeNull();
      }
    });
  });

  // The field compares the key's owner only on an account that keeps a Bybit holding, so the
  // section is what tells it.
  describe('the owner check of the Bybit field', () => {
    it.each([
      ['keeps a Bybit holding', [holdingKeyedBy('bybitAsset')], 'bybit true'],
      ['holds a manual holding', [{ id: 'manual', metadata: null } as HoldingRow], 'bybit false'],
      ['holds nothing', [], 'bybit false'],
    ])('tells the Bybit field the account %s', async (_state, holdings, marker) => {
      const { getByLabelText } = await renderSection({ bankId: 'bybit' }, holdings);

      expect(getByLabelText('bybit-field')).toHaveTextContent(marker);
    });
  });

  // A Binance user is never stranded: nothing here changes for the holdings Binance and a wallet
  // already keep, and a manual holding has no key.
  describe('an account that holds Binance or manual holdings', () => {
    const binanceHoldings = [holdingKeyedBy('binanceAsset')];
    const manualHoldings = [{ id: 'manual', metadata: null } as HoldingRow];

    it.each([
      ['binance', 'binance-field'],
      ['btc_wallet', 'wallet-field'],
    ])(
      'shows the %s field when the bank id names it, so Binance to wallet is open',
      async (bankId, fieldLabel) => {
        const { getByLabelText, queryByText } = await renderSection({ bankId }, binanceHoldings);

        expect(getByLabelText(fieldLabel)).toBeTruthy();
        expect(queryByText(/cannot connect here/)).toBeNull();
      },
    );

    it.each([
      ['binance', 'binance-field'],
      ['btc_wallet', 'wallet-field'],
    ])('connects a sheet pick of %s over Binance holdings', async (id, fieldLabel) => {
      const { getByText, getByTestId, getByLabelText, queryByText } = await renderSection(
        {},
        binanceHoldings,
      );

      await fireEvent.press(getByText(CONNECT));
      await fireEvent.press(getByTestId(`connect-exchange-option-${id}`));

      expect(getByLabelText(fieldLabel)).toBeTruthy();
      expect(queryByText(/cannot connect here/)).toBeNull();
    });

    it('connects over manual holdings', async () => {
      const { getByLabelText, queryByText } = await renderSection(
        { bankId: 'binance' },
        manualHoldings,
      );

      expect(getByLabelText('binance-field')).toBeTruthy();
      expect(queryByText(/cannot connect here/)).toBeNull();
    });
  });

  it("titles the disconnect confirm with the registry's name and message", async () => {
    jest.replaceProperty(exchangeProviderRegistry, 'binance', {
      id: 'binance',
      displayNameKey: 'accountDetail.wallet',
      disconnectMessageKey: 'accountDetail.disconnectProviderMessage.wallet',
    });
    const { getByText, getByTestId } = await renderSection({ institution: 'binance' });

    await fireEvent.press(getByText('Disconnect'));

    expect(getByText('Disconnect Wallet')).toBeTruthy();
    expect(
      getByText('This clears the connection. Your BTC holding stays as a manual snapshot.'),
    ).toBeTruthy();

    await fireEvent.press(getByTestId('crypto-disconnect-confirm'));

    await waitFor(() => expect(mockDisconnect).toHaveBeenCalledWith('a', 'binance'));
  });
});
