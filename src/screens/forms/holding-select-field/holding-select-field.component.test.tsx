import { StyleSheet } from 'react-native';
import { glyphNamesWithin } from '@kiko/test-support/glyphs-within';
import { isLabelInvalid } from '@kiko/test-support/field-label-spy';
import { act, fireEvent, render } from '@testing-library/react-native';
import { makeFocusNavigation } from '@kiko/test-support/focus-navigation';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';
import { handBackCreatedOption } from '@kiko/screens/forms/use-select-created-option';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import HoldingSelectField from '.';
import type { HoldingSelectOption, HoldingSelectFieldProps } from './holding-select-field.props';

const mockFieldLabel = jest.fn();

jest.mock('@kiko/design-system/components/field-label', () =>
  require('@kiko/test-support/field-label-spy').fieldLabelSpyModule((props: unknown) =>
    mockFieldLabel(props),
  ),
);

const options: HoldingSelectOption[] = [
  {
    id: 'h1',
    name: 'Card USD',
    icon: 'creditcard',
    color: '#3366FF',
    currency: 'USD',
    accountName: 'Personal',
    createdAt: 0,
  },
  {
    id: 'h2',
    name: 'USD Deposit',
    icon: 'banknote',
    color: '#22AA55',
    currency: 'USD',
    accountName: 'Personal',
    createdAt: 0,
  },
];

// The field hears the screen's focus through its navigation, so it renders inside one the test
// can fire focus on.
const renderHoldingSelectField = async (overrides: Partial<HoldingSelectFieldProps> = {}) => {
  const { provide, fireFocus } = makeFocusNavigation();
  const field = (props: Partial<HoldingSelectFieldProps>) =>
    provide(
      <HoldingSelectField
        label="To"
        sheetTitle="Select a Holding"
        placeholder="Select holding"
        options={options}
        selectedId={null}
        onSelect={jest.fn()}
        {...overrides}
        {...props}
      />,
    );
  const view = await render(field({}));

  return {
    ...view,
    fireFocus: () => act(async () => fireFocus()),
    rerenderWith: (props: Partial<HoldingSelectFieldProps>) => view.rerender(field(props)),
  };
};

// The handback id the pressed row passed to onCreateNew, which the create form would carry.
const pressedHandbackId = (onCreateNew: jest.Mock): string => {
  const [handbackId] = onCreateNew.mock.calls[0];

  return handbackId;
};

describe('HoldingSelectField', () => {
  it('shows the placeholder when nothing is selected', async () => {
    const { getByText } = await renderHoldingSelectField();

    expect(getByText('Select holding')).toBeTruthy();
  });

  it('shows the selected holding name', async () => {
    const { getByText } = await renderHoldingSelectField({ selectedId: 'h2' });

    expect(getByText('USD Deposit')).toBeTruthy();
  });

  it("right-aligns the selected holding's account caption within the field", async () => {
    const { getByText } = await renderHoldingSelectField({ selectedId: 'h2' });

    // The trailing caption is pushed to the field's right edge with
    // `marginLeft: 'auto'`. That is a LAYOUT style, so it lives on the Box
    // WRAPPING the caption rather than on the Text itself — `TextProps['style']`
    // admits only typography keys. Pinned here so a refactor cannot flatten that
    // wrapper away (or move the style onto Text, where it does not
    // typecheck) and silently lose the alignment.
    const wrapper = ancestorWithStyle(getByText('Personal'), 'marginLeft');

    expect(StyleSheet.flatten(wrapper.props.style).marginLeft).toBe('auto');
  });

  it('lets the account caption shrink so a long account name cannot push the chevron out', async () => {
    const { getByText } = await renderHoldingSelectField({ selectedId: 'h2' });
    const wrapper = ancestorWithStyle(getByText('Personal'), 'marginLeft');

    expect(StyleSheet.flatten(wrapper.props.style).flexShrink).toBe(1);
  });

  it('keeps the account caption right-aligned before the chevron', async () => {
    const { getByLabelText, getByText } = await renderHoldingSelectField({ selectedId: 'h2' });
    const inOrder = getByLabelText('To').queryAll(
      (node) => node.props.children === 'Personal' || node.props.fallbackName === 'chevron.down',
    );
    const wrapper = ancestorWithStyle(getByText('Personal'), 'marginLeft');

    expect(inOrder.map((node) => node.props.fallbackName ?? node.props.children)).toEqual([
      'Personal',
      'chevron.down',
    ]);
    expect(glyphNamesWithin(wrapper)).toEqual([]);
  });

  it('opens the sheet and reports the picked id', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText } = await renderHoldingSelectField({ onSelect });

    await fireEvent.press(getByLabelText('To'));
    await fireEvent.press(getByText('Card USD'));

    expect(onSelect).toHaveBeenCalledWith('h1');
  });

  it('shows sheetTitle, not label, as the sheet header', async () => {
    const { getByLabelText, queryByText } = await renderHoldingSelectField();

    expect(queryByText('Select a Holding')).toBeNull();

    await fireEvent.press(getByLabelText('To'));

    expect(queryByText('Select a Holding')).toBeTruthy();
  });

  it('marks the label with a required asterisk when required', async () => {
    const { getByText } = await renderHoldingSelectField({ required: true });

    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
  });

  it('shows its error under the field and turns the label red', async () => {
    const { getByText } = await renderHoldingSelectField({ error: 'Select a destination.' });

    expect(getByText('Select a destination.')).toBeTruthy();
    expect(isLabelInvalid(mockFieldLabel, 'To')).toBe(true);
  });

  it('turns the label red with no error line of its own when invalid', async () => {
    const { queryByText } = await renderHoldingSelectField({ invalid: true });

    expect(isLabelInvalid(mockFieldLabel, 'To')).toBe(true);
    expect(queryByText(/\.$/)).toBeNull();
  });

  it("shows each option's parent account name in the sheet", async () => {
    const { getByLabelText, getByText } = await renderHoldingSelectField({
      options: [
        {
          id: 'h1',
          name: 'Card USD',
          icon: 'creditcard',
          color: '#3366FF',
          currency: 'USD',
          accountName: 'Personal',
          createdAt: 0,
        },
        {
          id: 'h2',
          name: 'Card USD',
          icon: 'creditcard',
          color: '#22AA55',
          currency: 'USD',
          accountName: 'Business',
          createdAt: 0,
        },
      ],
    });

    await fireEvent.press(getByLabelText('To'));

    // Two same-named holdings are disambiguated by their account names.
    expect(getByText('Personal · USD')).toBeTruthy();
    expect(getByText('Business · USD')).toBeTruthy();

    // Each row's own accessibility label also carries the account name, so
    // VoiceOver announces the two same-named holdings distinctly.
    expect(getByLabelText('Card USD, Personal')).toBeTruthy();
    expect(getByLabelText('Card USD, Business')).toBeTruthy();
  });

  describe('"Add holding" row', () => {
    it('is absent when the field has no onCreateNew', async () => {
      const { getByLabelText, queryByTestId } = await renderHoldingSelectField({ options: [] });

      await fireEvent.press(getByLabelText('To'));

      expect(queryByTestId('holding-select-create-new')).toBeNull();
    });

    it('is absent when the picker has options', async () => {
      const { getByLabelText, queryByTestId } = await renderHoldingSelectField({
        onCreateNew: jest.fn(),
      });

      await fireEvent.press(getByLabelText('To'));

      expect(queryByTestId('holding-select-create-new')).toBeNull();
    });

    it('is shown, labelled "Add holding", when the picker has no options', async () => {
      const { getByLabelText, getByTestId, getByText } = await renderHoldingSelectField({
        options: [],
        onCreateNew: jest.fn(),
      });

      await fireEvent.press(getByLabelText('To'));

      expect(getByTestId('holding-select-create-new')).toBeTruthy();
      expect(getByText('Add holding')).toBeTruthy();
    });

    it('closes the sheet and calls onCreateNew once when pressed', async () => {
      const onCreateNew = jest.fn();
      const { getByLabelText, getByTestId, queryByText } = await renderHoldingSelectField({
        options: [],
        onCreateNew,
      });

      await fireEvent.press(getByLabelText('To'));
      await fireEvent.press(getByTestId('holding-select-create-new'));

      expect(onCreateNew).toHaveBeenCalledTimes(1);
      expect(onCreateNew).toHaveBeenCalledWith(expect.any(String));
      expect(queryByText('Select a Holding')).toBeNull();
    });

    it('selects the holding handed back for the id onCreateNew received, on return', async () => {
      const onSelect = jest.fn();
      const onCreateNew = jest.fn();
      const { getByLabelText, getByTestId, rerenderWith, fireFocus } =
        await renderHoldingSelectField({ options: [], onCreateNew, onSelect });

      await fireEvent.press(getByLabelText('To'));
      await fireEvent.press(getByTestId('holding-select-create-new'));
      handBackCreatedOption(pressedHandbackId(onCreateNew), 'created');
      await rerenderWith({ options: [{ ...options[0], id: 'created' }] });
      await fireFocus();

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith('created');
    });

    it('selects the handed-back holding, not another holding that appeared during the round trip', async () => {
      const onSelect = jest.fn();
      const onCreateNew = jest.fn();
      const { getByLabelText, getByTestId, rerenderWith, fireFocus } =
        await renderHoldingSelectField({ options: [], onCreateNew, onSelect });

      await fireEvent.press(getByLabelText('To'));
      await fireEvent.press(getByTestId('holding-select-create-new'));
      await rerenderWith({ options: [{ ...options[1], id: 'synced', createdAt: Date.now() }] });
      handBackCreatedOption(pressedHandbackId(onCreateNew), 'created');
      await rerenderWith({
        options: [
          { ...options[1], id: 'synced', createdAt: Date.now() },
          { ...options[0], id: 'created' },
        ],
      });
      await fireFocus();

      expect(onSelect.mock.calls).toEqual([['created']]);
    });

    it('selects nothing on a cancel, even when another holding appeared during the round trip', async () => {
      const onSelect = jest.fn();
      const { getByLabelText, getByTestId, rerenderWith, fireFocus } =
        await renderHoldingSelectField({ options: [], onCreateNew: jest.fn(), onSelect });

      await fireEvent.press(getByLabelText('To'));
      await fireEvent.press(getByTestId('holding-select-create-new'));
      await rerenderWith({ options: [{ ...options[1], id: 'synced', createdAt: Date.now() }] });
      await fireFocus();

      expect(onSelect).not.toHaveBeenCalled();
    });

    it('selects nothing when a holding appears without the row having been pressed', async () => {
      const onSelect = jest.fn();
      const { rerenderWith, fireFocus } = await renderHoldingSelectField({
        options: [],
        onCreateNew: jest.fn(),
        onSelect,
      });

      await rerenderWith({ options: [options[0]] });
      await fireFocus();

      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
