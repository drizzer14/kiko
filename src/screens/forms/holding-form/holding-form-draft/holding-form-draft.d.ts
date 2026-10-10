import type { Currency } from '@kiko/currency/currency';
import type { HoldingType } from '@kiko/holdings/holding-type';

import type { BondFieldsDraft } from '../bond/use-bond-fields';
import type { LoanFieldsDraft } from '../loan/use-loan-fields';
import type { MetalFieldsDraft } from '../metal/use-metal-fields';
import type { BalanceFieldsDraft } from '../balance/use-balance-fields';
import type { PropertyFieldsDraft } from '../property/use-property-fields';
import type { TermDepositFieldsDraft } from '../term-deposit/use-term-deposit-fields';

/**
 * What the holding form keeps in its route's `draft` param so a fold or unfold, which remounts
 * the screen, gives back what the user filled. Every type's own fields are in it, not only the
 * selected type's, since the form keeps them all across a switch of type. What an edit reads from
 * the stored holding and the form does not edit (a metal's lots, a property's share changes) is
 * not: it is read again, so the draft cannot save an old copy over a newer one.
 */
export type HoldingFormDraft = {
  saved: true;
  name: string;
  type: HoldingType;
  currency: Currency;
  icon: string | null;
  color: string | null;
  balance: BalanceFieldsDraft;
  deposit: TermDepositFieldsDraft;
  bond: BondFieldsDraft;
  property: PropertyFieldsDraft;
  metal: MetalFieldsDraft;
  loan: LoanFieldsDraft;
};
