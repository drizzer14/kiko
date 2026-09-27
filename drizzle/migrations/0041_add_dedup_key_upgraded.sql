/*
 Adds the one-shot flag `MigrationsGate` runs its statement-import dedup-key
 upgrade under (`statement-import/mapping/upgrade-dedup-key.ts`'s
 `upgradeLegacyDedupKey`, wired in a separate commit). The upgrade itself is
 NOT SQL: `normalizeTransactionName` (`transactions/normalize-name.ts`) is
 JS-only, never in SQL, so SQL alone cannot tell an occurrence suffix from a
 description that itself ends in a digit — the rewrite has to run as a pure
 JS pass over the stored rows, once, after this column exists. Defaults to
 `false` (unrun); the launch step flips it to `true` after the one-time
 rewrite completes, mirroring the `false`-until-run shape of `lock_enabled`.
*/
ALTER TABLE `settings` ADD `dedup_keys_upgraded` integer DEFAULT false NOT NULL;
