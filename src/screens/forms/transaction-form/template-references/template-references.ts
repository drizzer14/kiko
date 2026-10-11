import maybe, { foldMap } from 'fnts/maybe';
import type { TemplateDraft } from '@kiko/transaction-templates/draft';
import { toTransactionTemplate } from '@kiko/transaction-templates/repo';
import type { AccountRow, HoldingRow, TransactionTemplateRow } from '@kiko/db';
import { isExchangeCreateDestinationType } from '@kiko/holdings/exchange-destination';

import { buildExchangeOptions, buildPrimaryOptions, buildReturnOptions } from '../holding-options';

type ReferenceOptions = {
  primaryIds: ReadonlySet<string>;
  exchangeIds: ReadonlySet<string>;
  returnIds: ReadonlySet<string>;
  categoryKeys: ReadonlySet<string>;
};

const idsOf = (options: readonly { id: string }[]): ReadonlySet<string> =>
  new Set(options.map((option) => option.id));

// The ids a stored draft may still point at, read from the same option builders the form's own
// pickers use, so a template can never seat a holding the picker would not offer: closed, synced,
// or of a type the slot refuses. The destination excludes the draft's own source, and the returns
// are the payer's currency, which a draft without one cannot match.
type ReferenceSource = {
  holdings: readonly HoldingRow[];
  accountNameById: ReadonlyMap<string, string>;
  accountOrderById: ReadonlyMap<string, number>;
  accountById: ReadonlyMap<string, AccountRow>;
  categoryKeys: readonly string[];
};

export const buildReferenceOptions = (
  draft: TemplateDraft,
  source: ReferenceSource,
): ReferenceOptions => {
  const { holdings, accountNameById, accountOrderById, accountById, categoryKeys } = source;
  const { currency } = draft;

  return {
    primaryIds: idsOf(
      buildPrimaryOptions(holdings, accountNameById, accountOrderById, accountById),
    ),
    exchangeIds: idsOf(
      buildExchangeOptions(
        holdings,
        accountNameById,
        accountOrderById,
        draft.holdingId ?? undefined,
        isExchangeCreateDestinationType,
      ),
    ),
    returnIds:
      currency === null
        ? new Set()
        : idsOf(
            buildReturnOptions(
              holdings,
              accountNameById,
              accountOrderById,
              accountById,
              currency,
              new Set(),
            ),
          ),
    categoryKeys: new Set(categoryKeys),
  };
};

const keepIn = (ids: ReadonlySet<string>, holdingId: string | null): string | null =>
  holdingId !== null && ids.has(holdingId) ? holdingId : null;

// A stored draft can point at something that has been deleted, closed or synced since it was
// saved. Each reference the form cannot offer becomes null, so the fill leaves that field empty
// and the user picks again.
export const resolveDraftReferences = (
  draft: TemplateDraft,
  options: ReferenceOptions,
): TemplateDraft => ({
  ...draft,
  holdingId: keepIn(options.primaryIds, draft.holdingId),
  category:
    draft.category !== null && options.categoryKeys.has(draft.category.toLowerCase())
      ? draft.category
      : null,
  exchange:
    foldMap(maybe(draft.exchange), (exchange) => ({
      ...exchange,
      destinationHoldingId: keepIn(options.exchangeIds, exchange.destinationHoldingId),
    })) ?? null,
  returns: draft.returns.map((row) => ({
    ...row,
    holdingId: keepIn(options.returnIds, row.holdingId),
  })),
});

// The draft the hydration plan fills from, and the name it carries. References resolve against the
// holdings, accounts and categories, so nothing seeds until every one of those reads has settled
// (a draft resolved against a list still loading would drop every reference), and nothing seeds
// once the form is filled, so a live refresh of the template never costs a resolve. The name is
// carried only when the entry edits the template (`carriesName`): a transaction made from one has
// no name of its own to fill.
export const resolveTemplateSeed = (args: {
  row: TransactionTemplateRow | undefined;
  isReady: boolean;
  isHydrated: boolean;
  carriesName: boolean;
  source: ReferenceSource;
}): { templateDraft: TemplateDraft | null; templateName: string | null } => {
  const { row, isReady, isHydrated, carriesName, source } = args;

  if (!isReady || isHydrated || row === undefined) {
    return { templateDraft: null, templateName: null };
  }

  const { draft, name } = toTransactionTemplate(row);

  return {
    templateDraft: resolveDraftReferences(draft, buildReferenceOptions(draft, source)),
    templateName: carriesName ? name : null,
  };
};
