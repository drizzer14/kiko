import type { AccountRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

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
): Row => ({
  id,
  holdingId,
  time,
  amountMinorUnits,
  currency,
  untrackedCounterpart,
  description: '',
  mcc: null,
  categorySetByHand: false,
});

const debit = (
  id: string,
  amountMinorUnits: number,
  time: number,
  holdingId = 'card',
  currency: Row['currency'] = 'UAH',
): Row => ({
  id,
  holdingId,
  time,
  amountMinorUnits,
  currency,
  untrackedCounterpart: null,
  description: '',
  mcc: null,
  categorySetByHand: false,
});

const GROCERY_MCC = 5411;
const CASH_OUT_MCC = 6012;
const OWN_TRANSFER_MCC = 4829;

// A UAH card debit of the P2P total the tests below fund, so a case names only what differs.
const fundingDebit = (id: string, time: number, extra: Partial<Row> = {}): Row => ({
  ...debit(id, -415_000, time),
  ...extra,
});

const matchesOf = (ledger: Row[]) => exchangeFundingMatches(ledger, ACCOUNT_KIND_BY_HOLDING_ID);

const NO_MATCHES = { matches: new Map(), excludedIds: new Set() };

const WINDOW_MS = {
  p2p: { before: HOUR, after: 2 * HOUR },
  card: { before: DAY, after: 3 * DAY },
  bank: { before: 5 * DAY, after: HOUR },
};

type GeneratedFunding = {
  kind: keyof typeof WINDOW_MS;
  fiat: 'UAH' | 'EUR';
  totalMinorUnits: number;
};

const GENERATED_KINDS = ['p2p', 'card', 'bank'] as const;
const GENERATED_FIATS = ['UAH', 'EUR'] as const;
const GENERATED_TOTALS = [100_000, 200_000];
const GENERATED_HOLDING_CURRENCY: Record<string, Row['currency']> = {
  card: 'UAH',
  'card-eur': 'EUR',
  'funding-uah': 'UAH',
};
// Ten-minute steps over a few hours make equal time gaps common, so every tie-break runs.
const GENERATED_STEP = 10 * MINUTE;
const PROPERTY_RUNS = 150;
const SHUFFLES_PER_RUN = 2;
const GREEDY_SHORTFALL_RUNS_FLOOR = 1;

const pick = <Item>(random: Random, items: readonly Item[]): Item =>
  items[Math.floor(random() * items.length)];

const shuffled = <Item>(random: Random, items: readonly Item[]): Item[] => {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));

    [copy[index], copy[other]] = [copy[other], copy[index]];
  }

  return copy;
};

const generatedLedgerOf = (random: Random) => {
  const fundingById = new Map<string, GeneratedFunding>();
  const exchanges = Array.from({ length: 1 + Math.floor(random() * 6) }, (_unused, index) => {
    const funding: GeneratedFunding = {
      kind: pick(random, GENERATED_KINDS),
      fiat: pick(random, GENERATED_FIATS),
      totalMinorUnits: pick(random, GENERATED_TOTALS),
    };
    const id = `exchange-${index}`;
    const code = `${funding.kind}:${funding.fiat}:${(funding.totalMinorUnits / 100).toFixed(2)}`;

    fundingById.set(id, funding);

    return exchangeRow(id, code, T + Math.floor(random() * 6) * GENERATED_STEP);
  });
  const debits = Array.from({ length: 1 + Math.floor(random() * 10) }, (_unused, index) => {
    const holdingId = pick(random, Object.keys(GENERATED_HOLDING_CURRENCY));
    const row = debit(
      `debit-${index}`,
      -pick(random, GENERATED_TOTALS),
      T + (Math.floor(random() * 23) - 8) * GENERATED_STEP,
      holdingId,
      GENERATED_HOLDING_CURRENCY[holdingId],
    );

    return {
      ...row,
      mcc: pick(random, [null, OWN_TRANSFER_MCC, CASH_OUT_MCC, GROCERY_MCC]),
      description: pick(random, ['', 'Binance', 'shop']),
      categorySetByHand: random() < 0.25,
    };
  });

  return { ledger: [...exchanges, ...debits], fundingById };
};

const signatureOf = ({ matches, excludedIds }: ReturnType<typeof matchesOf>): string =>
  JSON.stringify([[...matches].sort(), [...excludedIds].sort()]);

// The rule a pair must satisfy, restated from the generator's own description of the exchange row
// rather than read back from the matcher.
const fundsDebit = (funding: GeneratedFunding, bank: Row, exchange: Row): boolean => {
  const gap = bank.time - exchange.time;
  const window = WINDOW_MS[funding.kind];

  return (
    bank.currency === funding.fiat &&
    bank.amountMinorUnits === -funding.totalMinorUnits &&
    bank.holdingId !== 'funding-uah' &&
    -window.before <= gap &&
    gap <= window.after
  );
};

const fundingBucketOf = ({ fiat, totalMinorUnits }: GeneratedFunding): string =>
  `${fiat}:${totalMinorUnits}`;

// The most exchange rows that can each take a different debit, tried by exhaustion so the answer
// does not depend on any pairing order the matcher uses.
const maximumMatchingSize = (candidatesByExchange: readonly (readonly string[])[]): number => {
  const used = new Set<string>();

  const best = (index: number): number => {
    if (index === candidatesByExchange.length) {
      return 0;
    }

    let most = best(index + 1);

    for (const debitId of candidatesByExchange[index]) {
      if (!used.has(debitId)) {
        used.add(debitId);
        most = Math.max(most, 1 + best(index + 1));
        used.delete(debitId);
      }
    }

    return most;
  };

  return best(0);
};

const isTransferLikeRow = ({ mcc, description }: Row): boolean =>
  mcc === OWN_TRANSFER_MCC || mcc === CASH_OUT_MCC || description.toLowerCase().includes('binance');

type CandidatePair = { exchange: Row; bank: Row };

// A plain nearest-first greedy, written here so the test knows when taking the best pair first
// strands a row that a different pairing would have matched.
const greedyMatchingSize = (candidatePairs: readonly CandidatePair[]): number => {
  const byPriority = (left: CandidatePair, right: CandidatePair): number =>
    Number(isTransferLikeRow(right.bank)) - Number(isTransferLikeRow(left.bank)) ||
    Math.abs(left.bank.time - left.exchange.time) -
      Math.abs(right.bank.time - right.exchange.time) ||
    left.bank.id.localeCompare(right.bank.id) ||
    left.exchange.id.localeCompare(right.exchange.id);
  const usedBankIds = new Set<string>();
  const usedExchangeIds = new Set<string>();

  for (const { exchange, bank } of [...candidatePairs].sort(byPriority)) {
    if (!(usedBankIds.has(bank.id) || usedExchangeIds.has(exchange.id))) {
      usedBankIds.add(bank.id);
      usedExchangeIds.add(exchange.id);
    }
  }

  return usedExchangeIds.size;
};

// Where a bucket's matched count falls short of the most rows any pairing could match, and how
// many buckets the plain greedy alone would have fallen short in.
const matchingShortfallsOf = (
  seed: number,
  ledger: readonly Row[],
  fundingById: ReadonlyMap<string, GeneratedFunding>,
  matchedExchangeIds: ReadonlySet<string>,
): { shortfalls: string[]; greedyShortBuckets: number } => {
  const exchanges = ledger.flatMap(
    (row) => foldMap(maybe(fundingById.get(row.id)), (funding) => [{ row, funding }]) ?? [],
  );
  const debits = ledger.filter(({ id }) => !fundingById.has(id));
  const bucketKeys = new Set(exchanges.map(({ funding }) => fundingBucketOf(funding)));
  let greedyShortBuckets = 0;

  const shortfalls = [...bucketKeys].flatMap((bucketKey) => {
    const inBucket = exchanges.filter(({ funding }) => fundingBucketOf(funding) === bucketKey);
    const candidatesByExchange = inBucket.map(({ row, funding }) =>
      debits
        .filter((bank) => fundsDebit(funding, bank, row))
        .map((bank) => ({ exchange: row, bank })),
    );
    const possible = maximumMatchingSize(
      candidatesByExchange.map((candidates) => candidates.map(({ bank }) => bank.id)),
    );
    const matched = inBucket.filter(({ row }) => matchedExchangeIds.has(row.id)).length;

    if (greedyMatchingSize(candidatesByExchange.flat()) < possible) {
      greedyShortBuckets += 1;
    }

    return matched === possible
      ? []
      : [`seed ${seed}: bucket ${bucketKey} matched ${matched} rows, ${possible} were possible`];
  });

  return { shortfalls, greedyShortBuckets };
};

// Every way a result can break the matcher's contract, named with the seed that produced it.
const violationsOf = (
  seed: number,
): { violations: string[]; pairCount: number; greedyFellShort: boolean } => {
  const random = seededRandom(seed * 2_654_435 + 1);
  const { ledger, fundingById } = generatedLedgerOf(random);
  const rowById = new Map(ledger.map((row) => [row.id, row]));
  const result = matchesOf(ledger);
  const pairs = [...result.matches];
  const violations: string[] = [];

  if (new Set(pairs.map(([, { exchangeId }]) => exchangeId)).size !== pairs.length) {
    violations.push(`seed ${seed}: an exchange row matched twice`);
  }

  for (const [bankId, { exchangeId, kind }] of pairs) {
    const bank = rowById.get(bankId);
    const exchange = rowById.get(exchangeId);
    const funding = fundingById.get(exchangeId);

    if (!(bank && exchange && funding?.kind === kind && fundsDebit(funding, bank, exchange))) {
      violations.push(`seed ${seed}: ${bankId} to ${exchangeId} breaks the match rule`);
    }
  }

  const expectedExcluded = pairs
    .filter(([bankId]) => !rowById.get(bankId)?.categorySetByHand)
    .map(([bankId]) => bankId);

  if (
    JSON.stringify([...result.excludedIds].sort()) !== JSON.stringify([...expectedExcluded].sort())
  ) {
    violations.push(`seed ${seed}: the excluded ids are not the matched rows set by rule`);
  }

  const { shortfalls, greedyShortBuckets } = matchingShortfallsOf(
    seed,
    ledger,
    fundingById,
    new Set(pairs.map(([, { exchangeId }]) => exchangeId)),
  );

  violations.push(...shortfalls);

  for (let shuffle = 0; shuffle < SHUFFLES_PER_RUN; shuffle += 1) {
    if (signatureOf(matchesOf(shuffled(random, ledger))) !== signatureOf(result)) {
      violations.push(`seed ${seed}: shuffle ${shuffle} gave other pairs`);
    }
  }

  return { violations, pairCount: pairs.length, greedyFellShort: greedyShortBuckets > 0 };
};

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
      const windowMs = WINDOW_MS[kind];
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

  it("leaves a debit in another currency than the total's fiat unmatched", () => {
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

  it('counts a debit on a holding of an unknown account as a bank debit', () => {
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

  it('matches one debit to the nearer of two P2P purchases of the same total', () => {
    const result = matchesOf([
      exchangeRow('buy-a', 'p2p:UAH:4150.00', T),
      exchangeRow('buy-b', 'p2p:UAH:4150.00', T + 30 * MINUTE),
      fundingDebit('debit', T + 25 * MINUTE),
    ]);

    expect(result.matches).toEqual(new Map([['debit', { exchangeId: 'buy-b', kind: 'p2p' }]]));
  });

  it('matches both debits of two P2P purchases of the same total when the nearest pair would leave one unmatched', () => {
    const result = matchesOf([
      exchangeRow('buy-first', 'p2p:UAH:4150.00', T),
      exchangeRow('buy-second', 'p2p:UAH:4150.00', T + 90 * MINUTE),
      fundingDebit('debit-after', T + 40 * MINUTE),
      fundingDebit('debit-before', T - 50 * MINUTE),
    ]);

    expect(result.matches).toEqual(
      new Map([
        ['debit-before', { exchangeId: 'buy-first', kind: 'p2p' }],
        ['debit-after', { exchangeId: 'buy-second', kind: 'p2p' }],
      ]),
    );
    expect(result.excludedIds).toEqual(new Set(['debit-before', 'debit-after']));
  });

  it('gives the one debit a purchase can release to the nearer of two purchases left unmatched', () => {
    const result = matchesOf([
      exchangeRow('buy-far', 'p2p:UAH:4150.00', T - 60 * MINUTE),
      exchangeRow('buy-near', 'p2p:UAH:4150.00', T - 45 * MINUTE),
      exchangeRow('buy-held', 'p2p:UAH:4150.00', T),
      fundingDebit('debit-shared', T),
      fundingDebit('debit-spare', T + 90 * MINUTE),
    ]);

    expect(result.matches).toEqual(
      new Map([
        ['debit-shared', { exchangeId: 'buy-near', kind: 'p2p' }],
        ['debit-spare', { exchangeId: 'buy-held', kind: 'p2p' }],
      ]),
    );
  });

  it('moves the purchase holding the debit to its nearer other debit before a farther free one', () => {
    const result = matchesOf([
      exchangeRow('buy-early', 'p2p:UAH:4150.00', T - 30 * MINUTE),
      exchangeRow('buy-late', 'p2p:UAH:4150.00', T + 10 * MINUTE),
      exchangeRow('buy-unmatched', 'p2p:UAH:4150.00', T),
      fundingDebit('debit-early', T - 30 * MINUTE),
      fundingDebit('debit-late', T + 10 * MINUTE),
      fundingDebit('debit-before-all', T - 80 * MINUTE),
      fundingDebit('debit-after-all', T + 125 * MINUTE),
    ]);

    expect(result.matches).toEqual(
      new Map([
        ['debit-before-all', { exchangeId: 'buy-early', kind: 'p2p' }],
        ['debit-early', { exchangeId: 'buy-late', kind: 'p2p' }],
        ['debit-late', { exchangeId: 'buy-unmatched', kind: 'p2p' }],
      ]),
    );
  });

  it('matches a hand-categorized debit but keeps it out of the excluded ids', () => {
    const result = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4150.00', T),
      fundingDebit('debit', T - 20 * MINUTE, { categorySetByHand: true }),
    ]);

    expect(result.matches.get('debit')).toEqual({ exchangeId: 'buy', kind: 'p2p' });
    expect(result.excludedIds).toEqual(new Set());
  });

  it('prefers a transfer debit over a nearer grocery debit', () => {
    const result = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4150.00', T),
      fundingDebit('a-grocery', T - 5 * MINUTE, { mcc: GROCERY_MCC }),
      fundingDebit('z-transfer', T - 30 * MINUTE, { mcc: OWN_TRANSFER_MCC }),
    ]);

    expect(result.matches).toEqual(new Map([['z-transfer', { exchangeId: 'buy', kind: 'p2p' }]]));
    expect(result.excludedIds).toEqual(new Set(['z-transfer']));
  });

  it('treats a debit whose description holds binance in any case as a transfer', () => {
    const result = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4150.00', T),
      fundingDebit('a-grocery', T - 5 * MINUTE, { mcc: GROCERY_MCC }),
      fundingDebit('z-transfer', T - 30 * MINUTE, { description: 'Transfer to BiNaNcE' }),
    ]);

    expect(result.matches).toEqual(new Map([['z-transfer', { exchangeId: 'buy', kind: 'p2p' }]]));
  });

  it('lets an already excluded cash-out debit take the match, so the grocery debit still counts', () => {
    const result = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4150.00', T),
      fundingDebit('a-grocery', T - 5 * MINUTE, { mcc: GROCERY_MCC }),
      fundingDebit('z-cash-out', T - 30 * MINUTE, { mcc: CASH_OUT_MCC }),
    ]);

    expect(result.matches).toEqual(new Map([['z-cash-out', { exchangeId: 'buy', kind: 'p2p' }]]));
    expect(result.excludedIds).toEqual(new Set(['z-cash-out']));
  });

  it('lets a hand-categorized debit take the match, so the grocery debit still counts', () => {
    const result = matchesOf([
      exchangeRow('buy', 'p2p:UAH:4150.00', T),
      fundingDebit('a-grocery', T - 5 * MINUTE, { mcc: GROCERY_MCC }),
      fundingDebit('z-hand', T - 30 * MINUTE, {
        mcc: OWN_TRANSFER_MCC,
        categorySetByHand: true,
      }),
    ]);

    expect(result.matches).toEqual(new Map([['z-hand', { exchangeId: 'buy', kind: 'p2p' }]]));
    expect(result.excludedIds).toEqual(new Set());
  });

  it.each([
    {
      key: 'transfer-like bank row',
      ledger: [
        exchangeRow('buy', 'p2p:UAH:4150.00', T),
        fundingDebit('debit-a', T - 5 * MINUTE),
        fundingDebit('debit-b', T + 50 * MINUTE, { mcc: OWN_TRANSFER_MCC }),
      ],
      expected: [['debit-b', 'buy']],
    },
    {
      key: 'time gap',
      ledger: [
        exchangeRow('buy', 'p2p:UAH:4150.00', T),
        fundingDebit('debit-a', T - 30 * MINUTE),
        fundingDebit('debit-b', T - 5 * MINUTE),
      ],
      expected: [['debit-b', 'buy']],
    },
    {
      key: 'bank row id',
      ledger: [
        exchangeRow('buy', 'p2p:UAH:4150.00', T),
        fundingDebit('debit-b', T - 10 * MINUTE),
        fundingDebit('debit-a', T + 10 * MINUTE),
      ],
      expected: [['debit-a', 'buy']],
    },
    {
      key: 'exchange row id',
      ledger: [
        exchangeRow('buy-b', 'p2p:UAH:4150.00', T - 10 * MINUTE),
        exchangeRow('buy-a', 'p2p:UAH:4150.00', T + 10 * MINUTE),
        fundingDebit('debit', T),
      ],
      expected: [['debit', 'buy-a']],
    },
  ])(
    'breaks a tie by the time gap, then the bank row id, then the exchange row id ($key)',
    ({ ledger, expected }) => {
      const result = matchesOf(ledger);

      expect([...result.matches].map(([bankId, { exchangeId }]) => [bankId, exchangeId])).toEqual(
        expected,
      );
    },
  );
});

describe('exchangeFundingMatches over generated ledgers', () => {
  it('matches each row at most once and gives the same pairs for any input order', () => {
    const runs = Array.from({ length: PROPERTY_RUNS }, (_unused, index) => violationsOf(index + 1));

    expect(runs.flatMap(({ violations }) => violations)).toEqual([]);
    expect(runs.reduce((total, { pairCount }) => total + pairCount, 0)).toBeGreaterThan(
      PROPERTY_RUNS,
    );
    // Without these runs the maximum-matching check would pass for a matcher that only pairs
    // the nearest first.
    expect(runs.filter(({ greedyFellShort }) => greedyFellShort).length).toBeGreaterThanOrEqual(
      GREEDY_SHORTFALL_RUNS_FLOOR,
    );
  });
});
