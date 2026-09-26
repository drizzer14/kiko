/*
 One-time cleanup for the UAH-star rate model: every A->B conversion now
 resolves at READ TIME through the UAH pivot (`rateBetween`,
 `src/rates/conversion/conversion.ts`), so a stored cross row (any row whose
 `quote` is not `UAH`, or whose `base` IS `UAH`) is dead weight — never read
 by `rateTableFromRows`/`rateTableAt`/`earliestRateTable` since the prior
 (read-time-pivot) migration in this same phase. This migration removes every
 such row from `currency_rates` (the latest-only cache) and
 `currency_rate_history` (the per-day chart backing), keeping only a star row
 (`quote = 'UAH'`, `base != 'UAH'`) per currency (per day, for history).

 DERIVE FIRST, DELETE LAST: a legacy pre-star device can hold a currency whose
 ONLY row is an inverse (`UAH:X`, from before Monobank ever anchored it
 directly) or a cross (`X:Y`, with no `X:UAH` row at all) — deleting first
 would silently drop that currency's conversion entirely. So this migration
 DERIVES a star row for such a currency before deleting anything:
   1. `X:UAH` from the inverse `UAH:X` row (`rate = 1 / stored_rate`), for any
      X that has no `X:UAH` row yet (same `day` in history).
   2. `X:UAH` from `X:Y * Y:UAH` (same `day` in history), for a legacy X whose
      only stored row is a cross pair, once step 1 has resolved every
      possible one-hop pivot `Y:UAH`.
 Both derive steps use `INSERT OR IGNORE` on the tables' own unique index
 (`(base, quote)` / `(base, quote, day)`), so an X that ALREADY has its own
 `X:UAH` row is never touched or overwritten by either step.
 Only then does step 3 DELETE every remaining cross/inverse row. A crash
 between statements never loses a currency's conversion, since
 `run-migrations.ts` wraps this whole file in one transaction, and re-running
 the file (e.g. a retried failed launch) is a no-op the second time: every
 derive step's `INSERT OR IGNORE` inserts nothing once every currency already
 has its own star row, and the delete matches nothing once no cross/inverse
 row remains.

 The restore mirror (`src/data-transfer/snapshot/restore-snapshot.ts`,
 `withRatesNormalizedToUah`) applies the identical three-step rule to a
 `.kiko` import, so a pre-star export normalizes exactly like a live device
 upgrade — see that file's own doc comment. Next free migration index: 0043.
*/
-- currency_rates: derive an X:UAH row from its inverse UAH:X row, when X has none yet.
INSERT OR IGNORE INTO `currency_rates` (`base`, `quote`, `rate`, `source`, `fetched_at`)
SELECT `quote`, 'UAH', CAST(1.0 / CAST(`rate` AS REAL) AS TEXT), `source`, `fetched_at`
FROM `currency_rates`
WHERE `base` = 'UAH' AND `quote` <> 'UAH';--> statement-breakpoint
-- currency_rates: derive an X:UAH row from X:Y * Y:UAH, for a legacy X whose only row is a cross pair.
INSERT OR IGNORE INTO `currency_rates` (`base`, `quote`, `rate`, `source`, `fetched_at`)
SELECT `x`.`base`, 'UAH', CAST(CAST(`x`.`rate` AS REAL) * CAST(`pivot`.`rate` AS REAL) AS TEXT), `x`.`source`, `x`.`fetched_at`
FROM `currency_rates` AS `x`
JOIN `currency_rates` AS `pivot` ON `pivot`.`base` = `x`.`quote` AND `pivot`.`quote` = 'UAH'
WHERE `x`.`base` <> 'UAH' AND `x`.`quote` <> 'UAH';--> statement-breakpoint
-- currency_rates: delete every remaining non-star row (irreversible, last).
DELETE FROM `currency_rates` WHERE `quote` <> 'UAH' OR `base` = 'UAH';--> statement-breakpoint
-- currency_rate_history: derive an X:UAH row from its inverse UAH:X row (same day), when X has none yet.
INSERT OR IGNORE INTO `currency_rate_history` (`base`, `quote`, `day`, `rate`, `source`)
SELECT `quote`, 'UAH', `day`, CAST(1.0 / CAST(`rate` AS REAL) AS TEXT), `source`
FROM `currency_rate_history`
WHERE `base` = 'UAH' AND `quote` <> 'UAH';--> statement-breakpoint
-- currency_rate_history: derive an X:UAH row from X:Y * Y:UAH (same day), for a legacy X whose only row is a cross pair.
INSERT OR IGNORE INTO `currency_rate_history` (`base`, `quote`, `day`, `rate`, `source`)
SELECT `x`.`base`, 'UAH', `x`.`day`, CAST(CAST(`x`.`rate` AS REAL) * CAST(`pivot`.`rate` AS REAL) AS TEXT), `x`.`source`
FROM `currency_rate_history` AS `x`
JOIN `currency_rate_history` AS `pivot`
  ON `pivot`.`base` = `x`.`quote` AND `pivot`.`quote` = 'UAH' AND `pivot`.`day` = `x`.`day`
WHERE `x`.`base` <> 'UAH' AND `x`.`quote` <> 'UAH';--> statement-breakpoint
-- currency_rate_history: delete every remaining non-star row (irreversible, last).
DELETE FROM `currency_rate_history` WHERE `quote` <> 'UAH' OR `base` = 'UAH';
