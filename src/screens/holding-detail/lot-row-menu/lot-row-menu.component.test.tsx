import { Text } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import {
  EDIT_ACTION_TEST_ID,
  HOLD_GESTURE_TEST_ID,
  DELETE_ACTION_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import type { DerivedEntry } from '@kiko/holdings/derived-entries';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import LotRowMenu from './lot-row-menu.component';
import type { LotActions } from './lot-row-menu.props';

const entry: DerivedEntry = {
  id: 'derived:h-1:purchase:2',
  time: Date.UTC(2024, 0, 1),
  amountMinorUnits: -90_000,
  label: 'Purchase',
  kind: 'purchase',
  tone: 'neutral',
  isFuture: false,
  derived: true,
  lotIndex: 2,
};

const actions = (isRemovable: boolean): LotActions => ({
  edit: jest.fn(),
  remove: jest.fn(),
  isRemovable: jest.fn(() => isRemovable),
});

const renderMenu = (rowEntry: DerivedEntry, rowActions: LotActions | undefined) =>
  render(
    <LotRowMenu entry={rowEntry} actions={rowActions}>
      <Text>row</Text>
    </LotRowMenu>,
    { wrapper: GestureRootWrapper },
  );

const hold = async (): Promise<void> => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
      { state: State.BEGAN },
      { state: State.ACTIVE },
      { state: State.END },
    ]);
  });
};

describe('LotRowMenu', () => {
  it('leaves a derived row that shows no lot bare', async () => {
    const { getByText, queryByTestId } = await renderMenu(
      { ...entry, lotIndex: undefined },
      actions(true),
    );

    expect(getByText('row')).toBeTruthy();
    expect(queryByTestId('card-context-menu')).toBeNull();
  });

  it('edits the lot it shows, by its index', async () => {
    const lotActions = actions(true);
    const { getByTestId } = await renderMenu(entry, lotActions);

    await hold();

    expect(lotActions.isRemovable).toHaveBeenCalledWith(2);
    expect(getByTestId(DELETE_ACTION_TEST_ID)).toBeTruthy();

    await act(async () => {
      await fireEvent.press(getByTestId(EDIT_ACTION_TEST_ID));
    });

    expect(lotActions.edit).toHaveBeenCalledWith(2);
  });

  it('offers no Delete for a lot a later sale needs', async () => {
    const { queryByTestId } = await renderMenu(entry, actions(false));

    await hold();

    expect(queryByTestId(DELETE_ACTION_TEST_ID)).toBeNull();
  });
});
