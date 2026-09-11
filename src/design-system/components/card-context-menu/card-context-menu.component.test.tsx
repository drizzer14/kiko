import { openDeleteMenu } from '@kiko/design-system/grid-interaction';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import CardContextMenu, { HOLD_GESTURE_TEST_ID } from './card-context-menu.component';

// A GestureDetector must mount under a GestureHandlerRootView, so every render
// goes through it (the app supplies one at its root in production).
const wrapper = ({ children }: { children: ReactNode }) => (
  <GestureHandlerRootView>{children}</GestureHandlerRootView>
);

// The deep-press delete menu itself (haptic + ActionSheetIOS) is unit-tested in
// grid-interaction.test.ts; here the module is mocked so the component test can
// assert the long-press gesture is wired to it with the card's name and delete
// callback — without presenting a real native sheet.
jest.mock('@kiko/design-system/grid-interaction', () => ({
  ...jest.requireActual('@kiko/design-system/grid-interaction'),
  openDeleteMenu: jest.fn(),
}));

describe('CardContextMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens the deep-press delete menu with the card name on a still touch-and-hold of a deletable card', async () => {
    const onDelete = jest.fn();
    await render(
      <CardContextMenu name="Black card" deletable onDelete={onDelete}>
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper },
    );

    // A hold that reaches ACTIVE (stayed still past the min duration, under the
    // max distance) triggers the menu; movement would have failed the gesture.
    fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
      { state: State.BEGAN },
      { state: State.ACTIVE },
      { state: State.END },
    ]);

    expect(openDeleteMenu).toHaveBeenCalledWith('Black card', onDelete);
  });

  it('leaves a plain tap to the child card and never opens the menu', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(
      <CardContextMenu name="Black card" deletable onDelete={jest.fn()}>
        <Pressable onPress={onPress}>
          <Text>card</Text>
        </Pressable>
      </CardContextMenu>,
      { wrapper },
    );

    fireEvent.press(getByText('card'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(openDeleteMenu).not.toHaveBeenCalled();
  });

  it('renders a synced (non-deletable) card bare, with no gesture to intercept the touch-and-hold drag', async () => {
    const { queryByTestId, getByText } = await render(
      <CardContextMenu name="Synced" deletable={false} onDelete={jest.fn()}>
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper },
    );

    expect(queryByTestId('card-context-menu')).toBeNull();
    expect(getByText('card')).toBeTruthy();
  });
});
