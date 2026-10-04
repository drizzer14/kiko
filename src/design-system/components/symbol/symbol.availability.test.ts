import { effectiveFallbackName } from './symbol.availability';

describe('effectiveFallbackName', () => {
  it('returns the explicit fallback when one is passed', () => {
    expect(effectiveFallbackName('heart.fill', 'heart')).toBe('heart');
  });

  it("falls back to the symbol's own name when no explicit fallback exists", () => {
    expect(effectiveFallbackName('heart.fill', undefined)).toBe('heart.fill');
  });

  // Crash regression (see mode-select-field.component.tsx): a persistent
  // `<SymbolIcon>` instance (the transaction-type select trigger) re-renders
  // with a NEW `name` on every type switch but never unmounts, so its
  // `fallbackName` prop UPDATES rather than mounts fresh. Fabric serializes a
  // prop that becomes `undefined` on an update as native `null`, and the
  // native SFSymbolView binding requires `fallbackName` to be a `String` —
  // handing it `null` throws `Exception in HostFunction:
  // NitroSfsymbols.fallbackName: Value is null, expected a String` and
  // crashes the app in Release (no redbox to catch it).
  // `effectiveFallbackName` must NEVER return `undefined`, for any name, so
  // the native prop is always a stable string across every update.
  it('never returns undefined, for any transaction MODE_ICONS value (crash regression)', () => {
    const MODE_ICONS = [
      'arrow.down',
      'arrow.up',
      'arrow.left.arrow.right',
      'arrow.trianglehead.branch',
    ];

    for (const name of MODE_ICONS) {
      expect(effectiveFallbackName(name, undefined)).toEqual(expect.any(String));
      expect(effectiveFallbackName(name, undefined)).not.toBe('');
    }
  });

  it('returns a string for an inherited object key too', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      expect(effectiveFallbackName(name, undefined)).toBe(name);
    }
  });
});
