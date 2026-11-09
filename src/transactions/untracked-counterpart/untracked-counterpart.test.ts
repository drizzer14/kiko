import { bifoldMap } from 'fnts/either';

import {
  UNTRACKED_WALLETS,
  FUNDING_LEDGER_CODE,
  fiatTotalCode,
  untrackedAssetCode,
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

describe('untrackedAssetCode', () => {
  it('prefixes a ticker with "asset:"', () => {
    expect(untrackedAssetCode('PEPE')).toBe('asset:PEPE');
  });

  it.each([
    ['empty', ''],
    ['holding a colon', 'A:B'],
  ])('builds no code for a ticker that is %s', (_label, ticker) => {
    expect(untrackedAssetCode(ticker)).toBeUndefined();
  });

  it.each(['PEPE', '1000SATS', 'ETH'])(
    'builds a code that parses back to the asset %s',
    (ticker) => {
      expect(parseUntrackedCounterpart(untrackedAssetCode(ticker) ?? null)).toEqual({
        kind: 'asset',
        code: ticker,
      });
    },
  );
});

describe('fiatTotalCode', () => {
  type Outcome = { error: string } | { code: string };

  const outcome = (kind: 'p2p' | 'card' | 'bank', fiat: string, totalText: string): Outcome =>
    bifoldMap(
      fiatTotalCode(kind, fiat, totalText),
      (error): Outcome => ({ error }),
      (code): Outcome => ({ code }),
    );

  it.each([
    ['p2p', 'UAH', '4150', 'p2p:UAH:4150.00', 415_000],
    ['p2p', 'UAH', '4145.85', 'p2p:UAH:4145.85', 414_585],
    ['p2p', 'UAH', '4000.0', 'p2p:UAH:4000.00', 400_000],
    ['p2p', 'UAH', '4150.000', 'p2p:UAH:4150.00', 415_000],
    ['card', 'UAH', '2600', 'card:UAH:2600.00', 260_000],
    ['bank', 'EUR', '100.5', 'bank:EUR:100.50', 10_050],
    ['bank', 'EUR', '0.01', 'bank:EUR:0.01', 1],
  ] as const)(
    'builds a %s code at the fiat scale from %s %s',
    (kind, fiat, totalText, code, totalMinorUnits) => {
      expect(outcome(kind, fiat, totalText)).toEqual({ code });
      expect(parseUntrackedCounterpart(code)).toEqual({ kind, fiat, totalMinorUnits });
    },
  );

  it.each([
    ['4150.001', 'amount-precision'],
    ['abc', 'amount-malformed'],
    ['', 'amount-malformed'],
    ['-5.00', 'amount-malformed'],
    [' 4150', 'amount-malformed'],
    ['4150 ', 'amount-malformed'],
    ['4,150', 'amount-malformed'],
    ['1e3', 'amount-malformed'],
    ['90071992547409.93', 'amount-too-large'],
  ])('stops at the total %p of a tracked fiat with %s', (totalText, error) => {
    expect(outcome('p2p', 'UAH', totalText)).toEqual({ error });
  });

  it.each([
    ['XYZ', '100.50'],
    ['XYZ', '100.500'],
    ['XYZ', '7'],
    ['BTC', '0.00012345'],
  ])('keeps the total of the fiat %s as sent: %s', (fiat, totalText) => {
    expect(outcome('p2p', fiat, totalText)).toEqual({ code: `p2p:${fiat}:${totalText}` });
    expect(parseUntrackedCounterpart(`p2p:${fiat}:${totalText}`)).toEqual({
      kind: 'p2p',
      fiat,
      totalMinorUnits: undefined,
    });
  });

  it.each(['abc', '', '-5', ' 5', '1e3', '5.'])(
    'stops at the total %p of a fiat Kiko does not know',
    (totalText) => {
      expect(outcome('card', 'XYZ', totalText)).toEqual({ error: 'amount-malformed' });
    },
  );

  it.each(['', 'A:B', ':UAH'])('stops at the fiat code %p that no code can carry', (fiat) => {
    expect(outcome('bank', fiat, '100.00')).toEqual({ error: 'amount-malformed' });
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

  it('reads the code of a listed Funding ledger row as a ledger counterpart, and keeps the stored value', () => {
    // A user's rows already hold this text, so a rename of the constant would strand them.
    expect(FUNDING_LEDGER_CODE).toBe('ledger:funding');
    expect(parseUntrackedCounterpart(FUNDING_LEDGER_CODE)).toEqual({ kind: 'ledger' });
  });

  it.each([
    ['asset'],
    ['asset:'],
    ['ledger'],
    ['ledger:'],
    ['ledger:funding:Earn'],
    ['ledger:Funding'],
    ['ledger:other'],
    ['asset:ETH:BSC'],
    ['p2p'],
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
