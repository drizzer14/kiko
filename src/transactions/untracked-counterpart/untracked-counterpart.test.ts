import {
  UNTRACKED_WALLETS,
  untrackedCounterpartName,
  untrackedWalletCode,
} from './untracked-counterpart';

const NAME_BY_WALLET = {
  UMFUTURE: 'USDⓈ-M Futures',
  CMFUTURE: 'COIN-M Futures',
  MARGIN: 'Margin',
  OPTION: 'Options',
  PORTFOLIO_MARGIN: 'Portfolio Margin',
} as const;

describe('untrackedWalletCode', () => {
  it.each(UNTRACKED_WALLETS)('prefixes %s with "wallet:"', (wallet) => {
    expect(untrackedWalletCode(wallet)).toBe(`wallet:${wallet}`);
  });
});

describe('untrackedCounterpartName', () => {
  it('knows exactly the five Binance wallets Kiko does not track', () => {
    expect([...UNTRACKED_WALLETS]).toEqual(Object.keys(NAME_BY_WALLET));
  });

  it.each(UNTRACKED_WALLETS)('maps the code of %s to its product name', (wallet) => {
    expect(untrackedCounterpartName(untrackedWalletCode(wallet))).toBe(NAME_BY_WALLET[wallet]);
  });

  it.each([['asset:ETH'], ['wallet:FOO'], ['wallet:'], ['UMFUTURE'], ['wallet:umfuture'], ['']])(
    'gives no name for the unknown code %p',
    (code) => {
      expect(untrackedCounterpartName(code)).toBeUndefined();
    },
  );

  it('gives no name when there is no code', () => {
    expect(untrackedCounterpartName(null)).toBeUndefined();
  });

  it('gives no name for an inherited object key', () => {
    expect(untrackedCounterpartName('wallet:constructor')).toBeUndefined();
    expect(untrackedCounterpartName('wallet:toString')).toBeUndefined();
  });
});
