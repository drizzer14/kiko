import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';

/** How far a delete moves one holding's balance: the sum of the full amounts it
 * takes back, in the holding's own currency (negative when it lowers it). */
export type BalanceChange = { name: string; currency: Currency; minorUnits: number };

export type ExchangeRemoval =
  // The other legs are the user's rows and go with this one; `names` are the
  // holdings they sit on. `keptNames` are the holdings of a bank-owned leg of
  // the same pair that stays, present only when there is one. `sameCurrency` is
  // set when both legs hold one currency, which the row's own label calls a
  // transfer, so the notice does too.
  | { kind: 'deleted'; names: string[]; keptNames?: string[]; sameCurrency?: boolean }
  // The other leg is the bank's row and stays; `names` are the holdings it sits on.
  | { kind: 'syncedKept'; names: string[] }
  // The row names an exchange partner that cannot be proven: `name` is the
  // holding the marker points at, absent when that holding is gone. `sameCurrency`
  // is set on the same terms as for a deleted pair.
  | { kind: 'missing'; name?: string; sameCurrency?: boolean };

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
  // The exchange the row is itself a part of (it carries the exchange's pair id).
  exchange?: ExchangeRemoval;
  // Conversions reached only through another part of the split: a pair the row
  // is no member of, whose names and fate the confirm speaks of as the split's.
  splitExchanges?: ExchangeRemoval[];
  deposit?: DepositRemoval;
  // The holdings whose balance the delete changes, by name; absent when none.
  balanceChanges?: BalanceChange[];
};

// The names of a list, each in the language's own quotes and joined with a
// comma: never `Intl.ListFormat`, which Hermes may lack.
const listedNames = (names: string[], t: TFunction): string =>
  names.map((name) => t('common.listedName', { name })).join(', ');

// The conversion sentences of a split: one per holding, the name quoted by the
// sentence itself, and none says that only one part is deleted.
const splitExchangeSentences = (exchange: ExchangeRemoval, t: TFunction): string =>
  match(exchange)
    .with({ kind: 'deleted' }, ({ names }) =>
      names.map((name) => t('transactions.deleteLinked.splitExchange', { name })).join(' '),
    )
    .with({ kind: 'syncedKept' }, ({ names }) =>
      names
        .map((name) => t('transactions.deleteLinked.splitExchangeSyncedKept', { name }))
        .join(' '),
    )
    .with({ kind: 'missing' }, ({ name }) =>
      name === undefined
        ? t('transactions.deleteLinked.splitExchangeUnlinkedPlain')
        : t('transactions.deleteLinked.splitExchangeUnlinked', { name }),
    )
    .exhaustive();

// The other part cannot be found: a transfer when the row reads "Transfer to/from", an
// exchange otherwise, and the holding named only when it still exists.
const missingPartSentence = (
  { name, sameCurrency }: { name: string | undefined; sameCurrency: boolean },
  t: TFunction,
): string =>
  match({ named: name !== undefined, sameCurrency })
    .with({ named: true, sameCurrency: true }, () =>
      t('transactions.deleteLinked.transferUnlinked', { name }),
    )
    .with({ named: true, sameCurrency: false }, () =>
      t('transactions.deleteLinked.exchangeUnlinked', { name }),
    )
    .with({ named: false, sameCurrency: true }, () =>
      t('transactions.deleteLinked.transferUnlinkedPlain'),
    )
    .with({ named: false, sameCurrency: false }, () =>
      t('transactions.deleteLinked.exchangeUnlinkedPlain'),
    )
    .exhaustive();

// A bank-owned or missing other part says "only this part is deleted" in the
// exchange sentences, which a split delete contradicts: with a split they take
// the split's own wording.
const exchangeSentence = (exchange: ExchangeRemoval, isSplit: boolean, t: TFunction): string =>
  match(exchange)
    .with({ kind: 'deleted' }, ({ names, keptNames = [], sameCurrency = false }) =>
      [
        t(
          sameCurrency
            ? 'transactions.deleteLinked.transfer'
            : 'transactions.deleteLinked.exchange',
          {
            name: listedNames(names, t),
          },
        ),
        ...keptNames.map((name) => t('transactions.deleteLinked.exchangeAlsoKept', { name })),
      ].join(' '),
    )
    .with({ kind: 'syncedKept' }, ({ names }) =>
      isSplit
        ? splitExchangeSentences(exchange, t)
        : t('transactions.deleteLinked.exchangeSyncedKept', { name: listedNames(names, t) }),
    )
    .with({ kind: 'missing' }, ({ name, sameCurrency = false }) => {
      if (isSplit) {
        return splitExchangeSentences(exchange, t);
      }

      return missingPartSentence({ name, sameCurrency }, t);
    })
    .exhaustive();

const depositSentence = ({ name, matched }: DepositRemoval, t: TFunction): string =>
  t(matched ? 'transactions.deleteLinked.deposit' : 'transactions.deleteLinked.depositKept', {
    name,
  });

// The shared money formatter writes a minus for a loss and no sign for a gain,
// which "by 400.00" would not tell from a loss, so a gain gets its plus.
const signedAmountOf = ({ currency, minorUnits }: BalanceChange): string => {
  const amount = formatMoney(Money.of(currency, minorUnits), activeLocale());

  return minorUnits > 0 ? `+${amount}` : amount;
};

// One sentence per holding. The name stays raw: the sentence's own template
// quotes a single name where the language does.
const balanceChangeSentences = (changes: BalanceChange[], t: TFunction): string | undefined =>
  joinNoticeSentences(
    ...changes.map((change) =>
      t('transactions.deleteLinked.balanceChange', {
        name: change.name,
        amount: signedAmountOf(change),
      }),
    ),
  );

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
  // How far the delete moves the balance of each other holding it takes a row
  // from; absent when none.
  balanceChanges?: BalanceChange[];
};

type NamesKey =
  | 'holdings.deleteLinked.contributions'
  | 'holdings.deleteLinked.contributionsKept'
  | 'holdings.deleteLinked.syncedKept'
  | 'holdings.deleteLinked.unlinked';

const namesSentence = (key: NamesKey, names: string[], t: TFunction): string | undefined =>
  names.length === 0 ? undefined : t(key, { names: listedNames(names, t) });

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
          names: listedNames(plan.deletedRows.names, t),
        }),
    namesSentence('holdings.deleteLinked.contributions', plan.reversedContributions, t),
    namesSentence('holdings.deleteLinked.contributionsKept', plan.keptContributions, t),
    namesSentence('holdings.deleteLinked.syncedKept', plan.keptSynced, t),
    unlinkedSentence(plan, t),
    balanceChangeSentences(plan.balanceChanges ?? [], t),
  );

/**
 * `removeHoldingsNotice` for the holdings `holdingIds`, reading their plan when
 * the delete is requested so the text names what is stored now.
 */
export const removeHoldingsNoticeOf = async (
  holdingIds: string[],
  t: TFunction,
): Promise<string | undefined> =>
  removeHoldingsNotice(await transactionsRepo.removeHoldingsPlan(holdingIds), t);

/**
 * The text the delete confirm shows under its title: one sentence per part of
 * the movement the row belongs to, then the balance each holding changes by. A
 * row that stands alone gets only its balance line. Holding names are joined
 * with a comma, never `Intl.ListFormat`, which Hermes may lack.
 */
export const removeNotice = (plan: RemovePlan, t: TFunction): string | undefined =>
  joinNoticeSentences(
    foldMap(maybe(plan.exchange), (exchange) => exchangeSentence(exchange, plan.split, t)),
    plan.split ? t('transactions.deleteLinked.split') : undefined,
    joinNoticeSentences(
      ...(plan.splitExchanges ?? []).map((exchange) => splitExchangeSentences(exchange, t)),
    ),
    foldMap(maybe(plan.deposit), (deposit) => depositSentence(deposit, t)),
    balanceChangeSentences(plan.balanceChanges ?? [], t),
  );
