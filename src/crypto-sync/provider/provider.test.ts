import { i18n } from '@kiko/i18n/init';
import { syncedMetadataFieldOf } from '@kiko/holdings/deletable';

import { bybitProvider } from '../bybit';
import { binanceProvider } from '../binance';
import { bitcoinWalletProvider } from '../btc-wallet';

import {
  type BalanceProvider,
  type BalanceProviderId,
  balanceProviderIds,
  isBalanceProviderId,
  providerDisplayName,
} from './provider';

// The credentials modules import react-native-keychain, whose native binding is absent under
// Jest; this test reads only the provider ids and keys, so the stub needs the ACCESSIBLE enum
// that their module-scope constants read at load.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

// The type makes this list fail to compile when a provider id has no entry, so the test below
// cannot skip a new provider.
const providerById = {
  btc_wallet: bitcoinWalletProvider,
  binance: binanceProvider,
  bybit: bybitProvider,
} satisfies Record<BalanceProviderId, BalanceProvider<never>>;

describe('syncedMetadataFieldOf', () => {
  it.each(balanceProviderIds)('names the key of each synced institution: %s', (id) => {
    expect(providerById[id].id).toBe(id);
    expect(syncedMetadataFieldOf[id]).toBe(providerById[id].metadataField);
  });

  it('names the key that a Monobank sync writes', () => {
    expect(syncedMetadataFieldOf.monobank).toBe('monobankId');
  });
});

describe('balance provider ids', () => {
  it('lists the wallet, Binance and Bybit providers, in ship order', () => {
    expect(balanceProviderIds).toEqual(['btc_wallet', 'binance', 'bybit']);
  });

  it('recognizes a provider id and rejects monobank, null, and free text', () => {
    expect(isBalanceProviderId('btc_wallet')).toBe(true);
    expect(isBalanceProviderId('binance')).toBe(true);
    expect(isBalanceProviderId('bybit')).toBe(true);
    expect(isBalanceProviderId('monobank')).toBe(false);
    expect(isBalanceProviderId(null)).toBe(false);
    expect(isBalanceProviderId('kraken')).toBe(false);
  });

  it('maps each provider to its display name', () => {
    expect(providerDisplayName('btc_wallet', i18n.t)).toBe('Wallet');
    expect(providerDisplayName('binance', i18n.t)).toBe('Binance');
  });

  it('reads the Bybit id as its raw id, since the registry wires no Bybit entry yet', () => {
    expect(providerDisplayName('bybit', i18n.t)).toBe('bybit');
  });

  it('resolves the wallet display name in Ukrainian once the active language switches', async () => {
    await i18n.changeLanguage('uk');
    try {
      expect(providerDisplayName('btc_wallet', i18n.t)).toBe('Гаманець');
      expect(providerDisplayName('binance', i18n.t)).toBe('Binance');
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
