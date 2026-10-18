// src/data-transfer/snapshot/with-walk-state-moved.ts
import { isRecord } from '@kiko/type-guards';
import type { HoldingRow, SyncStateRow } from '@kiko/db';

import { LEGACY_WALK_KEYS } from './legacy-walk-keys';

type HoldingFields = Pick<HoldingRow, 'accountId' | 'sortOrder' | 'createdAt' | 'metadata'>;

type Metadata = Record<string, unknown>;

const isSpotBitcoinMetadata = (metadata: unknown): metadata is Metadata =>
  isRecord(metadata) && metadata.binanceAsset === 'BTC';

// A tie keeps the holding met first, as the walk's own query and the migration's window do: no
// `id` tiebreak on either side.
const comesBefore = (candidate: HoldingFields, current: HoldingFields): boolean =>
  candidate.sortOrder === current.sortOrder
    ? candidate.createdAt < current.createdAt
    : candidate.sortOrder < current.sortOrder;

// The first Spot BTC holding of each account by `(sortOrder, createdAt)`, the one the walk read,
// even when it has no walk key and a later one has.
const firstSpotBitcoinMetadataByAccount = (holdingRows: HoldingFields[]): Map<string, Metadata> => {
  const firstByAccount = new Map<string, HoldingFields & { metadata: Metadata }>();

  for (const holding of holdingRows) {
    const current = firstByAccount.get(holding.accountId);

    if (
      isSpotBitcoinMetadata(holding.metadata) &&
      (current === undefined || comesBefore(holding, current))
    ) {
      firstByAccount.set(holding.accountId, { ...holding, metadata: holding.metadata });
    }
  }

  return new Map([...firstByAccount].map(([accountId, holding]) => [accountId, holding.metadata]));
};

// Each walk entry holds only the keys present, each value as stored: a string stays a string, a
// malformed value is kept for the reader to repair, a present null stays null. No walk key at all
// gives no state.
const walkStateOf = (metadata: Metadata): string | undefined => {
  const walks: Record<string, Metadata> = {};

  for (const [walk, field, key] of LEGACY_WALK_KEYS) {
    if (key in metadata) {
      walks[walk] = { ...walks[walk], [field]: metadata[key] };
    }
  }

  return Object.keys(walks).length === 0 ? undefined : JSON.stringify({ version: 1, walks });
};

const hasStoredWalkState = (row: SyncStateRow): boolean => typeof row.exchangeState === 'string';

/**
 * Migration 0061's copy (`drizzle/migrations/0061_exchange_state.sql`, its doc comment states the
 * rule), applied to a `.kiko` restore: a file written before the column carries each account's
 * Binance walk keys on its first Spot BTC holding's metadata and no walk state, and the walks
 * read only the state. Fed the rows the implicit-account merge produced, as a live device runs
 * 0050 before 0061.
 *
 * A row that carries a walk state, whatever its text (a malformed one is the reader's to repair),
 * stays as it is; a row with a null or no walk state is filled, keeping its stamps; an account
 * with walk keys and no row gets a row whose other columns are null, so nothing reads it as
 * synced. Nothing changes on the holdings: the old keys stay where they are, as in 0061.
 */
export const withWalkStateMoved = (rows: {
  holdings: HoldingFields[];
  syncState: SyncStateRow[];
}): SyncStateRow[] => {
  const derivedStates = new Map<string, string>();

  for (const [accountId, metadata] of firstSpotBitcoinMetadataByAccount(rows.holdings)) {
    const walkState = walkStateOf(metadata);

    if (walkState !== undefined) {
      derivedStates.set(accountId, walkState);
    }
  }

  const filledRows = rows.syncState.map((row) => {
    const derived = derivedStates.get(row.accountId);

    return hasStoredWalkState(row) || derived === undefined
      ? row
      : { ...row, exchangeState: derived };
  });
  const rowAccountIds = new Set(rows.syncState.map((row) => row.accountId));
  const addedRows = [...derivedStates]
    .filter(([accountId]) => !rowAccountIds.has(accountId))
    .map(([accountId, exchangeState]) => ({
      accountId,
      lastSyncAt: null,
      lastFullSyncAt: null,
      lastSyncDisplayAt: null,
      failedSyncMonobankIds: null,
      exchangeState,
    }));

  return [...filledRows, ...addedRows];
};
