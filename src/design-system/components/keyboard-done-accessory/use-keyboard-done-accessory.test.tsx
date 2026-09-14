import { fireEvent, render } from '@testing-library/react-native';
import type { FC } from 'react';
import { Keyboard, StyleSheet, TextInput } from 'react-native';
import '../../../i18n';
import '../../unistyles';

import { darkTheme } from '../../theme';
import { useKeyboardDoneAccessory } from './use-keyboard-done-accessory';

// The global jest/setup.js mock renders LiquidGlassView as a plain View and
// pins `isLiquidGlassSupported` to false (the non-glass fallback path). This
// file-level mock keeps the same default so every existing fallback-branch
// test is unchanged, but exposes the flag as a MUTABLE property (the same
// pattern `bottom-sheet.component.test.tsx`/`glass-surface.component.test.tsx`
// use) so the glass-capable describe block below can flip it on for its own
// scope.
jest.mock('@callstack/liquid-glass', () => {
  const { View } = require('react-native');
  return { LiquidGlassView: View, isLiquidGlassSupported: false };
});

const liquidGlass = jest.requireMock('@callstack/liquid-glass') as {
  isLiquidGlassSupported: boolean;
};

// A minimal host that wires the hook exactly as a real field does: the input
// links to the accessory by id and takes its keyboardAppearance, and the
// accessory renders alongside it.
const Host: FC = () => {
  const { inputAccessoryViewID, accessory, keyboardAppearance } = useKeyboardDoneAccessory();

  return (
    <>
      <TextInput
        accessibilityLabel="Field"
        inputAccessoryViewID={inputAccessoryViewID}
        keyboardAppearance={keyboardAppearance}
      />
      {accessory}
    </>
  );
};

describe('useKeyboardDoneAccessory', () => {
  it('renders a native Done accessory linked to the input on iOS', async () => {
    const { getByText, getByLabelText } = await render(<Host />);

    // The accessory shows Done, and the input is linked to it by a shared id.
    expect(getByText('Done')).toBeTruthy();
    expect(getByLabelText('Field').props.inputAccessoryViewID).toBeDefined();
  });

  it('exposes Done as an accessible button (the styled Pressable toolbar action)', async () => {
    const { getByRole } = await render(<Host />);

    expect(getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('dismisses the keyboard when Done is pressed', async () => {
    const dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});

    const { getByText } = await render(<Host />);

    fireEvent.press(getByText('Done'));

    expect(dismissSpy).toHaveBeenCalledTimes(1);

    dismissSpy.mockRestore();
  });

  // DEVICE BUG (review, 2026-09-14): Kiko is dark-only, but a TextInput's
  // `keyboardAppearance` was never set anywhere, leaving the system keyboard
  // to whatever the OS default resolved to instead of an explicit match with
  // this accessory bar's own dark fill. The hook must hand the SAME 'dark'
  // value to the linked input so the two can never drift out of sync.
  it("gives the linked input the accessory's own dark keyboardAppearance", async () => {
    const { getByLabelText } = await render(<Host />);

    expect(getByLabelText('Field').props.keyboardAppearance).toBe('dark');
  });

  // DEVICE BUG (review, 2026-09-14): the accessory bar used to paint the
  // opaque surfaceHigh fill, a step lighter/more "raised" than the real
  // system keyboard beneath it, so it read as a detached strip rather than
  // part of the keyboard. It must carry the dedicated
  // keyboardAccessoryBackground approximation token instead (see that
  // token's own doc comment in theme.ts for the full research writeup).
  it('fills the accessory bar with the keyboardAccessoryBackground token, not surfaceHigh', async () => {
    const { getByTestId } = await render(<Host />);

    const flat = StyleSheet.flatten(getByTestId('keyboard-done-accessory').props.style);
    expect(flat.backgroundColor).toBe(darkTheme.colors.keyboardAccessoryBackground);
    expect(flat.backgroundColor).not.toBe(darkTheme.colors.surfaceHigh);
  });

  // Addendum (review, 2026-09-14): the flat keyboardAccessoryBackground fill
  // above is now a SOLID FALLBACK, not the bar's only fill — a real Liquid
  // Glass `GlassSurface material` overlay paints over it (see
  // `keyboard-done-accessory.styles.ts`'s `accessoryContainer`/
  // `accessoryGlass` doc comments and their HIG citation). This still
  // exercises the non-glass FALLBACK branch (the global mock pins
  // `isLiquidGlassSupported` to `false`), so `GlassSurface`'s own `-base`
  // sublayer is the flat translucent `View` the `material` variant falls
  // back to — the glass-capable branch is covered in the describe block
  // below.
  it('paints the accessory background through a GlassSurface material overlay, translucent on the fallback', async () => {
    const { getByTestId, queryByTestId } = await render(<Host />);

    const glass = getByTestId('keyboard-done-accessory-glass');
    const glassStyle = StyleSheet.flatten(glass.props.style);

    // No color-pinning backdrop — the material variant never adds one, on
    // either path.
    expect(queryByTestId('keyboard-done-accessory-glass-backdrop')).toBeNull();

    const glassBaseStyle = StyleSheet.flatten(
      getByTestId('keyboard-done-accessory-glass-base').props.style,
    );
    expect(glassBaseStyle.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);
    expect(glassBaseStyle.backgroundColor).not.toBe(darkTheme.colors.surfaceHigh);

    // Pushed past the container's own top edge by the SAME radius its
    // bottom corners round to (`ACCESSORY_BOTTOM_RADIUS`), so its top two
    // corners round outside the visible, clipped area and only the bottom
    // two (matching the container's own) stay visible.
    expect(glassStyle.top).toBe(-darkTheme.radii.lg);
    expect(glassStyle.bottom).toBe(0);
  });

  // Addendum (review, 2026-09-14): a flat-rectangle accessory bar left a gap
  // at its own bottom corners against the real keyboard's rounded top
  // corners. The bar's own container now rounds its BOTTOM two corners
  // (and clips both the solid fallback and the glass overlay to that same
  // shape) while its TOP edge stays square, since it borders app content,
  // not the keyboard.
  it('rounds only the bottom two corners of the accessory bar, clipped to match the keyboard edge', async () => {
    const { getByTestId } = await render(<Host />);

    const flat = StyleSheet.flatten(getByTestId('keyboard-done-accessory').props.style);
    expect(flat.borderBottomLeftRadius).toBe(darkTheme.radii.lg);
    expect(flat.borderBottomRightRadius).toBe(darkTheme.radii.lg);
    expect(flat.borderTopLeftRadius).toBeUndefined();
    expect(flat.borderTopRightRadius).toBeUndefined();
    expect(flat.overflow).toBe('hidden');
  });

  describe('on liquid-glass-capable iOS', () => {
    beforeEach(() => {
      liquidGlass.isLiquidGlassSupported = true;
    });
    afterEach(() => {
      liquidGlass.isLiquidGlassSupported = false;
    });

    // The real Liquid Glass branch: unlike `transparent`, `material` adds NO
    // color-pinning backdrop on the glass path, so the material samples the
    // live content actually behind the accessory bar.
    it('renders the live glass material with no muting backdrop underneath it', async () => {
      const { getByTestId, queryByTestId } = await render(<Host />);

      expect(queryByTestId('keyboard-done-accessory-glass-backdrop')).toBeNull();

      const glassBase = getByTestId('keyboard-done-accessory-glass-base');
      expect(glassBase.props.tintColor).toBeUndefined();
    });
  });
});
