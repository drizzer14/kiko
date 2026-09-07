ALTER TABLE `transactions` ADD `exchange_counterpart_holding_id` text;
--> statement-breakpoint
/*
 Backfill the new marker for legs written by the pre-marker build, which
 persisted a literal English description. Match the counterpart holding by the
 name embedded in that description. `LIMIT 1` resolves an ambiguous duplicate
 holding name arbitrarily — accepted deliberately: the worst case is a wrong
 DISPLAY name on a historical row, while the money-correctness effect (the leg
 being excluded from the spending donut) is right either way, because the
 marker is non-null in both cases. A row whose name matches nothing keeps its
 legacy description and stays visible as before.
*/
UPDATE `transactions`
SET `exchange_counterpart_holding_id` = (
  SELECT `h`.`id` FROM `holdings` AS `h`
  WHERE `h`.`name` = substr(`transactions`.`description`, length('Exchange to ') + 1)
  LIMIT 1
),
`description` = ''
WHERE `source` = 'manual'
  AND `exchange_counterpart_holding_id` IS NULL
  AND `description` LIKE 'Exchange to %'
  AND EXISTS (
    SELECT 1 FROM `holdings` AS `h`
    WHERE `h`.`name` = substr(`transactions`.`description`, length('Exchange to ') + 1)
  );--> statement-breakpoint
UPDATE `transactions`
SET `exchange_counterpart_holding_id` = (
  SELECT `h`.`id` FROM `holdings` AS `h`
  WHERE `h`.`name` = substr(`transactions`.`description`, length('Exchange from ') + 1)
  LIMIT 1
),
`description` = ''
WHERE `source` = 'manual'
  AND `exchange_counterpart_holding_id` IS NULL
  AND `description` LIKE 'Exchange from %'
  AND EXISTS (
    SELECT 1 FROM `holdings` AS `h`
    WHERE `h`.`name` = substr(`transactions`.`description`, length('Exchange from ') + 1)
  );
