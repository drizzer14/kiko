import { act, fireEvent, render } from '@testing-library/react-native';

import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';
import type { FilterOption } from '../../home/filter-menu/filter-menu.props';

import TrendFilterField from './trend-filter-field.component';

const CATEGORY_OPTIONS: FilterOption[] = [
  { value: 'groceries', label: 'Groceries', icon: 'cart', color: '#111111' },
  { value: 'transport', label: 'Transport', icon: 'car', color: '#222222' },
  { value: 'salary', label: 'Salary', icon: 'banknote', color: '#333333' },
];

const TEST_ID = 'statistics-trend-filter';

const renderField = (
  props: Partial<React.ComponentProps<typeof TrendFilterField>> = {},
): ReturnType<typeof render> =>
  render(
    <TrendFilterField
      testID={TEST_ID}
      filter={{ mode: 'top', amount: 3, by: 'contribution' }}
      categoryOptions={CATEGORY_OPTIONS}
      onSave={() => {}}
      {...props}
    />,
  );

const press = async (node: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(node);
  });
};

const setLanguage = async (language: string): Promise<void> => {
  await act(async () => {
    await i18n.changeLanguage(language);
  });
};

afterEach(async () => {
  await setLanguage('en');
});

describe('TrendFilterField button label', () => {
  it('reads "Top N by <measure>" in top mode', async () => {
    const { getByTestId } = await renderField({
      filter: { mode: 'top', amount: 3, by: 'contribution' },
    });

    expect(getByTestId(TEST_ID)).toHaveTextContent('Top 3 by Contribution');
  });

  it('uses the singular in manual mode with one category', async () => {
    const { getByTestId } = await renderField({ filter: { mode: 'manual', keys: ['groceries'] } });

    expect(getByTestId(TEST_ID)).toHaveTextContent('1 Category');
  });

  it('uses the plural in manual mode with several categories', async () => {
    const { getByTestId } = await renderField({
      filter: { mode: 'manual', keys: ['groceries', 'transport', 'salary'] },
    });

    expect(getByTestId(TEST_ID)).toHaveTextContent('3 Categories');
  });

  it('reads "All Categories" for an empty manual selection', async () => {
    const { getByTestId } = await renderField({ filter: { mode: 'manual', keys: [] } });

    expect(getByTestId(TEST_ID)).toHaveTextContent('All Categories');
  });

  it('renders the three Ukrainian plural forms for the manual count', async () => {
    await setLanguage('uk');

    expect(
      (await renderField({ filter: { mode: 'manual', keys: ['a'] } })).getByTestId(TEST_ID),
    ).toHaveTextContent('1 Категорія');
    expect(
      (await renderField({ filter: { mode: 'manual', keys: ['a', 'b'] } })).getByTestId(TEST_ID),
    ).toHaveTextContent('2 Категорії');
    expect(
      (
        await renderField({ filter: { mode: 'manual', keys: ['a', 'b', 'c', 'd', 'e'] } })
      ).getByTestId(TEST_ID),
    ).toHaveTextContent('5 Категорій');
  });

  it('interpolates the Ukrainian instrumental measure into the top label', async () => {
    await setLanguage('uk');
    const { getByTestId } = await renderField({ filter: { mode: 'top', amount: 3, by: 'rising' } });

    expect(getByTestId(TEST_ID)).toHaveTextContent('Топ 3 за Зростанням');
  });
});

describe('TrendFilterField sheet', () => {
  it('opens the sheet on the button press', async () => {
    const { getByTestId, queryByText } = await renderField();
    expect(queryByText('Filters')).toBeNull();

    await press(getByTestId(TEST_ID));

    expect(queryByText('Filters')).toBeTruthy();
  });

  it('switches between Manual and Top, showing the mode-specific controls', async () => {
    const { getByTestId, getByText, queryByText } = await renderField();
    await press(getByTestId(TEST_ID));

    // Top mode by default: the Amount + By controls are shown.
    expect(queryByText('Amount')).toBeTruthy();
    expect(queryByText('By')).toBeTruthy();
    expect(queryByText('Groceries')).toBeNull();

    await press(getByText('Manual'));

    // Manual mode: the category rows are shown, the Amount/By controls hidden.
    expect(queryByText('Amount')).toBeNull();
    expect(queryByText('Groceries')).toBeTruthy();

    await press(getByText('Top'));

    expect(queryByText('Amount')).toBeTruthy();
    expect(queryByText('Groceries')).toBeNull();
  });

  it('reverts the draft to the saved filter on Clear without closing', async () => {
    const onSave = jest.fn();
    const { getByTestId, getByRole, queryByText } = await renderField({
      filter: { mode: 'top', amount: 3, by: 'contribution' },
      onSave,
    });
    await press(getByTestId(TEST_ID));

    // Change the amount to 5, then Clear.
    await press(getByRole('button', { name: '5' }));
    await press(getByTestId(`${TEST_ID}-clear`));

    // The sheet stays open, and Save now persists the reverted (saved) value.
    expect(queryByText('Filters')).toBeTruthy();
    await press(getByTestId(`${TEST_ID}-save`));

    expect(onSave).toHaveBeenCalledWith({ mode: 'top', amount: 3, by: 'contribution' });
  });

  it('persists the edited filter and closes on Save', async () => {
    const onSave = jest.fn();
    const { getByTestId, getByText, queryByText } = await renderField({
      filter: { mode: 'top', amount: 3, by: 'contribution' },
      onSave,
    });
    await press(getByTestId(TEST_ID));

    await press(getByText('Manual'));
    await press(getByTestId(`${TEST_ID}-option-groceries`));
    await press(getByTestId(`${TEST_ID}-save`));

    expect(onSave).toHaveBeenCalledWith({ mode: 'manual', keys: ['groceries'] });
    expect(queryByText('Filters')).toBeNull();
  });

  it('discards unsaved edits when dismissed', async () => {
    const onSave = jest.fn();
    const { getByTestId, getByRole, queryByText } = await renderField({
      filter: { mode: 'top', amount: 3, by: 'contribution' },
      onSave,
    });
    await press(getByTestId(TEST_ID));
    await press(getByRole('button', { name: '5' }));

    // Dismiss via the backdrop; nothing is saved.
    await press(getByTestId(`${TEST_ID}-backdrop`));
    expect(onSave).not.toHaveBeenCalled();
    expect(queryByText('Filters')).toBeNull();

    // Reopening shows the saved amount (3), not the discarded edit (5).
    await press(getByTestId(TEST_ID));
    expect(getByRole('button', { name: '3' }).props.accessibilityState.selected).toBe(true);
    expect(getByRole('button', { name: '5' }).props.accessibilityState.selected).toBe(false);
  });
});
