import { fireEvent, render } from '@testing-library/react-native';
import type { FC } from 'react';
import { Keyboard, TextInput } from 'react-native';
import '../../../i18n';
import '../../unistyles';

import { useKeyboardDoneAccessory } from './use-keyboard-done-accessory';

// A minimal host that wires the hook exactly as a real field does: the input
// links to the accessory by id, and the accessory renders alongside it.
const Host: FC = () => {
  const { inputAccessoryViewID, accessory } = useKeyboardDoneAccessory();

  return (
    <>
      <TextInput accessibilityLabel="Field" inputAccessoryViewID={inputAccessoryViewID} />
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
});
