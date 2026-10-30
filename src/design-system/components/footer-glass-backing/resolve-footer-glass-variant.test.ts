import '@kiko/design-system/unistyles';

import { resolveFooterGlassVariant } from '.';

jest.mock('@callstack/liquid-glass', () => ({
  LiquidGlassView: 'LiquidGlassView',
  isLiquidGlassSupported: true,
}));

const liquidGlass = jest.requireMock('@callstack/liquid-glass') as {
  isLiquidGlassSupported: boolean;
};

const FILLED = [
  'primary',
  'secondary',
  'destructive',
  'secondaryTonal',
  'destructiveTonal',
] as const;

describe('resolveFooterGlassVariant', () => {
  afterEach(() => {
    liquidGlass.isLiquidGlassSupported = true;
  });

  it.each(FILLED)('puts a %s button on glass in a floating footer on iOS 26+', (variant) => {
    expect(resolveFooterGlassVariant(variant, true)).toBe(variant);
  });

  it.each(FILLED)('keeps the normal fill of a %s button outside a floating footer', (variant) => {
    expect(resolveFooterGlassVariant(variant, false)).toBeUndefined();
  });

  it.each(FILLED)('keeps the normal fill of a %s button below iOS 26', (variant) => {
    liquidGlass.isLiquidGlassSupported = false;

    expect(resolveFooterGlassVariant(variant, true)).toBeUndefined();
  });

  it.each([true, false])('gives a ghost button no glass (floating footer: %s)', (isFloating) => {
    expect(resolveFooterGlassVariant('ghost', isFloating)).toBeUndefined();
  });
});
