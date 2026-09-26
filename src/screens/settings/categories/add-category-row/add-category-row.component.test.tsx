import type { ReactNode } from 'react';
import { Alert, StyleSheet, TextInput } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../../../design-system/unistyles';
import '@kiko/i18n/init';
import { darkTheme } from '../../../../design-system/theme';
import { resolveCategoryColor } from '../../../../statistics/category-breakdown';

import AddCategoryRow from './add-category-row.component';

const mockCreate = jest.fn();

jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: {
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

// The Text primitive's `tone -> color` mapping lives inside a
// react-native-unistyles variant, which the project's Jest mock strips out of
// the resolved style before a test can inspect it (same limitation MoneyText's
// test documents). Mock the design-system Text to surface its `tone` prop
// through a testID so the collapsed label's tone is assertable; children still
// render as plain text, so every getByText/getByLabelText query is unaffected.
// Button uses react-native's own Text, so its labels are untouched by this.
jest.mock('../../../../design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone = 'textPrimary', children }: { tone?: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

describe('AddCategoryRow', () => {
  const onCollapse = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue(undefined);
  });

  it('renders as its own card with the icon, name, and color fields already revealed', async () => {
    const { getByTestId, getByLabelText, getByText } = await render(
      <AddCategoryRow onCollapse={onCollapse} />,
    );

    expect(getByTestId('add-category-card')).toBeTruthy();
    expect(getByLabelText('Name')).toBeTruthy();
    expect(getByText('Color')).toBeTruthy();
  });

  // The card is the shared solid content-layer `Card` (see its own doc
  // comment for why a content card is flat, not glass): the OPAQUE themed
  // `surface` fill, applied directly to the card's own node.
  it('fills the add-category card with the shared solid surface token', async () => {
    const { getByTestId } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    const flat = StyleSheet.flatten(getByTestId('add-category-card').props.style);

    expect(flat.backgroundColor).toBe(darkTheme.colors.surface);
  });

  it('focuses the name input on mount, deferred to the next frame', async () => {
    const focusSpy = jest.spyOn(TextInput.prototype, 'focus');

    await render(<AddCategoryRow onCollapse={onCollapse} />);
    await waitFor(() => expect(focusSpy).toHaveBeenCalled());

    focusSpy.mockRestore();
  });

  it('does not set native autoFocus on the name input (it would race the keyboard accessory)', async () => {
    const { getByLabelText } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    expect(getByLabelText('Name').props.autoFocus).toBeUndefined();
  });

  it('labels the icon chip from the localization catalog', async () => {
    const { getByLabelText } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    expect(getByLabelText('Choose new category icon')).toBeTruthy();
  });

  // The entity-color swatch name whose hex the color picker rings when the
  // form opens: the per-key palette fallback for the placeholder preview key.
  // Computed from the same resolver the row uses so this stays correct if the
  // palette hash changes.
  const openPreviewHex = resolveCategoryColor(null, 'new-category');
  const openSwatchName = Object.entries(darkTheme.colors.entityColors).find(
    ([, hex]) => hex === openPreviewHex,
  )?.[0];

  it('rings a concrete default color swatch on open, without persisting one', async () => {
    expect(openSwatchName).toBeDefined();
    expect(openPreviewHex).toMatch(/^#[0-9a-f]{6}$/i);

    const { getByLabelText } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    expect(
      getByLabelText(`New category color ${openSwatchName}`).props.accessibilityState.selected,
    ).toBe(true);
  });

  it('moves the ring to a swatch the user taps', async () => {
    const { getByLabelText } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    const pickedName = openSwatchName === 'red' ? 'blue' : 'red';
    await fireEvent.press(getByLabelText(`New category color ${pickedName}`));

    expect(
      getByLabelText(`New category color ${pickedName}`).props.accessibilityState.selected,
    ).toBe(true);
    expect(
      getByLabelText(`New category color ${openSwatchName}`).props.accessibilityState.selected,
    ).toBe(false);
  });

  it('styles the Cancel label with the shared red ghost treatment (the confirm-sheet Cancel shape)', async () => {
    const { getByText } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    expect(StyleSheet.flatten(getByText('Cancel').props.style).color).toBe(
      darkTheme.colors.negative,
    );
  });

  it('sizes Cancel and Save equally at the full-width regular size', async () => {
    const { getByRole } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    const cancel = getByRole('button', { name: 'Cancel' });
    const save = getByRole('button', { name: 'Save' });

    expect(StyleSheet.flatten(cancel.props.style).minHeight).toBe(50);
    expect(StyleSheet.flatten(cancel.props.style).width).toBe('100%');
    expect(StyleSheet.flatten(save.props.style).minHeight).toBe(50);
    expect(StyleSheet.flatten(save.props.style).width).toBe('100%');
  });

  it('persists color:null when the user saves without tapping a swatch', async () => {
    const { getByLabelText, getByText } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    await fireEvent.changeText(getByLabelText('Name'), 'Groceries');
    await fireEvent.press(getByText('Save'));

    // The seeded ring is DISPLAY-only: an untouched picker still persists null
    // so the saved row keeps its per-key palette fallback.
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({ title: 'Groceries', icon: 'tag', color: null }),
    );
  });

  it('calls onCollapse once the save resolves', async () => {
    const { getByLabelText, getByText } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    await fireEvent.changeText(getByLabelText('Name'), 'Groceries');
    await fireEvent.press(getByText('Save'));

    await waitFor(() => expect(onCollapse).toHaveBeenCalledTimes(1));
  });

  it('shows a name-required error and creates nothing when Save is pressed with a blank name', async () => {
    const { getByText, findByText } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    await fireEvent.press(getByText('Save'));

    expect(await findByText('Enter a name.')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it('shows the same error for a whitespace-only name', async () => {
    const { getByLabelText, getByText, findByText } = await render(
      <AddCategoryRow onCollapse={onCollapse} />,
    );

    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await fireEvent.press(getByText('Save'));

    expect(await findByText('Enter a name.')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('clears the name-required error once a name is typed', async () => {
    const { getByLabelText, getByText, findByText, queryByText } = await render(
      <AddCategoryRow onCollapse={onCollapse} />,
    );

    await fireEvent.press(getByText('Save'));
    expect(await findByText('Enter a name.')).toBeTruthy();

    await fireEvent.changeText(getByLabelText('Name'), 'Groceries');
    expect(queryByText('Enter a name.')).toBeNull();
  });

  it('submits once even when Save is pressed twice quickly', async () => {
    let resolveCreate: () => void = () => {};
    mockCreate.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const { getByLabelText, getByText } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    await fireEvent.changeText(getByLabelText('Name'), 'Groceries');
    await fireEvent.press(getByText('Save'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledTimes(1);

    resolveCreate();
    await waitFor(() => expect(onCollapse).toHaveBeenCalledTimes(1));
  });

  it('alerts and keeps the form open (never calling onCollapse) when the write rejects', async () => {
    mockCreate.mockRejectedValue(new Error('disk full'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByLabelText, getByText } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    await fireEvent.changeText(getByLabelText('Name'), 'Groceries');
    await fireEvent.press(getByText('Save'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(onCollapse).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('collapses without persisting anything when Cancel is pressed', async () => {
    const { getByLabelText, getByText } = await render(<AddCategoryRow onCollapse={onCollapse} />);

    await fireEvent.changeText(getByLabelText('Name'), 'Travel');
    await fireEvent.press(getByText('Cancel'));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
