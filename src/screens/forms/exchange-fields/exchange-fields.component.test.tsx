import { act, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';

import ExchangeFields from './exchange-fields.component';

const noop = (): void => {};

const setup = async (overrides: Partial<Parameters<typeof ExchangeFields>[0]> = {}) =>
  render(
    <ExchangeFields
      valueOut=""
      onChangeValueOut={noop}
      valueOutSuffix=""
      destinationOptions={[]}
      destinationHoldingId={null}
      onSelectDestination={noop}
      valueIn=""
      onChangeValueIn={noop}
      valueInSuffix=""
      time={0}
      onChangeTime={noop}
      {...overrides}
    />,
  );

describe('ExchangeFields', () => {
  it('renders the Value Out, To, Value In, and Date fields', async () => {
    const { getByLabelText } = await setup();

    expect(getByLabelText('Value Out')).toBeTruthy();
    expect(getByLabelText('To')).toBeTruthy();
    expect(getByLabelText('Value In')).toBeTruthy();
    expect(getByLabelText('Date')).toBeTruthy();
  });

  it('shows each leg its own currency glyph as a suffix', async () => {
    const { getByText } = await setup({ valueOutSuffix: '₴', valueInSuffix: '$' });

    // The source leg reads in hryvnia, the destination leg in dollars.
    expect(getByText('₴')).toBeTruthy();
    expect(getByText('$')).toBeTruthy();
  });

  it('shows the "Select holding" placeholder in the destination field', async () => {
    const { getByText } = await setup();

    expect(getByText('Select holding')).toBeTruthy();
  });

  it('marks the three save-gating fields (Value Out, To, Value In) as required', async () => {
    const { getAllByText } = await setup();

    // The Value Out, destination (To), and Value In fields all gate save, so
    // each shows the required asterisk; Date and Time do not.
    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(3);
  });

  it('applies valueOutError to the Value Out field and renders it there', async () => {
    const { getByLabelText, getByText } = await setup({
      valueOutError: 'Enter a Value Out greater than 0.',
    });

    expect(getByText('Enter a Value Out greater than 0.')).toBeTruthy();
    const flatStyle = StyleSheet.flatten(getByLabelText('Value Out').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });

  it('renders destinationError directly after the destination picker', async () => {
    const { getByText } = await setup({ destinationError: 'Select a destination account.' });

    expect(getByText('Select a destination account.')).toBeTruthy();
  });

  it('applies valueInError to the Value In field', async () => {
    const { getByLabelText, getByText } = await setup({
      valueInError: 'Enter a Value In greater than 0.',
    });

    expect(getByText('Enter a Value In greater than 0.')).toBeTruthy();
    const flatStyle = StyleSheet.flatten(getByLabelText('Value In').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });

  describe('localization', () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('renders every field label and the destination placeholder from the Ukrainian catalog', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText, getByText, queryByLabelText } = await setup();

      expect(getByLabelText('Віддано')).toBeTruthy();
      expect(getByLabelText('Куди')).toBeTruthy();
      expect(getByLabelText('Отримано')).toBeTruthy();
      expect(getByLabelText('Дата')).toBeTruthy();
      expect(getByText('Оберіть актив')).toBeTruthy();
      expect(queryByLabelText('Value Out')).toBeNull();
    });
  });
});
