import { i18n } from '@kiko/i18n/init';
import type { TimeClock } from '@kiko/dates';
import { act } from '@testing-library/react-native';
import type { Currency } from '@kiko/currency/currency';
import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';

import { ruleRows, ruleSummary } from './rule-summary';

const CLOCK_24: TimeClock = { uses24Hour: true };
const CLOCK_12: TimeClock = { uses24Hour: false, beforeNoon: 'AM', afterNoon: 'PM' };

const MINUTES_AT_18 = 18 * 60;

const formatAmount = (minorUnits: number, currency: Currency): string =>
  `${(minorUnits / 100).toFixed(2)} ${currency}`;

const rowsOf = (matchers: CategoryRuleMatcher[], clock: TimeClock = CLOCK_24) =>
  ruleRows(matchers, { t: i18n.t, clock, formatAmount });

const summaryOf = (matchers: CategoryRuleMatcher[], clock: TimeClock = CLOCK_24): string =>
  ruleSummary(rowsOf(matchers, clock));

describe('ruleRows', () => {
  it('gives one row per matcher, each with its subject, in the order they are stored', () => {
    expect(
      rowsOf([
        { type: 'nameIs', text: 'Silpo' },
        { type: 'direction', direction: 'expense' },
        { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'UAH' },
        { type: 'time', operator: 'after', minuteOfDay: MINUTES_AT_18 },
      ]).map(({ label, value }) => ({ label, value })),
    ).toEqual([
      { label: 'Name is', value: '"Silpo"' },
      { label: 'Type', value: 'Expense' },
      { label: 'Amount is more than', value: '500.00 UAH' },
      { label: 'Time is after', value: '18:00' },
    ]);
  });

  it('keeps the stored order when a time comes before a name', () => {
    expect(
      rowsOf([
        { type: 'time', operator: 'before', minuteOfDay: 9 * 60 },
        { type: 'nameStartsWith', text: 'Sil' },
      ]).map(({ label, value }) => ({ label, value })),
    ).toEqual([
      { label: 'Time is before', value: '09:00' },
      { label: 'Name starts with', value: '"Sil"' },
    ]);
  });

  it('gives every row a key of its own, even for two conditions of one kind', () => {
    const keys = rowsOf([
      { type: 'nameIs', text: 'Silpo' },
      { type: 'nameIs', text: 'Atb' },
      { type: 'amount', operator: 'gt', minorUnits: 100, currency: 'UAH' },
    ]).map((row) => row.key);

    expect(new Set(keys).size).toBe(3);
  });

  it('reads a time on the 12-hour clock with its mark', () => {
    expect(
      rowsOf([{ type: 'time', operator: 'after', minuteOfDay: MINUTES_AT_18 }], CLOCK_12).map(
        (row) => row.value,
      ),
    ).toEqual(['6:00 PM']);
  });

  it.each([
    ['eq', 'Amount equals'],
    ['gt', 'Amount is more than'],
    ['gte', 'Amount is at least'],
    ['lt', 'Amount is less than'],
    ['lte', 'Amount is at most'],
  ] as const)('labels the %s amount operator %s', (operator, label) => {
    expect(
      rowsOf([{ type: 'amount', operator, minorUnits: 100, currency: 'USD' }]).map(
        ({ label: rowLabel, value }) => ({ label: rowLabel, value }),
      ),
    ).toEqual([{ label, value: '1.00 USD' }]);
  });

  it('labels both directions and both time operators', () => {
    expect(rowsOf([{ type: 'direction', direction: 'income' }]).map((row) => row.value)).toEqual([
      'Income',
    ]);
    expect(
      rowsOf([{ type: 'time', operator: 'before', minuteOfDay: 0 }]).map(
        ({ label, value }) => `${label} ${value}`,
      ),
    ).toEqual(['Time is before 00:00']);
    expect(
      rowsOf([{ type: 'time', operator: 'after', minuteOfDay: 1439 }]).map(
        ({ label, value }) => `${label} ${value}`,
      ),
    ).toEqual(['Time is after 23:59']);
  });

  it('shows a contained name quoted', () => {
    expect(
      rowsOf([{ type: 'nameContains', text: 'Market' }]).map(({ label, value }) => ({
        label,
        value,
      })),
    ).toEqual([{ label: 'Name contains', value: '"Market"' }]);
  });

  it('shows a code padded to four digits', () => {
    expect(
      rowsOf([
        { type: 'mcc', code: 42 },
        { type: 'mcc', code: 5411 },
      ]).map(({ label, value }) => ({ label, value })),
    ).toEqual([
      { label: 'Merchant code (MCC)', value: '0042' },
      { label: 'Merchant code (MCC)', value: '5411' },
    ]);
  });

  it('hands the stored minor units and currency to the amount formatter untouched', () => {
    const received: [number, Currency][] = [];

    ruleRows([{ type: 'amount', operator: 'eq', minorUnits: 100000, currency: 'BTC' }], {
      t: i18n.t,
      clock: CLOCK_24,
      formatAmount: (minorUnits, currency) => {
        received.push([minorUnits, currency]);

        return '0.00100000 BTC';
      },
    });

    expect(received).toEqual([[100000, 'BTC']]);
  });
});

describe('the account and counterIban rows', () => {
  const asMatcher = (raw: unknown) => raw as CategoryRuleMatcher;
  const asOptions = (raw: unknown) => raw as Parameters<typeof ruleRows>[1];

  const NAMES = new Map([['account-1', 'Main card']]);
  const IBAN = 'UA733220010000026201112223334';

  const accountRowsOf = (matchers: CategoryRuleMatcher[]) =>
    ruleRows(
      matchers,
      asOptions({
        t: i18n.t,
        clock: CLOCK_24,
        formatAmount,
        accountNameOf: (accountId: string) => NAMES.get(accountId) ?? null,
      }),
    ).map(({ label, value }) => ({ label, value }));

  it('shows the live account name', () => {
    expect(accountRowsOf([asMatcher({ type: 'account', accountId: 'account-1' })])).toEqual([
      { label: 'Account', value: 'Main card' },
    ]);
  });

  it('shows Deleted account for an id in no row', () => {
    expect(accountRowsOf([asMatcher({ type: 'account', accountId: 'gone' })])).toEqual([
      { label: 'Account', value: 'Deleted account' },
    ]);
  });

  it('shows the IBAN in full', () => {
    expect(accountRowsOf([asMatcher({ type: 'counterIban', iban: IBAN })])).toEqual([
      { label: 'Counterparty IBAN', value: IBAN },
    ]);
  });
});

describe('ruleSummary', () => {
  it('reads the rows it is given, so the line can not differ from the table', () => {
    expect(
      ruleSummary([
        { key: 'first', label: 'Label one', value: 'Value one' },
        { key: 'second', label: 'Label two', value: 'Value two' },
      ]),
    ).toBe('Label one Value one · Label two Value two');
  });

  it('joins the rows, each as its label then its value, with a middle dot', () => {
    expect(
      summaryOf([
        { type: 'nameIs', text: 'Silpo' },
        { type: 'direction', direction: 'expense' },
        { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'UAH' },
        { type: 'time', operator: 'after', minuteOfDay: MINUTES_AT_18 },
      ]),
    ).toBe('Name is "Silpo" · Type Expense · Amount is more than 500.00 UAH · Time is after 18:00');
  });

  describe('under the uk language', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('reads the labels and the quoted name in Ukrainian', () => {
      expect(
        summaryOf([
          { type: 'nameIs', text: 'Silpo' },
          { type: 'direction', direction: 'expense' },
          { type: 'amount', operator: 'lte', minorUnits: 50000, currency: 'UAH' },
          { type: 'time', operator: 'before', minuteOfDay: MINUTES_AT_18 },
        ]),
      ).toBe('Назва дорівнює «Silpo» · Тип Витрата · Сума щонайбільше 500.00 UAH · Час до 18:00');
    });
  });
});
