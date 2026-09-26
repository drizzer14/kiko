import { StyleSheet } from 'react-native';
import {
  createGestureController,
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';
import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
// Initialize i18next so the row's and CardContextMenu's `t()` labels resolve
// to the real catalogue instead of the raw key.
import '../../../i18n';

import {
  DELETE_ACTION_TEST_ID,
  DELETE_CONFIRM_TEST_ID,
  DUPLICATE_ACTION_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '../../../design-system/components/card-context-menu';
import GestureRootWrapper from '../../../test-support/gesture-root-wrapper';

import TransactionRow from './transaction-row.component';
import type { HomeTransactionRow } from './transaction-row.props';

jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: { remove: jest.fn() },
}));

import { transactionsRepo } from '@kiko/transactions/repo';

const baseItem: HomeTransactionRow = {
  id: 'txn-1',
  amountMinorUnits: -5000,
  currency: 'UAH',
  time: Date.now(),
  description: 'Coffee',
  exchangeCounterpartHoldingId: null,
  changeGroupId: null,
  category: 'food',
  accountId: 'a-1',
  accountName: 'Monobank',
  holdingName: 'Card',
  holdingType: 'card',
  source: 'manual',
  loanHoldingId: null,
};

const renderRow = (item: HomeTransactionRow, onPress = jest.fn(), onDuplicate = jest.fn()) =>
  render(
    <TransactionRow
      item={item}
      categoryByKey={new Map()}
      defaultCategoryKey="other"
      holdingNameById={new Map()}
      categoryKeyForRow={(raw) => raw ?? 'other'}
      onPress={onPress}
      onDuplicate={onDuplicate}
    />,
    { wrapper: GestureRootWrapper },
  );

describe('TransactionRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the loan-link marker when the row carries a loan link', async () => {
    const { toJSON } = await renderRow({ ...baseItem, loanHoldingId: 'loan-1' });

    expect(JSON.stringify(toJSON())).toContain('link');
  });

  it('shows no loan-link marker when the row carries none', async () => {
    const { toJSON } = await renderRow(baseItem);

    expect(JSON.stringify(toJSON())).not.toContain('"link"');
  });

  it('wires a manual row to the shared long-press context menu and deletes via transactionsRepo.remove', async () => {
    const { getByTestId, getByText, queryByTestId } = await renderRow(baseItem);

    expect(queryByTestId('card-context-menu')).not.toBeNull();

    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });

    // A manual row is now BOTH duplicable and deletable, so a hold opens the
    // Duplicate/Delete choice; Delete hands off to the SAME named confirm sheet
    // that routes to `transactionsRepo.remove`.
    await act(async () => {
      fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
    });

    expect(getByText('Delete "Coffee"')).toBeTruthy();
    fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(transactionsRepo.remove).toHaveBeenCalledWith('txn-1');
  });

  it('offers Duplicate on a manual row and routes it to onDuplicate with the row id', async () => {
    const onDuplicate = jest.fn();
    const { getByTestId } = await renderRow(baseItem, jest.fn(), onDuplicate);

    // A hold now opens the Duplicate/Delete choice (a manual row is both
    // duplicable and deletable); Duplicate carries this row's id up to the
    // handler that navigates to the pre-filled create form.
    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });

    await act(async () => {
      fireEvent.press(getByTestId(DUPLICATE_ACTION_TEST_ID));
    });

    expect(onDuplicate).toHaveBeenCalledWith('txn-1');
  });

  it('offers no Duplicate on a synced row — it renders bare with no hold gesture', async () => {
    const onDuplicate = jest.fn();
    const { queryByTestId } = await renderRow(
      { ...baseItem, id: 'txn-mono', source: 'monobank' },
      jest.fn(),
      onDuplicate,
    );

    // A synced row is neither deletable nor duplicable, so it stays bare even
    // though an onDuplicate handler was passed down.
    expect(queryByTestId('card-context-menu')).toBeNull();
    expect(() => getByGestureTestId(HOLD_GESTURE_TEST_ID)).toThrow();
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it('renders a synced row bare — no context-menu wrapper and no hold gesture', async () => {
    const { queryByTestId } = await renderRow({ ...baseItem, id: 'txn-mono', source: 'monobank' });

    expect(queryByTestId('card-context-menu')).toBeNull();
    expect(() => getByGestureTestId(HOLD_GESTURE_TEST_ID)).toThrow();
  });

  it('still routes a tap on a manual row to onPress, opening the shared form', async () => {
    const onPress = jest.fn();
    const { getByText } = await renderRow(baseItem, onPress);

    fireEvent.press(getByText('Coffee'));

    expect(onPress).toHaveBeenCalledWith('txn-1');
  });

  it('lifts the row to ~1.03 while a hold is active — the same feel the account/holding sortable grids get for free', async () => {
    const { getByTestId, getByText } = await renderRow(baseItem);
    const scaleOf = (): number | undefined =>
      StyleSheet.flatten(getByTestId('card-context-menu').props.style).transform?.[0]?.scale;

    // A plain (non-sortable) list row gets no lift from a grid's own
    // `activeItemScale`, so `liftOnHold` is this row's OWN opt-in — proven
    // here by wiring the real `TransactionRow`, not just `CardContextMenu`
    // in isolation.
    expect(scaleOf()).toBe(1);

    const hold = createGestureController(HOLD_GESTURE_TEST_ID);

    await act(async () => {
      hold.begin();
      hold.activate();
    });

    expect(scaleOf()).toBeCloseTo(1.03);

    // `onFinalize` resets the shared value immediately, but this stub's
    // `useAnimatedStyle` only recomputes the style on a React re-render —
    // dismissing the Duplicate/Delete action list via Cancel forces that
    // re-render, so it doubles as the read point proving the reset happened.
    await act(async () => {
      hold.end();
    });
    await act(async () => {
      fireEvent.press(getByText('Cancel'));
    });

    expect(scaleOf()).toBe(1);
  });
});
