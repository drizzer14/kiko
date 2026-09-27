import {
  IOS26_SYMBOL_FALLBACKS,
  effectiveFallbackName,
  resolveSymbolName,
} from './symbol.availability';

describe('IOS26_SYMBOL_FALLBACKS', () => {
  it('maps exactly the three known iOS-26 symbols to their iOS-15.1-safe fallbacks', () => {
    expect(IOS26_SYMBOL_FALLBACKS).toEqual({
      'arrow.trianglehead.2.clockwise.rotate.90': 'arrow.triangle.2.circlepath',
      'text.pad.header': 'list.bullet.rectangle',
      'arrow.trianglehead.branch': 'arrow.branch',
    });
  });
});

describe('resolveSymbolName', () => {
  const IOS26_SYMBOL = 'arrow.trianglehead.branch';

  it('renders a known iOS-26 symbol as its mapped fallback below iOS 26', () => {
    // No explicit fallbackName: the central map supplies it.
    expect(resolveSymbolName(IOS26_SYMBOL, undefined, 16)).toBe('arrow.branch');
  });

  it('renders a known iOS-26 symbol as itself on iOS 26 exactly', () => {
    expect(resolveSymbolName(IOS26_SYMBOL, undefined, 26)).toBe(IOS26_SYMBOL);
  });

  it('renders a known iOS-26 symbol as itself above iOS 26', () => {
    expect(resolveSymbolName(IOS26_SYMBOL, undefined, 27)).toBe(IOS26_SYMBOL);
  });

  it('prefers an explicit fallbackName over the central map for a known symbol below iOS 26', () => {
    expect(resolveSymbolName(IOS26_SYMBOL, 'custom.fallback', 16)).toBe('custom.fallback');
  });

  it('leaves a symbol with no known minimum and no fallback unchanged on any OS', () => {
    expect(resolveSymbolName('heart.fill', undefined, 16)).toBe('heart.fill');
    expect(resolveSymbolName('heart.fill', undefined, 27)).toBe('heart.fill');
  });

  it('leaves a symbol with an explicit fallback but no known minimum unchanged (defers to native fallback)', () => {
    // We cannot know an arbitrary symbol's minimum iOS in JS, so a non-mapped
    // symbol is passed through unchanged; SFSymbolView's native `fallbackName`
    // is the runtime net for it (§3.0.5).
    expect(resolveSymbolName('some.newer.symbol', 'older.symbol', 16)).toBe('some.newer.symbol');
  });
});

describe('effectiveFallbackName', () => {
  it('returns the central-map fallback for a known iOS-26 symbol with no explicit fallback', () => {
    expect(effectiveFallbackName('text.pad.header', undefined)).toBe('list.bullet.rectangle');
  });

  it('returns the explicit fallback when one is passed, overriding the map', () => {
    expect(effectiveFallbackName('text.pad.header', 'custom.fallback')).toBe('custom.fallback');
  });

  it('returns the explicit fallback for a symbol with no central-map entry', () => {
    expect(effectiveFallbackName('heart.fill', 'heart')).toBe('heart');
  });

  it("falls back to the symbol's own name when neither an explicit nor a mapped fallback exists", () => {
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
  // crashes the app in Release (no redbox to catch it). Only one of the four
  // transaction MODE_ICONS values is in the central iOS-26 fallback map
  // (`split`'s `arrow.trianglehead.branch`); the other three
  // (`income`/`expense`/`exchange`) have no map entry and used to resolve to
  // `undefined`, toggling `fallbackName` from a string to `undefined` on the
  // SAME instance when switching away from Split — exactly the crashing
  // transition.
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
});
