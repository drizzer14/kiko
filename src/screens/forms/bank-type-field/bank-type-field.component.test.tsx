import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import { darkTheme } from '../../../design-system/theme';

import BankTypeField from '.';

describe('BankTypeField', () => {
  it('shows the placeholder before anything is picked, and opens the sheet on press', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    expect(getByLabelText('Bank type')).toBeTruthy();
    expect(getByTestId('bank-type-field')).toHaveTextContent('Select a bank (optional)');

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-sheet')).toBeTruthy();
  });

  it('lists all six banks, Monobank connectable and the rest import-only', async () => {
    const onSelect = jest.fn();
    const { getByTestId, getAllByText } = await render(
      <BankTypeField
        label="Bank type"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-option-monobank')).toBeTruthy();
    expect(getByTestId('bank-type-option-privatbank')).toBeTruthy();
    expect(getByTestId('bank-type-option-sensebank')).toBeTruthy();
    expect(getByTestId('bank-type-option-procredit')).toBeTruthy();
    expect(getByTestId('bank-type-option-ukrsib')).toBeTruthy();
    expect(getByTestId('bank-type-option-alfa')).toBeTruthy();
    // Monobank alone shows the connect-capable caption; the other five banks
    // (import-only) share the "Statement import only" caption, so this
    // asserts presence with getAllByText rather than the unique-match
    // getByText the brief assumed.
    expect(getAllByText('Connect and import statements.')).toHaveLength(1);
    expect(getAllByText('Statement import only — no live connection.')).toHaveLength(5);
  });

  it('offers a "Free" option that is selected by default and reports null when pressed', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-option-none').props.accessibilityState.selected).toBe(true);

    await fireEvent.press(getByTestId('bank-type-option-none'));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('marks "Free" unselected once a real bank is picked', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        selected="monobank"
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-option-none').props.accessibilityState.selected).toBe(false);
    expect(getByTestId('bank-type-option-monobank').props.accessibilityState.selected).toBe(true);
  });

  it('reports the picked bank id when a row is pressed', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));
    await fireEvent.press(getByTestId('bank-type-option-privatbank'));

    expect(onSelect).toHaveBeenCalledWith('privatbank');
  });

  it('shows the selected bank name as the trigger value', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        selected="monobank"
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    expect(getByTestId('bank-type-field')).toHaveTextContent('Monobank');
  });

  it('shows a checkmark on the currently-picked bank option, matching the app picker pattern', async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        selected="monobank"
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-option-monobank').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('bank-type-option-privatbank').props.accessibilityState.selected).toBe(
      false,
    );
  });

  it("shows Monobank's description with BOTH the live-sync and statements icons", async () => {
    const onSelect = jest.fn();
    const { getByTestId, toJSON } = await render(
      <BankTypeField
        label="Bank type"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('arrow.trianglehead.2.clockwise.rotate.90');
    expect(tree).toContain('receipt');
  });

  it("sizes the capability icons at the caption icon-size step (one step down from round-3's body)", async () => {
    const onSelect = jest.fn();
    const { getByTestId } = await render(
      <BankTypeField
        label="Bank type"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(getByTestId('bank-type-option-monobank-connect-icon').props.size).toBe(
      darkTheme.iconSizes.caption,
    );
    expect(getByTestId('bank-type-option-monobank-import-icon').props.size).toBe(
      darkTheme.iconSizes.caption,
    );
    expect(getByTestId('bank-type-option-privatbank-import-icon').props.size).toBe(
      darkTheme.iconSizes.caption,
    );
  });

  it('shows the not-a-bank disclaimer as a caption on the bank-selection sheet', async () => {
    const onSelect = jest.fn();
    const { getByTestId, getByText } = await render(
      <BankTypeField
        label="Bank type"
        selected={null}
        onSelect={onSelect}
        testID="bank-type-field"
      />,
    );

    await fireEvent.press(getByTestId('bank-type-field'));

    expect(
      getByText(
        'Kiko is an independent app. It is not a bank and is not affiliated with or endorsed by any bank.',
      ),
    ).toBeTruthy();
  });

  it.each(['privatbank', 'sensebank', 'procredit', 'ukrsib', 'alfa'])(
    "shows %s's description with the statements icon ONLY (no sync icon, honest import-only)",
    async (bankId) => {
      const onSelect = jest.fn();
      const { getByTestId } = await render(
        <BankTypeField
          label="Bank type"
          selected={null}
          onSelect={onSelect}
          testID="bank-type-field"
        />,
      );

      await fireEvent.press(getByTestId('bank-type-field'));

      const optionTree = JSON.stringify(getByTestId(`bank-type-option-${bankId}`).toJSON());
      expect(optionTree).toContain('receipt');
      expect(optionTree).not.toContain('arrow.trianglehead.2.clockwise.rotate.90');
    },
  );
});
