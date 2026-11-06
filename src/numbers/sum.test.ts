import { sumOf } from './sum';

describe('sumOf', () => {
  it('adds the values', () => {
    expect(sumOf([1, 2, 3.5])).toBe(6.5);
  });

  it('is zero for no values', () => {
    expect(sumOf([])).toBe(0);
  });

  it('keeps a negative value', () => {
    expect(sumOf([5, -8])).toBe(-3);
  });

  it('adds a large array without putting it on the call stack', () => {
    const values = Array.from({ length: 200_000 }, () => 1);

    expect(sumOf(values)).toBe(200_000);
  });
});
