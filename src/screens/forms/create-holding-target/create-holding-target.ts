import type { AccountRow } from '@kiko/db';
import { isImplicitAccountKind } from '@kiko/holdings/implicit-account';

// The arguments a navigation call takes to open the create form, as one union so
// a caller's `navigate` or `push` is typed once for both screens.
export type CreateHoldingRoute = ['HoldingForm', { accountId: string }] | ['AccountForm', object];

// Where an empty holding picker's "Add holding" row sends the user, as the
// arguments of the caller's own navigation verb: `navigate` from a form that
// stays mounted underneath, `push` from a holding form, where `navigate` to its
// own name would only change that route's params. A picker with an anchor (the
// form's own holding) creates in the anchor's account. One without (the
// global-add primary picker, the loan form's "Paid from") creates in the first
// live account of `accounts`' order that can hold a payer holding, which
// excludes the implicit property and debt accounts; with no such account the
// user creates one first.
export const resolveCreateHoldingTarget = (
  anchorAccountId: string | undefined,
  accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>[],
): CreateHoldingRoute => {
  if (anchorAccountId !== undefined) {
    return ['HoldingForm', { accountId: anchorAccountId }];
  }

  const target = accounts.find(
    (account) => account.archivedAt == null && !isImplicitAccountKind(account.kind),
  );

  return target === undefined ? ['AccountForm', {}] : ['HoldingForm', { accountId: target.id }];
};
