import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';
import '../../../i18n';
import '../../unistyles';
import {
  ACTION_WIDTH,
  clampTranslate,
  MERGE_THRESHOLD,
  OPEN_THRESHOLD,
  resolveSnap,
  shouldClaimSwipe,
  shouldMergeEdge,
} from './gesture';
import SwipeableRow from './swipeable-row.component';

// The delete action is mounted behind the row content for the reveal
// animation, but is gated out of the accessibility tree until the row is
// swiped open. RNTL's default queries exclude a11y-hidden elements
// (`defaultIncludeHiddenElements: false`), so the button-wiring tests query
// with `includeHiddenElements: true` to reach the mounted-but-hidden button
// (which is exactly what a swiped-open row exposes to the user).
const HIDDEN = { includeHiddenElements: true } as const;

describe('swipe gesture arbitration', () => {
  // Mirrors activeOffsetX([-n, n]).failOffsetY([-m, m]): the pan claims the
  // gesture only on clear horizontal intent and forfeits it the moment the
  // drag turns vertical, so a scroll never partially opens the row.
  it('does NOT claim the gesture for a vertical drag (lets the list scroll)', () => {
    // A downward swipe with negligible horizontal travel.
    expect(shouldClaimSwipe(2, 40)).toBe(false);
    // ...and an upward one.
    expect(shouldClaimSwipe(-3, -40)).toBe(false);
    // A diagonal drag whose vertical travel crosses the fail offset still
    // yields to the scroll view rather than opening the row.
    expect(shouldClaimSwipe(20, 30)).toBe(false);
  });

  it('does NOT claim the gesture until horizontal travel is unambiguous', () => {
    // A tiny horizontal jitter below the active offset must not steal a tap.
    expect(shouldClaimSwipe(6, 0)).toBe(false);
    expect(shouldClaimSwipe(-6, 1)).toBe(false);
  });

  it('claims the gesture for a clear, dominant horizontal drag', () => {
    expect(shouldClaimSwipe(-20, 2)).toBe(true);
    expect(shouldClaimSwipe(20, -2)).toBe(true);
  });

  // A right-swipe while the row is OPEN is a clear, dominant horizontal drag,
  // so the row's own responder claims it (rather than letting it fall through)
  // and resolveSnap then settles it closed.
  it('claims a rightward close-swipe (so it does not fall through to the row content)', () => {
    expect(shouldClaimSwipe(30, 3)).toBe(true);
    // ...and a decisive rightward drag from fully open settles the row closed.
    expect(resolveSnap(-ACTION_WIDTH, ACTION_WIDTH)).toBe(0);
  });
});

// The card's right corners square off (borderRadius 0) to meet the delete
// button flush the moment the swipe travels past a small threshold, and
// restore their normal radius once the row settles back closed. Driven off
// the live translateX value (0 closed, negative as the card is dragged open).
describe('edge-merge state (card right corners vs delete button seam)', () => {
  it('does NOT merge while the row is at rest or barely moved', () => {
    // Fully closed keeps the card's normal rounded right corners.
    expect(shouldMergeEdge(0)).toBe(false);
    // A jitter shy of the threshold has not opened the seam yet.
    expect(shouldMergeEdge(-(MERGE_THRESHOLD - 1))).toBe(false);
  });

  it('merges once the card is dragged past the small threshold or fully open', () => {
    // At the threshold the seam squares off.
    expect(shouldMergeEdge(-MERGE_THRESHOLD)).toBe(true);
    // ...and stays merged all the way to fully open.
    expect(shouldMergeEdge(-ACTION_WIDTH)).toBe(true);
  });
});

describe('swipe settle (release / termination snap)', () => {
  it('snaps a small horizontal drag below the open threshold back closed', () => {
    // Started closed, dragged left less than half the action width.
    expect(resolveSnap(0, -(OPEN_THRESHOLD - 1))).toBe(0);
  });

  it('snaps a horizontal drag past the open threshold fully open', () => {
    expect(resolveSnap(0, -(OPEN_THRESHOLD + 1))).toBe(-ACTION_WIDTH);
  });

  it('always settles to a single stable resting state, never partial', () => {
    // Over-drag past the action width still rests exactly at fully open.
    expect(resolveSnap(0, -(ACTION_WIDTH * 3))).toBe(-ACTION_WIDTH);
    // A small back-drag from open keeps it open; a large one closes it.
    expect(resolveSnap(-ACTION_WIDTH, 10)).toBe(-ACTION_WIDTH);
    expect(resolveSnap(-ACTION_WIDTH, ACTION_WIDTH)).toBe(0);
  });

  it('clamps live translation to the open/closed travel bounds', () => {
    expect(clampTranslate(0, 20)).toBe(0);
    expect(clampTranslate(0, -20)).toBe(-20);
    expect(clampTranslate(0, -(ACTION_WIDTH * 2))).toBe(-ACTION_WIDTH);
  });
});

describe('SwipeableRow', () => {
  it('renders a delete action for an enabled row and confirms before deleting', async () => {
    const onDelete = jest.fn();
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const del = (buttons ?? []).find((b) => b.style === 'destructive');
      del?.onPress?.();
    });
    const { getByLabelText } = await render(
      <SwipeableRow onDelete={onDelete}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    fireEvent.press(getByLabelText('Delete', HIDDEN));
    expect(onDelete).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('passes the custom confirm title and message to the alert', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = await render(
      <SwipeableRow
        onDelete={jest.fn()}
        confirmTitle="Remove account"
        confirmMessage="All holdings are removed too."
      >
        <Text>Row</Text>
      </SwipeableRow>,
    );
    fireEvent.press(getByLabelText('Delete', HIDDEN));
    expect(spy).toHaveBeenCalledWith(
      'Remove account',
      'All holdings are removed too.',
      expect.any(Array),
    );
    spy.mockRestore();
  });

  it('does not delete when the confirmation is dismissed', async () => {
    const onDelete = jest.fn();
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = await render(
      <SwipeableRow onDelete={onDelete}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    fireEvent.press(getByLabelText('Delete', HIDDEN));
    expect(onDelete).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('hides the delete action from the accessibility tree while the row is closed', async () => {
    const { queryByLabelText } = await render(
      <SwipeableRow onDelete={jest.fn()}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    // A screen reader cannot reach it on a closed row...
    expect(queryByLabelText('Delete')).toBeNull();
    // ...even though it is mounted behind the content for the reveal.
    expect(queryByLabelText('Delete', HIDDEN)).not.toBeNull();
  });

  it('renders no delete action when disabled', async () => {
    const { queryByLabelText, getByText } = await render(
      <SwipeableRow onDelete={jest.fn()} disabled>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    expect(queryByLabelText('Delete', HIDDEN)).toBeNull();
    expect(getByText('Row')).toBeTruthy();
  });

  // The row clips to this radius (overflow: hidden + borderRadius) so the
  // revealed delete action never bleeds past the wrapping card's rounded
  // corners, and matches the card's own corner radius exactly.
  it('clips the row to theme.radii.lg by default', async () => {
    const { getByTestId } = await render(
      <SwipeableRow onDelete={jest.fn()} testID="row">
        <Text>Row</Text>
      </SwipeableRow>,
    );
    expect(getByTestId('row').props.style).toContainEqual({ borderRadius: 16 });
  });

  it('clips the row to a custom radius when the wrapping card uses a different one', async () => {
    const { getByTestId } = await render(
      <SwipeableRow onDelete={jest.fn()} testID="row" radius={10}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    expect(getByTestId('row').props.style).toContainEqual({ borderRadius: 10 });
  });

  // The action layer is mounted behind the row content at all times (for the
  // reveal animation), and the row it sits behind is a translucent
  // GlassSurface card. Accessibility-hiding it is not enough on its own — a
  // closed row's red delete action must have zero *visible* presence, or it
  // bleeds through the glass. Opacity is tied to the same translateX driving
  // the swipe, so it is provably 0 at rest regardless of the row's own
  // translucency.
  it('renders the delete action with zero opacity at rest', async () => {
    const { getByTestId } = await render(
      <SwipeableRow onDelete={jest.fn()} testID="row">
        <Text>Row</Text>
      </SwipeableRow>,
    );
    const actions = getByTestId('row-actions', HIDDEN);
    expect(actions.props.style).toMatchObject({ opacity: 0 });
  });

  // The seam filler is the surface backing that squares the card's right edge
  // against the delete button. At rest (row closed) it is invisible (zero
  // opacity, tied to the same translateX driving the reveal) and its right
  // corners carry the card's normal radius — the merge only takes effect once
  // the row is swiped open, and restores on settle-back.
  it('renders the seam filler invisible with the card radius restored at rest', async () => {
    const { getByTestId } = await render(
      <SwipeableRow onDelete={jest.fn()} testID="row" radius={10}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    const seam = getByTestId('row-seam', HIDDEN);
    expect(seam.props.style).toMatchObject({
      opacity: 0,
      borderTopLeftRadius: 10,
      borderBottomLeftRadius: 10,
      borderTopRightRadius: 10,
      borderBottomRightRadius: 10,
    });
  });
});

// The PanResponder's gestureState is derived from the native event's
// touchHistory (touch centroids across grant -> move -> release), which is the
// only input that produces a real dx. Building a single-touch history that
// slides from `fromPageX` to `toPageX` lets a test drive the JS responder
// deterministically — exercising the row's own settle logic, not a native
// gesture recognizer.
type ResponderHandlers = Record<string, (event: unknown) => unknown>;

const touchHistory = (fromPageX: number, toPageX: number) => ({
  numberActiveTouches: 1,
  indexOfSingleActiveTouch: 1,
  mostRecentTimeStamp: 2,
  touchBank: [
    undefined,
    {
      touchActive: true,
      startPageX: fromPageX,
      startPageY: 0,
      startTimeStamp: 1,
      previousPageX: fromPageX,
      previousPageY: 0,
      previousTimeStamp: 1,
      currentPageX: toPageX,
      currentPageY: 0,
      currentTimeStamp: 2,
    },
  ],
});

const swipeEvent = (fromPageX: number, toPageX: number) => ({
  nativeEvent: { touches: [], changedTouches: [], timestamp: 2 },
  touchHistory: touchHistory(fromPageX, toPageX),
});

// Drive a full horizontal swipe on the row's inner (pan-handled) view: the
// content wrapper is the container's last child. A leftward drag (fromPageX >
// toPageX) opens the row; a rightward one closes it.
const swipe = (row: { children: ReadonlyArray<unknown> }, fromPageX: number, toPageX: number) => {
  const inner = row.children[row.children.length - 1] as { props: ResponderHandlers };
  const handlers = inner.props;
  const grant = swipeEvent(fromPageX, fromPageX);
  const move = swipeEvent(fromPageX, toPageX);
  handlers.onResponderGrant?.(grant);
  handlers.onMoveShouldSetResponder?.(move);
  handlers.onResponderMove?.(move);
  handlers.onResponderRelease?.(move);
};

// When a row is open and the user swipes right to close it, the native
// back-swipe on a createNativeStackNavigator screen also fires. onOpenChange
// lets a screen disable that native pop gesture while any row is open — so the
// row must report every settle to open (true) and back to closed (false).
describe('onOpenChange (native back-swipe guard)', () => {
  it('does not fire on mount (a freshly rendered row is closed)', async () => {
    const onOpenChange = jest.fn();
    await render(
      <SwipeableRow onDelete={jest.fn()} testID="row" onOpenChange={onOpenChange}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('fires open then closed as the row is swiped open and back closed', async () => {
    const onOpenChange = jest.fn();
    const { getByTestId } = await render(
      <SwipeableRow onDelete={jest.fn()} testID="row" onOpenChange={onOpenChange}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    const row = getByTestId('row');

    // A decisive leftward drag settles the row fully open.
    await act(async () => {
      swipe(row, 200, 60);
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    // A decisive rightward drag settles it back closed.
    await act(async () => {
      swipe(row, 60, 200);
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('does not re-fire open when an already-open row settles open again', async () => {
    const onOpenChange = jest.fn();
    const { getByTestId } = await render(
      <SwipeableRow onDelete={jest.fn()} testID="row" onOpenChange={onOpenChange}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    const row = getByTestId('row');

    await act(async () => {
      swipe(row, 200, 60);
    });
    // A second small leftward nudge keeps it open — no redundant open emit.
    await act(async () => {
      swipe(row, 60, 40);
    });
    expect(onOpenChange.mock.calls).toEqual([[true]]);
  });

  // A row deleted while open unmounts without ever settling closed, so it never
  // emits the closing `false` on its own — leaving the screen's pop-guard tally
  // stuck ≥1 and the native back-swipe disabled for the life of the screen. The
  // row emits a closing `false` on unmount when it was open, to balance the tally.
  it('emits a closing change on unmount when the row was open (e.g. deleted while open)', async () => {
    const onOpenChange = jest.fn();
    const { getByTestId, unmount } = await render(
      <SwipeableRow onDelete={jest.fn()} testID="row" onOpenChange={onOpenChange}>
        <Text>Row</Text>
      </SwipeableRow>,
    );
    const row = getByTestId('row');

    await act(async () => {
      swipe(row, 200, 60);
    });
    expect(onOpenChange.mock.calls).toEqual([[true]]);

    await act(async () => {
      unmount();
    });
    // Exactly one closing emit on unmount, balancing the earlier open.
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('does not emit on unmount when the row was closed', async () => {
    const onOpenChange = jest.fn();
    const { unmount } = await render(
      <SwipeableRow onDelete={jest.fn()} testID="row" onOpenChange={onOpenChange}>
        <Text>Row</Text>
      </SwipeableRow>,
    );

    await act(async () => {
      unmount();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
