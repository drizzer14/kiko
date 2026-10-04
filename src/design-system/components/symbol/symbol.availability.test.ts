import {
  SYMBOL_FALLBACKS,
  effectiveFallbackName,
  isOsBelow,
  resolveSymbolName,
} from './symbol.availability';

describe('SYMBOL_FALLBACKS', () => {
  it('holds one entry per symbol newer than iOS 15.1 that the app can draw', () => {
    expect(Object.keys(SYMBOL_FALLBACKS)).toHaveLength(73);
  });

  it('records the real minimum iOS of the three symbols the old iOS-26-only map covered', () => {
    // Two of the three were never iOS 26: they are SF Symbols 6.0 (iOS 18.0).
    expect(SYMBOL_FALLBACKS['arrow.trianglehead.2.clockwise.rotate.90']).toEqual({
      minimumIos: '18.0',
      fallback: 'arrow.triangle.2.circlepath',
    });
    expect(SYMBOL_FALLBACKS['arrow.trianglehead.branch']).toEqual({
      minimumIos: '18.0',
      fallback: 'arrow.triangle.branch',
    });
    expect(SYMBOL_FALLBACKS['text.pad.header']).toEqual({
      minimumIos: '26.0',
      fallback: 'list.bullet.rectangle',
    });
  });

  it('records the minor-version minimums (16.1 and 18.2)', () => {
    expect(SYMBOL_FALLBACKS.handbag).toEqual({ minimumIos: '16.1', fallback: 'bag' });
    expect(SYMBOL_FALLBACKS.receipt).toEqual({ minimumIos: '18.2', fallback: 'doc.text' });
  });
});

describe('isOsBelow', () => {
  it.each([
    ['15.1', '16.0', true],
    ['16.0', '16.1', true],
    ['16.1', '16.1', false],
    ['16.4', '16.1', false],
    ['17.0', '16.1', false],
    ['18.1', '18.2', true],
    ['26', '26.0', false],
    ['25.9', '26.0', true],
    ['26.0.1', '26.0', false],
    ['9.3', '16.0', true],
  ])('is %s below %s: %s', (osVersion, minimumIos, expected) => {
    expect(isOsBelow(osVersion, minimumIos)).toBe(expected);
  });

  it('never claims an unreadable running version is below a minimum', () => {
    expect(isOsBelow('', '16.0')).toBe(false);
    expect(isOsBelow('unknown', '16.0')).toBe(false);
  });
});

describe('resolveSymbolName', () => {
  // One sample per release, each across the boundary of its own minimum.
  it.each([
    ['dollarsign', '15.1', 'dollarsign.square'],
    ['dollarsign', '16.0', 'dollarsign'],
    ['handbag', '16.0', 'bag'],
    ['handbag', '16.1', 'handbag'],
    ['cat', '16.4', 'pawprint'],
    ['cat', '17.0', 'cat'],
    ['document', '17.6', 'doc'],
    ['document', '18.0', 'document'],
    ['arrow.trianglehead.branch', '17.5', 'arrow.triangle.branch'],
    ['arrow.trianglehead.branch', '18.1', 'arrow.trianglehead.branch'],
    ['receipt', '18.1', 'doc.text'],
    ['receipt', '18.2', 'receipt'],
    ['receipt', '26.0', 'receipt'],
    ['text.pad.header', '18.2', 'list.bullet.rectangle'],
    ['text.pad.header', '25.9', 'list.bullet.rectangle'],
    ['text.pad.header', '26', 'text.pad.header'],
  ])('renders %s on iOS %s as %s', (name, osVersion, expected) => {
    expect(resolveSymbolName(name, undefined, osVersion)).toBe(expected);
  });

  it('prefers an explicit fallbackName over the central map below the minimum', () => {
    expect(resolveSymbolName('receipt', 'custom.fallback', '16.4')).toBe('custom.fallback');
  });

  it('leaves a mapped symbol unchanged at its minimum even with an explicit fallbackName', () => {
    expect(resolveSymbolName('receipt', 'custom.fallback', '18.2')).toBe('receipt');
  });

  it('leaves a symbol with no map entry unchanged on any OS', () => {
    expect(resolveSymbolName('heart.fill', undefined, '15.1')).toBe('heart.fill');
    expect(resolveSymbolName('heart.fill', undefined, '26.0')).toBe('heart.fill');
  });

  it('leaves a symbol with an explicit fallback but no map entry unchanged (defers to native fallback)', () => {
    // An arbitrary symbol's minimum iOS is unknown in JS, so a non-mapped
    // symbol is passed through unchanged; SFSymbolView's native `fallbackName`
    // is the runtime net for it.
    expect(resolveSymbolName('some.newer.symbol', 'older.symbol', '15.1')).toBe(
      'some.newer.symbol',
    );
  });

  it('leaves a mapped symbol unchanged when the running version cannot be read', () => {
    expect(resolveSymbolName('receipt', undefined, '')).toBe('receipt');
  });

  it('treats an inherited object key as no map entry', () => {
    expect(resolveSymbolName('constructor', undefined, '15.1')).toBe('constructor');
  });
});

describe('effectiveFallbackName', () => {
  it('returns the central-map fallback for a mapped symbol with no explicit fallback', () => {
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
  // transaction MODE_ICONS values is in the central fallback map
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

  it('never returns a non-string for any mapped symbol or inherited object key', () => {
    for (const name of [...Object.keys(SYMBOL_FALLBACKS), 'constructor', 'toString', '__proto__']) {
      expect(effectiveFallbackName(name, undefined)).toEqual(expect.any(String));
      expect(effectiveFallbackName(name, undefined)).not.toBe('');
    }
  });
});
