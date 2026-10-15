// src/data-transfer/snapshot/with-usdt-rescaled.ts
import { guard } from 'fnts';
import maybe, { foldMap } from 'fnts/maybe';
import { bifoldr, eitherSync } from 'fnts/either';
import type { HoldingRow, TransactionRow, CategoryRuleRow } from '@kiko/db';

import type { DataSnapshot } from './data-snapshot';

/**
 * The largest scale-2 USDT amount, in minor units, that still rescales to an integer a JavaScript
 * number holds exactly: at scale 8, 9,007,199,254 units of 10^-2 become 9,007,199,254,000,000, just
 * under 2^53. A larger stored value would lose digits, so the rescale refuses it instead.
 */
export const USDT_RESCALE_BOUND_MINOR_UNITS = 9_007_199_254;

/** The newest `.kiko` version written while USDT was stored at two decimals. */
export const LAST_SCALE_2_USDT_VERSION = 3;

export type UsdtRescaleTables = Pick<
  DataSnapshot,
  'holdings' | 'transactions' | 'categoryRules' | 'transactionTemplates' | 'deletedImportKeys'
>;

type JsonRecord = Record<string, unknown>;

const RESCALE_FACTOR = 1_000_000;
const SMALLEST_INTEGER_64 = BigInt('-9223372036854775808');
const LARGEST_INTEGER_64 = BigInt('9223372036854775807');
// <holding id> <time> <amount> <description>, the shape `computeDedupKeyBase` writes. A key with no
// text after the amount has no description to follow it and is left alone.
const KEY_PATTERN = /^([^ ]*) ([^ ]*) ([^ ]*)( [\s\S]*)$/;
const SCALAR_METADATA_FIELDS = [
  'principalMinorUnits',
  'faceValueMinorUnits',
  'purchasePriceMinorUnits',
];

const rescaledAmount = guard(
  [
    (amountMinorUnits: number) =>
      amountMinorUnits < -USDT_RESCALE_BOUND_MINOR_UNITS ||
      amountMinorUnits > USDT_RESCALE_BOUND_MINOR_UNITS,
    (): never => {
      throw new Error(
        `data-transfer/amount-too-large: a USDT amount over ${USDT_RESCALE_BOUND_MINOR_UNITS} minor units cannot be rescaled exactly`,
      );
    },
  ],
  (amountMinorUnits: number): number => amountMinorUnits * RESCALE_FACTOR,
);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// What SQLite's `json_type` calls an integer in text the app wrote: `JSON.stringify` writes a
// number below 1e21 with no fraction and no exponent, so a whole number in that range is one.
const isJsonInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && Math.abs(value) < 1e21;

// The amount token of a key is rescaled only when it reads back as the same text through a signed
// 64-bit integer, the rule `CAST(token AS INTEGER) || '' = token` applies in SQL.
const isIntegerToken = (token: string): boolean =>
  /^-?[0-9]+$/.test(token) &&
  String(BigInt(token)) === token &&
  BigInt(token) >= SMALLEST_INTEGER_64 &&
  BigInt(token) <= LARGEST_INTEGER_64;

const withEntriesKept = <Entry>(entries: Entry[], transform: (entry: Entry) => Entry): Entry[] => {
  const transformed = entries.map(transform);

  return transformed.every((entry, index) => entry === entries[index]) ? entries : transformed;
};

const withFieldRescaled = (record: JsonRecord, field: string): JsonRecord => {
  const value = record[field];

  return isJsonInteger(value) ? { ...record, [field]: rescaledAmount(value) } : record;
};

const withElementsRescaled = (
  record: JsonRecord,
  listField: string,
  elementField: string,
): JsonRecord => {
  const list = record[listField];

  if (!Array.isArray(list)) {
    return record;
  }

  const rescaledList = withEntriesKept(list, (element: unknown) =>
    isRecord(element) ? withFieldRescaled(element, elementField) : element,
  );

  return rescaledList === list ? record : { ...record, [listField]: rescaledList };
};

const withMetadataRescaled = (metadata: unknown): unknown => {
  if (!isRecord(metadata)) {
    return metadata;
  }

  const withScalars = SCALAR_METADATA_FIELDS.reduce(withFieldRescaled, metadata);

  return withElementsRescaled(
    withElementsRescaled(withScalars, 'contributions', 'amountMinorUnits'),
    'lots',
    'costMinorUnits',
  );
};

const isUsdtAmountMatcher = (element: unknown): element is JsonRecord =>
  isRecord(element) && element.type === 'amount' && element.currency === 'USDT';

const withMatchersRescaled = (matchers: string): string => {
  const parsed = bifoldr(eitherSync<unknown, unknown>(() => JSON.parse(matchers)));

  if (!Array.isArray(parsed)) {
    return matchers;
  }

  const rescaledList = withEntriesKept(parsed, (element: unknown) =>
    isUsdtAmountMatcher(element) ? withFieldRescaled(element, 'minorUnits') : element,
  );

  return rescaledList === parsed ? matchers : JSON.stringify(rescaledList);
};

const withExchangeRescaled = (draft: JsonRecord): JsonRecord => {
  const exchange = draft.exchange;

  if (!isRecord(exchange) || exchange.destinationCurrency !== 'USDT') {
    return draft;
  }

  const rescaledExchange = withFieldRescaled(exchange, 'valueInMinorUnits');

  return rescaledExchange === exchange ? draft : { ...draft, exchange: rescaledExchange };
};

const withDraftAmountsRescaled = (draft: JsonRecord): JsonRecord =>
  draft.currency === 'USDT'
    ? withElementsRescaled(
        withFieldRescaled(draft, 'amountMinorUnits'),
        'returns',
        'amountMinorUnits',
      )
    : draft;

const withDraftRescaled = (draft: unknown): unknown =>
  isRecord(draft) ? withExchangeRescaled(withDraftAmountsRescaled(draft)) : draft;

// The holding a key names is its first token, whichever holding the row sits on now.
const withKeyRescaled = (key: string, usdtHoldingIds: ReadonlySet<string>): string => {
  const match = KEY_PATTERN.exec(key);

  if (match === null) {
    return key;
  }

  const [, holdingId, time, amountToken, description] = match;

  if (!usdtHoldingIds.has(holdingId) || !isIntegerToken(amountToken)) {
    return key;
  }

  return `${holdingId} ${time} ${rescaledAmount(Number(amountToken))}${description}`;
};

const withHoldingRescaled = (holding: HoldingRow): HoldingRow => ({
  ...holding,
  balanceMinorUnits: rescaledAmount(holding.balanceMinorUnits),
  syncedBalanceMinorUnits: foldMap(maybe(holding.syncedBalanceMinorUnits), rescaledAmount) ?? null,
  metadata: withMetadataRescaled(holding.metadata),
});

const withImportKeyRescaled = (
  transaction: TransactionRow,
  usdtHoldingIds: ReadonlySet<string>,
): string | null =>
  transaction.source === 'import'
    ? (foldMap(maybe(transaction.externalId), (key) => withKeyRescaled(key, usdtHoldingIds)) ??
      null)
    : transaction.externalId;

const withTransactionRescaled = (
  transaction: TransactionRow,
  usdtHoldingIds: ReadonlySet<string>,
): TransactionRow => {
  const withAmount = usdtHoldingIds.has(transaction.holdingId)
    ? { ...transaction, amountMinorUnits: rescaledAmount(transaction.amountMinorUnits) }
    : transaction;
  const externalId = withImportKeyRescaled(transaction, usdtHoldingIds);

  return externalId === transaction.externalId ? withAmount : { ...withAmount, externalId };
};

/**
 * The restore mirror of the migration that rescales stored USDT from two decimals to eight: a
 * `.kiko` file of a version up to `LAST_SCALE_2_USDT_VERSION` is rescaled by exactly 10^6 before it
 * is inserted, field by field on the field's own currency, and a newer file is returned as it is.
 * Throws before any row is written when a value is over the bound.
 */
export const withUsdtRescaled = (tables: UsdtRescaleTables, version: number): UsdtRescaleTables => {
  if (version > LAST_SCALE_2_USDT_VERSION) {
    return tables;
  }

  const usdtHoldingIds: ReadonlySet<string> = new Set(
    tables.holdings.filter((holding) => holding.currency === 'USDT').map((holding) => holding.id),
  );

  return {
    holdings: tables.holdings.map((holding) =>
      holding.currency === 'USDT' ? withHoldingRescaled(holding) : holding,
    ),
    transactions: tables.transactions.map((transaction) =>
      withTransactionRescaled(transaction, usdtHoldingIds),
    ),
    categoryRules: tables.categoryRules.map(
      (rule): CategoryRuleRow => ({ ...rule, matchers: withMatchersRescaled(rule.matchers) }),
    ),
    transactionTemplates: tables.transactionTemplates?.map((template) => ({
      ...template,
      draft: withDraftRescaled(template.draft),
    })),
    deletedImportKeys: tables.deletedImportKeys?.map((deletedKey) => ({
      ...deletedKey,
      externalId: withKeyRescaled(deletedKey.externalId, usdtHoldingIds),
    })),
  };
};
