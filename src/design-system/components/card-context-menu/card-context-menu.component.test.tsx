import { trigger } from 'react-native-haptic-feedback';
import { Pressable, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
// Real i18n init (side effect), same as App.tsx. Previously reached only by
// accident through GlassSurface -> screenshot-mode -> i18n before the 5.6
// screenshot-subsystem strip removed that import chain; now imported directly
// so the sheet's `t('common.cancel')`/`t('common.delete')` resolve under test
// the same way they do at runtime.
import '@kiko/i18n/init';
import { holdCard } from '@kiko/test-support/hold-card';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';

import CardContextMenu, {
  EDIT_ACTION_TEST_ID,
  CLOSE_ACTION_TEST_ID,
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
    await holdCard();

    // The hold plays the medium-impact haptic and raises the themed confirm
    // sheet titled `Delete "<name>"` — not a native ActionSheetIOS — and
    // deletes nothing until its destructive confirm is pressed.
    expect(trigger).toHaveBeenCalledWith('impactMedium');
    expect(getByText('Delete "Black card"')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows the deleteMessage under the delete confirm title when one is given', async () => {
    const { getByText } = await render(
      <CardContextMenu
        name="Black card"
        deletable
        onDelete={jest.fn()}
        deleteMessage={() => Promise.resolve('This stays at the bank figure.')}
      >
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    await holdCard();

    expect(getByText('Delete "Black card"')).toBeTruthy();
    expect(getByText('This stays at the bank figure.')).toBeTruthy();
  });

  it('opens the delete confirm only once a deleteMessage function resolves, then shows its text', async () => {
    let resolveMessage: (message: string | undefined) => void = () => undefined;
    const { getByText, queryByText } = await render(
      <CardContextMenu
        name="Black card"
        deletable
        onDelete={jest.fn()}
        deleteMessage={() =>
          new Promise<string | undefined>((resolve) => {
            resolveMessage = resolve;
          })
        }
      >
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    await holdCard();

    expect(queryByText('Delete "Black card"')).toBeNull();

    await act(async () => {
      resolveMessage('This also deletes the other part.');
    });

    expect(getByText('Delete "Black card"')).toBeTruthy();
    expect(getByText('This also deletes the other part.')).toBeTruthy();
  });

  it('opens a title-only confirm when the deleteMessage function resolves to nothing', async () => {
    const { getByText } = await render(
      <CardContextMenu
        name="Black card"
        deletable
        onDelete={jest.fn()}
        deleteMessage={() => Promise.resolve(undefined)}
      >
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    await holdCard();

    expect(getByText('Delete "Black card"')).toBeTruthy();
  });

  it('opens the confirm with no message when the deleteMessage function rejects', async () => {
    const { getByText, getByTestId } = await render(
      <CardContextMenu
        name="Black card"
        deletable
        onDelete={jest.fn()}
        deleteMessage={() => Promise.reject(new Error('read failed'))}
      >
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    await holdCard();

    expect(getByText('Delete "Black card"')).toBeTruthy();
    expect(getByTestId(DELETE_CONFIRM_TEST_ID)).toBeTruthy();
  });

  it('shows the resolved text again, freshly read, each time the confirm opens', async () => {
    const messages = ['First text.', 'Second text.'];
    const { getByText, queryByText, getByTestId } = await render(
      <CardContextMenu
        name="Black card"
        deletable
        onDelete={jest.fn()}
        deleteMessage={() => Promise.resolve(messages.shift())}
      >
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    await holdCard();
    expect(getByText('First text.')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(getByText('Cancel'));
    });
    await holdCard();

    expect(getByText('Second text.')).toBeTruthy();
    expect(queryByText('First text.')).toBeNull();
    expect(getByTestId(DELETE_CONFIRM_TEST_ID)).toBeTruthy();
  });

  it('shows the text of the latest request when an earlier read settles after it', async () => {
    const resolvers: ((message: string | undefined) => void)[] = [];
    const { getByText, queryByText } = await render(
      <CardContextMenu
        name="Black card"
        deletable
        onDelete={jest.fn()}
        deleteMessage={() =>
          new Promise<string | undefined>((resolve) => {
            resolvers.push(resolve);
          })
        }
      >
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    await holdCard();
    await holdCard();

    expect(resolvers).toHaveLength(2);

    await act(async () => {
      resolvers[1]?.('Latest text.');
    });
    await act(async () => {
      resolvers[0]?.('Superseded text.');
    });

    expect(getByText('Latest text.')).toBeTruthy();
    expect(queryByText('Superseded text.')).toBeNull();
  });

  it('opens no confirm for a read that settles after a newer request, until that one settles', async () => {
    const resolvers: ((message: string | undefined) => void)[] = [];
    const { getByText, queryByText } = await render(
      <CardContextMenu
        name="Black card"
        deletable
        onDelete={jest.fn()}
        deleteMessage={() =>
          new Promise<string | undefined>((resolve) => {
            resolvers.push(resolve);
          })
        }
      >
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    await holdCard();
    await holdCard();
    await act(async () => {
      resolvers[0]?.('Superseded text.');
    });

    expect(queryByText('Delete "Black card"')).toBeNull();

    await act(async () => {
      resolvers[1]?.('Latest text.');
    });

    expect(getByText('Latest text.')).toBeTruthy();
  });

  it('resolves a deleteMessage function for the action list Delete too, and shows its text', async () => {
    const { getByTestId, getByText } = await render(
      <CardContextMenu
        name="Coffee"
        deletable
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        deleteMessage={() => Promise.resolve('This also deletes the payment.')}
      >
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    await holdCard();
    await act(async () => {
      await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
    });

    expect(getByText('Delete "Coffee"')).toBeTruthy();
    expect(getByText('This also deletes the payment.')).toBeTruthy();
  });

  it('keeps the delete confirm title-only when no deleteMessage is given', async () => {
    const { getByText, queryByText } = await render(
      <CardContextMenu name="Black card" deletable onDelete={jest.fn()}>
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    await holdCard();

    expect(getByText('Delete "Black card"')).toBeTruthy();
    expect(queryByText('This stays at the bank figure.')).toBeNull();
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

    await fireEvent.press(getByText('card'));

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

    await holdCard();

    // A hold now opens a CHOICE (Duplicate + Delete), not the delete confirm
    // directly — the named delete confirm is not shown yet.
    expect(trigger).toHaveBeenCalledWith('impactMedium');
    expect(getByTestId(DUPLICATE_ACTION_TEST_ID)).toBeTruthy();
    expect(getByTestId(DELETE_ACTION_TEST_ID)).toBeTruthy();
    expect(queryByText('Delete "Coffee"')).toBeNull();

    await fireEvent.press(getByTestId(DUPLICATE_ACTION_TEST_ID));

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

    await holdCard();

    // Choosing Delete from the action list opens the SAME named confirm sheet
    // the delete-only path uses; only its destructive confirm routes to onDelete.
    await act(async () => {
      await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
    });

    expect(getByText('Delete "Coffee"')).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

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

    await holdCard();

    expect(getByTestId(EDIT_ACTION_TEST_ID)).toHaveTextContent('Edit');
    expect(getByTestId(DELETE_ACTION_TEST_ID)).toBeTruthy();
    expect(queryByTestId(DUPLICATE_ACTION_TEST_ID)).toBeNull();
    expect(queryByText('Delete "50% since 01.06.2025"')).toBeNull();

    await act(async () => {
      await fireEvent.press(getByTestId(EDIT_ACTION_TEST_ID));
    });

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(queryByTestId(EDIT_ACTION_TEST_ID)).toBeNull();
  });

  it('offers a Close/Delete action list on hold when a close action is provided, routing Close to it without deleting', async () => {
    const onClose = jest.fn();
    const onDelete = jest.fn();
    const { getByTestId, queryByTestId, queryByText } = await render(
      <CardContextMenu
        name="Shares"
        deletable
        onDelete={onDelete}
        closeAction={{ label: 'Close holding', onPress: onClose }}
      >
        <Text>card</Text>
      </CardContextMenu>,
      { wrapper: GestureRootWrapper },
    );

    await holdCard();

    expect(getByTestId(CLOSE_ACTION_TEST_ID)).toHaveTextContent('Close holding');
    expect(getByTestId(DELETE_ACTION_TEST_ID)).toBeTruthy();
    expect(queryByText('Delete "Shares"')).toBeNull();

    await act(async () => {
      await fireEvent.press(getByTestId(CLOSE_ACTION_TEST_ID));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(queryByTestId(CLOSE_ACTION_TEST_ID)).toBeNull();
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
      await fireEvent.press(getByText('Cancel'));
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
