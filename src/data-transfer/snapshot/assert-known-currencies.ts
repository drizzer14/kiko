import { guard } from 'fnts';
import { isRecord } from '@kiko/type-guards';
import { bifoldr, eitherSync } from 'fnts/either';
import { currencyScale } from '@kiko/currency/currency';

import type { DataSnapshot } from './data-snapshot';

// A missing value is left to the insert's own NOT NULL check; only a present value that is not an
// own key of `currencyScale` is unknown. `Object.hasOwn`, never `in`: an inherited name such as
// 'constructor' would pass `in`.
const isUnknownCurrency = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  !(typeof value === 'string' && Object.hasOwn(currencyScale, value));

// A file written by an older build lacks some tables (`pricePoints`, `categoryRules`), so every
// table read here tolerates a missing array, as the restore itself does.
const hasUnknownCurrency = (
  rows: readonly object[] | undefined,
  fields: readonly string[],
): boolean =>
  (rows ?? []).some((row) =>
    fields.some((field) => isUnknownCurrency((row as Record<string, unknown>)[field])),
  );

const hasUnknownMatcherCurrency = (matchers: string): boolean => {
  const parsed = bifoldr(eitherSync<unknown, unknown>(() => JSON.parse(matchers)));

  return (
    Array.isArray(parsed) &&
    parsed.some(
      (matcher: unknown) =>
        isRecord(matcher) && matcher.type === 'amount' && isUnknownCurrency(matcher.currency),
    )
  );
};

const hasUnknownDraftCurrency = (draft: unknown): boolean =>
  isRecord(draft) &&
  (isUnknownCurrency(draft.currency) ||
    (isRecord(draft.exchange) && isUnknownCurrency(draft.exchange.destinationCurrency)));

const hasUnknownBondTermsCurrency = (terms: unknown): boolean =>
  isRecord(terms) && isUnknownCurrency(terms.currency);

const snapshotHasUnknownCurrency = (snapshot: DataSnapshot): boolean =>
  hasUnknownCurrency(snapshot.holdings, ['currency']) ||
  hasUnknownCurrency(snapshot.pricePoints, ['currency']) ||
  hasUnknownCurrency(snapshot.currencyRates, ['base', 'quote']) ||
  hasUnknownCurrency(snapshot.currencyRateHistory, ['base', 'quote']) ||
  hasUnknownCurrency(snapshot.settings, ['baseCurrency']) ||
  (snapshot.bondRegister ?? []).some((entry) => hasUnknownBondTermsCurrency(entry.terms)) ||
  (snapshot.categoryRules ?? []).some((rule) => hasUnknownMatcherCurrency(rule.matchers)) ||
  (snapshot.transactionTemplates ?? []).some((template) => hasUnknownDraftCurrency(template.draft));

/**
 * Throws when the snapshot holds a currency code this build does not know: a file written by a
 * newer Kiko. It reads every currency column and the currency fields inside the stored JSON, and
 * runs before the restore reads or writes anything. Text that does not parse as JSON is left as
 * it is, because a restore keeps such a value verbatim.
 */
export const assertKnownCurrencies = guard(
  [
    snapshotHasUnknownCurrency,
    (): never => {
      throw new Error(
        'data-transfer/unknown-currency: the file holds a currency code this version does not know',
      );
    },
  ],
  (_snapshot: DataSnapshot): void => undefined,
);
