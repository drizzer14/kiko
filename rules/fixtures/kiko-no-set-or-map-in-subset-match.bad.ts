// Semgrep fixture (POSITIVE): a Set, Map, WeakSet or WeakMap as a property value inside
// `toMatchObject` or `expect.objectContaining`. Neither matcher compares the members (expect
// 29.7.0). `toMatchObject` reads a Set or Map as an object with no keys, so it is vacuous at a
// PRESENT key: `undefined`, `null`, `{}` and `[2]` all pass against `new Set([1])`, while a
// missing key or a different Set fails. `expect.objectContaining` checks the kind only: a
// DIFFERENT Set or Map passes, while `undefined`, `{}` and a missing key fail.
// `kiko-no-set-or-map-in-subset-match` MUST report a finding on each pinned line below. Never
// "fix" this file.
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
