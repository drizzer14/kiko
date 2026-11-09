import type { ComponentProps } from 'react';
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

// The marker also reports what the form gave the field, so the hand-over is under test.
jest.mock('@kiko/design-system/components/bybit-credentials-field', () => {
  const { Text } = require('react-native');

  return {
    __esModule: true,
    default: (props: { accountId: string; keepsBybitHoldings?: boolean }) => (
      <Text accessibilityLabel="bybit-field">
        {`bybit ${props.accountId} ${String(props.keepsBybitHoldings)}`}
      </Text>
    ),
  };
});

const renderForm = (
  source: ExchangeCatalogId,
  extra: Partial<ComponentProps<typeof CryptoSyncForm>> = {},
) =>
  render(
    <CryptoSyncForm
      accountId="a"
      source={source}
      onConnectWallet={async () => true}
      onConnectBinance={async () => true}
      onConnectBybit={async () => true}
      {...extra}
    />,
  );

describe('CryptoSyncForm', () => {
  it.each([
    ['binance', 'binance-field', ['wallet-field', 'bybit-field']],
    ['bybit', 'bybit-field', ['wallet-field', 'binance-field']],
    ['btc_wallet', 'wallet-field', ['binance-field', 'bybit-field']],
  ] as const)(
    'mounts only the field of the source it is given (%s)',
    async (source, shown, hidden) => {
      const { getByLabelText, queryByLabelText, queryByText } = await renderForm(source);

      expect(getByLabelText(shown)).toBeTruthy();

      for (const label of hidden) {
        expect(queryByLabelText(label)).toBeNull();
      }
      expect(queryByText('Source')).toBeNull();
    },
  );

  it('hands the Bybit field its account id, and whether the account keeps Bybit holdings', async () => {
    const kept = await renderForm('bybit', { keepsBybitHoldings: true });

    expect(kept.getByLabelText('bybit-field')).toHaveTextContent('bybit a true');

    const created = await renderForm('bybit');

    expect(created.getByLabelText('bybit-field')).toHaveTextContent('bybit a undefined');
  });

  it('mounts no field for the manual source', async () => {
    const { queryByLabelText } = await renderForm('other');

    expect(queryByLabelText('wallet-field')).toBeNull();
    expect(queryByLabelText('binance-field')).toBeNull();
    expect(queryByLabelText('bybit-field')).toBeNull();
  });

  it('renders nothing at all for the manual source, so no blank strip is left under the picker', async () => {
    const { toJSON } = await renderForm('other');

    expect(toJSON()).toBeNull();
  });

  it('shows no source toggle, whichever source it is given', async () => {
    const { queryByText } = await renderForm('binance');

    expect(queryByText('Source')).toBeNull();
    expect(queryByText('Wallet')).toBeNull();
  });
});
