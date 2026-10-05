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
