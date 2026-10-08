/*
 Add `transactions.exchange_pair_id`, the id the legs of one Exchange or Convert
 share, and an index on it: deleting a leg looks the other legs up by it
 (`transactionsRepo.remove`, `transactions/repo/transactions.repo.ts`).

 Backfill, for a pair written before the column existed: a leg A is paired with
 a row B only when the stored data PROVES they are two halves of one movement,
 and only when that proof is 1:1.
   - A is manual, has an exchange marker, no change group and a non-zero amount.
   - B is on the holding A's marker names, has the same `time`, and an amount of
     the opposite sign.
   - B is either a manual leg whose own marker names A's holding (a manual
     pair), or a non-manual row with no marker (the synced or imported row a
     Convert started from, which the Convert never marked).
   - A has exactly ONE such B, and B has exactly ONE such A.
 Both rows then get the smaller of the two ids, so the result does not depend on
 the order the rows are read in: `restoreDataSnapshot`
 (`data-transfer/snapshot/restore-snapshot.ts`) derives the same ids for a
 `.kiko` file exported before this column, and a restore keeps every id but not
 the insertion order.

 Every other marked row keeps NULL: a re-dated leg, a leg whose partner is gone,
 two exchanges between the same holdings in one millisecond, a dangling marker,
 and a deposit source leg (the marker's holding type `term_deposit` identifies
 it). NULL means "not provable", and the delete then removes that one row only.

 Crash-safe: additive only (a column, an index, then the backfill), and the
 runner applies every statement and its bookkeeping row in ONE transaction, so a
 crash leaves the database at 0051 to retry whole on the next launch. The
 backfill is also idempotent: it writes only where `exchange_pair_id` IS NULL.
*/
ALTER TABLE `transactions` ADD `exchange_pair_id` text;--> statement-breakpoint
CREATE INDEX `transactions_exchange_pair_id` ON `transactions` (`exchange_pair_id`);--> statement-breakpoint
WITH `candidate` AS (
  SELECT `a`.`id` AS `a_id`, `b`.`id` AS `b_id`
  FROM `transactions` AS `a`
  JOIN `transactions` AS `b`
    ON `b`.`holding_id` = `a`.`exchange_counterpart_holding_id`
    AND `b`.`time` = `a`.`time`
    AND (
      (`a`.`amount_minor_units` < 0 AND `b`.`amount_minor_units` > 0)
      OR (`a`.`amount_minor_units` > 0 AND `b`.`amount_minor_units` < 0)
    )
    AND (
      (`b`.`source` = 'manual' AND `b`.`exchange_counterpart_holding_id` = `a`.`holding_id`)
      OR (`b`.`source` <> 'manual' AND `b`.`exchange_counterpart_holding_id` IS NULL)
    )
  WHERE `a`.`source` = 'manual'
    AND `a`.`exchange_counterpart_holding_id` IS NOT NULL
    AND `a`.`change_group_id` IS NULL
    AND `a`.`amount_minor_units` <> 0
), `counted` AS (
  SELECT
    `a_id`,
    `b_id`,
    COUNT(*) OVER (PARTITION BY `a_id`) AS `of_a`,
    COUNT(*) OVER (PARTITION BY `b_id`) AS `of_b`
  FROM `candidate`
), `member` AS (
  SELECT `a_id` AS `row_id`, MIN(`a_id`, `b_id`) AS `pair_id` FROM `counted`
  WHERE `of_a` = 1 AND `of_b` = 1
  UNION ALL
  SELECT `b_id` AS `row_id`, MIN(`a_id`, `b_id`) AS `pair_id` FROM `counted`
  WHERE `of_a` = 1 AND `of_b` = 1
)
UPDATE `transactions` SET `exchange_pair_id` = `paired`.`pair_id`
FROM (
  SELECT `row_id`, MIN(`pair_id`) AS `pair_id` FROM `member` GROUP BY `row_id`
) AS `paired`
WHERE `paired`.`row_id` = `transactions`.`id` AND `transactions`.`exchange_pair_id` IS NULL;
