import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';
import { darkTheme } from '../../../design-system/theme';
import { resolveCategoryColor } from '../../../statistics/category-breakdown';

import AddCategoryRow from './add-category-row.component';

const mockCreate = jest.fn();

jest.mock('../../../repositories/categories.repo', () => ({
  categoriesRepo: {
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

describe('AddCategoryRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  // form opens: the per-key palette fallback for the placeholder preview key,
  // resolved off the DARK scheme (the unistyles Jest mock reports themeName
  // undefined -> resolveColorScheme -> 'dark'). Computed from the same resolver
  // the row uses so this stays correct if the palette hash changes.
  const openPreviewHex = resolveCategoryColor(null, 'new-category', 'dark');
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
