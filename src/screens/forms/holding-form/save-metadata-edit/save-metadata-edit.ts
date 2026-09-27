import { holdingsRepo } from '@kiko/holdings/repo';

import type { EditContext } from '../holding-type-form';

// The shared EDIT write for a ledgerless holding type (term_deposit,
// property_item, metal — kiko-domain; a bond builds its metadata from the
// stored row instead, through `holdingsRepo.updateMetadataFromStored`): its
// value derives entirely from its own metadata, so the patch never touches
// `balanceMinorUnits`, unlike a balance type's own `saveEdit` branch. Routed through
// `updateWithBalanceDelta` (not a bare `update`) so a patch with no balance
// in it writes no ledger row.
export const saveMetadataEdit = (
  context: EditContext,
  metadata: Record<string, unknown> | undefined,
): Promise<void> =>
  holdingsRepo.updateWithBalanceDelta(
    context.holdingId,
    { name: context.name, color: context.color, metadata },
    Date.now(),
  );
