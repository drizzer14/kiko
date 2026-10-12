import { isSameCategory } from './same-category';

describe('isSameCategory', () => {
  it.each([
    ['the same key', 'food', 'food'],
    ['a key stored with capitals', 'Food', 'food'],
    ['a key asked for with capitals', 'food', 'FOOD'],
  ])('is true for %s', (_label, stored, asked) => {
    expect(isSameCategory(stored, asked)).toBe(true);
  });

  it('is false for another category', () => {
    expect(isSameCategory('food', 'groceries')).toBe(false);
  });

  it('is false for a row with no category', () => {
    expect(isSameCategory(null, 'food')).toBe(false);
  });
});
