import type { AccountRow } from '@kiko/db';
import { isSyncedAccount } from '@kiko/holdings/deletable';
import { creatableHoldingTypesForAccount, type HoldingType } from '@kiko/holdings/holding-type';

// The arguments a navigation call takes to open the create form, as one union so
// a caller's `navigate` or `push` is typed once for both screens.
export type CreateHoldingRoute = ['HoldingForm', { accountId: string }] | ['AccountForm', object];

type CreateHoldingPicker = {
  // The account of the form's own holding, tried before any other account.
  anchorAccountId: string | undefined;
  // Whether the picker would list a holding of this type once it exists.
  accepts: (type: HoldingType) => boolean;
};

type TargetAccount = Pick<AccountRow, 'id' | 'kind' | 'archivedAt' | 'institution' | 'bankId'>;

// Where an empty holding picker's "Add holding" row sends the user, as the
// arguments of the caller's own navigation verb: `navigate` from a form that
// stays mounted underneath, `push` from a holding form, where `navigate` to its
// own name would only change that route's params. The holding form opens on the
// picker's own account when it can create a type the picker accepts, else on the
// first live account of `accounts`' order that can. An account that cannot (a
// synced bank, whose sync owns its ledgered types; a metals, property or debt
// account, whose types take no manual ledger) would leave the new holding out of
// the picker, so it is skipped. With no account left the user creates one first.
export const resolveCreateHoldingTarget = (
  picker: CreateHoldingPicker,
  accounts: readonly TargetAccount[],
): CreateHoldingRoute => {
  const canCreateAcceptedType = (account: TargetAccount): boolean =>
    account.archivedAt == null &&
    creatableHoldingTypesForAccount(account.kind, isSyncedAccount(account), account.bankId).some(
      picker.accepts,
    );
  const anchored = accounts.find(
    (account) => account.id === picker.anchorAccountId && canCreateAcceptedType(account),
  );
  const target = anchored ?? accounts.find(canCreateAcceptedType);

  return target === undefined ? ['AccountForm', {}] : ['HoldingForm', { accountId: target.id }];
};
