import type { TimeClock } from '@kiko/dates';
import type { ColorScheme } from '@kiko/design-system/palette';
import type { CategoryDisplay } from '@kiko/categories/category-display';

import { transactionCardPropsOf } from './card-props';

const HEX = /^#[0-9a-f]{6}$/i;

const categoryByKey: ReadonlyMap<string, CategoryDisplay> = new Map([
  ['food', { title: 'Food', icon: 'fork.knife', color: '#2c8f4e' }],
  ['travel', { title: 'Travel', icon: 'airplane', color: null }],
  ['other', { title: 'Other', icon: 'tray', color: null }],
]);

const CLOCK_24: TimeClock = { uses24Hour: true };
const CLOCK_12: TimeClock = { uses24Hour: false, beforeNoon: 'AM', afterNoon: 'PM' };
const TIME = new Date(2026, 10, 12, 14, 5).getTime();

const sourceOf = (
  overrides: Partial<Parameters<typeof transactionCardPropsOf>[0]> = {},
): Parameters<typeof transactionCardPropsOf>[0] => ({
  category: 'food',
  accountName: 'Card',
  holdingType: 'card',
  loanHoldingId: null,
  time: TIME,
  ...overrides,
});

const contextOf = (
  overrides: Partial<Parameters<typeof transactionCardPropsOf>[1]> = {},
): Parameters<typeof transactionCardPropsOf>[1] => ({
  categoryByKey,
  defaultCategoryKey: 'other',
  scheme: 'dark',
  clock: CLOCK_24,
  trailing: 'time',
  ...overrides,
});

describe('transactionCardPropsOf', () => {
  it("resolves an unknown or null category to the default category's icon, title and colour", () => {
    const fromNull = transactionCardPropsOf(sourceOf({ category: null }), contextOf());
    const fromUnknown = transactionCardPropsOf(sourceOf({ category: 'gone' }), contextOf());

    for (const props of [fromNull, fromUnknown]) {
      expect(props.categoryIcon).toBe('tray');
      expect(props.categoryAccessibilityLabel).toBe('Other');
      expect(props.categoryIconColor).toMatch(HEX);
    }
  });

  it('gives the icon a hex colour in the dark scheme and in the light scheme', () => {
    const schemes: ColorScheme[] = ['dark', 'light'];

    for (const scheme of schemes) {
      for (const category of ['food', 'travel', 'other']) {
        const { categoryIconColor } = transactionCardPropsOf(
          sourceOf({ category }),
          contextOf({ scheme }),
        );

        expect(categoryIconColor).toMatch(HEX);
      }
    }
  });

  it("hashes the colour on the resolved key, so an unknown slug takes the default category's colour", () => {
    const unknown = transactionCardPropsOf(sourceOf({ category: 'gone' }), contextOf());
    const defaultCategory = transactionCardPropsOf(sourceOf({ category: 'other' }), contextOf());
    const capitalised = transactionCardPropsOf(sourceOf({ category: 'Food' }), contextOf());
    const stored = transactionCardPropsOf(sourceOf({ category: 'food' }), contextOf());

    expect(unknown.categoryIconColor).toBe(defaultCategory.categoryIconColor);
    expect(capitalised.categoryIconColor).toBe(stored.categoryIconColor);
    expect(stored.categoryIconColor).not.toBe(defaultCategory.categoryIconColor);
  });

  it('reads the footer as "account · category"', () => {
    const props = transactionCardPropsOf(sourceOf({ accountName: 'Monobank' }), contextOf());

    expect(props.footerMeta).toBe('Monobank · Food');
  });

  it('names the loan part in place of the category title when one is given', () => {
    const props = transactionCardPropsOf(
      sourceOf({ accountName: 'Monobank' }),
      contextOf({ loanPartLabel: 'Loan interest' }),
    );

    expect(props.footerMeta).toBe('Monobank · Loan interest');
    expect(props.categoryAccessibilityLabel).toBe('Food');
  });

  it('shows the time on a timed holding and nothing on a time-exempt one', () => {
    const timed = transactionCardPropsOf(sourceOf(), contextOf());
    const timedTwelveHour = transactionCardPropsOf(sourceOf(), contextOf({ clock: CLOCK_12 }));
    const termDeposit = transactionCardPropsOf(
      sourceOf({ holdingType: 'term_deposit' }),
      contextOf(),
    );
    const bond = transactionCardPropsOf(sourceOf({ holdingType: 'bond' }), contextOf());

    expect(timed.footerTrailing).toBe('14:05');
    expect(timedTwelveHour.footerTrailing).toBe('2:05 PM');
    expect(termDeposit.footerTrailing).toBeUndefined();
    expect(bond.footerTrailing).toBeUndefined();
  });

  it('shows the date and time on a timed holding, and only the date on a time-exempt or unknown holding', () => {
    const trailing = 'dateTime' as const;
    const timed = transactionCardPropsOf(sourceOf(), contextOf({ trailing }));
    const timedTwelveHour = transactionCardPropsOf(
      sourceOf(),
      contextOf({ trailing, clock: CLOCK_12 }),
    );
    const termDeposit = transactionCardPropsOf(
      sourceOf({ holdingType: 'term_deposit' }),
      contextOf({ trailing }),
    );
    const unknown = transactionCardPropsOf(
      sourceOf({ holdingType: null }),
      contextOf({ trailing }),
    );

    expect(timed.footerTrailing).toBe('12.11.2026 14:05');
    expect(timedTwelveHour.footerTrailing).toBe('12.11.2026 2:05 PM');
    expect(termDeposit.footerTrailing).toBe('12.11.2026');
    expect(unknown.footerTrailing).toBe('12.11.2026');
  });

  it('marks a row with a loan link, and no other row', () => {
    const linked = transactionCardPropsOf(sourceOf({ loanHoldingId: 'loan-1' }), contextOf());
    const plain = transactionCardPropsOf(sourceOf(), contextOf());

    expect(linked.loanLinked).toBe(true);
    expect(plain.loanLinked).toBe(false);
  });
});
