import { transactionsRepo } from '@kiko/transactions/repo';

// Semgrep fixture (NEGATIVE): `kiko-holding-delete-needs-cascade` MUST report
// nothing on a delete through `transactionsRepo.removeHolding`, which runs the
// cascade first, nor on a comment that names `removeHoldingDatabaseTransaction`.
export const deleteHolding = (holdingId: string) => transactionsRepo.removeHolding(holdingId);
