/*
 Makes the Property and the Loans accounts "implicit": at most one LIVE
 (`archived_at IS NULL`) `property` account and one LIVE `debt` account exist,
 and the Accounts screen lists their holdings directly. The display name comes
 from i18n by kind (`accountDisplayName`, `src/holdings/implicit-account/`),
 never from the stored `name`.

 Why a merge: a device may hold several accounts of one of those kinds, and the
 partial unique index at the end of this file would refuse to build over them.
 So each kind with MORE THAN ONE live account is merged into its oldest one
 (smallest `created_at`, ties by `sort_order`, then `id`: `created_at` never
 changes and survives a restore, so both paths pick the same row). A kind with
 exactly one live account is never re-numbered or re-pointed. An ARCHIVED
 account is outside the index and outside every step below, because an archived
 account's holdings already count in no total and merging them in would change
 net worth.

 What moves, per merged kind:
 - Every holding (closed ones too) goes to the kept account. `sort_order` is
   renumbered 0..n-1 over the merged set in the old visible order: the accounts
   in their section order (`sort_order`, `created_at`, `id`), then each
   account's own order (`sort_order`, `created_at`, `id`).
 - Per reminder kind only the earliest-created reminder (ties by `id`)
   survives, re-pointed to the kept account with ALL its own state as one whole
   (schedule, pause, snooze, engagement). The others are deleted FIRST, so the
   `reminders_account_kind` unique index never collides.
 - `settings.reminder_offer_dismissals` (JSON object, account id -> dismissed
   reminder kinds): the kept account's entry becomes the union of the kinds
   dismissed on every merged account, and the deleted accounts' keys go. An
   entry with an empty kind list drops out, as it does on restore.
 - A stray `sync_state` row of a merged-away account is deleted before the
   account row (its NO ACTION foreign key would otherwise fail the migration).
 Holding ids never change, so `transactions`, `price_points` (`holding:<id>`),
 loan `metadata` and every balance are untouched: net worth is unchanged.

 Afterwards every live property/debt account gets the stored sentinel name
 (`IMPLICIT_ACCOUNT_STORED_NAME`: 'Properties' / 'Loans') and NULL `icon` and
 `color`, so the kind defaults show: one custom glyph picked for one former
 account would misrepresent all of them.

 Crash-safe and idempotent: the merge is derived into TEMP tables first, then
 the data is mutated, then the TEMP tables are dropped and the index is created
 LAST. The runner applies every statement and its bookkeeping row in ONE
 transaction, so a crash leaves the database at 0049 to retry whole. A second
 run finds one live account per kind, so no member row exists and the data
 statements change nothing. The restore path
 (`src/data-transfer/snapshot/restore-snapshot.ts`, `withImplicitAccountsMerged`)
 applies the IDENTICAL rule to a `.kiko` import.
*/
CREATE TEMP TABLE `implicit_account_members` AS
SELECT
  `id` AS `account_id`,
  `kind`,
  FIRST_VALUE(`id`) OVER (PARTITION BY `kind` ORDER BY `created_at`, `sort_order`, `id`) AS `kept_id`,
  ROW_NUMBER() OVER (PARTITION BY `kind` ORDER BY `sort_order`, `created_at`, `id`) AS `account_rank`
FROM `accounts`
WHERE `kind` IN ('property', 'debt') AND `archived_at` IS NULL;--> statement-breakpoint
DELETE FROM `implicit_account_members`
WHERE `kind` IN (SELECT `kind` FROM `implicit_account_members` GROUP BY `kind` HAVING COUNT(*) = 1);--> statement-breakpoint
CREATE TEMP TABLE `implicit_holding_order` AS
SELECT
  `h`.`id` AS `holding_id`,
  `m`.`kept_id`,
  ROW_NUMBER() OVER (
    PARTITION BY `m`.`kept_id`
    ORDER BY `m`.`account_rank`, `h`.`sort_order`, `h`.`created_at`, `h`.`id`
  ) - 1 AS `new_sort_order`
FROM `holdings` `h`
JOIN `implicit_account_members` `m` ON `m`.`account_id` = `h`.`account_id`;--> statement-breakpoint
CREATE TEMP TABLE `implicit_reminder_rank` AS
SELECT
  `r`.`id` AS `reminder_id`,
  `m`.`kept_id`,
  ROW_NUMBER() OVER (
    PARTITION BY `m`.`kept_id`, `r`.`kind`
    ORDER BY `r`.`created_at`, `r`.`id`
  ) AS `reminder_rank`
FROM `reminders` `r`
JOIN `implicit_account_members` `m` ON `m`.`account_id` = `r`.`account_id`;--> statement-breakpoint
UPDATE `holdings`
SET
  `account_id` = (SELECT `kept_id` FROM `implicit_holding_order` WHERE `holding_id` = `holdings`.`id`),
  `sort_order` = (SELECT `new_sort_order` FROM `implicit_holding_order` WHERE `holding_id` = `holdings`.`id`)
WHERE `id` IN (SELECT `holding_id` FROM `implicit_holding_order`);--> statement-breakpoint
DELETE FROM `reminders`
WHERE `id` IN (SELECT `reminder_id` FROM `implicit_reminder_rank` WHERE `reminder_rank` > 1);--> statement-breakpoint
UPDATE `reminders`
SET `account_id` = (SELECT `kept_id` FROM `implicit_reminder_rank` WHERE `reminder_id` = `reminders`.`id`)
WHERE `id` IN (SELECT `reminder_id` FROM `implicit_reminder_rank` WHERE `reminder_rank` = 1);--> statement-breakpoint
UPDATE `settings`
SET `reminder_offer_dismissals` = (
  SELECT json_group_object(`account_id`, json(`kinds`))
  FROM (
    SELECT
      coalesce(`m`.`kept_id`, `d`.`key`) AS `account_id`,
      json_group_array(DISTINCT `k`.`value`) AS `kinds`
    FROM json_each(`settings`.`reminder_offer_dismissals`) `d`
    JOIN json_each(`d`.`value`) `k`
    LEFT JOIN `implicit_account_members` `m` ON `m`.`account_id` = `d`.`key`
    GROUP BY 1
  )
)
WHERE `reminder_offer_dismissals` IS NOT NULL
  AND EXISTS (SELECT 1 FROM `implicit_account_members`);--> statement-breakpoint
DELETE FROM `sync_state`
WHERE `account_id` IN (SELECT `account_id` FROM `implicit_account_members` WHERE `account_id` <> `kept_id`);--> statement-breakpoint
DELETE FROM `accounts`
WHERE `id` IN (SELECT `account_id` FROM `implicit_account_members` WHERE `account_id` <> `kept_id`);--> statement-breakpoint
UPDATE `accounts`
SET
  `name` = CASE `kind` WHEN 'property' THEN 'Properties' ELSE 'Loans' END,
  `icon` = NULL,
  `color` = NULL
WHERE `kind` IN ('property', 'debt') AND `archived_at` IS NULL;--> statement-breakpoint
DROP TABLE `implicit_reminder_rank`;--> statement-breakpoint
DROP TABLE `implicit_holding_order`;--> statement-breakpoint
DROP TABLE `implicit_account_members`;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_implicit_kind` ON `accounts` (`kind`) WHERE "accounts"."kind" IN ('property', 'debt') AND "accounts"."archived_at" IS NULL;
