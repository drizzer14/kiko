import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ancestorWithStyle } from '../../../test-support/ancestor-with-style';

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

  it("right-aligns the selected holding's account caption within the field", async () => {
    const { getByText } = await render(
      <HoldingSelectField
        label="To"
        placeholder="Select holding"
        options={options}
        selectedId="h2"
        onSelect={jest.fn()}
      />,
    );

    // The trailing caption is pushed to the field's right edge with
    // `marginLeft: 'auto'`. That is a LAYOUT style, so it lives on the Box
    // WRAPPING the caption rather than on the Text itself — `TextProps['style']`
    // admits only typography keys. Pinned here so a refactor cannot flatten that
    // wrapper away (or move the style back onto Text, where it no longer
    // typechecks) and silently lose the alignment.
    const wrapper = ancestorWithStyle(getByText('Personal'), 'marginLeft');

    expect(StyleSheet.flatten(wrapper.props.style).marginLeft).toBe('auto');
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

  it('marks the label with a required asterisk when required', async () => {
    const { getByText } = await render(
      <HoldingSelectField
        label="To"
        placeholder="Select holding"
        options={options}
        selectedId={null}
        onSelect={jest.fn()}
        required
      />,
    );

    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
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
