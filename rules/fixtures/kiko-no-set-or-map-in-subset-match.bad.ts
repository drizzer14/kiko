// Semgrep fixture (POSITIVE): a Set, Map, WeakSet or WeakMap as a property value inside
// `toMatchObject` or `expect.objectContaining`. Jest's subset check reads a Set or Map as an object
// with no keys, so the comparison is vacuous at a PRESENT key: `undefined`, `null`, `{}` and `[2]`
// all pass against `new Set([1])`. A MISSING key still fails, so the match is not vacuous
// everywhere. `kiko-no-set-or-map-in-subset-match` MUST report a finding on each pinned line
// below. Never "fix" this file.
describe('subset matcher with a Set or Map value', () => {
  it('flags a Set property value', () => {
    // EXPECT-FINDING
    expect({ a: new Set([1]) }).toMatchObject({ a: new Set([1]) });
  });

  it('flags a Map nested in an object', () => {
    // EXPECT-FINDING
    expect({ outer: { b: new Map() } }).toMatchObject({ outer: { b: new Map() } });
  });

  it('flags a WeakSet inside expect.objectContaining', () => {
    // EXPECT-FINDING
    expect({ c: new WeakSet() }).toEqual(expect.objectContaining({ c: new WeakSet() }));
  });

  it('flags a Set through resolves', async () => {
    // EXPECT-FINDING
    await expect(Promise.resolve({ a: new Set([1]) })).resolves.toMatchObject({
      a: new Set([1]),
    });
  });
});
