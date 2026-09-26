import { render } from '@testing-library/react-native';
import '../../unistyles';
import { Money } from '@kiko/currency/money';

import TransactionCard from '.';

// MoneyText's own tone->color resolution (context + sign -> positive/
// negative/textPrimary) is exhaustively covered by `money-text.component.test.tsx`
// — this only needs to prove TransactionCard wires it the "transaction"
// context Home's TransactionRow does, so a positive amount resolves to the
// income (green/positive) tone same as Home. `Text`'s own tone->color
// variant is stripped by the project's Jest unistyles mock (see MoneyText's
// own test file's comment), so this mocks MoneyText itself, exposing the
// resolved context/sign via testID, the same technique.
jest.mock('../money-text', () => {
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
