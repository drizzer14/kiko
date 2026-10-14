import { parseRuleMatchers } from './parse-rule-matchers';

const json = (value: unknown): string => JSON.stringify(value);

const validAmount = { type: 'amount', operator: 'gte', minorUnits: 50000, currency: 'UAH' };

describe('parseRuleMatchers', () => {
  describe('rejects the whole list', () => {
    it.each([
      ['invalid JSON', '{not json'],
      ['an empty string', ''],
      ['an object instead of a list', json({ type: 'nameIs', text: 'silpo' })],
      ['a string', json('nameIs')],
      ['null', json(null)],
      ['an empty list', json([])],
      ['a non-object element', json(['nameIs'])],
      ['a null element', json([null])],
      ['a nested list element', json([[{ type: 'nameIs', text: 'silpo' }]])],
      ['an unknown type', json([{ type: 'merchant', text: 'silpo' }])],
      ['a missing type', json([{ text: 'silpo' }])],
      ['an unknown amount operator', json([{ ...validAmount, operator: 'ne' }])],
      ['a missing amount operator', json([{ type: 'amount', minorUnits: 1, currency: 'UAH' }])],
      ['an unknown time operator', json([{ type: 'time', operator: 'at', minuteOfDay: 60 }])],
      [
        'an amount operator on a time matcher',
        json([{ type: 'time', operator: 'gt', minuteOfDay: 60 }]),
      ],
      ['an unknown direction', json([{ type: 'direction', direction: 'transfer' }])],
      ['a missing direction', json([{ type: 'direction' }])],
      ['negative minorUnits', json([{ ...validAmount, minorUnits: -1 }])],
      ['fractional minorUnits', json([{ ...validAmount, minorUnits: 1.5 }])],
      ['minorUnits above the safe integer range', json([{ ...validAmount, minorUnits: 2 ** 53 }])],
      ['string minorUnits', json([{ ...validAmount, minorUnits: '500' }])],
      ['null minorUnits', json([{ ...validAmount, minorUnits: null }])],
      ['a currency that is not supported', json([{ ...validAmount, currency: 'XXX' }])],
      ['a lowercase currency', json([{ ...validAmount, currency: 'uah' }])],
      ['a missing currency', json([{ type: 'amount', operator: 'eq', minorUnits: 1 }])],
      ['a non-string currency', json([{ ...validAmount, currency: 980 }])],
      ['a fractional minuteOfDay', json([{ type: 'time', operator: 'before', minuteOfDay: 60.5 }])],
      ['a negative minuteOfDay', json([{ type: 'time', operator: 'before', minuteOfDay: -1 }])],
      ['minuteOfDay 1440', json([{ type: 'time', operator: 'after', minuteOfDay: 1440 }])],
      ['a string minuteOfDay', json([{ type: 'time', operator: 'after', minuteOfDay: '60' }])],
      ['a blank nameIs text', json([{ type: 'nameIs', text: '   ' }])],
      ['an empty nameStartsWith text', json([{ type: 'nameStartsWith', text: '' }])],
      ['a non-string name text', json([{ type: 'nameIs', text: 5 }])],
      ['a missing name text', json([{ type: 'nameStartsWith' }])],
      [
        'one bad matcher among good ones',
        json([
          { type: 'nameIs', text: 'silpo' },
          { ...validAmount, minorUnits: -5 },
        ]),
      ],
    ])('%s', (_label, stored) => {
      expect(parseRuleMatchers(stored)).toBeNull();
    });
  });

  describe('accepts', () => {
    it.each([
      ['nameIs', { type: 'nameIs', text: 'Silpo' }],
      ['nameStartsWith', { type: 'nameStartsWith', text: 'Silpo' }],
      ['amount eq', { type: 'amount', operator: 'eq', minorUnits: 0, currency: 'UAH' }],
      ['amount gt', { type: 'amount', operator: 'gt', minorUnits: 1, currency: 'USD' }],
      ['amount gte', { type: 'amount', operator: 'gte', minorUnits: 100000, currency: 'EUR' }],
      ['amount lt', { type: 'amount', operator: 'lt', minorUnits: 5, currency: 'GBP' }],
      [
        'amount lte on a crypto currency',
        { type: 'amount', operator: 'lte', minorUnits: 100000, currency: 'BTC' },
      ],
      ['direction expense', { type: 'direction', direction: 'expense' }],
      ['direction income', { type: 'direction', direction: 'income' }],
      ['time before midnight start', { type: 'time', operator: 'before', minuteOfDay: 0 }],
      ['time after the last minute', { type: 'time', operator: 'after', minuteOfDay: 1439 }],
    ])('a list with %s', (_label, matcher) => {
      expect(parseRuleMatchers(json([matcher]))).toEqual([matcher]);
    });

    it('keeps every matcher of a list in stored order', () => {
      const matchers = [
        { type: 'time', operator: 'after', minuteOfDay: 1080 },
        { type: 'nameIs', text: 'Silpo' },
        { type: 'direction', direction: 'expense' },
      ];

      expect(parseRuleMatchers(json(matchers))).toEqual(matchers);
    });

    it('ignores keys it does not know', () => {
      const parsed = parseRuleMatchers(
        json([
          { type: 'nameIs', text: 'Silpo', note: 'junk', id: 7 },
          { ...validAmount, extra: true },
        ]),
      );

      expect(parsed).toStrictEqual([
        { type: 'nameIs', text: 'Silpo' },
        { type: 'amount', operator: 'gte', minorUnits: 50000, currency: 'UAH' },
      ]);
    });
  });
});
