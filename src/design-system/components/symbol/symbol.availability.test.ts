import {
  IOS26_SYMBOL_FALLBACKS,
  effectiveFallbackName,
  resolveSymbolName,
} from './symbol.availability';

describe('IOS26_SYMBOL_FALLBACKS', () => {
  it('maps exactly the three known iOS-26 symbols to their iOS-16-safe fallbacks', () => {
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

  it('returns undefined when neither an explicit nor a mapped fallback exists', () => {
    expect(effectiveFallbackName('heart.fill', undefined)).toBeUndefined();
  });
});
