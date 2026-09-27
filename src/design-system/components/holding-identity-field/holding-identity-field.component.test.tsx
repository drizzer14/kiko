import { StyleSheet } from 'react-native';
import type { ComponentProps } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme as theme } from '@kiko/design-system/theme';

import { KIKO_CATEGORIES_ICONS } from '../icon-picker-modal/icon-pools';

import HoldingIdentityField from '.';

type Overrides = Partial<ComponentProps<typeof HoldingIdentityField>>;

const setup = async (overrides: Overrides = {}) => {
  const onChangeName = jest.fn();
  const onSelectIcon = jest.fn();
  const onRemoveIcon = jest.fn();

  const utils = await render(
    <HoldingIdentityField
      icons={KIKO_CATEGORIES_ICONS}
      icon={null}
      fallbackIcon="creditcard"
      name="My card"
      onChangeName={onChangeName}
      onSelectIcon={onSelectIcon}
      onRemoveIcon={onRemoveIcon}
      {...overrides}
    />,
  );

  return { onChangeName, onSelectIcon, onRemoveIcon, ...utils };
};

describe('HoldingIdentityField', () => {
  it('renders a Name caption and an editable name field defaulting its a11y label to Name', async () => {
    const { getByText, getByLabelText } = await setup();

    expect(getByText('Name')).toBeTruthy();
    expect(getByLabelText('Name')).toBeTruthy();
  });

  it('reports name edits through onChangeName', async () => {
    const { onChangeName, getByLabelText } = await setup();

    await fireEvent.changeText(getByLabelText('Name'), 'Renamed');

    expect(onChangeName).toHaveBeenCalledWith('Renamed');
  });

  it('shows the type-derived fallback glyph when no custom icon is set', async () => {
    const { getByLabelText } = await setup({ fallbackIcon: 'doc.text' });

    expect(getByLabelText('Icon doc.text')).toBeTruthy();
  });

  it('shows the custom icon over the fallback when one is set', async () => {
    const { getByLabelText } = await setup({ icon: 'banknote', fallbackIcon: 'doc.text' });

    expect(getByLabelText('Icon banknote')).toBeTruthy();
  });

  it('opens the icon picker and persists a pick through onSelectIcon', async () => {
    const { onSelectIcon, getByLabelText } = await setup();

    await fireEvent.press(getByLabelText('Change Icon'));
    await fireEvent.press(getByLabelText('Choose icon basket'));

    expect(onSelectIcon).toHaveBeenCalledWith('basket');
  });

  it('forwards a focus event through the optional onFocus handler', async () => {
    const onFocus = jest.fn();
    const { getByLabelText } = await setup({ onFocus, nameAccessibilityLabel: 'Card name' });

    await fireEvent(getByLabelText('Card name'), 'focus');

    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('commits on end-of-editing through the optional onEndEditingName handler', async () => {
    const onEndEditingName = jest.fn();
    const { getByLabelText } = await setup({
      onEndEditingName,
      nameAccessibilityLabel: 'Card name',
    });

    await fireEvent(getByLabelText('Card name'), 'endEditing');

    expect(onEndEditingName).toHaveBeenCalledTimes(1);
  });

  it('pins the icon control and the name field to the same fixed box height', async () => {
    const { getByLabelText } = await setup();

    // Both controls carry a fixed, explicit `height` (not a `minHeight` floor):
    // the name field's height must not be measurement-dependent, or a re-render
    // (typing, a type/color change) can collapse it toward its single-line
    // intrinsic content height. A definite equal height keeps it stable.
    const chipHeight = StyleSheet.flatten(getByLabelText('Change Icon').props.style).height;
    const fieldHeight = StyleSheet.flatten(getByLabelText('Name').props.style).height;

    expect(chipHeight).toBeGreaterThan(0);
    expect(fieldHeight).toBe(chipHeight);
  });

  it('renders a bare, caption-free pair (no Icon/Name labels) when captioned is false', async () => {
    const { getByLabelText, queryByText } = await setup({ captioned: false });

    // The name field is still reachable by its a11y label, but neither field
    // caption renders in the dense (category-row) layout.
    expect(getByLabelText('Name')).toBeTruthy();
    expect(queryByText('Icon')).toBeNull();
    expect(queryByText('Name')).toBeNull();
  });

  it('forwards an explicit iconAccessibilityLabel to the icon-picker toggle', async () => {
    const { getByLabelText } = await setup({
      captioned: false,
      iconAccessibilityLabel: 'Change Groceries icon',
    });

    expect(getByLabelText('Change Groceries icon')).toBeTruthy();
  });

  it('leaves the name field un-focused by default (no native autoFocus)', async () => {
    const { getByLabelText } = await setup();

    // The field never sets native autoFocus: it races the sibling
    // InputAccessoryView's registration (see nameInputRef's doc comment). A
    // caller that needs focus-on-mount uses nameInputRef + an imperative
    // `.focus()` instead.
    expect(getByLabelText('Name').props.autoFocus).toBeUndefined();
  });

  it('forwards nameInputRef to the inner TextInput so a caller can focus it imperatively', async () => {
    const nameInputRef: ComponentProps<typeof HoldingIdentityField>['nameInputRef'] = {
      current: null,
    };
    await setup({ nameInputRef });

    expect(nameInputRef.current).not.toBeNull();
    expect(typeof nameInputRef.current?.focus).toBe('function');
  });

  it('suppresses the icon Remove control when no onRemoveIcon handler is given', async () => {
    const { getByLabelText, queryByText } = await setup({
      icon: 'banknote',
      onRemoveIcon: undefined,
    });

    await fireEvent.press(getByLabelText('Change Icon'));

    expect(queryByText('Remove')).toBeNull();
  });

  it('marks the name caption with a required asterisk when required', async () => {
    const { getByText } = await setup({ required: true });

    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders the shared native Done keyboard accessory for the name field on iOS', async () => {
    // The name field carries the same app-wide native Done every other Kiko
    // input shows above the keyboard.
    const { getByText } = await setup();

    expect(getByText('Done')).toBeTruthy();
  });

  it('sets returnKeyType to done on the name field, matching the shared TextField default', async () => {
    const { getByLabelText } = await setup();

    expect(getByLabelText('Name').props.returnKeyType).toBe('done');
  });

  it('renders no error styling or message by default', async () => {
    const { queryByText } = await setup({});

    expect(queryByText('This field is required.')).toBeNull();
  });

  it('never applies a border for an invalid name (Option A: no outline) and renders the message below the whole row when error is set (captioned)', async () => {
    const { getByLabelText, getByText } = await setup({
      error: 'This field is required.',
    });

    const flatStyle = StyleSheet.flatten(getByLabelText('Name').props.style);
    expect(flatStyle.borderColor).not.toBe('#FF453A');
    expect(getByText('This field is required.')).toBeTruthy();
  });

  it('offsets the row-level error to align with the name input, not the icon', async () => {
    const { getByTestId } = await setup({
      error: 'This field is required.',
      testID: 'holding-identity-name-field',
    });

    // The icon chip is a fixed theme.spacing(11) square, separated from the
    // name column by a theme.spacing(3) row gap — the offset must match
    // BOTH, or the message reads as flush-left under the icon instead of
    // under the name field it actually describes.
    const errorNode = getByTestId('holding-identity-name-field-error');
    const flatStyle = StyleSheet.flatten(errorNode.parent?.props.style);
    expect(flatStyle.marginLeft).toBe(theme.spacing(11) + theme.spacing(3));
  });

  it('renders no error node for a bare (uncaptioned) row, even with error set', async () => {
    const { queryByText } = await setup({ captioned: false, error: 'This field is required.' });

    // A dense list row (category rename, holding-detail rename) never
    // validates — reserving height there would regress its existing layout.
    expect(queryByText('This field is required.')).toBeNull();
  });

  it('renders no error node at all while valid (reflow, not reserve)', async () => {
    const { queryByTestId } = await setup({ testID: 'holding-identity-name-field' });

    expect(queryByTestId('holding-identity-name-field-error')).toBeNull();
  });

  it('keeps the icon and name column at the same height whether or not an error is showing', async () => {
    // The error renders BELOW the whole icon+name row, never inside the
    // name column beside it, so the icon never shifts relative to the name
    // field when the error mounts/unmounts — see the component's own doc
    // comment on the composite-row layout.
    const { getByLabelText, rerender } = await setup({});

    const heightBefore = StyleSheet.flatten(getByLabelText('Change Icon').props.style).height;

    await rerender(
      <HoldingIdentityField
        icons={KIKO_CATEGORIES_ICONS}
        icon={null}
        fallbackIcon="creditcard"
        name="My card"
        onChangeName={jest.fn()}
        onSelectIcon={jest.fn()}
        onRemoveIcon={jest.fn()}
        error="This field is required."
      />,
    );

    const heightAfter = StyleSheet.flatten(getByLabelText('Change Icon').props.style).height;

    expect(heightAfter).toBe(heightBefore);
  });

  describe('localization', () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('renders the Icon/Name captions and default name a11y label from the Ukrainian catalog', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByText, getByLabelText, queryByText } = await setup();

      expect(getByText('Іконка')).toBeTruthy();
      expect(getByText('Назва')).toBeTruthy();
      expect(getByLabelText('Назва')).toBeTruthy();
      expect(queryByText('Icon')).toBeNull();
    });
  });
});
