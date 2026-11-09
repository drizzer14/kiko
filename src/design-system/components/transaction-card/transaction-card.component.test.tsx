import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { Money } from '@kiko/currency/money';
import {
  registerLightThemeFirst,
  restoreThemeOrder,
} from '@kiko/test-support/light-theme-registered';
import { markColor } from '@kiko/design-system/entity-tint';
import { darkTheme, lightTheme } from '@kiko/design-system/theme';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

import TransactionCard from '.';

// MoneyText's own tone->color resolution (context + sign -> positive/
// negative/textPrimary) is exhaustively covered by `money-text.component.test.tsx`
// — this only needs to prove TransactionCard wires it the "transaction"
// context Home's TransactionRow does, so a positive amount resolves to the
// income (green/positive) tone same as Home. `Text`'s own tone->color
// variant is stripped by the project's Jest unistyles mock (see MoneyText's
// own test file's comment), so this mocks MoneyText itself, exposing the
// resolved context/sign via testID, the same technique.
jest.mock('@kiko/design-system/components/money-text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ money, context }: { money: { minorUnits: number }; context?: string }) => (
      <RNText testID={`money-context-${context}-sign-${Math.sign(money.minorUnits)}`}>
        {money.minorUnits}
      </RNText>
    ),
  };
});

describe('TransactionCard', () => {
  // An income preview row shows the description as its
  // title, the category icon, and the income (positive/green) color — the
  // same as Home's own TransactionRow (verified here by the "transaction"
  // context + positive sign combination MoneyText resolves to `positive`).
  it('shows the title, category icon, and the income color for a positive amount', async () => {
    const { getByText, getByTestId, toJSON } = await render(
      <TransactionCard
        title="Salary"
        categoryIcon="banknote"
        categoryIconColor="#C8A951"
        categoryAccessibilityLabel="Income"
        money={Money.of('UAH', 50_000)}
      />,
    );

    expect(getByText('Salary')).toBeTruthy();
    // The mocked SFSymbolView forwards `name` to a host View, so the glyph
    // name appears in the rendered tree.
    expect(JSON.stringify(toJSON())).toContain('banknote');
    expect(getByTestId('money-context-transaction-sign-1')).toBeTruthy();
  });

  it('renders no footer row when neither footer prop is given', async () => {
    const { queryByText } = await render(
      <TransactionCard
        title="Coffee"
        categoryIcon="cup.and.saucer"
        categoryIconColor="#8E44AD"
        categoryAccessibilityLabel="Dining"
        money={Money.of('UAH', -1_000)}
      />,
    );

    expect(queryByText('Dining')).toBeNull();
  });

  it('renders the footer meta and trailing captions when given', async () => {
    const { getByText } = await render(
      <TransactionCard
        title="Coffee"
        categoryIcon="cup.and.saucer"
        categoryIconColor="#8E44AD"
        categoryAccessibilityLabel="Dining"
        money={Money.of('UAH', -1_000)}
        footerMeta="Monobank · Dining"
        footerTrailing="14:32"
      />,
    );

    expect(getByText('Monobank · Dining')).toBeTruthy();
    expect(getByText('14:32')).toBeTruthy();
  });

  it('shows a loan-link marker glyph in the footer when loanLinked is true', async () => {
    const { toJSON } = await render(
      <TransactionCard
        title="Loan payment"
        categoryIcon="banknote"
        categoryIconColor="#8E44AD"
        categoryAccessibilityLabel="Debt"
        money={Money.of('UAH', -1_000)}
        footerMeta="Debts · Loan payment"
        loanLinked
      />,
    );

    expect(JSON.stringify(toJSON())).toContain('link');
  });

  it('centres the loan-link marker with the footer caption on one line', async () => {
    const { getByText } = await render(
      <TransactionCard
        title="Loan payment"
        categoryIcon="banknote"
        categoryIconColor="#8E44AD"
        categoryAccessibilityLabel="Debt"
        money={Money.of('UAH', -1_000)}
        footerMeta="Debts · Loan payment"
        loanLinked
      />,
    );

    // The meta box is the nearest ancestor with `flex: 1`; it holds the icon and the caption.
    const meta = ancestorWithStyle(getByText('Debts · Loan payment'), 'flex');

    expect(StyleSheet.flatten(meta.props.style)).toMatchObject({
      flexDirection: 'row',
      alignItems: 'center',
    });
  });

  it('takes the accent fill only when selected', async () => {
    const fillOf = async (selected?: boolean) => {
      const { getByTestId } = await render(
        <TransactionCard
          title="Coffee"
          categoryIcon="cup.and.saucer"
          categoryIconColor="#8E44AD"
          categoryAccessibilityLabel="Dining"
          money={Money.of('UAH', -1_000)}
          selected={selected}
          testID="card"
        />,
      );

      return StyleSheet.flatten(getByTestId('card').props.style).backgroundColor;
    };

    expect(await fillOf(true)).toBe(darkTheme.colors.accent);
    expect(await fillOf()).not.toBe(darkTheme.colors.accent);
  });

  it('keeps the category colour on the glyph, and gives it onAccent on the accent fill', async () => {
    const glyphTintOf = async (selected?: boolean) => {
      const { getByLabelText } = await render(
        <TransactionCard
          title="Coffee"
          categoryIcon="cup.and.saucer"
          categoryIconColor="#0A84FF"
          categoryAccessibilityLabel="Dining"
          money={Money.of('UAH', -1_000)}
          selected={selected}
        />,
      );

      return getByLabelText('Dining').props.tintColor;
    };

    expect(await glyphTintOf()).toBe('#0A84FF');
    expect(await glyphTintOf(true)).toBe(darkTheme.colors.onAccent);
  });

  // A transaction template's amount is optional, so the card renders the
  // title and footer with no amount text at all.
  it('renders the title and footer with no amount when money is omitted', async () => {
    const { getByText, queryByTestId } = await render(
      <TransactionCard
        title="Rent"
        categoryIcon="house"
        categoryIconColor="#8E44AD"
        categoryAccessibilityLabel="Housing"
        footerMeta="Monobank · Housing"
        footerTrailing="Monthly"
      />,
    );

    expect(getByText('Rent')).toBeTruthy();
    expect(getByText('Monobank · Housing')).toBeTruthy();
    expect(getByText('Monthly')).toBeTruthy();
    expect(queryByTestId(/^money-context-/)).toBeNull();
  });

  it('renders no loan-link marker when loanLinked is omitted', async () => {
    const { toJSON } = await render(
      <TransactionCard
        title="Coffee"
        categoryIcon="cup.and.saucer"
        categoryIconColor="#8E44AD"
        categoryAccessibilityLabel="Dining"
        money={Money.of('UAH', -1_000)}
        footerMeta="Monobank · Dining"
      />,
    );

    expect(JSON.stringify(toJSON())).not.toContain('link');
  });
});

describe('TransactionCard category glyph mark', () => {
  const lightTile = lightTheme.colors.entityColors.yellow;
  const glyphTintOf = async (selected?: boolean) => {
    const { getByLabelText } = await render(
      <TransactionCard
        title="Coffee"
        categoryIcon="cup.and.saucer"
        categoryIconColor={lightTile}
        categoryAccessibilityLabel="Dining"
        money={Money.of('UAH', -1_000)}
        selected={selected}
      />,
    );

    return getByLabelText('Dining').props.tintColor;
  };

  it('tints the glyph with the tile unchanged in the dark world', async () => {
    expect(await glyphTintOf()).toBe(lightTile);
  });

  describe('in the light world', () => {
    beforeEach(() => {
      registerLightThemeFirst();
    });

    afterEach(() => {
      restoreThemeOrder();
    });

    it('tints the glyph with the light mark, not the tile', async () => {
      expect(markColor(lightTile, 'light')).not.toBe(lightTile);
      expect(await glyphTintOf()).toBe(markColor(lightTile, 'light'));
    });

    it('still passes no color on the accent fill, so the glyph takes onAccent', async () => {
      expect(await glyphTintOf(true)).toBe(lightTheme.colors.onAccent);
    });
  });
});
