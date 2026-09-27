import { categoryForMcc } from '@kiko/monobank/mcc-category';

import type { ParsedTransaction } from '../parser';

import { computeDedupKey, mapParsedTransaction } from './mapping';

const groceryTransaction: ParsedTransaction = {
  currency: 'UAH',
  amountMinorUnits: -4_599,
  timeSeconds: 1_700_000_000,
  description: 'ATB Market',
  mcc: 5411,
  counterIban: 'UA733220010000026201112223334',
  comment: 'lunch',
};

describe('mapParsedTransaction', () => {
  it('produces the exact NewTransaction field set for a row with an mcc', () => {
    const mapped = mapParsedTransaction(groceryTransaction, 'holding-1', 0);

    expect(mapped).toEqual({
      holdingId: 'holding-1',
      amountMinorUnits: -4_599,
      time: 1_700_000_000_000,
      description: 'ATB Market',
      mcc: 5411,
      category: categoryForMcc(5411),
      counterIban: 'UA733220010000026201112223334',
      comment: 'lunch',
      source: 'import',
      externalId: computeDedupKey('holding-1', groceryTransaction, 0),
    });
  });

  it('converts timeSeconds to milliseconds, mirroring mapStatementItem', () => {
    const mapped = mapParsedTransaction(groceryTransaction, 'holding-1', 0);

    expect(mapped.time).toBe(groceryTransaction.timeSeconds * 1000);
  });

  it('resolves category to null when the row carries no mcc', () => {
    const { mcc: _mcc, ...withoutMcc } = groceryTransaction;
    const mapped = mapParsedTransaction(withoutMcc, 'holding-1', 0);

    expect(mapped.category).toBeNull();
  });

  it('defaults counterIban and comment to null when the row carries neither', () => {
    const bare: ParsedTransaction = {
      currency: 'UAH',
      amountMinorUnits: -100,
      timeSeconds: 1,
      description: 'Cafe',
    };
    const mapped = mapParsedTransaction(bare, 'holding-1', 0);

    expect(mapped.counterIban).toBeNull();
    expect(mapped.comment).toBeNull();
  });

  // A file export carries no pending-authorization concept, so the mapped
  // shape omits `hold` entirely rather than writing it as false/null — see the
  // `NewTransaction` doc comment in `mapping.ts`.
  it('does not carry a hold field on the mapped row', () => {
    const mapped = mapParsedTransaction(groceryTransaction, 'holding-1', 0);

    expect(mapped).not.toHaveProperty('hold');
  });

  it('marks every mapped row source: import', () => {
    const mapped = mapParsedTransaction(groceryTransaction, 'holding-1', 0);

    expect(mapped.source).toBe('import');
  });

  it("uses the row's own externalId over the synthesized dedup key when present", () => {
    const withExternalId: ParsedTransaction = { ...groceryTransaction, externalId: 'bank-id-1' };
    const mapped = mapParsedTransaction(withExternalId, 'holding-1', 0);

    expect(mapped.externalId).toBe('bank-id-1');
  });
});

// PrivatBank XLSX never carries an MCC, so a
// row shaped exactly like a real PrivatBank row (masked-card hint, no mcc at
// all) must map to `category: null` through the SAME generic mapper, not a
// PrivatBank-specific branch. This exercises the real `mapParsedTransaction`
// function against that shape directly, distinct from the generic
// "no mcc" case above, to pin the PrivatBank-sourced expectation by name.
describe('mapParsedTransaction (PrivatBank-sourced row, no mcc)', () => {
  const privatbankRow: ParsedTransaction = {
    currency: 'UAH',
    amountMinorUnits: -12_345,
    timeSeconds: 1_751_364_900,
    description: 'Test Merchant One',
    maskedCardHint: '1111 **** **** 1111',
  };

  it('maps a PrivatBank row (no mcc) to category: null', () => {
    const mapped = mapParsedTransaction(privatbankRow, 'holding-1', 0);

    expect(mapped.category).toBeNull();
  });

  it('does not carry the masked-card hint on the mapped DB row (preview-only field)', () => {
    const mapped = mapParsedTransaction(privatbankRow, 'holding-1', 0);

    expect(mapped).not.toHaveProperty('maskedCardHint');
  });
});

describe('computeDedupKey', () => {
  it('is stable across two identical calls', () => {
    const first = computeDedupKey('holding-1', groceryTransaction, 0);
    const second = computeDedupKey('holding-1', groceryTransaction, 0);

    expect(first).toBe(second);
  });

  it('differs only by occurrenceIndex for two exact-duplicate rows', () => {
    const first = computeDedupKey('holding-1', groceryTransaction, 0);
    const second = computeDedupKey('holding-1', groceryTransaction, 1);

    expect(first).not.toBe(second);
    expect(second).toBe(`${first}␟1`);
  });

  it('differs across two different holdings for the same transaction', () => {
    const first = computeDedupKey('holding-1', groceryTransaction, 0);
    const second = computeDedupKey('holding-2', groceryTransaction, 0);

    expect(first).not.toBe(second);
  });

  it('normalizes the description before hashing, matching a case/whitespace variant', () => {
    const variant: ParsedTransaction = { ...groceryTransaction, description: '  ATB MARKET  ' };
    const first = computeDedupKey('holding-1', groceryTransaction, 0);
    const second = computeDedupKey('holding-1', variant, 0);

    expect(first).toBe(second);
  });

  // Review's collision scenario (:2321): "Top up", "Top up", "Top up 1" at the
  // same second and amount. The occurrence-1 key for the second "Top up" row
  // and the occurrence-0 key for "Top up 1" must stay distinct — the plain-
  // space join the OLD key used made them collide, since a description
  // ending in a digit is indistinguishable in SQL from an occurrence suffix
  // (`normalizeTransactionName` is JS-only). The `␟` separator fixes this: it
  // can never appear in a real description, unlike a space.
  it('keeps three same-second, same-amount "Top up"/"Top up 1" rows distinct', () => {
    const topUp: ParsedTransaction = {
      currency: 'UAH',
      amountMinorUnits: 1_000,
      timeSeconds: 1_700_000_000,
      description: 'Top up',
    };
    const topUpOne: ParsedTransaction = { ...topUp, description: 'Top up 1' };

    const first = computeDedupKey('holding-1', topUp, 0);
    const second = computeDedupKey('holding-1', topUp, 1);
    const third = computeDedupKey('holding-1', topUpOne, 0);

    expect(new Set([first, second, third]).size).toBe(3);
  });

  // A property test over random descriptions that end in digits: no pair of
  // (occurrenceIndex, description) combinations the mapper can produce for
  // ONE (holding, time, amount) tuple collides onto the same key.
  it('stays injective across random descriptions ending in digits and any occurrenceIndex', () => {
    const keys = new Set<string>();

    for (let occurrenceIndex = 0; occurrenceIndex < 5; occurrenceIndex += 1) {
      for (let trailingDigits = 0; trailingDigits < 20; trailingDigits += 1) {
        const transaction: ParsedTransaction = {
          currency: 'UAH',
          amountMinorUnits: 500,
          timeSeconds: 1_700_000_000,
          description: `Top up ${trailingDigits}`,
        };

        keys.add(computeDedupKey('holding-1', transaction, occurrenceIndex));
      }
    }

    expect(keys.size).toBe(5 * 20);
  });
});
