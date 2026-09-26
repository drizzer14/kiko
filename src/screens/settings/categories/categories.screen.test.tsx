import type { ComponentProps } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import { SEEDED_CATEGORIES } from '@kiko/db/__fixtures__/seeded-categories';

import { i18n } from '../../../i18n';
import {
  asNavigationProp,
  asRouteProp,
  navigationSpy,
} from '../../../test-support/navigation-props';
import { darkTheme } from '../../../design-system/theme';
import { categoryColor } from '../../../statistics/category-breakdown';
// Prefixed `mock*` so Jest's hoisted mock factory may reference it. Overrides
// ONLY `useAnimatedRef` — see the module for the full rationale.
import { mockReanimatedScrollToEnd } from '../../../test-support/mock-reanimated-scroll-to-end';

import CategoriesScreen from './categories.screen';

const mockScrollToEnd = jest.fn();

// A function ref keeps its `.current` when React attaches the host node.
jest.mock('react-native-reanimated', () => mockReanimatedScrollToEnd(() => mockScrollToEnd));

// Override the shared `react-native-sortables` mock (`jest/setup.js`) for this
// file only, so the identity-churn regression test below can inspect the exact
// `renderItem`/`keyExtractor` props `Sortable.Grid` receives on each render —
// the shared mock's `Grid` destructures them straight off `props` without
// exposing them on the rendered host View. Otherwise byte-for-byte the same
// shape (renders `data` through `renderItem`, keyed via `keyExtractor`, and
// surfaces `onDragEnd`/the rest on the `sortable-grid` host View), so every
// other test in this file is unaffected.
type MockGridProps = {
  data?: unknown[];
  renderItem: (info: { item: unknown; index: number }) => unknown;
  keyExtractor?: (item: unknown) => string;
  onDragEnd?: (...args: unknown[]) => void;
  [prop: string]: unknown;
};

const mockGridSpy = jest.fn<void, [MockGridProps]>();
jest.mock('react-native-sortables', () => {
  const React = require('react');
  const { View } = require('react-native');

  const Grid = ({ data, renderItem, keyExtractor, onDragEnd, ...rest }: MockGridProps) => {
    mockGridSpy({ data, renderItem, keyExtractor, onDragEnd, ...rest });

    return React.createElement(
      View,
      { testID: 'sortable-grid', onDragEnd, ...rest },
      (data ?? []).map((item: unknown, index: number) =>
        React.createElement(
          React.Fragment,
          { key: keyExtractor ? keyExtractor(item) : index },
          renderItem({ item, index }),
        ),
      ),
    );
  };

  const Passthrough = ({ children }: { children?: unknown }) => children ?? null;

  return {
    __esModule: true,
    default: { Grid, Flex: Passthrough, Layer: Passthrough, Handle: Passthrough },
  };
});

const mockUpdateTitle = jest.fn();
const mockUpdateIcon = jest.fn();
const mockUpdateColor = jest.fn();
const mockCreate = jest.fn();
const mockDelete = jest.fn();
const mockReorder = jest.fn();
const mockSetDefault = jest.fn();
let mockLiveQueryData: Array<{ key: string; title: string; icon: string; color?: string | null }> =
  [];
let mockSettingsRows: Array<{ defaultCategoryKey: string }> = [];
let mockCategoriesIsLoading = false;
// `false` = the categories are still the cached rows (a cached display mount
// before its own fresh read has applied).
let mockCategoriesIsFresh = true;
let mockSettingsIsLoading = false;

jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    create: (...args: unknown[]) => mockCreate(...args),
    updateTitle: (...args: unknown[]) => mockUpdateTitle(...args),
    updateIcon: (...args: unknown[]) => mockUpdateIcon(...args),
    updateColor: (...args: unknown[]) => mockUpdateColor(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    reorder: (...args: unknown[]) => mockReorder(...args),
  },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setDefaultCategoryKey: (...args: unknown[]) => mockSetDefault(...args),
  },
}));
jest.mock('../../../db/use-live-query', () => ({
  useLiveQuery: (_query: unknown, keys: string[]) =>
    keys?.[0] === 'settings'
      ? { data: mockSettingsRows, isLoading: mockSettingsIsLoading }
      : {
          data: mockLiveQueryData,
          isLoading: mockCategoriesIsLoading,
          isFresh: mockCategoriesIsFresh,
        },
}));

type CategoriesProps = ComponentProps<typeof CategoriesScreen>;

// The screen reads neither prop (it navigates through hooks), but React
// Navigation still types both as required, so every render supplies the pair
// from the shared, singly-cast test doubles.
const renderScreen = () =>
  render(
    <CategoriesScreen
      navigation={asNavigationProp<CategoriesProps['navigation']>(navigationSpy())}
      route={asRouteProp<CategoriesProps['route']>('Categories')}
    />,
  );

describe('CategoriesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveQueryData = SEEDED_CATEGORIES.map((category) => ({ ...category }));
    // `other` is the seeded default catch-all.
    mockSettingsRows = [{ defaultCategoryKey: 'other' }];
    mockCategoriesIsLoading = false;
    mockCategoriesIsFresh = true;
    mockSettingsIsLoading = false;
  });

  it('lists every seeded category by its title', async () => {
    const { getByDisplayValue } = await renderScreen();

    for (const category of SEEDED_CATEGORIES) {
      expect(getByDisplayValue(category.title)).toBeTruthy();
    }
  });

  it('renders each category as its own card, with no add-category card until the footer expands it', async () => {
    const { getAllByTestId, getByText, getByTestId, queryByTestId } = await renderScreen();

    // One Card per category — not a single shared surface housing every row.
    expect(getAllByTestId('category-card')).toHaveLength(SEEDED_CATEGORIES.length);
    // The add-category form is not mounted until the footer action is tapped
    // (review decision 19 — the inline collapsed row is gone).
    expect(queryByTestId('add-category-card')).toBeNull();

    await fireEvent.press(getByText('Add category'));

    expect(getByTestId('add-category-card')).toBeTruthy();
  });

  // The category card is the SAME solid content-layer `Card` the account and
  // holding cards use: a flat `surface` fill, no Liquid Glass material and so
  // no separate base/wash sub-layers to assert on — the category color lives
  // on the row icon only, never on the card background.
  it('renders each category card as the shared solid Card surface', async () => {
    const { getAllByTestId } = await renderScreen();

    const card = getAllByTestId('category-card')[0];
    expect(StyleSheet.flatten(card.props.style).backgroundColor).toBe(darkTheme.colors.surface);
  });

  // ROOT-CAUSE REGRESSION for the flaky category-card ordering: an inline
  // `keyExtractor`/`renderItem` (a fresh function on every render) makes
  // `react-native-sortables`' item store (`ItemsProvider`/`createItemsStore`)
  // treat the renderer itself as changed and recompute EVERY row's node, not
  // just the row whose data actually changed (see `categoryKeyExtractor`'s
  // doc comment in `categories.screen.tsx` — this used to also risk a stale
  // Liquid Glass resample back when this card was a `GlassSurface`, a concern
  // the current solid `Card` no longer has, but the referential-stability fix
  // itself remains worth keeping and asserting). This asserts the FIX
  // (`categoryKeyExtractor` +
  // the memoized `renderCategoryRow`) directly: the exact function references
  // `Sortable.Grid` receives must survive a re-render triggered by an
  // unrelated category write — a live-query refire that hands back a brand
  // new array of brand new row objects (`useLiveQuery`'s real behavior),
  // never a `.rerender` reusing the previous props.
  it('keeps keyExtractor and renderItem referentially stable across a re-render triggered by an unrelated category edit', async () => {
    const { rerender } = await renderScreen();

    const initialProps = mockGridSpy.mock.calls.at(-1)?.[0];
    expect(initialProps?.keyExtractor).toEqual(expect.any(Function));
    expect(initialProps?.renderItem).toEqual(expect.any(Function));

    // Simulate the live query re-firing after an edit to some OTHER category
    // (a rename/recolor/icon-pick elsewhere in the list): a brand-new array of
    // brand-new row objects for the same category set, exactly what a real
    // `categories` table re-`SELECT` hands back.
    mockLiveQueryData = SEEDED_CATEGORIES.map((category) => ({ ...category }));

    await act(async () => {
      rerender(
        <CategoriesScreen
          navigation={asNavigationProp<CategoriesProps['navigation']>(navigationSpy())}
          route={asRouteProp<CategoriesProps['route']>('Categories')}
        />,
      );
    });

    const nextProps = mockGridSpy.mock.calls.at(-1)?.[0];
    expect(nextProps?.keyExtractor).toBe(initialProps?.keyExtractor);
    expect(nextProps?.renderItem).toBe(initialProps?.renderItem);
  });

  it('renames a category via updateTitle and shows the new title in the field', async () => {
    const { getByLabelText, getByDisplayValue } = await renderScreen();

    const field = getByLabelText('Groceries title');
    await fireEvent.changeText(field, 'Food');
    await fireEvent(field, 'endEditing');

    expect(mockUpdateTitle).toHaveBeenCalledWith('groceries', 'Food');
    expect(getByDisplayValue('Food')).toBeTruthy();
  });

  it('does not call updateTitle when the trimmed new title is empty', async () => {
    const { getByLabelText } = await renderScreen();

    const field = getByLabelText('Dining title');
    await fireEvent.changeText(field, '   ');
    await fireEvent(field, 'endEditing');

    expect(mockUpdateTitle).not.toHaveBeenCalled();
  });

  it('opens the icon picker modal when a category icon is tapped', async () => {
    const { getByLabelText, queryByLabelText } = await renderScreen();

    // The modal — and its options — is absent until the icon chip is tapped.
    expect(queryByLabelText('Choose icon basket')).toBeNull();

    await fireEvent.press(getByLabelText('Change Groceries icon'));

    expect(getByLabelText('Choose icon basket')).toBeTruthy();
  });

  it('changes a category icon via updateIcon and closes the modal when a curated icon is chosen', async () => {
    const { getByLabelText, queryByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText('Change Groceries icon'));
    await fireEvent.press(getByLabelText('Choose icon basket'));

    expect(mockUpdateIcon).toHaveBeenCalledWith('groceries', 'basket');
    // Selecting dismisses the modal, so its options are gone.
    expect(queryByLabelText('Choose icon basket')).toBeNull();
  });

  it('closes the modal on cancel without changing the icon', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText('Change Groceries icon'));
    await fireEvent.press(getByText('Cancel'));

    expect(mockUpdateIcon).not.toHaveBeenCalled();
    expect(queryByLabelText('Choose icon basket')).toBeNull();
  });

  it('offers a fixed curated icon set (not a free-text field) in the picker', async () => {
    const { getByLabelText, queryByPlaceholderText } = await renderScreen();

    await fireEvent.press(getByLabelText('Change Groceries icon'));

    // Curated options are rendered as pressable choices, not a typed input.
    expect(getByLabelText('Choose icon cart')).toBeTruthy();
    expect(queryByPlaceholderText(/icon/i)).toBeNull();
  });

  it('no longer overlays a pencil edit badge on the category icons', async () => {
    const { queryAllByTestId } = await renderScreen();

    // The bordered icon chip is now the sole edit affordance; the overlaid
    // pencil badge was removed.
    expect(queryAllByTestId('category-icon-edit-badge')).toHaveLength(0);
  });

  it('reveals the add-category form when the footer action is tapped', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await renderScreen();

    // The name field is absent until the footer's "Add category" action is tapped.
    expect(queryByLabelText('Name')).toBeNull();

    await fireEvent.press(getByText('Add category'));

    expect(getByLabelText('Name')).toBeTruthy();
  });

  it('focuses the name field when the add-category form is revealed, without native autoFocus', async () => {
    const focusSpy = jest.spyOn(TextInput.prototype, 'focus');

    const { getByLabelText, getByText } = await renderScreen();

    await fireEvent.press(getByText('Add category'));

    // The name field never sets native autoFocus (it would race the sibling
    // keyboard InputAccessoryView's registration) — AddCategoryRow instead
    // focuses it imperatively, deferred to the next frame; wait for that frame
    // to elapse.
    expect(getByLabelText('Name').props.autoFocus).toBeUndefined();
    await waitFor(() => expect(focusSpy).toHaveBeenCalled());

    focusSpy.mockRestore();
  });

  it('scrolls the ScrollView to the newly revealed form when the add form expands', async () => {
    // The scroll is deferred to the next frame so the just-revealed fields are
    // measured first; run that frame synchronously to assert the effect.
    const rafSpy = jest
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 0;
      });

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Add category'));

    expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: true });

    rafSpy.mockRestore();
  });

  it('creates a category via categoriesRepo.create and clears the form after saving', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await renderScreen();

    await fireEvent.press(getByText('Add category'));
    await fireEvent.changeText(getByLabelText('Name'), 'Travel');
    await fireEvent.press(getByText('Save'));

    // The default icon seeds the new category until the user picks another, and
    // with no swatch tapped the color persists as null (the "not picked" state).
    expect(mockCreate).toHaveBeenCalledWith({
      title: 'Travel',
      icon: 'tag',
      color: null,
    });
    // The form collapses (clears) on a successful add.
    expect(queryByLabelText('Name')).toBeNull();
  });

  it('creates a category with the picked color when a swatch is tapped', async () => {
    const { getByLabelText, getByText } = await renderScreen();

    await fireEvent.press(getByText('Add category'));
    await fireEvent.changeText(getByLabelText('Name'), 'Travel');
    // The add-form picker scopes its swatch labels with its own prefix, so this
    // targets it unambiguously despite the per-row pickers already on screen.
    await fireEvent.press(getByLabelText('New category color yellow'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Travel', color: expect.stringMatching(/^#/) }),
    );
  });

  it('recolors a category via updateColor when a row swatch is tapped', async () => {
    const { getByLabelText } = await renderScreen();

    // Each row's picker prefixes its swatch labels with the category title, so
    // the Groceries row's yellow swatch is addressable on its own.
    await fireEvent.press(getByLabelText('Groceries color yellow'));

    expect(mockUpdateColor).toHaveBeenCalledWith('groceries', expect.stringMatching(/^#/));
  });

  it('shows a name-required error and creates nothing when the name is blank', async () => {
    const { getByLabelText, getByText, findByText } = await renderScreen();

    await fireEvent.press(getByText('Add category'));
    await fireEvent.press(getByText('Save'));

    expect(await findByText('Enter a name.')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();

    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('collapses the add-category form (and writes nothing) when Cancel is pressed', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await renderScreen();

    await fireEvent.press(getByText('Add category'));
    // Enter a name, then back out — Cancel must be a real escape hatch.
    await fireEvent.changeText(getByLabelText('Name'), 'Travel');
    await fireEvent.press(getByText('Cancel'));

    // The form collapses back to the single footer "Add category" action...
    expect(queryByLabelText('Name')).toBeNull();
    expect(getByText('Add category')).toBeTruthy();
    // ...without persisting anything.
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('offers an expanded curated icon pool covering common finance categories', async () => {
    const { getByLabelText, getAllByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText('Change Groceries icon'));

    // The whole Kiko Categories pool (76 symbols) is offered at once.
    expect(getAllByLabelText(/^Choose icon /).length).toBeGreaterThan(40);

    // A spread of category-relevant SF Symbols from the Kiko Categories pool is
    // present.
    for (const icon of [
      'cart',
      'fuelpump',
      'banknote',
      'house',
      'building',
      'cup.and.saucer',
      'tshirt',
      'gift',
    ]) {
      expect(getByLabelText(`Choose icon ${icon}`)).toBeTruthy();
    }
  });

  it('gives each card control a >=44pt tap target via the shared Button (iOS HIG)', async () => {
    const { getByLabelText } = await renderScreen();

    // The set-default star is the shared Button at the `compact` size (44pt
    // visible, aligning with the name input); the delete and both reorder
    // controls are at the shorter `small` size, whose >= 44pt tap target (H1 in
    // the HIG audit) is restored by hitSlop. Either way the tap target is the
    // visible minHeight PLUS any hitSlop above and below it, and that must
    // reach 44.
    for (const label of [
      'Set Groceries as default',
      'Delete Groceries',
      'Move Transport to top',
      'Move Transport to bottom',
    ]) {
      const control = getByLabelText(label);
      const visibleHeight = StyleSheet.flatten(control.props.style).minHeight as number;
      const slop = (control.props.hitSlop ?? { top: 0, bottom: 0 }) as {
        top?: number;
        bottom?: number;
      };
      expect(visibleHeight + (slop.top ?? 0) + (slop.bottom ?? 0)).toBeGreaterThanOrEqual(44);
    }
  });

  it('renders a disabled Delete on the default category card for layout parity', async () => {
    const { getByLabelText } = await renderScreen();

    // The default card now ALWAYS renders the Delete control (previously hidden),
    // but disabled — the default can never be deleted, and the disabled state
    // keeps the bottom row's layout identical across every card.
    expect(getByLabelText('Delete Other')).toBeDisabled();
  });

  it('renders the default-star marker as the same faint-tint compact Button shape as the set-default star', async () => {
    const { getByLabelText } = await renderScreen();

    // The default marker is the same faint-tint `compact` Button as the
    // set-default star, disabled so it reads as a static marker — the SAME
    // control shape and padding, not a bare icon. At compact it holds a 44pt
    // visible tap target outright.
    const marker = getByLabelText('Other is the default category');
    const visibleHeight = StyleSheet.flatten(marker.props.style).minHeight as number;
    const slop = (marker.props.hitSlop ?? { top: 0, bottom: 0 }) as {
      top?: number;
      bottom?: number;
    };
    expect(visibleHeight + (slop.top ?? 0) + (slop.bottom ?? 0)).toBeGreaterThanOrEqual(44);
    expect(marker).toBeDisabled();
  });

  it('sizes both favorite star buttons to compact (44pt) to match the name input height', async () => {
    const { getByLabelText } = await renderScreen();

    // The star sits beside the fixed 44pt name input (HoldingIdentityField's
    // nameField), so its VISIBLE height must be 44pt (compact), not the shorter
    // 34pt `small` — otherwise it reads as misaligned against the input. Both the
    // set-default star and the default-marker star take the compact height.
    const setDefaultStar = getByLabelText('Set Groceries as default');
    const defaultMarker = getByLabelText('Other is the default category');
    expect(StyleSheet.flatten(setDefaultStar.props.style).minHeight).toBe(44);
    expect(StyleSheet.flatten(defaultMarker.props.style).minHeight).toBe(44);
  });

  it('keeps a non-default card Delete enabled', async () => {
    const { getByLabelText } = await renderScreen();

    expect(getByLabelText('Delete Groceries')).not.toBeDisabled();
  });

  it('tints an uncolored category row icon from the chart set hash', async () => {
    // A single uncolored category, so exactly one row icon renders and its
    // color comes from the `categoryColor(key)` hash, not a stored hex.
    mockLiveQueryData = [{ key: 'utilities', title: 'Utilities', icon: 'bolt', color: null }];
    mockSettingsRows = [{ defaultCategoryKey: 'utilities' }];

    const { getByLabelText } = await renderScreen();

    expect(getByLabelText('Icon bolt').props.tintColor).toBe(categoryColor('utilities'));
  });

  it('shows the delete control at the bottom with a visible "Delete" label', async () => {
    const { getAllByText, getByLabelText } = await renderScreen();

    // The delete affordance carries a visible "Delete" text label — one per card
    // (the default card's is disabled, but still rendered for layout parity), not
    // just an icon.
    expect(getAllByText('Delete')).toHaveLength(SEEDED_CATEGORIES.length);
    expect(getByLabelText('Delete Groceries')).toBeTruthy();
  });

  it('puts the "Set as default" control in the header slot on the non-default cards and hides it on the default', async () => {
    const { queryByLabelText, getByLabelText } = await renderScreen();

    // The default card shows the filled-star marker in its header slot instead
    // of a "Set as default" control.
    expect(queryByLabelText('Set Other as default')).toBeNull();
    // Every other card exposes the icon-only "Set as default" star, identified
    // purely by its VoiceOver label.
    expect(getByLabelText('Set Groceries as default')).toBeTruthy();
  });

  it('sets a category as the default when its "Set as default" is pressed', async () => {
    const { getByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText('Set Groceries as default'));

    expect(mockSetDefault).toHaveBeenCalledWith('groceries');
  });

  it('confirms via the themed sheet before deleting, then deletes by key on confirm', async () => {
    const { getByLabelText, getByTestId, getByText } = await renderScreen();

    await fireEvent.press(getByLabelText('Delete Groceries'));

    // The themed ConfirmSheet (not a native action sheet) opens titled with the
    // category name; nothing is deleted until its destructive confirm is pressed.
    expect(getByText('Delete "Groceries"')).toBeTruthy();
    expect(mockDelete).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId('category-delete-confirm'));

    expect(mockDelete).toHaveBeenCalledWith('groceries');
  });

  it('deletes nothing when the themed delete confirm is dismissed via Cancel', async () => {
    const { getByLabelText, getByText } = await renderScreen();

    await fireEvent.press(getByLabelText('Delete Groceries'));
    await fireEvent.press(getByText('Cancel'));

    expect(mockDelete).not.toHaveBeenCalled();
  });

  describe('reorder', () => {
    // The seeded categories render top-to-bottom in `SEEDED_CATEGORIES` order.
    const keys = SEEDED_CATEGORIES.map((category) => category.key);

    it('moves a category to the top when its move-to-top button is pressed', async () => {
      const { getByLabelText } = await renderScreen();

      // Transport is the third card; move-to-top lifts it above every other,
      // keeping the rest in their existing relative order.
      await fireEvent.press(getByLabelText('Move Transport to top'));

      expect(mockReorder).toHaveBeenCalledWith([
        'transport',
        ...keys.filter((k) => k !== 'transport'),
      ]);
    });

    it('moves a category to the bottom when its move-to-bottom button is pressed', async () => {
      const { getByLabelText } = await renderScreen();

      // Transport drops below every other, the rest keeping their order.
      await fireEvent.press(getByLabelText('Move Transport to bottom'));

      expect(mockReorder).toHaveBeenCalledWith([
        ...keys.filter((k) => k !== 'transport'),
        'transport',
      ]);
    });

    // kiko-architecture: a cached display mount shows rows that can be one
    // read old. Both reorder paths persist the WHOLE order of the rows on
    // screen, so neither may act on the cached order.
    it('never starts a drag reorder while the categories are still the cached order', async () => {
      mockCategoriesIsFresh = false;
      const { getByTestId } = await renderScreen();

      expect(getByTestId('sortable-grid').props.sortEnabled).toBe(false);
    });

    it('ignores a move-to-top press while the categories are still the cached order', async () => {
      mockCategoriesIsFresh = false;
      const { getByLabelText } = await renderScreen();

      await fireEvent.press(getByLabelText('Move Transport to top'));

      expect(mockReorder).not.toHaveBeenCalled();
    });

    it('persists a drag reorder through onGridDragEnd (only when the item actually moved)', async () => {
      const { getByTestId } = await renderScreen();

      // A release-in-place (fromIndex === toIndex) is a held-not-dragged gesture:
      // onGridDragEnd persists nothing.
      await act(async () => {
        getByTestId('sortable-grid').props.onDragEnd({
          key: 'transport',
          fromIndex: 2,
          toIndex: 2,
          indexToKey: keys,
        });
      });
      expect(mockReorder).not.toHaveBeenCalled();

      // A real move (fromIndex !== toIndex) persists the new front-to-back order.
      const reordered = ['transport', ...keys.filter((k) => k !== 'transport')];
      await act(async () => {
        getByTestId('sortable-grid').props.onDragEnd({
          key: 'transport',
          fromIndex: 2,
          toIndex: 0,
          indexToKey: reordered,
        });
      });
      expect(mockReorder).toHaveBeenCalledWith(reordered);
    });

    // Every card here wraps a live rename TextInput, unlike the accounts and
    // holdings grids. The library's default 200ms drag-activation is shorter
    // than iOS's own text-selection hold, so a hold meant to place the cursor
    // (or open Paste) started a card drag instead — this grid needs a delay
    // above that threshold (kiko-gestures).
    it('gives the categories grid a drag delay above the iOS text-selection threshold', async () => {
      const { getByTestId } = await renderScreen();

      const grid = getByTestId('sortable-grid');

      expect(grid.props.dragActivationDelay).toBeGreaterThanOrEqual(500);
    });
  });

  describe('localization', () => {
    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('shows the translated label for an un-renamed default under the Ukrainian catalog', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByDisplayValue, queryByDisplayValue } = await renderScreen();

      expect(getByDisplayValue('Продукти')).toBeTruthy();
      expect(queryByDisplayValue('Groceries')).toBeNull();
    });

    // The regression this guards against: pre-filling the editable field with
    // the TRANSLATED title would make an unedited (no-op) end-of-editing look
    // like a rename to that translated string, permanently un-translating the
    // row (its stored title would no longer match the English seed). Focusing
    // then blurring without typing anything must never call updateTitle.
    it('does not persist the translated label as a rename on an unedited (no-op) save', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText } = await renderScreen();

      const field = getByLabelText('Назва Продукти');
      await fireEvent(field, 'focus');
      await fireEvent(field, 'endEditing');

      expect(mockUpdateTitle).not.toHaveBeenCalled();
    });

    it('reverts to the translated label after a no-op focus/blur cycle', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText, getByDisplayValue } = await renderScreen();

      const field = getByLabelText('Назва Продукти');
      await fireEvent(field, 'focus');
      await fireEvent(field, 'endEditing');

      expect(getByDisplayValue('Продукти')).toBeTruthy();
    });

    // Every per-card accessibility label names the category as the user SEES
    // it — the translated default name, never the raw English seed title.
    it('names an un-renamed default by its translated title in every card accessibility label under uk', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText, queryByLabelText } = await renderScreen();

      for (const label of [
        'Змінити іконку Продукти',
        'Назва Продукти',
        'Зробити Продукти категорією за замовчуванням',
        'Видалити Продукти',
        'Перемістити Продукти нагору',
        'Перемістити Продукти вниз',
        'Інше — категорія за замовчуванням',
      ]) {
        expect(getByLabelText(label)).toBeTruthy();
      }

      expect(queryByLabelText(/Groceries|Other/)).toBeNull();
    });

    it('prefixes the per-card color swatches with the translated title under uk', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getAllByLabelText, queryAllByLabelText } = await renderScreen();

      expect(getAllByLabelText(/^Колір Продукти /).length).toBeGreaterThan(0);
      expect(queryAllByLabelText(/^Колір Groceries /)).toHaveLength(0);
    });

    it('titles the delete confirm sheet with the translated name under uk', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText, getByText, queryByText } = await renderScreen();

      await fireEvent.press(getByLabelText('Видалити Продукти'));

      expect(getByText('Видалити «Продукти»')).toBeTruthy();
      expect(queryByText('Видалити «Groceries»')).toBeNull();
    });

    it('keeps a renamed category verbatim in its accessibility labels and delete title under uk', async () => {
      mockLiveQueryData = mockLiveQueryData.map((category) =>
        category.key === 'groceries' ? { ...category, title: 'Овочі' } : category,
      );
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText, getByText } = await renderScreen();

      await fireEvent.press(getByLabelText('Видалити Овочі'));

      expect(getByText('Видалити «Овочі»')).toBeTruthy();
    });

    it('still renames a category via updateTitle when the field is actually edited under uk', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText } = await renderScreen();

      const field = getByLabelText('Назва Продукти');
      await fireEvent(field, 'focus');
      await fireEvent.changeText(field, 'Овочі');
      await fireEvent(field, 'endEditing');

      expect(mockUpdateTitle).toHaveBeenCalledWith('groceries', 'Овочі');
    });
  });
});

describe('CategoriesScreen — loading gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveQueryData = [];
    mockCategoriesIsLoading = true;
  });

  it('shows a loading spinner, not a blank list, while categories is on its first load', async () => {
    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('categories-loading')).toBeTruthy();
    expect(queryByTestId('sortable-grid')).toBeNull();
  });

  it('renders the real list once categories has loaded', async () => {
    mockCategoriesIsLoading = false;
    mockLiveQueryData = SEEDED_CATEGORIES.map((category) => ({ ...category }));

    const { getByDisplayValue, queryByTestId } = await renderScreen();

    expect(getByDisplayValue(SEEDED_CATEGORIES[0].title)).toBeTruthy();
    expect(queryByTestId('categories-loading')).toBeNull();
  });
});
