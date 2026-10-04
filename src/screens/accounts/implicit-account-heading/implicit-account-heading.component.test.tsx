import { StyleSheet } from 'react-native';
import { act, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import { accountKindSymbol } from '@kiko/holdings/entity-symbols';
import { defaultAccountColor } from '@kiko/holdings/entity-colors';
import { entityIconTileGradient } from '@kiko/design-system/entity-tint';
import { glyphNamesWithin } from '@kiko/test-support/glyph-names-within';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

import ImplicitAccountHeading from '.';
import type { ImplicitAccountHeadingProps } from './implicit-account-heading.props';

type HeadingAccount = ImplicitAccountHeadingProps['account'];

const propertyAccount = (over: Partial<HeadingAccount> = {}): HeadingAccount => ({
  name: 'Properties',
  kind: 'property',
  archivedAt: null,
  icon: null,
  color: null,
  ...over,
});

const debtAccount = (over: Partial<HeadingAccount> = {}): HeadingAccount => ({
  name: 'Loans',
  kind: 'debt',
  archivedAt: null,
  icon: null,
  color: null,
  ...over,
});

const element = (account: HeadingAccount) => (
  <ImplicitAccountHeading account={account} testID="heading" />
);

describe('ImplicitAccountHeading', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  describe('the name', () => {
    it.each([
      ['property', propertyAccount(), 'Properties'],
      ['debt', debtAccount(), 'Loans'],
    ])(
      'shows the localized default %s name while it is unrenamed',
      async (_kind, account, name) => {
        const { getByTestId } = await render(element(account));

        expect(within(getByTestId('heading')).getByText(name)).toBeTruthy();
      },
    );

    it.each([
      ['property', propertyAccount(), 'Майно'],
      ['debt', debtAccount(), 'Кредити'],
    ])('shows the Ukrainian default %s name in uk', async (_kind, account, name) => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      const { getByTestId } = await render(element(account));

      expect(within(getByTestId('heading')).getByText(name)).toBeTruthy();
    });

    it('follows a language switch while the account stays unrenamed', async () => {
      const { getByTestId } = await render(element(propertyAccount()));

      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      expect(within(getByTestId('heading')).getByText('Майно')).toBeTruthy();
      expect(within(getByTestId('heading')).queryByText('Properties')).toBeNull();
    });

    it('shows the typed name after a rename, in either language', async () => {
      const { getByTestId, rerender } = await render(element(propertyAccount()));

      await rerender(element(propertyAccount({ name: 'Real estate' })));

      expect(within(getByTestId('heading')).getByText('Real estate')).toBeTruthy();
      expect(within(getByTestId('heading')).queryByText('Properties')).toBeNull();

      await act(async () => {
        await i18n.changeLanguage('uk');
      });

      expect(within(getByTestId('heading')).getByText('Real estate')).toBeTruthy();
    });

    it('never shows the old fixed Property or Debts heading text', async () => {
      const property = await render(element(propertyAccount()));
      const debt = await render(element(debtAccount()));

      expect(property.queryByText('Property')).toBeNull();
      expect(debt.queryByText('Debts')).toBeNull();
    });
  });

  // A long name wraps beside the tile inside the width the section total
  // leaves, as the account card's name does; Jest cannot lay out pixels, so
  // this pins the style contract that card wraps with.
  it('lets a long name wrap in the width the tile leaves, with no truncation', async () => {
    const longName = 'Спільне майно для сімейних заощаджень та довгострокових вкладень';
    const { getByText, getByTestId } = await render(element(propertyAccount({ name: longName })));
    const title = getByText(longName);
    const nameBox = StyleSheet.flatten(ancestorWithStyle(title, 'flex').props.style);

    expect(title.props.numberOfLines).toBeUndefined();
    expect(nameBox.flex).toBe(1);
    expect(nameBox.flexDirection).toBeUndefined();
    const rootStyle = StyleSheet.flatten(getByTestId('heading').props.style);
    expect(rootStyle.flex).toBe(1);
    expect(rootStyle.flexDirection).toBe('row');
    // A short name still centers beside the tile.
    expect(rootStyle.alignItems).toBe('center');
  });

  describe('the squircle tile', () => {
    const tileOf = (utils: Awaited<ReturnType<typeof render>>) =>
      within(utils.getByTestId('heading')).getByTestId('entity-icon-tile');

    it('is the compact tile, one step smaller than the card tile', async () => {
      const utils = await render(element(propertyAccount()));

      expect(StyleSheet.flatten(tileOf(utils).props.style)).toMatchObject({
        width: darkTheme.spacing(8),
        height: darkTheme.spacing(8),
      });
    });

    it('draws the stored icon', async () => {
      const utils = await render(element(propertyAccount({ icon: 'building.2' })));

      expect(glyphNamesWithin(tileOf(utils))).toEqual(['building.2']);
    });

    it.each([
      ['property', propertyAccount(), accountKindSymbol.property],
      ['debt', debtAccount(), accountKindSymbol.debt],
    ])('draws the %s kind glyph when no icon is stored', async (_kind, account, glyph) => {
      const utils = await render(element(account));

      expect(glyphNamesWithin(tileOf(utils))).toEqual([glyph]);
    });

    it('takes its gradient from the account color', async () => {
      const utils = await render(
        element(propertyAccount({ color: darkTheme.colors.entityColors.blue })),
      );

      const [top, bottom] = entityIconTileGradient(darkTheme.colors.entityColors.blue);
      expect(utils.getByTestId('entity-icon-tile-gradient-stop-top').props.stopColor).toBe(top);
      expect(utils.getByTestId('entity-icon-tile-gradient-stop-bottom').props.stopColor).toBe(
        bottom,
      );
    });

    it.each([
      ['null', null],
      ['an empty string', ''],
    ])('takes the kind default color when the stored color is %s', async (_label, color) => {
      const utils = await render(element(debtAccount({ color })));

      const [top, bottom] = entityIconTileGradient(defaultAccountColor.debt);
      expect(utils.getByTestId('entity-icon-tile-gradient-stop-top').props.stopColor).toBe(top);
      expect(utils.getByTestId('entity-icon-tile-gradient-stop-bottom').props.stopColor).toBe(
        bottom,
      );
    });

    it('follows an icon and color change of the account', async () => {
      const utils = await render(element(propertyAccount()));

      await utils.rerender(
        element(propertyAccount({ icon: 'house.fill', color: darkTheme.colors.entityColors.blue })),
      );

      expect(glyphNamesWithin(tileOf(utils))).toEqual(['house.fill']);
      const [top] = entityIconTileGradient(darkTheme.colors.entityColors.blue);
      expect(utils.getByTestId('entity-icon-tile-gradient-stop-top').props.stopColor).toBe(top);
    });

    // The name beside it already reads out, so the tile adds no second label
    // (the Settings > Reminders heading does the same).
    it('adds no accessibility label of its own', async () => {
      const utils = await render(element(propertyAccount()));

      expect(utils.queryByLabelText(/icon/i)).toBeNull();
    });
  });
});
