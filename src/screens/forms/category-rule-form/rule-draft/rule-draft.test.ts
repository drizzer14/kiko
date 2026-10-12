import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';

import { emptyMatcherDraft, fromMatcherDrafts, toMatcherDrafts } from './rule-draft';

const roundTrip = (matchers: CategoryRuleMatcher[]) =>
  fromMatcherDrafts(toMatcherDrafts(matchers, 'UAH'));

describe('toMatcherDrafts and fromMatcherDrafts', () => {
  it.each([
    ['a name that is exact', { type: 'nameIs', text: 'Silpo' }],
    ['a name that starts with', { type: 'nameStartsWith', text: 'Mega Silpo' }],
    ['an expense', { type: 'direction', direction: 'expense' }],
    ['an income', { type: 'direction', direction: 'income' }],
    ['a time before midnight', { type: 'time', operator: 'before', minuteOfDay: 0 }],
    ['a time after the last minute', { type: 'time', operator: 'after', minuteOfDay: 1439 }],
    ['an amount equal to zero', { type: 'amount', operator: 'eq', minorUnits: 0, currency: 'UAH' }],
    [
      'an amount with grouped thousands',
      { type: 'amount', operator: 'gte', minorUnits: 123456789, currency: 'UAH' },
    ],
    [
      'an amount in a coin',
      { type: 'amount', operator: 'lt', minorUnits: 100000, currency: 'BTC' },
    ],
    [
      'an amount with three decimals',
      { type: 'amount', operator: 'gt', minorUnits: 12345, currency: 'BHD' },
    ],
    ['an amount with none', { type: 'amount', operator: 'lte', minorUnits: 500, currency: 'BIF' }],
  ] satisfies [string, CategoryRuleMatcher][])('round-trips %s', (_label, matcher) => {
    expect(roundTrip([matcher])).toEqual({ kind: 'valid', matchers: [matcher] });
  });

  it('round-trips a whole rule in the order it is stored, a type twice included', () => {
    const matchers: CategoryRuleMatcher[] = [
      { type: 'time', operator: 'after', minuteOfDay: 18 * 60 },
      { type: 'nameIs', text: 'Silpo' },
      { type: 'direction', direction: 'expense' },
      { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'USD' },
      { type: 'amount', operator: 'lt', minorUnits: 90000, currency: 'USD' },
    ];

    expect(roundTrip(matchers)).toEqual({ kind: 'valid', matchers });
  });

  it('shows an amount as plain major units, grouped as the field groups them', () => {
    const [draft] = toMatcherDrafts(
      [{ type: 'amount', operator: 'eq', minorUnits: 123456789, currency: 'UAH' }],
      'UAH',
    );

    expect(draft).toMatchObject({
      type: 'amount',
      amountOperator: 'eq',
      amountText: '1 234 567.89',
      currency: 'UAH',
    });
  });

  it('starts every field the matcher does not use on its default, in the base currency', () => {
    const [draft] = toMatcherDrafts([{ type: 'nameIs', text: 'Silpo' }], 'USD');

    expect(draft).toEqual({ ...emptyMatcherDraft('USD'), type: 'nameIs', text: 'Silpo' });
    expect(draft?.currency).toBe('USD');
  });

  it('keeps the currency of an amount, not the base currency', () => {
    const [draft] = toMatcherDrafts(
      [{ type: 'amount', operator: 'eq', minorUnits: 100, currency: 'EUR' }],
      'USD',
    );

    expect(draft?.currency).toBe('EUR');
  });
});

describe('emptyMatcherDraft', () => {
  it('is a blank name condition in the base currency', () => {
    expect(emptyMatcherDraft('EUR')).toMatchObject({
      type: 'nameIs',
      text: '',
      amountText: '',
      currency: 'EUR',
    });
  });
});

describe('fromMatcherDrafts', () => {
  const amountDraft = (amountText: string, currency: 'UAH' | 'BTC' | 'BHD' | 'BIF' = 'UAH') => ({
    ...emptyMatcherDraft('UAH'),
    type: 'amount' as const,
    amountText,
    currency,
  });

  it.each([
    ['a dot decimal', '12.5', 'UAH', 1250],
    ['a comma decimal', '12,5', 'UAH', 1250],
    ['grouped thousands', '1 234.56', 'UAH', 123456],
    ['a whole number', '500', 'UAH', 50000],
    ['zero', '0', 'UAH', 0],
    ['trailing zeros past none of the scale', '1.50', 'UAH', 150],
    ['the scale of a coin', '0.00100000', 'BTC', 100000],
    ['one satoshi', '0.00000001', 'BTC', 1],
    ['the scale of three decimals', '1.234', 'BHD', 1234],
    ['a currency with no decimals', '500', 'BIF', 500],
  ] as const)(
    'reads %s through the currency of the draft, exactly',
    (_label, text, currency, minorUnits) => {
      expect(fromMatcherDrafts([amountDraft(text, currency)])).toEqual({
        kind: 'valid',
        matchers: [{ type: 'amount', operator: 'eq', minorUnits, currency }],
      });
    },
  );

  it.each([
    ['more decimals than the currency has', '1.005', 'UAH'],
    ['a tiny fraction of a cent', '0.001', 'UAH'],
    ['more decimals than a coin has', '0.123456789', 'BTC'],
    ['a fraction in a currency with none', '1.5', 'BIF'],
    ['a negative amount', '-5', 'UAH'],
    ['a negative zero', '-0', 'UAH'],
    ['a blank amount', '', 'UAH'],
    ['a blank amount of spaces', '   ', 'UAH'],
    ['text that is not a number', 'abc', 'UAH'],
    ['a lone separator', ',', 'UAH'],
    ['more than a safe integer of minor units', '99999999999999999999', 'UAH'],
  ] as const)('refuses %s with the amount error', (_label, text, currency) => {
    expect(fromMatcherDrafts([amountDraft(text, currency)])).toEqual({
      kind: 'invalid',
      errors: new Map([[0, 'errorAmount']]),
    });
  });

  it('keeps the typed name without its edges', () => {
    expect(
      fromMatcherDrafts([
        { ...emptyMatcherDraft('UAH'), type: 'nameStartsWith', text: '  Silpo ' },
      ]),
    ).toEqual({ kind: 'valid', matchers: [{ type: 'nameStartsWith', text: 'Silpo' }] });
  });

  it.each([
    ['an exact name', 'nameIs'],
    ['a name prefix', 'nameStartsWith'],
  ] as const)('refuses a blank %s with the name error', (_label, type) => {
    expect(fromMatcherDrafts([{ ...emptyMatcherDraft('UAH'), type, text: '    ' }])).toEqual({
      kind: 'invalid',
      errors: new Map([[0, 'errorName']]),
    });
  });

  it('names every refused row by its position, and judges only the type a row has', () => {
    const result = fromMatcherDrafts([
      { ...emptyMatcherDraft('UAH'), type: 'nameIs', text: 'Silpo', amountText: 'junk' },
      { ...emptyMatcherDraft('UAH'), type: 'nameIs', text: '' },
      { ...emptyMatcherDraft('UAH'), type: 'direction', amountText: '-1', text: '' },
      amountDraft('1.005'),
      { ...emptyMatcherDraft('UAH'), type: 'time', text: '', amountText: '' },
    ]);

    expect(result).toEqual({
      kind: 'invalid',
      errors: new Map([
        [1, 'errorName'],
        [3, 'errorAmount'],
      ]),
    });
  });

  it('reads no condition as no matchers rather than refusing it', () => {
    expect(fromMatcherDrafts([])).toEqual({ kind: 'valid', matchers: [] });
  });
});
