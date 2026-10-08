import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import { isLabelInvalid } from '@kiko/test-support/field-label-spy';

import ExchangeFields from './exchange-fields.component';

const mockFieldLabel = jest.fn();

jest.mock('@kiko/design-system/components/field-label', () =>
  require('@kiko/test-support/field-label-spy').fieldLabelSpyModule((props: unknown) =>
    mockFieldLabel(props),
  ),
);

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
  it('renders the Value out, To, Value in, and Date fields', async () => {
    const { getByLabelText } = await setup();

    expect(getByLabelText('Value out')).toBeTruthy();
    expect(getByLabelText('To')).toBeTruthy();
    expect(getByLabelText('Value in')).toBeTruthy();
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

  it('marks the three save-gating fields (Value out, To, Value in) as required', async () => {
    const { getAllByText } = await setup();

    // The Value out, destination (To), and Value in fields all gate save, so
    // each shows the required asterisk; Date and Time do not.
    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(3);
  });

  it('applies valueOutError to the Value out field and renders it there', async () => {
    const { getByLabelText, getByText } = await setup({
      valueOutError: 'Enter a Value out greater than 0.',
    });

    expect(getByText('Enter a Value out greater than 0.')).toBeTruthy();
    const flatStyle = StyleSheet.flatten(getByLabelText('Value out').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
  });

  it('renders destinationError directly after the destination picker', async () => {
    const { getByText } = await setup({ destinationError: 'Select a destination account.' });

    expect(getByText('Select a destination account.')).toBeTruthy();
    expect(isLabelInvalid(mockFieldLabel, 'To')).toBe(true);
  });

  it('adds the same vertical gap above the destination error that a text field has above its own', async () => {
    const { getByText } = await setup({ destinationError: 'Select a destination account.' });

    // FieldError's own root is the Text's immediate parent; the gap lives one
    // level up, on the Box wrapping the picker + its error — a select field
    // needs the same gap TextField's own `Box gap={1}` already gives its
    // error line.
    const errorGroup = getByText('Select a destination account.').parent?.parent;
    expect(StyleSheet.flatten(errorGroup?.props.style).gap).toBe(darkTheme.spacing(1));
  });

  it('caps the Date calendar at the day of maxDate', async () => {
    const maxDate = new Date(2026, 9, 5, 10, 30).getTime();
    const { getByLabelText, getByTestId } = await setup({ maxDate });

    await fireEvent.press(getByLabelText('Date'));

    expect(getByTestId('Date calendar').props.maxDate).toBe('2026-10-05');
  });

  it('shows the catalogue placeholder in each amount field', async () => {
    const { getByLabelText } = await setup();

    expect(getByLabelText('Value out').props.placeholder).toBe(
      i18n.t('forms.transaction.valueOutPlaceholder'),
    );
    expect(getByLabelText('Value in').props.placeholder).toBe(
      i18n.t('forms.transaction.valueInPlaceholder'),
    );
  });

  it('titles the destination sheet from the catalogue', async () => {
    const { getByLabelText, getAllByText } = await setup();
    const title = i18n.t('forms.transaction.toSheetTitle');
    const before = getAllByText(title, { includeHiddenElements: true }).length;

    await fireEvent.press(getByLabelText('To'));

    expect(getAllByText(title).length).toBe(before + 1);
  });

  it('forwards onCreateDestination to the empty destination sheet', async () => {
    const onCreateDestination = jest.fn();
    const { getByLabelText, getByText } = await setup({ onCreateDestination });

    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Add holding'));

    expect(onCreateDestination).toHaveBeenCalledTimes(1);
  });

  it('shows no "Add holding" row without onCreateDestination', async () => {
    const { getByLabelText, queryByText } = await setup();

    await fireEvent.press(getByLabelText('To'));

    expect(queryByText('Add holding')).toBeNull();
  });

  it('applies valueInError to the Value in field', async () => {
    const { getByLabelText, getByText } = await setup({
      valueInError: 'Enter a Value in greater than 0.',
    });

    expect(getByText('Enter a Value in greater than 0.')).toBeTruthy();
    const flatStyle = StyleSheet.flatten(getByLabelText('Value in').props.style);
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
      expect(queryByLabelText('Value out')).toBeNull();
    });
  });
});
