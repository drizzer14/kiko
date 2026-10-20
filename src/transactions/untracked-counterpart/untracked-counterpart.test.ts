import {
  UNTRACKED_WALLETS,
  untrackedWalletCode,
  parseUntrackedCounterpart,
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

describe('parseUntrackedCounterpart', () => {
  it('knows exactly the five Binance wallets Kiko does not track', () => {
    expect([...UNTRACKED_WALLETS]).toEqual(Object.keys(NAME_BY_WALLET));
  });

  it.each(UNTRACKED_WALLETS)('reads the code of %s as a wallet with its product name', (wallet) => {
    expect(parseUntrackedCounterpart(untrackedWalletCode(wallet))).toEqual({
      kind: 'wallet',
      name: NAME_BY_WALLET[wallet],
    });
  });

  it.each([
    ['asset:ETH', 'ETH'],
    ['asset:PEPE', 'PEPE'],
  ])('reads %s as an asset with the code %s', (code, asset) => {
    expect(parseUntrackedCounterpart(code)).toEqual({ kind: 'asset', code: asset });
  });

  it.each([
    ['p2p:UAH:4150.00', 'p2p', 'UAH', 415_000],
    ['p2p:UAH:4150', 'p2p', 'UAH', 415_000],
    ['p2p:UAH:4145.85', 'p2p', 'UAH', 414_585],
    ['card:UAH:2600.00', 'card', 'UAH', 260_000],
    ['bank:EUR:100.00', 'bank', 'EUR', 10_000],
    ['bank:EUR:0.01', 'bank', 'EUR', 1],
  ])('reads %s as a %s code with the exact total', (code, kind, fiat, totalMinorUnits) => {
    expect(parseUntrackedCounterpart(code)).toEqual({ kind, fiat, totalMinorUnits });
  });

  it.each([
    ['p2p:UAH:4150.001', 'p2p', 'UAH'],
    ['p2p:UAH:abc', 'p2p', 'UAH'],
    ['p2p:UAH:0', 'p2p', 'UAH'],
    ['p2p:UAH:-5.00', 'p2p', 'UAH'],
    ['p2p:UAH', 'p2p', 'UAH'],
    ['p2p:UAH:1:2', 'p2p', 'UAH'],
    ['p2p:XYZ:100.00', 'p2p', 'XYZ'],
    ['card:BTC:1', 'card', 'BTC'],
  ])('keeps the fiat of %s and drops a total it cannot trust', (code, kind, fiat) => {
    expect(parseUntrackedCounterpart(code)).toEqual({ kind, fiat, totalMinorUnits: undefined });
  });

  it.each([
    ['asset:'],
    ['asset:ETH:BSC'],
    ['p2p:'],
    ['p2p::5'],
    ['wallet:FOO'],
    ['wallet:'],
    ['wallet:umfuture'],
    ['wallet:constructor'],
    ['wallet:toString'],
    ['UMFUTURE'],
    ['foo:x'],
    [''],
  ])('gives no counterpart for the unknown code %p', (code) => {
    expect(parseUntrackedCounterpart(code)).toBeUndefined();
  });

  it('gives no counterpart when there is no code', () => {
    expect(parseUntrackedCounterpart(null)).toBeUndefined();
  });
});
