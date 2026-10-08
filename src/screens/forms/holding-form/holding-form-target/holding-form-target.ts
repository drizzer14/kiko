import { match, P } from 'ts-pattern';
import type { Currency } from '@kiko/currency/currency';
import type { HoldingType } from '@kiko/holdings/holding-type';
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

type HoldingFormStart = { type: HoldingType | undefined; currency: Currency };

const DEFAULT_CURRENCY: Currency = 'UAH';

// The type and currency a create on a named account opens with, when the route
// carries them; any other route leaves the type to the first the account offers
// and the currency to the default.
export const holdingFormStart = (params: AccountsStackParamList['HoldingForm']): HoldingFormStart =>
  match(params)
    .with(
      { accountId: P.string },
      ({ initialType, initialCurrency }): HoldingFormStart => ({
        type: initialType,
        currency: initialCurrency ?? DEFAULT_CURRENCY,
      }),
    )
    .otherwise(() => ({ type: undefined, currency: DEFAULT_CURRENCY }));

const EMPTY_DRAFT: FormDraft = { name: '', icon: null, color: null };

// The identity the form opens with: what the account form carried over on an
// implicit route, nothing on any other.
export const holdingFormDraft = (params: AccountsStackParamList['HoldingForm']): FormDraft =>
  match(params)
    .with({ draft: P.nonNullable }, ({ draft }) => draft)
    .otherwise(() => EMPTY_DRAFT);
