import { match, P } from 'ts-pattern';
import type { ImplicitAccountKind } from '@kiko/holdings/implicit-account';
import type { AccountsStackParamList, FormDraft } from '@kiko/navigation/types';

export type HoldingFormTarget =
  | { kind: 'account'; accountId: string }
  | { kind: 'implicit'; implicitKind: ImplicitAccountKind };

// Where a new holding goes: a named account, or the one implicit account of a
// kind that Save finds or creates. The route carries exactly one of the two.
export const holdingFormTarget = (
  params: AccountsStackParamList['HoldingForm'],
): HoldingFormTarget =>
  match(params)
    .with(
      { accountId: P.string },
      ({ accountId }): HoldingFormTarget => ({
        kind: 'account',
        accountId,
      }),
    )
    .with(
      { implicitKind: P.string },
      ({ implicitKind }): HoldingFormTarget => ({
        kind: 'implicit',
        implicitKind,
      }),
    )
    .exhaustive();

const EMPTY_DRAFT: FormDraft = { name: '', icon: null, color: null };

// The identity the form opens with: what the account form carried over on an
// implicit route, nothing on any other.
export const holdingFormDraft = (params: AccountsStackParamList['HoldingForm']): FormDraft =>
  match(params)
    .with({ draft: P.nonNullable }, ({ draft }) => draft)
    .otherwise(() => EMPTY_DRAFT);
