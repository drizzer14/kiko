import { i18n } from '@kiko/i18n/init';

import { balanceProviderIds, isBalanceProviderId, providerDisplayName } from './provider';

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
