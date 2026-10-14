import type { Currency } from '@kiko/currency/currency';
import type { HoldingRow, TransactionRow } from '@kiko/db';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';
import { groupAmount, majorAmountText } from '@kiko/screens/forms/amount-format';
import type { TemplateDraft, TemplateMode } from '@kiko/transaction-templates/draft';

import { settleMode } from '../mode-options';
import type { ChangeReturnRow, Sign } from '../row-labels';
import { emptyReturnsInOtherCurrency } from '../holding-change';

// The template's own mode union lives in a feature, which must not import this screen's, so each
// is assigned to the other here: `tsc` fails if either union gains a member the other lacks.
const toFormMode = (mode: TemplateMode): FormMode => mode;

export const toTemplateMode = (mode: FormMode): TemplateMode => mode;

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
//
// A template fills through this same plan (one fill path): its fields ride the same two steps,
// with `time: null` so the date stays at now. `mode`, `destinationHoldingId`, `valueIn` and
// `returns` are what a template can set beyond a transaction row, and a row's plan carries
// today's values for them (its sign, no destination, no Value in, one empty return), so a
// Duplicate and an Edit seed what they always did. `templateName` and `clearsHolding` ride only
// a template's plan: `clearsHolding` empties the seam whenever the template holds no holding, so
// the holding the form falls back to is the page's (an add from a holding) or none (the form asks).
type ReturnSeed = { holdingId: string | null; amount: string };

export type SeedFieldsPlan = {
  kind: 'seedFields';
  amount: string;
  mode: FormMode;
  description: string;
  // The list label seeded in place of a blank stored description (see
  // `resolveBlankLabel`), or null when the row's own description was seeded.
  prefilledLabel: string | null;
  category: string | null;
  time: number | null;
  destinationHoldingId: string | null;
  valueIn: string;
  returns: ReturnSeed[];
  templateName?: string | null;
  clearsHolding?: boolean;
};

type HydrationPlan =
  | { kind: 'wait' }
  | { kind: 'seedHolding'; holdingId: string; final: boolean }
  | SeedFieldsPlan;

type SeedFieldsSetters = {
  setAmount: (amount: string) => void;
  setMode: (mode: FormMode) => void;
  setDescription: (description: string) => void;
  setPrefilledLabel: (prefilledLabel: string | null) => void;
  seedCategory: (category: string | null, seededDescription: string) => void;
  setTime: (time: number) => void;
  setDestinationHoldingId: (holdingId: string | null) => void;
  setValueIn: (valueIn: string) => void;
  setChangeReturns: (rows: ChangeReturnRow[]) => void;
  setPrimaryHoldingId: (holdingId: string | null) => void;
  setTemplateName: (name: string) => void;
};

// Applies a `seedFields` plan with the form's own setters, for every entry that fills (Edit,
// Duplicate, a template). Kept out of the screen's effect so its branches stay out of the
// screen's cognitive-complexity budget.
export const applySeedFields = (
  plan: SeedFieldsPlan,
  setters: SeedFieldsSetters,
  takeReturnId: () => number,
): void => {
  setters.setAmount(plan.amount);
  setters.setMode(plan.mode);
  setters.setDescription(plan.description);
  setters.setPrefilledLabel(plan.prefilledLabel);
  // One call holds the category, flags a non-null one as a hand pick (a Duplicate's or a
  // template's category must survive a retyped description, and save with the hand-pick flag),
  // and settles the description, so a seed without a category shows what the rules give it. A
  // template picked after a hand pick therefore leaves the rule pre-select free to run again.
  setters.seedCategory(plan.category, plan.description);

  // A null `time` keeps the field at NOW — a Duplicate and a template never copy a timestamp;
  // the edit path carries the stored time.
  if (plan.time !== null) {
    setters.setTime(plan.time);
  }

  setters.setDestinationHoldingId(plan.destinationHoldingId);
  setters.setValueIn(plan.valueIn);
  setters.setChangeReturns(plan.returns.map((row) => ({ id: takeReturnId(), ...row })));

  if (plan.clearsHolding) {
    setters.setPrimaryHoldingId(null);
  }

  // Only an Edit template carries its name in; every other entry leaves the name field empty.
  if (typeof plan.templateName === 'string') {
    setters.setTemplateName(plan.templateName);
  }
};

const emptyReturns = (): ReturnSeed[] => [{ holdingId: null, amount: '' }];

// Lowercase the stored value to a slug key — the same normalization the display resolver
// applies — so it lines up with the picker's option keys.
const categoryKey = (category: string | null): string | null =>
  category ? category.toLowerCase() : null;

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
    mode: fields.sign,
    description: prefilledLabel ?? row.description,
    prefilledLabel,
    category: categoryKey(row.category),
    time,
    destinationHoldingId: null,
    valueIn: '',
    returns: emptyReturns(),
  };
};

// The stored scale, never the picked holding's: the holding may be gone, and a fallback currency
// would put the point in the wrong place (a JPY 1050 read as UAH is 10.50).
const storedAmountText = (currency: Currency | null, minorUnits: number | null): string =>
  currency === null || minorUnits === null
    ? ''
    : groupAmount(majorAmountText(currency, minorUnits));

// The mode the seated holding offers: a stored one it does not (an exchange or a split from a
// card, which cannot be one) falls back to an expense, which both of them are. Nothing seated
// leaves the mode as stored, for the form to settle once a holding is picked.
const modeFor = (mode: TemplateMode, seated: HoldingRow | undefined): FormMode => {
  const formMode = toFormMode(mode);

  return seated === undefined ? formMode : settleMode(formMode, seated);
};

// The seated holding cannot be its own destination, or the write would refuse it: the form asks.
// A destination with none left (dropped here, or nulled because it was closed or deleted) takes
// the Value in with it, which was typed in that destination's currency.
const exchangeFor = (
  draft: TemplateDraft,
  seated: HoldingRow | undefined,
): { destinationHoldingId: string | null; valueIn: string } => {
  const destination = draft.exchange?.destinationHoldingId ?? null;

  if (destination === null || destination === seated?.id) {
    return { destinationHoldingId: null, valueIn: '' };
  }

  return {
    destinationHoldingId: destination,
    valueIn: storedAmountText(
      draft.exchange?.destinationCurrency ?? null,
      draft.exchange?.valueInMinorUnits ?? null,
    ),
  };
};

// The return rows a template fills. A return holding is in the template's payer currency, but a
// template whose own holding is gone is seated on the page's, which may be in another one: that
// row loses its holding, with the same rule a holding pick applies, and the form asks.
const returnsFor = (
  draft: TemplateDraft,
  seated: HoldingRow | undefined,
  holdings: readonly HoldingRow[],
): ReturnSeed[] => {
  const rows =
    draft.returns.length === 0
      ? emptyReturns()
      : draft.returns.map((row) => ({
          holdingId: row.holdingId,
          amount: storedAmountText(draft.currency, row.amountMinorUnits),
        }));

  return seated === undefined ? rows : emptyReturnsInOtherCurrency(rows, seated.currency, holdings);
};

const seedFieldsFromTemplate = (
  draft: TemplateDraft,
  templateName: string | null,
  seated: HoldingRow | undefined,
  holdings: readonly HoldingRow[],
): HydrationPlan => {
  return {
    kind: 'seedFields',
    amount: storedAmountText(draft.currency, draft.amountMinorUnits),
    mode: modeFor(draft.mode, seated),
    description: draft.description,
    prefilledLabel: null,
    category: categoryKey(draft.category),
    time: null,
    ...exchangeFor(draft, seated),
    returns: returnsFor(draft, seated, holdings),
    templateName,
    clearsHolding: draft.holdingId === null,
  };
};

// A template with a holding takes the Duplicate's two steps: seat the seam from it (unless it
// already is), then seed once that holding has loaded. A template with none seeds at once and
// empties the seam, so the holding is the page's (`pageHolding`, an add from a holding) or none,
// and the form asks.
const resolveTemplateHydration = (args: {
  templateDraft: TemplateDraft;
  templateName: string | null;
  primaryHoldingId: string | null;
  holding: HoldingRow | undefined;
  pageHolding: HoldingRow | undefined;
  holdings: readonly HoldingRow[];
}): HydrationPlan => {
  const { templateDraft, templateName, primaryHoldingId, holding, pageHolding, holdings } = args;

  if (templateDraft.holdingId === null) {
    return seedFieldsFromTemplate(templateDraft, templateName, pageHolding, holdings);
  }

  if (templateDraft.holdingId !== primaryHoldingId) {
    return { kind: 'seedHolding', holdingId: templateDraft.holdingId, final: false };
  }

  return holding
    ? seedFieldsFromTemplate(templateDraft, templateName, holding, holdings)
    : { kind: 'wait' };
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
  // The picked template's draft, its references already resolved against the live holdings and
  // categories (`resolveDraftReferences`). Null on every entry that fills from none, and while
  // what it resolves against is still loading.
  templateDraft: TemplateDraft | null;
  templateName: string | null;
  // The holding an add from a holding names, which a template with no holding of its own falls
  // back to. Undefined on every other entry.
  pageHolding: HoldingRow | undefined;
  // Every holding the form reads, for the currency of a return holding.
  holdings: readonly HoldingRow[];
}): HydrationPlan => {
  const {
    existing,
    duplicateSource,
    holding,
    primaryHoldingId,
    currency,
    defaultPrimaryHoldingId,
    blankLabel,
    templateDraft,
    templateName,
    pageHolding,
    holdings,
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

  // A picked template runs before the default holding: it seats its own holding, or clears the
  // seam, so a default seated first would only be overwritten.
  if (templateDraft) {
    return resolveTemplateHydration({
      templateDraft,
      templateName,
      primaryHoldingId,
      holding,
      pageHolding,
      holdings,
    });
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
