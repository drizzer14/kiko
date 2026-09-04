import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { SEEDED_CATEGORIES } from '../../repositories/__fixtures__/seeded-categories';
import CategoriesScreen from './categories.screen';

const mockScrollToEnd = jest.fn();

// Override the suite-wide reanimated stub for this file so the animated ref the
// Screen hands its ScrollView exposes a spy-able `scrollToEnd` — the global mock
// returns `{ current: null }`, which the optional chain would swallow. A
// function ref keeps its `.current` when React attaches the host node.
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  useAnimatedRef: () =>
    Object.assign(() => undefined, { current: { scrollToEnd: mockScrollToEnd } }),
}));

const mockUpdateTitle = jest.fn();
const mockUpdateIcon = jest.fn();
const mockUpdateColor = jest.fn();
const mockCreate = jest.fn();
let mockLiveQueryData: Array<{ key: string; title: string; icon: string; color?: string | null }> =
  [];

jest.mock('../../repositories/categories.repo', () => ({
  categoriesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    create: (...args: unknown[]) => mockCreate(...args),
    updateTitle: (...args: unknown[]) => mockUpdateTitle(...args),
    updateIcon: (...args: unknown[]) => mockUpdateIcon(...args),
    updateColor: (...args: unknown[]) => mockUpdateColor(...args),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockLiveQueryData }),
}));

describe('CategoriesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveQueryData = SEEDED_CATEGORIES.map((category) => ({ ...category }));
  });

  it('lists every seeded category by its title', async () => {
    const { getByDisplayValue } = await render(<CategoriesScreen />);

    for (const category of SEEDED_CATEGORIES) {
      expect(getByDisplayValue(category.title)).toBeTruthy();
    }
  });

  it('renders each category as its own card, plus one trailing add-category card', async () => {
    const { getAllByTestId, getByTestId } = await render(<CategoriesScreen />);

    // One GlassSurface card per category — not a single shared surface housing
    // every row.
    expect(getAllByTestId('category-card')).toHaveLength(SEEDED_CATEGORIES.length);
    // The add-category affordance is its own trailing card in the same stack.
    expect(getByTestId('add-category-card')).toBeTruthy();
  });

  it('renames a category via updateTitle and shows the new title in the field', async () => {
    const { getByLabelText, getByDisplayValue } = await render(<CategoriesScreen />);

    const field = getByLabelText('Groceries title');
    await fireEvent.changeText(field, 'Food');
    await fireEvent(field, 'endEditing');

    expect(mockUpdateTitle).toHaveBeenCalledWith('groceries', 'Food');
    expect(getByDisplayValue('Food')).toBeTruthy();
  });

  it('does not call updateTitle when the trimmed new title is empty', async () => {
    const { getByLabelText } = await render(<CategoriesScreen />);

    const field = getByLabelText('Dining title');
    await fireEvent.changeText(field, '   ');
    await fireEvent(field, 'endEditing');

    expect(mockUpdateTitle).not.toHaveBeenCalled();
  });

  it('opens the icon picker modal when a category icon is tapped', async () => {
    const { getByLabelText, queryByLabelText } = await render(<CategoriesScreen />);

    // The modal — and its options — is absent until the icon chip is tapped.
    expect(queryByLabelText('Choose icon basket')).toBeNull();

    await fireEvent.press(getByLabelText('Change Groceries icon'));

    expect(getByLabelText('Choose icon basket')).toBeTruthy();
  });

  it('changes a category icon via updateIcon and closes the modal when a curated icon is chosen', async () => {
    const { getByLabelText, queryByLabelText } = await render(<CategoriesScreen />);

    await fireEvent.press(getByLabelText('Change Groceries icon'));
    await fireEvent.press(getByLabelText('Choose icon basket'));

    expect(mockUpdateIcon).toHaveBeenCalledWith('groceries', 'basket');
    // Selecting dismisses the modal, so its options are gone.
    expect(queryByLabelText('Choose icon basket')).toBeNull();
  });

  it('closes the modal on cancel without changing the icon', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await render(<CategoriesScreen />);

    await fireEvent.press(getByLabelText('Change Groceries icon'));
    await fireEvent.press(getByText('Cancel'));

    expect(mockUpdateIcon).not.toHaveBeenCalled();
    expect(queryByLabelText('Choose icon basket')).toBeNull();
  });

  it('offers a fixed curated icon set (not a free-text field) in the picker', async () => {
    const { getByLabelText, queryByPlaceholderText } = await render(<CategoriesScreen />);

    await fireEvent.press(getByLabelText('Change Groceries icon'));

    // Curated options are rendered as pressable choices, not a typed input.
    expect(getByLabelText('Choose icon cart')).toBeTruthy();
    expect(queryByPlaceholderText(/icon/i)).toBeNull();
  });

  it('no longer overlays a pencil edit badge on the category icons', async () => {
    const { queryAllByTestId } = await render(<CategoriesScreen />);

    // The bordered icon chip is now the sole edit affordance; the overlaid
    // pencil badge was removed.
    expect(queryAllByTestId('category-icon-edit-badge')).toHaveLength(0);
  });

  it('reveals the inline add-category form when the add row is tapped', async () => {
    const { getByLabelText, queryByLabelText } = await render(<CategoriesScreen />);

    // The name field is absent until the collapsed "Add category" row is tapped.
    expect(queryByLabelText('Name')).toBeNull();

    await fireEvent.press(getByLabelText('Add category'));

    expect(getByLabelText('Name')).toBeTruthy();
  });

  it('auto-focuses the name field when the add-category form is revealed', async () => {
    const { getByLabelText } = await render(<CategoriesScreen />);

    await fireEvent.press(getByLabelText('Add category'));

    // The freshly mounted name field grabs focus on mount, so the keyboard opens
    // straight onto it.
    expect(getByLabelText('Name').props.autoFocus).toBe(true);
  });

  it('scrolls the ScrollView to the newly revealed form when the add row expands', async () => {
    // The scroll is deferred to the next frame so the just-revealed fields are
    // measured first; run that frame synchronously to assert the effect.
    const rafSpy = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    const { getByLabelText } = await render(<CategoriesScreen />);

    await fireEvent.press(getByLabelText('Add category'));

    expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: true });

    rafSpy.mockRestore();
  });

  it('creates a category via categoriesRepo.create and clears the form after saving', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await render(<CategoriesScreen />);

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
    const { getByLabelText, getByText } = await render(<CategoriesScreen />);

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
    const { getByLabelText } = await render(<CategoriesScreen />);

    // Each row's picker prefixes its swatch labels with the category title, so
    // the Groceries row's yellow swatch is addressable on its own.
    await fireEvent.press(getByLabelText('Groceries color yellow'));

    expect(mockUpdateColor).toHaveBeenCalledWith('groceries', expect.stringMatching(/^#/));
  });

  it('does not create a category when the name is empty', async () => {
    const { getByLabelText, getByText } = await render(<CategoriesScreen />);

    await fireEvent.press(getByLabelText('Add category'));
    await fireEvent.changeText(getByLabelText('Name'), '   ');
    await fireEvent.press(getByText('Save'));

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('collapses the add-category form (and writes nothing) when Cancel is pressed', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await render(<CategoriesScreen />);

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
    const { getByLabelText, getAllByLabelText } = await render(<CategoriesScreen />);

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
});
