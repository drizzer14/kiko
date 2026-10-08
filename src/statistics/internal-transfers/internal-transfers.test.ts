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

/**
 * Wraps each row's OWN `time` field in a getter that counts every read
 * through a shared counter — the guards below prove a bounded read count
 * from OUTSIDE `internalTransferTransactionIds`, on the exact rows the
 * production code is handed, rather than trusting an injected
 * candidate-visit counter production would otherwise have to carry purely
 * for the tests' benefit.
 */
const toCounted = (transactions: Transaction[], readCounter: { reads: number }): Transaction[] =>
  transactions.map((row) => {
    const time = row.time;

    return {
      ...row,
      get time() {
        readCounter.reads += 1;

        return time;
      },
    };
  });

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
// or just outside, the 2-minute match window). `timeRangeMs` defaults to a
// FIXED span (matching a fixed-size ledger); the growth-guard test below
// scales it WITH `size` instead, so packing more rows into the same fixed
// span doesn't inflate same-bucket candidate density on its own — a real
// user's ledger growing means a wider transaction history, not the same
// history sampled more densely.
const randomLedger = (
  random: () => number,
  size: number,
  timeRangeMs = 1_000_000_000,
): Transaction[] => {
  const holdingIds = ['h1', 'h2', 'h3', 'h4'];
  const amountPool = [1000, 2500, 5000, 10_000, 25_000];

  return Array.from({ length: size }, (_, index) => {
    const amountMagnitude = amountPool[Math.floor(random() * amountPool.length)];
    const sign = random() < 0.5 ? -1 : 1;
    const baseTime = T + Math.floor(random() * timeRangeMs);
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

const WINDOW_SECONDS = TRANSFER_MATCH_WINDOW_MS / 1_000;

/**
 * Deliberately builds MULTIPLE valid candidate credits per debit, with their
 * ORIGINAL ARRAY-INDEX order shuffled to differ from their TIME order — the
 * one shape that can distinguish "claims the earliest still-unmatched credit
 * BY ORIGINAL POSITION" (the real rule) from "claims the nearest one by time"
 * (a plausible but wrong optimization, since the underlying data structure
 * sorts candidates by time for its window search). Offsets straddle the
 * match window's own edge (`WINDOW_SECONDS` seconds) at -121/-120/-119/+119/+120/
 * +121 seconds, so the boundary itself is exercised alongside the tie-break.
 */
const withMultiCandidateClusters = (random: () => number, ledger: Transaction[]): Transaction[] => {
  const offsetsSeconds = [
    -(WINDOW_SECONDS + 1),
    -WINDOW_SECONDS,
    -(WINDOW_SECONDS - 1),
    WINDOW_SECONDS - 1,
    WINDOW_SECONDS,
    WINDOW_SECONDS + 1,
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
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = mulberry32(seed);
      const ledger = withMultiCandidateClusters(random, randomLedger(random, 300));

      expect(internalTransferTransactionIds(ledger)).toEqual(
        referenceInternalTransferTransactionIds(ledger),
      );
    }
  });

  // A DETERMINISTIC work-count guard, not a wall-clock timing — coverage
  // instrumentation and machine load skew the two timed sides of a speed
  // comparison by different, unpredictable amounts, so a wall-clock ratio is
  // inherently unreliable under Stryker. Counting each read of an
  // INSTRUMENTED row's own `.time` field — observed from outside
  // `internalTransferTransactionIds`, with no hook of any kind in
  // production — is immune to both.
  it('reads a near-linear number of `.time` fields as the ledger grows', () => {
    // Same rows-per-millisecond density at every size (see `randomLedger`'s
    // own comment) — otherwise a fixed time span alone would inflate
    // candidate density as `size` grows, independent of the matcher itself.
    const MS_PER_ROW = 1_000_000_000 / 6_000;

    const timeReadsFor = (size: number): number => {
      const readCounter = { reads: 0 };
      const ledger = toCounted(randomLedger(mulberry32(7), size, size * MS_PER_ROW), readCounter);

      internalTransferTransactionIds(ledger);

      return readCounter.reads;
    };

    const base = timeReadsFor(2_500);
    const doubled = timeReadsFor(5_000);
    const quadrupled = timeReadsFor(10_000);

    expect(doubled).toBeLessThan(base * 3);
    expect(quadrupled).toBeLessThan(doubled * 3);
  });

  it('reads far fewer `.time` fields than the quadratic reference implementation, on the same ledger', () => {
    // A single (currency, amount) pair forces every credit into ONE bucket,
    // so the quadratic reference implementation's per-debit scan stays
    // maximally expensive at a much smaller ledger size than a realistic
    // multi-bucket mix would need, keeping this guard's own runtime short
    // while still proving the ratio.
    const holdingIds = ['h1', 'h2', 'h3', 'h4'];
    const random = mulberry32(7);
    const ledger = Array.from({ length: 4_000 }, (_, index) =>
      transaction(
        `t${index}`,
        holdingIds[Math.floor(random() * holdingIds.length)],
        (random() < 0.5 ? -1 : 1) * 1000,
        T + Math.floor(random() * 1_000_000_000),
      ),
    );
    const optimizedReadCounter = { reads: 0 };
    const referenceReadCounter = { reads: 0 };

    internalTransferTransactionIds(toCounted(ledger, optimizedReadCounter));
    referenceInternalTransferTransactionIds(toCounted(ledger, referenceReadCounter));

    expect(optimizedReadCounter.reads).toBeLessThan(referenceReadCounter.reads * 0.05);
  });

  // Proves the guard above actually catches a regression, rather than
  // coincidentally passing regardless: this variant is `findMatchingCredit`
  // with its one window-exceeded line changed from `break` to falling
  // through, so it re-scans the rest of every (currency, amount) bucket
  // instead of stopping at the window edge — the same counting rule,
  // applied to a provably worse scan.
  it('fails the near-linear growth bound once the window break becomes a continue', () => {
    type LocalCreditCandidate = { transaction: Transaction };

    const bucketKey = (currency: Transaction['currency'], amountMinorUnits: number): string =>
      `${currency}:${amountMinorUnits}`;

    const buildBuckets = (transactions: Transaction[]): Map<string, LocalCreditCandidate[]> => {
      const buckets = new Map<string, LocalCreditCandidate[]>();

      transactions.forEach((current) => {
        if (current.amountMinorUnits <= 0) {
          return;
        }

        const key = bucketKey(current.currency, current.amountMinorUnits);
        const bucket = buckets.get(key) ?? [];

        bucket.push({ transaction: current });
        buckets.set(key, bucket);
      });

      for (const bucket of buckets.values()) {
        bucket.sort((a, b) => a.transaction.time - b.transaction.time);
      }

      return buckets;
    };

    const lowerBoundByTime = (bucket: LocalCreditCandidate[], lowTime: number): number => {
      let low = 0;
      let high = bucket.length;

      while (low < high) {
        const mid = (low + high) >>> 1;

        if (bucket[mid].transaction.time < lowTime) {
          low = mid + 1;
        } else {
          high = mid;
        }
      }

      return low;
    };

    // The mutant under test: scans the WHOLE rest of the bucket from the
    // window's lower edge onward, instead of stopping once a candidate's
    // time exceeds the window's upper edge — extracted to its own function
    // so the outer loop below stays within the complexity budget.
    const scanPastWindow = (
      bucket: LocalCreditCandidate[],
      lowTime: number,
      highTime: number,
    ): void => {
      for (let cursor = lowerBoundByTime(bucket, lowTime); cursor < bucket.length; cursor += 1) {
        // Evaluated but never acted on: the regression this models is that a
        // scan keeps going past the window instead of breaking once a
        // candidate's time exceeds it, so only the `.time` read the counter
        // observes needs to happen here.
        bucket[cursor].transaction.time <= highTime;
      }
    };

    const countContinueMutantReads = (transactions: Transaction[]): number => {
      const readCounter = { reads: 0 };
      const counted = toCounted(transactions, readCounter);
      const buckets = buildBuckets(counted);

      for (const debit of counted) {
        if (debit.amountMinorUnits >= 0) {
          continue;
        }

        const bucket = buckets.get(bucketKey(debit.currency, -debit.amountMinorUnits)) ?? [];

        scanPastWindow(
          bucket,
          debit.time - TRANSFER_MATCH_WINDOW_MS,
          debit.time + TRANSFER_MATCH_WINDOW_MS,
        );
      }

      return readCounter.reads;
    };

    const MS_PER_ROW = 1_000_000_000 / 6_000;
    const base = countContinueMutantReads(randomLedger(mulberry32(7), 2_500, 2_500 * MS_PER_ROW));
    const quadrupled = countContinueMutantReads(
      randomLedger(mulberry32(7), 10_000, 10_000 * MS_PER_ROW),
    );

    // The real matcher stays under 3x across a 4x ledger growth (see above);
    // scanning every bucket to its end instead of stopping at the window
    // makes reads scale with bucket size, which itself grows with ledger
    // size, so a 4x ledger blows well past that bound.
    expect(quadrupled).toBeGreaterThan(base * 3);
  });
});
