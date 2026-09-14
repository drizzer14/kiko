import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import '../../unistyles';

import { darkTheme } from '../../theme';

// Aliased to SymbolIcon, not Symbol: importing the default export as
// `Symbol` shadows the global `Symbol` constructor
// (lint/suspicious/noShadowRestrictedNames) at every call site, not just
// inside this component's own file. Every consumer (this test, and screens
// once wired) must import it under a different local name. Imported through
// the folder's index (the real path a screen consumes,
// `design-system/components/symbol`), not `./symbol.component` directly, so
// this test also exercises index.ts's re-export.
import SymbolIcon from '.';

describe('Symbol', () => {
  // The two OS-version tests below spy on Platform.Version's getter; restore it
  // so the default jest platform version is back for every other test.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders without crashing (react-native-nitro-sfsymbols is mocked under Jest)', async () => {
    const { toJSON } = await render(<SymbolIcon name="heart.fill" accessibilityLabel="Favorite" />);

    expect(toJSON()).toBeTruthy();
  });

  it('defaults the glyph size to the body icon-size token', async () => {
    const { getByLabelText } = await render(
      <SymbolIcon name="heart.fill" accessibilityLabel="Favorite" />,
    );

    expect(getByLabelText('Favorite').props.size).toBe(darkTheme.iconSizes.body);
  });

  it('frames the default-size glyph at the body icon-size token so it paints', async () => {
    const { getByLabelText } = await render(
      <SymbolIcon name="heart.fill" accessibilityLabel="Favorite" />,
    );

    // Fabric gives SFSymbolView no intrinsic size, so a 0x0 frame never paints.
    // With no explicit `size`, the frame must fall back to the resolved body token.
    expect(getByLabelText('Favorite').props.style).toEqual({
      width: darkTheme.iconSizes.body,
      height: darkTheme.iconSizes.body,
    });
  });

  it('frames the glyph at the explicit size when one is passed', async () => {
    const { getByLabelText } = await render(
      <SymbolIcon name="heart.fill" size={40} accessibilityLabel="Favorite" />,
    );

    expect(getByLabelText('Favorite').props.style).toEqual({ width: 40, height: 40 });
  });

  it('tints the glyph with an explicit color, overriding the tone token', async () => {
    const { getByLabelText } = await render(
      <SymbolIcon name="heart.fill" color="#FFD60A" accessibilityLabel="Favorite" />,
    );

    // The explicit color is a palette hex, passed straight through to the native
    // SFSymbolView's tintColor (already hex, so toSFSymbolTintColor is a no-op).
    expect(getByLabelText('Favorite').props.tintColor).toBe('#FFD60A');
  });

  it('normalizes an rgba() color to hex for the native tintColor', async () => {
    const { getByLabelText } = await render(
      <SymbolIcon name="heart.fill" color="rgba(255,214,10,1)" accessibilityLabel="Favorite" />,
    );

    expect(getByLabelText('Favorite').props.tintColor).toBe('#ffd60aff');
  });

  it('forwards an explicit fallbackName to the native view as a runtime net', async () => {
    const { getByLabelText } = await render(
      <SymbolIcon name="some.newer.symbol" fallbackName="heart" accessibilityLabel="Glyph" />,
    );

    expect(getByLabelText('Glyph').props.fallbackName).toBe('heart');
  });

  it('auto-supplies the central fallback for a known iOS-26 symbol with no explicit fallback', async () => {
    // The transaction-type ChipRow passes only a plain name; the split chip's
    // iOS-26 `arrow.trianglehead.branch` must still carry `arrow.branch`.
    const { getByLabelText } = await render(
      <SymbolIcon name="arrow.trianglehead.branch" accessibilityLabel="Split" />,
    );

    expect(getByLabelText('Split').props.fallbackName).toBe('arrow.branch');
  });

  it('renders a known iOS-26 symbol as its fallback NAME on a device below iOS 26', async () => {
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue('16.4');

    const { getByLabelText } = await render(
      <SymbolIcon name="text.pad.header" accessibilityLabel="Holdings" />,
    );

    // Deterministic name swap, independent of the native fallbackName net.
    expect(getByLabelText('Holdings').props.name).toBe('list.bullet.rectangle');
  });

  it('renders a known iOS-26 symbol as itself on a device on iOS 26 or above', async () => {
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue('26.0');

    const { getByLabelText } = await render(
      <SymbolIcon name="text.pad.header" accessibilityLabel="Holdings" />,
    );

    expect(getByLabelText('Holdings').props.name).toBe('text.pad.header');
  });
});
