import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import { FloatingFooterContext } from '@kiko/design-system/floating-footer';

import Button from './button.component';

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

const renderButton = (variant: (typeof FILLED)[number] | 'ghost', isFloating: boolean) =>
  render(
    <FloatingFooterContext.Provider value={isFloating}>
      <Button variant={variant} testID="footer-button" onPress={() => {}}>
        Save
      </Button>
    </FloatingFooterContext.Provider>,
  );

const styleOf = (view: Awaited<ReturnType<typeof renderButton>>) =>
  StyleSheet.flatten(view.getByTestId('footer-button').props.style);

describe('Button in a floating footer', () => {
  afterEach(() => {
    liquidGlass.isLiquidGlassSupported = true;
  });

  it.each(FILLED)(
    'draws a %s button on the glass backing with no fill of its own',
    async (variant) => {
      const view = await renderButton(variant, true);

      expect(view.getByTestId('footer-glass-backing')).toBeTruthy();
      expect(styleOf(view).backgroundColor).toBe('transparent');
    },
  );

  it.each(FILLED)(
    'keeps the normal fill of a %s button outside a floating footer',
    async (variant) => {
      const view = await renderButton(variant, false);

      expect(view.queryByTestId('footer-glass-backing')).toBeNull();
      expect(styleOf(view).backgroundColor).not.toBe('transparent');
      expect(styleOf(view).borderRadius).not.toBe(darkTheme.radii.full);
    },
  );

  it.each(['primary', 'secondary', 'destructive'] as const)(
    'keeps the solid fill of a %s button below iOS 26',
    async (variant) => {
      liquidGlass.isLiquidGlassSupported = false;
      const view = await renderButton(variant, true);

      expect(view.queryByTestId('footer-glass-backing')).toBeNull();
      expect(styleOf(view).backgroundColor).not.toBe('transparent');
    },
  );

  it.each(['secondaryTonal', 'destructiveTonal'] as const)(
    'draws a %s button on a solid backing below iOS 26 in place of its translucent fill',
    async (variant) => {
      liquidGlass.isLiquidGlassSupported = false;
      const view = await renderButton(variant, true);

      expect(view.getByTestId('footer-glass-backing')).toBeTruthy();
      expect(styleOf(view).backgroundColor).toBe('transparent');
    },
  );

  it.each(['secondaryTonal', 'destructiveTonal'] as const)(
    'keeps the translucent fill of a %s button outside a floating footer below iOS 26',
    async (variant) => {
      liquidGlass.isLiquidGlassSupported = false;
      const view = await renderButton(variant, false);

      expect(view.queryByTestId('footer-glass-backing')).toBeNull();
      expect(styleOf(view).backgroundColor).not.toBe('transparent');
    },
  );

  it('gives a ghost button no glass backing', async () => {
    const view = await renderButton('ghost', true);

    expect(view.queryByTestId('footer-glass-backing')).toBeNull();
  });

  it.each([...FILLED, 'ghost'] as const)(
    'makes a %s button a capsule in a floating footer, with or without glass',
    async (variant) => {
      liquidGlass.isLiquidGlassSupported = false;
      const view = await renderButton(variant, true);

      expect(styleOf(view).borderRadius).toBe(darkTheme.radii.full);
    },
  );
});
