import { holdingsRepo } from '@kiko/holdings/repo';

import type { EditContext } from '../holding-type-form';

// The shared EDIT write for a ledgerless holding type (term_deposit, bond,
// property_item — kiko-domain): its value derives entirely from its own
// metadata, so the patch never touches `balanceMinorUnits`, unlike a balance
// type's own `saveEdit` branch. Routed through `updateWithBalanceDelta` (not
// a bare `update`) so a patch with no balance in it writes no ledger row —
// mirrors `buildHoldingPatch`'s own ledgerless branch this replaces.
export const saveMetadataEdit = (
  context: EditContext,
  metadata: Record<string, unknown> | undefined,
): Promise<void> =>
  holdingsRepo.updateWithBalanceDelta(
    context.holdingId,
    { name: context.name, color: context.color, metadata },
    Date.now(),
  );
