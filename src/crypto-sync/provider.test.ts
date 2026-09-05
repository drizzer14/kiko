import { balanceProviderIds, isBalanceProviderId, providerDisplayName } from './provider';

describe('balance provider ids', () => {
  it('lists the wallet and Binance providers, in ship order', () => {
    expect(balanceProviderIds).toEqual(['btc_wallet', 'binance']);
  });

  it('recognizes a provider id and rejects monobank, null, and free text', () => {
    expect(isBalanceProviderId('btc_wallet')).toBe(true);
    expect(isBalanceProviderId('binance')).toBe(true);
    expect(isBalanceProviderId('monobank')).toBe(false);
    expect(isBalanceProviderId(null)).toBe(false);
    expect(isBalanceProviderId('kraken')).toBe(false);
  });

  it('maps each provider to its display name', () => {
    expect(providerDisplayName('btc_wallet')).toBe('Wallet');
    expect(providerDisplayName('binance')).toBe('Binance');
  });
});
