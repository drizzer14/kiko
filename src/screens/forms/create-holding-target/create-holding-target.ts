import { match } from 'ts-pattern';
import type { AccountRow } from '@kiko/db';
import { isImplicitAccountKind } from '@kiko/holdings/implicit-account';

export type CreateHoldingTarget =
  | { screen: 'HoldingForm'; params: { accountId: string } }
  | { screen: 'AccountForm' };

// The arguments a navigation call takes to open the target, as one union so a
// caller's `navigate` or `push` is typed once for both screens.
export type CreateHoldingRoute = ['HoldingForm', { accountId: string }] | ['AccountForm', object];

// Where an empty holding picker's "Add holding" row sends the user. A picker
// with an anchor (the form's own holding) creates in the anchor's account. One
// without (the global-add primary picker, the loan form's "Paid from") creates
// in the first live account of `accounts`' order that can hold a payer holding,
// which excludes the implicit property and debt accounts; with no such account
// the user creates one first.
export const resolveCreateHoldingTarget = (
  anchorAccountId: string | undefined,
  accounts: readonly Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>[],
): CreateHoldingTarget => {
  if (anchorAccountId !== undefined) {
    return { screen: 'HoldingForm', params: { accountId: anchorAccountId } };
  }

  const target = accounts.find(
    (account) => account.archivedAt == null && !isImplicitAccountKind(account.kind),
  );

  return target === undefined
    ? { screen: 'AccountForm' }
    : { screen: 'HoldingForm', params: { accountId: target.id } };
};

// Opens the target through the caller's own navigation verb: `navigate` from a
// form that stays mounted underneath, `push` from a holding form, where
// `navigate` to its own name would only change that route's params.
export const openCreateHolding = (
  target: CreateHoldingTarget,
  go: (...route: CreateHoldingRoute) => void,
): void => {
  match(target)
    .with({ screen: 'HoldingForm' }, ({ params }) => go('HoldingForm', params))
    .with({ screen: 'AccountForm' }, () => go('AccountForm', {}))
    .exhaustive();
};
