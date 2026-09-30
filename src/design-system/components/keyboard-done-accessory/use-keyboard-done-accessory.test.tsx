import type { FC, ReactNode } from 'react';
import { Keyboard, StyleSheet, TextInput } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
// The border width the pill's bordered glass applies comes from Unistyles'
// own `StyleSheet.hairlineWidth`, which is not necessarily react-native's, so
// the assertion below reads the expected value from the same source the
// style uses (mirrors `glass-surface.component.test.tsx`'s own bordered
// test).
import { StyleSheet as UnistylesStyleSheet } from 'react-native-unistyles';
import '@kiko/i18n/init';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

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

// The Text primitive's `tone -> color` mapping lives inside a
// react-native-unistyles variant, which this project's Jest setup cannot
// resolve back out of a rendered style (the same limitation
// `add-category-row.component.test.tsx`/MoneyText's own test document). Mock
// the design-system Text to surface its `tone` prop through a testID so the
// Done label's tone is assertable; children still render as plain text, so
// every `getByText`/`getByRole` query below is unaffected.
jest.mock('@kiko/design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone = 'textPrimary', children }: { tone?: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
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

  it('exposes Done as an accessible button (the styled Pressable pill action)', async () => {
    const { getByRole } = await render(<Host />);

    expect(getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('dismisses the keyboard when Done is pressed', async () => {
    const dismissSpy = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});

    const { getByText } = await render(<Host />);

    await fireEvent.press(getByText('Done'));

    expect(dismissSpy).toHaveBeenCalledTimes(1);

    dismissSpy.mockRestore();
  });

  // DEVICE BUG: Kiko is dark-only, but a TextInput's
  // `keyboardAppearance` was never set anywhere, leaving the system keyboard
  // to whatever the OS default resolved to instead of an explicit match with
  // this accessory's own dark-themed pill. The hook must hand the SAME
  // 'dark' value to the linked input so the two can never drift out of sync.
  it("gives the linked input the accessory's own dark keyboardAppearance", async () => {
    const { getByLabelText } = await render(<Host />);

    expect(getByLabelText('Field').props.keyboardAppearance).toBe('dark');
  });

  // REDESIGN (2026-09-14): the accessory host is now fully TRANSPARENT — no
  // fill, no border, no corner geometry — it only positions the compact Done
  // pill below it (see `keyboard-done-accessory.styles.ts`'s
  // `accessoryContainer`). It carries no `backgroundColor` at all any more.
  it('renders the host container fully transparent, with no background/border/corner geometry of its own', async () => {
    const { getByTestId } = await render(<Host />);

    const flat = StyleSheet.flatten(getByTestId('keyboard-done-accessory').props.style);
    expect(flat.backgroundColor).toBeUndefined();
    expect(flat.borderTopWidth).toBeUndefined();
    expect(flat.borderBottomLeftRadius).toBeUndefined();
    expect(flat.borderBottomRightRadius).toBeUndefined();
  });

  // REDESIGN (2026-09-14): Done is now a COMPACT pill that sizes to fit its
  // own label — it must never stretch full width the way the old bar did.
  it('sizes the Done pill to hug its own label rather than stretching full width', async () => {
    const { getByRole } = await render(<Host />);

    const flat = StyleSheet.flatten(getByRole('button', { name: 'Done' }).props.style);
    expect(flat.width).toBeUndefined();
    expect(flat.alignSelf).not.toBe('stretch');
  });

  // Addendum: the pill's live Liquid Glass background is
  // still a `GlassSurface material` overlay (see
  // `keyboard-done-accessory.styles.ts`'s `doneGlass` doc comment and its HIG
  // citation), now sized to the PILL itself rather than a full-width bar, and
  // rounded into a true capsule (`radius="full"`). This still exercises the
  // non-glass FALLBACK branch (the global mock pins `isLiquidGlassSupported`
  // to `false`), so `GlassSurface`'s own `-base` sublayer is the flat
  // translucent `View` the `material` variant falls back to — the
  // glass-capable branch is covered in the describe block below.
  it('paints the Done pill background through a GlassSurface material overlay, translucent on the fallback', async () => {
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

    // Fills the pill's own bounds exactly — no extension past any edge (the
    // old bar's bottom-corner extension no longer applies to a floating
    // pill).
    expect(glassStyle.top).toBe(0);
    expect(glassStyle.bottom).toBe(0);
    expect(glassStyle.left).toBe(0);
    expect(glassStyle.right).toBe(0);
  });

  // Addendum: a subtle hairline edge (`bordered`) keeps
  // the pill legible on any content behind the glass, since the pill's
  // translucent fallback/backdrop carries no opaque or strongly-pinned base
  // of its own.
  it('draws a subtle bordered edge on the glass pill for legibility over any backdrop', async () => {
    const { getByTestId } = await render(<Host />);

    const flat = StyleSheet.flatten(getByTestId('keyboard-done-accessory-glass').props.style);
    expect(flat.borderWidth).toBe(UnistylesStyleSheet.hairlineWidth);
    expect(flat.borderColor).toBe(darkTheme.colors.border);
  });

  // The Done label is white (`textPrimary`), not the earlier blue `accent`
  // link tone — see `keyboard-done-accessory.styles.ts`'s `doneLabel` doc
  // comment for why `textPrimary` (not `onAccent`) is the correct DS token
  // for a label on a neutral glass surface with no filled accent background.
  // `textPrimary` resolves to pure white (`#FFFFFF`) on this dark theme (see
  // `theme.test.ts`), which is asserted directly here rather than restated.
  it('renders the Done label in the white textPrimary tone, not the old accent tone', async () => {
    const { getByTestId } = await render(<Host />);

    expect(getByTestId('text-tone-textPrimary')).toHaveTextContent('Done');
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
    // live content actually behind the pill.
    it('renders the live glass material with no muting backdrop underneath it', async () => {
      const { getByTestId, queryByTestId } = await render(<Host />);

      expect(queryByTestId('keyboard-done-accessory-glass-backdrop')).toBeNull();

      const glassBase = getByTestId('keyboard-done-accessory-glass-base');
      expect(glassBase.props.tintColor).toBeUndefined();
    });
  });
});
