import type { AccountRow } from '@kiko/db';

import { exchangeFundingMatches } from './exchange-funding-match';

type Row = Parameters<typeof exchangeFundingMatches>[0][number];

const T = 1_000_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ACCOUNT_KIND_BY_HOLDING_ID: ReadonlyMap<string, AccountRow['kind']> = new Map([
  ['usdt', 'crypto'],
  ['funding-uah', 'crypto'],
  ['card', 'bank'],
  ['card-usd', 'bank'],
  ['card-eur', 'bank'],
]);

const exchangeRow = (
  id: string,
  untrackedCounterpart: string | null,
  time: number,
  amountMinorUnits = 9_990_000_000,
  holdingId = 'usdt',
  currency: Row['currency'] = 'USDT',
): Row => ({ id, holdingId, time, amountMinorUnits, currency, untrackedCounterpart });

const debit = (
  id: string,
  amountMinorUnits: number,
  time: number,
  holdingId = 'card',
  currency: Row['currency'] = 'UAH',
): Row => ({ id, holdingId, time, amountMinorUnits, currency, untrackedCounterpart: null });

const matchesOf = (ledger: Row[]) => exchangeFundingMatches(ledger, ACCOUNT_KIND_BY_HOLDING_ID);

const NO_MATCHES = { matches: new Map(), excludedIds: new Set() };

describe('exchangeFundingMatches', () => {
  it('matches a P2P purchase to the bank debit of its exact total twenty minutes earlier', () => {
    const result = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4150.00', T),
      debit('debit', -415_000, T - 20 * MINUTE),
    ]);

    expect(result.matches.get('debit')).toEqual({ exchangeId: 'buy', kind: 'p2p' });
    expect(result.excludedIds).toEqual(new Set(['debit']));
  });

  it('leaves a debit of the total two hours before a P2P purchase unmatched', () => {
    const result = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4150.00', T),
      debit('debit', -415_000, T - 2 * HOUR),
    ]);

    expect(result).toEqual(NO_MATCHES);
  });

  it.each([
    { kind: 'p2p', code: 'p2p:UAH:4150.00', total: 415_000, currency: 'UAH', holdingId: 'card' },
    { kind: 'card', code: 'card:UAH:2600.00', total: 260_000, currency: 'UAH', holdingId: 'card' },
    {
      kind: 'bank',
      code: 'bank:EUR:100.00',
      total: 10_000,
      currency: 'EUR',
      holdingId: 'card-eur',
    },
  ] as const)(
    'matches a $kind debit at each edge of its window and not one millisecond past it',
    ({ kind, code, total, currency, holdingId }) => {
      const windowMs = {
        p2p: { before: HOUR, after: 2 * HOUR },
        card: { before: DAY, after: 3 * DAY },
        bank: { before: 5 * DAY, after: HOUR },
      }[kind];
      const matchedAt = (offset: number) =>
        matchesOf([
          exchangeRow('funding', code, T),
          debit('debit', -total, T + offset, holdingId, currency),
        ]).matches.get('debit');

      expect(matchedAt(-windowMs.before)).toEqual({ exchangeId: 'funding', kind });
      expect(matchedAt(-windowMs.before - 1)).toBeUndefined();
      expect(matchedAt(windowMs.after)).toEqual({ exchangeId: 'funding', kind });
      expect(matchedAt(windowMs.after + 1)).toBeUndefined();
    },
  );

  it('leaves a debit one minor unit off the total unmatched', () => {
    const result = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4150.00', T),
      debit('debit', -415_001, T - 20 * MINUTE),
    ]);

    expect(result).toEqual(NO_MATCHES);
  });

  it('matches a card purchase to a debit posted two days later', () => {
    const result = matchesOf([
      exchangeRow('purchase', 'card:UAH:2600.00', T),
      debit('debit', -260_000, T + 2 * DAY),
    ]);

    expect(result.matches.get('debit')).toEqual({ exchangeId: 'purchase', kind: 'card' });
    expect(result.excludedIds).toEqual(new Set(['debit']));
  });

  it('matches a fiat deposit to a debit three days earlier', () => {
    const result = matchesOf([
      exchangeRow('deposit', 'bank:EUR:100.00', T),
      debit('debit', -10_000, T - 3 * DAY, 'card-eur', 'EUR'),
    ]);

    expect(result.matches.get('debit')).toEqual({ exchangeId: 'deposit', kind: 'bank' });
    expect(result.excludedIds).toEqual(new Set(['debit']));
  });

  it('counts a debit no exchange row funded', () => {
    const result = matchesOf([debit('debit', -415_000, T)]);

    expect(result).toEqual(NO_MATCHES);
  });

  it('leaves a debit in another currency than the total fiat unmatched', () => {
    const result = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4150.00', T),
      debit('debit', -415_000, T - 20 * MINUTE, 'card-usd', 'USD'),
    ]);

    expect(result).toEqual(NO_MATCHES);
  });

  it('matches a P2P purchase of a fiat asset to its bank debit', () => {
    const result = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4000.00', T, 400_000, 'funding-uah', 'UAH'),
      debit('debit', -400_000, T - 20 * MINUTE),
    ]);

    expect(result.matches.get('debit')).toEqual({ exchangeId: 'buy', kind: 'p2p' });
    expect(result.excludedIds).toEqual(new Set(['debit']));
  });

  it('never takes a debit on a holding of a crypto account', () => {
    const cryptoDebit = debit('crypto-debit', -400_000, T - MINUTE, 'funding-uah');
    const alone = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4000.00', T, 400_000, 'funding-uah', 'UAH'),
      cryptoDebit,
    ]);
    const beside = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4000.00', T, 400_000, 'funding-uah', 'UAH'),
      cryptoDebit,
      debit('card-debit', -400_000, T - 20 * MINUTE),
    ]);

    expect(alone).toEqual(NO_MATCHES);
    expect(beside.matches.get('crypto-debit')).toBeUndefined();
    expect(beside.matches.get('card-debit')).toEqual({ exchangeId: 'buy', kind: 'p2p' });
  });

  it('never takes a debit on a holding with no account', () => {
    const result = exchangeFundingMatches(
      [exchangeRow('buy', 'p2p:UAH:4150.00', T), debit('debit', -415_000, T - 20 * MINUTE)],
      new Map([['usdt', 'crypto']]),
    );

    expect(result.matches.get('debit')).toEqual({ exchangeId: 'buy', kind: 'p2p' });
  });

  it.each([
    { title: 'a total-less code', code: 'p2p:UAH', amount: 9_990_000_000 },
    { title: 'a negative amount', code: 'card:UAH:1300.00', amount: -1_300_000 },
    { title: 'an asset code', code: 'asset:PEPE', amount: 9_990_000_000 },
    { title: 'a wallet code', code: 'wallet:MARGIN', amount: 9_990_000_000 },
    { title: 'no code', code: null, amount: 9_990_000_000 },
  ])(
    'ignores a coded row with no total, a negative amount, or a wallet or asset code ($title)',
    ({ code, amount }) => {
      const result = matchesOf([
        exchangeRow('coded', code, T, amount, 'usdt', 'ETH'),
        debit('debit-p2p', -415_000, T),
        debit('debit-card', -130_000, T),
      ]);

      expect(result).toEqual(NO_MATCHES);
    },
  );

  it.each([null, 'groceries', 'loan_interest'])(
    'matches a P2P purchase whatever category a rule gave it (%s)',
    (category) => {
      const categorizedBuy = { ...exchangeRow('buy', 'p2p:UAH:4150.00', T), category };
      const result = matchesOf([categorizedBuy, debit('debit', -415_000, T - 20 * MINUTE)]);

      expect(result.matches.get('debit')).toEqual({ exchangeId: 'buy', kind: 'p2p' });
    },
  );
});
