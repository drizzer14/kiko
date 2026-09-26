import {
  createGestureController,
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';
import { State } from 'react-native-gesture-handler';
import { trigger } from 'react-native-haptic-feedback';
import { Pressable, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';
// Real i18n init (side effect), same as App.tsx. Previously reached only by
// accident through GlassSurface -> screenshot-mode -> i18n before the 5.6
// screenshot-subsystem strip removed that import chain; now imported directly
// so the sheet's `t('common.cancel')`/`t('common.delete')` resolve under test
// the same way they do at runtime.
import '../../../i18n';

import GestureRootWrapper from '../../../test-support/gesture-root-wrapper';

import CardContextMenu, {
  EDIT_ACTION_TEST_ID,
  DELETE_ACTION_TEST_ID,
  HOLD_GESTURE_TEST_ID,
  DELETE_CONFIRM_TEST_ID,
  DUPLICATE_ACTION_TEST_ID,
} from './card-context-menu.component';

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
      { wrapper: GestureRootWrapper },
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
      { wrapper: GestureRootWrapper },
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
      { wrapper: GestureRootWrapper },
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
      { wrapper: GestureRootWrapper },
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

  it('offers an Edit/Delete action list on hold when onEdit is provided, routing Edit to onEdit without deleting', async () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const { getByTestId, queryByTestId, queryByText } = await render(
      <CardContextMenu name="50% since 01.06.2025" deletable onDelete={onDelete} onEdit={onEdit}>
        <Text>row</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });

    expect(getByTestId(EDIT_ACTION_TEST_ID)).toHaveTextContent('Edit');
    expect(getByTestId(DELETE_ACTION_TEST_ID)).toBeTruthy();
    expect(queryByTestId(DUPLICATE_ACTION_TEST_ID)).toBeNull();
    expect(queryByText('Delete "50% since 01.06.2025"')).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId(EDIT_ACTION_TEST_ID));
    });

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(queryByTestId(EDIT_ACTION_TEST_ID)).toBeNull();
  });

  it('renders a synced (non-deletable) card bare, with no gesture and no confirm sheet', async () => {
    const { queryByTestId, getByText } = await render(
      <CardContextMenu name="Synced" deletable={false} onDelete={jest.fn()}>
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    expect(queryByTestId('card-context-menu')).toBeNull();
    expect(getByText('card')).toBeTruthy();
  });

  it('lifts a liftOnHold card to ~1.03 once the hold activates, then settles back to 1 on release', async () => {
    const { getByTestId, getByText } = await render(
      <CardContextMenu name="Coffee" deletable onDelete={jest.fn()} liftOnHold>
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );
    const scaleOf = (): number | undefined =>
      StyleSheet.flatten(getByTestId('card-context-menu').props.style).transform?.[0]?.scale;

    // At rest, before any hold, the card sits at its identity scale.
    expect(scaleOf()).toBe(1);

    const hold = createGestureController(HOLD_GESTURE_TEST_ID);

    // A hold that reaches ACTIVE (the same transition that plays the haptic
    // and opens the confirm) lifts the card.
    await act(async () => {
      hold.begin();
      hold.activate();
    });

    expect(scaleOf()).toBeCloseTo(1.03);

    // `onFinalize` fires on release and resets the shared value immediately,
    // but this stub's `useAnimatedStyle` only recomputes the style on a React
    // re-render (real Reanimated instead binds it live on the UI thread) —
    // dismissing the confirm via Cancel forces that re-render, so it doubles
    // as the read point proving the reset actually happened. Both are awaited
    // inside `act` so the resulting state update actually commits before the
    // assertion reads the tree.
    await act(async () => {
      hold.end();
    });
    await act(async () => {
      fireEvent.press(getByText('Cancel'));
    });

    expect(scaleOf()).toBe(1);
  });

  it('never lifts a card when liftOnHold is omitted (the account/holding grid path)', async () => {
    const { getByTestId } = await render(
      <CardContextMenu name="Black card" deletable onDelete={jest.fn()}>
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    // No `liftOnHold` means the plain (non-`Animated`) `View` renders, with no
    // `style` prop at all — proving the account/holding path is byte-for-byte
    // unchanged, not merely animated with a no-op scale.
    expect(getByTestId('card-context-menu').props.style).toBeUndefined();
  });
});
