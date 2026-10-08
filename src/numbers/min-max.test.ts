import { maxOf, minOf } from './min-max';

describe('minOf', () => {
  it('returns the smallest element', () => {
    expect(minOf([3, 1, 2])).toBe(1);
  });

  it('returns Infinity for an empty array, the same as Math.min()', () => {
    expect(minOf([])).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns NaN when any element is NaN, the same as Math.min', () => {
    expect(minOf([1, Number.NaN, -5])).toBeNaN();
  });

  it('prefers -0 over 0, the same as Math.min', () => {
    expect(Object.is(minOf([0, -0]), -0)).toBe(true);
  });

  it('accepts a readonly array', () => {
    const values: readonly number[] = [4, -2, 9];

    expect(minOf(values)).toBe(-2);
  });
});

describe('maxOf', () => {
  it('returns the largest element', () => {
    expect(maxOf([3, 1, 2])).toBe(3);
  });

  it('returns -Infinity for an empty array, the same as Math.max()', () => {
    expect(maxOf([])).toBe(Number.NEGATIVE_INFINITY);
  });

  it('returns NaN when any element is NaN, the same as Math.max', () => {
    expect(maxOf([1, Number.NaN, 5])).toBeNaN();
  });

  it('prefers 0 over -0, the same as Math.max', () => {
    expect(Object.is(maxOf([-0, 0]), 0)).toBe(true);
  });

  it('accepts a readonly array', () => {
    const values: readonly number[] = [4, -2, 9];

    expect(maxOf(values)).toBe(9);
  });
});

describe('minOf and maxOf on a large array', () => {
  // The reason these helpers exist: a spread call puts every element on the
  // call stack, so a long ledger or a large statement file throws.
  it('handles an array that a spread call overflows the stack on', () => {
    const size = 300_000;
    const values = new Array<number>(size);

    for (let index = 0; index < size; index += 1) {
      values[index] = ((index * 7919) % size) - 123;
    }

    expect(() => Math.min(...values)).toThrow(RangeError);
    expect(minOf(values)).toBe(-123);
    expect(maxOf(values)).toBe(size - 124);
  });
});
