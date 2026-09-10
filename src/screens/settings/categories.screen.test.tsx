import { act, fireEvent, render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import '../../design-system/unistyles';
import { i18n } from '../../i18n';
import { SEEDED_CATEGORIES } from '../../repositories/__fixtures__/seeded-categories';
import { categoryColor } from '../../statistics/category-breakdown';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

import CategoriesScreen from './categories.screen';

const mockScrollToEnd = jest.fn();

// Override ONLY `useAnimatedRef` for this file so the animated ref the Screen
// hands its ScrollView exposes a spy-able `scrollToEnd` (the shared stub returns
// `{ current: null }`, which the optional chain would swallow). Everything else
// delegates to the shared reanimated stub (`jest/reanimated-mock`) so the rest
// of its surface — the shared values / animated style / animated `View` the
// transitively-imported `BottomSheet` uses, and the `default.createAnimatedComponent`
// gesture-handler's detector reads at import — stays intact. A function ref
// keeps its `.current` when React attaches the host node.
jest.mock('react-native-reanimated', () => {
  const stub = require('../../../jest/reanimated-mock');
  return new Proxy(stub, {
    get: (target, prop) =>
      prop === 'useAnimatedRef'
        ? () => Object.assign(() => undefined, { current: { scrollToEnd: mockScrollToEnd } })
        : target[prop],
  });
});

const mockUpdateTitle = jest.fn();
const mockUpdateIcon = jest.fn();
const mockUpdateColor = jest.fn();
const mockCreate = jest.fn();
const mockDelete = jest.fn();
const mockReorder = jest.fn();
const mockSetDefault = jest.fn();
const mockOpenDeleteMenu = jest.fn();
let mockLiveQueryData: Array<{ key: string; title: string; icon: string; color?: string | null }> =
  [];
let mockSettingsRows: Array<{ defaultCategoryKey: string }> = [];

jest.mock('../../repositories/categories.repo', () => ({
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
jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setDefaultCategoryKey: (...args: unknown[]) => mockSetDefault(...args),
  },
}));
// The delete confirm routes through the shared native action sheet
// (`openDeleteMenu`), unit-tested on its own; here it is mocked so the screen
// test can assert the wiring — the category title and the delete callback —
// without presenting a real sheet.
jest.mock('../grid-interaction', () => ({
  ...jest.requireActual('../grid-interaction'),
  openDeleteMenu: (...args: unknown[]) => mockOpenDeleteMenu(...args),
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (_query: unknown, keys: string[]) =>
    keys?.[0] === 'settings' ? { data: mockSettingsRows } : { data: mockLiveQueryData },
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
  });

  it('lists every seeded category by its title', async () => {
    const { getByDisplayValue } = await renderScreen();

    for (const category of SEEDED_CATEGORIES) {
      expect(getByDisplayValue(category.title)).toBeTruthy();
    }
  });

  it('renders each category as its own card, plus one trailing add-category card', async () => {
    const { getAllByTestId, getByTestId } = await renderScreen();

    // One GlassSurface card per category — not a single shared surface housing
    // every row.
    expect(getAllByTestId('category-card')).toHaveLength(SEEDED_CATEGORIES.length);
    // The add-category affordance is its own trailing card in the same stack.
    expect(getByTestId('add-category-card')).toBeTruthy();
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

  it('reveals the inline add-category form when the add row is tapped', async () => {
    const { getByLabelText, queryByLabelText } = await renderScreen();

    // The name field is absent until the collapsed "Add category" row is tapped.
    expect(queryByLabelText('Name')).toBeNull();

    await fireEvent.press(getByLabelText('Add category'));

    expect(getByLabelText('Name')).toBeTruthy();
  });

  it('auto-focuses the name field when the add-category form is revealed', async () => {
    const { getByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText('Add category'));

    // The freshly mounted name field grabs focus on mount, so the keyboard opens
    // straight onto it.
    expect(getByLabelText('Name').props.autoFocus).toBe(true);
  });

  it('scrolls the ScrollView to the newly revealed form when the add row expands', async () => {
    // The scroll is deferred to the next frame so the just-revealed fields are
    // measured first; run that frame synchronously to assert the effect.
    const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    const { getByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText('Add category'));

    expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: true });

    rafSpy.mockRestore();
  });

  it('creates a category via categoriesRepo.create and clears the form after saving', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText('Add category'));
    await fireEvent.changeText(getByLabelText('Name'), 'Travel');
    await fireEvent.press(getByText('Save'));

    // The default icon seeds the new category until the user picks another, and
    // with no swatch tapped the color persists as null (the "not picked" state).
    expect(mockCreate).toHaveBeenCalledWith({
      title: 'Travel',
      icon: 'square.grid.2x2',
      color: null,
    });
    // The form collapses (clears) on a successful add.
    expect(queryByLabelText('Name')).toBeNull();
  });

  it('creates a category with the picked color when a swatch is tapped', async () => {
    const { getByLabelText, getByText } = await renderScreen();

    await fireEvent.press(getByLabelText('Add category'));
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

  it('does not create a category when the name is empty', async () => {
    const { getByLabelText, getByText } = await renderScreen();

    await fireEvent.press(getByLabelText('Add category'));
    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('collapses the add-category form (and writes nothing) when Cancel is pressed', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText('Add category'));
    // Enter a name, then back out — Cancel must be a real escape hatch.
    await fireEvent.changeText(getByLabelText('Name'), 'Travel');
    await fireEvent.press(getByText('Cancel'));

    // The form collapses back to the single "Add category" affordance...
    expect(queryByLabelText('Name')).toBeNull();
    expect(getByLabelText('Add category')).toBeTruthy();
    // ...without persisting anything.
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('offers an expanded curated icon pool covering common finance categories', async () => {
    const { getByLabelText, getAllByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText('Change Groceries icon'));

    // The 137-icon "Kiko" curation is offered at once.
    expect(getAllByLabelText(/^Choose icon /).length).toBeGreaterThan(40);

    // A spread of finance-relevant SF Symbols is present.
    for (const icon of [
      'cart',
      'fuelpump',
      'dollarsign',
      'percent',
      'building',
      'cup.and.saucer',
      'tshirt',
      'receipt',
    ]) {
      expect(getByLabelText(`Choose icon ${icon}`)).toBeTruthy();
    }
  });

  it('gives each card control a >=44pt touch target via the shared ghost Button (iOS HIG)', async () => {
    const { getByLabelText } = await renderScreen();

    // The set-default, delete, and both reorder controls are the shared compact
    // ghost Button, which holds the 44pt minimum touch target (H1 in the HIG
    // audit). A bare Pressable with only icon padding fell short.
    for (const label of [
      'Set Groceries as default',
      'Delete Groceries',
      'Move Transport to top',
      'Move Transport to bottom',
    ]) {
      const control = getByLabelText(label);
      expect(StyleSheet.flatten(control.props.style).minHeight).toBe(44);
    }
  });

  it('hides the delete control on the default category card and shows a filled star marker instead', async () => {
    const { queryByLabelText, getByLabelText } = await renderScreen();

    // `other` is the default: no delete, a filled star marker (`star.fill`)
    // instead — and the default card offers no "Set as default" either.
    expect(queryByLabelText('Delete Other')).toBeNull();
    // The marker is now tinted white (`textPrimary` = #FFFFFF, passed straight
    // through to the native glyph's tintColor), not the old muted gray.
    expect(getByLabelText('Other is the default category').props.tintColor).toBe('#FFFFFF');
    // A non-default category still offers delete (now at the card's bottom, as a
    // labelled "Delete" control).
    expect(getByLabelText('Delete Groceries')).toBeTruthy();
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

    // The delete affordance now carries a visible "Delete" text label — one per
    // non-default card ('other' is the default and shows no delete), not just an
    // icon.
    const nonDefaultCount = SEEDED_CATEGORIES.filter((category) => category.key !== 'other').length;
    expect(getAllByText('Delete')).toHaveLength(nonDefaultCount);
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

  it('confirms via the native action sheet before deleting, then deletes by key on confirm', async () => {
    const { getByLabelText } = await renderScreen();

    await fireEvent.press(getByLabelText('Delete Groceries'));

    // The confirm sheet is opened with the category's title; nothing is deleted yet.
    expect(mockOpenDeleteMenu).toHaveBeenCalledWith('Groceries', expect.any(Function));
    expect(mockDelete).not.toHaveBeenCalled();

    // Confirming (invoking the callback the sheet was handed) deletes by key.
    const onConfirm = mockOpenDeleteMenu.mock.calls[0][1] as () => void;
    onConfirm();

    expect(mockDelete).toHaveBeenCalledWith('groceries');
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

      const field = getByLabelText('Назва Groceries');
      await fireEvent(field, 'focus');
      await fireEvent(field, 'endEditing');

      expect(mockUpdateTitle).not.toHaveBeenCalled();
    });

    it('reverts to the translated label after a no-op focus/blur cycle', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText, getByDisplayValue } = await renderScreen();

      const field = getByLabelText('Назва Groceries');
      await fireEvent(field, 'focus');
      await fireEvent(field, 'endEditing');

      expect(getByDisplayValue('Продукти')).toBeTruthy();
    });

    it('still renames a category via updateTitle when the field is actually edited under uk', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByLabelText } = await renderScreen();

      const field = getByLabelText('Назва Groceries');
      await fireEvent(field, 'focus');
      await fireEvent.changeText(field, 'Овочі');
      await fireEvent(field, 'endEditing');

      expect(mockUpdateTitle).toHaveBeenCalledWith('groceries', 'Овочі');
    });
  });
});
