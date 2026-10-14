import { StyleSheet } from 'react-native';
import {
  createGestureController,
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';
import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

import RuleCard from './rule-card.component';
import type { RuleCardProps } from './rule-card.props';

const ROWS: RuleCardProps['rows'] = [
  { key: 'nameStartsWith-0', label: 'Name starts with', value: '"Silpo"' },
  { key: 'amount-1', label: 'Amount is more than', value: '500.00 ₴' },
];
const SUMMARY = 'Name starts with "Silpo" · Amount is more than 500.00 ₴';
const LONG_NAME = 'A very long shop name that does not fit on one line of the card';

const renderCard = (onDelete = jest.fn(), onPress?: () => void, rows = ROWS) =>
  render(<RuleCard rows={rows} summary={SUMMARY} onPress={onPress} onDelete={onDelete} />, {
    wrapper: GestureRootWrapper,
  });

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
  it('shows each condition as a label beside its value, one table row each', async () => {
    const { getByText } = await renderCard();
    const nameRow = ancestorWithStyle(getByText('Name starts with'), 'justifyContent');
    const amountRow = ancestorWithStyle(getByText('Amount is more than'), 'justifyContent');

    expect(ancestorWithStyle(getByText('"Silpo"'), 'justifyContent')).toBe(nameRow);
    expect(ancestorWithStyle(getByText('500.00 ₴'), 'justifyContent')).toBe(amountRow);
    expect(nameRow).not.toBe(amountRow);
  });

  it('right-aligns a value and wraps it rather than cutting it', async () => {
    const { getByText } = await renderCard();
    const value = getByText('"Silpo"');

    expect(StyleSheet.flatten(value.props.style).textAlign).toBe('right');
    expect(value.props.numberOfLines).toBeUndefined();
  });

  it('lets a long value wrap inside the card while its label keeps its width', async () => {
    const { getByText } = await renderCard(jest.fn(), undefined, [
      { key: 'nameIs-0', label: 'Name is', value: `"${LONG_NAME}"` },
    ]);
    const valueBox = ancestorWithStyle(getByText(`"${LONG_NAME}"`), 'flexShrink');
    const labelBox = ancestorWithStyle(getByText('Name is'), 'flexShrink');

    expect(StyleSheet.flatten(valueBox.props.style).flexShrink).toBe(1);
    expect(StyleSheet.flatten(labelBox.props.style).flexShrink).toBe(0);
  });

  it('reports a tap on the rule when it has an action to open', async () => {
    const onPress = jest.fn();
    const { getByText } = await renderCard(jest.fn(), onPress);

    await fireEvent.press(getByText('Name starts with'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is one button named by the summary line for a rule it can open', async () => {
    const { getByRole, getAllByRole } = await renderCard(jest.fn(), jest.fn());

    expect(getAllByRole('button')).toHaveLength(1);
    expect(getByRole('button').props.accessibilityLabel).toBe(SUMMARY);
  });

  it('is plain content with no button for a rule it can not open', async () => {
    const { queryByRole, getByText } = await renderCard();

    expect(queryByRole('button')).toBeNull();
    expect(getByText('Name starts with')).toBeTruthy();
  });

  it('shows a rule with no rows as the one line it is given', async () => {
    const { getByText } = await render(
      <RuleCard summary="This rule can't be read" onDelete={jest.fn()} />,
      { wrapper: GestureRootWrapper },
    );

    expect(getByText("This rule can't be read")).toBeTruthy();
    expect(getByText("This rule can't be read").props.numberOfLines).toBeUndefined();
  });

  it('asks before deleting on a hold, under a title that does not repeat the line in quotes', async () => {
    const onDelete = jest.fn();
    const { getByText, queryByText } = await renderCard(onDelete);

    await hold();

    expect(getByText('Delete Rule')).toBeTruthy();
    expect(queryByText(new RegExp(`Delete ".*${SUMMARY}`))).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('lifts to ~1.03 while a hold is active, as a card in a plain list does', async () => {
    const { getByTestId } = await renderCard();
    const scaleOf = (): number | undefined =>
      StyleSheet.flatten(getByTestId('card-context-menu').props.style).transform?.[0]?.scale;

    expect(scaleOf()).toBe(1);

    const holdGesture = createGestureController(HOLD_GESTURE_TEST_ID);

    await act(async () => {
      holdGesture.begin();
      holdGesture.activate();
    });

    expect(scaleOf()).toBeCloseTo(1.03);
  });

  it('deletes only once the confirm is pressed', async () => {
    const onDelete = jest.fn();
    const { getByTestId } = await renderCard(onDelete);

    await hold();
    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
