import type { Currency } from '@kiko/currency/currency';
import type { HoldingRow, TransactionRow } from '@kiko/db';
import { groupAmount, majorAmountText } from '@kiko/screens/forms/amount-format';

import type { Sign } from '../row-labels';

// Present a stored (signed) minor-units amount as the unsigned major string the
// Amount input shows, pairing it with the sign chip the amount's polarity maps
// to. Kept pure so the hydration effect stays a one-liner.
export const toAmountFields = (
  currency: Currency,
  amountMinorUnits: number,
): { amount: string; sign: Sign } => {
  return {
    amount: majorAmountText(currency, amountMinorUnits),
    sign: amountMinorUnits < 0 ? 'expense' : 'income',
  };
};

// The one-shot mount seeding plan, computed by a pure module-level helper so the
// screen's hydrate effect stays a thin dispatch (three flat `if`s) instead of
// carrying the edit-vs-duplicate branching in its own cognitive-complexity
// budget. `seedHolding` is the duplicate path's FIRST step — it seats the
// `primaryHoldingId` seam from the source row so the holding (hence its
// currency scale) resolves before the amount is formatted; `seedFields` is the
// terminal step both paths share. A `null` `time` means "leave the field at its
// current value" — the duplicate keeps NOW, never copying the source timestamp.
// `final` on `seedHolding` says whether seating the seam is the LAST step: the
// duplicate path leaves it open (`false`) so its follow-up `seedFields` step
// still runs, while the empty-create (B) default seed has nothing more to
// hydrate, so it closes the `hydrated` latch immediately (`true`) — stopping the
// effect from re-running every render (which otherwise raised overlapping-act
// churn) without adding a branch to the effect.
type HydrationPlan =
  | { kind: 'wait' }
  | { kind: 'seedHolding'; holdingId: string; final: boolean }
  | {
      kind: 'seedFields';
      amount: string;
      sign: Sign;
      description: string;
      // The list label seeded in place of a blank stored description (see
      // `resolveBlankLabel`), or null when the row's own description was seeded.
      prefilledLabel: string | null;
      category: string | null;
      time: number | null;
    };

const seedFieldsFrom = (
  currency: Currency,
  row: Pick<TransactionRow, 'amountMinorUnits' | 'description' | 'category'>,
  time: number | null,
  prefilledLabel: string | null,
): HydrationPlan => {
  const fields = toAmountFields(currency, row.amountMinorUnits);

  return {
    kind: 'seedFields',
    amount: groupAmount(fields.amount),
    sign: fields.sign,
    description: prefilledLabel ?? row.description,
    prefilledLabel,
    // Lowercase the stored value to a slug key — the same normalization the
    // display resolver applies — so it lines up with the picker's option keys.
    category: row.category ? row.category.toLowerCase() : null,
    time,
  };
};

export const resolveHydration = (args: {
  existing: TransactionRow | undefined;
  duplicateSource: TransactionRow | undefined;
  holding: HoldingRow | undefined;
  primaryHoldingId: string | null;
  currency: Currency;
  // The empty-create (B) default holding to seat the seam with, already
  // resolved by `resolveDefaultPrimaryHolding` (null once seeded/picked, on a
  // non-empty-create path, or while the query is still loading). Seeds through
  // the SAME `seedHolding` step the duplicate path uses, so the empty-create
  // default rides the effect's own one-shot latch with no second effect.
  defaultPrimaryHoldingId: string | null;
  blankLabel: string | null;
}): HydrationPlan => {
  const {
    existing,
    duplicateSource,
    holding,
    primaryHoldingId,
    currency,
    defaultPrimaryHoldingId,
    blankLabel,
  } = args;

  // Edit: seed once both the row and its holding have loaded, carrying the
  // stored timestamp so a manual row round-trips its own time.
  if (existing && holding) {
    return seedFieldsFrom(currency, existing, existing.time, blankLabel);
  }

  if (duplicateSource) {
    // Duplicate step 1: seat the primary-holding seam from the source row so
    // its holding (and currency scale) resolves on the next render. NOT final —
    // step 2 (`seedFields`) still needs to run once the holding resolves.
    if (primaryHoldingId === null) {
      return { kind: 'seedHolding', holdingId: duplicateSource.holdingId, final: false };
    }

    // Duplicate step 2: seed the copied fields, dated to NOW (`time: null`).
    if (holding) {
      return seedFieldsFrom(currency, duplicateSource, null, null);
    }
  }

  // Empty-create (B): seat the primary seam from the most-recent-manual default
  // (else the first eligible option). Nothing else to hydrate — the fields stay
  // blank for a fresh add — so this is FINAL: it closes the `hydrated` latch so
  // the effect stops re-running, and a later live refresh can never clobber the
  // seam (the user's own pick goes straight through `setPrimaryHoldingId`).
  if (defaultPrimaryHoldingId !== null) {
    return { kind: 'seedHolding', holdingId: defaultPrimaryHoldingId, final: true };
  }

  return { kind: 'wait' };
};
