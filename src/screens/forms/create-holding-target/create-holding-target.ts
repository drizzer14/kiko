import type { AccountRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import { isSyncedAccount } from '@kiko/holdings/deletable';
import { creatableHoldingTypesForAccount, type HoldingType } from '@kiko/holdings/holding-type';

// The arguments a navigation call takes to open the create form, as one union so
// a caller's `navigate` or `push` is typed once for both screens. The holding
// form opens on `initialType`, and in `initialCurrency` when the picker needs one.
export type CreateHoldingRoute =
  | ['HoldingForm', { accountId: string; initialType: HoldingType; initialCurrency?: Currency }]
  | ['AccountForm', object];

type CreateHoldingPicker = {
  // The account of the form's own holding, tried before any other account.
  anchorAccountId: string | undefined;
  // Whether the picker would list a holding of this type once it exists.
  accepts: (type: HoldingType) => boolean;
  // The currency every holding the picker lists is in, when it lists one only.
  currency?: Currency;
};

type TargetAccount = Pick<AccountRow, 'id' | 'kind' | 'archivedAt' | 'institution' | 'bankId'>;

// Where an empty holding picker's "Add holding" row sends the user, as the
// arguments of the caller's own navigation verb: `navigate` from a form that
// stays mounted underneath, `push` from a holding form, where `navigate` to its
// own name would only change that route's params. The holding form opens on the
// picker's own account when it can create a type the picker accepts, else on the
// first live account of `accounts`' order that can, set to the first such type
// (and the picker's currency) so that Save without a change adds a holding the
// picker lists. An account that cannot create one would leave the new holding out
// of the picker, so it is skipped: for a picker that lists only holdings with a
// manual ledger, that is a synced bank (its sync owns its card and jar) and a
// metals, property or debt account. With no account left the user creates one first.
export const resolveCreateHoldingTarget = (
  picker: CreateHoldingPicker,
  accounts: readonly TargetAccount[],
): CreateHoldingRoute => {
  const candidates = accounts
    .filter((account) => account.archivedAt == null)
    .flatMap(
      (account) =>
        foldMap(
          maybe(
            creatableHoldingTypesForAccount(
              account.kind,
              isSyncedAccount(account),
              account.bankId,
            ).find(picker.accepts),
          ),
          (initialType) => [{ accountId: account.id, initialType }],
        ) ?? [],
    );
  const target =
    candidates.find(({ accountId }) => accountId === picker.anchorAccountId) ?? candidates.at(0);

  return (
    foldMap(
      maybe(target),
      (found): CreateHoldingRoute => [
        'HoldingForm',
        {
          ...found,
          ...foldMap(maybe(picker.currency), (initialCurrency) => ({ initialCurrency })),
        },
      ],
    ) ?? ['AccountForm', {}]
  );
};
