import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import '../../../design-system/unistyles';
import '../../../i18n';
import { darkTheme } from '../../../design-system/theme';
import { resolveCategoryColor } from '../../../statistics/category-breakdown';

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
jest.mock('../../../design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone = 'textPrimary', children }: { tone?: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

describe('AddCategoryRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the collapsed "Add category" label as textPrimary so it reads enabled', async () => {
    const { getByTestId, getByText } = await render(<AddCategoryRow />);

    // The whole collapsed row is a live Pressable with no disabled state, so its
    // label must match the plus icon's textPrimary tone — textSecondary read as
    // muted/disabled. Collapsed, this is the only Text in the tree, so the tone
    // testID is unambiguous.
    expect(getByText('Add category')).toBeTruthy();
    expect(getByTestId('text-tone-textPrimary')).toBeTruthy();
  });

  it('is a single collapsed row until it is tapped', async () => {
    const { getByLabelText, queryByLabelText } = await render(<AddCategoryRow />);

    expect(getByLabelText('Add category')).toBeTruthy();
    // Collapsed: none of the form controls are mounted yet.
    expect(queryByLabelText('Name')).toBeNull();
  });

  it('renders as its own card, both collapsed and expanded', async () => {
    const { getByTestId, getByLabelText } = await render(<AddCategoryRow />);

    expect(getByTestId('add-category-card')).toBeTruthy();

    await fireEvent.press(getByLabelText('Add category'));

    // Still the same single card, now showing the expanded form.
    expect(getByTestId('add-category-card')).toBeTruthy();
  });

  // The app-wide bloom rollout: this card carries no `transparent`/`material`
  // variant, so before bloom its non-glass fallback rendered the plain,
  // OPAQUE themed `surface` fill. Adding `bloom` (see GlassSurface's
  // `resolveFallbackFill`) makes the fallback fill TRANSLUCENT instead — the
  // one observable-under-Jest regression bloom's fallback path introduces
  // for a previously-plain surface. Checked in both the collapsed and
  // expanded state, since each renders its own `<GlassSurface bloom>`.
  it('fills the add-category card fallback base with the translucent bloom token, not the plain opaque surface, collapsed and expanded', async () => {
    const { getByTestId, getByLabelText } = await render(<AddCategoryRow />);

    const collapsedFlat = StyleSheet.flatten(getByTestId('add-category-card-base').props.style);
    expect(collapsedFlat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);
    expect(collapsedFlat.backgroundColor).not.toBe(darkTheme.colors.surface);

    await fireEvent.press(getByLabelText('Add category'));

    const expandedFlat = StyleSheet.flatten(getByTestId('add-category-card-base').props.style);
    expect(expandedFlat.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);
    expect(expandedFlat.backgroundColor).not.toBe(darkTheme.colors.surface);
  });

  it('reveals the form and reports the expansion through onExpand when tapped', async () => {
    const onExpand = jest.fn();
    const { getByLabelText } = await render(<AddCategoryRow onExpand={onExpand} />);

    await fireEvent.press(getByLabelText('Add category'));

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(getByLabelText('Name')).toBeTruthy();
  });

  it('expands without error when no onExpand handler is provided', async () => {
    const { getByLabelText } = await render(<AddCategoryRow />);

    await fireEvent.press(getByLabelText('Add category'));

    expect(getByLabelText('Name')).toBeTruthy();
  });

  it('auto-focuses the name input on the freshly revealed form', async () => {
    const { getByLabelText } = await render(<AddCategoryRow />);

    await fireEvent.press(getByLabelText('Add category'));

    // The name field mounts only on expand, so autoFocus fires exactly when the
    // row opens — the keyboard lands on it without a second tap.
    expect(getByLabelText('Name').props.autoFocus).toBe(true);
  });

  it('labels the icon chip and color picker from the localization catalog when expanded', async () => {
    const { getByLabelText, getByText } = await render(<AddCategoryRow />);

    await fireEvent.press(getByLabelText('Add category'));

    expect(getByLabelText('Choose new category icon')).toBeTruthy();
    expect(getByText('Color')).toBeTruthy();
  });

  // The entity-color swatch name whose hex the color picker rings when the empty
  // form opens: the per-key palette fallback for the placeholder preview key.
  // Computed from the same resolver the row uses so this stays correct if the
  // palette hash changes.
  const openPreviewHex = resolveCategoryColor(null, 'new-category');
  const openSwatchName = Object.entries(darkTheme.colors.entityColors).find(
    ([, hex]) => hex === openPreviewHex,
  )?.[0];

  it('rings a concrete default color swatch on open, without persisting one', async () => {
    // The resolved fallback maps onto an actual picker swatch (every chartSeries
    // hue also exists in the entityColors set), so a real swatch reads selected.
    expect(openSwatchName).toBeDefined();
    expect(openPreviewHex).toMatch(/^#[0-9a-f]{6}$/i);

    const { getByLabelText } = await render(<AddCategoryRow />);

    await fireEvent.press(getByLabelText('Add category'));

    // The ring lands on the swatch whose hex === the picker's derived `value`;
    // an empty `value` would ring nothing. This proves `value` is a concrete hex
    // on open, mirroring the accounts form's kind-default ring.
    expect(
      getByLabelText(`New category color ${openSwatchName}`).props.accessibilityState.selected,
    ).toBe(true);
  });

  it('moves the ring to a swatch the user taps', async () => {
    const { getByLabelText } = await render(<AddCategoryRow />);

    await fireEvent.press(getByLabelText('Add category'));

    // Pick a swatch that is not the open default so the ring is observably moved.
    const pickedName = openSwatchName === 'red' ? 'blue' : 'red';
    await fireEvent.press(getByLabelText(`New category color ${pickedName}`));

    expect(
      getByLabelText(`New category color ${pickedName}`).props.accessibilityState.selected,
    ).toBe(true);
    expect(
      getByLabelText(`New category color ${openSwatchName}`).props.accessibilityState.selected,
    ).toBe(false);
  });

  it('sizes the Cancel action the same as the primary Save (full-width regular half)', async () => {
    const { getByLabelText, getByRole } = await render(<AddCategoryRow />);

    await fireEvent.press(getByLabelText('Add category'));

    // Cancel matches the primary Save: both are tall regular 50pt buttons, each
    // filling its equal half of the two-button action row.
    const cancel = getByRole('button', { name: 'Cancel' });

    expect(StyleSheet.flatten(cancel.props.style).minHeight).toBe(50);
    expect(StyleSheet.flatten(cancel.props.style).width).toBe('100%');
  });

  it('keeps the primary Save at the full-width regular size beside Cancel', async () => {
    const { getByLabelText, getByRole } = await render(<AddCategoryRow />);

    await fireEvent.press(getByLabelText('Add category'));

    // Save is a tall regular 50pt button filling its equal half of the row, the
    // same size as Cancel beside it (the pre-audit equal-halves treatment).
    const save = getByRole('button', { name: 'Save' });

    expect(StyleSheet.flatten(save.props.style).minHeight).toBe(50);
    expect(StyleSheet.flatten(save.props.style).width).toBe('100%');
  });

  it('persists color:null when the user saves without tapping a swatch', async () => {
    const { getByLabelText, getByText } = await render(<AddCategoryRow />);

    await fireEvent.press(getByLabelText('Add category'));
    await fireEvent.changeText(getByLabelText('Name'), 'Groceries');
    await fireEvent.press(getByText('Save'));

    // The seeded ring is DISPLAY-only: an untouched picker still persists null so
    // the saved row keeps its per-key palette fallback.
    expect(mockCreate).toHaveBeenCalledWith({
      title: 'Groceries',
      icon: 'square.grid.2x2',
      color: null,
    });
  });
});
