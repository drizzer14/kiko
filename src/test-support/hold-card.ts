import { act } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { HOLD_GESTURE_TEST_ID } from '@kiko/design-system/components/card-context-menu';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

/**
 * A touch-and-hold that stays still on the rendered `CardContextMenu`: the
 * long-press reaches ACTIVE and ends, so the menu opens its confirm or its
 * action list.
 */
export const holdCard = (): Promise<void> =>
  act(async () => {
    fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
      { state: State.BEGAN },
      { state: State.ACTIVE },
      { state: State.END },
    ]);
  });
