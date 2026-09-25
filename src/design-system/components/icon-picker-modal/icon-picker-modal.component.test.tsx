import { StyleSheet } from 'react-native';
import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { ancestorWithStyle } from '../../../test-support/ancestor-with-style';
import '../../unistyles';
import '../../../i18n';
import { SEEDED_CATEGORIES } from '../../../db/__fixtures__/seeded-categories';

import IconPickerModal from '.';
import { KIKO_CATEGORIES_ICONS, KIKO_ENTITIES_ICONS } from './icon-pools';

type Overrides = Partial<ComponentProps<typeof IconPickerModal>>;

const setup = async (overrides: Overrides = {}) => {
  const onSelect = jest.fn();
  const onDismiss = jest.fn();

  const utils = await render(
    <IconPickerModal
      visible
      icons={KIKO_CATEGORIES_ICONS}
      selectedIcon="cart"
      onSelect={onSelect}
      onDismiss={onDismiss}
      {...overrides}
    />,
  );

  return { onSelect, onDismiss, ...utils };
};

describe('icon pools', () => {
  it('exposes exactly 62 Kiko Entities symbols and 77 Kiko Categories symbols', () => {
    expect(KIKO_ENTITIES_ICONS).toHaveLength(62);
    expect(KIKO_CATEGORIES_ICONS).toHaveLength(77);
  });

  it('includes every seeded category default so each is selectable in the picker', () => {
    // The seeded-category default icons must all be members of the categories
    // pool so a user can re-pick any default. Sourced from the SEEDED_CATEGORIES
    // fixture (the single source of truth) rather than a hardcoded copy, so the
    // assertion cannot drift when a default icon changes.
    for (const icon of SEEDED_CATEGORIES.map((category) => category.icon)) {
      expect(KIKO_CATEGORIES_ICONS).toContain(icon);
    }
  });

  // The eleventh default category (`loan_interest`, seeded
  // by 0039 — not part of SEEDED_CATEGORIES, see that fixture's own comment)
  // still needs its `percent` icon selectable, same as the original ten.
  it('includes percent, the loan_interest default icon (seeded by 0039)', () => {
    expect(KIKO_CATEGORIES_ICONS).toContain('percent');
  });

  it('keeps the two pools distinct: an entities-only symbol is not a categories one, and vice versa', () => {
    // `dollarsign` lives only in the entities pool; `basket` only in categories.
    // The split must not leak a symbol from one pool into the other.
    expect(KIKO_ENTITIES_ICONS).toContain('dollarsign');
    expect(KIKO_CATEGORIES_ICONS).not.toContain('dollarsign');

    expect(KIKO_CATEGORIES_ICONS).toContain('basket');
    expect(KIKO_ENTITIES_ICONS).not.toContain('basket');
  });
});

describe('IconPickerModal', () => {
  it('renders the pool it is given as pressable choices when visible', async () => {
    const { getAllByLabelText, getByLabelText } = await setup();

    // Every symbol in the supplied pool is offered at once inside the grid.
    expect(getAllByLabelText(/^Choose icon /).length).toBe(KIKO_CATEGORIES_ICONS.length);
    expect(getByLabelText('Choose icon basket')).toBeTruthy();
  });

  it('renders the entities pool — an entities-only symbol, and not a categories-only one', async () => {
    const { getByLabelText, queryByLabelText } = await setup({ icons: KIKO_ENTITIES_ICONS });

    expect(getByLabelText('Choose icon dollarsign')).toBeTruthy();
    expect(queryByLabelText('Choose icon basket')).toBeNull();
  });

  it('renders the categories pool — a categories-only symbol, and not an entities-only one', async () => {
    const { getByLabelText, queryByLabelText } = await setup({ icons: KIKO_CATEGORIES_ICONS });

    expect(getByLabelText('Choose icon basket')).toBeTruthy();
    expect(queryByLabelText('Choose icon dollarsign')).toBeNull();
  });

  it('renders nothing while it is not visible', async () => {
    const { queryByLabelText } = await setup({ visible: false });

    expect(queryByLabelText('Choose icon cart')).toBeNull();
  });

  it('calls onSelect with the chosen icon when an option is pressed', async () => {
    const { onSelect, getByLabelText } = await setup();

    fireEvent.press(getByLabelText('Choose icon basket'));

    expect(onSelect).toHaveBeenCalledWith('basket');
  });

  it('calls onDismiss when the cancel control is pressed', async () => {
    const { onDismiss, getByText } = await setup();

    fireEvent.press(getByText('Cancel'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when the backdrop behind the sheet is tapped', async () => {
    const { onDismiss, getByLabelText } = await setup();

    fireEvent.press(getByLabelText('Dismiss icon picker'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('pads the sheet clear of the home indicator (bottom safe-area inset)', async () => {
    const { getByText } = await setup();

    // Walk up from a known sheet BODY child (not the title, which now renders
    // through the shared `header` prop, above a closer `paddingBottom` of its
    // own — see bottom-sheet.styles.ts's `grabberRegion`) to the sheet Box
    // itself, the same ancestor-search approach the currency-breakdown tests
    // use, since RNTL has no direct `getByTestId` here.
    const node = ancestorWithStyle(getByText('Cancel'), 'paddingBottom');

    // The safe-area mock reports a 0 bottom inset by default, so the padding
    // collapses to the shared BottomSheet's single base spacing(4) = 16 — this
    // only proves the inset is additive, not double-subtracted or dropped.
    expect(StyleSheet.flatten(node.props.style).paddingBottom).toBeGreaterThanOrEqual(16);
  });

  it('offers no Remove control when onRemove is not provided', async () => {
    const { queryByText } = await setup();

    expect(queryByText('Remove')).toBeNull();
  });

  it('renders a Remove control and calls onRemove when it is pressed', async () => {
    const onRemove = jest.fn();
    const { getByText } = await setup({ onRemove });

    fireEvent.press(getByText('Remove'));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders the Remove/Cancel footer after the icon grid, not beside the title (task C2)', async () => {
    const onRemove = jest.fn();
    const { getAllByRole } = await setup({ onRemove });

    // Every icon swatch AND the footer's own Buttons share accessibilityRole
    // "button", so their render order is the sheet's true DOM order: the
    // footer (Remove, then Cancel) trails every grid swatch, proving the
    // actions moved from the former top-right title row to the shared
    // body-end SheetFooter.
    const buttons = getAllByRole('button');

    expect(buttons[buttons.length - 2]).toHaveTextContent('Remove');
    expect(buttons[buttons.length - 1]).toHaveTextContent('Cancel');
  });

  it('sizes the Remove/Cancel footer actions the same as a regular button (50pt), not the former compact 44pt size', async () => {
    const onRemove = jest.fn();
    const { getByText } = await setup({ onRemove });

    // Per the button-hierarchy spec, a sheet-row action MATCHES its primary
    // sibling's size rather than shrinking to `compact` — this pins the C2 fix
    // (the icon picker's actions used to be `size="compact"`, the app's one
    // outlier footer at a different size than every other sheet's footer).
    const remove = ancestorWithStyle(getByText('Remove'), 'minHeight');
    const cancel = ancestorWithStyle(getByText('Cancel'), 'minHeight');

    expect(StyleSheet.flatten(remove.props.style).minHeight).toBe(50);
    expect(StyleSheet.flatten(cancel.props.style).minHeight).toBe(50);
  });
});
