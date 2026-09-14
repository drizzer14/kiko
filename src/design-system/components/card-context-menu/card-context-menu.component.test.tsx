import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { trigger } from 'react-native-haptic-feedback';
import { act, fireEvent, render } from '@testing-library/react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '../../unistyles';

import CardContextMenu, {
  DELETE_ACTION_TEST_ID,
  DELETE_CONFIRM_TEST_ID,
  DUPLICATE_ACTION_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from './card-context-menu.component';

// A GestureDetector must mount under a GestureHandlerRootView, so every render
// goes through it (the app supplies one at its root in production).
const wrapper = ({ children }: { children: ReactNode }) => (
  <GestureHandlerRootView>{children}</GestureHandlerRootView>
);

describe('CardContextMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens the themed delete confirm (haptic, no native sheet) on a still touch-and-hold of a deletable card, routing confirm to onDelete', async () => {
    const onDelete = jest.fn();
    const { getByTestId, getByText } = await render(
      <CardContextMenu name="Black card" deletable onDelete={onDelete}>
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper },
    );

    // A hold that reaches ACTIVE (stayed still past the min duration, under the
    // max distance) triggers the confirm; movement would have failed the gesture.
    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });

    // The hold plays the medium-impact haptic and raises the themed confirm
    // sheet titled `Delete "<name>"` — not a native ActionSheetIOS — and
    // deletes nothing until its destructive confirm is pressed.
    expect(trigger).toHaveBeenCalledWith('impactMedium');
    expect(getByText('Delete "Black card"')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('leaves a plain tap to the child card and never opens the confirm', async () => {
    const onPress = jest.fn();
    const { getByText, queryByText } = await render(
      <CardContextMenu name="Black card" deletable onDelete={jest.fn()}>
        <Pressable onPress={onPress}>
          <Text>card</Text>
        </Pressable>
      </CardContextMenu>,
      { wrapper },
    );

    fireEvent.press(getByText('card'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(queryByText('Delete "Black card"')).toBeNull();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('offers a Duplicate/Delete action list on hold when onDuplicate is provided, routing Duplicate to onDuplicate without deleting', async () => {
    const onDuplicate = jest.fn();
    const onDelete = jest.fn();
    const { getByTestId, queryByText } = await render(
      <CardContextMenu name="Coffee" deletable onDelete={onDelete} onDuplicate={onDuplicate}>
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper },
    );

    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });

    // A hold now opens a CHOICE (Duplicate + Delete), not the delete confirm
    // directly — the named delete confirm is not shown yet.
    expect(trigger).toHaveBeenCalledWith('impactMedium');
    expect(getByTestId(DUPLICATE_ACTION_TEST_ID)).toBeTruthy();
    expect(getByTestId(DELETE_ACTION_TEST_ID)).toBeTruthy();
    expect(queryByText('Delete "Coffee"')).toBeNull();

    fireEvent.press(getByTestId(DUPLICATE_ACTION_TEST_ID));

    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('routes the action list Delete through the themed confirm sheet, then to onDelete', async () => {
    const onDuplicate = jest.fn();
    const onDelete = jest.fn();
    const { getByTestId, getByText } = await render(
      <CardContextMenu name="Coffee" deletable onDelete={onDelete} onDuplicate={onDuplicate}>
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper },
    );

    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });

    // Choosing Delete from the action list opens the SAME named confirm sheet
    // the delete-only path uses; only its destructive confirm routes to onDelete.
    await act(async () => {
      fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
    });

    expect(getByText('Delete "Coffee"')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it('renders a synced (non-deletable) card bare, with no gesture and no confirm sheet', async () => {
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
