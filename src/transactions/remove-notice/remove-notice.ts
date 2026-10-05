import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';

export type ExchangeRemoval =
  // The other legs are the user's rows and go with this one; `names` are the
  // holdings they sit on. `keptNames` are the holdings of a bank-owned leg of
  // the same pair that stays, present only when there is one.
  | { kind: 'deleted'; names: string[]; keptNames?: string[] }
  // The other leg is the bank's row and stays; `names` are the holdings it sits on.
  | { kind: 'syncedKept'; names: string[] }
  // The row names an exchange partner that cannot be proven: `name` is the
  // holding the marker points at, absent when that holding is gone.
  | { kind: 'missing'; name?: string };

export type DepositRemoval = {
  name: string;
  // Whether one contribution can be matched to the row and removed with it.
  matched: boolean;
};

/** What deleting one transaction takes with it, read before the delete for the
 * confirm text and read again inside the delete. */
export type RemovePlan = {
  // Every other row of the split group goes with this one.
  split: boolean;
  exchange?: ExchangeRemoval;
  deposit?: DepositRemoval;
};

const exchangeSentence = (exchange: ExchangeRemoval, t: TFunction): string =>
  match(exchange)
    .with({ kind: 'deleted' }, ({ names }) =>
      t('transactions.deleteLinked.exchange', { name: names.join(', ') }),
    )
    .with({ kind: 'syncedKept' }, ({ names }) =>
      t('transactions.deleteLinked.exchangeSyncedKept', { name: names.join(', ') }),
    )
    .with({ kind: 'missing' }, ({ name }) =>
      name === undefined
        ? t('transactions.deleteLinked.exchangeUnlinkedPlain')
        : t('transactions.deleteLinked.exchangeUnlinked', { name }),
    )
    .exhaustive();

const depositSentence = ({ name, matched }: DepositRemoval, t: TFunction): string =>
  t(matched ? 'transactions.deleteLinked.deposit' : 'transactions.deleteLinked.depositKept', {
    name,
  });

/** The sentences that exist, one space apart, or `undefined` when none does. */
export const joinNoticeSentences = (...sentences: (string | undefined)[]): string | undefined => {
  const present = sentences.filter((sentence): sentence is string => sentence !== undefined);

  return present.length === 0 ? undefined : present.join(' ');
};

/** What deleting holdings takes with them from OTHER holdings, read before the
 * delete for the confirm text and read again inside the delete. Every field
 * lists holding names (sorted, so the text does not depend on read order),
 * never ids; a holding that is deleted too is never named. */
export type RemoveHoldingsPlan = {
  // Linked transactions elsewhere that go with the holdings, and the holdings
  // they sit on.
  deletedRows: { count: number; names: string[] };
  // Deposits that lose the contribution a deleted holding's leg made.
  reversedContributions: string[];
  // Deposits whose contribution cannot be matched and stays.
  keptContributions: string[];
  // Holdings whose bank-owned linked transactions stay.
  keptSynced: string[];
  // Holdings an exchange leg of the deleted holdings points at without a
  // partner row to find there.
  unlinked: string[];
  // A leg with no partner whose marker holding is gone, so none is named.
  unlinkedPlain: boolean;
};

type NamesKey =
  | 'holdings.deleteLinked.contributions'
  | 'holdings.deleteLinked.contributionsKept'
  | 'holdings.deleteLinked.syncedKept'
  | 'holdings.deleteLinked.unlinked';

const namesSentence = (key: NamesKey, names: string[], t: TFunction): string | undefined =>
  names.length === 0 ? undefined : t(key, { names: names.join(', ') });

const unlinkedSentence = (
  { unlinked, unlinkedPlain }: RemoveHoldingsPlan,
  t: TFunction,
): string | undefined => {
  if (unlinked.length > 0) {
    return namesSentence('holdings.deleteLinked.unlinked', unlinked, t);
  }

  return unlinkedPlain ? t('holdings.deleteLinked.unlinkedPlain') : undefined;
};

/**
 * The text the delete confirm shows under its title for holdings (or an
 * account's holdings) that take other holdings' transactions with them: one
 * sentence per part, a space apart; `undefined` when nothing outside the
 * deleted holdings is touched, whose confirm stays the bare one. A leg with no
 * partner is named once: the unnamed sentence only stands in when no holding
 * can be named.
 */
export const removeHoldingsNotice = (plan: RemoveHoldingsPlan, t: TFunction): string | undefined =>
  joinNoticeSentences(
    plan.deletedRows.count === 0
      ? undefined
      : t('holdings.deleteLinked.rows', {
          count: plan.deletedRows.count,
          names: plan.deletedRows.names.join(', '),
        }),
    namesSentence('holdings.deleteLinked.contributions', plan.reversedContributions, t),
    namesSentence('holdings.deleteLinked.contributionsKept', plan.keptContributions, t),
    namesSentence('holdings.deleteLinked.syncedKept', plan.keptSynced, t),
    unlinkedSentence(plan, t),
  );

/**
 * The text the delete confirm shows under its title, for a transaction that is
 * one part of a movement; `undefined` for a row that stands alone, whose confirm
 * stays the bare one. Holding names are joined with a comma, never
 * `Intl.ListFormat`, which Hermes may lack.
 */
export const removeNotice = (plan: RemovePlan, t: TFunction): string | undefined =>
  joinNoticeSentences(
    foldMap(maybe(plan.exchange), (exchange) => exchangeSentence(exchange, t)),
    plan.split ? t('transactions.deleteLinked.split') : undefined,
    foldMap(maybe(plan.deposit), (deposit) => depositSentence(deposit, t)),
  );
