// Semgrep fixture (NEGATIVE): none of these hands a Set or Map to a subset matcher as a property
// value. `kiko-no-set-or-map-in-subset-match` MUST report nothing here.
describe('subset matcher without a Set or Map value', () => {
  it('compares a Set with toEqual, which checks its members', () => {
    expect(new Set([1])).toEqual(new Set([1]));
  });

  it('spreads a Set into an array inside toMatchObject', () => {
    const values = [1, 1, 2];

    expect({ a: [1, 2] }).toMatchObject({ a: [...new Set(values)] });
  });

  it('reads the size of a Set inside toMatchObject', () => {
    const values = [1, 1, 2];

    expect({ count: 2 }).toMatchObject({ count: new Set(values).size });
  });

  it('keeps a Set outside any subset matcher', () => {
    const seen = new Set([1]);

    expect(seen.has(1)).toBe(true);
    expect({ a: seen }.a).toBe(seen);
  });
});
