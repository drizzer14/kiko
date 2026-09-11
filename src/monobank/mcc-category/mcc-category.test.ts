import { categoryForMcc } from './mcc-category';

describe('categoryForMcc', () => {
  // The returned value is PERSISTED into `transactions.category`, which is
  // keyed by the `categories.key` slug (see 0002_seed_categories.sql) — not by
  // a display title. A capitalized value here never matched the lowercase slug
  // predicates elsewhere (categoriesRepo.delete), so it is the slug that must
  // come back from this mapper.
  it('returns the lowercase categories.key slug, matching the seed migration', () => {
    expect(categoryForMcc(5411)).toBe('groceries');
    expect(categoryForMcc(5812)).toBe('dining');
    expect(categoryForMcc(6011)).toBe('cash');
    expect(categoryForMcc(4829)).toBe('transfers');
    expect(categoryForMcc(9999)).toBe('other');
  });

  it('maps a transport MCC to the transport slug', () => {
    expect(categoryForMcc(4111)).toBe('transport');
  });

  it('never returns a value that differs from its own lowercase form', () => {
    const mccs = [5411, 5422, 5812, 4111, 5651, 4814, 7832, 8011, 6011, 6012, 4829, 9999];

    for (const mcc of mccs) {
      const category = categoryForMcc(mcc);

      expect(category).toBe(category.toLowerCase());
    }
  });
});
