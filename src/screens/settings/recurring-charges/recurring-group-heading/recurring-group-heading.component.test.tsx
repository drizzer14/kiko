import { StyleSheet } from 'react-native';
import { render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import { glyphNamesWithin } from '@kiko/test-support/glyphs-within';
import { categoryColor } from '@kiko/statistics/category-breakdown';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

import RecurringGroupHeading from './recurring-group-heading.component';
import type { RecurringGroupHeadingProps as Props } from './recurring-group-heading.props';

const TOTAL = Money.of('UAH', 123456);

const propsOf = (overrides: Partial<Props> = {}): Props => ({
  title: 'Subscriptions',
  icon: 'play.rectangle.fill',
  color: categoryColor('subscriptions'),
  total: TOTAL,
  testID: 'recurring-charges-group-subscriptions',
  totalTestID: 'recurring-charges-group-total-subscriptions',
  ...overrides,
});

const LONG_TITLE =
  'A category title long enough that it has to wrap onto several lines of the heading';

describe('RecurringGroupHeading', () => {
  it('shows the category title, its icon tile and the total under their own testIDs', async () => {
    const { getByTestId } = await render(<RecurringGroupHeading {...propsOf()} />);
    const heading = getByTestId('recurring-charges-group-subscriptions');

    expect(within(heading).getByText('Subscriptions')).toBeTruthy();
    expect(within(heading).getByTestId('entity-icon-tile')).toBeTruthy();
    expect(glyphNamesWithin(heading)).toContain('play.rectangle.fill');
    expect(
      within(getByTestId('recurring-charges-group-total-subscriptions')).getByText(
        formatMoney(TOTAL),
      ),
    ).toBeTruthy();
  });

  it('puts the total opposite the title in one centered row', async () => {
    const { getByTestId } = await render(<RecurringGroupHeading {...propsOf()} />);
    const row = getByTestId('recurring-charges-group-subscriptions');
    const style = StyleSheet.flatten(row.props.style);

    expect(style.justifyContent).toBe('space-between');
    expect(style.alignItems).toBe('center');
    expect(style.flexDirection).toBe('row');
    expect(within(row).getByText('Subscriptions')).toBeTruthy();
    expect(within(row).getByText(formatMoney(TOTAL))).toBeTruthy();
  });

  it('lets a long title wrap in a flex 1 box and keeps the total in a box that never shrinks', async () => {
    const { getByText } = await render(
      <RecurringGroupHeading {...propsOf({ title: LONG_TITLE })} />,
    );
    const titleBox = ancestorWithStyle(getByText(LONG_TITLE), 'flex');
    const totalBox = ancestorWithStyle(getByText(formatMoney(TOTAL)), 'flexShrink');

    expect(StyleSheet.flatten(titleBox.props.style).flex).toBe(1);
    expect(StyleSheet.flatten(totalBox.props.style).flexShrink).toBe(0);
    expect(within(titleBox).queryByText(formatMoney(TOTAL))).toBeNull();
    expect(within(totalBox).queryByText(LONG_TITLE)).toBeNull();
  });

  it('is not pressable', async () => {
    const { getByTestId, queryAllByRole } = await render(<RecurringGroupHeading {...propsOf()} />);

    expect(queryAllByRole('button')).toHaveLength(0);
    expect(getByTestId('recurring-charges-group-subscriptions').props.onPress).toBeUndefined();
  });
});
