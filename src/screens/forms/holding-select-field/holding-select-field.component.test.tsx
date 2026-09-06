import { fireEvent, render } from '@testing-library/react-native';

import '../../../design-system/unistyles';
import HoldingSelectField from '.';
import type { HoldingSelectOption } from './holding-select-field.props';

const options: HoldingSelectOption[] = [
  {
    id: 'h1',
    name: 'Card USD',
    icon: 'creditcard',
    color: '#3366FF',
    currency: 'USD',
    accountName: 'Personal',
  },
  {
    id: 'h2',
    name: 'USD Deposit',
    icon: 'banknote',
    color: '#22AA55',
    currency: 'USD',
    accountName: 'Personal',
  },
];

describe('HoldingSelectField', () => {
  it('shows the placeholder when nothing is selected', async () => {
    const { getByText } = await render(
      <HoldingSelectField
        label="To"
        placeholder="Select holding"
        options={options}
        selectedId={null}
        onSelect={jest.fn()}
      />,
    );

    expect(getByText('Select holding')).toBeTruthy();
  });

  it('shows the selected holding name', async () => {
    const { getByText } = await render(
      <HoldingSelectField
        label="To"
        placeholder="Select holding"
        options={options}
        selectedId="h2"
        onSelect={jest.fn()}
      />,
    );

    expect(getByText('USD Deposit')).toBeTruthy();
  });

  it('opens the sheet and reports the picked id', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText } = await render(
      <HoldingSelectField
        label="To"
        placeholder="Select holding"
        options={options}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Card USD'));

    expect(onSelect).toHaveBeenCalledWith('h1');
  });

  it("shows each option's parent account name in the sheet", async () => {
    const { getByLabelText, getByText } = await render(
      <HoldingSelectField
        label="To"
        placeholder="Select holding"
        options={[
          {
            id: 'h1',
            name: 'Card USD',
            icon: 'creditcard',
            color: '#3366FF',
            currency: 'USD',
            accountName: 'Personal',
          },
          {
            id: 'h2',
            name: 'Card USD',
            icon: 'creditcard',
            color: '#22AA55',
            currency: 'USD',
            accountName: 'Business',
          },
        ]}
        selectedId={null}
        onSelect={jest.fn()}
      />,
    );

    await fireEvent.press(getByLabelText('To'));

    // Two same-named holdings are disambiguated by their account names.
    expect(getByText('Personal · USD')).toBeTruthy();
    expect(getByText('Business · USD')).toBeTruthy();

    // Each row's own accessibility label also carries the account name, so
    // VoiceOver announces the two same-named holdings distinctly.
    expect(getByLabelText('Card USD, Personal')).toBeTruthy();
    expect(getByLabelText('Card USD, Business')).toBeTruthy();
  });
});
