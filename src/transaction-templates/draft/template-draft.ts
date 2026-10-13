import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { type Currency, isCurrency } from '@kiko/currency/currency';

// The form's own mode union lives in a screen file, which a feature must not import. The form
// assigns this union to its own and back, so `tsc` fails if the two drift apart.
export const TEMPLATE_MODES = ['income', 'expense', 'exchange', 'split'] as const;
export type TemplateMode = (typeof TEMPLATE_MODES)[number];

export type TemplateDraft = {
  version: 1;
  mode: TemplateMode;
  holdingId: string | null;
  currency: Currency | null;
  amountMinorUnits: number | null;
  description: string;
  category: string | null;
  exchange: {
    destinationHoldingId: string | null;
    destinationCurrency: Currency | null;
    valueInMinorUnits: number | null;
  } | null;
  returns: { holdingId: string | null; amountMinorUnits: number | null }[];
};

export const EMPTY_DRAFT: TemplateDraft = {
  version: 1,
  mode: 'expense',
  holdingId: null,
  currency: null,
  amountMinorUnits: null,
  description: '',
  category: null,
  exchange: null,
  returns: [],
};

const isNullOr =
  <Value>(isValue: (value: unknown) => value is Value) =>
  (value: unknown): value is Value | null =>
    value === null || isValue(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isTemplateMode = (value: unknown): value is TemplateMode =>
  isString(value) && (TEMPLATE_MODES as readonly string[]).includes(value);

const isCurrencyCode = (value: unknown): value is Currency => isString(value) && isCurrency(value);

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isExchange = (value: unknown): value is NonNullable<TemplateDraft['exchange']> =>
  isRecord(value) &&
  isNullOr(isString)(value.destinationHoldingId) &&
  isNullOr(isCurrencyCode)(value.destinationCurrency) &&
  isNullOr(isPositiveSafeInteger)(value.valueInMinorUnits);

const isReturnRow = (value: unknown): value is TemplateDraft['returns'][number] =>
  isRecord(value) &&
  isNullOr(isString)(value.holdingId) &&
  isNullOr(isPositiveSafeInteger)(value.amountMinorUnits);

// A row that fails this reads as EMPTY_DRAFT, so every field is checked: a stored draft is data
// from outside the type system (an older build, a restored file).
export const isTemplateDraft = (value: unknown): value is TemplateDraft =>
  isRecord(value) &&
  value.version === 1 &&
  isTemplateMode(value.mode) &&
  isNullOr(isString)(value.holdingId) &&
  isNullOr(isCurrencyCode)(value.currency) &&
  isNullOr(isPositiveSafeInteger)(value.amountMinorUnits) &&
  isString(value.description) &&
  isNullOr(isString)(value.category) &&
  isNullOr(isExchange)(value.exchange) &&
  Array.isArray(value.returns) &&
  value.returns.every(isReturnRow);

const isHoldingId = (holdingId: string | null): holdingId is string => holdingId !== null;

export const draftReferences = (
  draft: TemplateDraft,
): { holdingIds: string[]; categoryKey: string | null } => {
  const holdingIds = [
    draft.holdingId,
    draft.exchange?.destinationHoldingId ?? null,
    ...draft.returns.map((row) => row.holdingId),
  ].filter(isHoldingId);

  return {
    holdingIds: Array.from(new Set(holdingIds)),
    categoryKey: foldMap(maybe(draft.category), (category) => category.toLowerCase()) ?? null,
  };
};

export const clearDraftReferences = (
  draft: TemplateDraft,
  cleared: { holdingIds: readonly string[]; categoryKey: string | null },
): TemplateDraft => {
  const clearHolding = (holdingId: string | null): string | null =>
    holdingId !== null && cleared.holdingIds.includes(holdingId) ? null : holdingId;

  const isClearedCategory =
    draft.category !== null &&
    cleared.categoryKey !== null &&
    draft.category.toLowerCase() === cleared.categoryKey.toLowerCase();

  return {
    ...draft,
    holdingId: clearHolding(draft.holdingId),
    category: isClearedCategory ? null : draft.category,
    exchange:
      foldMap(maybe(draft.exchange), (exchange) => ({
        ...exchange,
        destinationHoldingId: clearHolding(exchange.destinationHoldingId),
      })) ?? null,
    returns: draft.returns.map((row) => ({ ...row, holdingId: clearHolding(row.holdingId) })),
  };
};
