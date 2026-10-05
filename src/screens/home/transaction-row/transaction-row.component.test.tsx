import { StyleSheet } from 'react-native';
import {
  createGestureController,
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';
import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
// Initialize i18next so the row's and CardContextMenu's `t()` labels resolve
// to the real catalogue instead of the raw key.
import '@kiko/i18n/init';
import { holdCard } from '@kiko/test-support/hold-card';
import {
  DELETE_ACTION_TEST_ID,
  DELETE_CONFIRM_TEST_ID,
  DUPLICATE_ACTION_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';

import TransactionRow from './transaction-row.component';
import type { HomeTransactionRow } from './transaction-row.props';

jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    remove: jest.fn(),
    removePlan: jest.fn(),
    balanceBoundaryQuery: (holdingId: string) => ({ __kind: 'boundary', holdingId }),
  },
}));

const mockUseLiveQuery = jest.fn();
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

import { transactionsRepo } from '@kiko/transactions/repo';

const baseItem: HomeTransactionRow = {
  id: 'txn-1',
  holdingId: 'h-1',
  amountMinorUnits: -5000,
  currency: 'UAH',
  time: Date.now(),
  description: 'Coffee',
  exchangeCounterpartHoldingId: null,
  changeGroupId: null,
  category: 'food',
  accountId: 'a-1',
  accountName: 'Monobank',
  accountKind: 'bank',
  accountArchivedAt: null,
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
    mockUseLiveQuery.mockReturnValue({ data: [], isLoading: false });
    jest.mocked(transactionsRepo.removePlan).mockResolvedValue({ split: false });
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
      await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
    });

    expect(getByText('Delete "Coffee"')).toBeTruthy();
    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

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
      await fireEvent.press(getByTestId(DUPLICATE_ACTION_TEST_ID));
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

  describe('an imported row', () => {
    const IMPORT_TIME = 1_000;
    const importedItem: HomeTransactionRow = {
      ...baseItem,
      id: 'txn-import',
      source: 'import',
      time: IMPORT_TIME,
    };
    const KEEPS_BALANCE_MESSAGE =
      "The balance will stay at the bank's figure. Edit the holding to change it.";

    const holdRow = async (item: HomeTransactionRow, onDuplicate = jest.fn()) => {
      const screen = await renderRow(item, jest.fn(), onDuplicate);

      await holdCard();

      return screen;
    };

    const boundaryAt = (balanceSetAt: number) => ({
      data: [{ balanceSetAt, newestSyncTime: null }],
      isLoading: false,
    });

    it('opens the delete confirm straight away on a hold and deletes through transactionsRepo.remove', async () => {
      mockUseLiveQuery.mockReturnValue(boundaryAt(IMPORT_TIME - 1));

      const { getByTestId, getByText } = await holdRow(importedItem);

      expect(getByText('Delete "Coffee"')).toBeTruthy();

      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

      expect(transactionsRepo.remove).toHaveBeenCalledWith('txn-import');
    });

    it('offers no Duplicate, so the hold goes straight to the confirm', async () => {
      const onDuplicate = jest.fn();
      const { queryByTestId } = await holdRow(importedItem, onDuplicate);

      expect(queryByTestId(DUPLICATE_ACTION_TEST_ID)).toBeNull();
      expect(onDuplicate).not.toHaveBeenCalled();
    });

    it('says the balance stays when the row is dated at the boundary', async () => {
      mockUseLiveQuery.mockReturnValue(boundaryAt(IMPORT_TIME));

      const { getByText } = await holdRow(importedItem);

      expect(getByText(KEEPS_BALANCE_MESSAGE)).toBeTruthy();
    });

    it('says the balance stays when the row is dated before the boundary', async () => {
      mockUseLiveQuery.mockReturnValue(boundaryAt(IMPORT_TIME + 5));

      const { getByText } = await holdRow(importedItem);

      expect(getByText(KEEPS_BALANCE_MESSAGE)).toBeTruthy();
    });

    it('adds no message when the row is dated after the boundary, because deleting it gives the money back', async () => {
      mockUseLiveQuery.mockReturnValue(boundaryAt(IMPORT_TIME - 1));

      const { queryByText } = await holdRow(importedItem);

      expect(queryByText(KEEPS_BALANCE_MESSAGE)).toBeNull();
    });

    it('reads the boundary of its own holding', async () => {
      await renderRow(importedItem);

      expect(mockUseLiveQuery).toHaveBeenCalledWith(
        { __kind: 'boundary', holdingId: 'h-1' },
        ['holdings', 'transactions'],
        true,
      );
    });
  });

  describe('a row that is one part of a movement', () => {
    const SPLIT_NOTICE = 'This also deletes the payment and every change return linked to it.';

    it("reads its own row's plan and shows what else the delete takes under the confirm title", async () => {
      jest.mocked(transactionsRepo.removePlan).mockResolvedValue({
        split: false,
        exchange: { kind: 'deleted', names: ['Dollar card'] },
      });
      const { getByTestId, getByText } = await renderRow(baseItem);

      await holdCard();
      await act(async () => {
        await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
      });

      expect(transactionsRepo.removePlan).toHaveBeenCalledWith('txn-1');
      expect(getByText('Delete "Coffee"')).toBeTruthy();
      expect(
        getByText('This also deletes the other part of this exchange, in Dollar card.'),
      ).toBeTruthy();

      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

      expect(transactionsRepo.remove).toHaveBeenCalledWith('txn-1');
    });

    it('keeps the confirm bare for a row that stands alone', async () => {
      const { getByTestId, queryByText } = await renderRow(baseItem);

      await holdCard();
      await act(async () => {
        await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
      });

      expect(queryByText(/This also/)).toBeNull();
    });

    it('puts the keeps-the-balance sentence before the notice on an imported row', async () => {
      mockUseLiveQuery.mockReturnValue({
        data: [{ balanceSetAt: 5_000, newestSyncTime: null }],
        isLoading: false,
      });
      jest.mocked(transactionsRepo.removePlan).mockResolvedValue({ split: true });
      const { getByText } = await renderRow({ ...baseItem, source: 'import', time: 1_000 });

      await holdCard();

      expect(
        getByText(
          `The balance will stay at the bank's figure. Edit the holding to change it. ${SPLIT_NOTICE}`,
        ),
      ).toBeTruthy();
    });

    it('opens a bare confirm when the plan cannot be read', async () => {
      jest.mocked(transactionsRepo.removePlan).mockRejectedValue(new Error('read failed'));
      const { getByTestId, getByText } = await renderRow({ ...baseItem, source: 'import' });

      await holdCard();

      expect(getByText('Delete "Coffee"')).toBeTruthy();
      expect(getByTestId(DELETE_CONFIRM_TEST_ID)).toBeTruthy();
    });
  });

  it('reads no boundary for a manual row and adds no delete message', async () => {
    const { queryByText } = await renderRow(baseItem);

    expect(mockUseLiveQuery).toHaveBeenCalledWith(expect.anything(), expect.anything(), false);
    expect(queryByText(/stay at the bank/)).toBeNull();
  });

  it('renders a synced row bare — no context-menu wrapper and no hold gesture', async () => {
    const { queryByTestId } = await renderRow({ ...baseItem, id: 'txn-mono', source: 'monobank' });

    expect(queryByTestId('card-context-menu')).toBeNull();
    expect(() => getByGestureTestId(HOLD_GESTURE_TEST_ID)).toThrow();
  });

  it('still routes a tap on a manual row to onPress, opening the shared form', async () => {
    const onPress = jest.fn();
    const { getByText } = await renderRow(baseItem, onPress);

    await fireEvent.press(getByText('Coffee'));

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
      await fireEvent.press(getByText('Cancel'));
    });

    expect(scaleOf()).toBe(1);
  });
});
