import { dayKeyOf } from '@kiko/prices/price-book';
import { addDecimal, compareDecimal } from '@kiko/currency/decimal';

/**
 * One quantity/cost event against a priced, ledgerless holding
 * (`isLedgerlessHoldingType` — a bond, a term deposit, or a `property_item`,
 * per kiko-domain): a purchase adds a positive `quantityDelta`/`costMinorUnits`
 * pair, a sale a negative one. `day` is a `price_points.day`-style key — a
 * UTC-midnight epoch value in MILLISECONDS standing for a LOCAL calendar day
 * (see `dayKeyOf`, `src/prices/price-book/`) — not a raw instant, so a lot
 * dated the same calendar day as a later read is included regardless of
 * time-of-day. `quantityDelta` is a scaled decimal STRING (kiko-domain money
 * precision), never a `number` — added/subtracted only through the BigInt
 * decimal helpers so an arbitrary-precision share/metal quantity never drifts
 * through float math. `costMinorUnits` is an integer minor-units amount, the
 * same convention as every other stored amount in this app.
 */
export type Lot = {
  day: number;
  quantityDelta: string;
  costMinorUnits: number;
};

// A signed plain decimal string: an optional leading '-', digits, an
// optional fractional part. Unlike `normalizeDecimal` (user-typed-input
// normalization, unsigned only), a stored `quantityDelta` is a SIGNED
// decimal — a sale's delta is negative — so this validator accepts a sign.
const SIGNED_DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asLot = (value: unknown): Lot | null => {
  if (!isRecord(value)) {
    return null;
  }

  const { day, quantityDelta, costMinorUnits } = value;

  if (
    typeof day !== 'number' ||
    typeof quantityDelta !== 'string' ||
    !SIGNED_DECIMAL_PATTERN.test(quantityDelta) ||
    typeof costMinorUnits !== 'number'
  ) {
    return null;
  }

  return { day, quantityDelta, costMinorUnits };
};

/**
 * Parses a stored `holdings.metadata.lots` value. Returns null for anything
 * that is not an array of valid `Lot` shapes — including a single invalid
 * entry among otherwise-valid ones, matching `asBondMeta`/`asTermDepositMeta`'s
 * all-or-nothing contract (`src/holdings/holding-metadata/`).
 */
export const asLots = (value: unknown): Lot[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed = value.map(asLot);

  return parsed.every((lot): lot is Lot => lot !== null) ? parsed : null;
};

/**
 * The quantity held as of `instant`'s LOCAL calendar day: every lot dated at
 * or before that day, summed exactly via the decimal-string helpers (never
 * `Number` arithmetic on a stored quantity). Clamped to never go below
 * `"0"` — a sell delta larger than the held quantity must not read as a
 * negative holding.
 */
export const quantityAt = (lots: readonly Lot[], instant: number): string => {
  const day = dayKeyOf(instant);
  const total = lots
    .filter((lot) => lot.day <= day)
    .reduce((sum, lot) => addDecimal(sum, lot.quantityDelta), '0');

  return compareDecimal(total, '0') < 0 ? '0' : total;
};

/**
 * The most a sell dated `instant`'s LOCAL calendar day may take: the LOWEST
 * running quantity from that day onward — held on the day itself, then after
 * each later lot in day order. A backdated sell must leave enough for every
 * sell already recorded after it, or the quantity on that later day would go
 * negative. Clamped to never go below `"0"`, like `quantityAt`.
 */
export const sellableQuantityAt = (lots: readonly Lot[], instant: number): string => {
  const day = dayKeyOf(instant);
  const heldOnDay = lots
    .filter((lot) => lot.day <= day)
    .reduce((sum, lot) => addDecimal(sum, lot.quantityDelta), '0');
  const { lowest } = lots
    .filter((lot) => lot.day > day)
    .sort((first, second) => first.day - second.day)
    .reduce(
      (state, lot) => {
        const running = addDecimal(state.running, lot.quantityDelta);

        return {
          running,
          lowest: compareDecimal(running, state.lowest) < 0 ? running : state.lowest,
        };
      },
      { running: heldOnDay, lowest: heldOnDay },
    );

  return compareDecimal(lowest, '0') < 0 ? '0' : lowest;
};

/**
 * The cost basis, in minor units, as of `instant`'s LOCAL calendar day: every
 * lot dated at or before that day, summed. `costMinorUnits` is an integer
 * minor-units amount (kiko-domain), so plain `Number` addition is exact here
 * — unlike `quantityAt`, which sums decimal-string quantities.
 */
export const costBasisMinorAt = (lots: readonly Lot[], instant: number): number => {
  const day = dayKeyOf(instant);

  return lots.filter((lot) => lot.day <= day).reduce((sum, lot) => sum + lot.costMinorUnits, 0);
};
