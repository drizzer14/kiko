import { categoryForMcc } from '../../monobank/mcc-category';
import type { ParsedTransaction } from '../parser';

import { computeDedupKey, mapParsedTransaction } from './mapping';

const groceryTransaction: ParsedTransaction = {
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
    expect(second).toBe(`${first} 1`);
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
});
