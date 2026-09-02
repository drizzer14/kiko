import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { SEEDED_CATEGORIES } from '../../repositories/__fixtures__/seeded-categories';
import CategoriesScreen from './categories.screen';

const mockUpdateTitle = jest.fn();
const mockUpdateIcon = jest.fn();
const mockCreate = jest.fn();
let mockLiveQueryData: Array<{ key: string; title: string; icon: string }> = [];

jest.mock('../../repositories/categories.repo', () => ({
  categoriesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    create: (...args: unknown[]) => mockCreate(...args),
    updateTitle: (...args: unknown[]) => mockUpdateTitle(...args),
    updateIcon: (...args: unknown[]) => mockUpdateIcon(...args),
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

  it('creates a category via categoriesRepo.create and clears the form after saving', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await render(<CategoriesScreen />);

    await fireEvent.press(getByLabelText('Add category'));
    await fireEvent.changeText(getByLabelText('Name'), 'Travel');
    await fireEvent.press(getByText('Save'));

    // The default icon seeds the new category until the user picks another.
    expect(mockCreate).toHaveBeenCalledWith({ title: 'Travel', icon: 'square.grid.2x2' });
    // The form collapses (clears) on a successful add.
    expect(queryByLabelText('Name')).toBeNull();
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

    // The pool grew well beyond the original 20-icon set.
    expect(getAllByLabelText(/^Choose icon /).length).toBeGreaterThan(40);

    // A spread of the newly added, finance-relevant SF Symbols is present,
    // alongside every original seed icon.
    for (const icon of [
      'cart',
      'fuelpump',
      'graduationcap',
      'dollarsign.circle',
      'chart.line.uptrend.xyaxis',
      'building.columns',
      'cup.and.saucer',
      'tshirt',
    ]) {
      expect(getByLabelText(`Choose icon ${icon}`)).toBeTruthy();
    }
  });
});
