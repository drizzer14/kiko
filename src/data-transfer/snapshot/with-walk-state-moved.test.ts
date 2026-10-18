// src/data-transfer/snapshot/with-walk-state-moved.test.ts
//
// The pure copy of migration 0061's walk-state move on plain rows. The two-path test next to this
// file proves it agrees with the migration on one database; these cases pin which holding's keys
// the walk read and what a row with nothing to fill keeps.
import type { SyncStateRow } from '@kiko/db';

import { withWalkStateMoved } from './with-walk-state-moved';

const ACCOUNT_ID = 'account-1';

type HoldingSeed = {
  sortOrder: number;
  createdAt: number;
  capitalCursor: number;
};

const holdingOf = (seed: HoldingSeed) => ({
  accountId: ACCOUNT_ID,
  sortOrder: seed.sortOrder,
  createdAt: seed.createdAt,
  metadata: { binanceAsset: 'BTC', binanceHistoryCursor: seed.capitalCursor },
});

const syncRowOf = (exchangeState: string | null): SyncStateRow => ({
  accountId: ACCOUNT_ID,
  lastSyncAt: null,
  lastFullSyncAt: null,
  lastSyncDisplayAt: null,
  failedSyncMonobankIds: null,
  exchangeState,
});

const capitalCursorOf = (rows: SyncStateRow[]): unknown => {
  const [row] = rows;

  return JSON.parse(row.exchangeState ?? 'null').walks.capital.cursor;
};

describe('withWalkStateMoved, the holding the walk read', () => {
  const earlier = holdingOf({ sortOrder: 0, createdAt: 1, capitalCursor: 1000 });
  const later = holdingOf({ sortOrder: 0, createdAt: 2, capitalCursor: 2000 });

  it('takes the older of two holdings of one sort order, whichever is met first', () => {
    expect(capitalCursorOf(withWalkStateMoved({ holdings: [earlier, later], syncState: [] }))).toBe(
      1000,
    );
    expect(capitalCursorOf(withWalkStateMoved({ holdings: [later, earlier], syncState: [] }))).toBe(
      1000,
    );
  });

  it('keeps the holding met first when two tie on sort order and creation time', () => {
    const first = holdingOf({ sortOrder: 0, createdAt: 1, capitalCursor: 1000 });
    const second = holdingOf({ sortOrder: 0, createdAt: 1, capitalCursor: 2000 });

    expect(capitalCursorOf(withWalkStateMoved({ holdings: [first, second], syncState: [] }))).toBe(
      1000,
    );
  });

  it('takes the lower sort order, even when a higher one is met first', () => {
    const high = holdingOf({ sortOrder: 5, createdAt: 1, capitalCursor: 1000 });
    const low = holdingOf({ sortOrder: 1, createdAt: 2, capitalCursor: 2000 });

    expect(capitalCursorOf(withWalkStateMoved({ holdings: [high, low], syncState: [] }))).toBe(
      2000,
    );
  });
});

describe('withWalkStateMoved, a row with nothing to fill', () => {
  it('stays the very same row, with no walk state, when the account has no holding', () => {
    const row = syncRowOf(null);
    const [kept] = withWalkStateMoved({ holdings: [], syncState: [row] });

    expect(kept).toBe(row);
    expect(kept.exchangeState).toBeNull();
  });
});
