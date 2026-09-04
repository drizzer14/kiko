import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
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
});
