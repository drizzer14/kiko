import { editBarItem } from './edit-bar-item';

describe('editBarItem', () => {
  it('builds a native pencil bar item in its own capsule, labelled for VoiceOver', () => {
    const onPress = jest.fn();
    const item = editBarItem({ label: 'Edit', tintColor: '#FFFFFF', onPress });

    expect(item).toEqual({
      type: 'button',
      label: 'Edit',
      accessibilityLabel: 'Edit',
      icon: { type: 'sfSymbol', name: 'pencil' },
      tintColor: '#FFFFFF',
      sharesBackground: false,
      onPress,
    });
  });

  it('fires onPress when the item is pressed', () => {
    const onPress = jest.fn();

    editBarItem({ label: 'Edit', tintColor: '#FFFFFF', onPress }).onPress();

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
