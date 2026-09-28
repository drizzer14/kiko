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

  it('matches the quadratic reference implementation on randomized ledgers', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = mulberry32(seed);
      const ledger = randomLedger(random, 300);

      expect(internalTransferTransactionIds(ledger)).toEqual(
        referenceInternalTransferTransactionIds(ledger),
      );
    }
  });

  it('stays well within budget on a large ledger', () => {
    const ledger = randomLedger(mulberry32(7), 20_000);
    const started = performance.now();

    internalTransferTransactionIds(ledger);

    expect(performance.now() - started).toBeLessThan(500);
  });
});
