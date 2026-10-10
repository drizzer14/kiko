import type { HoldingRow } from '@kiko/db';
import { holdingIdentity } from '@kiko/holdings/holding-identity';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

// One holding projected to the row every holding picker shows (the exchange
// destination, the loan-payment link, the loan form's "Paid from"). A holding
// whose parent account is not in the map reads with an empty account name, not
// "undefined" in the row's caption and VoiceOver label.
export const toHoldingOption = (
  holding: HoldingRow,
  accountNameById: ReadonlyMap<string, string>,
): HoldingSelectOption => ({
  id: holding.id,
  name: holding.name,
  currency: holding.currency,
  accountName: accountNameById.get(holding.accountId) ?? '',
  createdAt: holding.createdAt,
  ...holdingIdentity(holding),
});
