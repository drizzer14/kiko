import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';

import RuleCard from './rule-card.component';

const SUMMARY = 'Name is "Silpo" · Expense';

const renderCard = (onDelete = jest.fn()) =>
  render(<RuleCard title={SUMMARY} onDelete={onDelete} />, { wrapper: GestureRootWrapper });

const hold = async (): Promise<void> => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
      { state: State.BEGAN },
      { state: State.ACTIVE },
      { state: State.END },
    ]);
  });
};

describe('RuleCard', () => {
  it('shows the rule as the line it is given, wrapping rather than cutting it', async () => {
    const { getByText } = await renderCard();

    expect(getByText(SUMMARY)).toBeTruthy();
    expect(getByText(SUMMARY).props.numberOfLines).toBeUndefined();
  });

  it('asks before deleting, named by the line, on a hold', async () => {
    const onDelete = jest.fn();
    const { getByText } = await renderCard(onDelete);

    await hold();

    expect(getByText(`Delete "${SUMMARY}"`)).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes only once the confirm is pressed', async () => {
    const onDelete = jest.fn();
    const { getByTestId } = await renderCard(onDelete);

    await hold();
    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
