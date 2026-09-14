import { fireEvent, render } from '@testing-library/react-native';
import type { FC } from 'react';
import { Keyboard, StyleSheet, TextInput } from 'react-native';
import '../../../i18n';
import '../../unistyles';

import { darkTheme } from '../../theme';
import { useKeyboardDoneAccessory } from './use-keyboard-done-accessory';

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
});
