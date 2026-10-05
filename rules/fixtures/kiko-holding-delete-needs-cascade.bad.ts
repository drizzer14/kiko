// Semgrep fixture (POSITIVE): kiko-holding-delete-needs-cascade MUST report a
// finding on every pinned line below. Never "fix" this file — see kiko-domain's
// "A holding is deleted only after its cascade".
import { removeHoldingDatabaseTransaction } from '@kiko/holdings/repo';
import { write } from '@kiko/db';

export const deleteHoldingAlone = (holdingId: string) =>
  write(async (databaseTransaction) => {
    // EXPECT-FINDING
    await removeHoldingDatabaseTransaction(databaseTransaction, holdingId);
  });
