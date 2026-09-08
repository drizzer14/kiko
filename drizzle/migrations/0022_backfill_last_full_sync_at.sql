/*
 Backfill `settings.last_full_sync_at` for already-synced users.

 Migration `0021` added `settings.last_full_sync_at` as NULL with no backfill.
 A NULL there means "a full fetch has never run", so `shouldFullFetch`
 (`src/monobank/sync.ts`) forces every already-synced user into a fresh, slow
 full statement fetch of every card (~N×60s under the per-token rate limit) on
 their very next sync — and that full fetch only "sticks" (stamps the marker)
 on a perfectly clean run, so a single transient failure re-arms it.

 An already-synced user (one with a non-NULL `last_sync_at` cursor) has, in
 effect, already fetched every card up to that cursor. Treat them as having
 full-fetched at that point: seed `last_full_sync_at` from `last_sync_at`, so
 `shouldFullFetch` is false and they land on the fast balance-diff path
 immediately. The 24h safety net still fires the first genuine full fetch later
 (`FULL_FETCH_INTERVAL_MS` in `src/monobank/sync.ts`), recovering any net-zero
 same-window pair.

 The `last_full_sync_at IS NULL` guard makes this idempotent and safe to re-run:
 a user who has already recorded a full fetch is left untouched. This is a
 DATA-only migration — no schema change — so `drizzle-kit generate` produces
 nothing and there is no `0022_snapshot.json` (modeled on the data-only
 `0014_lowercase_categories.sql`, which likewise has no snapshot).
*/
UPDATE `settings` SET `last_full_sync_at` = `last_sync_at` WHERE `last_sync_at` IS NOT NULL AND `last_full_sync_at` IS NULL;
