import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import { SEEDED_CATEGORIES } from '../../repositories/__fixtures__/seeded-categories';
import CategoriesScreen from './categories.screen';

const mockUpdateTitle = jest.fn();
const mockUpdateIcon = jest.fn();
let mockLiveQueryData: Array<{ key: string; title: string; icon: string }> = [];

jest.mock('../../repositories/categories.repo', () => ({
  categoriesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
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
    mockLiveQueryData = SEEDED_CATEGORIES.map(category => ({ ...category }));
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

  it('changes a category icon via updateIcon when a curated icon is chosen', async () => {
    const { getByLabelText } = await render(<CategoriesScreen />);

    await fireEvent.press(getByLabelText('Change Groceries icon'));
    await fireEvent.press(getByLabelText('Choose icon basket'));

    expect(mockUpdateIcon).toHaveBeenCalledWith('groceries', 'basket');
  });

  it('offers a fixed curated icon set (not a free-text field) in the picker', async () => {
    const { getByLabelText, queryByPlaceholderText } = await render(<CategoriesScreen />);

    await fireEvent.press(getByLabelText('Change Groceries icon'));

    // Curated options are rendered as pressable choices, not a typed input.
    expect(getByLabelText('Choose icon cart')).toBeTruthy();
    expect(queryByPlaceholderText(/icon/i)).toBeNull();
  });

  it('shows an edit affordance on every category icon so it reads as tappable', async () => {
    const { getAllByTestId } = await render(<CategoriesScreen />);

    // Every row surfaces the pencil edit badge overlay, one per category, so
    // the icon is visibly editable at rest without opening the picker first.
    expect(getAllByTestId('category-icon-edit-badge')).toHaveLength(SEEDED_CATEGORIES.length);
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
