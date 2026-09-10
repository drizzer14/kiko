import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

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

describe('TrendFilterField action sizes', () => {
  it('renders the secondary Clear action as a compact button', async () => {
    const { getByTestId } = await renderField();
    await press(getByTestId(TEST_ID));

    // Clear is the lower-emphasis secondary action in the sheet action row, so
    // it takes the compact 44pt size rather than the tall regular Save size.
    const clear = getByTestId(`${TEST_ID}-clear`);

    expect(StyleSheet.flatten(clear.props.style).minHeight).toBe(44);
    expect(StyleSheet.flatten(clear.props.style).width).toBeUndefined();
  });

  it('keeps the primary Save action at the regular size', async () => {
    const { getByTestId } = await renderField();
    await press(getByTestId(TEST_ID));

    const save = getByTestId(`${TEST_ID}-save`);

    expect(StyleSheet.flatten(save.props.style).minHeight).toBe(50);
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
    const { getByTestId, getByRole, queryByText } = await renderField({
      filter: { mode: 'top', amount: 3, by: 'contribution' },
    });
    await press(getByTestId(TEST_ID));

    // Change the amount to 5, then Clear.
    await press(getByRole('button', { name: '5' }));
    await press(getByTestId(`${TEST_ID}-clear`));

    // The sheet stays open, the draft is reverted to the saved amount (3), and
    // Save is disabled again because the draft now matches the applied filter.
    expect(queryByText('Filters')).toBeTruthy();
    expect(getByRole('button', { name: '3' }).props.accessibilityState.selected).toBe(true);
    expect(getByRole('button', { name: '5' }).props.accessibilityState.selected).toBe(false);
    expect(getByTestId(`${TEST_ID}-save`)).toBeDisabled();
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

describe('TrendFilterField Save disabling', () => {
  it('disables Save while the draft still matches the applied filter', async () => {
    const { getByTestId } = await renderField({
      filter: { mode: 'top', amount: 3, by: 'contribution' },
    });
    await press(getByTestId(TEST_ID));

    expect(getByTestId(`${TEST_ID}-save`)).toBeDisabled();
  });

  it('enables Save once the top amount is changed', async () => {
    const { getByTestId, getByRole } = await renderField({
      filter: { mode: 'top', amount: 3, by: 'contribution' },
    });
    await press(getByTestId(TEST_ID));

    await press(getByRole('button', { name: '5' }));

    expect(getByTestId(`${TEST_ID}-save`)).not.toBeDisabled();
  });

  it('disables Save again once the change is reverted', async () => {
    const { getByTestId, getByRole } = await renderField({
      filter: { mode: 'top', amount: 3, by: 'contribution' },
    });
    await press(getByTestId(TEST_ID));

    await press(getByRole('button', { name: '5' }));
    await press(getByRole('button', { name: '3' }));

    expect(getByTestId(`${TEST_ID}-save`)).toBeDisabled();
  });

  it('enables Save once a manual category is toggled', async () => {
    const { getByTestId } = await renderField({ filter: { mode: 'manual', keys: [] } });
    await press(getByTestId(TEST_ID));

    expect(getByTestId(`${TEST_ID}-save`)).toBeDisabled();

    await press(getByTestId(`${TEST_ID}-option-groceries`));

    expect(getByTestId(`${TEST_ID}-save`)).not.toBeDisabled();
  });
});

describe('TrendFilterField selected manual row', () => {
  it('raises a filled background on the selected row and keeps an unselected row transparent', async () => {
    const { getByTestId } = await renderField({ filter: { mode: 'manual', keys: ['groceries'] } });
    await press(getByTestId(TEST_ID));

    const selected = getByTestId(`${TEST_ID}-option-groceries`);
    const unselected = getByTestId(`${TEST_ID}-option-transport`);

    // The selected row carries a filled surface background; the unselected row
    // paints none, so the two read as distinct levels at a glance.
    expect(selected.props.accessibilityState.checked).toBe(true);
    expect(unselected.props.accessibilityState.checked).toBe(false);
    expect(StyleSheet.flatten(selected.props.style).backgroundColor).toBeTruthy();
    expect(StyleSheet.flatten(unselected.props.style).backgroundColor).toBeUndefined();
  });
});
