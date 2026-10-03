import type { FC } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import type { AccountRow, HoldingRow } from '@kiko/db';

import { useCloseHoldingAction } from './use-close-holding-action';

const mockCloseMany = jest.fn((..._args: unknown[]): Promise<void> => Promise.resolve());

jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { closeMany: (...args: unknown[]) => mockCloseMany(...args) },
}));

const holding = (overrides: Partial<HoldingRow> = {}): HoldingRow =>
  ({
    id: 'h1',
    name: 'Flat',
    type: 'property_item',
    metadata: null,
    ...overrides,
  }) as unknown as HoldingRow;

const account = (overrides: Partial<AccountRow> = {}): AccountRow =>
  ({ id: 'a', kind: 'property', institution: null, ...overrides }) as unknown as AccountRow;

// A minimal host wiring the hook the way a screen does: the action becomes a
// pressable beside the holding, and the sheet renders once.
const Host: FC<{ holdingRow: HoldingRow; accountRow: AccountRow | undefined }> = ({
  holdingRow,
  accountRow,
}) => {
  const { closeActionFor, closeSheet } = useCloseHoldingAction(accountRow);
  const action = closeActionFor(holdingRow);

  return (
    <>
      {action !== undefined && (
        <Pressable testID="close-action" onPress={action.onPress}>
          <Text>{action.label}</Text>
        </Pressable>
      )}
      {closeSheet}
    </>
  );
};

const renderHost = (holdingRow: HoldingRow, accountRow: AccountRow | undefined = account()) =>
  render(<Host holdingRow={holdingRow} accountRow={accountRow} />);

describe('useCloseHoldingAction', () => {
  beforeEach(() => {
    mockCloseMany.mockClear();
  });

  it('offers no close action for a synced holding', async () => {
    const { queryByTestId } = await renderHost(
      holding({ metadata: { monobankId: 'm1' } }),
      account({ kind: 'bank', institution: 'monobank' }),
    );

    expect(queryByTestId('close-action')).toBeNull();
  });

  it('offers a manual loan the loan wording', async () => {
    const { getByText } = await renderHost(
      holding({ name: 'Car', type: 'loan' }),
      account({ kind: 'debt' }),
    );

    expect(getByText('Close loan')).toBeTruthy();
  });

  it('offers a manual property the holding wording', async () => {
    const { getByText } = await renderHost(holding());

    expect(getByText('Close holding')).toBeTruthy();
  });

  it('offers the action when the account has not loaded', async () => {
    const { getByText } = await renderHost(holding(), undefined);

    expect(getByText('Close holding')).toBeTruthy();
  });

  it('renders no sheet until the action is pressed', async () => {
    const { queryByText } = await renderHost(holding());

    expect(queryByText('Close "Flat"')).toBeNull();
  });

  it('renders the close confirm for the pressed holding', async () => {
    const { getByTestId, getByText } = await renderHost(holding());

    await act(async () => {
      await fireEvent.press(getByTestId('close-action'));
    });

    expect(getByText('Close "Flat"')).toBeTruthy();
  });

  it('closes the pressed holding on confirm', async () => {
    const { getByTestId } = await renderHost(holding());

    await act(async () => {
      await fireEvent.press(getByTestId('close-action'));
    });
    await act(async () => {
      await fireEvent.press(getByTestId('close-holding-confirm'));
    });

    expect(mockCloseMany).toHaveBeenCalledWith(['h1']);
  });

  it('closes nothing on Cancel', async () => {
    const { getByTestId, getByText, queryByText } = await renderHost(holding());

    await act(async () => {
      await fireEvent.press(getByTestId('close-action'));
    });
    await act(async () => {
      await fireEvent.press(getByText('Cancel'));
    });

    expect(queryByText('Close "Flat"')).toBeNull();
    expect(mockCloseMany).not.toHaveBeenCalled();
  });
});
