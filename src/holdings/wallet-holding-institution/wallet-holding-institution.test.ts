import { isWalletHoldingInstitution } from './wallet-holding-institution';

describe('isWalletHoldingInstitution', () => {
  it('holds binance', () => {
    expect(isWalletHoldingInstitution('binance')).toBe(true);
  });

  it.each([['btc_wallet'], ['monobank'], [''], [null], [undefined]])(
    'refuses %p: its holdings are no exchange wallets',
    (institution) => {
      expect(isWalletHoldingInstitution(institution)).toBe(false);
    },
  );
});
