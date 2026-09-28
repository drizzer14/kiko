import { internalTransferTransactionIds, TRANSFER_MATCH_WINDOW_MS } from './internal-transfers';

type Transaction = {
  id: string;
  holdingId: string;
  time: number;
  amountMinorUnits: number;
  currency: 'BTC' | 'USD' | 'EUR' | 'UAH';
};

const transaction = (
  id: string,
  holdingId: string,
  amountMinorUnits: number,
  time: number,
  currency: Transaction['currency'] = 'UAH',
): Transaction => ({ id, holdingId, time, amountMinorUnits, currency });

const T = 1_000_000_000_000;

// The quadratic implementation this module replaced, kept here ONLY as the
// parity oracle: it is trivially correct by inspection (a direct
// transcription of the greedy rule in this module's own doc comment), so a
// fuzz test comparing the optimized implementation against it proves the
// rewrite kept EXACTLY the same matching order and result.
const referenceInternalTransferTransactionIds = (transactions: Transaction[]): Set<string> => {
  const matchedIds = new Set<string>();
  const consumedCredits = new Set<number>();

  for (const debit of transactions) {
    if (debit.amountMinorUnits >= 0) {
      continue;
    }

    for (let index = 0; index < transactions.length; index += 1) {
      const credit = transactions[index];

      if (consumedCredits.has(index) || credit.amountMinorUnits <= 0) {
        continue;
      }

      const isMatch =
        credit.amountMinorUnits === -debit.amountMinorUnits &&
        credit.currency === debit.currency &&
        credit.holdingId !== debit.holdingId &&
        Math.abs(debit.time - credit.time) <= TRANSFER_MATCH_WINDOW_MS;

      if (isMatch) {
        consumedCredits.add(index);
        matchedIds.add(debit.id);
        matchedIds.add(credit.id);
        break;
      }
    }
  }

  return matchedIds;
};

// Deterministic PRNG (mulberry32) so a failing seed is reproducible without
// relying on Jest's own random seed plumbing.
const mulberry32 = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const CURRENCIES: Transaction['currency'][] = ['BTC', 'USD', 'EUR', 'UAH'];

// A randomized ledger with realistic clustering: amounts and holdings are
// drawn from small pools (so genuine transfer pairs and coincidental
// same-amount collisions both occur), and times are spread over a wide range
// with an occasional near-duplicate cluster (so some pairs land just inside,
// or just outside, the 2-minute match window).
const randomLedger = (random: () => number, size: number): Transaction[] => {
  const holdingIds = ['h1', 'h2', 'h3', 'h4'];
  const amountPool = [1000, 2500, 5000, 10_000, 25_000];

  return Array.from({ length: size }, (_, index) => {
    const amountMagnitude = amountPool[Math.floor(random() * amountPool.length)];
    const sign = random() < 0.5 ? -1 : 1;
    const baseTime = T + Math.floor(random() * 1_000_000_000);
    // 1-in-3 rows lands within a tight cluster around a shared anchor so the
    // window boundary itself gets exercised, not just widely-scattered rows.
    const time =
      random() < 0.33
        ? baseTime - (baseTime % (5 * TRANSFER_MATCH_WINDOW_MS)) + Math.floor(random() * 500)
        : baseTime;

    return transaction(
      `t${index}`,
      holdingIds[Math.floor(random() * holdingIds.length)],
      sign * amountMagnitude,
      time,
      CURRENCIES[Math.floor(random() * CURRENCIES.length)],
    );
  });
};

const WINDOW_S = TRANSFER_MATCH_WINDOW_MS / 1_000;

/**
 * Deliberately builds MULTIPLE valid candidate credits per debit, with their
 * ORIGINAL ARRAY-INDEX order shuffled to differ from their TIME order — the
 * one shape that can distinguish "claims the earliest still-unmatched credit
 * BY ORIGINAL POSITION" (the real rule) from "claims the nearest one by time"
 * (a plausible but wrong optimization, since the underlying data structure
 * sorts candidates by time for its window search). Offsets straddle the
 * match window's own edge (`WINDOW_S` seconds) at -121/-120/-119/+119/+120/
 * +121 seconds, so the boundary itself is exercised alongside the tie-break.
 */
const withMultiCandidateClusters = (random: () => number, ledger: Transaction[]): Transaction[] => {
  const offsetsSeconds = [
    -(WINDOW_S + 1),
    -WINDOW_S,
    -(WINDOW_S - 1),
    WINDOW_S - 1,
    WINDOW_S,
    WINDOW_S + 1,
  ];
  const clustered: Transaction[] = [...ledger];

  for (let cluster = 0; cluster < 15; cluster += 1) {
    const anchor = T + Math.floor(random() * 900_000_000);
    const magnitude = [1000, 2500, 5000][Math.floor(random() * 3)];
    const currency = CURRENCIES[Math.floor(random() * CURRENCIES.length)];

    clustered.push(transaction(`cluster-${cluster}-debit`, 'hd', -magnitude, anchor, currency));

    const candidates = offsetsSeconds.map((offsetSeconds, index) =>
      transaction(
        `cluster-${cluster}-credit-${index}`,
        `hc${index % 3}`,
        magnitude,
        anchor + offsetSeconds * 1_000,
        currency,
      ),
    );

    // Fisher-Yates, driven by the same seeded PRNG — shuffles the candidates'
    // ARRAY POSITION independently of their (fixed) TIME order.
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));

      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    clustered.push(...candidates);
  }

  return clustered;
};

// How many debits in `ledger` have 2+ candidate credits satisfying every
// matching rule except "still unconsumed" — genuine tie-break cases the
// greedy claim order must resolve deterministically. Used only to prove the
// fuzz below actually exercises that path, never for the match itself.
const countMultiCandidateDebits = (ledger: Transaction[]): number => {
  let multiCandidateDebits = 0;

  for (const debit of ledger) {
    if (debit.amountMinorUnits >= 0) {
      continue;
    }

    const candidateCount = ledger.filter(
      (credit) =>
        credit.amountMinorUnits === -debit.amountMinorUnits &&
        credit.currency === debit.currency &&
        credit.holdingId !== debit.holdingId &&
        Math.abs(debit.time - credit.time) <= TRANSFER_MATCH_WINDOW_MS,
    ).length;

    if (candidateCount >= 2) {
      multiCandidateDebits += 1;
    }
  }

  return multiCandidateDebits;
};

describe('internalTransferTxIds', () => {
  it('matches a debit against an equal credit on another holding within the window (both ids returned)', () => {
    const ids = internalTransferTransactionIds([
      transaction('debit', 'h1', -100_00, T),
      transaction('credit', 'h2', 100_00, T + 1_000),
    ]);

    expect(ids).toEqual(new Set(['debit', 'credit']));
  });

  it('matches legs exactly on the window boundary', () => {
    const ids = internalTransferTransactionIds([
      transaction('debit', 'h1', -100_00, T),
      transaction('credit', 'h2', 100_00, T + TRANSFER_MATCH_WINDOW_MS),
    ]);

    expect(ids).toEqual(new Set(['debit', 'credit']));
  });

  it('does not match when the magnitudes differ', () => {
    const ids = internalTransferTransactionIds([
      transaction('debit', 'h1', -100_00, T),
      transaction('credit', 'h2', 90_00, T + 1_000),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('does not match two legs on the same holding', () => {
    const ids = internalTransferTransactionIds([
      transaction('debit', 'h1', -100_00, T),
      transaction('credit', 'h1', 100_00, T + 1_000),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('does not match legs whose times fall outside the window', () => {
    const ids = internalTransferTransactionIds([
      transaction('debit', 'h1', -100_00, T),
      transaction('credit', 'h2', 100_00, T + TRANSFER_MATCH_WINDOW_MS + 1),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('does not match two same-sign transactions', () => {
    const ids = internalTransferTransactionIds([
      transaction('a', 'h1', 100_00, T),
      transaction('b', 'h2', 100_00, T + 1_000),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('does not match a same-magnitude pair in different currencies', () => {
    const ids = internalTransferTransactionIds([
      transaction('debit', 'h1', -100_00, T, 'USD'),
      transaction('credit', 'h2', 100_00, T + 1_000, 'EUR'),
    ]);

    expect(ids).toEqual(new Set());
  });

  it('pairs greedily: one credit cannot cancel two debits', () => {
    const ids = internalTransferTransactionIds([
      transaction('debit-1', 'h1', -100_00, T),
      transaction('debit-2', 'h3', -100_00, T + 500),
      transaction('credit', 'h2', 100_00, T + 1_000),
    ]);

    // The credit is consumed by the first debit; the second debit is left counted.
    expect(ids).toEqual(new Set(['debit-1', 'credit']));
  });

  it('consumes each credit at most once when several could match one debit', () => {
    const ids = internalTransferTransactionIds([
      transaction('debit', 'h1', -100_00, T),
      transaction('credit-1', 'h2', 100_00, T + 1_000),
      transaction('credit-2', 'h3', 100_00, T + 2_000),
    ]);

    // Only the first still-unmatched credit is claimed; the second stays counted.
    expect(ids).toEqual(new Set(['debit', 'credit-1']));
  });

  it('leaves an unmatched leftover debit counted', () => {
    const ids = internalTransferTransactionIds([transaction('debit', 'h1', -100_00, T)]);

    expect(ids).toEqual(new Set());
  });

  it('returns an empty set for empty input', () => {
    expect(internalTransferTransactionIds([])).toEqual(new Set());
  });

  it('matches the quadratic reference implementation on randomized ledgers, including multi-candidate ties', () => {
    let multiCandidateDebitsSeen = 0;

    for (let seed = 1; seed <= 40; seed += 1) {
      const random = mulberry32(seed);
      const ledger = withMultiCandidateClusters(random, randomLedger(random, 300));

      multiCandidateDebitsSeen += countMultiCandidateDebits(ledger);

      expect(internalTransferTransactionIds(ledger)).toEqual(
        referenceInternalTransferTransactionIds(ledger),
      );
    }

    // A fuzz that never actually generated a multi-candidate debit would
    // prove nothing about the greedy tie-break order (earliest ORIGINAL
    // index, not earliest time) — this is the mechanized guarantee that it
    // did, across the 40 seeds above.
    expect(multiCandidateDebitsSeen).toBeGreaterThan(0);
  });

  it('is at least 20x faster than the quadratic reference implementation on a large ledger', () => {
    const ledger = randomLedger(mulberry32(7), 6_000);

    const optimizedStarted = performance.now();

    internalTransferTransactionIds(ledger);
    const optimizedElapsed = performance.now() - optimizedStarted;

    const referenceStarted = performance.now();

    referenceInternalTransferTransactionIds(ledger);
    const referenceElapsed = performance.now() - referenceStarted;

    // A RELATIVE guard, not a wall-clock SLA — an absolute millisecond budget
    // is only ever as tight as the slowest machine it must tolerate. The
    // quadratic reference is O(debits * T); the bucketed/binary-searched
    // implementation is near O(T log T) — at this ledger size that ratio is
    // dramatic on ANY machine, so asserting it directly catches a regression
    // back to the quadratic shape regardless of absolute speed.
    expect(optimizedElapsed).toBeLessThan(referenceElapsed / 20);
  });
});
