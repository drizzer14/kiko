import { isWalletHoldingInstitution } from './wallet-holding-institution';

describe('isWalletHoldingInstitution', () => {
  it.each([['binance'], ['bybit']])('holds %s', (institution) => {
    expect(isWalletHoldingInstitution(institution)).toBe(true);
  });

  it.each([['btc_wallet'], ['monobank'], [''], [null], [undefined]])(
    'refuses %p: its holdings are no exchange wallets',
    (institution) => {
      expect(isWalletHoldingInstitution(institution)).toBe(false);
    },
  );
});
