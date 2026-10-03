import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import AccountKindField from '.';

const setup = async (overrides: Partial<Parameters<typeof AccountKindField>[0]> = {}) => {
  const onSelect = jest.fn();

  const utils = await render(
    <AccountKindField selected="bank" onSelect={onSelect} disabled={false} {...overrides} />,
  );

  return { onSelect, ...utils };
};

describe('AccountKindField', () => {
  it("shows the selected kind's label and glyph in the trigger", async () => {
    const { getByTestId, toJSON } = await setup();

    expect(getByTestId('account-kind-field')).toHaveTextContent('Bank');
    expect(JSON.stringify(toJSON())).toContain('building.columns.fill');
  });

  it('lists every kind in display order, each with its subtitle, on trigger press', async () => {
    const { getByTestId, queryByTestId, getAllByTestId } = await setup();

    // Each option row is only mounted once the sheet opens.
    expect(queryByTestId('account-kind-field-option-cash')).toBeNull();

    await fireEvent.press(getByTestId('account-kind-field'));

    const order = getAllByTestId(/^account-kind-field-option-[a-z]+$/).map((node) =>
      String(node.props.testID).replace('account-kind-field-option-', ''),
    );

    expect(order).toEqual(['bank', 'cash', 'crypto', 'property', 'metals', 'debt', 'broker']);
    expect(getByTestId('account-kind-field-option-debt-description')).toHaveTextContent(
      'A loan or debt you owe.',
    );
    expect(getByTestId('account-kind-field-option-broker-description')).toHaveTextContent(
      'Bonds and cash at a broker.',
    );
  });

  it('titles the field "Kind" and the sheet "Account Kind"', async () => {
    const { getByTestId, getByText } = await setup();

    await fireEvent.press(getByTestId('account-kind-field'));

    expect(getByText('Kind')).toBeTruthy();
    expect(getByText('Account Kind')).toBeTruthy();
  });

  it('reports the picked kind and closes the sheet', async () => {
    const { onSelect, getByTestId, queryByTestId } = await setup();

    await fireEvent.press(getByTestId('account-kind-field'));
    await fireEvent.press(getByTestId('account-kind-field-option-property'));

    expect(onSelect).toHaveBeenCalledWith('property');
    expect(queryByTestId('account-kind-field-option-property')).toBeNull();
  });

  it('reports the pick again once the sheet has finished closing', async () => {
    const onSelectClosed = jest.fn();
    const { getByTestId } = await setup({ onSelectClosed });

    await fireEvent.press(getByTestId('account-kind-field'));
    const sheet = getByTestId('account-kind-field-sheet-modal');
    await fireEvent.press(getByTestId('account-kind-field-option-debt'));

    expect(onSelectClosed).not.toHaveBeenCalled();

    await act(async () => sheet.props.onDismiss());

    expect(onSelectClosed).toHaveBeenCalledTimes(1);
    expect(onSelectClosed).toHaveBeenCalledWith('debt');
  });

  it('shows a checkmark on the currently-selected kind option', async () => {
    const { getByTestId } = await setup({ selected: 'crypto' });

    await fireEvent.press(getByTestId('account-kind-field'));

    expect(getByTestId('account-kind-field-option-crypto').props.accessibilityState.selected).toBe(
      true,
    );
    expect(getByTestId('account-kind-field-option-bank').props.accessibilityState.selected).toBe(
      false,
    );
  });

  it('dims and does not open while disabled (edit mode / a source already connected)', async () => {
    const { getByTestId, getByText, queryByTestId } = await setup({ disabled: true });

    const field = ancestorWithStyle(getByText('Bank'), 'opacity');
    expect(StyleSheet.flatten(field.props.style).opacity).toBeLessThan(1);

    await fireEvent.press(getByTestId('account-kind-field'));

    expect(queryByTestId('account-kind-field-option-cash')).toBeNull();
  });
});
