import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';

import type { MatcherDraft, MatcherDraftError } from './rule-draft.types';
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

describe('the nameContains and mcc rows', () => {
  const codeDraft = (mccText: string): MatcherDraft => ({
    ...emptyMatcherDraft('UAH'),
    type: 'mcc',
    mccText,
  });
  const containsDraft = (text: string): MatcherDraft => ({
    ...emptyMatcherDraft('UAH'),
    type: 'nameContains',
    text,
  });

  it('a four-digit code becomes a number', () => {
    expect(fromMatcherDrafts([codeDraft('5411')])).toEqual({
      kind: 'valid',
      matchers: [{ type: 'mcc', code: 5411 }],
    });
  });

  it('0042 stores as 42 and shows as 0042', () => {
    expect(fromMatcherDrafts([codeDraft('0042')])).toEqual({
      kind: 'valid',
      matchers: [{ type: 'mcc', code: 42 }],
    });

    const [draft] = toMatcherDrafts([{ type: 'mcc', code: 42 }], 'UAH');

    expect(draft).toMatchObject({ type: 'mcc', mccText: '0042' });
  });

  it('three digits, five digits and letters give errorMcc', () => {
    ['541', '54111', 'abcd', '54 1', ''].forEach((mccText) => {
      expect(fromMatcherDrafts([codeDraft(mccText)])).toEqual({
        kind: 'invalid',
        errors: new Map([[0, 'errorMcc']]),
      });
    });
  });

  it('a contained text is trimmed and a blank one gives errorName', () => {
    expect(fromMatcherDrafts([containsDraft('  Market ')])).toEqual({
      kind: 'valid',
      matchers: [{ type: 'nameContains', text: 'Market' }],
    });
    expect(fromMatcherDrafts([containsDraft('    ')])).toEqual({
      kind: 'invalid',
      errors: new Map([[0, 'errorName']]),
    });
  });

  it('switching type keeps mccText', () => {
    const coded = codeDraft('5411');
    const asName = { ...coded, type: 'nameIs' as const, text: 'Silpo' };
    const backToCode = { ...asName, type: coded.type };

    expect(fromMatcherDrafts([asName])).toEqual({
      kind: 'valid',
      matchers: [{ type: 'nameIs', text: 'Silpo' }],
    });
    expect(fromMatcherDrafts([backToCode])).toEqual({
      kind: 'valid',
      matchers: [{ type: 'mcc', code: 5411 }],
    });
  });
});

describe('the account and counterIban rows', () => {
  const asDraft = (raw: unknown) => raw as MatcherDraft;
  const asMatcher = (raw: unknown) => raw as CategoryRuleMatcher;
  const asSeeder = (raw: unknown) =>
    raw as (
      matchers: readonly CategoryRuleMatcher[],
      baseCurrency: 'UAH',
      liveAccountIds: ReadonlySet<string>,
    ) => MatcherDraft[];

  const seedWithAccounts = asSeeder(toMatcherDrafts);

  const accountDraft = (accountId: string | null): MatcherDraft =>
    asDraft({ ...emptyMatcherDraft('UAH'), type: 'account', accountId });
  const ibanDraft = (ibanText: string): MatcherDraft =>
    asDraft({ ...emptyMatcherDraft('UAH'), type: 'counterIban', ibanText });

  const accountIdOf = (draft: MatcherDraft | undefined): unknown =>
    (draft as unknown as { accountId: unknown } | undefined)?.accountId;

  it('no account picked gives errorAccount', () => {
    expect(fromMatcherDrafts([accountDraft(null)])).toEqual({
      kind: 'invalid',
      errors: new Map([[0, 'errorAccount']]),
    });
  });

  it('a picked account becomes a matcher', () => {
    expect(fromMatcherDrafts([accountDraft('account-1')])).toEqual({
      kind: 'valid',
      matchers: [asMatcher({ type: 'account', accountId: 'account-1' })],
    });
  });

  it('an id no longer listed seeds as none', () => {
    const [draft] = seedWithAccounts(
      [asMatcher({ type: 'account', accountId: 'gone' })],
      'UAH',
      new Set(['account-1']),
    );

    expect(draft).toMatchObject({ type: 'account' });
    expect(accountIdOf(draft)).toBeNull();
  });

  it('a live id seeds as itself', () => {
    const [draft] = seedWithAccounts(
      [asMatcher({ type: 'account', accountId: 'account-1' })],
      'UAH',
      new Set(['account-1', 'account-2']),
    );

    expect(draft).toMatchObject({ type: 'account' });
    expect(accountIdOf(draft)).toBe('account-1');
  });

  it('a typed IBAN is stored normalized', () => {
    expect(fromMatcherDrafts([ibanDraft(' ua73 3220 0100 0002 6201 1122 2333 4 ')])).toEqual({
      kind: 'valid',
      matchers: [asMatcher({ type: 'counterIban', iban: 'UA733220010000026201112223334' })],
    });
  });

  it('an IBAN rule seeds the text it was stored with', () => {
    const [draft] = seedWithAccounts(
      [asMatcher({ type: 'counterIban', iban: 'UA733220010000026201112223334' })],
      'UAH',
      new Set(),
    );

    expect(draft).toMatchObject({ type: 'counterIban' });
    expect((draft as unknown as { ibanText: unknown }).ibanText).toBe(
      'UA733220010000026201112223334',
    );
  });

  it.each([
    ['a blank text', ''],
    ['spaces only', '   '],
    ['text that is no IBAN', 'ATB Market'],
    ['a short body', 'UA7332200100'],
  ])('a bad IBAN gives errorIban: %s', (_label, ibanText) => {
    expect(fromMatcherDrafts([ibanDraft(ibanText)])).toEqual({
      kind: 'invalid',
      errors: new Map([[0, 'errorIban']]),
    });
  });

  it('judges only the fields of the type a row has', () => {
    expect(
      fromMatcherDrafts([
        asDraft({ ...accountDraft('account-1'), ibanText: 'junk' }),
        asDraft({ ...ibanDraft('UA733220010000026201112223334'), accountId: null }),
      ]),
    ).toEqual({
      kind: 'valid',
      matchers: [
        asMatcher({ type: 'account', accountId: 'account-1' }),
        asMatcher({ type: 'counterIban', iban: 'UA733220010000026201112223334' }),
      ],
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
    ['a negative amount', '-5', 'UAH'],
    ['a negative zero', '-0', 'UAH'],
    ['a blank amount', '', 'UAH'],
    ['a blank amount of spaces', '   ', 'UAH'],
    ['text that is not a number', 'abc', 'UAH'],
    ['a lone separator', ',', 'UAH'],
    ['a negative amount with too many decimals', '-1.005', 'UAH'],
    ['a negative amount too large to hold', '-99999999999999999999', 'UAH'],
    ['a negative fraction in a currency with none', '-1.5', 'BIF'],
  ] as const)('refuses %s as below zero', (_label, text, currency) => {
    expect(fromMatcherDrafts([amountDraft(text, currency)])).toEqual({
      kind: 'invalid',
      errors: new Map([[0, 'errorAmountNegative']]),
    });
  });

  it.each([
    ['more decimals than the currency has', '1.005', 'UAH', 2],
    ['a tiny fraction of a cent', '0.001', 'UAH', 2],
    ['more decimals than a coin has', '0.123456789', 'BTC', 8],
    ['more decimals than three allow', '1.2345', 'BHD', 3],
    ['more decimals beside a large whole part', '35849873297196.455', 'UAH', 2],
    ['a space after the fraction beside a large whole part', '35849873297196.455 ', 'UAH', 2],
    ['a space inside the fraction beside a large whole part', '35849873297196.4 55', 'UAH', 2],
  ] as const)(
    'refuses %s with the digits the currency allows',
    (_label, text, currency, digits) => {
      expect(fromMatcherDrafts([amountDraft(text, currency)])).toEqual({
        kind: 'invalid',
        errors: new Map([[0, { kind: 'errorAmountDecimals', digits }]]),
      });
    },
  );

  it('refuses a fraction in a currency with no decimals as whole amounts only', () => {
    expect(fromMatcherDrafts([amountDraft('1.5', 'BIF')])).toEqual({
      kind: 'invalid',
      errors: new Map([[0, 'errorAmountWholeOnly']]),
    });
  });

  it.each([
    ['more than a safe integer of minor units', '99999999999999999999', 'UAH'],
    ['the first value past a safe integer of minor units', '90071992547409.92', 'UAH'],
    ['a value too large that also has too many decimals', '99999999999999999999.123', 'UAH'],
    ['a value too large in a currency with no decimals', '99999999999999999999', 'BIF'],
    ['a fraction too large in a currency with no decimals', '99999999999999999999.5', 'BIF'],
    ['a number that is not finite', 'Infinity', 'UAH'],
    ['a value whose digits fit the scale but not a float', '35849873297196.45', 'UAH'],
    ['the same kind of value in three decimals', '4441174532554.572', 'BHD'],
    ['the same kind of value in a coin', '35589809.88665199', 'BTC'],
    ['such a value typed with a comma decimal', '35849873297196,45', 'UAH'],
    ['such a value typed with grouped thousands', '35,849,873,297,196.45', 'UAH'],
    ['such a value with trailing zeros past the scale', '35849873297196.450', 'UAH'],
  ] as const)('refuses %s as too large', (_label, text, currency) => {
    expect(fromMatcherDrafts([amountDraft(text, currency)])).toEqual({
      kind: 'invalid',
      errors: new Map([[0, 'errorAmountTooLarge']]),
    });
  });

  it('reads the last amount a safe integer of minor units can hold', () => {
    expect(fromMatcherDrafts([amountDraft('90071992547409.91')])).toEqual({
      kind: 'valid',
      matchers: [{ type: 'amount', operator: 'eq', minorUnits: 9007199254740991, currency: 'UAH' }],
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
      errors: new Map<number, MatcherDraftError>([
        [1, 'errorName'],
        [3, { kind: 'errorAmountDecimals', digits: 2 }],
      ]),
    });
  });

  it('reads no condition as no matchers rather than refusing it', () => {
    expect(fromMatcherDrafts([])).toEqual({ kind: 'valid', matchers: [] });
  });
});
