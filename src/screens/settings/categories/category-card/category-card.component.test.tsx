import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import { entityIconTileGradient } from '@kiko/design-system/entity-tint';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

import CategoryCard from './category-card.component';
import type { CategoryCardProps } from './category-card.props';

const CARD_COLOR = darkTheme.colors.entityColors.khaki;

const renderCard = (props: Partial<CategoryCardProps> = {}) =>
  render(
    <CategoryCard
      title="Groceries"
      icon="cart"
      color={CARD_COLOR}
      ruleCount={0}
      isDefault={false}
      onPress={jest.fn()}
      {...props}
    />,
  );

describe('CategoryCard', () => {
  it('shows the title with the number of rules under it', async () => {
    const { getByText } = await renderCard({ ruleCount: 3 });

    expect(getByText('Groceries')).toBeTruthy();
    expect(getByText('3 rules')).toBeTruthy();
  });

  it('says "1 rule" for a single rule', async () => {
    const { getByText } = await renderCard({ ruleCount: 1 });

    expect(getByText('1 rule')).toBeTruthy();
  });

  it('says "No rules" when the category has none', async () => {
    const { getByText, queryByText } = await renderCard({ ruleCount: 0 });

    expect(getByText('No rules')).toBeTruthy();
    expect(queryByText(/^0 rules/)).toBeNull();
  });

  it('marks the default category with a star symbol labelled Default, not with text', async () => {
    const defaultCard = await renderCard({ isDefault: true });

    expect(defaultCard.getByLabelText('Default').props.name).toBe('star.fill');
    expect(defaultCard.queryByText('Default')).toBeNull();
  });

  it('marks no other category', async () => {
    const otherCard = await renderCard({ isDefault: false });

    expect(otherCard.queryByLabelText('Default')).toBeNull();
    expect(otherCard.queryByText('Default')).toBeNull();
  });

  it('draws the category icon on a tile of its colour', async () => {
    const { getByTestId } = await renderCard();
    const [top, bottom] = entityIconTileGradient(CARD_COLOR);
    const glyphs = getByTestId('entity-icon-tile').queryAll((node) => node.props.name === 'cart');

    expect(glyphs.length).toBeGreaterThan(0);
    expect(getByTestId('entity-icon-tile-gradient-stop-top').props.stopColor).toBe(top);
    expect(getByTestId('entity-icon-tile-gradient-stop-bottom').props.stopColor).toBe(bottom);
  });

  it('calls onPress when the card is tapped', async () => {
    const onPress = jest.fn();
    const { getByText } = await renderCard({ onPress });

    await fireEvent.press(getByText('Groceries'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is one button for the screen reader, so the title and caption read together', async () => {
    const { getByRole } = await renderCard({ ruleCount: 2 });

    expect(getByRole('button')).toHaveTextContent(/Groceries/);
    expect(getByRole('button')).toHaveTextContent(/2 rules/);
  });

  it('wraps a long title in its own box instead of cutting it', async () => {
    const longTitle = 'A very long category name that has to wrap onto several lines to be read';
    const { getByText, getByLabelText } = await renderCard({ title: longTitle, isDefault: true });
    const title = getByText(longTitle);
    const titleBox = StyleSheet.flatten(ancestorWithStyle(title, 'flex').props.style);

    expect(title.props.numberOfLines).toBeUndefined();
    expect(titleBox.flex).toBe(1);
    expect(titleBox.flexDirection).toBeUndefined();
    expect(
      StyleSheet.flatten(ancestorWithStyle(getByLabelText('Default'), 'flexShrink').props.style)
        .flexShrink,
    ).toBe(0);
  });
});
