import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '../../../design-system/unistyles';
// Initialize i18next so the row's and CardContextMenu's `t()` labels resolve
// to the real catalogue instead of the raw key.
import '../../../i18n';

import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '../../../design-system/components/card-context-menu';

import type { HomeTransactionRow } from './transaction-row.props';

import TransactionRow from './transaction-row.component';

jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: { remove: jest.fn() },
}));

import { transactionsRepo } from '@kiko/transactions/repo';

// A row's delete menu is a react-native-gesture-handler long-press (via the
// shared CardContextMenu), so it must mount under a GestureHandlerRootView
// (the app supplies one at its root in production).
const wrapper = ({ children }: { children: ReactNode }) => (
  <GestureHandlerRootView>{children}</GestureHandlerRootView>
);

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
};

const renderRow = (item: HomeTransactionRow, onPress = jest.fn()) =>
  render(
    <TransactionRow
      item={item}
      categoryByKey={new Map()}
      defaultCategoryKey="other"
      holdingNameById={new Map()}
      categoryKeyForRow={(raw) => raw ?? 'other'}
      onPress={onPress}
    />,
    { wrapper },
  );

describe('TransactionRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    expect(getByText('Delete "Coffee"')).toBeTruthy();
    fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(transactionsRepo.remove).toHaveBeenCalledWith('txn-1');
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
});
