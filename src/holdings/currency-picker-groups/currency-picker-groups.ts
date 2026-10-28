import {
  type Currency,
  cryptoCurrencyOptions,
  currencyOptions,
  fiatCurrencyOptions,
} from '@kiko/currency/currency';
import { match } from 'ts-pattern';
import {
  type CurrencyGroup,
  type CurrencyOrdering,
  orderCurrencies,
} from '@kiko/currency/currency-group';
import maybe, { foldMap } from 'fnts/maybe';

import type { HoldingType } from '../holding-type';
import { isCryptoHoldingType, isCurrencyExpectedForHoldingType } from '../holding-currency';

export type CurrencyPickerContext =
  | { kind: 'fiat' }
  | { kind: 'holding'; type: HoldingType }
  | { kind: 'statement'; target: { currency: Currency; type: HoldingType } | undefined }
  | { kind: 'any' };

const holdingGroups = (type: HoldingType): CurrencyGroup[] => {
  const expected = currencyOptions.filter((code) => isCurrencyExpectedForHoldingType(type, code));

  return isCryptoHoldingType(type)
    ? [
        { kind: 'crypto', currencies: expected },
        { kind: 'fiat', currencies: fiatCurrencyOptions },
      ]
    : [{ kind: 'fiat', currencies: expected }];
};

const anyGroups = (held: readonly Currency[]): CurrencyGroup[] => {
  const heldCodes = currencyOptions.filter((code) => held.includes(code));

  return [
    { kind: 'held', currencies: heldCodes },
    { kind: 'fiat', currencies: fiatCurrencyOptions.filter((code) => !held.includes(code)) },
    { kind: 'crypto', currencies: cryptoCurrencyOptions.filter((code) => !held.includes(code)) },
  ];
};

const statementGroups = (target: { currency: Currency; type: HoldingType }): CurrencyGroup[] => [
  { kind: 'target', currencies: [target.currency] },
  ...holdingGroups(target.type).map(({ kind, currencies }) => ({
    kind,
    currencies: currencies.filter((code) => code !== target.currency),
  })),
];

const unorderedGroups = (
  context: CurrencyPickerContext,
  held: readonly Currency[],
): CurrencyGroup[] =>
  match(context)
    .with({ kind: 'fiat' }, () => [{ kind: 'fiat' as const, currencies: fiatCurrencyOptions }])
    .with({ kind: 'holding' }, ({ type }) => holdingGroups(type))
    .with(
      { kind: 'statement' },
      ({ target }) => foldMap(maybe(target), statementGroups) ?? anyGroups(held),
    )
    .with({ kind: 'any' }, () => anyGroups(held))
    .exhaustive();

// What each currency picker lists, as groups in display order: the context says which currencies
// the form can use, and every group is ordered by the one `orderCurrencies` rule. An empty group is
// dropped, so a picker never shows a heading with nothing under it.
export const currencyPickerGroups = (
  context: CurrencyPickerContext,
  ordering: CurrencyOrdering,
): CurrencyGroup[] =>
  unorderedGroups(context, ordering.held)
    .filter(({ currencies }) => currencies.length > 0)
    .map(({ kind, currencies }) => ({ kind, currencies: orderCurrencies(currencies, ordering) }));
