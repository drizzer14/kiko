import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';

import { asLots, type Lot } from '../lots';
import { asOwnershipChanges, type OwnershipChange } from '../ownership';

export type CompoundingFrequency = 'bi-weekly' | 'monthly' | 'quarterly' | 'annually';

export type DepositContribution = { amountMinorUnits: number; date: number };

export type TermDepositMeta = {
  contributions: DepositContribution[];
  annualRatePct: number;
  termMonths: number;
  recapitalization: boolean;
  compounding: CompoundingFrequency;
};

export type BondKind = 'government' | 'corporate';

// Exported alongside the type it enumerates (the same pattern
// `preciousMetals`/`metalForms`/`propertyCategories` below establish) so a
// ChipRow-building component (`ManualBondFields`, `BondIsinSection`) reads
// its own `options` from here instead of re-declaring the same literal set.
export const bondKinds: readonly BondKind[] = ['government', 'corporate'];

export type BondCouponFrequency = 'monthly' | 'quarterly' | 'semiannually' | 'annually';

export const bondCouponFrequencies: readonly BondCouponFrequency[] = [
  'monthly',
  'quarterly',
  'semiannually',
  'annually',
];

/**
 * One cash flow of an issuer's schedule (the NBU register's `payments[]`) for
 * ONE bond of its face value: `amount` is the exact decimal the issuer pays
 * per bond (a Eurobond pays fractions of a cent, so never minor units), and
 * `date` a device-local midnight, the register's own date convention.
 */
export type BondPayment = {
  date: number;
  kind: 'coupon' | 'redemption';
  amount: string;
};

// "ISIN" pre-fills a found bond's terms from the NBU register; "Manual" is
// the classic hand-entered form.
const bondEntryModes = ['isin', 'manual'] as const;

export type BondEntryMode = (typeof bondEntryModes)[number];

const isBondEntryMode = (value: unknown): value is BondEntryMode =>
  typeof value === 'string' && (bondEntryModes as readonly string[]).includes(value);

export type BondMeta = {
  quantity: number;
  faceValueMinorUnits: number;
  couponPct: number;
  purchaseDate: number;
  purchasePriceMinorUnits: number;
  maturityDate: number;
  bondKind: BondKind;
  couponFrequency: BondCouponFrequency;
  // The ISIN the bond was saved with, from either form mode, or `undefined`
  // for a bond that never carried one (including every bond saved before
  // the ISIN-mode form existed). Once saved its terms never depend on the
  // register again; it is re-shown, editable, in the edit form.
  isin?: string;
  // The form mode the bond was last saved from; it only picks the mode the
  // edit form opens in. Absent for a bond saved before it was stored.
  entryMode?: BondEntryMode;
  // The issuer's schedule kept with the holding, so its coupons never depend
  // on the ISIN still being in the register cache (a matured or delisted
  // ISIN leaves it). Absent: never captured, so the cache is read instead.
  // Empty: the user's own coupon replaced the schedule, so neither is read.
  payments?: BondPayment[];
};

const frequencies = new Set<string>(['bi-weekly', 'monthly', 'quarterly', 'annually']);

// Legacy deposits stored a now-removed 'daily' compounding option. Map any such
// record onto 'monthly' — the safe, conservative choice: it is an existing,
// well-tested calendar-anniversary mode that yields slightly LESS than the new
// default 'bi-weekly', so a migrated deposit never over-reports its value, and
// it avoids retro-fitting an opening-day anchor the record never carried.
const normalizeCompounding = (value: string): CompoundingFrequency =>
  value === 'daily' ? 'monthly' : (value as CompoundingFrequency);

const bondCouponFrequencySet = new Set<string>(bondCouponFrequencies);

const isBondCouponFrequency = (value: unknown): value is BondCouponFrequency =>
  typeof value === 'string' && bondCouponFrequencySet.has(value);

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * The metadata fields that mark a holding as owned by a sync, one per
 * source: `monobankId` (a Monobank card/jar), `walletAddress` (a BTC
 * public-address wallet), `binanceAsset` (a Binance spot balance). The
 * single source of truth for `isSyncedHolding` and for the metadata-key
 * upserts in the holdings repo.
 *
 * Guideline 5.6 remediation: `privatbankId`, `bunqId`, and `starlingId` were
 * removed — those bank-CONNECT providers were deleted entirely, and no user
 * release ever shipped a holding with one of those keys.
 */
export const syncedMetadataFields = ['monobankId', 'walletAddress', 'binanceAsset'] as const;

export type SyncedMetadataField = (typeof syncedMetadataFields)[number];

/** The balance-provider subset — everything but Monobank. */
export type ExchangeMetadataField = Exclude<SyncedMetadataField, 'monobankId'>;

/**
 * Written by a balance sync next to the provider key. It lives on the holding
 * (not `settings.lastSyncAt`) because Monobank's `lastSyncAt` doubles as the
 * statement-window cursor of the next Monobank import — a balance sync
 * touching it would silently skip Monobank transactions.
 */
export const SYNCED_AT_FIELD = 'syncedAt';

// The two stored shapes a balance sync writes (see the spec's "Data model"):
//   wallet:  { walletAddress: string; syncedAt: number }
//   Binance: { binanceAsset: 'BTC'; syncedAt: number }
// Read back through the two readers below; no separate type alias is exported
// (Knip flags an export nothing imports).

export const walletAddressOf = (metadata: unknown): string | undefined => {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const { walletAddress } = metadata;

  return typeof walletAddress === 'string' ? walletAddress : undefined;
};

/**
 * The IBAN a Monobank card sync writes next to its `monobankId` (see
 * `mapAccountToHolding` in monobank/sync.ts). Read back so the category chart
 * can build the set of the user's OWN card IBANs and tell an own-account
 * transfer from a genuine P2P payment. `undefined` when absent (jars, manual
 * holdings, crypto).
 */
export const ibanOf = (metadata: unknown): string | undefined => {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const { iban } = metadata;

  return typeof iban === 'string' ? iban : undefined;
};

export const syncedAtOf = (metadata: unknown): number | null => {
  if (!isRecord(metadata)) {
    return null;
  }

  const syncedAt = metadata[SYNCED_AT_FIELD];

  return isNumber(syncedAt) ? syncedAt : null;
};

/**
 * The Binance history-walk watermark: every window ending at or before this
 * instant is imported (`binance.transactions.ts`). Stored on the Spot
 * holding's metadata rather than `sync_state.lastSyncAt` — that column
 * already means the Monobank statement cursor for a Monobank account (see the
 * `syncState` table comment in `db/schema.ts`), the same reason `SYNCED_AT_FIELD`
 * above lives on the holding rather than `settings.lastSyncAt`.
 */
export const BINANCE_HISTORY_CURSOR_FIELD = 'binanceHistoryCursor';

/**
 * Where the capital walk's re-scan of its last window has got to. The re-scan runs on what
 * call budget the forward pass left, so on a busy account it takes several runs, and this
 * mark is how the next run resumes it. A walk-owned key like the cursors, so a balance sync
 * carries it and a disconnect resets it.
 */
export const BINANCE_HISTORY_RESCAN_CURSOR_FIELD = 'binanceHistoryRescanCursor';

/** The other three Binance walks each keep their own watermark next to the capital one. */
export const BINANCE_PAY_HISTORY_CURSOR_FIELD = 'binancePayHistoryCursor';

/** The Pay walk's re-scan mark, kept the same way as the capital walk's. */
export const BINANCE_PAY_RESCAN_CURSOR_FIELD = 'binancePayRescanCursor';

export const BINANCE_TRANSFER_HISTORY_CURSOR_FIELD = 'binanceTransferHistoryCursor';

/** The Transfer walk's re-scan mark, kept the same way as the capital walk's. */
export const BINANCE_TRANSFER_RESCAN_CURSOR_FIELD = 'binanceTransferRescanCursor';

const BINANCE_EARN_HISTORY_CURSOR_FIELD = 'binanceEarnHistoryCursor';

/**
 * The metadata keys a sync WALK owns, as opposed to a balance snapshot — today only
 * the Binance walk cursors. `upsertByMetadataKey` (holdings.repo.ts) carries these
 * over from the stored row on every balance-sync upsert, so a routine balance sync
 * (which writes a fresh `{ syncedAt, ...}` metadata object every run) never wipes a
 * walk's own progress marker.
 */
export const binanceWalkCursorFields = [
  BINANCE_HISTORY_CURSOR_FIELD,
  BINANCE_HISTORY_RESCAN_CURSOR_FIELD,
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_RESCAN_CURSOR_FIELD,
  BINANCE_TRANSFER_HISTORY_CURSOR_FIELD,
  BINANCE_TRANSFER_RESCAN_CURSOR_FIELD,
  BINANCE_EARN_HISTORY_CURSOR_FIELD,
] as const;

export type BinanceWalkCursorField = (typeof binanceWalkCursorFields)[number];

/**
 * The ground behind a past forward start that no run has read yet, one list per walk: a late
 * record can settle up to one overlap before the cursor, so that stretch must be read by a run
 * after the cursor moved on, however long the app was away. Each entry is a `{ start, end }`
 * range (not a bare day start) so a stretch too dense for one run can keep its progress. A
 * separate key from the re-scan mark, so a stop in one stretch starves neither the other
 * stretches nor the window re-scan.
 */
export const BINANCE_HISTORY_PENDING_OVERLAP_FIELD = 'binanceHistoryPendingOverlap';

export const BINANCE_PAY_PENDING_OVERLAP_FIELD = 'binancePayPendingOverlap';

export const BINANCE_TRANSFER_PENDING_OVERLAP_FIELD = 'binanceTransferPendingOverlap';

/**
 * The walk-owned keys that hold a list of ranges, not a cursor. A balance sync carries them
 * with the cursors, and a disconnect resets them to an empty list.
 */
export const binanceWalkPendingFields = [
  BINANCE_HISTORY_PENDING_OVERLAP_FIELD,
  BINANCE_PAY_PENDING_OVERLAP_FIELD,
  BINANCE_TRANSFER_PENDING_OVERLAP_FIELD,
] as const;

export type BinanceWalkPendingField = (typeof binanceWalkPendingFields)[number];

/**
 * One entry of a walk's list of owed ground: a range, or a point when tagged `kind: 'point'`. A
 * point is the ground one record the walk could not trust owes; it is never told from a range by
 * its length, and an entry with no tag is a range, which is how a list stored before the tag
 * existed reads. A walk that reads several series (the Transfer types) stores the series its
 * record was read under on a point (`series`): the point is read in that series only, and leaves
 * the list only for a record of it. A range has none.
 */
export type BinancePendingRange = {
  start: number;
  end: number;
  kind?: 'point';
  series?: string;
};

/**
 * Where a walk's round-robin over its owed points stands: the start of the point it read last.
 * The next run reads the points after it first, then wraps, so every point is read within a
 * bounded number of runs. Next to the pending list, carried over a balance sync, and dropped on
 * a disconnect (no key means "start at the oldest point").
 */
export const BINANCE_HISTORY_POINT_CURSOR_FIELD = 'binanceHistoryPointCursor';

export const BINANCE_PAY_POINT_CURSOR_FIELD = 'binancePayPointCursor';

export const BINANCE_TRANSFER_POINT_CURSOR_FIELD = 'binanceTransferPointCursor';

export const binanceWalkPointCursorFields = [
  BINANCE_HISTORY_POINT_CURSOR_FIELD,
  BINANCE_PAY_POINT_CURSOR_FIELD,
  BINANCE_TRANSFER_POINT_CURSOR_FIELD,
] as const;

export type BinanceWalkPointCursorField = (typeof binanceWalkPointCursorFields)[number];

/**
 * Where a walk's round-robin over the WINDOWS of its owed ranges stands: the end of the window it
 * read last. The window that follows it starts exactly there. The next run reads the windows that
 * start at or after it first, then wraps, so a window that is owed whole every run cannot keep
 * the windows behind it, of its own range or another, from being read. Kept like the point
 * cursor: carried over a balance sync, dropped on a disconnect (no key means "start at the
 * oldest window").
 */
export const BINANCE_HISTORY_RANGE_CURSOR_FIELD = 'binanceHistoryRangeCursor';

export const BINANCE_PAY_RANGE_CURSOR_FIELD = 'binancePayRangeCursor';

export const BINANCE_TRANSFER_RANGE_CURSOR_FIELD = 'binanceTransferRangeCursor';

export const binanceWalkRangeCursorFields = [
  BINANCE_HISTORY_RANGE_CURSOR_FIELD,
  BINANCE_PAY_RANGE_CURSOR_FIELD,
  BINANCE_TRANSFER_RANGE_CURSOR_FIELD,
] as const;

export type BinanceWalkRangeCursorField = (typeof binanceWalkRangeCursorFields)[number];

/** A field the walk writes as one number: a cursor, or the cursor of one of its round-robins. */
export type BinanceWalkNumberField =
  | BinanceWalkCursorField
  | BinanceWalkPointCursorField
  | BinanceWalkRangeCursorField;

/**
 * Where a run left a window it split and could not finish before the first span of it committed:
 * the narrowest span it asked for, which starts where the window starts. The next run that reads
 * a window with that start begins with this span, so a chain of halvings longer than one run's
 * calls goes on from where it stopped instead of starting over. A hint can only narrow a read.
 */
export type BinanceSpanHint = { start: number; end: number };

/** The passes a run reads, and the points among them: each keeps its own hints. */
export const binanceSpanHintPasses = ['forward', 'pending', 'rescan', 'point'] as const;

export type BinanceSpanHintPass = (typeof binanceSpanHintPasses)[number];

export type BinanceSpanHints = Record<BinanceSpanHintPass, BinanceSpanHint[]>;

/**
 * One key per walk, holding the hints of its four passes: carried over a balance sync and dropped
 * on a disconnect, like the cursors.
 */
export const BINANCE_HISTORY_SPAN_HINTS_FIELD = 'binanceHistorySpanHints';

export const BINANCE_PAY_SPAN_HINTS_FIELD = 'binancePaySpanHints';

export const BINANCE_TRANSFER_SPAN_HINTS_FIELD = 'binanceTransferSpanHints';

export const binanceWalkSpanHintFields = [
  BINANCE_HISTORY_SPAN_HINTS_FIELD,
  BINANCE_PAY_SPAN_HINTS_FIELD,
  BINANCE_TRANSFER_SPAN_HINTS_FIELD,
] as const;

export type BinanceWalkSpanHintField = (typeof binanceWalkSpanHintFields)[number];

/**
 * The two marks of a Monobank holding's close and reopen (see
 * `reconcileClosedHoldings` in monobank/sync.ts). Each key has one role:
 * `syncClosedFromMs` says the SYNC closed this holding (the user's own close
 * never writes it), and `statementFromMs` is the from-cursor of the next
 * statement fetch of a card or jar the sync just reopened. Only the first is dropped
 * by an upsert; the second survives one (see `carriedMetadataKeys`).
 */
export const SYNC_CLOSED_FROM_FIELD = 'syncClosedFromMs';

export const STATEMENT_FROM_FIELD = 'statementFromMs';

/**
 * `binanceWalkCursorFields` plus `statementFromMs`: what an upsert carries over
 * from the stored row. A separate list, because the Binance disconnect floor
 * reset (`withWalkOwnedMetadataResetToFloor`) must stay Binance-only and
 * never touch a Monobank card's or jar's statement cursor.
 */
const carriedMetadataKeys = [
  ...binanceWalkCursorFields,
  ...binanceWalkPendingFields,
  ...binanceWalkPointCursorFields,
  ...binanceWalkRangeCursorFields,
  ...binanceWalkSpanHintFields,
  STATEMENT_FROM_FIELD,
] as const;

const numberFieldOf =
  (field: string) =>
  (metadata: unknown): number | null => {
    if (!isRecord(metadata)) {
      return null;
    }

    const value = metadata[field];

    return isNumber(value) ? value : null;
  };

export const binanceWalkCursorOf = (
  field: BinanceWalkCursorField,
  metadata: unknown,
): number | null => numberFieldOf(field)(metadata);

const isSeries = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const asPendingRange = (value: unknown): BinancePendingRange | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const { start, end, kind, series } = value;

  if (!isNumber(start) || !isNumber(end) || start >= end) {
    return undefined;
  }

  if (kind === undefined) {
    return series === undefined ? { start, end } : undefined;
  }

  if (kind !== 'point') {
    return undefined;
  }

  if (series === undefined) {
    return { start, end, kind };
  }

  return isSeries(series) ? { start, end, kind, series } : undefined;
};

/**
 * One walk's stored pending ranges, `[]` when none is stored, `undefined` when a value is
 * stored but is not a list of well-formed ranges (`readPendingMark` logs a fixed code and
 * repairs it: all the ground before the cursor is owed once, and stored at once; a parse
 * failure must never fail a balance sync).
 */
export const binanceWalkPendingOf = (
  field: BinanceWalkPendingField,
  metadata: unknown,
): BinancePendingRange[] | undefined => {
  const stored = isRecord(metadata) ? metadata[field] : undefined;

  if (stored === undefined) {
    return [];
  }

  if (!Array.isArray(stored)) {
    return undefined;
  }

  const ranges = stored.map(asPendingRange);

  return ranges.every((range): range is BinancePendingRange => range !== undefined)
    ? ranges
    : undefined;
};

const roundRobinCursorOf = (field: string, metadata: unknown): number | null | undefined => {
  const stored = isRecord(metadata) ? metadata[field] : undefined;

  if (stored === undefined) {
    return null;
  }

  return isNumber(stored) ? stored : undefined;
};

/**
 * One walk's stored point cursor: `null` when none is stored, `undefined` when a value is stored
 * but is no finite number (the caller logs a fixed code and starts at the oldest point; a parse
 * failure must never fail a balance sync).
 */
export const binanceWalkPointCursorOf = (
  field: BinanceWalkPointCursorField,
  metadata: unknown,
): number | null | undefined => roundRobinCursorOf(field, metadata);

/** The stored range cursor, read as the point cursor is (see `binanceWalkPointCursorOf`). */
export const binanceWalkRangeCursorOf = (
  field: BinanceWalkRangeCursorField,
  metadata: unknown,
): number | null | undefined => roundRobinCursorOf(field, metadata);

const asSpanHint = (value: unknown): BinanceSpanHint | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const { start, end } = value;

  return isNumber(start) && isNumber(end) && start < end ? { start, end } : undefined;
};

const asSpanHintList = (value: unknown): BinanceSpanHint[] | undefined => {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const hints = value.map(asSpanHint);

  return hints.every((hint): hint is BinanceSpanHint => hint !== undefined) ? hints : undefined;
};

/**
 * One walk's stored span hints: none for each pass when nothing is stored, `undefined` when a
 * value is stored but is not a record of well-formed lists (the caller logs a fixed code and
 * stores no hint at once; a parse failure must never fail a balance sync).
 */
export const binanceWalkSpanHintsOf = (
  field: BinanceWalkSpanHintField,
  metadata: unknown,
): BinanceSpanHints | undefined => {
  const stored = isRecord(metadata) ? metadata[field] : undefined;

  if (stored === undefined) {
    return { forward: [], pending: [], rescan: [], point: [] };
  }

  if (!isRecord(stored)) {
    return undefined;
  }

  const forward = asSpanHintList(stored.forward);
  const pending = asSpanHintList(stored.pending);
  const rescan = asSpanHintList(stored.rescan);
  const point = asSpanHintList(stored.point);

  return forward === undefined ||
    pending === undefined ||
    rescan === undefined ||
    point === undefined
    ? undefined
    : { forward, pending, rescan, point };
};

export const syncClosedFromOf = numberFieldOf(SYNC_CLOSED_FROM_FIELD);

export const statementFromOf = numberFieldOf(STATEMENT_FROM_FIELD);

/**
 * Copies any `carriedMetadataKeys` present on `storedMetadata` onto
 * `target`, overwriting whatever (or nothing) `target` already has for that
 * key — the read-side counterpart of a balance sync's blanket metadata
 * overwrite, so a walk's own progress marker (and a reopened card's pending
 * statement cursor) survives it.
 */
export const withWalkOwnedMetadataCarried = (
  target: Record<string, unknown>,
  storedMetadata: unknown,
): Record<string, unknown> => {
  if (!isRecord(storedMetadata)) {
    return target;
  }

  return carriedMetadataKeys.reduce(
    (accumulator, key) =>
      key in storedMetadata ? { ...accumulator, [key]: storedMetadata[key] } : accumulator,
    target,
  );
};

/**
 * Resets every `binanceWalkCursorFields` entry already on `storedMetadata` to
 * `floorMs`, and every `binanceWalkPendingFields` entry to an empty list (a stale list
 * would otherwise have a reconnected different account read ranges of the old one's
 * history) — the disconnect-side counterpart of `withWalkOwnedMetadataCarried`,
 * so a disconnected Binance connection's watermark cannot leak into a
 * DIFFERENTLY-owned reconnect (`disconnectCryptoAccount`,
 * crypto-sync/disconnect.ts). Setting the floor rather than deleting the key
 * matters: a deleted key falls back to the legacy `latestTransactionTime`
 * cursor, which a reconnected DIFFERENT Binance account would inherit as if it
 * were its own already-imported history. Every `binanceWalkPointCursorFields`,
 * `binanceWalkRangeCursorFields` and `binanceWalkSpanHintFields` entry is dropped: no key means
 * "start at the oldest point or range, with no span to resume", and a deleted key there has no
 * legacy fallback. `undefined` when nothing needed resetting, so a caller can skip a redundant
 * write.
 */
export const withWalkOwnedMetadataResetToFloor = (
  storedMetadata: unknown,
  floorMs: number,
): Record<string, unknown> | undefined => {
  const droppedKeys: readonly string[] = [
    ...binanceWalkPointCursorFields,
    ...binanceWalkRangeCursorFields,
    ...binanceWalkSpanHintFields,
  ];
  const walkOwnedKeys: readonly string[] = [
    ...binanceWalkCursorFields,
    ...binanceWalkPendingFields,
    ...droppedKeys,
  ];

  if (!isRecord(storedMetadata) || !walkOwnedKeys.some((key) => key in storedMetadata)) {
    return undefined;
  }

  const storedKeys = (keys: readonly string[]) => keys.filter((key) => key in storedMetadata);
  const withoutDroppedKeys = Object.fromEntries(
    Object.entries(storedMetadata).filter(([key]) => !droppedKeys.includes(key)),
  );

  return {
    ...withoutDroppedKeys,
    ...Object.fromEntries(storedKeys(binanceWalkCursorFields).map((key) => [key, floorMs])),
    ...Object.fromEntries(storedKeys(binanceWalkPendingFields).map((key) => [key, []])),
  };
};

const asContribution = (value: unknown): DepositContribution | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { amountMinorUnits, date } = value;

  if (!isNumber(amountMinorUnits) || !isNumber(date)) {
    return null;
  }

  return { amountMinorUnits, date };
};

const readContributions = (value: Record<string, unknown>): DepositContribution[] | null => {
  const { contributions, principalMinorUnits, startDate } = value;

  if (Array.isArray(contributions)) {
    const parsed = contributions.map(asContribution);

    if (parsed.length > 0 && parsed.every((c): c is DepositContribution => c !== null)) {
      return [...parsed].sort((a, b) => a.date - b.date);
    }

    return null;
  }

  if (isNumber(principalMinorUnits) && isNumber(startDate)) {
    return [{ amountMinorUnits: principalMinorUnits, date: startDate }];
  }

  return null;
};

export const asTermDepositMeta = (value: unknown): TermDepositMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { annualRatePct, termMonths, recapitalization, compounding } = value;
  const contributions = readContributions(value);
  // Accept the legacy 'daily' literal so existing deposits still parse; it is
  // normalized to 'monthly' below rather than rejected.
  if (
    contributions === null ||
    !isNumber(annualRatePct) ||
    !isNumber(termMonths) ||
    typeof recapitalization !== 'boolean' ||
    typeof compounding !== 'string' ||
    !(frequencies.has(compounding) || compounding === 'daily')
  ) {
    return null;
  }

  return {
    contributions,
    annualRatePct,
    termMonths,
    recapitalization,
    compounding: normalizeCompounding(compounding),
  };
};

const asBondPayment = (value: unknown): BondPayment | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { date, kind, amount } = value;

  if (
    !isNumber(date) ||
    (kind !== 'coupon' && kind !== 'redemption') ||
    !isPlainDecimalString(amount)
  ) {
    return null;
  }

  return { date, kind, amount };
};

/**
 * All-or-nothing, like `asLots`: a schedule missing one payment would
 * silently drop a cash flow from every coupon and yield read from it. Also
 * the check a schedule passes before it is written into `BondMeta`, so a
 * stored one always parses back.
 */
export const asBondPayments = (value: unknown): BondPayment[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed = value.map(asBondPayment);

  return parsed.every((payment): payment is BondPayment => payment !== null) ? parsed : null;
};

/**
 * Whether a stored bond carries a price the user entered. `asBondMeta` gives a
 * bond without one the nominal as its price (for the ledger and expected
 * profit); a yield to maturity needs the real price, so it asks here.
 */
export const hasStoredBondPurchasePrice = (value: unknown): boolean =>
  isRecord(value) && isNumber(value.purchasePriceMinorUnits);

export const asBondMeta = (value: unknown): BondMeta | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { quantity, faceValueMinorUnits, couponPct, purchaseDate, maturityDate, bondKind, isin } =
    value;

  if (
    !isNumber(quantity) ||
    !isNumber(faceValueMinorUnits) ||
    !isNumber(couponPct) ||
    !isNumber(purchaseDate) ||
    !isNumber(maturityDate)
  ) {
    return null;
  }

  const { couponFrequency, purchasePriceMinorUnits, payments, entryMode } = value;
  const parsedPayments = foldMap(maybe(payments), asBondPayments);

  // A PRESENT bondKind/couponFrequency/purchasePriceMinorUnits/isin/payments
  // that fails its own check is BAD INPUT — reject the whole record, same as
  // any other wrong-type field above. An ABSENT (undefined) field is the
  // legacy shape every stored pre-field row still has, and keeps its
  // documented default below — the decision targets bad input, not missing
  // input. A present `payments: null` is bad input too: `maybe` would read it
  // as absent.
  if (
    (bondKind !== undefined && bondKind !== 'government' && bondKind !== 'corporate') ||
    (couponFrequency !== undefined && !isBondCouponFrequency(couponFrequency)) ||
    (purchasePriceMinorUnits !== undefined && !isNumber(purchasePriceMinorUnits)) ||
    (isin !== undefined && typeof isin !== 'string') ||
    payments === null ||
    parsedPayments === null
  ) {
    return null;
  }

  // `purchasePriceMinorUnits` is the total actually paid (separate from nominal
  // = quantity * faceValue). Legacy bonds predate this field; default it to the
  // nominal so the purchase ledger entry and expected-profit both read as
  // break-even until the user edits the real price in.
  const nominalMinorUnits = quantity * faceValueMinorUnits;

  return {
    quantity,
    faceValueMinorUnits,
    couponPct,
    purchaseDate,
    purchasePriceMinorUnits: isNumber(purchasePriceMinorUnits)
      ? purchasePriceMinorUnits
      : nominalMinorUnits,
    maturityDate,
    bondKind: bondKind === 'corporate' ? 'corporate' : 'government',
    couponFrequency: isBondCouponFrequency(couponFrequency) ? couponFrequency : 'annually',
    isin: typeof isin === 'string' ? isin : undefined,
    ...(isBondEntryMode(entryMode) ? { entryMode } : {}),
    ...foldMap(maybe(parsedPayments), (schedule) => ({ payments: schedule })),
  };
};

// The closed set of `property_item` categories. A `const` tuple, per
// kiko-code-style: the derived union type sits directly after it, and
// membership is tested on the tuple itself rather than a parallel `Set` —
// this set is small, so a second runtime structure would be redundant.
// Exported: the property-section form reads it directly to build its
// category ChipRow's `options`.
export const propertyCategories = [
  'real_estate',
  'vehicle',
  'valuable',
  'loan_given',
  'business_share',
  'other',
] as const;

export type PropertyCategory = (typeof propertyCategories)[number];

const isPropertyCategory = (value: unknown): value is PropertyCategory =>
  typeof value === 'string' && (propertyCategories as readonly string[]).includes(value);

/**
 * The `property_item`'s category, read LENIENTLY: a missing or unrecognized
 * value falls back to `'other'` rather than treating the whole metadata blob
 * as invalid the way `asPropertyMeta` does (mirrors `walletAddressOf`'s
 * tolerant-reader shape). This is what pre-selects the property form's Type
 * field in edit mode, independent of whether the metadata's `lots` also
 * happen to parse.
 */
export const propertyCategoryOf = (metadata: unknown): PropertyCategory => {
  if (!isRecord(metadata)) {
    return 'other';
  }

  const { category } = metadata;

  return isPropertyCategory(category) ? category : 'other';
};

// How the user last typed the share; it only picks the form's input mode and
// the detail line's wording, never the value.
export const ownershipInputs = ['percent', 'fraction'] as const;

export type OwnershipInput = (typeof ownershipInputs)[number];

const isOwnershipInput = (value: unknown): value is OwnershipInput =>
  typeof value === 'string' && (ownershipInputs as readonly string[]).includes(value);

export type PropertyMeta = {
  category: PropertyCategory;
  lots: Lot[];
  /** Absent reads the whole asset; see `ownershipAt`. */
  ownership?: OwnershipChange[];
  ownershipInput?: OwnershipInput;
};

export const asPropertyMeta = (value: unknown): PropertyMeta | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { category, lots, ownership, ownershipInput } = value;
  const parsedLots = asLots(lots);
  const parsedOwnership = foldMap(maybe(ownership), asOwnershipChanges);

  if (!isPropertyCategory(category) || parsedLots === null || parsedOwnership === null) {
    return null;
  }

  return {
    category,
    lots: parsedLots,
    ...foldMap(maybe(parsedOwnership), (changes) => ({ ownership: changes })),
    ...(isOwnershipInput(ownershipInput) ? { ownershipInput } : {}),
  };
};

// The closed set of precious metals Kiko prices via NBU, keyed by the
// same slug `metalInstrument` namespaces its `price_points.instrument` under
// (`metal:<XAU|XAG|XPT|XPD>` — `src/prices/instrument/`). Exported so the
// holding form's Type select (`MetalTypeField`) can list each metal as its
// own row, mirroring `propertyCategories`.
export const preciousMetals = ['XAU', 'XAG', 'XPT', 'XPD'] as const;

export type Metal = (typeof preciousMetals)[number];

export const isMetal = (value: unknown): value is Metal =>
  typeof value === 'string' && (preciousMetals as readonly string[]).includes(value);

// How the metal is physically held. Exported so the metal section can build
// its Form ChipRow's `options`.
export const metalForms = ['bar', 'coin', 'bank_account'] as const;

export type MetalForm = (typeof metalForms)[number];

const isMetalForm = (value: unknown): value is MetalForm =>
  typeof value === 'string' && (metalForms as readonly string[]).includes(value);

// The unit a lot's `quantityDelta` is denominated in. 'g' values convert to
// troy ounces (the unit NBU quotes against) via the fixed constant
// `priced-value.ts` multiplies by; 'oz' needs no conversion.
export const metalUnits = ['g', 'oz'] as const;

export type MetalUnit = (typeof metalUnits)[number];

const isMetalUnit = (value: unknown): value is MetalUnit =>
  typeof value === 'string' && (metalUnits as readonly string[]).includes(value);

// A plain (unsigned) decimal string, matching the `quantityDelta`/`purity`
// money-precision rule (kiko-domain): a scaled decimal STRING, never a
// `number`, so an arbitrary-precision purity fraction never drifts through
// float math. Unlike `lots.ts`'s `SIGNED_DECIMAL_PATTERN`, a purity can never
// be negative, so no leading '-' is accepted.
const PLAIN_DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

const isPlainDecimalString = (value: unknown): value is string =>
  typeof value === 'string' && PLAIN_DECIMAL_PATTERN.test(value);

export type MetalMeta = {
  metal: Metal;
  form: MetalForm;
  unit: MetalUnit;
  purity: string;
  lots: Lot[];
};

export const asMetalMeta = (value: unknown): MetalMeta | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { metal, form, unit, purity, lots } = value;
  const parsedLots = asLots(lots);

  if (
    !isMetal(metal) ||
    !isMetalForm(form) ||
    !isMetalUnit(unit) ||
    !isPlainDecimalString(purity) ||
    parsedLots === null
  ) {
    return null;
  }

  return { metal, form, unit, purity, lots: parsedLots };
};

// The closed set of `loan` kinds: the last, `personal`, is
// "money the user owes a person" — an informal debt, typically `schedule:
// 'none'`, but not enforced to be (a person-to-person loan can still carry
// interest and a schedule).
export const loanKinds = ['mortgage', 'car_loan', 'consumer_loan', 'personal'] as const;

export type LoanKind = (typeof loanKinds)[number];

const isLoanKind = (value: unknown): value is LoanKind =>
  typeof value === 'string' && (loanKinds as readonly string[]).includes(value);

/**
 * A loan's kind, read LENIENTLY off its metadata: a missing or unrecognized
 * kind is `undefined` rather than the whole blob being invalid the way
 * `asLoanMeta` treats it. Unlike a property's category there is no "other"
 * kind to fall back to, so the caller picks its own fallback (the loan
 * card's glyph falls back to the loan type's own).
 */
export const loanKindOf = (metadata: unknown): LoanKind | undefined =>
  isRecord(metadata) && isLoanKind(metadata.kind) ? metadata.kind : undefined;

// `annuity`/`differentiated` compute the outstanding balance at read time from
// the schedule math (`src/holdings/loan-schedule/`); `none` is an informal
// debt whose outstanding is a manual series, the same `holding:<id>`
// price-point mechanism Property uses (kiko-pricing).
export const loanSchedules = ['annuity', 'differentiated', 'none'] as const;

export type LoanSchedule = (typeof loanSchedules)[number];

const isLoanSchedule = (value: unknown): value is LoanSchedule =>
  typeof value === 'string' && (loanSchedules as readonly string[]).includes(value);

export type LoanMeta = {
  kind: LoanKind;
  principalMinorUnits: number;
  startDate: number;
  // Required by the form unless `schedule === 'none'` (an informal debt has
  // no known rate/term); left `undefined` for a `none` loan, mirroring
  // `BondMeta.isin`'s optional-field convention.
  annualRatePct?: number;
  termMonths?: number;
  schedule: LoanSchedule;
  // The three inputs the automatic loan-payment matcher's own "third
  // signal" reads (`src/loans/payment-matcher/`) — every one optional,
  // entered on the loan form, and `undefined` for every loan saved before
  // this field existed (the same optional-field convention as
  // `BondMeta.isin` above). `paymentHoldingId` is the holding the user
  // usually pays this loan FROM; `lenderIban` is compared against a
  // candidate payment's own `counterIban`. `lenderIban` is the lender's
  // bank IBAN, not the user's own — never logged (kiko-compliance).
  paymentHoldingId?: string;
  lenderName?: string;
  lenderIban?: string;
};

export const asLoanMeta = (value: unknown): LoanMeta | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { kind, principalMinorUnits, startDate, annualRatePct, termMonths, schedule } = value;

  if (
    !isLoanKind(kind) ||
    !isNumber(principalMinorUnits) ||
    !isNumber(startDate) ||
    !isLoanSchedule(schedule) ||
    (annualRatePct !== undefined && !isNumber(annualRatePct)) ||
    (termMonths !== undefined && !isNumber(termMonths))
  ) {
    return null;
  }

  const { paymentHoldingId, lenderName, lenderIban } = value;

  if (
    (paymentHoldingId !== undefined && typeof paymentHoldingId !== 'string') ||
    (lenderName !== undefined && typeof lenderName !== 'string') ||
    (lenderIban !== undefined && typeof lenderIban !== 'string')
  ) {
    return null;
  }

  return {
    kind,
    principalMinorUnits,
    startDate,
    annualRatePct,
    termMonths,
    schedule,
    paymentHoldingId,
    lenderName,
    lenderIban,
  };
};
