import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import type { ExchangeCatalogId } from '@kiko/crypto-sync/exchange-catalog';

import CryptoSyncForm from './crypto-sync-form.component';

// Each field collapses to a marker: which field the form mounts is what is under test.
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

const renderForm = (source: ExchangeCatalogId) =>
  render(
    <CryptoSyncForm
      accountId="a"
      source={source}
      onConnectWallet={async () => true}
      onConnectBinance={async () => true}
    />,
  );

describe('CryptoSyncForm', () => {
  it.each([
    ['binance', 'binance-field', 'wallet-field'],
    ['btc_wallet', 'wallet-field', 'binance-field'],
  ] as const)(
    'mounts only the field of the source it is given (%s)',
    async (source, shown, hidden) => {
      const { getByLabelText, queryByLabelText, queryByText } = await renderForm(source);

      expect(getByLabelText(shown)).toBeTruthy();
      expect(queryByLabelText(hidden)).toBeNull();
      expect(queryByText('Source')).toBeNull();
    },
  );

  it('mounts no field for the manual source', async () => {
    const { queryByLabelText } = await renderForm('other');

    expect(queryByLabelText('wallet-field')).toBeNull();
    expect(queryByLabelText('binance-field')).toBeNull();
  });

  it('shows no source toggle, whichever source it is given', async () => {
    const { queryByText } = await renderForm('binance');

    expect(queryByText('Source')).toBeNull();
    expect(queryByText('Wallet')).toBeNull();
  });
});
