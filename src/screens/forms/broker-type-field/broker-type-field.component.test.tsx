import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { brokerIds } from '@kiko/brokers';

import BrokerTypeField from '.';
import type { BrokerTypeFieldProps } from './broker-type-field.props';

const setup = async (overrides: Partial<BrokerTypeFieldProps> = {}) => {
  const onSelect = jest.fn();

  const utils = await render(
    <BrokerTypeField
      label="Broker"
      sheetTitle="Broker"
      selected={null}
      onSelect={onSelect}
      testID="broker-type-field"
      {...overrides}
    />,
  );

  return { onSelect, ...utils };
};

describe('BrokerTypeField', () => {
  it('shows the placeholder while no broker is picked', async () => {
    const { getByTestId } = await setup();

    expect(getByTestId('broker-type-field')).toHaveTextContent('Select a broker', {
      exact: false,
    });
  });

  it("shows the picked broker's plain name", async () => {
    const { getByTestId } = await setup({ selected: 'trading212' });

    expect(getByTestId('broker-type-field')).toHaveTextContent('Trading 212', { exact: false });
  });

  it('shows the translated label for Other broker', async () => {
    const { getByTestId } = await setup({ selected: 'other' });

    expect(getByTestId('broker-type-field')).toHaveTextContent('Other broker', { exact: false });
  });

  it('lists every catalog broker in catalog order, Other broker last', async () => {
    const { getByTestId, getAllByTestId } = await setup();

    await fireEvent.press(getByTestId('broker-type-field'));

    const order = getAllByTestId(/^broker-type-field-option-[a-z0-9]+$/).map((node) =>
      (node.props.testID as string).replace('broker-type-field-option-', ''),
    );

    expect(order).toEqual([...brokerIds]);
    expect(getByTestId('broker-type-field-option-ibkr')).toHaveTextContent('Interactive Brokers');
    expect(getByTestId('broker-type-field-option-other')).toHaveTextContent('Other broker');
  });

  it('shows no logo or glyph on the trigger or any row', async () => {
    const { getByTestId, toJSON } = await setup({ selected: null });

    await fireEvent.press(getByTestId('broker-type-field'));

    expect(JSON.stringify(toJSON())).not.toContain('fallbackName');
  });

  it('reports the picked broker and closes the sheet', async () => {
    const { onSelect, getByTestId, queryByTestId } = await setup();

    await fireEvent.press(getByTestId('broker-type-field'));
    await fireEvent.press(getByTestId('broker-type-field-option-freedom24'));

    expect(onSelect).toHaveBeenCalledWith('freedom24');
    expect(queryByTestId('broker-type-field-option-freedom24')).toBeNull();
  });

  it('states under the field that Kiko is not affiliated with any broker', async () => {
    const { getByText } = await setup();

    expect(
      getByText('Kiko is an independent app. It is not affiliated with or endorsed by any broker.'),
    ).toBeTruthy();
  });
});
